// Calls imported from the phone system's call log (sql/053).
import { cleanCallRows, phonesFor, tallyByPhone, MAX_IMPORT_ROWS } from "../lib/callLog.js";
import { isTableMissing } from "../lib/annotations.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const NOT_INSTALLED = "Call log import isn't installed yet. Run sql/053_call_records.sql in Supabase, then try again.";

// rawRows: [{ calledAt, agent, phone, durationSec, disposition }] from the browser, up to MAX_IMPORT_ROWS at a time.
export async function importCalls(supabase, session, rawRows, now = Date.now()) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) throw httpError(400, "Send the rows to import.");
  if (rawRows.length > MAX_IMPORT_ROWS) throw httpError(400, `Send up to ${MAX_IMPORT_ROWS} rows at a time.`);
  const cleaned = cleanCallRows(rawRows, now);
  let inserted = 0;
  if (cleaned.rows.length) {
    const rows = cleaned.rows.map((r) => ({ ...r, imported_by: session.id }));
    const res = await supabase.from("call_records").upsert(rows, { onConflict: "agent,phone,called_at", ignoreDuplicates: true }).select("id");
    if (res.error) {
      if (isTableMissing(res.error)) throw httpError(503, NOT_INSTALLED);
      throw httpError(500, "Failed to import the calls: " + res.error.message);
    }
    inserted = (res.data || []).length;
  }
  return {
    received: rawRows.length,
    imported: inserted,
    alreadyThere: cleaned.rows.length - inserted + cleaned.duplicates,
    skipped: cleaned.skipped,
  };
}

// Pickup history from the phone system for a page of results: company.pickup becomes { answered, total, source }.
// The phone system is exact, so when it has calls for a lead it replaces the estimate built from typed results.
export async function attachCallRecords(supabase, companies) {
  const byCompany = companies.map((c) => phonesFor(c));
  const all = [...new Set(byCompany.flat())];
  if (!all.length) return companies;
  const res = await supabase.from("call_records").select("phone, duration_sec, disposition").in("phone", all).limit(5000);
  if (res.error) {
    if (isTableMissing(res.error)) return companies;
    throw new Error("Failed to read the call log: " + res.error.message);
  }
  if (!(res.data || []).length) return companies;
  const tally = tallyByPhone(res.data);
  return companies.map((company, i) => {
    let total = 0;
    let answered = 0;
    byCompany[i].forEach((phone) => { const t = tally.get(phone); if (t) { total += t.total; answered += t.answered; } });
    return total ? Object.assign({}, company, { pickup: { answered, total, source: "phone system" } }) : company;
  });
}
