
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { betterAuthMiddleware } = require("./betterAuth");
const { createStudioCreateRouter } = require("./studioCreateRoute");
const { createMyListingsRouter } = require("./myListingsRoute");
const { createStudioEditRouter } = require("./studioEditRoute");

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "frame_db";

const STUDIO_CATEGORIES = [
  { name: "Photo Studio", slug: "photo-studio" },
  { name: "Film Stage", slug: "film-stage" },
  { name: "Podcast Lounge", slug: "podcast-lounge" },
  { name: "Music Suite", slug: "music-suite" },
  { name: "Workshop", slug: "workshop" },
];

// --------------------------------------------------
// CORS
// --------------------------------------------------

const allowedOrigins = new Set([
  "http://localhost:3000",
  "https://frame-client.vercel.app",
  ...(process.env.CLIENT_URL
    ? [process.env.CLIENT_URL.replace(/\/+$/, "")]
    : []),
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// --------------------------------------------------
// MONGODB CONNECTION
// --------------------------------------------------

let client = null;
let databaseConnected = false;
let connecting = false;

async function connectDatabase() {
  if (!MONGODB_URI) {
    databaseConnected = false;
    console.warn("MongoDB URI is not configured.");
    return;
  }

  if (connecting) return;

  connecting = true;

  try {
    if (!client) {
      client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
    }

    await client.connect();
    await client.db(DB_NAME).command({ ping: 1 });

    if (!databaseConnected) {
      console.log("MongoDB connected successfully.");
    }

    databaseConnected = true;
  } catch (error) {
    databaseConnected = false;
    console.error("MongoDB unavailable:", error.message);
  } finally {
    connecting = false;
  }
}

async function getDatabase() {
  if (!client) {
    throw new Error("Database is unavailable.");
  }

  try {
    await client.db(DB_NAME).command({ ping: 1 });

    databaseConnected = true;

    return client.db(DB_NAME);
  } catch {
    databaseConnected = false;
    throw new Error("Database is unavailable.");
  }
}

async function requireDatabase(req, res, next) {
  try {
    req.db = await getDatabase();
    next();
  } catch {
    res.status(503).json({
      success: false,
      message:
        "The database is temporarily unavailable. Please try again later.",
    });
  }
}

function handleDatabaseError(res, error) {
  console.error("Studio database error:", error.message);
  databaseConnected = false;

  return res.status(503).json({
    success: false,
    message:
      "Studio information is temporarily unavailable. Please try again later.",
  });
}

// --------------------------------------------------
// BETTER AUTH
// IMPORTANT: Mount BEFORE express.json()
// --------------------------------------------------

app.all("/api/auth/*path", (req, res) => {
  return betterAuthMiddleware(req, res, getDatabase);
});

// JSON parsing for existing API routes.
app.use(express.json({ limit: "1mb" }));

// PRIVATE: LOAD AND UPDATE OWNED STUDIOS
app.use(
  "/api/studios/manage",
  createStudioEditRouter(getDatabase)
);

// PRIVATE: CURRENT HOST'S STUDIO LISTINGS
app.use("/api/my-listings", createMyListingsRouter(getDatabase));

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Frame API is running",
    database: databaseConnected
      ? "connected"
      : "unavailable",
  });
});

// --------------------------------------------------
// STUDIO CATEGORIES
// --------------------------------------------------

app.get("/api/categories", (req, res) => {
  res.status(200).json({
    success: true,
    categories: STUDIO_CATEGORIES,
  });
});

// PRIVATE: CREATE STUDIO
app.use("/api/studios", createStudioCreateRouter(getDatabase));

// --------------------------------------------------
// GET ALL STUDIOS
// GET /api/studios
// GET /api/studios?category=photo-studio
// --------------------------------------------------

app.get("/api/studios", requireDatabase, async (req, res) => {
  try {
    const category = req.query.category;
    const filter = {};

    if (category !== undefined) {
      if (typeof category !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid category.",
        });
      }

      const matchedCategory = STUDIO_CATEGORIES.find(
        (item) => item.slug === category
      );

      if (!matchedCategory) {
        return res.status(400).json({
          success: false,
          message: "Unknown studio category.",
        });
      }

      filter.category = matchedCategory.name;
    }

    const studios = await req.db
      .collection("studios")
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      count: studios.length,
      studios,
    });
  } catch (error) {
    return handleDatabaseError(res, error);
  }
});

// --------------------------------------------------
// GET FEATURED STUDIOS
// Six newest studios, required by assignment.
// --------------------------------------------------

app.get(
  "/api/studios/featured",
  requireDatabase,
  async (req, res) => {
    try {
      const studios = await req.db
        .collection("studios")
        .find({})
        .sort({ createdAt: -1, _id: -1 })
        .limit(6)
        .toArray();

      return res.status(200).json({
        success: true,
        count: studios.length,
        studios,
      });
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }
);

// --------------------------------------------------
// GET SINGLE STUDIO
// --------------------------------------------------

app.get(
  "/api/studios/:id",
  requireDatabase,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid studio ID.",
        });
      }

      const studio = await req.db
        .collection("studios")
        .findOne({ _id: new ObjectId(id) });

      if (!studio) {
        return res.status(404).json({
          success: false,
          message: "Studio not found.",
        });
      }

      return res.status(200).json({
        success: true,
        studio,
      });
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }
);

// --------------------------------------------------
// GLOBAL ERROR HANDLER
// --------------------------------------------------

app.use((error, req, res, next) => {
  console.error("API error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    success: false,
    message: "An unexpected server error occurred.",
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, () => {
  console.log(`Frame API running on port ${PORT}`);

  void connectDatabase();

  setInterval(() => {
    if (!databaseConnected) {
      void connectDatabase();
    }
  }, 15000);
});
