import express from "express";
import cors from "cors";
import logger from "./middleware/logger.js";

const app = express();

app.use(logger);
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "DME Desk Prospector",
    version: "1.0.0",
    status: "running",
  });
});

export default app;