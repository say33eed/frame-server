
const express = require("express");

const app = express();

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Frame API is running",
  });
});

const PORT = process.env.PORT

app.listen(PORT, () => {
  console.log(`Frame API running on port ${PORT}`);
});
  