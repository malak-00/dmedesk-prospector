// SupabaseMirror: Mirrors data from Google Sheets (Claimed - *, Leads, Disconnected tabs)
// directly to Supabase via its REST API (PostgREST endpoint).

var SupabaseMirror = (function () {
  function getHeaders_() {
    var key = Config.supabaseServiceRoleKey() || Config.supabaseAnonKey();
    if (!key) {
      throw new Error("Supabase API Key is missing. Please set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON in Script Properties.");
    }
    return {
      "apikey": key,
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates"
    };
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

  function rowToLeadRecord_(row, colMap, isDisconnected) {
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
      claimed_at: parseDate_(getVal_(row, colMap, "Claimed At")) || new Date().toISOString(),
      status_updated_at: parseDate_(getVal_(row, colMap, "Status Updated At")),
      reminder_at: parseDate_(getVal_(row, colMap, "Reminder At")),
      is_disconnected: !!isDisconnected,
      updated_at: new Date().toISOString()
    };
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
    var endpoint = baseUrl + "/rest/v1/leads?on_conflict=npi";
    var headers = getHeaders_();

    var ss = SpreadsheetApp.openById(sheetId);
    var sheets = ss.getSheets();

    var leadsMap = {};
    var totalProcessedRows = 0;

    sheets.forEach(function (sheet) {
      var tabName = sheet.getName();
      var isClaimedTab = tabName.indexOf("Claimed - ") === 0 || tabName === Config.googleSheetTabName();
      var isDisconnectedTab = tabName === "Disconnected";

      if (!isClaimedTab && !isDisconnectedTab) return;

      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;

      var colMap = buildColMap_(sheet);
      var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

      values.forEach(function (row) {
        totalProcessedRows++;
        var leadRec = rowToLeadRecord_(row, colMap, isDisconnectedTab);
        if (leadRec && leadRec.npi) {
          leadsMap[leadRec.npi] = leadRec;
        }
      });
    });

    var records = Object.keys(leadsMap).map(function (npi) { return leadsMap[npi]; });
    if (records.length === 0) {
      Logger.log("[SupabaseMirror] No lead records found to mirror.");
      return { success: true, count: 0, message: "No valid lead rows found to mirror." };
    }

    var batchSize = 100;
    var syncedCount = 0;

    for (var i = 0; i < records.length; i += batchSize) {
      var batch = records.slice(i, i + batchSize);
      var options = {
        method: "post",
        headers: headers,
        payload: JSON.stringify(batch),
        muteHttpExceptions: true
      };

      var res = UrlFetchApp.fetch(endpoint, options);
      var code = res.getResponseCode();
      if (code < 200 || code >= 300) {
        throw new Error("Supabase API error (" + code + "): " + res.getContentText());
      }
      syncedCount += batch.length;
    }

    Logger.log("[SupabaseMirror] Synced " + syncedCount + " leads to Supabase out of " + totalProcessedRows + " rows scanned.");

    return {
      success: true,
      totalRowsScanned: totalProcessedRows,
      leadsSynced: syncedCount
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
