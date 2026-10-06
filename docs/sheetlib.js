/* Pure helpers for the Admin > Controls sheet import and CSV export. No DOM, no network,
   so they can be tested on their own (worker/test/sheetlib.test.js loads this file).
   Follows documentation/plans/SHEET_LEAD_IMPORT_PROTOCOL.md: headers are found by name,
   not by column position; rows need a 10-digit NPI; campaign and rep exclusions are
   settings, not hard-coded. */
(function (root) {
  "use strict";

  // ---- CSV (RFC 4180: quoted fields, doubled quotes, newlines inside quotes) -------------

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const src = String(text || "").replace(/^﻿/, "");
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (c === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && src[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); }
    return rows;
  }

  // A cell that starts like a formula would run in Excel or Sheets. Prefix those with an
  // apostrophe (phone numbers such as "+1 404 ..." are left alone).
  function safeCell(value) {
    const s = value === null || value === undefined ? "" : String(value);
    if (/^[=@]/.test(s)) return "'" + s;
    if (/^[+-]/.test(s) && !/^[+-]?[\d\s().-]+$/.test(s)) return "'" + s;
    return s;
  }

  function csvEscape(value) {
    const s = safeCell(value);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(header, rows) {
    return "﻿" + [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
  }

  // ---- reading a sheet export ------------------------------------------------------------

  const HEADERS = [
    ["npi", /^npi$/i],
    ["opener", /^opener$/i],
    ["company", /^company(\s*name)?$/i],
    ["sub", /^sub$/i],
    ["status", /^status$/i],
    ["dateAdded", /^date\s*added$/i],
    ["authorized", /^authorized\s*person$/i],
    ["phone", /^phone$/i],
    ["email", /^e-?mail$/i],
    ["meetingTime", /^meeting\s*time$/i],
    ["openerSummary", /^opener\s*summary$/i],
    ["closerNotes", /^closer('?s)?\s*notes$/i],
    ["sync", /^sync$/i],
    ["log", /^log$/i],
  ];

  function headerMap(headers) {
    const map = {};
    (headers || []).forEach((h, idx) => {
      const title = String(h || "").trim();
      for (const [key, pattern] of HEADERS) {
        if (map[key] === undefined && pattern.test(title)) { map[key] = idx; break; }
      }
    });
    return map;
  }

  const TRUE_WORDS = /^(true|yes|y|x|1|checked|synced)$/i;
  const cell = (row, map, key) => (map[key] === undefined ? "" : String(row[map[key]] ?? "").trim());
  const words = (list) => String(list || "").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);

  // options: { excludeSubs: "solar", excludeWords: "george", skipSynced: true }
  // -> { candidates, skipped: { invalid, excluded, synced, duplicate }, openers: [{ name, count }], missingNpi }
  function qualify(rows, options = {}) {
    const map = headerMap(rows[0] || []);
    const result = { candidates: [], skipped: { invalid: 0, excluded: 0, synced: 0, duplicate: 0 }, openers: [], missingNpi: map.npi === undefined, map };
    if (result.missingNpi) return result;

    const subs = words(options.excludeSubs);
    const needles = words(options.excludeWords);
    const seen = new Set();
    const openerCounts = new Map();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const npi = cell(row, map, "npi").replace(/\D/g, "");
      if (npi.length !== 10) { result.skipped.invalid++; continue; }
      const sub = cell(row, map, "sub").toLowerCase();
      const opener = cell(row, map, "opener");
      if (subs.includes(sub)) { result.skipped.excluded++; continue; }
      const haystack = row.join(" ").toLowerCase();
      if (needles.some((w) => opener.toLowerCase() === w || haystack.includes(w))) { result.skipped.excluded++; continue; }
      if (options.skipSynced !== false && TRUE_WORDS.test(cell(row, map, "sync"))) { result.skipped.synced++; continue; }
      if (seen.has(npi)) { result.skipped.duplicate++; continue; }
      seen.add(npi);

      const candidate = {
        rowNumber: i + 1,
        npi,
        opener,
        company: cell(row, map, "company"),
        sub: cell(row, map, "sub"),
        status: cell(row, map, "status"),
        dateAdded: cell(row, map, "dateAdded"),
        authorized: cell(row, map, "authorized"),
        phone: cell(row, map, "phone"),
        email: cell(row, map, "email"),
        meetingTime: cell(row, map, "meetingTime"),
        openerSummary: cell(row, map, "openerSummary"),
        closerNotes: cell(row, map, "closerNotes"),
      };
      result.candidates.push(candidate);
      const key = opener || "";
      openerCounts.set(key, (openerCounts.get(key) || 0) + 1);
    }
    result.openers = [...openerCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    return result;
  }

  const collapse = (s) => String(s || "").replace(/\s+/g, " ").trim();

  // What the sheet knew, as ONE call-log line in the app's own format
  // ("YYYY-MM-DD HH:mm — <name>: <text>"), so it reads properly in History and is not
  // counted as a call (the text starts with "Imported from").
  function importNote(c, { stamp, actor }) {
    const parts = [
      c.opener && `Opener: ${c.opener}`,
      c.sub && `SUB: ${c.sub}`,
      c.dateAdded && `Date added: ${c.dateAdded}`,
      c.meetingTime && `Meeting time: ${c.meetingTime}`,
      c.authorized && `Authorized person: ${c.authorized}`,
      c.openerSummary && `Opener summary: ${collapse(c.openerSummary)}`,
      c.closerNotes && `Closer's notes: ${collapse(c.closerNotes)}`,
    ].filter(Boolean);
    const text = `Imported from BD MEETINGS — ${parts.join(" · ")}`.slice(0, 3600);
    return `${stamp}${actor ? ` — ${actor}` : ""}: ${text}`;
  }

  // The body of one company for POST /admin/claim-for-user.
  // statusMode: { useSheet: true, fallback: "Onboarded" } or { useSheet: false, fixed: "Follow up" }
  function toPayload(c, { stamp, actor, statusMode = { useSheet: true, fallback: "Onboarded" } }) {
    const status = statusMode.useSheet ? (c.status || statusMode.fallback || "") : (statusMode.fixed || "");
    return {
      npi: c.npi,
      name: c.company,
      phone: c.phone,
      email: c.email,
      authorizedOfficial: c.authorized,
      status,
      notes: importNote(c, { stamp, actor }),
    };
  }

  // ---- what comes back ---------------------------------------------------------------------

  // Sorts the server's verdict for one chunk into a result per NPI.
  function verdictFor(npis, response) {
    const out = {};
    const set = (list) => new Set((list || []).map(String));
    const claimed = set(response.claimedNpis);
    const already = set(response.alreadyClaimedNpis);
    const allowed = set(response.allowedNpis); // dry run
    const blocked = new Map((response.blocked || []).map((b) => [String(b.npi), b]));
    const held = set((response.heldForReview || []).map((h) => h.npi));
    const invalid = set((response.invalid || []).map((i) => (typeof i === "object" ? i.npi : i)));
    for (const npi of npis) {
      if (response.dryRun ? allowed.has(npi) && !already.has(npi) : claimed.has(npi)) out[npi] = { result: response.dryRun ? "would-import" : "imported", detail: "" };
      else if (already.has(npi)) out[npi] = { result: "already-theirs", detail: "Already claimed by them" };
      else if (blocked.has(npi)) out[npi] = { result: "blocked", detail: `Owned by ${(blocked.get(npi).owners || []).join(", ") || "a teammate"}` };
      else if (held.has(npi)) out[npi] = { result: "held", detail: "Held for admin review (possible duplicate)" };
      else if (invalid.has(npi)) out[npi] = { result: "invalid", detail: "Not a usable NPI" };
      else out[npi] = { result: "not-imported", detail: "The server didn't claim it" };
    }
    return out;
  }

  const RESULT_LABELS = {
    "would-import": "Would import", imported: "Imported", "already-theirs": "Already theirs", blocked: "Blocked",
    held: "Held for review", invalid: "Invalid NPI", "not-imported": "Not imported", error: "Error",
  };

  // ---- exports ------------------------------------------------------------------------------

  const iso = (v) => (v ? String(v) : "");
  function leadsToCsv(leads) {
    const header = ["NPI", "Company", "Rep", "Status", "Specialty", "City", "State", "Contact", "Contact title", "Company phone", "Contact phone",
      "Email", "Website", "Claimed on", "Last updated", "Callback", "Meeting", "Meeting length (min)", "Meeting email", "Opener notes", "Call log (newest first)"];
    const rows = (leads || []).map((l) => [
      l.npi, l.name, l.claimedBy, l.status, l.taxonomy, l.city, l.state, l.contactName, l.contactTitle, l.companyPhone, l.contactPhone,
      l.email, l.website, iso(l.claimedAt).slice(0, 10), iso(l.lastUpdated).slice(0, 10), iso(l.reminderAt), iso(l.meetingAt),
      l.meetingDurationMin, l.meetingEmail, l.meetingOpenerNotes, l.notes,
    ]);
    return toCsv(header, rows);
  }

  // One line per imported row, to paste back next to the sheet's SYNC and Log columns.
  function resultsToCsv(rows) {
    return toCsv(["Row", "NPI", "Company", "Rep", "Result", "Detail", "SYNC"],
      rows.map((r) => [r.rowNumber, r.npi, r.company, r.rep, RESULT_LABELS[r.result] || r.result, r.detail,
        r.result === "imported" || r.result === "already-theirs" ? "TRUE" : "FALSE"]));
  }

  const api = { parseCsv, toCsv, csvEscape, safeCell, headerMap, qualify, importNote, toPayload, verdictFor, RESULT_LABELS, leadsToCsv, resultsToCsv };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.dmeSheet = api;
})(typeof window !== "undefined" ? window : globalThis);
