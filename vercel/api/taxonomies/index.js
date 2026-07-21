import { withAuth, sendData, sendError } from "../../lib/http.js";
import * as taxonomyService from "../../lib/services/taxonomyService.js";

export default withAuth(async (req, res) => {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  const taxonomies = await taxonomyService.listEnabled(req.supabase);
  sendData(res, { taxonomies });
});
