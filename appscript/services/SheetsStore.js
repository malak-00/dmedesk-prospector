// Replaces backend/src/services/sheetsExport.service.js. No service account
// or googleapis needed -- Apps Script talks to Sheets natively via
// SpreadsheetApp. Always APPENDS lead rows, never overwrites; the only
// in-place edits are the Status columns via updateLeadStatus.
//
// Everything is keyed by COLUMN LABEL, never by fixed position: on export we
// look up (or append) each column by its header text, so adding a new column
// later never shifts or corrupts rows already in the sheet. New columns are
// always appended at the far right.

var SheetsStore = (function () {
  // Full sheet layout for a FRESH sheet = lead columns (from CsvExport) then
  // the tracking columns. For an existing sheet we only ever append missing
  // labels at the end, so this order only matters the very first time.
  var TRACKING_COLUMNS = [
    { key: "claimedBy", label: "Claimed By" },
    { key: "claimedAt", label: "Claimed At" },
    { key: "status", label: "Status" },
    { key: "statusUpdatedBy", label: "Status Updated By" },
    { key: "statusUpdatedAt", label: "Status Updated At" },
    { key: "notes", label: "Notes" },
  ];
  var ALLOWED_STATUSES = ["new", "called", "voicemail", "interested", "not interested", "do not call"];

  function columnDefs_() {
    return CsvExport.CSV_COLUMNS.concat(TRACKING_COLUMNS);
  }

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

  // 0-based map of header label (lowercased) -> column index for the current sheet.
  function buildColMap_(sheet) {
    var map = {};
    if (sheet.getLastColumn() === 0) return map;
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < header.length; i++) {
      var label = String(header[i]).trim().toLowerCase();
      if (label) map[label] = i;
    }
    return map;
  }

  // Guarantees every expected column exists, appending any missing ones at the
  // far right (never moving existing columns). Returns the fresh column map.
  function ensureColumns_(sheet) {
    var expected = columnDefs_().map(function (c) { return c.label; });

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      return buildColMap_(sheet);
    }

    var map = buildColMap_(sheet);
    var missing = expected.filter(function (label) { return map[label.toLowerCase()] == null; });
    if (missing.length) {
      var startCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
      map = buildColMap_(sheet);
    }
    return map;
  }

  function colIndex_(colMap, label) {
    var i = colMap[label.toLowerCase()];
    return i == null ? -1 : i;
  }

  // Makes the Status column a real dropdown in the sheet itself.
  function applyStatusValidation_(sheet, colMap) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var statusCol = colIndex_(colMap, "Status");
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
    var colMap = ensureColumns_(sheet);
    var width = sheet.getLastColumn();
    var now = new Date().toISOString();
    var defs = columnDefs_();

    var rows = companies.map(function (company) {
      var flat = CsvExport.flattenCompany(company);
      var row = [];
      for (var i = 0; i < width; i++) row.push(""); // width-filled, label-placed below
      defs.forEach(function (c) {
        var ci = colIndex_(colMap, c.label);
        if (ci < 0) return;
        var val;
        if (c.key === "claimedBy") val = claimedBy || "";
        else if (c.key === "claimedAt") val = now;
        else if (c.key === "status") val = "new";
        else if (c.key === "statusUpdatedBy" || c.key === "statusUpdatedAt" || c.key === "notes") val = "";
        else val = flat[c.key] != null ? flat[c.key] : "";
        row[ci] = val;
      });
      return row;
    });

    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, width).setValues(rows);
    applyStatusValidation_(sheet, colMap);

    return {
      tab: Config.googleSheetTabName(),
      rowsAdded: rows.length,
      claimedBy: claimedBy || null,
      sheetUrl: "https://docs.google.com/spreadsheets/d/" + Config.googleSheetId() + "/edit",
    };
  }

  // Reads the NPI column (by label) and returns the set of NPIs already
  // exported by anyone on the team, so search results can filter them out.
  function getClaimedNpis() {
    assertConfigured();
    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return new Set();

    var colMap = buildColMap_(sheet);
    var npiCol = colIndex_(colMap, "NPI");
    if (npiCol < 0) return new Set();

    var values = sheet.getRange(2, npiCol + 1, lastRow - 1, 1).getValues();
    var claimed = new Set();
    values.forEach(function (row) {
      var v = row[0];
      if (v !== "" && v !== null && v !== undefined) claimed.add(String(v));
    });
    return claimed;
  }

  // Returns claimed leads sorted by most recently updated (Status Updated At,
  // falling back to Claimed At).
  //   opts.claimedBy         -- filter to one person's leads
  //   opts.updatedWithinDays -- only leads touched within the last N days
  //   opts.updatedYear       -- only leads whose last update is in this year
  function listClaimedLeads(opts) {
    assertConfigured();
    opts = opts || {};
    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var colMap = buildColMap_(sheet);
    var get = function (label) { return colIndex_(colMap, label); };

    var idx = {
      name: get("Company Name"), npi: get("NPI"),
      addressLine1: get("Address"), city: get("City"), state: get("State"), postalCode: get("Postal Code"),
      taxonomy: get("Specialty"), website: get("Website"), email: get("Email"), fax: get("Fax"),
      contactName: get("Contact Name"), contactTitle: get("Contact Title"),
      contactRole: get("Contact Role"), contactSource: get("Contact Source"),
      additionalContacts: get("Additional Contacts Found"),
      contactPhone: get("Contact Phone"), companyPhone: get("Phone"),
      rating: get("Rating"), scoreValue: get("Score"), scorePercentage: get("Score %"),
      sources: get("Data Sources"),
      medicareClaims: get("Medicare Claims"), medicareBeneficiaries: get("Medicare Beneficiaries"),
      medicarePayment: get("Medicare Payment $"), nppesLastUpdated: get("NPPES Last Updated"),
      claimedBy: get("Claimed By"), claimedAt: get("Claimed At"),
      status: get("Status"), statusUpdatedAt: get("Status Updated At"),
      notes: get("Notes"),
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
        addressLine1: pick(idx.addressLine1),
        city: pick(idx.city),
        state: pick(idx.state),
        postalCode: pick(idx.postalCode),
        taxonomy: pick(idx.taxonomy),
        website: pick(idx.website),
        email: pick(idx.email),
        fax: pick(idx.fax),
        contactName: pick(idx.contactName),
        contactTitle: pick(idx.contactTitle),
        contactRole: pick(idx.contactRole),
        contactSource: pick(idx.contactSource),
        additionalContacts: pick(idx.additionalContacts),
        contactPhone: pick(idx.contactPhone),
        companyPhone: pick(idx.companyPhone),
        rating: pick(idx.rating),
        scoreValue: pick(idx.scoreValue),
        scorePercentage: pick(idx.scorePercentage),
        sources: pick(idx.sources),
        medicareClaims: pick(idx.medicareClaims),
        medicareBeneficiaries: pick(idx.medicareBeneficiaries),
        medicarePayment: pick(idx.medicarePayment),
        nppesLastUpdated: pick(idx.nppesLastUpdated),
        claimedBy: pick(idx.claimedBy),
        claimedAt: claimedAt,
        status: pick(idx.status) || "new",
        statusUpdatedAt: statusUpdatedAt,
        lastUpdated: statusUpdatedAt || claimedAt,
        notes: pick(idx.notes),
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

    if (opts.updatedYear) {
      var yr = String(opts.updatedYear);
      leads = leads.filter(function (lead) {
        var d = new Date(lead.lastUpdated);
        return !isNaN(d.getTime()) && String(d.getFullYear()) === yr;
      });
    }

    leads.sort(function (a, b) {
      var ta = Date.parse(a.lastUpdated) || 0;
      var tb = Date.parse(b.lastUpdated) || 0;
      return tb - ta;
    });

    return leads;
  }

  // Sets the Status columns on every row whose NPI matches.
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
    var colMap = ensureColumns_(sheet); // guarantees the Status columns exist
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      var empty = new Error("No leads in the sheet yet");
      empty.status = 404;
      throw empty;
    }

    var npiCol = colIndex_(colMap, "NPI");
    var statusCol = colIndex_(colMap, "Status");
    var byCol = colIndex_(colMap, "Status Updated By");
    var atCol = colIndex_(colMap, "Status Updated At");

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
    applyStatusValidation_(sheet, colMap);
    return { npi: String(npi), status: status, rowsUpdated: updated };
  }

  // Sets the Notes column on every row whose NPI matches -- freeform text,
  // no allowed-value list (unlike Status). An empty string clears the note.
  function updateLeadNotes(npi, notes) {
    assertConfigured();
    if (!npi) {
      var noNpi = new Error("npi is required");
      noNpi.status = 400;
      throw noNpi;
    }

    var sheet = getSheet_();
    var colMap = ensureColumns_(sheet); // guarantees the Notes column exists
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      var empty = new Error("No leads in the sheet yet");
      empty.status = 404;
      throw empty;
    }

    var npiCol = colIndex_(colMap, "NPI");
    var notesCol = colIndex_(colMap, "Notes");

    var npis = sheet.getRange(2, npiCol + 1, lastRow - 1, 1).getValues();
    var updated = 0;

    for (var i = 0; i < npis.length; i++) {
      if (String(npis[i][0]) === String(npi)) {
        sheet.getRange(i + 2, notesCol + 1).setValue(notes || "");
        updated++;
      }
    }

    if (updated === 0) {
      var notFound = new Error("No lead with NPI " + npi + " found in the sheet");
      notFound.status = 404;
      throw notFound;
    }

    SpreadsheetApp.flush(); // force the write to persist before we return
    return { npi: String(npi), notes: notes || "", rowsUpdated: updated };
  }

  return {
    exportCompaniesToSheet: exportCompaniesToSheet,
    getClaimedNpis: getClaimedNpis,
    listClaimedLeads: listClaimedLeads,
    updateLeadStatus: updateLeadStatus,
    updateLeadNotes: updateLeadNotes,
    ALLOWED_STATUSES: ALLOWED_STATUSES,
  };
})();
