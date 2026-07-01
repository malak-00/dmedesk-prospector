import { Router } from "express";
import { searchNppes, searchCompaniesHandler } from "../controllers/search.controller.js";

const router = Router();

router.get("/nppes", searchNppes);
router.get("/companies", searchCompaniesHandler);

export default router;