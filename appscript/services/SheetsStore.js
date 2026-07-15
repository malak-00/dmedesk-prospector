// Replaces backend/src/services/sheetsExport.service.js. No service account
// or googleapis needed -- Apps Script talks to Sheets natively via
// SpreadsheetApp.
//
// LAYOUT: every teammate gets their OWN tab in the leads spreadsheet, named
// "Claimed - <Display Name>" -- created automatically the first time they
// export a lead. This keeps one person's claimed list from being one giant
// shared table everyone scrolls through, while still letting the app
// aggregate across everyone's tabs for search-dedup and the "all claimed
// leads" view. A legacy shared tab (named by GOOGLE_SHEET_TAB_NAME, default
// "Leads") is still READ if it exists, so claims made before this change
// don't disappear -- but nothing new is ever written to it.
//
// Within a tab, rows are always APPENDED, never overwritten; the only
// in-place edits are the Status/Notes columns via updateLeadStatus/addLeadNote.
//
// Everything is keyed by COLUMN LABEL, never by fixed position: on export we
// look up (or append) each column by its header text, so adding a new column
// later never shifts or corrupts rows already in a tab. New columns are
// always appended at the far right.

var SheetsStore = (function () {
  // Full sheet layout for a FRESH tab = lead columns (from CsvExport) then
  // the tracking columns. For an existing tab we only ever append missing
  // labels at the end, so this order only matters the very first time.
  var TRACKING_COLUMNS = [
    { key: "claimedBy", label: "Claimed By" },
    { key: "claimedAt", label: "Claimed At" },
    { key: "status", label: "Status" },
    { key: "statusUpdatedBy", label: "Status Updated By" },
    { key: "statusUpdatedAt", label: "Status Updated At" },
    { key: "notes", label: "Notes" },
    { key: "reminderAt", label: "Reminder At" },
  ];
  // Starting set shown even on a brand-new tab. Not a strict allow-list --
  // teammates can add their own statuses from the app; getKnownStatusesAcrossSheets_()
  // below unions this with whatever's actually been used (across everyone's
  // tabs) so the dropdown (both in the app and each tab's own data
  // validation) stays current.
  var DEFAULT_STATUSES = ["new", "called", "voicemail", "interested", "not interested", "do not call"];
  var MAX_STATUS_LENGTH = 40;

  // Every per-teammate claimed-leads tab starts with this prefix so the
  // store can find "all of them" without a fixed list of names.
  var CLAIMED_TAB_PREFIX = "Claimed - ";

  // A single shared tab (not per-teammate) that checked leads get sent to --
  // from Prospect (never claimed) or moved out of a Claimed tab -- when a
  // rep finds the number's disconnected/dead. Deliberately excluded from
  // allClaimedSheets_() (the active-pipeline list + status dropdown), so a
  // lead sent here disappears from the normal Claimed Leads view, but IS
  // still counted for search-dedup (see allDedupSheets_()) so it doesn't
  // resurface in a future search.
  var DISCONNECTED_TAB_NAME = "Disconnected";

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

  function openSpreadsheet_() {
    return SpreadsheetApp.openById(Config.googleSheetId());
  }

  // Sheet tab names can't contain [ ] * ? : / \ and are capped at 100 chars.
  function claimedTabName_(displayName) {
    var raw = String(displayName || "").trim() || "Unassigned";
    var cleaned = raw.replace(/[\[\]\*\?:\/\\]/g, "-").trim() || "Unassigned";
    var full = CLAIMED_TAB_PREFIX + cleaned;
    return full.length > 100 ? full.slice(0, 100) : full;
  }

  // Gets (or creates) the tab that belongs to one teammate.
  function getUserSheet_(spreadsheet, displayName) {
    var tabName = claimedTabName_(displayName);
    var sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) sheet = spreadsheet.insertSheet(tabName);
    return sheet;
  }

  // Every "Claimed - *" tab, plus the legacy shared tab if it still exists
  // (so claims made before the per-teammate split remain visible).
  function allClaimedSheets_(spreadsheet) {
    var legacyName = Config.googleSheetTabName();
    return spreadsheet.getSheets().filter(function (s) {
      var name = s.getName();
      return name.indexOf(CLAIMED_TAB_PREFIX) === 0 || name === legacyName;
    });
  }

  // Gets (or creates) the single shared Disconnected tab.
  function getDisconnectedSheet_(spreadsheet) {
    var sheet = spreadsheet.getSheetByName(DISCONNECTED_TAB_NAME);
    if (!sheet) sheet = spreadsheet.insertSheet(DISCONNECTED_TAB_NAME);
    return sheet;
  }

  // Every sheet that counts toward "already handled, don't resurface in a
  // fresh search" -- every claimed-leads tab PLUS the shared Disconnected
  // tab. Deliberately separate from allClaimedSheets_() above, which must
  // NOT include Disconnected (see the comment on DISCONNECTED_TAB_NAME).
  function allDedupSheets_(spreadsheet) {
    var sheets = allClaimedSheets_(spreadsheet).slice();
    var disconnected = spreadsheet.getSheetByName(DISCONNECTED_TAB_NAME);
    if (disconnected) sheets.push(disconnected);
    return sheets;
  }

  // 0-based map of header label (lowercased) -> column index for a given sheet.
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

  // Guarantees every expected column exists on this sheet, appending any
  // missing ones at the far right (never moving existing columns). Returns
  // the fresh column map.
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

  // Distinct statuses actually present across EVERY claimed-leads tab,
  // unioned with the defaults -- this is what makes a custom status "stick"
  // as a real option everywhere (app dropdown + each tab's own data
  // validation) once anyone on the team has used it, not just a one-off
  // free-text value scoped to their own tab.
  function getKnownStatusesAcrossSheets_(spreadsheet) {
    var seen = {};
    var known = [];
    DEFAULT_STATUSES.forEach(function (s) { if (!seen[s]) { seen[s] = true; known.push(s); } });

    allClaimedSheets_(spreadsheet).forEach(function (sheet) {
      var colMap = buildColMap_(sheet);
      var statusCol = colIndex_(colMap, "Status");
      var lastRow = sheet.getLastRow();
      if (statusCol < 0 || lastRow < 2) return;
      var values = sheet.getRange(2, statusCol + 1, lastRow - 1, 1).getValues();
      values.forEach(function (row) {
        var s = String(row[0] || "").trim();
        if (s && !seen[s]) { seen[s] = true; known.push(s); }
      });
    });
    return known;
  }

  // Makes the Status column a dropdown (for convenience) on one specific
  // tab, using an already-computed (team-wide) list of known statuses.
  // setAllowInvalid(true) is deliberate: with "reject input" (false), Apps
  // Script itself throws when writing a value that isn't already in the
  // list -- but a brand-new custom status is BY DEFINITION not in the list
  // yet at the moment it's first written, so a strict rule would reject the
  // very feature this supports. This keeps the dropdown as a convenience/
  // suggestion, not a hard constraint.
  function applyStatusValidationTo_(sheet, colMap, knownStatuses) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var statusCol = colIndex_(colMap, "Status");
    if (statusCol < 0) return;
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(knownStatuses, true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, statusCol + 1, lastRow - 1, 1).setDataValidation(rule);
  }

  // Public: the full set of statuses the app should offer in its dropdown.
  function getKnownStatuses() {
    assertConfigured();
    return getKnownStatusesAcrossSheets_(openSpreadsheet_());
  }

  // Shared by exportCompaniesToSheet (per-teammate Claimed tab, status
  // "new") and exportCompaniesToDisconnected (shared Disconnected tab,
  // status "disconnected") -- appends one fresh row per company, filling
  // every tracking column with sensible starting values.
  function appendCompaniesToSheet_(companies, sheet, defaultStatus, actorName) {
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
        if (c.key === "claimedBy") val = actorName || "";
        else if (c.key === "claimedAt") val = now;
        else if (c.key === "status") val = defaultStatus;
        else if (c.key === "statusUpdatedBy" || c.key === "statusUpdatedAt" || c.key === "notes" || c.key === "reminderAt") val = "";
        else val = flat[c.key] != null ? flat[c.key] : "";
        row[ci] = val;
      });
      return row;
    });

    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, width).setValues(rows);
    return { rowsAdded: rows.length, colMap: colMap };
  }

  function exportCompaniesToSheet(companies, claimedBy) {
    assertConfigured();
    companies = companies || [];
    if (!Array.isArray(companies) || companies.length === 0) {
      var error = new Error("At least one company is required to export");
      error.status = 400;
      throw error;
    }

    var spreadsheet = openSpreadsheet_();
    var sheet = getUserSheet_(spreadsheet, claimedBy);
    var result = appendCompaniesToSheet_(companies, sheet, "new", claimedBy);
    var knownStatuses = getKnownStatusesAcrossSheets_(spreadsheet);
    applyStatusValidationTo_(sheet, result.colMap, knownStatuses);

    return {
      tab: sheet.getName(),
      rowsAdded: result.rowsAdded,
      claimedBy: claimedBy || null,
      sheetUrl: "https://docs.google.com/spreadsheets/d/" + Config.googleSheetId() + "/edit#gid=" + sheet.getSheetId(),
    };
  }

  // Sends leads STRAIGHT to the shared Disconnected tab without ever
  // visiting a per-teammate Claimed tab -- used from the Prospect view,
  // where these companies were never claimed in the first place.
  function exportCompaniesToDisconnected(companies, submittedBy) {
    assertConfigured();
    companies = companies || [];
    if (!Array.isArray(companies) || companies.length === 0) {
      var error = new Error("At least one company is required to send to Disconnected");
      error.status = 400;
      throw error;
    }

    var spreadsheet = openSpreadsheet_();
    var sheet = getDisconnectedSheet_(spreadsheet);
    var result = appendCompaniesToSheet_(companies, sheet, "disconnected", submittedBy);

    return {
      tab: sheet.getName(),
      rowsAdded: result.rowsAdded,
      sheetUrl: "https://docs.google.com/spreadsheets/d/" + Config.googleSheetId() + "/edit#gid=" + sheet.getSheetId(),
    };
  }

  // Moves already-claimed leads OUT of wherever they currently live (a
  // teammate's Claimed tab) and INTO the shared Disconnected tab, preserving
  // their existing Notes/Claimed By/Claimed At but overwriting Status to
  // "disconnected" -- used from the Claimed Leads view. Columns are copied
  // by LABEL (not position), since the source and destination tabs' column
  // order can drift independently over time as custom columns get appended.
  function moveClaimedLeadsToDisconnected(npis, movedBy) {
    assertConfigured();
    npis = (npis || []).map(String).filter(Boolean);
    if (npis.length === 0) {
      var error = new Error("At least one NPI is required");
      error.status = 400;
      throw error;
    }

    var spreadsheet = openSpreadsheet_();
    var disconnectedSheet = getDisconnectedSheet_(spreadsheet);
    var disconnectedColMap = ensureColumns_(disconnectedSheet);
    var now = new Date().toISOString();
    var defs = columnDefs_();
    var movedCount = 0;
    var notFound = [];

    npis.forEach(function (npi) {
      // Re-looked-up fresh for EACH npi (not batched upfront) so a deletion
      // from an earlier npi in this same loop can't leave a later npi's
      // remembered row number pointing at the wrong row.
      var matches = findLeadLocations_(spreadsheet, npi);
      if (matches.length === 0) { notFound.push(npi); return; }

      matches
        .sort(function (a, b) { return b.rowNumber - a.rowNumber; }) // delete bottom-up within a sheet
        .forEach(function (m) {
          var sourceColMap = buildColMap_(m.sheet);
          var width = m.sheet.getLastColumn();
          var rowValues = m.sheet.getRange(m.rowNumber, 1, 1, width).getValues()[0];

          var destWidth = disconnectedSheet.getLastColumn();
          var destRow = [];
          for (var i = 0; i < destWidth; i++) destRow.push("");
          defs.forEach(function (c) {
            var srcIdx = colIndex_(sourceColMap, c.label);
            var destIdx = colIndex_(disconnectedColMap, c.label);
            if (srcIdx < 0 || destIdx < 0) return;
            destRow[destIdx] = rowValues[srcIdx];
          });

          var statusIdx = colIndex_(disconnectedColMap, "Status");
          var statusByIdx = colIndex_(disconnectedColMap, "Status Updated By");
          var statusAtIdx = colIndex_(disconnectedColMap, "Status Updated At");
          if (statusIdx >= 0) destRow[statusIdx] = "disconnected";
          if (statusByIdx >= 0) destRow[statusByIdx] = movedBy || "";
          if (statusAtIdx >= 0) destRow[statusAtIdx] = now;

          disconnectedSheet.getRange(disconnectedSheet.getLastRow() + 1, 1, 1, destWidth).setValues([destRow]);
          m.sheet.deleteRow(m.rowNumber);
          movedCount++;
        });
    });

    SpreadsheetApp.flush();
    return { movedCount: movedCount, notFound: notFound };
  }

  // Moves already-claimed leads OUT of wherever they currently live (a
  // teammate's Claimed tab) and drops them entirely -- unlike
  // moveClaimedLeadsToDisconnected above, there's no destination sheet:
  // "Prospect" isn't a stored tab at all, it's just live NPPES search
  // results filtered against getClaimedNpis(). Deleting the row here is the
  // whole feature -- once it's gone, the NPI naturally stops showing up in
  // getClaimedNpis() and the lead resurfaces the next time anyone searches
  // for it, with no separate "un-claim" flag or destination to manage.
  function returnClaimedLeadsToProspect(npis) {
    assertConfigured();
    npis = (npis || []).map(String).filter(Boolean);
    if (npis.length === 0) {
      var error = new Error("At least one NPI is required");
      error.status = 400;
      throw error;
    }

    var spreadsheet = openSpreadsheet_();
    var returnedCount = 0;
    var notFound = [];

    npis.forEach(function (npi) {
      // Re-looked-up fresh for EACH npi (not batched upfront) so a deletion
      // from an earlier npi in this same loop can't leave a later npi's
      // remembered row number pointing at the wrong row.
      var matches = findLeadLocations_(spreadsheet, npi);
      if (matches.length === 0) { notFound.push(npi); return; }

      matches
        .sort(function (a, b) { return b.rowNumber - a.rowNumber; }) // delete bottom-up within a sheet
        .forEach(function (m) {
          m.sheet.deleteRow(m.rowNumber);
          returnedCount++;
        });
    });

    SpreadsheetApp.flush();
    return { returnedCount: returnedCount, notFound: notFound };
  }

  // Reads the NPI column (by label) across every teammate's tab AND the
  // shared Disconnected tab, and returns the set of NPIs already handled by
  // anyone, so search results can filter them out.
  function getClaimedNpis() {
    assertConfigured();
    var spreadsheet = openSpreadsheet_();
    var claimed = new Set();

    allDedupSheets_(spreadsheet).forEach(function (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var colMap = buildColMap_(sheet);
      var npiCol = colIndex_(colMap, "NPI");
      if (npiCol < 0) return;
      var values = sheet.getRange(2, npiCol + 1, lastRow - 1, 1).getValues();
      values.forEach(function (row) {
        var v = row[0];
        if (v !== "" && v !== null && v !== undefined) claimed.add(String(v));
      });
    });
    return claimed;
  }

  // Returns claimed leads (aggregated across every teammate's tab) sorted by
  // most recently updated (Status Updated At, falling back to Claimed At).
  //   opts.claimedBy         -- filter to one person's leads
  //   opts.updatedWithinDays -- only leads touched within the last N days
  //   opts.updatedYear       -- only leads whose last update is in this year
  function listClaimedLeads(opts) {
    assertConfigured();
    opts = opts || {};
    var spreadsheet = openSpreadsheet_();
    var leads = [];

    allClaimedSheets_(spreadsheet).forEach(function (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;

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
        notes: get("Notes"), reminderAt: get("Reminder At"),
      };

      var data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      data.forEach(function (row, i) {
        var pick = function (j) { return j >= 0 && j < row.length ? String(row[j] || "") : ""; };
        var claimedAt = pick(idx.claimedAt);
        var statusUpdatedAt = pick(idx.statusUpdatedAt);
        var lead = {
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
          reminderAt: pick(idx.reminderAt),
        };
        if (lead.npi !== "" || lead.name !== "") leads.push(lead);
      });
    });

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

  // Every row (across every tab) whose NPI matches -- an NPI normally lives
  // in exactly one teammate's tab, but this searches all of them rather than
  // assuming which one, since the caller doesn't know who claimed it.
  function findLeadLocations_(spreadsheet, npi) {
    var matches = [];
    allClaimedSheets_(spreadsheet).forEach(function (sheet) {
      var colMap = buildColMap_(sheet);
      var npiCol = colIndex_(colMap, "NPI");
      var lastRow = sheet.getLastRow();
      if (npiCol < 0 || lastRow < 2) return;
      var npis = sheet.getRange(2, npiCol + 1, lastRow - 1, 1).getValues();
      npis.forEach(function (row, i) {
        if (String(row[0]) === String(npi)) matches.push({ sheet: sheet, rowNumber: i + 2 });
      });
    });
    return matches;
  }

  // Sets the Status columns on every row (in whichever tab it lives in)
  // whose NPI matches. `status` isn't restricted to DEFAULT_STATUSES -- any
  // short, non-empty value is accepted, so teammates can introduce their own
  // statuses from the app.
  function updateLeadStatus(npi, status, updatedBy) {
    assertConfigured();
    if (!npi) {
      var noNpi = new Error("npi is required");
      noNpi.status = 400;
      throw noNpi;
    }
    var trimmedStatus = String(status || "").trim();
    if (!trimmedStatus) {
      var badStatus = new Error("status is required");
      badStatus.status = 400;
      throw badStatus;
    }
    if (trimmedStatus.length > MAX_STATUS_LENGTH) {
      var tooLong = new Error("status must be " + MAX_STATUS_LENGTH + " characters or fewer");
      tooLong.status = 400;
      throw tooLong;
    }
    status = trimmedStatus;

    var spreadsheet = openSpreadsheet_();
    var matches = findLeadLocations_(spreadsheet, npi);
    if (matches.length === 0) {
      var notFound = new Error("No lead with NPI " + npi + " found in the sheet");
      notFound.status = 404;
      throw notFound;
    }

    var now = new Date().toISOString();
    var touchedSheets = {}; // sheet name -> { sheet, colMap }, so validation is applied once per tab

    matches.forEach(function (m) {
      var colMap = ensureColumns_(m.sheet); // guarantees the Status columns exist
      var statusCol = colIndex_(colMap, "Status");
      var byCol = colIndex_(colMap, "Status Updated By");
      var atCol = colIndex_(colMap, "Status Updated At");
      m.sheet.getRange(m.rowNumber, statusCol + 1).setValue(status);
      m.sheet.getRange(m.rowNumber, byCol + 1).setValue(updatedBy || "");
      m.sheet.getRange(m.rowNumber, atCol + 1).setValue(now);
      touchedSheets[m.sheet.getName()] = { sheet: m.sheet, colMap: colMap };
    });

    SpreadsheetApp.flush(); // force the writes to persist before we return
    var knownStatuses = getKnownStatusesAcrossSheets_(spreadsheet);
    Object.keys(touchedSheets).forEach(function (name) {
      applyStatusValidationTo_(touchedSheets[name].sheet, touchedSheets[name].colMap, knownStatuses);
    });

    return { npi: String(npi), status: status, rowsUpdated: matches.length };
  }

  // Prepends a timestamped, attributed entry to the Notes column on every
  // row (in whichever tab it lives in) whose NPI matches -- a running call
  // log rather than a single value that gets overwritten each time, so a rep
  // can see the history of previous calls to this lead, not just the last
  // note left.
  function addLeadNote(npi, noteText, addedBy) {
    assertConfigured();
    if (!npi) {
      var noNpi = new Error("npi is required");
      noNpi.status = 400;
      throw noNpi;
    }
    var trimmedNote = String(noteText || "").trim();
    if (!trimmedNote) {
      var badNote = new Error("note text is required");
      badNote.status = 400;
      throw badNote;
    }

    var spreadsheet = openSpreadsheet_();
    var matches = findLeadLocations_(spreadsheet, npi);
    if (matches.length === 0) {
      var notFound = new Error("No lead with NPI " + npi + " found in the sheet");
      notFound.status = 404;
      throw notFound;
    }

    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
    var entry = stamp + (addedBy ? " — " + addedBy : "") + ": " + trimmedNote;
    var finalNotes = entry;

    matches.forEach(function (m) {
      var colMap = ensureColumns_(m.sheet); // guarantees the Notes column exists
      var notesCol = colIndex_(colMap, "Notes");
      var cell = m.sheet.getRange(m.rowNumber, notesCol + 1);
      var existing = String(cell.getValue() || "").trim();
      finalNotes = existing ? entry + "\n" + existing : entry; // newest entry on top
      cell.setValue(finalNotes);
    });

    SpreadsheetApp.flush(); // force the writes to persist before we return
    return { npi: String(npi), notes: finalNotes, rowsUpdated: matches.length };
  }

  // Overwrites the ENTIRE Notes cell verbatim -- unlike addLeadNote (which
  // only ever prepends), this backs editing/deleting a single call-log
  // entry: the client reconstructs the full newline-joined text (with one
  // line changed or removed) and this just stores exactly that, on every
  // row (in whichever tab it lives in) whose NPI matches. Empty string is
  // valid -- it means "no notes left" after deleting the last entry.
  function replaceLeadNotes(npi, notesText) {
    assertConfigured();
    if (!npi) {
      var noNpi = new Error("npi is required");
      noNpi.status = 400;
      throw noNpi;
    }

    var spreadsheet = openSpreadsheet_();
    var matches = findLeadLocations_(spreadsheet, npi);
    if (matches.length === 0) {
      var notFound = new Error("No lead with NPI " + npi + " found in the sheet");
      notFound.status = 404;
      throw notFound;
    }

    var finalNotes = String(notesText || "");
    matches.forEach(function (m) {
      var colMap = ensureColumns_(m.sheet); // guarantees the Notes column exists
      var notesCol = colIndex_(colMap, "Notes");
      m.sheet.getRange(m.rowNumber, notesCol + 1).setValue(finalNotes);
    });

    SpreadsheetApp.flush(); // force the writes to persist before we return
    return { npi: String(npi), notes: finalNotes, rowsUpdated: matches.length };
  }

  // Sets (or clears, if reminderAt is "") a callback-reminder timestamp on
  // every row (in whichever tab it lives in) whose NPI matches. This is
  // purely a stored value the app surfaces (a badge in the Claimed Leads
  // list, sorted soonest-first) -- there's no email/push delivery, so it
  // only "reminds" someone while they have the app open.
  function setLeadReminder(npi, reminderAt, updatedBy) {
    assertConfigured();
    if (!npi) {
      var noNpi = new Error("npi is required");
      noNpi.status = 400;
      throw noNpi;
    }
    var trimmed = String(reminderAt || "").trim();
    if (trimmed && isNaN(Date.parse(trimmed))) {
      var badDate = new Error("reminderAt must be a valid date/time, or empty to clear it");
      badDate.status = 400;
      throw badDate;
    }

    var spreadsheet = openSpreadsheet_();
    var matches = findLeadLocations_(spreadsheet, npi);
    if (matches.length === 0) {
      var notFound = new Error("No lead with NPI " + npi + " found in the sheet");
      notFound.status = 404;
      throw notFound;
    }

    matches.forEach(function (m) {
      var colMap = ensureColumns_(m.sheet); // guarantees the Reminder At column exists
      var reminderCol = colIndex_(colMap, "Reminder At");
      m.sheet.getRange(m.rowNumber, reminderCol + 1).setValue(trimmed);
    });

    SpreadsheetApp.flush(); // force the writes to persist before we return
    return { npi: String(npi), reminderAt: trimmed, rowsUpdated: matches.length };
  }

  var MAX_SUGGESTION_LENGTH = 2000;
  var SUGGESTION_HEADER_ = ["Timestamp", "Submitted By", "Suggestion"];

  // Suggestions go to the PRIVATE auth spreadsheet (same one holding the
  // Users tab) when AUTH_SHEET_ID is configured, so teammates who all have
  // edit access to the shared leads sheet still can't read each other's
  // feedback -- only the owner (who holds AUTH_SHEET_ID) can. Falls back to
  // a tab in the main leads sheet only if AUTH_SHEET_ID was never set. This
  // means a submitted suggestion normally does NOT show up in the shared
  // Leads sheet at all -- that's by design, not a bug, but it's an easy
  // thing to go looking for in the wrong spreadsheet, hence returning
  // sheetUrl below so the app can link straight to wherever it actually landed.
  function getSuggestionsSheet_() {
    var authSheetId = Config.authSheetId();
    var spreadsheetId = authSheetId || Config.googleSheetId();
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var tabName = Config.suggestionsTabName();
    var sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(tabName);
      sheet.getRange(1, 1, 1, SUGGESTION_HEADER_.length).setValues([SUGGESTION_HEADER_]);
    }
    return { sheet: sheet, spreadsheetId: spreadsheetId };
  }

  // Best-effort only -- a suggestion is already safely logged to the sheet
  // before this runs, so a mail failure (MailApp's daily send quota used up,
  // a transient error, etc.) should never make the submission itself fail.
  function notifySuggestionByEmail_(text, submittedBy, sheetUrl) {
    var to = Config.suggestionNotifyEmail();
    if (!to) return;
    try {
      MailApp.sendEmail({
        to: to,
        subject: "DME Desk Prospector suggestion from " + (submittedBy || "someone"),
        body: (submittedBy || "Someone") + " sent a suggestion:\n\n" + text + "\n\nView all suggestions: " + sheetUrl,
      });
    } catch (err) {
      console.log("[SheetsStore] Suggestion email notification failed: " + err.message);
    }
  }

  // Unlike notifySuggestionByEmail_ above, this DOESN'T swallow failures --
  // it exists purely so the app can surface the real reason mail isn't
  // going out (a missing one-time OAuth grant for MailApp, the daily quota
  // being used up, etc.) instead of that error only ever reaching the Apps
  // Script execution log where nobody using the deployed Web App can see it.
  function testSuggestionEmail() {
    var to = Config.suggestionNotifyEmail();
    if (!to) return { configured: false };

    try {
      MailApp.sendEmail({
        to: to,
        subject: "DME Desk Prospector -- test email",
        body: "If you got this, suggestion emails are working. Sent to: " + to,
      });
      return {
        configured: true,
        sent: true,
        to: to,
        remainingDailyQuota: MailApp.getRemainingDailyQuota(),
      };
    } catch (err) {
      return { configured: true, sent: false, to: to, error: err.message };
    }
  }

  function addSuggestion(text, submittedBy) {
    if (!Config.authSheetId() && !Config.googleSheetId()) {
      var notConfigured = new Error("Suggestions storage is not configured (missing AUTH_SHEET_ID or GOOGLE_SHEET_ID)");
      notConfigured.name = "SheetsNotConfiguredError";
      throw notConfigured;
    }
    var trimmed = String(text || "").trim();
    if (!trimmed) {
      var badText = new Error("suggestion text is required");
      badText.status = 400;
      throw badText;
    }
    if (trimmed.length > MAX_SUGGESTION_LENGTH) {
      var tooLong = new Error("suggestion must be " + MAX_SUGGESTION_LENGTH + " characters or fewer");
      tooLong.status = 400;
      throw tooLong;
    }

    var target = getSuggestionsSheet_();
    var now = new Date().toISOString();
    target.sheet.appendRow([now, submittedBy || "", trimmed]);
    SpreadsheetApp.flush(); // force the write to persist before we return

    var sheetUrl = "https://docs.google.com/spreadsheets/d/" + target.spreadsheetId + "/edit#gid=" + target.sheet.getSheetId();
    notifySuggestionByEmail_(trimmed, submittedBy, sheetUrl);

    return { submittedAt: now, sheetUrl: sheetUrl };
  }

  return {
    exportCompaniesToSheet: exportCompaniesToSheet,
    exportCompaniesToDisconnected: exportCompaniesToDisconnected,
    moveClaimedLeadsToDisconnected: moveClaimedLeadsToDisconnected,
    returnClaimedLeadsToProspect: returnClaimedLeadsToProspect,
    getClaimedNpis: getClaimedNpis,
    listClaimedLeads: listClaimedLeads,
    updateLeadStatus: updateLeadStatus,
    addLeadNote: addLeadNote,
    replaceLeadNotes: replaceLeadNotes,
    setLeadReminder: setLeadReminder,
    getKnownStatuses: getKnownStatuses,
    addSuggestion: addSuggestion,
    testSuggestionEmail: testSuggestionEmail,
    DEFAULT_STATUSES: DEFAULT_STATUSES,
  };
})();
