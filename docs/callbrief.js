/* Call brief: a short, rule-based briefing for the call, built only from what the app already knows about the
   lead (registry and Medicare data, the product mix and trend from CMS, who else is at the address, team
   notes and tags, and earlier calls). No AI and no outside service: the same lead always gives the same brief.
   buildCallBrief() is pure (tested in worker/test/callbrief.test.js); the rest gathers the extra facts and shows
   the result through window.dmeHooks.briefHtml. Loaded after whycall.js and leadnotes.js. */
(function (root) {
  "use strict";

  const HIGH_PAYMENT = 100000;
  const MID_PAYMENT = 10000;
  const HIGH_CLAIMS = 500;
  const MID_CLAIMS = 100;

  const money = (n) => {
    const v = Math.round(Number(n));
    if (v >= 1000000) return `$${(v / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
    if (v >= 1000) return `$${Math.round(v / 1000)}k`;
    return `$${v}`;
  };
  const num = (n) => Number(n).toLocaleString();
  const firstName = (full) => String(full || "").trim().split(/\s+/)[0] || "";
  const lower = (s) => String(s || "").toLowerCase();
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + "s"}`;

  // The facts the script is chosen from.
  function signalsOf(input) {
    const c = input.company || {};
    const med = c.medicare || null;
    const pay = med && med.medicarePayment != null ? Number(med.medicarePayment) : null;
    const claims = med && med.totalClaims != null ? Number(med.totalClaims) : null;
    const trend = input.trend || null;
    const mix = input.mix || null;
    const dm = (c.decisionMakers || []).find((d) => d && d.name) || null;
    const pickup = c.pickup || null;
    let volume = "none";
    if (med) volume = pay >= HIGH_PAYMENT || claims >= HIGH_CLAIMS ? "high" : pay >= MID_PAYMENT || claims >= MID_CLAIMS ? "mid" : "low";
    return {
      pay, claims, volume,
      growing: Boolean(trend && (trend.direction === "new" || trend.direction === "up")),
      shrinking: Boolean(trend && (trend.direction === "down" || trend.direction === "stopped")),
      rental: Boolean(mix && typeof mix.rentalShare === "number" && mix.rentalShare >= 0.5),
      verticals: mix && Array.isArray(mix.verticals) ? mix.verticals.map((v) => v.label) : [],
      topCategory: mix && mix.categories && mix.categories[0] ? String(mix.categories[0].name) : "",
      individual: c.isOrganization === false,
      noWebsite: !c.website,
      branches: Array.isArray(c.locations) ? c.locations.length : 0,
      sameBuilding: input.same && input.same.total ? input.same.total : 0,
      contact: dm,
      noDirect: !dm || !String(dm.phone || "").trim(),
      neverPickedUp: Boolean(pickup && pickup.total >= 2 && pickup.answered === 0),
    };
  }

  function trendText(trend) {
    if (!trend || !Array.isArray(trend.points) || !trend.points.length) return "";
    const years = trend.points.map((p) => `${p.year} ${money(p.payment)}`).join(" → ");
    const pct = trend.change == null ? "" : `${trend.change >= 0 ? "+" : "−"}${Math.round(Math.abs(trend.change) * 100)}%`;
    switch (trend.direction) {
      case "new": return `Ramping up fast (${years})`;
      case "up": return `Growing ${pct} (${years})`;
      case "down": return `Shrinking ${pct} (${years})`;
      case "stopped": return `Not in the latest Medicare file (last seen ${trend.latestYear})`;
      case "single": return `First year on file (${years})`;
      default: return `Steady (${years})`;
    }
  }

  function ageText(iso, now) {
    const t = Date.parse(iso);
    if (!iso || Number.isNaN(t)) return "";
    const months = Math.max(0, Math.floor((now - t) / (30.44 * 24 * 60 * 60 * 1000)));
    if (months < 1) return "this month";
    if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }

  function factsOf(input, sig, now) {
    const c = input.company || {};
    const facts = [];
    const add = (label, text) => { if (text) facts.push({ label, text }); };

    // Who to ask for, and when
    const dm = sig.contact;
    const numbers = [];
    if (dm && String(dm.phone || "").trim()) numbers.push(`direct ${String(dm.phone).trim()}`);
    if (String(c.phone || "").trim()) numbers.push(`main line ${String(c.phone).trim()}`);
    if (dm) add("Ask for", `${dm.name}${dm.title ? `, ${dm.title}` : ""}${numbers.length ? ` (${numbers.join(", ")})` : ""}`);
    else add("Ask for", `No decision maker on file: ask the front desk for the owner or manager${numbers.length ? ` (${numbers.join(", ")})` : ""}`);
    if (input.local && input.local.label) add("Timing", input.local.label);

    // Money
    if (c.medicare && c.medicare.totalClaims != null) {
      const m = c.medicare;
      add("Medicare", [m.medicarePayment != null ? `${money(m.medicarePayment)} paid` : "", `${num(m.totalClaims)} claims`, m.totalBeneficiaries != null ? `${num(m.totalBeneficiaries)} patients` : ""].filter(Boolean).join(", "));
    } else {
      add("Medicare", "No Medicare billing found (small, new, or not a Medicare supplier)");
    }
    add("Trend", trendText(input.trend));

    // What they sell
    const mix = input.mix;
    if (mix && mix.categories && mix.categories.length) {
      const top = mix.categories.slice(0, 2).map((x) => `${lower(x.name)} ${Math.round(x.share * 100)}%`).join(", ");
      add("Sells", `${sig.verticals.length ? `In your verticals (${sig.verticals.join(", ")}). ` : "Not in your verticals. "}Mostly ${top}`);
      const extras = [];
      if (typeof mix.rentalShare === "number" && mix.total > 0) extras.push(`${Math.round(mix.rentalShare * 100)}% rentals`);
      if (mix.area && mix.area.category) extras.push(mix.area.category.toLowerCase());
      add("Billing", extras.join(", "));
    }

    // The business
    const biz = [];
    if (c.isOrganization === true) biz.push("a company (NPI-2)");
    if (c.isOrganization === false) biz.push("an individual or sole proprietor (NPI-1)");
    if (sig.branches > 1) biz.push(`${sig.branches} locations`);
    if (sig.sameBuilding) biz.push(`${plural(sig.sameBuilding, "other provider")} at the same address`);
    const registry = ageText(c.lastUpdated, now);
    if (registry) biz.push(`registry updated ${registry}`);
    if (!c.website) biz.push("no website found");
    add("Business", biz.join(", "));

    // What the team already knows
    const history = [];
    const pickup = c.pickup;
    if (pickup && pickup.total > 0) history.push(`answered ${pickup.answered} of ${plural(pickup.total, "logged call")}`);
    const prior = c.priorContact;
    if (prior) history.push(`worked before${prior.by ? ` by ${prior.by}` : ""}${prior.at ? ` on ${prior.at}` : ""}${prior.status ? ` (${prior.status})` : ""}${prior.note ? `: ${prior.note}` : ""}`);
    if (input.claimed && input.claimed.status && lower(input.claimed.status) !== "new") history.push(`status: ${lower(input.claimed.status)}`);
    add("History", history.join("; "));
    const tags = (input.notes && input.notes.tags ? input.notes.tags : []).map((t) => t.tag);
    if (tags.length) add("Team tags", tags.join(", "));
    const comments = (input.notes && input.notes.comments ? input.notes.comments : []).slice(0, 3);
    comments.forEach((cm, i) => add(i === 0 ? "Team notes" : "", `${cm.text} (${cm.by})`));
    if (input.claimed && input.claimed.notes) {
      const lines = String(input.claimed.notes).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2);
      lines.forEach((l, i) => add(i === 0 ? "Call log" : "", l));
    }
    return facts;
  }

  // The script: each part is chosen by the strongest signal for that lead, in a fixed order.
  function scriptOf(input, sig) {
    const c = input.company || {};
    const who = firstName(sig.contact && sig.contact.name);
    const place = [c.address && c.address.city, c.address && c.address.state].filter(Boolean).join(", ");
    const sells = sig.verticals.length ? sig.verticals.join(" and ") : sig.topCategory ? lower(sig.topCategory) : lower(c.taxonomy && c.taxonomy.description) || "DME";

    const opening = `Hi${who ? ` ${who}` : ""}, this is [your name] with DME Desk. I'm calling suppliers in ${place || "your area"} that handle ${sells}, and ${c.name || "your company"} came up. Do you have two minutes?`;

    let pain;
    if (sig.growing) pain = "Their Medicare billing is climbing, so more patients are calling and the phones are likely stretched.";
    else if (sig.volume === "high") pain = `At ${sig.pay != null ? `about ${money(sig.pay)} in Medicare payments` : `${num(sig.claims)} claims`}, every missed or slow-answered call costs real money.`;
    else if (sig.rental) pain = "Mostly rental billing means steady resupply and follow-up calls from patients, which pull staff away from other work.";
    else if (sig.branches > 1 || sig.sameBuilding) pain = "More than one office or team at the address means calls get routed inconsistently and some go unanswered.";
    else if (sig.individual) pain = "An owner-operator answers their own phone and misses calls while with patients or out on deliveries.";
    else if (sig.noWebsite) pain = "With no website, the phone is the only way a patient reaches them, so a missed call is a lost patient.";
    else if (sig.shrinking) pain = "Medicare billing has dropped, so they can't afford to lose the calls that remain.";
    else pain = "Small supplier teams miss calls when everyone is busy with deliveries, intake and paperwork.";

    let talking;
    if (sig.verticals.length) talking = `DME Desk answers every call like a front desk, takes the ${sig.verticals.join(" or ")} patient's details, and sends the team a clean summary, so nothing is lost.`;
    else talking = "DME Desk answers every call like a front desk, takes the caller's details, and sends the team a clean summary, so nothing is lost.";
    if (sig.neverPickedUp) talking += " Earlier calls here went unanswered: mention that you tried and offer a time they choose.";

    let question;
    if (sig.rental) question = "How do you handle resupply and rental follow-up calls today, and who takes them?";
    else if (sig.growing) question = "Billing has grown a lot recently. Who is answering the phones now, and is it keeping up?";
    else if (sig.branches > 1 || sig.sameBuilding) question = "When a call comes in, how does it get to the right person across your locations?";
    else if (sig.individual) question = "When you're with a patient or out on a delivery, what happens to the calls that come in?";
    else question = "Who answers your phones when the team is out on deliveries or at lunch?";

    let objection;
    if (sig.individual) objection = "“I handle my calls myself.” Response: “That's exactly who this is for: it covers the calls you can't pick up while you're with patients.”";
    else if (sig.neverPickedUp) objection = "“Now's not a good time.” Response: “Understood. When is better? Two minutes at a time you choose.”";
    else if (sig.volume === "low" || sig.volume === "none") objection = "“We're too small for this.” Response: “Small teams miss the most calls because everyone does three jobs.”";
    else objection = "“We already have a receptionist.” Response: “DME Desk backs them up when they're on another line, at lunch, or after hours.”";

    return [
      { label: "Opening line", text: opening },
      { label: "Likely pain point", text: pain },
      { label: "Talking point", text: talking },
      { label: "Discovery question", text: question },
      { label: "Likely objection", text: objection },
    ];
  }

  function buildCallBrief(input) {
    const now = input && input.now != null ? input.now : Date.now();
    const safe = input || {};
    const sig = signalsOf(safe);
    return { title: (safe.company && safe.company.name) || "Lead", facts: factsOf(safe, sig, now), script: scriptOf(safe, sig), signals: sig };
  }

  // Plain text for pasting into a note or message.
  function briefToText(brief) {
    const facts = brief.facts.map((f) => (f.label ? `${f.label}: ${f.text}` : `  ${f.text}`)).join("\n");
    const script = brief.script.map((s, i) => `${i + 1}. ${s.label}: ${s.text}`).join("\n");
    return `${brief.title}\n\nWhat we know\n${facts}\n\nCall plan\n${script}`;
  }

  const api = { buildCallBrief, briefToText, trendText };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.dmeCallBrief = api;

  /* ---------------- browser wiring ---------------- */
  if (typeof document === "undefined" || !root.dmeHooks) return;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const texts = new Map(); // npi -> plain text of the latest brief, for the Copy button

  function briefHtml(brief, key) {
    texts.set(key, briefToText(brief));
    return `<div class="brief-sections">
      <div class="brief-group"><h5>What we know</h5>
        <dl class="brief-facts">${brief.facts.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.text)}</dd></div>`).join("")}</dl></div>
      <div class="brief-group"><h5>Call plan</h5>
        <ol class="brief-plan">${brief.script.map((s) => `<li><strong>${esc(s.label)}</strong><span>${esc(s.text)}</span></li>`).join("")}</ol></div>
      <div class="brief-actions"><button type="button" class="text-action" data-brief-copy="${esc(key)}">Copy brief</button>
        <span class="muted-note">Built from this lead's own data. No AI.</span></div>
    </div>`;
  }

  // company: the lead in Prospect-card shape. claimed: { status, notes } for a claimed lead (optional).
  root.dmeHooks.briefHtml = async (company, claimed) => {
    const npi = String(company.npi || "");
    const ask = (path, params) => (typeof apiGet === "function" && npi ? apiGet(path, params) : Promise.reject(new Error("offline")));
    const [mixRes, sameRes, notesRes] = await Promise.allSettled([
      ask("companies/product-mix", { npi }),
      ask("companies/same-address", { npi }),
      ask("leads/annotations", { npi }),
    ]);
    const val = (r) => (r.status === "fulfilled" ? r.value : null);
    const state = company.address && company.address.state;
    const brief = buildCallBrief({
      company,
      mix: val(mixRes) && val(mixRes).mix,
      trend: val(mixRes) && val(mixRes).trend,
      same: val(sameRes),
      notes: val(notesRes),
      claimed,
      local: root.dmeTime && state ? root.dmeTime.localInfo(state) : null,
    });
    return briefHtml(brief, npi || "lead");
  };

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-brief-copy]");
    if (!btn) return;
    e.stopPropagation();
    const text = texts.get(btn.dataset.briefCopy);
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => showToast("Copied the brief"), () => showToast("Couldn't copy the brief", true));
    else showToast("Couldn't copy the brief", true);
  }, true);
})(typeof window !== "undefined" ? window : globalThis);
