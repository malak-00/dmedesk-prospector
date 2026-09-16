const WORD_RE = /[^a-z0-9]+/g;
const PHONE_RE = /\d/g;
const FUZZY_NAME_THRESHOLD = 88;

// Normalization here must stay in step with the SQL helpers in
// sql/008_identity_match_tiers.sql so keys computed in JS and in the database agree.

const valueOf = (value) => String(value ?? '').trim();

// Periods and apostrophes are dropped (not turned into spaces) so "L.L.C." -> "llc" and "Mary's" -> "marys".
export const normalizeText = (value) => valueOf(value)
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/['.]/g, '')
  .replace(WORD_RE, ' ')
  .trim();

export const normalizeState = (value) => normalizeText(value).replace(/\s+/g, '').toUpperCase();

// A leading US country code is dropped; NANP area codes never start with 1.
export const firstTenDigitPhone = (value) => {
  const digits = valueOf(value).match(PHONE_RE)?.join('') ?? '';
  return digits.match(/^1?(\d{10})/)?.[1] ?? '';
};

export const normalizeNpi = (value) => {
  const npi = valueOf(value).replace(/\D/g, '');
  return /^\d{10}$/.test(npi) ? npi : '';
};

// Legal-entity suffixes are stripped from organization names in every tier.
const ENTITY_SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'pc', 'pllc', 'lp', 'llp']);

export const stripEntitySuffixes = (value) => normalizeText(value)
  .split(' ')
  .filter((token) => token && !ENTITY_SUFFIXES.has(token))
  .join(' ');

// First + last name only. Middle names are never used, and single-letter tokens
// (a middle initial typed into the first-name field, "Jane M") are dropped.
const officialName = (candidate) => normalizeText([
  candidate.authorizedofficial_firstname ?? candidate.authorizedOfficialFirstName,
  candidate.authorizedofficial_lastname ?? candidate.authorizedOfficialLastName,
].filter(Boolean).join(' '))
  .split(' ')
  .filter((token) => token.length > 1)
  .join(' ');

const candidateName = (candidate) => candidate.name ?? candidate.organization_name ?? candidate.organizationName;

// Practice-location phone first; the authorized official's phone only when the location phone is unusable.
const candidatePhone = (candidate) => firstTenDigitPhone(candidate.phone)
  || firstTenDigitPhone(candidate.authorizedofficial_phone ?? candidate.authorizedOfficialPhone);

export const identitySignals = (candidate) => ({
  name: stripEntitySuffixes(candidateName(candidate)),
  state: normalizeState(candidate.address_state ?? candidate.addressState ?? candidate.state),
  official: officialName(candidate),
  phone: candidatePhone(candidate),
});

// Auto-group key. Tier 1 (all four keys) is a subset of Tier 2's name + official + phone,
// so one key without state covers both auto-group tiers.
export const identityKey = (candidate) => {
  const { name, official, phone } = identitySignals(candidate);
  if (!name || !official || !phone) return `singleton:${normalizeNpi(candidate.npi)}`;
  return `group:${[name, official, phone].join('|')}`;
};

const longestCommonSubsequence = (a, b) => {
  let previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return previous[b.length];
};

// Equivalent to RapidFuzz fuzz.token_sort_ratio: sort tokens, then indel-normalized ratio (0-100).
export const tokenSimilarity = (left, right) => {
  const a = normalizeText(left).split(' ').sort().join(' ');
  const b = normalizeText(right).split(' ').sort().join(' ');
  if (!a || !b) return 0;
  if (a === b) return 100;
  return Math.round((2 * longestCommonSubsequence(a, b) / (a.length + b.length)) * 100);
};

export const nameSimilarity = (left, right) => tokenSimilarity(stripEntitySuffixes(left), stripEntitySuffixes(right));

// Checked in order; the first rule whose keys all match wins.
export const MATCH_RULES = [
  { tier: 1, keys: ['name', 'state', 'official', 'phone'], action: 'auto_group' },
  { tier: 2, keys: ['name', 'official', 'phone'], action: 'auto_group' },
  { tier: 2, keys: ['name', 'state', 'phone'], action: 'review' },
  { tier: 2, keys: ['name', 'state', 'official'], action: 'review' },
  { tier: 2, keys: ['state', 'official', 'phone'], action: 'review' },
  { tier: 3, keys: ['official', 'phone'], action: 'review' },
  { tier: 3, keys: ['name', 'phone'], action: 'review' },
  { tier: 3, keys: ['name', 'official'], action: 'review' },
];

// Compares two records. A fuzzy (not exact) name can satisfy a rule's name key,
// but then the match is only ever flagged for review, never auto-grouped.
export const matchRecords = (left, right) => {
  const a = identitySignals(left);
  const b = identitySignals(right);
  const exact = {
    name: Boolean(a.name) && a.name === b.name,
    state: Boolean(a.state) && a.state === b.state,
    official: Boolean(a.official) && a.official === b.official,
    phone: Boolean(a.phone) && a.phone === b.phone,
  };
  const similarity = exact.name ? 100 : nameSimilarity(candidateName(left), candidateName(right));
  const fuzzyName = !exact.name && similarity >= FUZZY_NAME_THRESHOLD;
  const matched = { ...exact, name: exact.name || fuzzyName };
  const rule = MATCH_RULES.find((candidateRule) => candidateRule.keys.every((key) => matched[key]));
  if (!rule) return null;
  const usesFuzzyName = fuzzyName && rule.keys.includes('name');
  return {
    tier: rule.tier,
    action: usesFuzzyName ? 'review' : rule.action,
    matchedKeys: rule.keys,
    nameMatch: rule.keys.includes('name') ? (usesFuzzyName ? 'fuzzy' : 'exact') : null,
    similarity,
  };
};

// Every rule needs an exact official or phone, or a name (exact, or fuzzy alongside
// official/phone), so records sharing no official, phone, or exact name can be skipped.
const buildMatchIndex = (records) => {
  const index = { name: new Map(), official: new Map(), phone: new Map() };
  for (const record of records) {
    const signals = identitySignals(record);
    for (const key of Object.keys(index)) {
      if (!signals[key]) continue;
      if (!index[key].has(signals[key])) index[key].set(signals[key], []);
      index[key].get(signals[key]).push(record);
    }
  }
  return index;
};

export const findMatches = (candidate, records, index = buildMatchIndex(records)) => {
  const npi = normalizeNpi(candidate.npi);
  const signals = identitySignals(candidate);
  const pool = new Set(Object.keys(index).flatMap((key) => (signals[key] ? index[key].get(signals[key]) ?? [] : [])));
  const matches = [];
  for (const existing of pool) {
    const existingNpi = normalizeNpi(existing.npi);
    if (npi && npi === existingNpi) continue;
    const match = matchRecords(candidate, existing);
    if (match) matches.push({ existingNpi, ...match });
  }
  return matches.sort((left, right) => left.tier - right.tier || left.existingNpi.localeCompare(right.existingNpi));
};

export const preflightCandidates = (candidates, context = {}) => {
  const existingRecords = context.existingRecords ?? [];
  const recordIndex = buildMatchIndex(existingRecords);
  const existingLeads = new Map((context.existingLeads ?? []).map((lead) => [normalizeNpi(lead.npi), lead]));
  const groups = new Map((context.groups ?? []).map((group) => [group.id, group]));
  const memberships = new Map((context.memberships ?? []).map((member) => [normalizeNpi(member.npi), member]));
  const groupOf = (npi) => memberships.get(npi)?.group_id ?? null;
  const seen = new Set();
  return candidates.map((candidate) => {
    const npi = normalizeNpi(candidate.npi);
    if (!npi) return { npi: valueOf(candidate.npi), decision: 'invalid', reasons: ['invalid_npi'] };
    if (seen.has(npi)) return { npi, decision: 'duplicate', reasons: ['duplicate_in_batch'] };
    seen.add(npi);
    if (existingLeads.has(npi)) return { npi, decision: 'duplicate', reasons: ['lead_already_exists'] };

    const matches = findMatches(candidate, existingRecords, recordIndex);
    const autoMatch = matches.find((match) => match.action === 'auto_group' && groupOf(match.existingNpi));
    const groupId = groupOf(npi) ?? (autoMatch ? groupOf(autoMatch.existingNpi) : null);
    const key = identityKey(candidate);

    const owners = groups.get(groupId)?.active_owners ?? [];
    if (owners.length > 0) {
      return { npi, decision: 'owned_conflict', identityKey: key, groupId, owners, reasons: ['group_has_active_owner'], match: autoMatch ?? null };
    }

    const reviews = matches
      .filter((match) => match.action === 'review')
      .map((match) => ({ ...match, groupId: groupOf(match.existingNpi), owners: groups.get(groupOf(match.existingNpi))?.active_owners ?? [] }));
    if (reviews.length > 0) {
      return { npi, decision: 'needs_review', identityKey: key, groupId, reasons: ['possible_duplicate'], reviews };
    }

    return { npi, decision: 'accept', identityKey: key, groupId };
  });
};

export const summarizePreflight = (results) => results.reduce((summary, result) => ({
  ...summary,
  total: summary.total + 1,
  [result.decision]: (summary[result.decision] ?? 0) + 1,
}), { total: 0 });
