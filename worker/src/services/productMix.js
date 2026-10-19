// Product mix for one supplier, read live from CMS's public by-supplier-and-service file the first time a
// Prospect card is opened, then kept in the enrichment cache. One small request per lead (about 20 rows).
import * as EnrichmentCache from "../lib/enrichmentCache.js";
import { buildProductMix, buildTrend } from "../lib/productMix.js";

const DATASET_URL = "https://data.cms.gov/data-api/v1/dataset/1746a83e-bb65-4300-8e02-21edbab77c6b/data";
const CACHE_NAMESPACE = "cmsprofile";
// The by-supplier files, one per year (one row per supplier). Newest last.
const TREND_DATASETS = [
  { year: 2022, id: "471f9c0d-12c4-4601-a547-559dcfa2d0e2" },
  { year: 2023, id: "7bb52a09-9eba-43f9-b7ec-57f65fbbc86c" },
  { year: 2024, id: "a2d56d3f-3531-4315-9d87-e29986516b41" },
];
const PAGE = 500; // a supplier has tens of rows; a very large one may have several hundred
const MAX_PAGES = 4;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function fetchRows(npi) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = `${DATASET_URL}?filter[Suplr_NPI]=${encodeURIComponent(npi)}&size=${PAGE}&offset=${page * PAGE}`;
    const response = await fetch(url);
    if (response.status >= 400) throw httpError(502, "CMS did not answer the product lookup.");
    const data = await response.json();
    if (!Array.isArray(data)) throw httpError(502, "CMS sent an unexpected product answer.");
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function fetchYear(dataset, npi) {
  const url = `https://data.cms.gov/data-api/v1/dataset/${dataset.id}/data?filter[Suplr_NPI]=${encodeURIComponent(npi)}&size=1`;
  const response = await fetch(url);
  if (response.status >= 400) throw httpError(502, "CMS did not answer the trend lookup.");
  const data = await response.json();
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  const payment = parseFloat(String(row.Suplr_Mdcr_Pymt_Amt || "").replace(/,/g, ""));
  const patients = parseFloat(String(row.Tot_Suplr_Benes || "").replace(/,/g, ""));
  return { year: dataset.year, payment: Number.isFinite(payment) ? payment : 0, patients: Number.isFinite(patients) ? patients : null };
}

// Returns { mix, trend }: mix is null when CMS has no billing rows for this NPI, trend when it has no yearly
// payments. A failed year is skipped (the trend is then built from the years that answered) and not cached.
export async function getProductMix(supabase, npi) {
  const id = String(npi || "").trim();
  if (!/^\d{10}$/.test(id)) throw httpError(400, "Send a valid 10-digit NPI.");

  const cached = await EnrichmentCache.getMany(supabase, CACHE_NAMESPACE, [id]);
  if (cached.has(id)) return cached.get(id);

  const [rows, ...years] = await Promise.allSettled([fetchRows(id), ...TREND_DATASETS.map((d) => fetchYear(d, id))]);
  if (rows.status === "rejected") throw rows.reason;
  const answered = years.filter((y) => y.status === "fulfilled");
  const result = { mix: buildProductMix(rows.value), trend: buildTrend(answered.map((y) => y.value).filter(Boolean)) };
  if (answered.length === years.length) await EnrichmentCache.putMany(supabase, CACHE_NAMESPACE, [{ npi: id, value: result }]);
  return result;
}
