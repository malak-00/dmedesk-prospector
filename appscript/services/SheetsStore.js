// Replaces backend/src/services/sheetsExport.service.js. No service account
// or googleapis needed -- Apps Script talks to Sheets natively via
// SpreadsheetApp. Still always appends lead rows, never overwrites them;
// the only in-place edits are the Status columns via updateLeadStatus.
//
// Sheet columns = CsvExport.CSV_COLUMNS followed by TRACKING_COLUMNS
// (Claimed By etc.). Tracking columns are appended at the END on purpose:
// getClaimedNpis computes the NPI column position from CSV_COLUMNS, so
// nothing may shift the earlier columns.

var SheetsStore = (function () {
  var TRACKING_COLUMNS = ["Claimed By", "Claimed At", "Status", "Status Updated By", "Status Updated At"];
  var ALLOWED_STATUSES = ["new", "called", "voicemail", "interested", "not interested", "do not call"];

  function assertConfigured() {
    if (!Config.googleSheetId()) {
      var err = new Error("Google Sheets export is not configured (missing: GOOGLE_SHEET_ID)");
      err.name = "SheetsNotConfiguredError";
      throw err;
    }
  }

  function fullHeader_() {
    return CsvExport.CSV_COLUMNS.map(function (c) { return c.label; }).concat(TRACKING_COLUMNS);
  }

  function getSheet_() {
    var spreadsheet = SpreadsheetApp.openById(Config.googleSheetId());
    var tabName = Config.googleSheetTabName();
    var sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) sheet = spreadsheet.insertSheet(tabName);
    return sheet;
  }

  // Writes the header if the sheet is empty, and extends it in place if it
  // predates newer columns (older rows just have blanks there).
  function ensureHeader_(sheet) {
    var header = fullHeader_();
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(header);
      return;
    }
    var existingWidth = sheet.getLastColumn();
    if (existingWidth < header.length) {
      sheet.getRange(1, 1, 1, header.length).setValues([header]);
    }
  }

  function headerIndex_(sheet, label) {
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < header.length; i++) {
      if (String(header[i]).trim().toLowerCase() === label.toLowerCase()) return i; // 0-based
    }
    return -1;
  }

  // Makes the Status column a real dropdown in the sheet itself, so editing a
  // status directly in Google Sheets offers the same choices as the app.
  function applyStatusValidation_(sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var statusCol = headerIndex_(sheet, "Status");
    if (statusCol < 0) return;
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(ALLOWED_STATUSES, true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, statusCol + 1, lastRow - 1, 1).setDataValidation(rule);
  }

  function exportCompaniesToSheet(companies, claimedBy) {
    assertConfigured();
    companies = companies || [];
    if (!Array.isArray(companies) || companies.length === 0) {
      var error = new Error("At least one company is required to export");
      error.status = 400;
      throw error;
    }

    var sheet = getSheet_();
    ensureHeader_(sheet);

    var now = new Date().toISOString();
    var rows = companies.map(function (company) {
      var flat = CsvExport.flattenCompany(company);
      var base = CsvExport.CSV_COLUMNS.map(function (c) {
        return flat[c.key] != null ? flat[c.key] : "";
      });
      return base.concat([claimedBy || "", now, "new", "", ""]);
    });

    var width = fullHeader_().length;
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, width).setValues(rows);
    applyStatusValidation_(sheet); // keep the sheet's Status dropdown current

    return {
      tab: Config.googleSheetTabName(),
      rowsAdded: rows.length,
      claimedBy: claimedBy || null,
      sheetUrl: "https://docs.google.com/spreadsheets/d/" + Config.googleSheetId() + "/edit",
    };
  }

  // Reads the NPI column and returns the set of NPIs already exported by
  // anyone on the team, so search results can filter them out.
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

  // Returns claimed leads for the tracking view, sorted by most recently
  // updated (Status Updated At, falling back to Claimed At).
  //   opts.claimedBy       -- filter to one person's leads
  //   opts.updatedWithinDays -- only leads touched within the last N days
  function listClaimedLeads(opts) {
    assertConfigured();
    opts = opts || {};
    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).trim().toLowerCase(); });
    var col = function (label) { return header.indexOf(label.toLowerCase()); };

    var idx = {
      name: col("Company Name"), npi: col("NPI"),
      city: col("City"), state: col("State"),
      contactName: col("Contact Name"), contactTitle: col("Contact Title"),
      contactPhone: col("Contact Phone"), companyPhone: col("Phone"),
      claimedBy: col("Claimed By"), claimedAt: col("Claimed At"),
      status: col("Status"), statusUpdatedAt: col("Status Updated At"),
    };

    var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    var leads = data.map(function (row, i) {
      var pick = function (j) { return j >= 0 && j < row.length ? String(row[j] || "") : ""; };
      var claimedAt = pick(idx.claimedAt);
      var statusUpdatedAt = pick(idx.statusUpdatedAt);
      return {
        rowNumber: i + 2,
        name: pick(idx.name),
        npi: pick(idx.npi),
        city: pick(idx.city),
        state: pick(idx.state),
        contactName: pick(idx.contactName),
        contactTitle: pick(idx.contactTitle),
        contactPhone: pick(idx.contactPhone),
        companyPhone: pick(idx.companyPhone),
        claimedBy: pick(idx.claimedBy),
        claimedAt: claimedAt,
        status: pick(idx.status) || "new",
        statusUpdatedAt: statusUpdatedAt,
        // effective "last updated" = latest status change, else when claimed
        lastUpdated: statusUpdatedAt || claimedAt,
      };
    }).filter(function (lead) { return lead.npi !== "" || lead.name !== ""; });

    if (opts.claimedBy) {
      var who = String(opts.claimedBy).toLowerCase();
      leads = leads.filter(function (lead) { return lead.claimedBy.toLowerCase() === who; });
    }

    if (opts.updatedWithinDays) {
      var days = Number(opts.updatedWithinDays);
      if (!isNaN(days) && days > 0) {
        var cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        leads = leads.filter(function (lead) {
          var t = Date.parse(lead.lastUpdated);
          return !isNaN(t) && t >= cutoff;
        });
      }
    }

    // Most recently updated first (undated rows sink to the bottom).
    leads.sort(function (a, b) {
      var ta = Date.parse(a.lastUpdated) || 0;
      var tb = Date.parse(b.lastUpdated) || 0;
      return tb - ta;
    });

    return leads;
  }

  // Sets the Status columns on every row whose NPI matches. Rows exported
  // before the tracking columns existed get them filled in on first update.
  function updateLeadStatus(npi, status, updatedBy) {
    assertConfigured();
    if (!npi) {
      var noNpi = new Error("npi is required");
      noNpi.status = 400;
      throw noNpi;
    }
    if (ALLOWED_STATUSES.indexOf(String(status)) === -1) {
      var badStatus = new Error("status must be one of: " + ALLOWED_STATUSES.join(", "));
      badStatus.status = 400;
      throw badStatus;
    }

    var sheet = getSheet_();
    ensureHeader_(sheet); // guarantees the Status columns exist
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      var empty = new Error("No leads in the sheet yet");
      empty.status = 404;
      throw empty;
    }

    var npiCol = headerIndex_(sheet, "NPI");
    var statusCol = headerIndex_(sheet, "Status");
    var byCol = headerIndex_(sheet, "Status Updated By");
    var atCol = headerIndex_(sheet, "Status Updated At");

    var npis = sheet.getRange(2, npiCol + 1, lastRow - 1, 1).getValues();
    var now = new Date().toISOString();
    var updated = 0;

    for (var i = 0; i < npis.length; i++) {
      if (String(npis[i][0]) === String(npi)) {
        var rowNumber = i + 2;
        sheet.getRange(rowNumber, statusCol + 1).setValue(status);
        sheet.getRange(rowNumber, byCol + 1).setValue(updatedBy || "");
        sheet.getRange(rowNumber, atCol + 1).setValue(now);
        updated++;
      }
    }

    if (updated === 0) {
      var notFound = new Error("No lead with NPI " + npi + " found in the sheet");
      notFound.status = 404;
      throw notFound;
    }

    SpreadsheetApp.flush(); // force the write to persist before we return
    applyStatusValidation_(sheet); // keep the dropdown on any newly-tracked rows
    return { npi: String(npi), status: status, rowsUpdated: updated };
  }

  return {
    exportCompaniesToSheet: exportCompaniesToSheet,
    getClaimedNpis: getClaimedNpis,
    listClaimedLeads: listClaimedLeads,
    updateLeadStatus: updateLeadStatus,
    ALLOWED_STATUSES: ALLOWED_STATUSES,
  };
})();
