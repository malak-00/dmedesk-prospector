import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import logger from "./middleware/logger.js";
import basicAuth from "./middleware/basicAuth.js";
import errorHandler from "./middleware/errorHandler.js";
import routes from "./routes/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());
app.use(logger);
app.use(basicAuth);

// Static frontend
app.use(express.static(path.join(__dirname, "../public")));

// Health check (moved from "/")
app.get("/api/health", (req, res) => {
  res.json({ name: "DME Desk Prospector", version: "1.0.0", status: "running" });
});

// Feature routes
app.use("/api", routes);

// 404 handler — must come after all routes, before errorHandler
app.use((req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  next(error);
});

// Centralized error handler — must be last
app.use(errorHandler);

export default app;