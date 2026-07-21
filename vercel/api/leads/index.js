// Replaces Code.js's "leads/list" route. Always scoped to the signed-in
// user's own claimed leads -- there's no team-wide view, not even via a raw
// query param, same real privacy boundary as before (now also backed by
// Postgres RLS, not just this route's own filtering -- see
// supabase/migrations/0001_init.sql).

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
