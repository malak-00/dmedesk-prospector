/* New / Established badge, from the date a provider got its NPI (the NPPES enumeration date).
   A newer supplier is often still building its back office and choosing vendors; an established one has been billing
   for years. Between the two there is no badge, so the badge stays a signal. ageOf() is pure (tested in
   worker/test/leadage.test.js); the rest adds window.dmeHooks.ageBadge for the table rows. */
(function (root) {
  "use strict";

  const NEW_MONTHS = 24; // registered within the last 2 years
  const ESTABLISHED_YEARS = 15; // registered 15 or more years ago
  const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const monthYear = (t) => `${MONTHS[new Date(t).getUTCMonth()]} ${new Date(t).getUTCFullYear()}`;

  function lengthText(months) {
    if (months < 1) return "this month";
    if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? "" : "s"}`;
  }

  // -> null without a usable date, otherwise { kind: "new" | "established" | "", months, registered, text, title }
  function ageOf(enumerationDate, now) {
    const t = Date.parse(enumerationDate);
    if (!enumerationDate || Number.isNaN(t)) return null;
    const at = now != null ? now : Date.now();
    const months = Math.max(0, Math.floor((at - t) / MONTH_MS));
    const registered = monthYear(t);
    let kind = "";
    if (months < NEW_MONTHS) kind = "new";
    else if (months >= ESTABLISHED_YEARS * 12) kind = "established";
    const ago = `${lengthText(months)}${months < 1 ? "" : " ago"}`;
    const title = kind === "new"
      ? `New supplier: NPI registered ${registered} (${ago}). Often still building its back office.`
      : kind === "established"
        ? `Established: NPI registered ${registered} (${ago})`
        : `NPI registered ${registered} (${ago})`;
    return { kind, months, registered, text: kind === "new" ? `New · since ${registered}` : kind === "established" ? `Established · since ${registered}` : `NPI since ${registered}`, title };
  }

  const api = { ageOf, NEW_MONTHS, ESTABLISHED_YEARS };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.dmeLeadAge = api;

  if (typeof document === "undefined" || !root.dmeHooks) return;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  // A small badge for a table row: "New" or "Established", nothing in between.
  root.dmeHooks.ageBadge = (enumerationDate) => {
    const age = ageOf(enumerationDate);
    if (!age || !age.kind) return "";
    return ` <span class="age-badge age-${age.kind}" title="${esc(age.title)}">${age.kind === "new" ? "New" : "Established"}</span>`;
  };
})(typeof window !== "undefined" ? window : globalThis);
