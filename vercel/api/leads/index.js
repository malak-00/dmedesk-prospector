// The bare GET /api/leads list route -- split out from the catch-all
// because Vercel's plain (non-framework) Functions don't support the
// optional-catch-all `[[...action]]` syntax (that's a Next.js-only
// extension); a required catch-all like `[...action].js` never matches a
// path with zero segments, so the index route needs its own file.
import { withAuth, sendData, sendError } from "../../lib/http.js";
import * as leadsService from "../../lib/services/leadsService.js";
import { createServiceClient } from "../../lib/supabaseClient.js";

export default withAuth(async (req, res) => {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");

  const [leads, statuses] = await Promise.all([
    leadsService.listClaimedLeads(req.supabase, req.user.id),
    leadsService.getKnownStatuses(createServiceClient()),
  ]);
  sendData(res, { leads, statuses });
});
