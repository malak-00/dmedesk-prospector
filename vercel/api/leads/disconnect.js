// Replaces Code.js's "leads/disconnect" route +
// SheetsStore.moveClaimedLeadsToDisconnected -- moves the signed-in user's
// OWN already-claimed leads to disconnected.
import { withAuth, sendData, sendError } from "../../lib/http.js";
import * as leadsService from "../../lib/services/leadsService.js";

export default withAuth(async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const data = await leadsService.moveClaimedLeadsToDisconnected(req.supabase, req.user.id, req.body?.npis);
  sendData(res, data);
});
