import { Router } from "express";
import { scrapeWebsite } from "../controllers/scrape.controller.js";

const router = Router();

router.get("/website", scrapeWebsite);

export default router;