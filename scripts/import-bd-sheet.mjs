#!/usr/bin/env node
/**
 * DME Desk Prospector — Sheet Lead Importer CLI
 * Implements: documentation/plans/SHEET_LEAD_IMPORT_PROTOCOL.md
 *
 * Usage:
 *   node scripts/import-bd-sheet.mjs <path-to-csv> [--dry-run | --apply] [--status <status>]
 */

import fs from 'node:fs';
import path from 'node:path';

function parseCSV(text) {
  const rows = [];
  let row = [];
  let token = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        token += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push(token);
      token = '';
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(token);
      token = '';
      if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
        rows.push(row);
      }
      row = [];
    } else {
      token += c;
    }
  }
  if (token || row.length > 0) {
    row.push(token);
    rows.push(row);
  }
  return rows;
}

function getHeaderMap(headers) {
  const map = {};
  headers.forEach((h, idx) => {
    const t = String(h || '').trim().toLowerCase();
    if (t === 'npi') map.npi = idx;
    else if (t === 'opener') map.opener = idx;
    else if (t === 'company name' || t === 'company') map.company = idx;
    else if (t === 'sub') map.sub = idx;
    else if (t === 'status') map.status = idx;
    else if (t === 'date added') map.dateAdded = idx;
    else if (t.includes('authorized person') || t.includes('contact')) map.contact = idx;
    else if (t === 'phone') map.phone = idx;
    else if (t === 'email') map.email = idx;
    else if (t.includes('meeting time')) map.meetingTime = idx;
    else if (t.includes('opener summary')) map.summary = idx;
    else if (t.includes('closer')) map.closerNotes = idx;
    else if (t === 'sync') map.sync = idx;
  });
  return map;
}

function loadEnv() {
  const envPath = path.resolve('scripts', '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(`Environment file not found at ${envPath}`);
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const cfg = {};
  content.split(/\r?\n/).forEach((line) => {
    const [k, ...v] = line.split('=');
    if (k) cfg[k.trim()] = v.join('=').trim();
  });
  return cfg;
}

const USER_MAPPING = {
  ben: 'ben.arthur.wiz@gmail.com',
  selene: 'selene.myles.wiz@gmail.com',
  jimmy: 'jimmy.pearson.wiz@gmail.com',
  jane: 'kaity.james.wiz@gmail.com',
  judy: 'nora.atkins.wiz@gmail.com',
};

const DEFAULT_USER = 'ben.arthur.wiz@gmail.com';
const ADMIN_ACTOR_USERNAME = 'ben.arthur.wiz@gmail.com';

async function main() {
  const args = process.argv.slice(2);
  const csvFile = args.find((a) => !a.startsWith('--'));
  const isApply = args.includes('--apply');
  const statusFlagIdx = args.indexOf('--status');
  const targetStatus = statusFlagIdx !== -1 && args[statusFlagIdx + 1] ? args[statusFlagIdx + 1] : 'Onboarded';

  if (!csvFile) {
    console.error('Usage: node scripts/import-bd-sheet.mjs <file.csv> [--dry-run | --apply] [--status <status>]');
    process.exit(1);
  }

  const resolvedCsv = path.resolve(csvFile);
  if (!fs.existsSync(resolvedCsv)) {
    console.error(`File does not exist: ${resolvedCsv}`);
    process.exit(1);
  }

  const cfg = loadEnv();
  const rawCsv = fs.readFileSync(resolvedCsv, 'utf8');
  const rows = parseCSV(rawCsv);
  if (rows.length < 2) {
    console.error('CSV contains no data rows.');
    process.exit(1);
  }

  const headerMap = getHeaderMap(rows[0]);
  if (headerMap.npi == null) {
    console.error('CSV is missing an "NPI" header.');
    process.exit(1);
  }

  console.log(`\n=== DME Desk Prospector: Sheet Lead Import ===`);
  console.log(`Source File : ${resolvedCsv}`);
  console.log(`Total Rows  : ${rows.length - 1}`);
  console.log(`Target Status: ${targetStatus}`);
  console.log(`Execution Mode: ${isApply ? 'LIVE APPLY' : 'DRY RUN'}\n`);

  // Fetch app users
  const usersRes = await fetch(`${cfg.SUPABASE_URL}/rest/v1/app_users?select=id,username,display_name`, {
    headers: {
      apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const appUsers = await usersRes.json();
  const userMapByUsername = {};
  appUsers.forEach((u) => (userMapByUsername[u.username.toLowerCase()] = u));

  const adminActor = userMapByUsername[ADMIN_ACTOR_USERNAME.toLowerCase()];
  if (!adminActor) {
    throw new Error(`Admin actor user ${ADMIN_ACTOR_USERNAME} not found in app_users.`);
  }

  // Parse candidate data
  const dataRows = rows.slice(1);
  const candidates = [];
  let skippedNoNpi = 0;
  let skippedSolar = 0;
  let skippedGeorge = 0;

  dataRows.forEach((r, idx) => {
    const rawNpi = (r[headerMap.npi] || '').trim().replace(/\D/g, '');
    if (rawNpi.length !== 10) {
      skippedNoNpi++;
      return;
    }

    const sub = headerMap.sub != null ? (r[headerMap.sub] || '').trim().toLowerCase() : '';
    if (sub === 'solar') {
      skippedSolar++;
      return;
    }

    const opener = headerMap.opener != null ? (r[headerMap.opener] || '').trim() : '';
    const fullRowText = JSON.stringify(r).toLowerCase();
    if (opener.toLowerCase() === 'george' || fullRowText.includes('george')) {
      skippedGeorge++;
      return;
    }

    candidates.push({
      rowIdx: idx + 2,
      npi: rawNpi,
      opener: opener,
      sub: headerMap.sub != null ? (r[headerMap.sub] || '').trim() : '',
      company: headerMap.company != null ? (r[headerMap.company] || '').trim() : '',
      contact: headerMap.contact != null ? (r[headerMap.contact] || '').trim() : '',
      phone: headerMap.phone != null ? (r[headerMap.phone] || '').trim() : '',
      email: headerMap.email != null ? (r[headerMap.email] || '').trim() : '',
      meetingTime: headerMap.meetingTime != null ? (r[headerMap.meetingTime] || '').trim() : '',
      dateAdded: headerMap.dateAdded != null ? (r[headerMap.dateAdded] || '').trim() : '',
      summary: headerMap.summary != null ? (r[headerMap.summary] || '').trim() : '',
      closerNotes: headerMap.closerNotes != null ? (r[headerMap.closerNotes] || '').trim() : '',
    });
  });

  const uniqueNpis = [...new Set(candidates.map((c) => c.npi))];

  // Check live leads table for existing claims
  const leadsRes = await fetch(
    `${cfg.SUPABASE_URL}/rest/v1/leads?select=npi,claimed_by,is_disconnected&npi=in.(${uniqueNpis.join(',')})`,
    {
      headers: {
        apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  const existingLeads = await leadsRes.json();
  const existingMap = {};
  if (Array.isArray(existingLeads)) {
    existingLeads.forEach((l) => (existingMap[l.npi] = l));
  }

  // Filter out already claimed
  const toClaim = [];
  let skippedAlreadyInLeads = 0;
  const seenNpisInBatch = new Set();

  candidates.forEach((cand) => {
    if (seenNpisInBatch.has(cand.npi)) return; // Deduplicate within same sheet
    seenNpisInBatch.add(cand.npi);

    const existing = existingMap[cand.npi];
    if (existing && existing.claimed_by && !existing.is_disconnected) {
      skippedAlreadyInLeads++;
      return;
    }
    toClaim.push(cand);
  });

  console.log(`Filter Results:`);
  console.log(`- Skipped Invalid/Empty NPI: ${skippedNoNpi}`);
  console.log(`- Skipped SUB: Solar       : ${skippedSolar}`);
  console.log(`- Skipped George Affiliated : ${skippedGeorge}`);
  console.log(`- Preserved Existing Claims : ${skippedAlreadyInLeads}`);
  console.log(`- Qualified Leads to Claim  : ${toClaim.length}\n`);

  if (toClaim.length === 0) {
    console.log('No new leads to claim. Exiting.');
    return;
  }

  // Fetch npi_records for enrichment
  const claimNpis = toClaim.map((c) => c.npi);
  const npiRecordsRes = await fetch(
    `${cfg.SUPABASE_URL}/rest/v1/npi_records?select=*&npi=in.(${claimNpis.join(',')})`,
    {
      headers: {
        apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  const npiRecords = await npiRecordsRes.json();
  const npiMap = {};
  if (Array.isArray(npiRecords)) {
    npiRecords.forEach((r) => (npiMap[String(r.npi)] = r));
  }

  const now = new Date().toISOString();
  console.log(`--- Processing Claims (1-by-1) ---`);

  let claimedCount = 0;
  for (const item of toClaim) {
    const openerKey = item.opener.toLowerCase().trim();
    const targetUsername = USER_MAPPING[openerKey] || DEFAULT_USER;
    const targetUser = userMapByUsername[targetUsername.toLowerCase()] || adminActor;

    const npiRec = npiMap[item.npi] || {};
    const companyName = npiRec.name || item.company || '';
    const state = npiRec.address_state || '';
    const phone = item.phone || npiRec.phone || '';
    const addressLine1 = npiRec.address_line1 || '';
    const city = npiRec.address_city || '';
    const postalCode = npiRec.address_postalcode || '';
    const specialty = npiRec.taxonomy_description || item.sub || '';
    const email = item.email || '';
    const contactName =
      item.contact ||
      (npiRec.authorizedofficial_firstname
        ? `${npiRec.authorizedofficial_firstname} ${npiRec.authorizedofficial_lastname}`.trim()
        : '');
    const contactPhone = item.phone || npiRec.authorizedofficial_phone || '';

    const notesParts = [];
    if (item.sub) notesParts.push(`SUB: ${item.sub}`);
    if (item.opener) notesParts.push(`Opener: ${item.opener}`);
    if (item.dateAdded) notesParts.push(`Date Added: ${item.dateAdded}`);
    if (item.meetingTime) notesParts.push(`Meeting Time: ${item.meetingTime}`);
    if (item.contact) notesParts.push(`Authorized Person: ${item.contact}`);
    if (item.summary) notesParts.push(`Opener Summary:\n${item.summary}`);
    if (item.closerNotes) notesParts.push(`Closer's Notes:\n${item.closerNotes}`);
    const notes = notesParts.join('\n\n');

    const officialName = npiRec.authorizedofficial_firstname
      ? `${npiRec.authorizedofficial_firstname} ${npiRec.authorizedofficial_lastname}`.trim()
      : item.contact || null;
    const officialPhone = npiRec.authorizedofficial_phone || null;

    const leadPayload = {
      npi: item.npi,
      identity: {
        name: companyName || null,
        state: state || null,
        phone: phone || null,
        officialName: officialName || null,
        officialPhone: officialPhone || null,
      },
      lead: {
        npi: item.npi,
        claimed_by: targetUser.id,
        claimed_at: now,
        company_name: companyName,
        phone: phone,
        website: null,
        email: email,
        address_line1: addressLine1,
        city: city,
        state: state,
        postal_code: postalCode,
        specialty: specialty,
        contact_name: contactName,
        contact_title: npiRec.authorizedofficial_title || null,
        contact_role: 'authorized official',
        contact_source: npiRec.npi ? 'nppes' : 'sheet',
        contact_phone: contactPhone,
        status: targetStatus,
        status_updated_at: now,
        status_updated_by: targetUser.id,
        notes: notes,
        meeting_opener_notes: item.summary || null,
        is_disconnected: false,
      },
    };

    const claimRes = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/claim_leads`, {
      method: 'POST',
      headers: {
        apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: targetUser.id,
        p_leads: [leadPayload],
        p_actor_id: adminActor.id,
        p_dry_run: !isApply,
      }),
    });

    const resJson = await claimRes.json();
    const isSuccess = resJson.claimed && resJson.claimed.length > 0;
    if (isSuccess) claimedCount++;

    console.log(
      `[${isSuccess ? 'SUCCESS' : 'FAILED'}] NPI ${item.npi} | ${companyName.slice(0, 30).padEnd(30)} -> ${targetUser.display_name} (${targetUser.username})`
    );
  }

  console.log(`\n=== Import Run Complete ===`);
  console.log(`Total Leads Claimed: ${claimedCount} / ${toClaim.length}`);
  if (!isApply) {
    console.log(`(Dry run complete. No database changes were made. Rerun with --apply to commit.)`);
  }
}

main().catch((err) => {
  console.error(`\nFatal error during import:`, err);
  process.exit(1);
});
