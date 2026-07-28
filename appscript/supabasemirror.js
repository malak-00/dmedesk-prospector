// SupabaseMirror: Mirrors data from Google Sheets (Claimed - *, Leads, Disconnected tabs)
// directly to Supabase via its REST API (PostgREST endpoint).

var SupabaseMirror = (function () {
  // Hardcoded map of known signed-in team members (auth.users / app_users UUIDs)
  var KNOWN_TEAM_USERS = {
    "selene myles": "1d94e105-c38c-4eb6-b268-d168fab3956b",
    "selene": "1d94e105-c38c-4eb6-b268-d168fab3956b",
    "selene.myles.wiz@gmail.com": "1d94e105-c38c-4eb6-b268-d168fab3956b",

    "jimmy pearson": "1e4caf69-6980-4b87-afa2-fbf581d2ce0b",
    "jimmy": "1e4caf69-6980-4b87-afa2-fbf581d2ce0b",
    "jimmy.pearson.wiz@gmail.com": "1e4caf69-6980-4b87-afa2-fbf581d2ce0b",

    "nora atkins": "31c72db1-258a-448e-9e54-f5857bbbe7fe",
    "nora": "31c72db1-258a-448e-9e54-f5857bbbe7fe",
    "nora.atkins.wiz@gmail.com": "31c72db1-258a-448e-9e54-f5857bbbe7fe",

    "rick nelson": "5130545c-ce38-4599-a302-ebc617c14457",
    "rick": "5130545c-ce38-4599-a302-ebc617c14457",
    "rickk.nelson.wiz@gmail.com": "5130545c-ce38-4599-a302-ebc617c14457",

    "kaity james": "7dbfbc63-1bfe-49f2-816f-5696d4a6e9b1",
    "kaity": "7dbfbc63-1bfe-49f2-816f-5696d4a6e9b1",
    "kaity.james.wiz@gmail.com": "7dbfbc63-1bfe-49f2-816f-5696d4a6e9b1",

    "jasmine green": "8a961d7c-2fe4-443d-8566-b1bd12c0cc02",
    "jasmine": "8a961d7c-2fe4-443d-8566-b1bd12c0cc02",
    "jasmine.green.wiz@gmail.com": "8a961d7c-2fe4-443d-8566-b1bd12c0cc02",

    "ben arthur": "acc67fc0-6963-4c3a-8a33-06722e0c6fe4",
    "ben": "acc67fc0-6963-4c3a-8a33-06722e0c6fe4",
    "ben.arthur.wiz@gmail.com": "acc67fc0-6963-4c3a-8a33-06722e0c6fe4",

    "caroline richards": "c4e38805-970b-4cde-a03d-585cc0778872",
    "caroline": "c4e38805-970b-4cde-a03d-585cc0778872",
    "caroline.richards.wiz@gmail.com": "c4e38805-970b-4cde-a03d-585cc0778872"
  };

  function getHeaders_() {
    var key = Config.supabaseServiceRoleKey() || Config.supabaseAnonKey();
    if (!key) {
      throw new Error(
        "Supabase Key is missing. Please set SUPABASE_SERVICE_ROLE_KEY in Script Properties " +
        "(Project Settings > Script Properties in Apps Script editor)."
      );
    }
    var headers = {
      "apikey": key,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates"
    };

    // Include Authorization header for legacy JWT keys (starting with 'eyJ').
    // New secret keys ('sb_secret_...') must NOT include the Authorization header per Supabase spec.
    if (key.indexOf("eyJ") === 0) {
      headers["Authorization"] = "Bearer " + key;
    }

    return headers;
  }

  function parseNumeric_(val) {
    if (val === null || val === undefined || val === "") return null;
    var num = Number(val);
    return isNaN(num) ? null : num;
  }

  function parseDate_(val) {
    if (!val) return null;
    if (val instanceof Date) return val.toISOString();
    var d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function buildColMap_(sheet) {
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return {};
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var colMap = {};
    headers.forEach(function (h, idx) {
      if (h) colMap[String(h).trim().toLowerCase()] = idx;
    });
    return colMap;
  }

  function getVal_(row, colMap, key) {
    var idx = colMap[key.toLowerCase()];
    if (idx === undefined || idx < 0 || idx >= row.length) return "";
    var val = row[idx];
    return val === null || val === undefined ? "" : val;
  }

  function resolveUserId_(rawName, userMap) {
    if (!rawName) return null;
    var trimmed = String(rawName).trim().toLowerCase();
    if (!trimmed) return null;

    if (userMap[trimmed]) return userMap[trimmed];
    if (KNOWN_TEAM_USERS[trimmed]) return KNOWN_TEAM_USERS[trimmed];

    var firstWord = trimmed.split(/\s+/)[0];
    if (firstWord) {
      if (userMap[firstWord]) return userMap[firstWord];
      if (KNOWN_TEAM_USERS[firstWord]) return KNOWN_TEAM_USERS[firstWord];
    }

    return null;
  }

  function rowToLeadRecord_(row, colMap, isDisconnected, defaultClaimedBy, userMap, unresolvedNames) {
    var npi = String(getVal_(row, colMap, "NPI")).trim();
    if (!npi) return null;

    var rating = parseNumeric_(getVal_(row, colMap, "Rating"));
    var scoreValue = parseNumeric_(getVal_(row, colMap, "Score"));
    var scorePercentage = parseNumeric_(getVal_(row, colMap, "Score %"));
    var medicareClaims = parseNumeric_(getVal_(row, colMap, "Medicare Claims"));
    var medicareBeneficiaries = parseNumeric_(getVal_(row, colMap, "Medicare Beneficiaries"));
    var medicarePayment = parseNumeric_(getVal_(row, colMap, "Medicare Payment $"));

    var nppesUpdated = getVal_(row, colMap, "NPPES Last Updated");
    var formattedNppesDate = null;
    if (nppesUpdated) {
      var d = new Date(nppesUpdated);
      if (!isNaN(d.getTime())) {
        formattedNppesDate = d.toISOString().split("T")[0];
      }
    }

    var status = String(getVal_(row, colMap, "Status")).trim().toLowerCase() || "new";

    // Resolve claimed_by text -> app_users.id UUID. A row whose "Claimed By"
    // doesn't resolve to a known user is skipped entirely rather than
    // mirrored with claimed_by = null: Postgres unique constraints never
    // treat two NULLs as conflicting, so a null-claimed_by row would never
    // dedup against itself and would re-insert as a brand new row on every
    // run of this time-driven trigger (this is exactly how one bad "Claimed
    // By" cell produced 188 duplicate rows of the same lead over two days).
    var claimedByText = String(getVal_(row, colMap, "Claimed By")).trim() || defaultClaimedBy || "";
    var claimedByUuid = resolveUserId_(claimedByText, userMap);
    if (!claimedByUuid) {
      if (unresolvedNames && claimedByText) unresolvedNames[claimedByText] = true;
      return null;
    }

    // Resolve status_updated_by text -> app_users.id UUID if present
    var statusUpdatedByText = String(getVal_(row, colMap, "Status Updated By")).trim();
    var statusUpdatedByUuid = resolveUserId_(statusUpdatedByText, userMap);

    return {
      npi: npi,
      company_name: String(getVal_(row, colMap, "Company Name")).trim() || null,
      phone: String(getVal_(row, colMap, "Phone")).trim() || null,
      website: String(getVal_(row, colMap, "Website")).trim() || null,
      email: String(getVal_(row, colMap, "Email")).trim() || null,
      address_line1: String(getVal_(row, colMap, "Address")).trim() || null,
      city: String(getVal_(row, colMap, "City")).trim() || null,
      state: String(getVal_(row, colMap, "State")).trim() || null,
      postal_code: String(getVal_(row, colMap, "Postal Code")).trim() || null,
      specialty: String(getVal_(row, colMap, "Specialty")).trim() || null,
      contact_name: String(getVal_(row, colMap, "Contact Name")).trim() || null,
      contact_title: String(getVal_(row, colMap, "Contact Title")).trim() || null,
      contact_role: String(getVal_(row, colMap, "Contact Role")).trim() || null,
      contact_source: String(getVal_(row, colMap, "Contact Source")).trim() || null,
      contact_phone: String(getVal_(row, colMap, "Contact Phone")).trim() || null,
      additional_contacts_found: String(getVal_(row, colMap, "Additional Contacts Found")).trim() || null,
      rating: rating,
      score_value: scoreValue,
      score_percentage: scorePercentage,
      data_sources: String(getVal_(row, colMap, "Data Sources")).trim() || null,
      medicare_claims: medicareClaims,
      medicare_beneficiaries: medicareBeneficiaries,
      medicare_payment: medicarePayment,
      nppes_last_updated: formattedNppesDate,
      status: status,
      notes: String(getVal_(row, colMap, "Notes")).trim() || null,
      claimed_by: claimedByUuid,
      status_updated_by: statusUpdatedByUuid,
      claimed_at: parseDate_(getVal_(row, colMap, "Claimed At")) || new Date().toISOString(),
      status_updated_at: parseDate_(getVal_(row, colMap, "Status Updated At")),
      reminder_at: parseDate_(getVal_(row, colMap, "Reminder At")),
      is_disconnected: !!isDisconnected,
      updated_at: new Date().toISOString()
    };
  }

  function fetchUserMappings_(baseUrl, headers) {
    var getUrl = baseUrl + "/rest/v1/app_users?select=id,username,display_name";
    var options = {
      method: "get",
      headers: headers,
      muteHttpExceptions: true
    };
    var userMap = {};
    try {
      var res = UrlFetchApp.fetch(getUrl, options);
      if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
        var items = JSON.parse(res.getContentText());
        if (Array.isArray(items)) {
          items.forEach(function (item) {
            if (!item || !item.id) return;
            var uid = item.id;
            if (item.username) {
              userMap[String(item.username).trim().toLowerCase()] = uid;
            }
            if (item.display_name) {
              var dn = String(item.display_name).trim().toLowerCase();
              userMap[dn] = uid;
              var parts = dn.split(/\s+/);
              if (parts.length > 0 && parts[0]) {
                userMap[parts[0]] = uid;
              }
            }
          });
        }
      }
    } catch (e) {
      Logger.log("[SupabaseMirror] Could not pre-fetch app_users mapping: " + e.message);
    }
    return userMap;
  }

  // Reads every existing (npi, claimed_by, is_disconnected) triple so the
  // mirror can decide insert-vs-update itself instead of relying on
  // PostgREST's on_conflict= upsert. on_conflict only works against a plain
  // (unpartitioned) unique index on exactly those columns; leads now has
  // idx_leads_npi_claimed_by_active, a *partial* unique index (WHERE NOT
  // is_disconnected), which PostgREST/Postgres can't target via on_conflict
  // at all -- every upsert through that endpoint now fails outright with
  // "no unique or exclusion constraint matching the ON CONFLICT
  // specification". The partial index intentionally allows the same
  // (npi, claimed_by) pair to exist twice -- once disconnected, once active
  // -- which a single on_conflict target can't express anyway.
  function fetchExistingLeadKeys_(baseUrl, headers) {
    var getUrl = baseUrl + "/rest/v1/leads?select=id,npi,claimed_by,is_disconnected";
    var options = { method: "get", headers: headers, muteHttpExceptions: true };
    var res = UrlFetchApp.fetch(getUrl, options);
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
      throw new Error("Failed to fetch existing leads (" + res.getResponseCode() + "): " + res.getContentText());
    }
    var rows = JSON.parse(res.getContentText());
    var keyMap = {};
    rows.forEach(function (r) {
      keyMap[r.npi + ":" + (r.claimed_by || "null") + ":" + r.is_disconnected] = r.id;
    });
    return keyMap;
  }

  function mirrorLeadsToSupabase() {
    var sheetId = Config.googleSheetId();
    if (!sheetId) {
      throw new Error("GOOGLE_SHEET_ID is not configured in Script Properties.");
    }

    var baseUrl = Config.supabaseUrl();
    if (!baseUrl) {
      throw new Error("SUPABASE_URL is not configured in Script Properties.");
    }
    baseUrl = baseUrl.replace(/\/+$/, "");
    var headers = getHeaders_();

    // Fetch user mappings for claimed_by / status_updated_by UUID resolution
    var userMap = fetchUserMappings_(baseUrl, headers);
    var existingKeys = fetchExistingLeadKeys_(baseUrl, headers);

    var insertEndpoint = baseUrl + "/rest/v1/leads";

    var ss = SpreadsheetApp.openById(sheetId);
    var sheets = ss.getSheets();

    var leadsMap = {};
    var totalProcessedRows = 0;
    var unresolvedNames = {};

    sheets.forEach(function (sheet) {
      var tabName = sheet.getName();
      var isClaimedTab = tabName.indexOf("Claimed - ") === 0 || tabName === Config.googleSheetTabName();
      var isDisconnectedTab = tabName === "Disconnected";

      if (!isClaimedTab && !isDisconnectedTab) return;

      var defaultClaimedBy = "";
      if (tabName.indexOf("Claimed - ") === 0) {
        defaultClaimedBy = tabName.substring("Claimed - ".length).trim();
      }

      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;

      var colMap = buildColMap_(sheet);
      var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

      values.forEach(function (row) {
        totalProcessedRows++;
        var leadRec = rowToLeadRecord_(row, colMap, isDisconnectedTab, defaultClaimedBy, userMap, unresolvedNames);
        if (leadRec && leadRec.npi) {
          var compositeKey = leadRec.npi + ":" + leadRec.claimed_by + ":" + leadRec.is_disconnected;
          leadsMap[compositeKey] = leadRec;
        }
      });
    });

    var unresolvedList = Object.keys(unresolvedNames);
    if (unresolvedList.length > 0) {
      Logger.log("[SupabaseMirror] Skipped rows for unresolvable \"Claimed By\" names: " + unresolvedList.join(", "));
    }

    var entries = Object.keys(leadsMap).map(function (k) { return { key: k, record: leadsMap[k] }; });
    if (entries.length === 0) {
      Logger.log("[SupabaseMirror] No lead records found to mirror.");
      return { success: true, count: 0, message: "No valid lead rows found to mirror.", skippedUnresolvedNames: unresolvedList };
    }

    var toInsert = [];
    var toUpdate = [];
    entries.forEach(function (entry) {
      var existingId = existingKeys[entry.key];
      if (existingId) {
        toUpdate.push({ id: existingId, record: entry.record });
      } else {
        toInsert.push(entry.record);
      }
    });

    var batchSize = 100;
    var insertedCount = 0;
    var insertHeaders = {};
    for (var h in headers) insertHeaders[h] = headers[h];
    insertHeaders["Prefer"] = "return=minimal";

    for (var i = 0; i < toInsert.length; i += batchSize) {
      var batch = toInsert.slice(i, i + batchSize);
      var options = {
        method: "post",
        headers: insertHeaders,
        payload: JSON.stringify(batch),
        muteHttpExceptions: true
      };

      var res = UrlFetchApp.fetch(insertEndpoint, options);
      var code = res.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error("Supabase API error inserting leads (" + code + "): " + res.getContentText());
      }
      insertedCount += batch.length;
    }

    // Existing rows are matched by id and PATCHed individually -- there's no
    // single conflict target that covers both the active-claim case (unique
    // per npi+claimed_by) and the disconnected case (intentionally
    // non-unique, so a fresh disconnect should update the same tracked row
    // rather than pile up a new one every 15-minute run).
    var updatedCount = 0;
    toUpdate.forEach(function (entry) {
      var patchUrl = baseUrl + "/rest/v1/leads?id=eq." + encodeURIComponent(entry.id);
      var options = {
        method: "patch",
        headers: insertHeaders,
        payload: JSON.stringify(entry.record),
        muteHttpExceptions: true
      };
      var res = UrlFetchApp.fetch(patchUrl, options);
      var code = res.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error("Supabase API error updating lead " + entry.id + " (" + code + "): " + res.getContentText());
      }
      updatedCount++;
    });

    Logger.log(
      "[SupabaseMirror] Synced " + (insertedCount + updatedCount) + " leads (" + insertedCount + " inserted, " +
      updatedCount + " updated) out of " + totalProcessedRows + " rows scanned. Skipped " +
      unresolvedList.length + " unresolvable name(s)."
    );

    return {
      success: true,
      totalRowsScanned: totalProcessedRows,
      leadsInserted: insertedCount,
      leadsUpdated: updatedCount,
      skippedUnresolvedNames: unresolvedList
    };
  }

  return {
    mirrorLeadsToSupabase: mirrorLeadsToSupabase
  };
})();

// Global launcher function for manual runs or time-driven triggers
function triggerSupabaseMirror() {
  return SupabaseMirror.mirrorLeadsToSupabase();
}