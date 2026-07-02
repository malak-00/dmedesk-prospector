// Replaces backend/src/services/sheetsExport.service.js. No service account
// or googleapis needed at all here -- Apps Script talks to Sheets natively
// via SpreadsheetApp, which is a genuine simplification over the Node
// version. Still always appends, never overwrites, same as before.

var SheetsStore = (function () {
  function assertConfigured() {
    if (!Config.googleSheetId()) {
      var err = new Error("Google Sheets export is not configured (missing: GOOGLE_SHEET_ID)");
      err.name = "SheetsNotConfiguredError";
      throw err;
    }
  }

  function getSheet_() {
    var spreadsheet = SpreadsheetApp.openById(Config.googleSheetId());
    var tabName = Config.googleSheetTabName();
    var sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) sheet = spreadsheet.insertSheet(tabName);
    return sheet;
  }

  function exportCompaniesToSheet(companies) {
    assertConfigured();
    companies = companies || [];
    if (!Array.isArray(companies) || companies.length === 0) {
      var error = new Error("At least one company is required to export");
      error.status = 400;
      throw error;
    }

    var sheet = getSheet_();
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(CsvExport.CSV_COLUMNS.map(function (c) { return c.label; }));
    }

    var rows = companies.map(function (company) {
      var flat = CsvExport.flattenCompany(company);
      return CsvExport.CSV_COLUMNS.map(function (c) {
        return flat[c.key] != null ? flat[c.key] : "";
      });
    });

    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, CsvExport.CSV_COLUMNS.length).setValues(rows);

    var lastCol = String.fromCharCode(64 + CsvExport.CSV_COLUMNS.length);
    return {
      tab: Config.googleSheetTabName(),
      rowsAdded: rows.length,
      updatedRange: sheet.getName() + "!A" + startRow + ":" + lastCol + (startRow + rows.length - 1),
      sheetUrl: "https://docs.google.com/spreadsheets/d/" + Config.googleSheetId() + "/edit",
    };
  }

  // Reads the NPI column from the sheet and returns the set of NPIs already
  // exported by anyone on the team, so search results can filter them out.
  function getClaimedNpis() {
    assertConfigured();
    var sheet = getSheet_();

    var npiColIndex = -1;
    for (var i = 0; i < CsvExport.CSV_COLUMNS.length; i++) {
      if (CsvExport.CSV_COLUMNS[i].key === "npi") { npiColIndex = i; break; }
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return new Set(); // header only or empty -- nothing claimed yet

    var values = sheet.getRange(2, npiColIndex + 1, lastRow - 1, 1).getValues();
    var claimed = new Set();
    values.forEach(function (row) {
      var v = row[0];
      if (v !== "" && v !== null && v !== undefined) claimed.add(String(v));
    });
    return claimed;
  }

  return {
    exportCompaniesToSheet: exportCompaniesToSheet,
    getClaimedNpis: getClaimedNpis,
  };
})();
