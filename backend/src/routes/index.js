import { Router } from "express";
import searchRoutes from "./search.routes.js";
import scrapeRoutes from "./scrape.routes.js";
import briefRoutes from "./brief.routes.js";

const router = Router();

router.use("/search", searchRoutes);
router.use("/scrape", scrapeRoutes);
router.use("/brief", briefRoutes);

export default router;