// Medicare DMEPOS claims volume per supplier, from CMS's public data API
// (data.cms.gov, "Medicare Durable Medical Equipment, Devices & Supplies -
// by Supplier" dataset). Free and keyless, like NPPES. A supplier's Medicare
// claim volume is the closest thing to a public revenue signal for DME --
// used to prioritize which leads are worth calling first.
//
// All lookups run in parallel via UrlFetchApp.fetchAll (one request per
// NPI). Any failure -- network, missing NPI in the dataset, schema drift --
// degrades to "no Medicare data" for that company, never an error.

var CmsService = (function () {
  var DATASET_URL = "https://data.cms.gov/data-api/v1/dataset/a2d56d3f-3531-4315-9d87-e29986516b41/data";

  // CMS occasionally shifts field casing between data years, so match keys
  // case-insensitively instead of hardcoding exact strings.
  function findField_(row, fieldName) {
    var want = fieldName.toLowerCase();
    for (var key in row) {
      if (key.toLowerCase() === want) return row[key];
    }
    return null;
  }

  function toNumber_(value) {
    if (value === null || value === undefined || value === "") return null;
    var n = parseFloat(String(value).replace(/,/g, ""));
    return isNaN(n) ? null : n;
  }

  function parseResponse_(response) {
    try {
      if (response.getResponseCode() >= 400) return null;
      var rows = JSON.parse(response.getContentText());
      if (!Array.isArray(rows) || rows.length === 0) return null;
      var row = rows[0];
      return {
        totalClaims: toNumber_(findField_(row, "Tot_Suplr_Clms")),
        totalServices: toNumber_(findField_(row, "Tot_Suplr_Srvcs")),
        totalBeneficiaries: toNumber_(findField_(row, "Tot_Suplr_Benes")),
        medicarePayment: toNumber_(findField_(row, "Suplr_Mdcr_Pymt_Amt")),
        medicareAllowed: toNumber_(findField_(row, "Suplr_Mdcr_Alowd_Amt")),
      };
    } catch (err) {
      return null;
    }
  }

  // Returns a plain object mapping NPI -> medicare data (or null when CMS
  // has nothing for that NPI). Never throws.
  function lookupByNpis(npis) {
    var result = {};
    var valid = (npis || []).filter(Boolean).map(String);
    if (valid.length === 0) return result;

    var requests = valid.map(function (npi) {
      return {
        url: DATASET_URL + "?filter[Suplr_NPI]=" + encodeURIComponent(npi) + "&size=1",
        muteHttpExceptions: true,
      };
    });

    var responses;
    try {
      responses = UrlFetchApp.fetchAll(requests);
    } catch (err) {
      console.log("[CmsService] Medicare lookup failed entirely: " + err.message);
      valid.forEach(function (npi) { result[npi] = null; });
      return result;
    }

    for (var i = 0; i < valid.length; i++) {
      result[valid[i]] = parseResponse_(responses[i]);
    }
    return result;
  }

  return { lookupByNpis: lookupByNpis };
})();
