import { Router } from "express";
import { exportCsv } from "../controllers/export.controller.js";

const router = Router();

router.post("/csv", exportCsv);

export default router;