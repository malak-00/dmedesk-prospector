// Restores the old appscript/services/SheetsStore.js behavior of writing
// claimed leads into a real, shared Google Sheet -- specifically into a
// per-teammate "Claimed - <Display Name>" tab, auto-created the first time
// that person exports to it, same layout/columns as the original. This is
// now a SEPARATE, optional action from claiming a lead (see index.js's
// /export/sheets vs /export/google-sheet): claiming writes to Supabase
// (leadsRepo.js) and is what the app's own Claimed Leads view reads from;
// this is purely "also paste a copy into the shared spreadsheet for anyone
// who wants to look at it in Sheets," same as the old app did automatically
// as part of claiming, just decoupled now that Supabase is the real store.
//
// Auth: an OAuth client + a long-lived refresh token, authorized once as a
// real Google account (whoever owns/edits the target spreadsheet) -- NOT a
// service account. Some Google Workspace orgs block service-account key
// creation entirely (org policy iam.disableServiceAccountKeyCreation), which
// this sidesteps: creating an OAuth client and authorizing it as yourself
// isn't a service-account key, so it isn't covered by that policy. Set
// GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET /
// GOOGLE_OAUTH_REFRESH_TOKEN / GOOGLE_SHEET_ID as Worker secrets -- see
// worker/README.md for how to obtain the refresh token (a one-time consent
// flow, e.g. via Google's OAuth 2.0 Playground). The refresh token itself
// never expires (until revoked), so this is a one-time setup step, not
// something that needs re-doing periodically.
import { CSV_COLUMNS, flattenCompany } from "../lib/csvExport.js";

export function GoogleSheetsNotConfiguredError() {
  const err = new Error("Google Sheets export is not configured (missing GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN, or GOOGLE_SHEET_ID)");
  err.name = "GoogleSheetsNotConfiguredError";
  return err;
}

const TRACKING_COLUMNS = [
  { key: "claimedBy", label: "Claimed By" },
  { key: "claimedAt", label: "Claimed At" },
  { key: "status", label: "Status" },
  { key: "statusUpdatedBy", label: "Status Updated By" },
  { key: "statusUpdatedAt", label: "Status Updated At" },
  { key: "notes", label: "Notes" },
  { key: "reminderAt", label: "Reminder At" },
];
const HEADER = CSV_COLUMNS.map((c) => c.label).concat(TRACKING_COLUMNS.map((c) => c.label));
const CLAIMED_TAB_PREFIX = "Claimed - ";

function assertConfigured(config) {
  if (!config.googleOauthClientId() || !config.googleOauthClientSecret() || !config.googleOauthRefreshToken() || !config.googleSheetId()) {
    throw GoogleSheetsNotConfiguredError();
  }
}

// Sheet tab names can't contain [ ] * ? : / \ and are capped at 100 chars --
// same rule the old SheetsStore.claimedTabName_ enforced.
function claimedTabName(displayName) {
  const raw = String(displayName || "").trim() || "Unassigned";
  const cleaned = raw.replace(/[[\]*?:/\\]/g, "-").trim() || "Unassigned";
  const full = CLAIMED_TAB_PREFIX + cleaned;
  return full.length > 100 ? full.slice(0, 100) : full;
}

// A1-notation sheet-name quoting: wrap in single quotes, double any
// internal single quotes -- needed since display names can contain spaces.
function quoteSheetName(name) {
  return `'${name.replace(/'/g, "''")}'`;
}

let cachedToken = null; // { token, expiresAt } -- best-effort, per-isolate reuse

async function getAccessToken(config) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.googleOauthClientId(),
      client_secret: config.googleOauthClientSecret(),
      refresh_token: config.googleOauthRefreshToken(),
    }),
  });
  if (!res.ok) {
    const err = new Error("Failed to authenticate with Google Sheets: " + (await res.text().catch(() => res.statusText)));
    err.status = 502;
    throw err;
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function sheetsApi(token, path, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = new Error("Google Sheets API error: " + (await res.text().catch(() => res.statusText)));
    err.status = 502;
    throw err;
  }
  return res.json();
}

// Gets (or creates) the tab that belongs to one teammate, returning its
// numeric sheetId (for the sheetUrl gid) and whether it was freshly created
// (so the caller knows to write a header row).
async function ensureUserTab(token, spreadsheetId, tabName) {
  const meta = await sheetsApi(token, `${spreadsheetId}?fields=sheets.properties`);
  const existing = (meta.sheets || []).find((s) => s.properties.title === tabName);
  if (existing) return { sheetId: existing.properties.sheetId, created: false };

  const result = await sheetsApi(token, `${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
  });
  return { sheetId: result.replies[0].addSheet.properties.sheetId, created: true };
}

async function writeHeaderRow(token, spreadsheetId, tabName) {
  await sheetsApi(token, `${spreadsheetId}/values/${encodeURIComponent(quoteSheetName(tabName))}!A1?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [HEADER] }),
  });
}

async function appendRows(token, spreadsheetId, tabName, rows) {
  await sheetsApi(
    token,
    `${spreadsheetId}/values/${encodeURIComponent(quoteSheetName(tabName))}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) }
  );
}

export async function exportCompaniesToSheet(config, companies, session) {
  assertConfigured(config);
  companies = companies || [];
  if (!Array.isArray(companies) || companies.length === 0) {
    const err = new Error("At least one company is required to export");
    err.status = 400;
    throw err;
  }

  const token = await getAccessToken(config);
  const spreadsheetId = config.googleSheetId();
  const tabName = claimedTabName(session.displayName);

  const { sheetId, created } = await ensureUserTab(token, spreadsheetId, tabName);
  if (created) await writeHeaderRow(token, spreadsheetId, tabName);

  const now = new Date().toISOString();
  const rows = companies.map((company) => {
    const flat = flattenCompany(company);
    const csvValues = CSV_COLUMNS.map((c) => (flat[c.key] != null ? flat[c.key] : ""));
    const trackingValues = [session.displayName || "", now, "new", "", "", "", ""];
    return csvValues.concat(trackingValues);
  });

  await appendRows(token, spreadsheetId, tabName, rows);

  return {
    tab: tabName,
    rowsAdded: rows.length,
    claimedBy: session.displayName,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`,
  };
}
