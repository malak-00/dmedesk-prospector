// Does our own copy of NPPES hold the providers the mirror returns?
//
// The obvious comparison -- take a page from each source and intersect it --
// measures the wrong thing. The two sources page in different orders, so two
// 50-row pages of the same 8,000 matching providers can overlap by nothing
// at all while both are perfectly correct. It also can't tell "we don't have
// this provider" from "we have it and deliberately left it out".
//
// So each provider the mirror returned is looked up by NPI in npi_records
// and put in one of these buckets:
//
//   covered          we have it, and this search would return it
//   deactivated      we have it; NPPES has since deactivated it
//   individual       we have it; it is a person, not an organization
//   differentState   we have it, in a different state than the mirror says
//   differentSpecialty  we have it under a different taxonomy code
//   missing          not in our copy at all
//
// Only `missing` is a gap. The rest are the refresh doing its job, and each
// one is worth reading before a cutover rather than after.
const BUCKETS = ["covered", "deactivated", "individual", "differentState", "differentSpecialty", "missing"];

function upperTrim(value) {
  return String(value == null ? "" : value).trim().toUpperCase();
}

function classify(provider, row, criteria) {
  if (!row) return "missing";
  if (row.deactivation_date) return "deactivated";
  const status = upperTrim(row.status) || "A";
  if (status !== "A" && status !== "ACTIVE") return "deactivated";

  const isOrganization = row.isorganization === null || row.isorganization === undefined
    ? row.enumerationtype !== "NPI-1"
    : row.isorganization !== false;
  if (!isOrganization) return "individual";

  if (criteria.state && upperTrim(row.address_state) !== upperTrim(criteria.state)) return "differentState";
  if (criteria.taxonomyCode && upperTrim(row.taxonomy_code) !== upperTrim(criteria.taxonomyCode)) return "differentSpecialty";
  return "covered";
}

const COLUMNS = "npi, address_state, address_city, taxonomy_code, status, deactivation_date, isorganization, enumerationtype, name";

export async function compareCoverage(supabase, mirrorProviders, criteria = {}) {
  const providers = (mirrorProviders || []).filter((p) => p && p.npi);
  const empty = { checked: 0, coveredPercent: null, counts: {}, samples: {} };
  if (providers.length === 0) return empty;

  const npis = [...new Set(providers.map((p) => String(p.npi)))];
  const { data, error } = await supabase.from("npi_records").select(COLUMNS).in("npi", npis);
  if (error) return Object.assign({}, empty, { checked: npis.length, error: error.message });

  const byNpi = new Map((data || []).map((row) => [String(row.npi), row]));
  const counts = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
  const samples = Object.fromEntries(BUCKETS.map((bucket) => [bucket, []]));

  providers.forEach((provider) => {
    const npi = String(provider.npi);
    const row = byNpi.get(npi);
    const bucket = classify(provider, row, criteria);
    counts[bucket] += 1;
    if (bucket !== "covered" && samples[bucket].length < 10) {
      samples[bucket].push({
        npi,
        name: provider.name || (row && row.name) || "",
        // What the mirror says vs what we hold -- the reason it landed here.
        mirror: [provider.address && provider.address.state, provider.taxonomy && provider.taxonomy.code].filter(Boolean).join(" / "),
        ours: row ? [row.address_state, row.taxonomy_code].filter(Boolean).join(" / ") : "",
      });
    }
  });

  return {
    checked: providers.length,
    coveredPercent: Math.round((counts.covered / providers.length) * 100),
    counts,
    samples,
  };
}
