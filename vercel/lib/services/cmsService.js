// Port of appscript/services/CmsService.js -- Medicare DMEPOS claims volume
// per supplier, from CMS's public data API (data.cms.gov). Free and
// keyless, like NPPES. Any failure -- network, missing NPI, schema drift --
// degrades to "no Medicare data" for that company, never an error.

import { get as cacheGet, put as cachePut } from "./enrichmentCache.js";

const DATASET_URL = "https://data.cms.gov/data-api/v1/dataset/a2d56d3f-3531-4315-9d87-e29986516b41/data";
const CACHE_NAMESPACE = "cms";

// CMS occasionally shifts field casing between data years, so match keys
// case-insensitively instead of hardcoding exact strings.
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

async function fetchOne(npi) {
  const url = `${DATASET_URL}?filter[Suplr_NPI]=${encodeURIComponent(npi)}&size=1`;
  try {
    const response = await fetch(url);
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
  } catch (err) {
    return null;
  }
}

// Returns a plain object mapping NPI -> medicare data (or null when CMS has
// nothing for that NPI). Never throws. `supabase` is a service-role client
// (see enrichmentCache.js). Skips any NPI already cached from a recent
// search, and only fetches the remainder.
export async function lookupByNpis(supabase, npis) {
  const result = {};
  const valid = (npis || []).filter(Boolean).map(String);
  if (valid.length === 0) return result;

  const toFetch = [];
  for (const npi of valid) {
    const cached = await cacheGet(supabase, CACHE_NAMESPACE, npi);
    if (cached !== undefined) result[npi] = cached;
    else toFetch.push(npi);
  }
  if (toFetch.length === 0) return result;

  const data = await Promise.all(toFetch.map(fetchOne));
  await Promise.all(
    toFetch.map(async (npi, i) => {
      result[npi] = data[i];
      await cachePut(supabase, CACHE_NAMESPACE, npi, data[i]);
    })
  );
  return result;
}

export default { lookupByNpis };
