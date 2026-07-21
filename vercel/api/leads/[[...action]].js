// Consolidated from 9 separate files (claim.js, disconnect-new.js,
// disconnect.js, index.js, notes.js, notes/replace.js, reminder.js,
// return-to-prospect.js, status.js) into one optional-catch-all route --
// see api/auth/[...action].js's comment for why (Hobby plan's 12-function
// deployment cap). `[[...action]]` (double brackets) so bare GET /api/leads
// (the list route, zero extra path segments) still matches this file.
import { withAuth, sendData, sendError } from "../../lib/http.js";
import * as leadsService from "../../lib/services/leadsService.js";
import { flattenCompany } from "../../lib/services/csvExport.js";
import { createServiceClient } from "../../lib/supabaseClient.js";

export default withAuth(async (req, res) => {
  const action = (req.query.action || []).join("/");

  if (action === "" && req.method === "GET") {
    const [leads, statuses] = await Promise.all([
      leadsService.listClaimedLeads(req.supabase, req.user.id),
      leadsService.getKnownStatuses(createServiceClient()),
    ]);
    return sendData(res, { leads, statuses });
  }

  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");

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
