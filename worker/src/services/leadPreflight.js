const WORD_RE = /[^a-z0-9]+/g;
const PHONE_RE = /\d/g;
const REVIEW_THRESHOLD = 88;

const valueOf = (value) => String(value ?? '').trim();

export const normalizeText = (value) => valueOf(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(WORD_RE, ' ')
  .trim();

export const normalizeState = (value) => normalizeText(value).replace(/\s+/g, '').toUpperCase();

export const firstTenDigitPhone = (value) => {
  const digits = valueOf(value).match(PHONE_RE)?.join('') ?? '';
  return digits.length >= 10 ? digits.slice(0, 10) : '';
};

export const normalizeNpi = (value) => {
  const npi = valueOf(value).replace(/\D/g, '');
  return /^\d{10}$/.test(npi) ? npi : '';
};

const officialName = (candidate) => normalizeText([
  candidate.authorizedofficial_firstname,
  candidate.authorizedofficial_lastname,
  candidate.authorizedOfficialFirstName,
  candidate.authorizedOfficialLastName,
].filter(Boolean).join(' '));

const candidateName = (candidate) => candidate.name ?? candidate.organization_name ?? candidate.organizationName;

export const identitySignals = (candidate) => ({
  name: normalizeText(candidateName(candidate)),
  state: normalizeState(candidate.address_state ?? candidate.addressState ?? candidate.state),
  official: officialName(candidate),
  phone: firstTenDigitPhone(candidate.phone ?? candidate.authorizedofficial_phone ?? candidate.authorizedOfficialPhone),
});

export const strictIdentityKey = (candidate) => {
  const signals = identitySignals(candidate);
  if (!signals.name || !signals.state || !signals.official || !signals.phone) return `singleton:${normalizeNpi(candidate.npi)}`;
  return [signals.name, signals.state, signals.official, signals.phone].join('|');
};

const trigrams = (value) => new Set([...`  ${value}  `.match(/.{1,3}/g) ?? []]);

export const tokenSimilarity = (left, right) => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const tokenIntersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const tokenScore = (2 * tokenIntersection / (aTokens.size + bTokens.size)) * 100;
  const aTri = trigrams(a);
  const bTri = trigrams(b);
  const triIntersection = [...aTri].filter((token) => bTri.has(token)).length;
  const triScore = (2 * triIntersection / (aTri.size + bTri.size)) * 100;
  return Math.round(Math.max(tokenScore, triScore));
};

const corroboratingSignals = (candidate, existing) => {
  const left = identitySignals(candidate);
  const right = identitySignals(existing);
  const matches = [];
  if (left.phone && left.phone === right.phone) matches.push('phone');
  if (left.official && left.official === right.official) matches.push('authorized_official');
  if (left.state && left.state === right.state) matches.push('state');
  const leftAddress = normalizeText(candidate.address ?? candidate.address_line ?? candidate.addressLine);
  const rightAddress = normalizeText(existing.address ?? existing.address_line ?? existing.addressLine);
  if (leftAddress && rightAddress && tokenSimilarity(leftAddress, rightAddress) >= 80) matches.push('address');
  return matches;
};

export const findTierTwoReviews = (candidates, existingRecords, threshold = REVIEW_THRESHOLD) => {
  const reviews = [];
  for (const candidate of candidates) {
    for (const existing of existingRecords) {
      if (normalizeNpi(candidate.npi) && normalizeNpi(candidate.npi) === normalizeNpi(existing.npi)) continue;
      const similarity = tokenSimilarity(candidateName(candidate), candidateName(existing));
      const evidence = corroboratingSignals(candidate, existing).filter((signal) => signal !== 'state');
      if (similarity >= threshold && evidence.length > 0) {
        reviews.push({
          npi: normalizeNpi(candidate.npi),
          existingNpi: normalizeNpi(existing.npi),
          relationship: 'possible_duplicate',
          similarity,
          evidence,
          decision: 'needs_review',
        });
      }
    }
  }
  return reviews;
};

export const preflightCandidates = (candidates, context = {}) => {
  const existingRecords = context.existingRecords ?? [];
  const existingLeads = new Map((context.existingLeads ?? []).map((lead) => [normalizeNpi(lead.npi), lead]));
  const groups = new Map((context.groups ?? []).map((group) => [group.id, group]));
  const memberships = new Map((context.memberships ?? []).map((member) => [normalizeNpi(member.npi), member]));
  const seen = new Set();
  return candidates.map((candidate) => {
    const npi = normalizeNpi(candidate.npi);
    if (!npi) return { npi: valueOf(candidate.npi), decision: 'invalid', reasons: ['invalid_npi'] };
    if (seen.has(npi)) return { npi, decision: 'duplicate', reasons: ['duplicate_in_batch'] };
    seen.add(npi);
    if (existingLeads.has(npi)) return { npi, decision: 'duplicate', reasons: ['lead_already_exists'] };
    const membership = memberships.get(npi);
    const group = membership ? groups.get(membership.group_id) : undefined;
    const owners = group?.active_owners ?? [];
    if (owners.length > 0) return { npi, decision: 'owned_conflict', groupId: membership.group_id, owners, reasons: ['group_has_active_owner'] };
    return { npi, decision: 'accept', identityKey: strictIdentityKey(candidate), groupId: membership?.group_id ?? null };
  });
};

export const summarizePreflight = (results) => results.reduce((summary, result) => ({
  ...summary,
  total: summary.total + 1,
  [result.decision]: (summary[result.decision] ?? 0) + 1,
}), { total: 0 });