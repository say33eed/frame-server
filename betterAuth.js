
const { createRequire } = require("node:module");

let authPromise = null;

function getBetterAuth(getDatabase) {
  if (!authPromise) {
    authPromise = (async () => {
      const { betterAuth } = await import("better-auth");
      const { mongodbAdapter } = await import(
        "better-auth/adapters/mongodb"
      );

      const db = await getDatabase();

      if (!process.env.BETTER_AUTH_SECRET ||
          process.env.BETTER_AUTH_SECRET.length < 32) {
        throw new Error(
          "BETTER_AUTH_SECRET must be at least 32 characters."
        );
      }

      const frontendOrigins = [
        "http://localhost:3000",
        "https://frame-client.vercel.app",
        ...(process.env.CLIENT_URL
          ? [process.env.CLIENT_URL.replace(/\/+$/, "")]
          : []),
      ];

      return betterAuth({
        appName: "Frame",

        baseURL:
          process.env.BETTER_AUTH_URL ||
          `http://localhost:${process.env.PORT || 5000}`,

        basePath: "/api/auth",

        secret: process.env.BETTER_AUTH_SECRET,

        database: mongodbAdapter(db),

        trustedOrigins: frontendOrigins,

        emailAndPassword: {
          enabled: true,
          minPasswordLength: 6,
          maxPasswordLength: 128,
          requireEmailVerification: false,
          autoSignIn: false,
        },

        socialProviders: process.env.GOOGLE_CLIENT_ID &&
          process.env.GOOGLE_CLIENT_SECRET
          ? {
              google: {
                clientId: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              },
            }
          : {},

        advanced: {
          useSecureCookies:
            process.env.NODE_ENV === "production",

          defaultCookieAttributes:
            process.env.NODE_ENV === "production"
              ? {
                  sameSite: "none",
                  secure: true,
                  httpOnly: true,
                }
              : {
                  sameSite: "lax",
                  secure: false,
                  httpOnly: true,
                },
        },
      });
    })().catch((error) => {
      authPromise = null;
      throw error;
    });
  }

  return authPromise;
}

async function betterAuthMiddleware(req, res, getDatabase) {
  try {
    const { toNodeHandler } = await import("better-auth/node");
    const auth = await getBetterAuth(getDatabase);
    const handler = toNodeHandler(auth);

    return handler(req, res);
  } catch (error) {
    console.error("Better Auth unavailable:", error.message);

    if (!res.headersSent) {
      res.status(503).json({
        success: false,
        message:
          "Authentication is temporarily unavailable.",
      });
    }
  }
}

module.exports = {
  getBetterAuth,
  betterAuthMiddleware,
};
