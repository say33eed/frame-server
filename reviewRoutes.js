"use strict";
const express = require("express");
const { ObjectId } = require("mongodb");
const { getBetterAuth } = require("./betterAuth");

function createReviewRouter(getDatabase) {
  const router = express.Router();
  const validId = (id) => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id) && ObjectId.isValid(id);
  const fail = (res, status, message) => res.status(status).json({ success: false, message });

  async function authenticate(req, res, next) {
    try {
      const auth = await getBetterAuth(getDatabase);
      const headers = new Headers();
      if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
      if (req.headers.origin) headers.set("origin", req.headers.origin);
      const session = await auth.api.getSession({ headers });
      if (!session?.user?.id) return fail(res, 401, "Please sign in to manage reviews.");
      req.reviewUser = session.user;
      next();
    } catch (error) {
      console.error("Review authentication:", error.message);
      return fail(res, 503, "Authentication is temporarily unavailable.");
    }
  }

  function isHost(studio, user) {
    return studio.hostId === user.id ||
      (!studio.hostId && Boolean(user.email) &&
        (studio.hostEmail === user.email || studio.ownerEmail === user.email));
  }

  function bookingEnd(booking) {
    if (typeof booking.date !== "string" || typeof booking.endTime !== "string") return NaN;
    return Date.parse(`${booking.date}T${booking.endTime}:00Z`);
  }

  async function eligibleBooking(db, studioId, userId) {
    const bookings = await db.collection("bookings").find({
      studioId, userId, status: { $in: ["Confirmed", "Completed"] },
    }).project({ date: 1, endTime: 1 }).toArray();
    return bookings.some((booking) => Number.isFinite(bookingEnd(booking)) && bookingEnd(booking) <= Date.now());
  }

  function parseReview(body) {
    const rating = body?.rating;
    const comment = typeof body?.comment === "string" ? body.comment.trim() : "";
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "Choose a rating from 1 to 5 stars." };
    if (comment.length < 10 || comment.length > 1500) return { error: "Review text must be between 10 and 1500 characters." };
    return { rating, comment };
  }

  // Recompute from the source of truth. An empty studio must not advertise 0.0 stars.
  async function updateSummary(db, studioId) {
    const [summary] = await db.collection("reviews").aggregate([
      { $match: { studioId } },
      { $group: { _id: "$studioId", count: { $sum: 1 }, average: { $avg: "$rating" } } },
    ]).toArray();
    await db.collection("studios").updateOne({ _id: studioId }, {
      $set: { reviewCount: summary?.count ?? 0, rating: summary ? Math.round(summary.average * 10) / 10 : null },
    });
  }

  // Unique per user and studio, including concurrent submissions.
  let indexPromise;
  function ensureIndex(db) {
    if (!indexPromise) {
      indexPromise = db.collection("reviews").createIndex({ studioId: 1, userId: 1 }, { unique: true })
        .catch((error) => { indexPromise = null; throw error; });
    }
    return indexPromise;
  }

  router.get("/studio/:studioId", async (req, res) => {
    if (!validId(req.params.studioId)) return fail(res, 400, "Invalid studio ID.");
    try {
      const db = await getDatabase();
      const studioId = new ObjectId(req.params.studioId);
      const studio = await db.collection("studios").findOne({ _id: studioId }, { projection: { _id: 1 } });
      if (!studio) return fail(res, 404, "Studio not found.");
      const reviews = await db.collection("reviews").find({ studioId })
        .sort({ createdAt: -1, _id: -1 }).limit(200).toArray();
      const summary = await db.collection("reviews").aggregate([
        { $match: { studioId } },
        { $group: { _id: null, reviewCount: { $sum: 1 }, rating: { $avg: "$rating" } } },
      ]).toArray();
      return res.json({ success: true, reviews, reviewCount: summary[0]?.reviewCount ?? 0,
        rating: summary[0] ? Math.round(summary[0].rating * 10) / 10 : null });
    } catch (error) {
      console.error("List reviews:", error.message);
      return fail(res, 503, "Unable to load reviews.");
    }
  });

  router.get("/studio/:studioId/eligibility", authenticate, async (req, res) => {
    if (!validId(req.params.studioId)) return fail(res, 400, "Invalid studio ID.");
    try {
      const db = await getDatabase();
      const studioId = new ObjectId(req.params.studioId);
      const studio = await db.collection("studios").findOne({ _id: studioId });
      if (!studio) return fail(res, 404, "Studio not found.");
      const existing = await db.collection("reviews").findOne({ studioId, userId: req.reviewUser.id });
      const eligible = !isHost(studio, req.reviewUser) && await eligibleBooking(db, studioId, req.reviewUser.id);
      return res.json({ success: true, eligible, myReview: existing ?? null });
    } catch (error) {
      console.error("Review eligibility:", error.message);
      return fail(res, 503, "Unable to check review eligibility.");
    }
  });

  router.post("/studio/:studioId", authenticate, async (req, res) => {
    if (!validId(req.params.studioId)) return fail(res, 400, "Invalid studio ID.");
    const parsed = parseReview(req.body);
    if (parsed.error) return fail(res, 400, parsed.error);
    try {
      const db = await getDatabase();
      const studioId = new ObjectId(req.params.studioId);
      const studio = await db.collection("studios").findOne({ _id: studioId });
      if (!studio) return fail(res, 404, "Studio not found.");
      if (isHost(studio, req.reviewUser)) return fail(res, 403, "Hosts cannot review their own studios.");
      if (!(await eligibleBooking(db, studioId, req.reviewUser.id)))
        return fail(res, 403, "You can review this studio after your confirmed booking has ended.");
      await ensureIndex(db);
      const now = new Date();
      const review = { studioId, userId: req.reviewUser.id,
        name: req.reviewUser.name || "Frame creator", rating: parsed.rating, comment: parsed.comment,
        createdAt: now, updatedAt: now };
      const result = await db.collection("reviews").insertOne(review);
      await updateSummary(db, studioId);
      return res.status(201).json({ success: true, review: { ...review, _id: result.insertedId } });
    } catch (error) {
      if (error.code === 11000) return fail(res, 409, "You already reviewed this studio. Edit your existing review instead.");
      console.error("Create review:", error.message);
      return fail(res, 503, "Unable to save review.");
    }
  });

  router.patch("/:reviewId", authenticate, async (req, res) => {
    if (!validId(req.params.reviewId)) return fail(res, 400, "Invalid review ID.");
    const parsed = parseReview(req.body);
    if (parsed.error) return fail(res, 400, parsed.error);
    try {
      const db = await getDatabase();
      const result = await db.collection("reviews").findOneAndUpdate(
        { _id: new ObjectId(req.params.reviewId), userId: req.reviewUser.id },
        { $set: { rating: parsed.rating, comment: parsed.comment, updatedAt: new Date() } },
        { returnDocument: "after" });
      if (!result) return fail(res, 404, "Your review was not found.");
      await updateSummary(db, result.studioId);
      return res.json({ success: true, review: result });
    } catch (error) {
      console.error("Update review:", error.message);
      return fail(res, 503, "Unable to update review.");
    }
  });

  router.delete("/:reviewId", authenticate, async (req, res) => {
    if (!validId(req.params.reviewId)) return fail(res, 400, "Invalid review ID.");
    try {
      const db = await getDatabase();
      const result = await db.collection("reviews").findOneAndDelete({
        _id: new ObjectId(req.params.reviewId), userId: req.reviewUser.id,
      });
      if (!result) return fail(res, 404, "Your review was not found.");
      await updateSummary(db, result.studioId);
      return res.json({ success: true, message: "Review deleted." });
    } catch (error) {
      console.error("Delete review:", error.message);
      return fail(res, 503, "Unable to delete review.");
    }
  });
  return router;
}
module.exports = { createReviewRouter };
