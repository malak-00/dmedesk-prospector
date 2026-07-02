import { Router } from "express";
import searchRoutes from "./search.routes.js";
import scrapeRoutes from "./scrape.routes.js";
import briefRoutes from "./brief.routes.js";
import exportRoutes from "./export.routes.js";

const router = Router();

router.use("/search", searchRoutes);
router.use("/scrape", scrapeRoutes);
router.use("/brief", briefRoutes);
router.use("/export", exportRoutes);

export default router;