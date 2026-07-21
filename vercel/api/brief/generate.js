import { withAuth, sendData, sendError } from "../../lib/http.js";
import { generateCallBrief } from "../../lib/services/aiBriefService.js";

export default withAuth(async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const { company } = req.body || {};
  if (!company) return sendError(res, 400, 'Request body must include a "company" object');
  const brief = await generateCallBrief(company);
  sendData(res, { brief });
});
