// Product mix for one supplier, read live from CMS's public by-supplier-and-service file the first time a
// Prospect card is opened, then kept in the enrichment cache. One small request per lead (about 20 rows).
import * as EnrichmentCache from "../lib/enrichmentCache.js";
import { buildProductMix } from "../lib/productMix.js";

const DATASET_URL = "https://data.cms.gov/data-api/v1/dataset/1746a83e-bb65-4300-8e02-21edbab77c6b/data";
const CACHE_NAMESPACE = "cmsmix";
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

// Returns { mix } where mix is null when CMS has no billing rows for this NPI.
export async function getProductMix(supabase, npi) {
  const id = String(npi || "").trim();
  if (!/^\d{10}$/.test(id)) throw httpError(400, "Send a valid 10-digit NPI.");

  const cached = await EnrichmentCache.getMany(supabase, CACHE_NAMESPACE, [id]);
  if (cached.has(id)) return { mix: cached.get(id) };

  const mix = buildProductMix(await fetchRows(id));
  await EnrichmentCache.putMany(supabase, CACHE_NAMESPACE, [{ npi: id, value: mix }]);
  return { mix };
}
