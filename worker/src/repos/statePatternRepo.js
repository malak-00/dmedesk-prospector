// What reps have heard on calls in one state (objections and billers), from call intel (sql/050).
// Shown on the Prospect card and in the call brief so a rep knows the local pattern before dialing.
import { isTableMissing } from "../lib/annotations.js";
import { statePattern } from "../lib/intel.js";

const CAP = 3000;
const CHUNK = 200;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export async function getStatePattern(supabase, stateInput) {
  const state = String(stateInput || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw httpError(400, "Send a two-letter state.");
  const res = await supabase.from("lead_intel").select("npi, objection, current_biller").or("objection.not.is.null,current_biller.not.is.null").limit(CAP);
  if (res.error) {
    if (isTableMissing(res.error)) return { pattern: null };
    throw httpError(500, "Failed to read call intel: " + res.error.message);
  }
  const rows = res.data || [];
  const stateByNpi = new Map();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const found = await supabase.from("npi_records").select("npi, address_state").in("npi", rows.slice(i, i + CHUNK).map((r) => String(r.npi)));
    if (found.error) throw httpError(500, "Failed to look up states: " + found.error.message);
    for (const f of found.data || []) stateByNpi.set(String(f.npi), String(f.address_state || "").toUpperCase());
  }
  return { pattern: statePattern(rows, stateByNpi, state) };
}
