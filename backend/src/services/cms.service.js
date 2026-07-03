import axios from "axios";

// Medicare DMEPOS claims volume per supplier, from CMS's public data API
// (data.cms.gov, "Medicare Durable Medical Equipment, Devices & Supplies -
// by Supplier" dataset). Free and keyless, like NPPES. A supplier's Medicare
// claim volume is the closest thing to a public revenue signal for DME.
//
// Any failure -- network, missing NPI, schema drift -- degrades to "no
// Medicare data" for that company, never an error.

const DATASET_URL =
  "https://data.cms.gov/data-api/v1/dataset/a2d56d3f-3531-4315-9d87-e29986516b41/data";

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
  return Number.isNaN(n) ? null : n;
}

async function lookupOne(npi) {
  try {
    const res = await axios.get(DATASET_URL, {
      params: { "filter[Suplr_NPI]": String(npi), size: 1 },
      timeout: 10000,
    });
    const rows = res.data;
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

/**
 * Returns a Map of NPI -> medicare data (or null when CMS has nothing for
 * that NPI). Never throws.
 */
export async function lookupByNpis(npis = []) {
  const valid = npis.filter(Boolean).map(String);
  const results = await Promise.all(valid.map(lookupOne));
  return new Map(valid.map((npi, i) => [npi, results[i]]));
}

export default { lookupByNpis };
