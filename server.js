
const express = require("express");
const { MongoClient } = require("mongodb");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not configured.");
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Frame API is running",
  });
});

async function startServer() {
  try {
    await client.connect();
    await client.db("frame_db").command({ ping: 1 });

    console.log("MongoDB connected successfully");

    app.listen(PORT, () => {
      console.log(`Frame API running on port ${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    await client.close();
    process.exit(1);
  }
}

startServer();
  