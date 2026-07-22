// The bare GET /api/taxonomies list route -- split out for the same reason
// as api/leads/index.js (no optional-catch-all support outside Next.js).
import { withAuth, sendData, sendError } from "../../lib/http.js";
import * as taxonomyService from "../../lib/services/taxonomyService.js";

export default withAuth(async (req, res) => {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  sendData(res, { taxonomies: await taxonomyService.listEnabled(req.supabase) });
});
