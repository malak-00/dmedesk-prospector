import { Router } from "express";
import searchRoutes from "./search.routes.js";
import scrapeRoutes from "./scrape.routes.js";

const router = Router();

router.use("/search", searchRoutes);
router.use("/scrape", scrapeRoutes);

export default router;