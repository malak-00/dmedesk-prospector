import { createClient } from "@supabase/supabase-js";

// One client per request, using the service-role key -- this Worker is the
// trusted server side (equivalent to Apps Script running as the sheet
// owner), so it talks to Supabase with the key that bypasses RLS, same as
// SpreadsheetApp.openById() ran with the script owner's own full access.
// Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
export function getSupabase(config) {
  const url = config.supabaseUrl();
  const key = config.supabaseServiceRoleKey();
  if (!url || !key) {
    const err = new Error("Supabase is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)");
    err.name = "SheetsNotConfiguredError"; // reuse the same error name Code.js already special-cases -> HTTP 503
    throw err;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
