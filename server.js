
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { betterAuthMiddleware } = require("./betterAuth");
const { createStudioCreateRouter } = require("./studioCreateRoute");
const { createMyListingsRouter } = require("./myListingsRoute");
const { createStudioEditRouter } = require("./studioEditRoute");
const { createBookingRouter } = require("./bookingRoutes");
const { createWishlistRouter } = require("./wishlistRoute");

const {
  createSecurityRouter,
  requireMutationJWT,
  requireTrustedOrigin,
} = require("./mutationSecurity");

const { createNewsletterRouter } = require("./newsletterRoute");

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
// PUBLIC API LANDING PAGE AND API INDEX
// --------------------------------------------------

const PUBLIC_API_ENDPOINTS = [
  {
    name: "Health check",
    path: "/api/health",
    description: "Service and database connection status",
  },
  {
    name: "Studio categories",
    path: "/api/categories",
    description: "Available creative studio categories",
  },
  {
    name: "Studio listings",
    path: "/api/studios",
    description: "Browse published studios",
  },
  {
    name: "Featured studios",
    path: "/api/studios/featured",
    description: "Six newest studio listings",
  },
];

app.get("/", async (req, res) => {
  let databaseHealthy = false;

  try {
    if (client) {
      await client.db(DB_NAME).command({ ping: 1 });
      databaseHealthy = true;
    }
  } catch {
    databaseHealthy = false;
  }

  databaseConnected = databaseHealthy;

  const databaseStatus = databaseHealthy
    ? "Connected"
    : "Unavailable";

  const databaseColor = databaseHealthy
    ? "#4ade80"
    : "#fbbf24";

  const endpointCards = PUBLIC_API_ENDPOINTS.map(
    ({ name, path, description }) => `
    <a class="endpoint" href="${path}">
      <span>
        <strong>${name}</strong>
        <small>${description}</small>
        <code>GET ${path}</code>
      </span>
      <span class="arrow" aria-hidden="true">↗</span>
    </a>
  `
  ).join("");

  res.set("Cache-Control", "no-store");

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta
    name="description"
    content="Frame API — backend service for the Frame creative studio marketplace."
  >
  <title>Frame API | Creative Studio Marketplace</title>

  <style>
    :root {
      color-scheme: dark;
      font-family: system-ui, -apple-system,
        BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: #0e0e11;
      color: #fafafa;
    }

    main {
      width: min(100% - 36px, 760px);
      margin: 0 auto;
      padding: 64px 0 48px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 13px;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -.04em;
    }

    .logo {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 13px;
      background: #e60023;
      color: white;
      font-size: 27px;
    }

    h1 {
      margin: 36px 0 12px;
      font-size: clamp(32px, 6vw, 48px);
      line-height: 1.13;
      letter-spacing: -.04em;
    }

    .intro {
      max-width: 620px;
      margin: 0;
      color: #aaaab1;
      font-size: 16px;
      line-height: 1.7;
    }

    .status {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: 28px 0 38px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 10px 14px;
      border: 1px solid #303036;
      border-radius: 999px;
      background: #1b1b20;
      color: #e5e5e9;
      font-size: 13px;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4ade80;
    }

    .db-dot {
      background: ${databaseColor};
    }

    h2 {
      margin: 0 0 16px;
      font-size: 19px;
      letter-spacing: -.02em;
    }

    .endpoints {
      display: grid;
      gap: 10px;
    }

    .endpoint {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 17px 19px;
      border: 1px solid #303036;
      border-radius: 14px;
      background: #1b1b20;
      color: inherit;
      text-decoration: none;
      transition: border-color .2s, background .2s;
    }

    .endpoint:hover,
    .endpoint:focus-visible {
      border-color: #e60023;
      background: #252126;
      outline: none;
    }

    .endpoint strong,
    .endpoint small,
    .endpoint code {
      display: block;
    }

    .endpoint strong {
      font-size: 15px;
    }

    .endpoint small {
      margin: 5px 0 9px;
      color: #aaaab1;
      font-size: 13px;
      line-height: 1.4;
    }

    .endpoint code {
      color: #fca5a5;
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .arrow {
      color: #b7b7bd;
      font-size: 20px;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 28px;
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 46px;
      padding: 0 20px;
      border-radius: 999px;
      background: #e60023;
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
    }

    .button:hover,
    .button:focus-visible {
      background: #c9001f;
    }

    .button.secondary {
      border: 1px solid #38383f;
      background: transparent;
    }

    .button.secondary:hover,
    .button.secondary:focus-visible {
      background: #242429;
    }

    footer {
      margin-top: 45px;
      padding-top: 22px;
      border-top: 1px solid #303036;
      color: #85858d;
      font-size: 12px;
    }

    @media (max-width: 480px) {
      main {
        padding-top: 36px;
      }

      .endpoint {
        padding: 15px;
      }

      .actions .button {
        width: 100%;
      }
    }
  </style>
</head>

<body>
  <main>
    <div class="brand">
      <img
        src="https://frame-client.vercel.app/images/brand/frame-logo-white.svg"
        alt="Frame"
        width="180"
        height="48"
        style="display:block;max-width:100%;height:auto"
      />
      <span style="font-size:18px;font-weight:600;color:#aaaab1">
        API
      </span>
    </div>

    <h1>Creative spaces, connected.</h1>

    <p class="intro">
      The backend service for Frame, a marketplace for
      discovering, listing, and booking creative studios.
      Explore the public API endpoints below.
    </p>

    <div class="status" aria-label="Service status">
      <span class="pill">
        <span class="dot" aria-hidden="true"></span>
        API running
      </span>

      <span class="pill">
        <span class="dot db-dot" aria-hidden="true"></span>
        Database: ${databaseStatus}
      </span>
    </div>

    <section aria-labelledby="endpoints-title">
      <h2 id="endpoints-title">Public API endpoints</h2>
      <div class="endpoints">${endpointCards}</div>
    </section>

    <div class="actions">
      <a
        class="button"
        href="https://frame-client.vercel.app"
      >
        Visit Frame website ↗
      </a>

      <a class="button secondary" href="/api">
        View API index ↗
      </a>
    </div>

    <footer>
      Frame API · Node.js · Express · MongoDB
    </footer>
  </main>
</body>
</html>`);
});

app.get("/api", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.status(200).json({
    success: true,
    name: "Frame API",
    description:
      "Backend API for the Frame creative studio marketplace",
    website: "https://frame-client.vercel.app",
    endpoints: PUBLIC_API_ENDPOINTS.map(
      ({ name, path, description }) => ({
        method: "GET",
        name,
        path,
        description,
      })
    ),
  });
});

// --------------------------------------------------
// BETTER AUTH
// IMPORTANT: Mount BEFORE express.json()
// --------------------------------------------------

app.all("/api/auth/*path", (req, res) => {
  return betterAuthMiddleware(req, res, getDatabase);
});

// JSON parsing for existing API routes.
app.use(express.json({ limit: "1mb" }));

app.use(
  "/api/newsletter",
  createNewsletterRouter(getDatabase)
);

// Issue a short-lived JWT only after verifying a
// real Better Auth session.
app.use(
  "/api/security",
  createSecurityRouter(getDatabase)
);

// Protect every studio/booking mutation without
// changing public reads.
app.use((req, res, next) => {
  const path = req.path;

  const isMutation = [
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
  ].includes(req.method);

  const protectedPath =
    path === "/api/studios" ||
    path.startsWith("/api/studios/") ||
    path === "/api/bookings" ||
    path.startsWith("/api/bookings/") ||
    path.startsWith("/api/wishlist/");

  if (!isMutation || !protectedPath) {
    return next();
  }

  return requireTrustedOrigin(req, res, () =>
    requireMutationJWT(getDatabase)(req, res, next)
  );
});

app.use("/api/wishlist", createWishlistRouter(getDatabase));

app.use(
  "/api/bookings",
  createBookingRouter(getDatabase)
);

// PRIVATE: LOAD AND UPDATE OWNED STUDIOS
app.use(
  "/api/studios/manage",
  createStudioEditRouter(getDatabase)
);

// PRIVATE: CURRENT HOST'S STUDIO LISTINGS
app.use(
  "/api/my-listings",
  createMyListingsRouter(getDatabase)
);

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
app.use(
  "/api/studios",
  createStudioCreateRouter(getDatabase)
);

// --------------------------------------------------
// GET ALL STUDIOS
// GET /api/studios
// GET /api/studios?category=photo-studio
// --------------------------------------------------

app.get(
  "/api/studios",
  requireDatabase,
  async (req, res) => {
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

        const matchedCategory =
          STUDIO_CATEGORIES.find(
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
  }
);

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
