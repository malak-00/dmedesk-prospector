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

  // Calls that reached a person, from the call logs of leads worked before and returned to Prospect.
  function pickupItem(pickup) {
    if (!pickup || !(pickup.total > 0)) return null;
    const rate = pickup.answered / pickup.total;
    const tone = pickup.answered === 0 ? "low" : rate >= 0.5 ? "high" : "mid";
    const title = pickup.answered === 0
      ? "Every logged call went to voicemail or no answer: try another number or time"
      : "Logged calls where a person picked up";
    return { key: "pickup", tone, label: "Pickup", text: `Answered ${pickup.answered} of ${pickup.total} call${pickup.total === 1 ? "" : "s"}`, title };
  }

  // opts.priorLine: a sentence about earlier contact (the app builds it); opts.priorNote: the note left then
  function buildWhyCall(company, opts = {}) {
    const now = opts.now != null ? opts.now : Date.now();
    const c = company || {};
    const items = [medicareItem(c.medicare), entityItem(c.isOrganization), freshnessItem(c.lastUpdated, now), pickupItem(c.pickup)].filter(Boolean);
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
      <div class="why-same" data-same-npi="${esc(company && company.npi)}" hidden></div>
      ${prior ? `<div class="why-prior"><strong>Contacted before.</strong> ${esc(prior.text)}${prior.note ? `<span class="why-prior-note">${esc(prior.note)}</span>` : ""}</div>` : ""}
    </div>`;
  };

  /* Other providers registered at the same building (chains, shared offices). Asked for when the card
     opens, one small request, and remembered for the session. Silent if it fails or finds nothing. */
  const sameCache = new Map();

  function sameHtml(data) {
    if (!data || !data.matches || !data.matches.length) return "";
    const more = data.total > data.matches.length ? ` <span class="why-more">+${data.total - data.matches.length} more</span>` : "";
    return `<div class="why-same-head"><strong>Also at this address</strong> <span>${data.total} other provider${data.total === 1 ? "" : "s"} in the same building${more}</span></div>
      <ul class="why-same-list">${data.matches.map((m) => `<li>
        <span class="why-same-name">${esc(m.name)}</span>
        <span class="why-same-meta">${esc([m.suite, m.specialty, m.phone].filter(Boolean).join(" · "))}</span>
        ${m.claimedBy ? `<span class="why-same-tag why-same-held" title="${esc(m.status ? "Status: " + m.status : "Already claimed")}">Claimed by ${esc(m.claimedBy)}</span>` : '<span class="why-same-tag">Not claimed</span>'}
      </li>`).join("")}</ul>`;
  }

  root.dmeHooks.whyCallOpened = async (company) => {
    if (!company || !company.npi || typeof apiGet !== "function") return;
    const npi = String(company.npi);
    const exclude = (company.locations || []).map((l) => l && l.npi).filter((n) => n && String(n) !== npi).join(",");
    try {
      if (!sameCache.has(npi)) sameCache.set(npi, apiGet("companies/same-address", { npi, exclude }));
      const html = sameHtml(await sameCache.get(npi));
      const box = document.querySelector(`.why-same[data-same-npi="${npi}"]`);
      if (box && html) { box.innerHTML = html; box.hidden = false; }
    } catch (err) {
      sameCache.delete(npi);
      console.log("[whycall] same address: " + err.message);
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
