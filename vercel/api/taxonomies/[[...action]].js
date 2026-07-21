// Consolidated from enable.js/index.js/search.js -- see
// api/auth/[...action].js's comment for why (Hobby plan's 12-function
// deployment cap). `[[...action]]` so bare GET /api/taxonomies (the list
// route) still matches this file.
import { withAuth, sendData, sendError } from "../../lib/http.js";
import * as taxonomyService from "../../lib/services/taxonomyService.js";

export default withAuth(async (req, res) => {
  const action = (req.query.action || []).join("/");

  if (action === "" && req.method === "GET") {
    return sendData(res, { taxonomies: await taxonomyService.listEnabled(req.supabase) });
  }
  if (action === "search" && req.method === "GET") {
    return sendData(res, { results: await taxonomyService.search(req.supabase, req.query.q) });
  }
  if (action === "enable" && req.method === "POST") {
    return sendData(res, { taxonomies: await taxonomyService.enable(req.supabase, req.body?.id) });
  }

  return sendError(res, 404, "Not found");
});
