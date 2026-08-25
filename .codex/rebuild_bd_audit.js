const fs = require('node:fs');

const apiUrl = process.env.TASK_SUPABASE_URL;
const apiKey = process.env.TASK_SUPABASE_KEY;
if (!apiUrl || !apiKey) throw new Error('TASK_SUPABASE_URL and TASK_SUPABASE_KEY are required');

function parseCsv(text) {
  const rows = []; let row = []; let value = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += ch; i++; }
      else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(value); value = ''; }
    else if (ch === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += ch;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const [headers, ...data] = rows;
  return data.filter(r => r.some(Boolean)).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ''])));
}
function csv(rows, headers) {
  const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  return [headers.join(','), ...rows.map(r => headers.map(h => quote(r[h])).join(','))].join('\r\n') + '\r\n';
}
const norm = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(INCORPORATED|INC|CORPORATION|CORP|LIMITED|LTD|LLC)$/, '');
const digits = value => String(value || '').replace(/\D/g, '');
const phones = value => (String(value || '').match(/\d[\d\-() .]{7,}\d/g) || []).map(digits).filter(p => p.length === 10);
const sourceKey = r => `${r.source_sheet}|${r.source_row}`;
const ignoredSubs = new Set(['MLA', 'CAMPAIGNS', 'MVA CLAIMS', 'HOME IMPROVEMENT', 'FOOD DELIVERY', 'SOLAR', 'AUTO INSURANCE', 'HOSPITALITY'].map(norm));
const ownerAliases = { jane: 'kaity james', kaity: 'kaity james' };
const requestedOwner = opener => ownerAliases[String(opener || '').trim().toLowerCase()] || String(opener || '').trim().toLowerCase();
const headers = { apikey: apiKey, Authorization: `Bearer ${apiKey}` };

async function supabase(path) {
  const response = await fetch(`${apiUrl}/rest/v1/${path}`, { headers });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response.json();
}
async function allLeads() {
  const rows = []; const fields = 'id,npi,company_name,phone,contact_name,state,claimed_by,app_users!leads_claimed_by_fkey(full_name)';
  for (let offset = 0;; offset += 1000) {
    const page = await supabase(`leads?select=${encodeURIComponent(fields)}&limit=1000&offset=${offset}`);
    rows.push(...page); if (page.length < 1000) return rows;
  }
}
async function npiLookup(company) {
  const url = `https://npiregistry.cms.hhs.gov/api/?version=2.1&limit=20&organization_name=${encodeURIComponent(company)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`NPPES ${response.status}`);
  const payload = await response.json();
  return (payload.results || []).filter(x => norm(x.basic?.organization_name) === norm(company));
}
function chooseNpi(matches, row) {
  if (matches.length === 1) return matches[0];
  const sheetPhones = new Set(phones(row.phone));
  const phoneMatches = matches.filter(x => (x.addresses || []).some(a => sheetPhones.has(digits(a.telephone_number))));
  return phoneMatches.length === 1 ? phoneMatches[0] : null;
}
function location(result) { return (result.addresses || []).find(a => a.address_purpose === 'LOCATION') || (result.addresses || [])[0] || {}; }

(async () => {
  const old = ['bd_meetings_resolved.csv', 'bd_meetings_unresolved_by_missing.csv', 'bd_meetings_ignored.csv']
    .flatMap(file => parseCsv(fs.readFileSync(file, 'utf8')));
  const seen = new Set();
  const sourceRows = old.filter(r => { const key = sourceKey(r); if (seen.has(key)) return false; seen.add(key); return true; });
  const leads = await allLeads();
  const byNpi = new Map();
  for (const lead of leads) if (lead.npi) { const key = String(lead.npi); if (!byNpi.has(key)) byNpi.set(key, []); byNpi.get(key).push(lead); }
  const special = sourceRows.filter(r => /(ORT|CGM|IMMUNE|LYMPH)/i.test(r.sub) && !ignoredSubs.has(norm(r.sub)) && !/^(george|russ)/i.test(r.opener));
  const results = new Map();
  for (let i = 0; i < special.length; i += 8) {
    const batch = await Promise.all(special.slice(i, i + 8).map(async row => {
      try { return [sourceKey(row), chooseNpi(await npiLookup(row.company_name), row)]; }
      catch (error) { return [sourceKey(row), { error: error.message }]; }
    }));
    for (const [key, value] of batch) results.set(key, value);
  }
  const byCompanyNpi = new Map();
  for (const row of special) {
    const value = results.get(sourceKey(row));
    if (value && !value.error) { const key = String(value.number); if (!byCompanyNpi.has(key)) byCompanyNpi.set(key, []); byCompanyNpi.get(key).push(row); }
  }
  const resolved = [], ignored = [], unresolved = [], pending = [];
  for (const row of sourceRows) {
    const base = { ...row, matched_npi: '', matched_state: '', npi_match_method: '', claimed_by: row.claimed_by || '', duplicate_locations: row.duplicate_locations || '' };
    if (ignoredSubs.has(norm(row.sub)) || /^(george|russ)/i.test(row.opener)) {
      ignored.push({ ...base, resolution: ignoredSubs.has(norm(row.sub)) ? 'Ignored: SUB exclusion' : 'Ignored: opener exclusion' }); continue;
    }
    const result = results.get(sourceKey(row));
    let npi = String(row.npi || '').replace(/\.0$/, '');
    if (result && !result.error) {
      npi = String(result.number); const addr = location(result);
      base.matched_npi = npi; base.matched_state = addr.state || ''; base.npi_match_method = 'Exact legal company name (NPPES)';
    }
    const db = npi ? (byNpi.get(npi) || []) : [];
    const expected = requestedOwner(row.opener);
    const sameOwner = db.some(d => String(d.app_users?.full_name || '').trim().toLowerCase() === expected);
    const otherOwners = [...new Set(db.map(d => String(d.app_users?.full_name || '').trim().toLowerCase()).filter(Boolean).filter(name => name !== expected))];
    if (sameOwner) {
      resolved.push({ ...base, npi: npi || row.npi, resolution: 'Resolved: already claimed by the same opener', claimed_by: expected }); continue;
    }
    if (otherOwners.length) {
      unresolved.push({ ...base, npi: npi || row.npi, resolution: 'Unresolved: claimed by different person', claimed_by: otherOwners.join('; ') }); continue;
    }
    if (npi && result && !result.error) {
      const duplicates = byCompanyNpi.get(npi) || [];
      if (duplicates.length > 1) {
        unresolved.push({ ...base, npi, resolution: 'Unresolved: duplicate company in workbook', duplicate_locations: duplicates.map(sourceKey).join('; ') }); continue;
      }
      pending.push({ ...base, npi, state: base.matched_state, resolution: 'Verified NPI; safe for API import' }); continue;
    }
    unresolved.push({ ...base, npi: npi || row.npi, resolution: result?.error ? `Unresolved: NPI lookup error (${result.error})` : row.resolution || 'Unresolved: no verified NPI match' });
  }
  const ordered = ['source_sheet','source_row','sub','opener','company_name','authorized_person','phone','email','npi','matched_npi','matched_state','npi_match_method','workbook_status','resolution','claimed_by','duplicate_locations'];
  fs.writeFileSync('bd_meetings_resolved.csv', csv(resolved, ordered));
  fs.writeFileSync('bd_meetings_unresolved_by_missing.csv', csv(unresolved, ordered));
  fs.writeFileSync('bd_meetings_ignored.csv', csv(ignored, ordered));
  fs.writeFileSync('bd_meetings_npi_verified_pending_import.csv', csv(pending, [...ordered.slice(0, 13), 'state', ...ordered.slice(13)]));
  console.log(JSON.stringify({ sourceRows: sourceRows.length, ignored: ignored.length, resolved: resolved.length, unresolved: unresolved.length, npiVerifiedPendingImport: pending.length, specialRows: special.length, exactOrPhoneDisambiguatedNpi: [...results.values()].filter(x => x && !x.error).length }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
