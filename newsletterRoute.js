const express = require("express");

function createNewsletterRouter(getDatabase) {
  const router = express.Router();
  router.post("/", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    try {
      const db = await getDatabase();
      await db.collection("newsletter_subscribers").updateOne(
        { email },
        { $setOnInsert: { email, subscribedAt: new Date(), source: "footer" } },
        { upsert: true }
      );
      return res.status(200).json({ success: true, message: "Thanks! You're on the Frame newsletter list." });
    } catch (error) {
      console.error("Newsletter signup error:", error.message);
      return res.status(503).json({ success: false, message: "Newsletter signup is unavailable right now. Please try later." });
    }
  });
  return router;
}

module.exports = { createNewsletterRouter };
