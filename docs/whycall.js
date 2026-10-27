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

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthYear = (t) => `${MONTHS[new Date(t).getUTCMonth()]} ${new Date(t).getUTCFullYear()}`;

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
    return { key: "fresh", tone, label: "Registry", text: `Updated ${monthYear(t)}`, title: `${title} (${ageText(months)} ago)` };
  }

  // How long ago the provider got its NPI: a new supplier is often still choosing vendors.
  function ageItem(enumerationDate, now) {
    const lead = root.dmeLeadAge || (typeof require === "function" ? require("./leadage.js") : null);
    const age = lead && lead.ageOf(enumerationDate, now);
    if (!age) return null;
    const tone = age.kind === "new" ? "high" : age.kind === "established" ? "none" : "none";
    return { key: "age", tone, label: "NPI", text: age.text, title: age.title };
  }

  // Calls that reached a person, from the call logs of leads worked before and returned to Prospect.
  function pickupItem(pickup) {
    if (!pickup || !(pickup.total > 0)) return null;
    const rate = pickup.answered / pickup.total;
    const tone = pickup.answered === 0 ? "low" : rate >= 0.5 ? "high" : "mid";
    const from = pickup.source === "phone system" ? " (from the phone system's call log)" : "";
    const title = (pickup.answered === 0
      ? "Every logged call went to voicemail or no answer: try another number or time"
      : "Logged calls where a person picked up") + from;
    return { key: "pickup", tone, label: "Pickup", text: `Answered ${pickup.answered} of ${pickup.total} call${pickup.total === 1 ? "" : "s"}`, title };
  }

  // opts.priorLine: a sentence about earlier contact (the app builds it); opts.priorNote: the note left then
  function buildWhyCall(company, opts = {}) {
    const now = opts.now != null ? opts.now : Date.now();
    const c = company || {};
    const items = [medicareItem(c.medicare), entityItem(c.isOrganization), freshnessItem(c.lastUpdated, now), ageItem(c.enumerationDate, now), pickupItem(c.pickup)].filter(Boolean);
    const prior = opts.priorLine ? { text: opts.priorLine, note: opts.priorNote || "" } : null;
    return { items, prior };
  }

  // What the product mix (from /companies/product-mix) says about fit with the team's verticals.
  function describeMix(mix) {
    if (!mix || !Array.isArray(mix.categories) || mix.categories.length === 0) return null;
    const verticals = mix.verticals || [];
    const fit = verticals.length > 0;
    const lead = fit
      ? `In your verticals: ${verticals.map((v) => `${v.label} (${money(v.payment)})`).join(", ")}`
      : `Outside your verticals: mostly ${String(mix.categories[0].name).toLowerCase()}`;
    const bars = mix.categories.map((c) => ({ name: c.name, pct: Math.round(c.share * 100), payment: c.payment }));
    return { fit, lead, bars, products: mix.products || [], year: mix.year };
  }

  // Medicare payments by year (from /companies/product-mix, "trend"): one line and a tone.
  function describeTrend(trend) {
    if (!trend || !Array.isArray(trend.points) || trend.points.length === 0) return null;
    const pts = trend.points;
    const last = pts[pts.length - 1];
    const prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const years = pts.map((p) => `${p.year} ${money(p.payment)}`).join(" → ");
    const pct = trend.change == null ? "" : `${trend.change >= 0 ? "+" : "−"}${Math.round(Math.abs(trend.change) * 100).toLocaleString()}%`;
    switch (trend.direction) {
      case "new": return { tone: "high", short: "Ramping up fast", label: "Trend", text: `New or ramping up fast: ${years}`, title: `Medicare payments grew from ${money(prev.payment)} to ${money(last.payment)}. A fast-growing supplier is often looking for vendors.` };
      case "up": return { tone: "high", short: `Growing ${pct}`, label: "Trend", text: `Growing ${pct}: ${years}`, title: "Medicare payments are up on the year before" };
      case "down": return { tone: "low", short: `Shrinking ${pct}`, label: "Trend", text: `Shrinking ${pct}: ${years}`, title: "Medicare payments are down on the year before: a reason to ask what changed" };
      case "stopped": return { tone: "low", short: "Stopped billing", label: "Trend", text: `No Medicare billing in the latest file (last seen ${trend.latestYear})`, title: "They billed Medicare earlier but are missing from the newest CMS file. They may have stopped, or fallen below CMS's reporting threshold." };
      case "single": return { tone: "mid", short: "First year", label: "Trend", text: `First year on file: ${years}`, title: "Only one year of Medicare billing on record" };
      default: return { tone: "mid", short: "Steady", label: "Trend", text: `Steady: ${years}`, title: "Medicare payments are about the same as the year before" };
    }
  }

  const dayText = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? "" : `${MONTHS[new Date(t).getUTCMonth()]} ${new Date(t).getUTCDate()}, ${new Date(t).getUTCFullYear()}`; };

  // Medicare enrollment (from /companies/product-mix, "enrollment"): is the supplier enrolled, since when, as what.
  function describeEnrollment(e) {
    if (!e) return null;
    if (!e.enrolled) return { tone: "low", label: "Enrolled", text: "Not in Medicare's enrollment file", title: "CMS's public enrollment file has no record of this NPI. It may not bill Medicare, or its enrollment ended." };
    const year = e.since ? e.since.slice(0, 4) : "";
    const type = (e.types && e.types[0]) || "";
    return {
      tone: e.dme ? "none" : "mid",
      label: "Enrolled",
      text: `${year ? `Since ${year}` : "With Medicare"}${type ? `: ${type}` : ""}`,
      title: `Medicare enrollment${e.since ? ` first created ${dayText(e.since)}` : ""}${e.types && e.types.length ? `. Enrolled as: ${e.types.join("; ")}` : ""}${e.dme ? "" : ". Not enrolled as a DME supplier, so check what they actually sell."}`,
    };
  }

  // Product categories that grew or shrank since the year before (from "shifts").
  function describeShifts(shifts) {
    if (!shifts || !Array.isArray(shifts.moves) || !shifts.moves.length) return null;
    const lines = shifts.moves.map((m) => {
      if (m.kind === "new") return `${m.name}: new (${money(m.to)})`;
      if (m.kind === "dropped") return `${m.name}: stopped (was ${money(m.from)})`;
      const pct = Math.round(Math.abs(m.change) * 100);
      return `${m.name} ${m.kind === "up" ? "up" : "down"} ${pct}% (${money(m.from)} → ${money(m.to)})`;
    });
    return { lines, text: lines.join("; "), year: shifts.year, previousYear: shifts.previousYear };
  }

  // Who last touched the lead (from /leads/last-touch). Recent contact is worth a look before dialing.
  function describeTouch(touch, now) {
    if (!touch || !touch.at) return null;
    const t = Date.parse(touch.at);
    if (Number.isNaN(t)) return null;
    const days = Math.floor(((now != null ? now : Date.now()) - t) / 86400000);
    return {
      tone: days <= 14 ? "mid" : "none",
      label: "Last touched",
      text: `${dayText(touch.at)}${touch.by ? ` by ${touch.by}` : ""}`,
      title: `${touch.by || "Someone"} ${touch.text || "touched it"}${days <= 14 ? ". Recent: check the notes before calling." : ""}`,
      days,
    };
  }

  // What reps have heard in this state (from /companies/state-pattern).
  function describeStatePattern(p) {
    if (!p || !p.calls) return null;
    const top = (p.objections || [])[0];
    const parts = [];
    if (top) parts.push(`the objection heard most is "${top.reason}" (${top.count} of ${p.withObjection})`);
    const billers = (p.billers || []).slice(0, 2).map((b) => `${b.name} (${b.count})`);
    if (billers.length) parts.push(`billers reps meet: ${billers.join(", ")}`);
    if (!parts.length) return null;
    return { state: p.state, calls: p.calls, text: `In ${p.state}, across ${p.calls} lead${p.calls === 1 ? "" : "s"} with call notes, ${parts.join("; ")}.` };
  }

  // Rental share and urban/rural, from the same CMS rows as the mix.
  function describeTraits(mix) {
    const out = [];
    if (mix && typeof mix.rentalShare === "number" && mix.total > 0) {
      const r = Math.round(mix.rentalShare * 100);
      out.push({ label: "Billing", text: r >= 50 ? `${r}% rentals (recurring revenue)` : r >= 10 ? `${r}% rentals` : "Mostly one-time sales", title: "Share of Medicare payments that come from rented equipment" });
    }
    if (mix && mix.area && mix.area.category) {
      out.push({ label: "Area", text: mix.area.category, title: mix.area.detail || "How CMS classes the supplier's location (urban or rural)" });
    }
    return out;
  }

  const api = { buildWhyCall, describeMix, describeTrend, describeTraits, describeEnrollment, describeShifts, describeTouch, describeStatePattern, money };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.dmeWhyCall = api;

  /* ---------------- browser wiring ---------------- */
  if (typeof document === "undefined" || !root.dmeHooks) return;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  // opts.compact: the narrow call panel (no category list, no top items).
  root.dmeHooks.whyCallBlock = (company, opts) => {
    const built = buildWhyCall(company, opts);
    const prior = built.prior;
    // opts.skip: chips already shown elsewhere on the screen (the call panel's snapshot line), not repeated here.
    const skip = (opts && opts.skip) || [];
    const items = built.items.filter((it) => !skip.includes(it.key));
    const compact = Boolean(opts && opts.compact);
    return `<div class="why-call${compact ? " why-compact" : ""}" role="group" aria-label="Why call this lead">
      ${opts && opts.noTitle ? "" : "<h4>Why call</h4>"}
      ${items.length ? `<div class="why-chips">${items.map((it) =>
        `<span class="why-chip why-${it.tone}" title="${esc(it.title)}"><span class="why-label">${esc(it.label)}</span>${esc(it.text)}</span>`).join("")}</div>` : ""}
      <div class="why-mix" data-mix-npi="${esc(company && company.npi)}"${compact ? ' data-compact="1"' : ""} hidden></div>
      <div class="why-touch" data-touch-npi="${esc(company && company.npi)}" hidden></div>
      <div class="why-state why-same" data-state-npi="${esc(company && company.npi)}" hidden></div>
      <div class="why-same" data-same-npi="${esc(company && company.npi)}" hidden></div>
      <div class="why-owner why-same" data-owner-npi="${esc(company && company.npi)}" hidden></div>
      ${prior ? `<div class="why-prior"><strong>Contacted before.</strong> ${esc(prior.text)}${prior.note ? `<span class="why-prior-note">${esc(prior.note)}</span>` : ""}</div>` : ""}
    </div>`;
  };

  // One tidy line for the call panel: Medicare money, pickup and earlier contact now; product fit and trend
  // join it when the CMS answer arrives. Everything else lives under "More about this lead".
  root.dmeHooks.whyCallSnapshot = (company, opts) => {
    const { items, prior } = buildWhyCall(company, opts);
    const chips = items.filter((i) => i.key === "medicare" || i.key === "pickup" || (i.key === "age" && i.tone === "high"));
    if (prior) chips.push({ tone: "mid", label: "Before", text: "Contacted before", title: prior.text });
    return `<div class="cm-snap" aria-label="Lead snapshot">${chips.map((it) =>
      `<span class="why-chip why-${it.tone}" title="${esc(it.title)}"><span class="why-label">${esc(it.label)}</span>${esc(it.text)}</span>`).join("")}<span class="why-snap" data-snap-npi="${esc(company && company.npi)}"></span>${(opts && opts.extraHtml) || ""}</div>`;
  };

  function snapHtml(data) {
    const d = describeMix(data && data.mix);
    const trend = describeTrend(data && data.trend);
    const chips = [];
    if (d) {
      const labels = d.fit ? (data.mix.verticals || []).map((v) => v.label).join(", ") : "";
      chips.push({ tone: d.fit ? "high" : "none", label: "Fit", text: d.fit ? labels : `Not in your verticals (${String(data.mix.categories[0].name).toLowerCase()})`, title: d.lead });
    }
    if (trend) chips.push({ tone: trend.tone, label: "Trend", text: trend.short, title: trend.title });
    const enrolled = describeEnrollment(data && data.enrollment);
    if (enrolled && enrolled.tone === "low") chips.push(enrolled);
    return chips.map((c) => `<span class="why-chip why-${c.tone}" title="${esc(c.title || "")}"><span class="why-label">${esc(c.label)}</span>${esc(c.text)}</span>`).join("");
  }

  /* Other providers registered at the same building (chains, shared offices). Asked for when the card
     opens, one small request, and remembered for the session. Silent if it fails or finds nothing. */
  const sameCache = new Map();
  const ownerCache = new Map();
  const mixCache = new Map();
  const touchCache = new Map();
  const stateCache = new Map();

  function sameHtml(data, box) {
    if (!data || !data.matches || !data.matches.length) return "";
    const compact = box && box.dataset.compact;
    const shown = compact ? data.matches.slice(0, 3) : data.matches;
    const more = data.total > shown.length ? ` <span class="why-more">+${data.total - shown.length} more</span>` : "";
    return `<div class="why-same-head"><strong>Also at this address</strong> <span>${data.total} other provider${data.total === 1 ? "" : "s"} in the same building${more}</span></div>
      <ul class="why-same-list">${shown.map((m) => `<li>
        <span class="why-same-name">${esc(m.name)}</span>
        <span class="why-same-meta">${esc([m.suite, m.specialty, m.phone].filter(Boolean).join(" · "))}</span>
        ${m.claimedBy ? `<span class="why-same-tag why-same-held" title="${esc(m.status ? "Status: " + m.status : "Already claimed")}">Claimed by ${esc(m.claimedBy)}</span>` : '<span class="why-same-tag">Not claimed</span>'}
      </li>`).join("")}</ul>`;
  }

  function touchHtml(data) {
    const t = describeTouch(data && data.touch);
    if (!t) return "";
    return `<div class="why-same-head"><span class="why-chip why-${t.tone}" title="${esc(t.title)}"><span class="why-label">${esc(t.label)}</span>${esc(t.text)}</span></div>`;
  }

  function stateHtml(data) {
    const p = describeStatePattern(data && data.pattern);
    return p ? `<div class="why-same-head"><strong>Local pattern</strong> <span>${esc(p.text)}</span></div>` : "";
  }

  function ownerHtml(data, box) {
    if (!data || !data.matches || !data.matches.length) return "";
    const compact = box && box.dataset.compact;
    const shown = compact ? data.matches.slice(0, 3) : data.matches;
    const more = data.total > shown.length ? ` <span class="why-more">+${data.total - shown.length} more</span>` : "";
    return `<div class="why-same-head"><strong>Same owner elsewhere</strong> <span>${data.total} other business${data.total === 1 ? "" : "es"} with this owner${more}</span></div>
      <ul class="why-same-list">${shown.map((m) => `<li>
        <span class="why-same-name">${esc(m.name)}</span>
        <span class="why-same-meta">${esc([[m.city, m.state].filter(Boolean).join(", "), m.specialty, m.why].filter(Boolean).join(" \u00b7 "))}</span>
        ${m.claimedBy ? `<span class="why-same-tag why-same-held">Claimed by ${esc(m.claimedBy)}</span>` : '<span class="why-same-tag">Not claimed</span>'}
      </li>`).join("")}</ul>`;
  }

  function mixHtml(data, box) {
    const mix = data && data.mix;
    const d = describeMix(mix);
    const trend = describeTrend(data && data.trend);
    if (!d && !trend && !(data && data.enrollment)) return "";
    const compact = box && box.dataset.compact;
    const chips = [];
    if (d) chips.push({ tone: d.fit ? "high" : "none", label: "Fit", text: d.lead, title: "Based on what they bill Medicare for" });
    if (trend) chips.push(trend);
    const enrolled = describeEnrollment(data && data.enrollment);
    if (enrolled) chips.push(enrolled);
    describeTraits(mix).forEach((t) => chips.push({ tone: "none", ...t }));
    const chipHtml = chips.map((c) => `<span class="why-chip why-${c.tone}" title="${esc(c.title || "")}"><span class="why-label">${esc(c.label)}</span>${esc(c.text)}</span>`).join("");
    let body = "";
    if (d) {
      const segments = d.bars.filter((b) => b.pct >= 1).map((b, i) => `<span class="why-seg why-seg-${Math.min(i, 5)}" style="flex:${b.pct}" title="${esc(`${b.name}: ${b.pct}%`)}"></span>`).join("");
      body += `<div class="why-mix-bar" role="img" aria-label="Share of Medicare payments by product category">${segments}</div>`;
      if (!compact) {
        body += `<ul class="why-mix-list">${d.bars.map((b, i) => `<li><span class="why-seg-dot why-seg-${Math.min(i, 5)}"></span><span class="why-mix-name">${esc(b.name)}</span><span class="why-mix-pct">${b.pct < 1 ? "<1" : b.pct}%</span><span class="why-mix-pay">${esc(money(b.payment))}</span></li>`).join("")}</ul>`;
        if (d.products.length) body += `<div class="why-mix-top">Top items: ${d.products.map((p) => esc(`${p.code} ${p.name}`)).join("; ")}</div>`;
      } else {
        body += `<div class="why-mix-top">Mostly ${esc(d.bars.slice(0, 2).map((b) => `${b.name.toLowerCase()} ${b.pct}%`).join(", "))}</div>`;
      }
    }
    const shifts = describeShifts(data && data.shifts);
    if (shifts) body += `<div class="why-mix-top"><strong>${esc(shifts.previousYear)} to ${esc(shifts.year)}:</strong> ${esc(shifts.text)}</div>`;
    return `<div class="why-mix-head"><strong>What they bill Medicare for</strong> <span>${esc((d && d.year) || "")} data, estimated from CMS</span></div>
      <div class="why-chips why-mix-chips">${chipHtml}</div>${body}`;
  }

  async function loadInto(cache, path, npi, params, kind, toHtml, pick, cacheKey = npi) {
    try {
      if (!cache.has(cacheKey)) cache.set(cacheKey, apiGet(path, params));
      const data = pick(await cache.get(cacheKey));
      document.querySelectorAll(`.why-${kind}[data-${kind}-npi="${npi}"]`).forEach((box) => {
        const html = toHtml(data, box);
        if (html) { box.innerHTML = html; box.hidden = false; }
      });
    } catch (err) {
      cache.delete(cacheKey);
      console.log(`[whycall] ${path}: ${err.message}`);
    }
  }

  // Called when a card opens, and again by the call panel after each redraw (answers come from the cache).
  root.dmeHooks.whyCallOpened = (company) => {
    if (!company || !company.npi || typeof apiGet !== "function") return;
    const npi = String(company.npi);
    const exclude = (company.locations || []).map((l) => l && l.npi).filter((n) => n && String(n) !== npi).join(",");
    loadInto(mixCache, "companies/product-mix", npi, { npi }, "mix", mixHtml, (d) => d);
    loadInto(mixCache, "companies/product-mix", npi, { npi }, "snap", snapHtml, (d) => d);
    loadInto(sameCache, "companies/same-address", npi, { npi, exclude }, "same", sameHtml, (d) => d);
    loadInto(ownerCache, "companies/same-owner", npi, { npi, exclude }, "owner", ownerHtml, (d) => d);
    loadInto(touchCache, "leads/last-touch", npi, { npi }, "touch", touchHtml, (d) => d);
    const place = company.address && company.address.state;
    if (place) loadInto(stateCache, "companies/state-pattern", npi, { state: place }, "state", stateHtml, (d) => d, place);
  };
})(typeof window !== "undefined" ? window : globalThis);
