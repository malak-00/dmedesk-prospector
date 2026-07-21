import { withAuth, sendData, sendError } from "../../lib/http.js";
import * as taxonomyService from "../../lib/services/taxonomyService.js";

export default withAuth(async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const taxonomies = await taxonomyService.enable(req.supabase, req.body?.id);
  sendData(res, { taxonomies });
});
