// Which copy of NPPES a search reads from.
//
// "mirror" is the fakeNPI project over HTTP (services/nppes.js) -- how this
// has always worked. "dmedesk" is this project's own npi_records
// (services/providerSearch.js, sql/018), refreshed monthly by
// scripts/nppes_ingest. Both take the same criteria and return the same
// { count, rawCount, results } shape, so callers don't branch.
//
// It is one env var (NPI_SOURCE) rather than a code change, so the cutover
// can be made -- and undone -- from the Cloudflare dashboard in the time it
// takes to reload the page, with no deploy. Anything unrecognised means the
// mirror: a typo in a variable must not take search down.
import * as Nppes from "./nppes.js";
import * as ProviderSearch from "./providerSearch.js";

export const MIRROR = "mirror";
export const DME_DESK = "dmedesk";

export function resolveSource(config) {
  // A config without the setting at all (an older deploy, a test stub) is
  // the mirror, not a crash: search failing closed over a missing variable
  // would be the worst possible outcome of adding a switch.
  const configured = config && typeof config.npiSource === "function" ? config.npiSource() : MIRROR;
  return String(configured || MIRROR).trim().toLowerCase() === DME_DESK ? DME_DESK : MIRROR;
}

export async function searchProviders(config, supabase, criteria = {}) {
  return resolveSource(config) === DME_DESK
    ? ProviderSearch.searchProviders(supabase, criteria)
    : Nppes.searchProviders(config, criteria);
}
