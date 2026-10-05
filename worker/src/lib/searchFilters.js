// The search options added after the original filters (quality filters,
// sorting, free-text and phone lookup) and the helpers around them: reading
// them from a request, turning criteria into the payload sql/021 expects,
// suggesting which filter to drop when a search comes up empty, and the
// one-click "quick picks". No I/O here, so it is unit tested on its own.
import { WEIGHTS } from "./scoring.js";

export const SORT_OPTIONS = ["score", "medicare", "updated", "name"];

const truthy = (value) => value === true || value === "true" || value === "on" || value === "1";
const digits = (value) => String(value ?? "").replace(/\D/g, "");

// Only the keys a request actually carries come back, so spreading the result
// into a criteria object never overwrites anything with `undefined`.
export function readAdvancedCriteria(q) {
  const out = {};
  if (truthy(q("hasPhone"))) out.hasPhone = true;
  if (truthy(q("hasDecisionMaker"))) out.hasDecisionMaker = true;
  if (truthy(q("activeMedicare"))) out.activeMedicare = true;

  const minScore = Math.round(Number(q("minScore")));
  if (Number.isFinite(minScore) && minScore > 0) out.minScore = Math.min(minScore, 100);

  const zip = digits(q("zip"));
  if (zip.length >= 3) out.zip = zip.slice(0, 5);

  const sortBy = String(q("sortBy") || "").toLowerCase();
  if (SORT_OPTIONS.includes(sortBy)) out.sortBy = sortBy;

  // Free text: a business name or its owner's name. A comma would be read as
  // a list separator elsewhere, and % / _ are wildcards in a LIKE pattern.
  const text = String(q("lookupText") || "").replace(/[,%_]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  if (text) out.lookupText = text;

  const phone = digits(q("lookupPhone"));
  if (phone.length >= 10) out.lookupPhone = phone.slice(-10);

  return out;
}

// Does this search need sql/021's search_providers_v2?
export function usesAdvancedSearch(criteria = {}) {
  return Boolean(
    criteria.hasPhone || criteria.hasDecisionMaker || criteria.activeMedicare || criteria.minScore ||
    criteria.zip || criteria.sortBy || criteria.lookupText || criteria.lookupPhone
  );
}

// A lookup finds one business wherever it is: no paging memory, no fan-out.
export function isLookup(criteria = {}) {
  return Boolean(criteria.npi || criteria.lookupText || criteria.lookupPhone);
}

const compact = (list) => [...new Set((list || []).map((v) => String(v ?? "").trim()).filter(Boolean))];
const terms = (list, single) => {
  const cleaned = compact(Array.isArray(list) && list.length ? list : single ? [single] : []);
  return cleaned.length ? cleaned : undefined;
};

// criteria -> the jsonb sql/021's functions read. `collapsed` sends the whole
// list of states and specialties in one query (what insights and the sorted
// search want); otherwise it sends the single state/specialty of one
// fan-out variant, as search_providers always has.
export function toFilterPayload(criteria = {}, { collapsed = false } = {}) {
  const claims = criteria.minMedicareClaims;
  const payload = {
    npi: criteria.npi ? String(criteria.npi).trim() : undefined,
    phone: criteria.lookupPhone || undefined,
    q: criteria.lookupText || undefined,
    city: criteria.city || undefined,
    organizationName: criteria.organizationName || undefined,
    nameContains: terms(criteria.nameContainsTerms, criteria.nameContains),
    excludeKeywords: terms(criteria.excludeKeywords),
    lastUpdatedYears: terms(criteria.lastUpdatedYears, criteria.lastUpdatedYear),
    hasPhone: criteria.hasPhone || undefined,
    hasDecisionMaker: criteria.hasDecisionMaker || undefined,
    activeMedicare: criteria.activeMedicare || undefined,
    minScore: criteria.minScore || undefined,
    zip: criteria.zip || undefined,
    minMedicareClaims: claims != null && claims !== "" && Number.isFinite(Number(claims)) && Number(claims) > 0 ? Number(claims) : undefined,
    sortBy: criteria.sortBy || undefined,
    // The weights live in lib/scoring.js; the database only does the sums.
    scoreWeights: criteria.minScore || criteria.sortBy ? WEIGHTS : undefined,
  };
  if (collapsed) {
    payload.states = terms(criteria.states, criteria.state);
    payload.taxonomyCodes = terms(criteria.taxonomyCodes, criteria.taxonomyCode);
  } else {
    payload.state = criteria.state || undefined;
    payload.taxonomyCode = criteria.taxonomyCode || undefined;
  }
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
  return payload;
}

// Each way to loosen a search, in the order they are worth trying. Exclude
// keywords are deliberately not offered: they are a rep's saved default, and
// a one-click suggestion should never wipe it.
const RELAXATIONS = [
  { key: "minScore", active: (c) => c.minScore > 0, label: (c) => `Lower the minimum fit score (now ${c.minScore}%)`, drop: { minScore: undefined } },
  { key: "hasPhone", active: (c) => c.hasPhone, label: () => "Don't require a phone number", drop: { hasPhone: undefined } },
  { key: "hasDecisionMaker", active: (c) => c.hasDecisionMaker, label: () => "Don't require a decision maker on file", drop: { hasDecisionMaker: undefined } },
  { key: "activeMedicare", active: (c) => c.activeMedicare, label: () => "Include providers with no Medicare activity", drop: { activeMedicare: undefined } },
  { key: "minMedicareClaims", active: (c) => Number(c.minMedicareClaims) > 0, label: () => "Remove the Medicare claims minimum", drop: { minMedicareClaims: undefined } },
  { key: "zip", active: (c) => c.zip, label: (c) => `Remove the ZIP filter (${c.zip})`, drop: { zip: undefined } },
  { key: "lastUpdatedYears", active: (c) => (c.lastUpdatedYears && c.lastUpdatedYears.length) || c.lastUpdatedYear, label: () => "Remove the \"last updated\" year filter", drop: { lastUpdatedYears: [], lastUpdatedYear: undefined } },
  { key: "city", active: (c) => c.city, label: (c) => `Search the whole state instead of just ${c.city}`, drop: { city: undefined } },
  { key: "nameContains", active: (c) => (c.nameContainsTerms && c.nameContainsTerms.length) || c.nameContains, label: () => "Remove the company-name filter", drop: { nameContainsTerms: [], nameContains: undefined } },
  { key: "taxonomy", active: (c) => (c.taxonomyCodes && c.taxonomyCodes.length) || c.taxonomyCode, label: () => "Include every specialty", drop: { taxonomyCodes: [], taxonomyCode: undefined, taxonomyDescriptions: [], taxonomyDescription: undefined } },
];

// The loosened versions of `criteria`, one per filter that is actually set.
export function relaxedVariants(criteria = {}) {
  return RELAXATIONS
    .filter((r) => r.active(criteria))
    .map((r) => ({ key: r.key, label: r.label(criteria), criteria: { ...criteria, ...r.drop } }));
}

// One-click shortcuts. `patch` is what the form applies (the form's own
// field names); `criteria` is the same thing for counting.
export function quickPickDefinitions(now = new Date()) {
  const year = String(now.getFullYear());
  return [
    { id: "high-fit", label: "High fit (75%+)", patch: { minScore: 75 }, criteria: { minScore: 75 } },
    { id: "medicare", label: "Active Medicare billers", patch: { activeMedicare: true }, criteria: { activeMedicare: true } },
    { id: "reachable", label: "Phone and owner on file", patch: { hasPhone: true, hasDecisionMaker: true }, criteria: { hasPhone: true, hasDecisionMaker: true } },
    { id: "fresh", label: `Updated in ${year}`, patch: { lastUpdatedYears: [year] }, criteria: { lastUpdatedYears: [year] } },
  ];
}

// The location and specialty part of a search, without any quality or sort
// options: the base that quick picks are counted on top of.
export function baseLocationCriteria(criteria = {}) {
  return {
    states: criteria.states, state: criteria.state, city: criteria.city,
    taxonomyCodes: criteria.taxonomyCodes, taxonomyCode: criteria.taxonomyCode,
  };
}
