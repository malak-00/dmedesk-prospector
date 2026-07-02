import { generateCallBrief, GeminiNotConfiguredError } from "../services/aiBrief.service.js";

export async function generateBrief(req, res, next) {
  try {
    const { company } = req.body;

    if (!company || !company.name) {
      const error = new Error("Request body must include a 'company' object with at least a name");
      error.status = 400;
      throw error;
    }

    const brief = await generateCallBrief(company);
    res.json({ success: true, company: company.name, brief });
  } catch (err) {
    if (err instanceof GeminiNotConfiguredError) {
      err.status = 503;
      err.message = "AI brief generation is not configured (missing GEMINI_API_KEY)";
    }
    next(err);
  }
}

export default { generateBrief };