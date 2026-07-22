// Everything under /api/leads/* except the bare list route (see index.js's
// comment for why that's split out). Action is parsed from req.url (see
// lib/http.js's getActionSegments), not Vercel's file-system `req.query`
// population, which isn't reliably populated for plain Vercel Functions.
import { withAuth, sendData, sendError, getActionSegments } from "../../lib/http.js";
import * as leadsService from "../../lib/services/leadsService.js";
import { flattenCompany } from "../../lib/services/csvExport.js";

export default withAuth(async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const action = getActionSegments(req, "/api/leads/").join("/");

  if (action === "claim") {
    return sendData(res, await leadsService.claimCompanies(req.supabase, req.user.id, req.body?.companies, flattenCompany));
  }
  if (action === "disconnect-new") {
    return sendData(res, await leadsService.disconnectNewCompanies(req.supabase, req.user.id, req.body?.companies, flattenCompany));
  }
  if (action === "disconnect") {
    return sendData(res, await leadsService.moveClaimedLeadsToDisconnected(req.supabase, req.user.id, req.body?.npis));
  }
  if (action === "notes") {
    const { npi, note } = req.body || {};
    return sendData(res, await leadsService.addLeadNote(req.supabase, req.user.id, req.profile.display_name, npi, note));
  }
  if (action === "notes/replace") {
    const { npi, notes } = req.body || {};
    return sendData(res, await leadsService.replaceLeadNotes(req.supabase, req.user.id, npi, notes));
  }
  if (action === "reminder") {
    const { npi, reminderAt } = req.body || {};
    return sendData(res, await leadsService.setLeadReminder(req.supabase, req.user.id, npi, reminderAt));
  }
  if (action === "return-to-prospect") {
    return sendData(res, await leadsService.returnClaimedLeadsToProspect(req.supabase, req.user.id, req.body?.npis));
  }
  if (action === "status") {
    const { npi, status } = req.body || {};
    return sendData(res, await leadsService.updateLeadStatus(req.supabase, req.user.id, npi, status));
  }

  return sendError(res, 404, "Not found");
});
