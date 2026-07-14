// Backs the Prospect search form's "Specialty / taxonomy" multiselect from a
// shared "Taxonomies" tab in the main leads spreadsheet, instead of a fixed
// list hardcoded in docs/index.html -- any signed-in teammate can search a
// reference table of NUCC facility-type codes (pasted in once, e.g. from a
// payer's published Facility Type Taxonomy Code crosswalk) and "enable" one,
// making it a real checkbox option for EVERY teammate from then on, not just
// themselves. Same trust model as custom lead statuses elsewhere in this
// app -- no approval step, anyone can add.
//
// Taxonomies tab layout (created by hand, this service never creates the
// tab itself -- only the Enabled column, and only if the tab already
// exists):
//   Facility Type | Code | Description | Enabled
// "Facility Type", "Code", "Description" are expected to already be there
// (found by header label, never a fixed position, same rule as every other
// sheet integration in this app). "Enabled" is auto-created (appended at
// the far right) the first time anyone calls this service, exactly like
// AuthService's Exclude Keywords column.
//
// IMPORTANT: neither Facility Type nor Code is a unique key in this kind of
// reference data -- the same facility type can map to several different
// NUCC codes (e.g. several distinct "Durable Medical Equipment" codes), and
// the same code can appear under different facility-type framings from
// different source standards. Rows are only ever identified by their
// (1-based) ROW NUMBER, never by facilityType/code text.
//
// The Description column -- not Facility Type -- is what actually gets
// submitted as taxonomyDescription (NPPES's own search parameter, which
// matches a provider's registered taxonomy DESCRIPTION text, not a payer's
// friendly facility-type label). Facility Type is only ever the readable
// checkbox label a rep sees. The one exception: the 5 originally-hardcoded
// options predate this Description column and have none -- for those,
// listEnabled() falls back to their Facility Type text, which is already
// the exact string in production use for them.

var TaxonomyService = (function () {
  var TAB_NAME = "Taxonomies";
  var FACILITY_TYPE_LABEL = "Facility Type";
  var CODE_LABEL = "Code";
  var DESCRIPTION_LABEL = "Description";
  var ENABLED_LABEL = "Enabled";
  var MAX_SEARCH_RESULTS = 25;

  // The 5 taxonomy options this app already shipped with, before this
  // sheet-driven system existed -- seeded as already-enabled rows the first
  // time this service ever reads a Taxonomies tab that doesn't already have
  // an Enabled column, so nothing already using the app loses these options.
  // No Code/Description -- these predate the NUCC reference table and their
  // Facility Type text IS the exact search term already in production use;
  // inventing a code for them here would risk it not matching the same real
  // NPPES records their current text already reliably finds.
  var LEGACY_DEFAULTS_ = [
    "Durable Medical Equipment",
    "Oxygen Equipment",
    "Prosthetic/Orthotic",
    "Orthopedic",
    "Prosthetic",
  ];

  function assertConfigured_() {
    if (!Config.googleSheetId()) {
      var err = new Error("Taxonomies storage is not configured (missing GOOGLE_SHEET_ID)");
      err.name = "SheetsNotConfiguredError";
      throw err;
    }
  }

  function getSheet_() {
    assertConfigured_();
    var spreadsheet = SpreadsheetApp.openById(Config.googleSheetId());
    var sheet = spreadsheet.getSheetByName(TAB_NAME);
    if (!sheet) {
      var err = new Error(
        "No \"Taxonomies\" tab found in the leads spreadsheet -- create one with header columns " +
        "\"Facility Type\", \"Code\", \"Description\" first."
      );
      err.name = "SheetsNotConfiguredError";
      throw err;
    }
    return sheet;
  }

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

  function colIndex_(colMap, label) {
    var i = colMap[label.toLowerCase()];
    return i == null ? -1 : i;
  }

  // Guarantees the Enabled column exists, appending it at the far right (as
  // a real header, findable by buildColMap_) if it isn't there yet.
  function ensureEnabledColumn_(sheet) {
    var map = buildColMap_(sheet);
    if (colIndex_(map, ENABLED_LABEL) >= 0) return map;
    var col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col, 1, 1).setValues([[ENABLED_LABEL]]);
    return buildColMap_(sheet);
  }

  function isEnabledValue_(raw) {
    var s = String(raw || "").trim().toLowerCase();
    return s === "true" || s === "yes" || s === "1";
  }

  // Appends the 5 legacy defaults as already-enabled rows, but only the
  // ones not already present (by exact Facility Type text, case-insensitive)
  // -- safe to call every time; a no-op once they've been seeded once.
  function seedLegacyDefaults_(sheet, colMap) {
    var facilityTypeCol = colIndex_(colMap, FACILITY_TYPE_LABEL);
    var enabledCol = colIndex_(colMap, ENABLED_LABEL);
    var lastRow = sheet.getLastRow();

    var existing = {};
    if (lastRow >= 2) {
      var values = sheet.getRange(2, facilityTypeCol + 1, lastRow - 1, 1).getValues();
      values.forEach(function (row) {
        var v = String(row[0] || "").trim().toLowerCase();
        if (v) existing[v] = true;
      });
    }

    var missing = LEGACY_DEFAULTS_.filter(function (name) { return !existing[name.toLowerCase()]; });
    if (missing.length === 0) return;

    var width = sheet.getLastColumn();
    var rows = missing.map(function (name) {
      var row = [];
      for (var i = 0; i < width; i++) row.push("");
      row[facilityTypeCol] = name;
      row[enabledCol] = "TRUE";
      return row;
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
  }

  // Returns every row as { rowNumber, facilityType, code, description, enabled },
  // ensuring the Enabled column exists and the legacy defaults are seeded
  // first. Called by both listEnabled() and search() so either one works
  // correctly even on a Taxonomies tab nobody has touched yet.
  function getAllRows_() {
    var sheet = getSheet_();
    var colMap = ensureEnabledColumn_(sheet);

    var facilityTypeCol = colIndex_(colMap, FACILITY_TYPE_LABEL);
    var codeCol = colIndex_(colMap, CODE_LABEL);
    var descriptionCol = colIndex_(colMap, DESCRIPTION_LABEL);
    if (facilityTypeCol < 0) {
      var err = new Error("The \"Taxonomies\" tab is missing a \"Facility Type\" column");
      err.name = "SheetsNotConfiguredError";
      throw err;
    }

    seedLegacyDefaults_(sheet, colMap);
    colMap = buildColMap_(sheet); // re-read in case seeding just appended rows (column positions unchanged, but be safe)
    var enabledCol = colIndex_(colMap, ENABLED_LABEL);

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var width = sheet.getLastColumn();
    var data = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    var rows = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var facilityType = String(row[facilityTypeCol] || "").trim();
      if (!facilityType) continue;
      rows.push({
        rowNumber: i + 2,
        facilityType: facilityType,
        code: codeCol >= 0 ? String(row[codeCol] || "").trim() : "",
        description: descriptionCol >= 0 ? String(row[descriptionCol] || "").trim() : "",
        enabled: enabledCol >= 0 ? isEnabledValue_(row[enabledCol]) : false,
      });
    }
    return rows;
  }

  // Public: what the Prospect search form's multiselect should show as
  // checkbox options. `facilityType` is the readable label shown next to
  // the checkbox; `description` is the actual value the frontend submits as
  // taxonomyDescription -- NPPES's own search param, which matches against
  // a provider's registered taxonomy DESCRIPTION text, not the friendly
  // "Facility Type" name from a payer's crosswalk. Falls back to
  // facilityType only when description is blank, which is only ever true
  // for the 5 legacy rows seeded before this Description column existed --
  // their Facility Type text IS the exact string already in production use
  // for them, so that fallback preserves their existing, already-correct
  // behavior unchanged.
  function listEnabled() {
    return getAllRows_()
      .filter(function (r) { return r.enabled; })
      .map(function (r) {
        return { rowNumber: r.rowNumber, facilityType: r.facilityType, code: r.code, description: r.description || r.facilityType };
      });
  }

  // Public: keyword search across Facility Type + Code + Description,
  // across EVERY row (enabled or not) -- a rep needs to find and enable
  // ones that aren't active yet, that's the whole point. Case-insensitive
  // substring match, capped so a broad/blank-ish keyword doesn't dump the
  // entire reference table into the UI at once.
  function search(keyword) {
    var term = String(keyword || "").trim().toLowerCase();
    if (!term) return [];

    var matches = getAllRows_().filter(function (r) {
      return (
        r.facilityType.toLowerCase().indexOf(term) !== -1 ||
        r.code.toLowerCase().indexOf(term) !== -1 ||
        r.description.toLowerCase().indexOf(term) !== -1
      );
    });
    return matches.slice(0, MAX_SEARCH_RESULTS);
  }

  // Public: flips one specific row's Enabled cell on, identified by its
  // (1-based) row number -- never by facilityType/code text, since neither
  // is guaranteed unique in this kind of cross-reference data.
  function enable(rowNumber) {
    var n = Number(rowNumber);
    if (!n || n < 2) {
      var badRow = new Error("A valid rowNumber is required");
      badRow.status = 400;
      throw badRow;
    }

    var sheet = getSheet_();
    var colMap = ensureEnabledColumn_(sheet);
    var facilityTypeCol = colIndex_(colMap, FACILITY_TYPE_LABEL);
    var enabledCol = colIndex_(colMap, ENABLED_LABEL);

    if (n > sheet.getLastRow()) {
      var notFound = new Error("No taxonomy row at row " + n);
      notFound.status = 404;
      throw notFound;
    }
    var facilityType = String(sheet.getRange(n, facilityTypeCol + 1).getValue() || "").trim();
    if (!facilityType) {
      var emptyRow = new Error("No taxonomy row at row " + n);
      emptyRow.status = 404;
      throw emptyRow;
    }

    sheet.getRange(n, enabledCol + 1).setValue("TRUE");
    return listEnabled();
  }

  return { listEnabled: listEnabled, search: search, enable: enable };
})();
