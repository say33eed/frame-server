
const express = require("express");
const { MongoClient } = require("mongodb");

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = "frame_db";

// These match the five existing frontend categories.
const STUDIO_CATEGORIES = [
  { name: "Photo Studio", slug: "photo-studio" },
  { name: "Film Stage", slug: "film-stage" },
  { name: "Podcast Lounge", slug: "podcast-lounge" },
  { name: "Music Suite", slug: "music-suite" },
  { name: "Workshop", slug: "workshop" },
];

app.use(express.json());

// Allow the local frontend and deployed Frame frontend.
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
    console.error(
      "MongoDB unavailable:",
      error.message
    );
  } finally {
    connecting = false;
  }
}

// Future database routes can use this helper.
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

// Health check stays available without MongoDB.
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Frame API is running",
    database: databaseConnected
      ? "connected"
      : "unavailable",
  });
});

// Categories are available even if MongoDB is offline.
app.get("/api/categories", (req, res) => {
  res.status(200).json({
    success: true,
    categories: STUDIO_CATEGORIES,
  });
});

// Shared middleware for future database routes.
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

// Prevent unexpected server errors from crashing requests.
app.use((error, req, res, next) => {
  console.error("API error:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    success: false,
    message: "An unexpected server error occurred.",
  });
});

// Start Express regardless of database availability.
app.listen(PORT, () => {
  console.log(`Frame API running on port ${PORT}`);

  // Attempt MongoDB connection without blocking startup.
  void connectDatabase();

  // Retry periodically if the database becomes unavailable.
  setInterval(() => {
    if (!databaseConnected) {
      void connectDatabase();
    }
  }, 15000);
});
