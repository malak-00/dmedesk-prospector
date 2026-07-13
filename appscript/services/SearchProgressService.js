// Remembers, per user and per distinct set of search filters, exactly how
// far a NPPES scan has gotten -- so a brand-new "Search" click for filters
// you've searched before continues from where you left off instead of
// always re-showing the same top-of-registry results (CompanyService's
// variantSkips/excludeNpis already support "resume from here"; this is just
// what persists that position across searches, browser reloads, and days).
//
// Deliberately independent of SheetsStore/the leads spreadsheet -- this
// never reads or writes anything about claimed/disconnected leads. It lives
// in its own tab, in the same (private, owner-only) spreadsheet as the
// Users/Suggestions tabs when AUTH_SHEET_ID is configured -- same fallback
// rule as SheetsStore.addSuggestion, and for the same reason (per-person
// data shouldn't require a spreadsheet everyone on the team can open).
//
// Only ever consulted for broad searches -- an exact NPI lookup always
// identifies the same single record, so there's nothing meaningful to
// "resume" (callers should skip this for criteria.npi searches).

var SearchProgressService = (function () {
  var TAB_NAME = "SearchProgress";
  var HEADER = ["Username", "Filter Fingerprint", "Variant Skips", "Seen Npis", "Updated At"];

  // A cell in Sheets caps out around 50k characters; NPIs are 10 digits, so
  // even at the max comma-joined length this stays well under that (a few
  // thousand chars), while still remembering enough recent history to keep
  // branch-merge dedup consistent across the seam where a session left off.
  // Oldest NPIs are dropped first once the cap is hit -- the (very unlikely)
  // cost is a long-since-shown company could in theory resurface once the
  // scan has moved on far enough, which is a minor annoyance, not a
  // correctness problem.
  var MAX_SEEN_NPIS = 4000;

  function getSheet_() {
    var spreadsheetId = Config.authSheetId() || Config.googleSheetId();
    if (!spreadsheetId) return null; // no configured spreadsheet at all -- treat as "no persistence available"
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getSheetByName(TAB_NAME);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(TAB_NAME);
      sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
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

  function normalizeList_(list) {
    return (list || [])
      .map(function (v) { return String(v).trim().toLowerCase(); })
      .filter(Boolean)
      .sort();
  }

  // A stable identity for "this exact combination of search filters" --
  // independent of pagination knobs (limit/skip/variantSkips/excludeNpis),
  // independent of array order (checkboxes ticked in a different order
  // still resume the same bookmark), and case-insensitive on free-text
  // fields. Anything that changes the actual NPPES query (a new state
  // added, a keyword typed) naturally produces a different fingerprint --
  // i.e. a fresh bookmark starting at skip 0, which is exactly right: it's
  // a genuinely different search.
  function fingerprint(criteria) {
    criteria = criteria || {};
    var norm = function (v) { return v === undefined || v === null ? "" : String(v).trim().toLowerCase(); };
    var parts = {
      npi: norm(criteria.npi),
      organizationName: norm(criteria.organizationName),
      nameContains: normalizeList_(
        (criteria.nameContainsTerms && criteria.nameContainsTerms.length)
          ? criteria.nameContainsTerms
          : (criteria.nameContains ? [criteria.nameContains] : [])
      ),
      city: norm(criteria.city),
      states: normalizeList_((criteria.states && criteria.states.length) ? criteria.states : [criteria.state]),
      postalCode: norm(criteria.postalCode),
      taxonomies: normalizeList_(
        (criteria.taxonomyDescriptions && criteria.taxonomyDescriptions.length)
          ? criteria.taxonomyDescriptions
          : [criteria.taxonomyDescription]
      ),
      years: normalizeList_(
        (criteria.lastUpdatedYears && criteria.lastUpdatedYears.length)
          ? criteria.lastUpdatedYears
          : [criteria.lastUpdatedYear]
      ),
      excludeKeywords: normalizeList_(criteria.excludeKeywords),
    };
    return JSON.stringify(parts);
  }

  function findRow_(sheet, colMap, username, fp) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return -1;
    var userCol = colIndex_(colMap, "Username");
    var fpCol = colIndex_(colMap, "Filter Fingerprint");
    var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][userCol]) === username && String(values[i][fpCol]) === fp) return i + 2;
    }
    return -1;
  }

  // Returns { variantSkips, seenNpis } for this user's last-known position
  // on this exact filter set, or null if there's no bookmark yet (a brand
  // new search) or persistence isn't configured. Never throws -- a failure
  // here should never break an otherwise-working search.
  function getProgress(username, criteria) {
    if (!username) return null;
    try {
      var sheet = getSheet_();
      if (!sheet) return null;
      var colMap = buildColMap_(sheet);
      var fp = fingerprint(criteria);
      var rowNum = findRow_(sheet, colMap, String(username).toLowerCase(), fp);
      if (rowNum < 0) return null;

      var row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
      var variantSkipsRaw = row[colIndex_(colMap, "Variant Skips")];
      var seenNpisRaw = row[colIndex_(colMap, "Seen Npis")];

      var variantSkips = {};
      try { variantSkips = variantSkipsRaw ? JSON.parse(variantSkipsRaw) : {}; } catch (parseErr) { variantSkips = {}; }
      var seenNpis = seenNpisRaw ? String(seenNpisRaw).split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [];

      return { variantSkips: variantSkips, seenNpis: seenNpis };
    } catch (err) {
      console.log("[SearchProgressService] getProgress failed: " + err.message);
      return null;
    }
  }

  // Upserts this user's bookmark for this filter set. Never throws.
  function saveProgress(username, criteria, variantSkips, seenNpis) {
    if (!username) return;
    try {
      var sheet = getSheet_();
      if (!sheet) return;
      var colMap = buildColMap_(sheet);
      var fp = fingerprint(criteria);
      var normalizedUsername = String(username).toLowerCase();
      var rowNum = findRow_(sheet, colMap, normalizedUsername, fp);
      var cappedSeenNpis = (seenNpis || []).map(String).slice(-MAX_SEEN_NPIS);

      var rowValues = [
        normalizedUsername,
        fp,
        JSON.stringify(variantSkips || {}),
        cappedSeenNpis.join(","),
        new Date().toISOString(),
      ];

      if (rowNum > 0) {
        sheet.getRange(rowNum, 1, 1, rowValues.length).setValues([rowValues]);
      } else {
        sheet.appendRow(rowValues);
      }
    } catch (err) {
      console.log("[SearchProgressService] saveProgress failed: " + err.message);
    }
  }

  return { getProgress: getProgress, saveProgress: saveProgress, fingerprint: fingerprint };
})();
