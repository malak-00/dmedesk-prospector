// Everything under /api/taxonomies/* except the bare list route (see
// index.js). Action parsed from req.url -- see lib/http.js's
// getActionSegments and api/leads/[...action].js's comment for why.
import { withAuth, sendData, sendError, getActionSegments } from "../../lib/http.js";
import * as taxonomyService from "../../lib/services/taxonomyService.js";

export default withAuth(async (req, res) => {
  const action = getActionSegments(req, "/api/taxonomies/").join("/");

  if (action === "search" && req.method === "GET") {
    const query = new URL(req.url, "http://x").searchParams;
    return sendData(res, { results: await taxonomyService.search(req.supabase, query.get("q")) });
  }
  if (action === "enable" && req.method === "POST") {
    return sendData(res, { taxonomies: await taxonomyService.enable(req.supabase, req.body?.id) });
  }

  return sendError(res, 404, "Not found");
});
