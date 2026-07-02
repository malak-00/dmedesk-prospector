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
  if (!config.googleServiceAccountKeyPath) missing.push("GOOGLE_SERVICE_ACCOUNT_KEY_PATH");
  if (!config.googleSheetId) missing.push("GOOGLE_SHEET_ID");
  if (missing.length > 0) throw new SheetsNotConfiguredError(missing.join(", "));
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: config.googleServiceAccountKeyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
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