
const express = require("express");

const STUDIO_CATEGORIES = [
  "Photo Studio",
  "Film Stage",
  "Podcast Lounge",
  "Music Suite",
  "Workshop",
];

function createStudioCreateRouter(getDatabase) {
  const router = express.Router();

  router.post("/", async (req, res) => {
    try {
      // Verify the real Better Auth session.
      // Never trust a host ID, name, or email sent in the form.
      const { getBetterAuth } = require("./betterAuth");
      const auth = await getBetterAuth(getDatabase);

      const headers = new Headers();

      if (req.headers.cookie) {
        headers.set("cookie", req.headers.cookie);
      }

      if (req.headers.origin) {
        headers.set("origin", req.headers.origin);
      }

      const session = await auth.api.getSession({
        headers,
      });

      if (!session?.user?.id) {
        return res.status(401).json({
          success: false,
          message: "Please sign in to publish a studio.",
        });
      }

      const body = req.body;

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({
          success: false,
          message: "Invalid studio information.",
        });
      }

      const title =
        typeof body.title === "string" ? body.title.trim() : "";

      const category =
        typeof body.category === "string"
          ? body.category.trim()
          : "";

      const location =
        typeof body.location === "string"
          ? body.location.trim()
          : "";

      const overview =
        typeof body.overview === "string"
          ? body.overview.trim()
          : "";

      const imageUrl =
        typeof body.imageUrl === "string"
          ? body.imageUrl.trim()
          : "";

      const images = Array.isArray(body.images)
        ? [...new Set(body.images.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))]
        : (imageUrl ? [imageUrl] : []);
      if (images.length > 10 || images.some((value) => {
        try { return !["http:", "https:"].includes(new URL(value).protocol); }
        catch { return true; }
      })) {
        return res.status(400).json({ success: false, message: "Provide up to 10 valid gallery image URLs." });
      }
      const studioImages = [...new Set([imageUrl, ...images].filter(Boolean))];
      const pricePerHour = Number(body.pricePerHour);
      const securityDeposit = Number(body.securityDeposit ?? 0);
      const maxCapacity = Number(body.maxCapacity);

      if (title.length < 5 || title.length > 150) {
        return res.status(400).json({
          success: false,
          message: "Studio title must contain 5–150 characters.",
        });
      }

      if (!STUDIO_CATEGORIES.includes(category)) {
        return res.status(400).json({
          success: false,
          message: "Please select a valid studio category.",
        });
      }

      if (
        !Number.isFinite(pricePerHour) ||
        pricePerHour <= 0 ||
        pricePerHour > 100000
      ) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid hourly rate.",
        });
      }

      if (
        !Number.isFinite(securityDeposit) ||
        securityDeposit < 0 ||
        securityDeposit > 1000000
      ) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid security deposit.",
        });
      }

      if (
        !Number.isInteger(maxCapacity) ||
        maxCapacity < 1 ||
        maxCapacity > 10000
      ) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid maximum capacity.",
        });
      }

      if (location.length < 5 || location.length > 300) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid studio location.",
        });
      }

      if (overview.length < 20 || overview.length > 10000) {
        return res.status(400).json({
          success: false,
          message: "Studio overview must contain 20–10,000 characters.",
        });
      }

      if (imageUrl) {
        try {
          const url = new URL(imageUrl);

          if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error("Invalid image URL");
          }
        } catch {
          return res.status(400).json({
            success: false,
            message: "Enter a valid image URL.",
          });
        }
      }

      if (
        body.amenities !== undefined &&
        (!Array.isArray(body.amenities) ||
          body.amenities.length > 50 ||
          !body.amenities.every(
            (item) =>
              typeof item === "string" &&
              item.trim().length > 0 &&
              item.length <= 100
          ))
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid amenities list.",
        });
      }

      const amenities = [
        ...new Set(
          (body.amenities || []).map((item) => item.trim())
        ),
      ];

      // Only connect to MongoDB after validating the request.
      let db;

      try {
        db = await getDatabase();
      } catch {
        return res.status(503).json({
          success: false,
          message: "Database temporarily unavailable.",
        });
      }

      const now = new Date();

      const studio = {
        title,
        name: title,
        category,
        location,
        overview,
        description: overview,
        imageUrl,
        images: studioImages,
        pricePerHour,
        securityDeposit,
        maxCapacity,
        amenities,

        // Verified Better Auth identity.
        hostId: session.user.id,
        hostName: session.user.name || "",
        hostEmail: session.user.email || "",
        hostImage: session.user.image || "",

        currency: "USD",
        rating: null,
        reviewCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      const result = await db
        .collection("studios")
        .insertOne(studio);

      return res.status(201).json({
        success: true,
        message: "Studio published successfully.",
        studio: {
          ...studio,
          _id: result.insertedId,
        },
      });
    } catch (error) {
      console.error("Create studio error:", error.message);

      return res.status(503).json({
        success: false,
        message:
          "Unable to publish the studio right now. Please try again.",
      });
    }
  });

  return router;
}

module.exports = { createStudioCreateRouter };
