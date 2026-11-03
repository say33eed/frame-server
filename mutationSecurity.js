"use strict";

const crypto = require("node:crypto");
const { getBetterAuth } = require("./betterAuth");

const COOKIE = "frame_access_jwt";
const MAX_AGE = 15 * 60;
const isProduction = () => process.env.NODE_ENV === "production";

function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? "none" : "lax",
    path: "/",
    maxAge: MAX_AGE * 1000,
  };
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters.");
  }
  return secret;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const unsigned = `${header}.${body}`;
  const signature = crypto.createHmac("sha256", jwtSecret())
    .update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function verify(token) {
  if (typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = crypto.createHmac("sha256", jwtSecret())
    .update(`${header}.${body}`).digest();
  let received;
  try {
    received = Buffer.from(signature, "base64url");
    if (received.length !== expected.length ||
        !crypto.timingSafeEqual(received, expected)) return null;
    const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString());
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const now = Math.floor(Date.now() / 1000);
    if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT" ||
        payload.iss !== "frame-server" || payload.aud !== "frame-mutations" ||
        typeof payload.sub !== "string" || !payload.sub ||
        typeof payload.sid !== "string" || !payload.sid ||
        !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
        payload.iat > now + 30 || payload.exp <= now ||
        payload.exp - payload.iat > MAX_AGE) return null;
    return payload;
  } catch { return null; }
}

function readCookie(req, name) {
  const item = (req.headers.cookie || "").split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(name.length + 1)); }
  catch { return null; }
}

async function currentSession(req, getDatabase) {
  const auth = await getBetterAuth(getDatabase);
  const headers = new Headers();
  if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
  if (req.headers.origin) headers.set("origin", req.headers.origin);
  return auth.api.getSession({ headers });
}

function allowedOrigin(origin) {
  const allowed = ["http://localhost:3000", "https://frame-client.vercel.app"];
  if (process.env.CLIENT_URL) allowed.push(process.env.CLIENT_URL.replace(/\/+$/, ""));
  return allowed.includes(origin);
}

function requireTrustedOrigin(req, res, next) {
  if (!req.headers.origin || !allowedOrigin(req.headers.origin)) {
    return res.status(403).json({ success: false, message: "Untrusted request origin." });
  }
  next();
}

function createSecurityRouter(getDatabase) {
  const express = require("express");
  const router = express.Router();
  router.post("/issue", requireTrustedOrigin, async (req, res) => {
    try {
      const session = await currentSession(req, getDatabase);
      if (!session?.user?.id || !session?.session?.id) {
        res.clearCookie(COOKIE, cookieOptions());
        return res.status(401).json({ success: false, message: "Please sign in first." });
      }
      const now = Math.floor(Date.now() / 1000);
      const token = sign({
        iss: "frame-server", aud: "frame-mutations",
        sub: session.user.id, sid: session.session.id,
        iat: now, exp: now + MAX_AGE,
      });
      res.cookie(COOKIE, token, cookieOptions());
      return res.json({ success: true, message: "Secure access ready." });
    } catch (error) {
      console.error("JWT issue:", error.message);
      return res.status(503).json({ success: false, message: "Secure authentication unavailable." });
    }
  });
  return router;
}

function requireMutationJWT(getDatabase) {
  return async (req, res, next) => {
    try {
      const token = readCookie(req, COOKIE);
      const payload = token ? verify(token) : null;
      if (!payload) {
        return res.status(401).json({ success: false, message: "Secure session missing or expired. Please sign in again." });
      }
      const session = await currentSession(req, getDatabase);
      if (!session?.user?.id || !session?.session?.id ||
          session.user.id !== payload.sub || session.session.id !== payload.sid) {
        return res.status(401).json({ success: false, message: "Session expired. Please sign in again." });
      }
      req.authenticatedUser = session.user;
      return next();
    } catch (error) {
      console.error("JWT validation:", error.message);
      return res.status(503).json({ success: false, message: "Authentication is temporarily unavailable." });
    }
  };
}

module.exports = { createSecurityRouter, requireMutationJWT, requireTrustedOrigin };
