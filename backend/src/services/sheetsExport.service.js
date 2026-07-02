import { google } from "googleapis";
import config from "../config/index.js";
import { CSV_COLUMNS, flattenCompany } from "./export.service.js";

class SheetsNotConfiguredError extends Error {
  constructor(missing) {
    super(`Google Sheets export is not configured (missing: ${missing})`);
    this.name = "SheetsNotConfiguredError";
  }
}

function assertConfigured() {
  const missing = [];
  if (!config.googleServiceAccountKeyPath && !config.googleServiceAccountKeyJson) {
    missing.push("GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SERVICE_ACCOUNT_KEY_JSON");
  }
  if (!config.googleSheetId) missing.push("GOOGLE_SHEET_ID");
  if (missing.length > 0) throw new SheetsNotConfiguredError(missing.join(", "));
}

function parseServiceAccountJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // hosts that only support single-line env vars often need the key base64-encoded
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  }
}

async function getSheetsClient() {
  const authOptions = { scopes: ["https://www.googleapis.com/auth/spreadsheets"] };
  if (config.googleServiceAccountKeyJson) {
    authOptions.credentials = parseServiceAccountJson(config.googleServiceAccountKeyJson);
  } else {
    authOptions.keyFile = config.googleServiceAccountKeyPath;
  }
  const auth = new google.auth.GoogleAuth(authOptions);
  return google.sheets({ version: "v4", auth });
}

/**
 * Appends companies as rows to the configured Google Sheet tab.
 * Writes a header row automatically if the sheet/tab is currently empty.
 * Never overwrites existing rows -- always appends.
 */
export async function exportCompaniesToSheet(companies = []) {
  assertConfigured();

  if (!Array.isArray(companies) || companies.length === 0) {
    const error = new Error("At least one company is required to export");
    error.status = 400;
    throw error;
  }

  const sheets = await getSheetsClient();
  const tab = config.googleSheetTabName;
  const spreadsheetId = config.googleSheetId;

  let sheetIsEmpty = true;
  try {
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:A1`,
    });
    sheetIsEmpty = !existing.data.values || existing.data.values.length === 0;
  } catch (err) {
    const error = new Error(
      `Could not read sheet tab "${tab}" -- confirm it exists and is shared with the service account`
    );
    error.status = 502;
    error.details = err.message;
    throw error;
  }

  if (sheetIsEmpty) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [CSV_COLUMNS.map((c) => c.label)] },
    });
  }

  const rows = companies.map((company) => {
    const flat = flattenCompany(company);
    return CSV_COLUMNS.map((c) => flat[c.key] ?? "");
  });

  const appendResult = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  return {
    tab,
    rowsAdded: rows.length,
    updatedRange: appendResult.data.updates?.updatedRange || null,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

export { SheetsNotConfiguredError };
export default { exportCompaniesToSheet };

/**
 * Reads the NPI column from the sheet and returns the set of NPIs
 * already exported by anyone on the team. Used to filter duplicate
 * leads out of future searches.
 */
export async function getClaimedNpis() {
  assertConfigured();

  const sheets = await getSheetsClient();
  const tab = config.googleSheetTabName;
  const npiColumnIndex = CSV_COLUMNS.findIndex((c) => c.key === "npi");
  const colLetter = String.fromCharCode(65 + npiColumnIndex); // "B"

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.googleSheetId,
      range: `${tab}!${colLetter}2:${colLetter}100000`, // skip header row
    });
    const values = res.data.values || [];
    return new Set(values.flat().filter(Boolean).map(String));
  } catch {
    // Tab doesn't exist yet (no exports made) -- nothing is claimed
    return new Set();
  }
}