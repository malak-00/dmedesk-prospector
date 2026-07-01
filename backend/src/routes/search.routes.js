import { Router } from "express";
import { searchNppes } from "../controllers/search.controller.js";

const router = Router();

// GET /api/search/nppes?organizationName=...&city=...&state=...
router.get("/nppes", searchNppes);

export default router;