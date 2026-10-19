/* "Why call" strip on an opened Prospect lead: the few facts that tell a rep whether this lead is worth
   the call and what to open with, all from data the lead already carries (no extra requests):
   Medicare money, whether the practice is a company or a one-person NPI, how recently the registry
   record was touched, and any earlier contact.
   buildWhyCall() is pure (tested in worker/test/whycall.test.js); the rest wires it into the card
   through window.dmeHooks. Loaded after app.js. */
(function (root) {
  "use strict";

  const MAJOR_PAYMENT = 100000; // Medicare paid, per the lead scoring plan's tiers
  const SIGNIFICANT_PAYMENT = 10000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const money = (n) => {
    const v = Math.round(Number(n));
    if (v >= 1000000) return `$${(v / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
    if (v >= 1000) return `$${Math.round(v / 1000)}k`;
    return `$${v}`;
  };

  function medicareItem(medicare) {
    if (!medicare || medicare.totalClaims == null) {
      return { key: "medicare", tone: "none", label: "Medicare", text: "No Medicare billing found", title: "No CMS claims data for this NPI" };
    }
    const claims = `${Number(medicare.totalClaims).toLocaleString()} claims`;
    const pay = medicare.medicarePayment;
    if (pay == null) return { key: "medicare", tone: "mid", label: "Medicare", text: `Bills Medicare · ${claims}`, title: claims };
    const tone = pay >= MAJOR_PAYMENT ? "high" : pay >= SIGNIFICANT_PAYMENT ? "mid" : "low";
    const tier = tone === "high" ? "Major account" : tone === "mid" ? "Significant" : "Small biller";
    return { key: "medicare", tone, label: "Medicare", text: `${money(pay)} paid · ${claims}${medicare.totalBeneficiaries != null ? ` · ${Number(medicare.totalBeneficiaries).toLocaleString()} patients` : ""}`, title: `${tier}: $${Math.round(pay).toLocaleString()} paid by Medicare` };
  }

  function entityItem(isOrganization) {
    if (isOrganization === true) return { key: "entity", tone: "high", label: "Type", text: "Company (NPI-2)", title: "Registered as an organization" };
    if (isOrganization === false) {
      return { key: "entity", tone: "mid", label: "Type", text: "Individual (NPI-1)", title: "Registered as an individual or sole proprietor. These convert far less often than companies." };
    }
    return null;
  }

  function ageText(months) {
    if (months < 1) return "this month";
    if (months < 12) return `${months} mo ago`;
    const years = Math.floor(months / 12);
    return `${years} yr${years === 1 ? "" : "s"} ago`;
  }

  function freshnessItem(lastUpdated, now) {
    const t = Date.parse(lastUpdated);
    if (!lastUpdated || Number.isNaN(t)) return null;
    const months = Math.max(0, Math.floor((now - t) / (30.44 * DAY_MS)));
    const tone = months < 12 ? "high" : months < 36 ? "mid" : "low";
    const title = tone === "low"
      ? "Registry record untouched for over 3 years: higher risk of turnover or a closed shop"
      : "When this provider last updated their NPPES registry record";
    return { key: "fresh", tone, label: "Registry", text: `Updated ${ageText(months)}`, title };
  }

  // opts.priorLine: a sentence about earlier contact (the app builds it); opts.priorNote: the note left then
  function buildWhyCall(company, opts = {}) {
    const now = opts.now != null ? opts.now : Date.now();
    const c = company || {};
    const items = [medicareItem(c.medicare), entityItem(c.isOrganization), freshnessItem(c.lastUpdated, now)].filter(Boolean);
    const prior = opts.priorLine ? { text: opts.priorLine, note: opts.priorNote || "" } : null;
    return { items, prior };
  }

  const api = { buildWhyCall, money };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.dmeWhyCall = api;

  /* ---------------- browser wiring ---------------- */
  if (typeof document === "undefined" || !root.dmeHooks) return;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  root.dmeHooks.whyCallBlock = (company, opts) => {
    const { items, prior } = buildWhyCall(company, opts);
    return `<div class="why-call" role="group" aria-label="Why call this lead">
      <h4>Why call</h4>
      <div class="why-chips">${items.map((it) =>
        `<span class="why-chip why-${it.tone}" title="${esc(it.title)}"><span class="why-label">${esc(it.label)}</span>${esc(it.text)}</span>`).join("")}</div>
      ${prior ? `<div class="why-prior"><strong>Contacted before.</strong> ${esc(prior.text)}${prior.note ? `<span class="why-prior-note">${esc(prior.note)}</span>` : ""}</div>` : ""}
    </div>`;
  };
})(typeof window !== "undefined" ? window : globalThis);
