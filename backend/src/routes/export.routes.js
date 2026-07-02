import { Router } from "express";
import { exportCsv, exportToSheet } from "../controllers/export.controller.js";

const router = Router();

router.post("/csv", exportCsv);
router.post("/sheets", exportToSheet);

export default router;