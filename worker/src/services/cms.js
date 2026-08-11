// Port of appscript/services/CmsService.js -- UrlFetchApp.fetchAll ->
// Promise.all(fetch(...)), same free/keyless CMS DMEPOS dataset.
import * as EnrichmentCache from "../lib/enrichmentCache.js";

const DATASET_URL = "https://data.cms.gov/data-api/v1/dataset/a2d56d3f-3531-4315-9d87-e29986516b41/data";
const CACHE_NAMESPACE = "cms";

function findField(row, fieldName) {
  const want = fieldName.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === want) return row[key];
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = parseFloat(String(value).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

async function parseResponse(response) {
  try {
    if (response.status >= 400) return null;
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    return {
      totalClaims: toNumber(findField(row, "Tot_Suplr_Clms")),
      totalServices: toNumber(findField(row, "Tot_Suplr_Srvcs")),
      totalBeneficiaries: toNumber(findField(row, "Tot_Suplr_Benes")),
      medicarePayment: toNumber(findField(row, "Suplr_Mdcr_Pymt_Amt")),
      medicareAllowed: toNumber(findField(row, "Suplr_Mdcr_Alowd_Amt")),
    };
  } catch {
    return null;
  }
}

export async function lookupByNpis(supabase, npis) {
  const result = {};
  const valid = (npis || []).filter(Boolean).map(String);
  if (valid.length === 0) return result;

  const cached = await EnrichmentCache.getMany(supabase, CACHE_NAMESPACE, valid);
  const toFetch = valid.filter((npi) => !cached.has(npi));
  cached.forEach((value, npi) => (result[npi] = value));
  if (toFetch.length === 0) return result;

  let responses;
  try {
    responses = await Promise.all(
      toFetch.map((npi) => fetch(DATASET_URL + "?filter[Suplr_NPI]=" + encodeURIComponent(npi) + "&size=1"))
    );
  } catch (err) {
    console.log("[cms] Medicare lookup failed entirely: " + err.message);
    toFetch.forEach((npi) => (result[npi] = null));
    return result;
  }

  const toCache = [];
  for (let i = 0; i < toFetch.length; i++) {
    const data = await parseResponse(responses[i]);
    result[toFetch[i]] = data;
    toCache.push({ npi: toFetch[i], value: data });
  }
  await EnrichmentCache.putMany(supabase, CACHE_NAMESPACE, toCache);
  return result;
}
