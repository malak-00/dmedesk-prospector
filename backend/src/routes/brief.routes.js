import { Router } from "express";
import { generateBrief } from "../controllers/brief.controller.js";

const router = Router();

router.post("/generate", generateBrief);

export default router;