/* "Last touched": who last wrote on a claimed lead, and how long ago, read from the top line of its call log
   ("2026-10-07 19:40 — Ana: voicemail — left a message", newest first, the time in UTC). Shown under the company name in Claimed so
   nobody rings a lead a teammate just called. Pure, so it is tested (worker/test/lasttouch.test.js). */
(function (root) {
  "use strict";

  // { by, at } for the newest entry that carries a time and a name, or null.
  function lastTouch(notes) {
    const lines = String(notes || "").split("\n").filter(Boolean);
    for (const line of lines.slice(0, 3)) {
      const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) — ([^:—]{1,40}):/.exec(line.trim());
      if (m) {
        const at = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`);
        if (Number.isFinite(at)) return { by: m[4].trim(), at };
      }
    }
    return null;
  }

  function ago(at, now = Date.now()) {
    const minutes = Math.max(0, Math.round((now - at) / 60000));
    if (minutes < 2) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : `${days}d ago`;
  }

  // "Ana, 2h ago" or "" when the log has nothing to read.
  function describe(notes, now = Date.now()) {
    const t = lastTouch(notes);
    return t ? `${t.by}, ${ago(t.at, now)}` : "";
  }

  const api = { lastTouch, ago, describe };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.dmeTouch = api;
})(typeof window !== "undefined" ? window : globalThis);
