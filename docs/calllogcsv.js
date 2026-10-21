/* Reading the phone system's call log export (a CSV) in the browser: split it into rows, work out which column is
   which, and turn the rows into what POST /admin/call-log/import expects. Pure (tested in worker/test/calllogcsv.test.js),
   so it never touches the page. Loaded before insights.js, which shows the import card. */
(function (root) {
  "use strict";

  // Splits CSV text into arrays of cells. Handles quoted cells (with commas, quotes and line breaks), CRLF, a leading
  // BOM, and a comma, semicolon or tab separator (chosen from the first line).
  function parseCsv(text) {
    const src = String(text || "").replace(/^﻿/, "");
    const first = src.split(/\r?\n/, 1)[0] || "";
    const counts = { ",": (first.match(/,/g) || []).length, ";": (first.match(/;/g) || []).length, "\t": (first.match(/\t/g) || []).length };
    const sep = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && src[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((c) => c.trim() !== "")) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    return rows;
  }

  // Which column holds what, from the header row. Each column is used once; -1 means not found.
  const PATTERNS = [
    ["calledAt", [/^(call ?)?(date ?time|datetime|timestamp|start( time| date)?|date|time)$/i, /(date|time|start)/i]],
    ["phone", [/^(phone( number)?|number|dialed( number)?|called( number)?|destination|dst|to|callee|customer( number)?)$/i, /(phone|number|dial|dest)/i]],
    ["durationSec", [/^(duration|talk ?time|billsec|length|call length)( \(?(s|sec|seconds)\)?)?$/i, /(duration|talk|billsec|length)/i]],
    ["disposition", [/^(disposition|outcome|result|status|call status|call result)$/i, /(disposition|outcome|result|status)/i]],
    ["agent", [/^(agent|user|rep|extension|ext|operator|caller|name|agent name)$/i, /(agent|user|rep|operator|extension)/i]],
  ];

  function detectColumns(headers) {
    const used = new Set();
    const mapping = {};
    const names = (headers || []).map((h) => String(h || "").trim());
    for (const [key, patterns] of PATTERNS) {
      let found = -1;
      for (const re of patterns) {
        found = names.findIndex((h, i) => !used.has(i) && re.test(h));
        if (found >= 0) break;
      }
      if (found >= 0) used.add(found);
      mapping[key] = found;
    }
    return mapping;
  }

  // The data rows (everything after the header) as import rows.
  function toImportRows(rows, mapping) {
    const cell = (r, i) => (i >= 0 && i < r.length ? String(r[i]).trim() : "");
    return rows.slice(1).map((r) => ({
      calledAt: cell(r, mapping.calledAt),
      agent: cell(r, mapping.agent),
      phone: cell(r, mapping.phone),
      durationSec: cell(r, mapping.durationSec),
      disposition: cell(r, mapping.disposition),
    })).filter((r) => r.calledAt || r.phone);
  }

  const api = { parseCsv, detectColumns, toImportRows };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.dmeCallLogCsv = api;
})(typeof window !== "undefined" ? window : globalThis);
