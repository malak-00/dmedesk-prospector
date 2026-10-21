/* Call brief: a short, rule-based briefing for a business-development call (signing the supplier with the
   outsourcing company), built only from what the app already knows about the
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
    const age = ageOfLead(c.enumerationDate, input.now != null ? input.now : Date.now());
    return {
      pay, claims, volume,
      isNew: Boolean(age && age.kind === "new"),
      growing: Boolean(trend && (trend.direction === "new" || trend.direction === "up")),
      shrinking: Boolean(trend && (trend.direction === "down" || trend.direction === "stopped")),
      rental: Boolean(mix && typeof mix.rentalShare === "number" && mix.rentalShare >= 0.5),
      verticals: mix && Array.isArray(mix.verticals) ? mix.verticals.map((v) => v.label) : [],
      topCategory: mix && mix.categories && mix.categories[0] ? String(mix.categories[0].name) : "",
      individual: c.isOrganization === false,
      noWebsite: !c.website,
      branches: Array.isArray(c.locations) ? c.locations.length : 0,
      sameBuilding: input.same && input.same.total ? input.same.total : 0,
      ownerOthers: input.owner && input.owner.total ? input.owner.total : 0,
      ownerNames: input.owner && input.owner.matches ? input.owner.matches.slice(0, 3).map((m) => m.name).filter(Boolean) : [],
      intel: input.intel && input.intel.installed !== false ? input.intel : null,
      contact: dm,
      noDirect: !dm || !String(dm.phone || "").trim(),
      neverPickedUp: Boolean(pickup && pickup.total >= 2 && pickup.answered === 0),
    };
  }

  // How long the provider has had its NPI (docs/leadage.js): new, established, or neither.
  function ageOfLead(enumerationDate, now) {
    const lib = root.dmeLeadAge || (typeof require === "function" ? require("./leadage.js") : null);
    return lib ? lib.ageOf(enumerationDate, now) : null;
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
    const direct = (dm && String(dm.phone || "").trim()) || (sig.intel && sig.intel.directLine) || "";
    if (direct) numbers.push(`direct ${direct}`);
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
    const age = ageOfLead(c.enumerationDate, now);
    if (age) biz.push(age.kind === "new" ? `a new supplier (NPI since ${age.registered})` : age.kind === "established" ? `established (NPI since ${age.registered})` : `NPI since ${age.registered}`);
    if (c.isOrganization === true) biz.push("a company (NPI-2)");
    if (c.isOrganization === false) biz.push("an individual or sole proprietor (NPI-1)");
    if (sig.branches > 1) biz.push(`${sig.branches} locations`);
    if (sig.sameBuilding) biz.push(`${plural(sig.sameBuilding, "other provider")} at the same address`);
    if (sig.ownerOthers) biz.push(`the owner also runs ${plural(sig.ownerOthers, "other business", "other businesses")}${sig.ownerNames.length ? ` (${sig.ownerNames.join(", ")})` : ""}`);
    const registry = ageText(c.lastUpdated, now);
    if (registry) biz.push(`registry updated ${registry}`);
    if (!c.website) biz.push("no website found");
    add("Business", biz.join(", "));

    // What reps learned on earlier calls (the call intel fields)
    const intel = sig.intel;
    if (intel) {
      add("Current biller", intel.currentBiller);
      add("Gatekeeper", intel.gatekeeper);
      add("Direct line", intel.directLine);
      add("Email", intel.email);
      add("Size", intel.patientVolume);
      add("Main objection", intel.objection);
    }

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

  // The call plan: a business-development call to get the supplier to sign with the outsourcing company, which
  // runs a supplier's full back office (intake and verification, prior authorizations, billing and denials, patient
  // calls and resupply). Shaped by what cold-call research agrees on: say who you are, why you are calling and how long
  // it will take; do not pitch the front desk; ask a few questions before pitching; answer a pushback by agreeing with
  // it, asking a question, and offering a small next step (never criticising what they use today); close on two
  // specific times. Each part is chosen by the strongest signal for that lead, in a fixed order.
  const COMPANY = "[company name]";

  function scriptOf(input, sig) {
    const c = input.company || {};
    const who = firstName(sig.contact && sig.contact.name);
    const place = [c.address && c.address.city, c.address && c.address.state].filter(Boolean).join(", ");
    const sells = sig.verticals.length ? sig.verticals.join(" and ") : sig.topCategory ? lower(sig.topCategory) : lower(c.taxonomy && c.taxonomy.description) || "DME";
    const name = c.name || "your company";

    const opening = `Hi${who ? ` ${who}` : ""}, this is [your name] with ${COMPANY}. I'll be quick: about 30 seconds on why I called, and then you tell me if it's worth going on. We take billing, prior authorizations and patient calls off DME suppliers' plates, and ${name}${place ? ` in ${place}` : ""} came up because you supply ${sells}.`;

    const intel = sig.intel || {};
    const gk = firstName(intel.gatekeeper);
    const frontDesk = gk
      ? `The front desk is usually ${intel.gatekeeper}: greet ${gk} by name, say it's a business matter for ${who || "the owner"} about billing and back-office support, and ask when ${who || "they"} can be reached. Do not pitch the front desk.`
      : who
      ? `\u201CIt's a business matter for ${who} about billing and back-office support. Is ${who} available, or when is a better time to reach them?\u201D Do not pitch the front desk.`
      : "\u201CCould you tell me who looks after billing and the back office? It's a business matter, and I'd like to ask for them by name.\u201D Do not pitch the front desk.";

    let pain;
    if (sig.growing) pain = "Their Medicare billing is climbing, and back-office work (verifications, prior auths, claims, denials) grows faster than the team that does it.";
    else if (sig.isNew) pain = "A newer supplier is likely still building its back office and choosing vendors, so this is the time to be part of the setup.";
    else if (sig.volume === "high") pain = `At ${sig.pay != null ? `about ${money(sig.pay)} in Medicare payments` : `${num(sig.claims)} claims`}, slow claims follow-up and unworked denials leave real money uncollected.`;
    else if (sig.rental) pain = "Mostly rental billing means recurring monthly claims, resupply follow-up and compliance paperwork that never stops.";
    else if (sig.branches > 1 || sig.sameBuilding) pain = "More than one office or team at the address means back-office work is split and duplicated, and things fall between people.";
    else if (sig.individual) pain = "An owner-operator does billing, intake and paperwork personally, on top of patients and deliveries.";
    else if (sig.shrinking) pain = "Medicare billing has dropped, so every dollar of in-house overhead matters more.";
    else if (sig.volume === "low" || sig.volume === "none") pain = "A small team covers intake, verification and billing with the same few people, so something always waits.";
    else pain = "Supplier teams lose hours every week to verifications, prior authorizations and billing follow-up instead of growing.";

    const scope = sig.verticals.length ? `the ${sig.verticals.join(" and ")} paperwork, ` : "";
    let talking = `${COMPANY} works as an extension of your team: we take on ${scope}intake and benefits verification, prior authorizations, billing and denials follow-up, and patient and resupply calls, so your staff stay on patients and deliveries.`;
    if (sig.neverPickedUp) talking += " Earlier calls here went unanswered: mention that you tried and offer a time they choose.";

    // Ask before you pitch: one question picked for this lead, then three that suit any supplier.
    const base = [
      "Who handles verifications, prior authorizations and billing follow-up today?",
      "Roughly how many hours a week goes to chasing denials or missing documentation?",
      "Where does the work get stuck most: intake, authorizations, claims, or collections?",
    ];
    let first;
    if (sig.ownerOthers && sig.ownerNames.length) first = `I see you also run ${sig.ownerNames[0]}. Is the back office shared across your businesses?`;
    else if (sig.rental) first = "How do you keep track of monthly rental billing and resupply today?";
    else if (sig.growing) first = "Billing has grown a lot recently. Is your back office keeping up?";
    else if (sig.branches > 1 || sig.sameBuilding) first = "How is the back-office work split across your locations?";
    else if (sig.individual) first = "How many hours a week do you personally spend on billing and paperwork?";
    const questions = [first, ...base].filter(Boolean).slice(0, 4);

    // Every pushback: agree, ask, then a small next step. Nothing here criticises what they use today.
    const biller = intel.currentBiller && !/^in.?house$/i.test(intel.currentBiller) ? intel.currentBiller : "";
    const objections = [
      "\u201CNot interested.\u201D Agree: \u201CFair enough, I called out of the blue.\u201D Ask: \u201CIs the back office under control, or is it just not a priority right now?\u201D Next step: if it's priority, offer to send a one-page overview and call back in two weeks.",
      `${biller ? `\u201CWe already use ${biller}.\u201D` : "\u201CWe do it in-house\u201D or \u201CWe already have a biller.\u201D"} Agree: \u201CThat works for a lot of suppliers.\u201D Ask: \u201CWhat takes the most time, or what do you wish got done faster?\u201D Next step: we work alongside your people and can take just the overflow or the hardest part, like denials or prior authorizations. Offer a 15-minute call about that one part.`,
      sig.neverPickedUp
        ? "\u201CNot a good time.\u201D Agree: \u201CUnderstood.\u201D Ask: \u201CWhen is better, later this week?\u201D Next step: offer two times and say you'll email a short summary. Earlier calls here went unanswered, so confirm the best time of day."
        : "\u201CNot a good time\u201D or \u201CSend me an email.\u201D Agree: \u201CUnderstood.\u201D Ask: \u201CWhat would make it worth your time to look at?\u201D Next step: offer two times and say you'll email a short summary first.",
    ];
    const REPLY = {
      "price": "Agree: \u201CCost matters, and it should be weighed against what it saves.\u201D Ask: \u201CWhat would make it worth it: fewer denials, faster payment, or fewer hours?\u201D Next step: a 15-minute call to size it against their volume.",
      "in-house": "Agree: \u201CHaving it in-house gives you control.\u201D Ask: \u201CWhich part would you most like off your team's plate?\u201D Next step: offer to take just that part, alongside their staff.",
      "happy with current": "Agree: \u201CGood, a working setup is worth keeping.\u201D Ask: \u201CWhat do you wish got done faster?\u201D Next step: a short call about that one gap, with no change to what works.",
      "bad timing": "Agree: \u201CUnderstood, timing matters.\u201D Ask: \u201CWhen does it get quieter?\u201D Next step: set a specific callback date and send a short email now.",
      "not the decision maker": "Agree: \u201CThank you, that helps.\u201D Ask: \u201CWho decides on billing and back-office support, and when are they in?\u201D Next step: ask for their name and direct line, and note both.",
      "no need": "Agree: \u201CIf it's under control, that's good news.\u201D Ask: \u201CHow are denials and prior authorizations running?\u201D Next step: if there is a gap, offer a 15-minute call about it.",
      "other": "Agree with what they said, ask one question to understand it, then offer a 15-minute call.",
    };
    if (intel.objection && REPLY[intel.objection]) objections.unshift(`Last time they said: ${intel.objection}. ${REPLY[intel.objection]}`);
    if (sig.individual) objections.unshift("\u201CI do it all myself.\u201D Agree: \u201CMost owner-operators do.\u201D Ask: \u201CHow many hours a week does that take?\u201D Next step: a 15-minute call to look at which task to hand off first.");

    const close = `Offer two specific times, not \u201Clet me know\u201D: \u201CWould [day] at [time] or [day] at [time] work for a 15-minute call? I'll send a short email${intel.email ? ` to ${intel.email}` : ""} with what we covered.\u201D`;

    const voicemail = `\u201CHi${who ? ` ${who}` : ""}, this is [your name] with ${COMPANY}. I'm calling about billing and back-office support for ${sells} suppliers like ${name}. I'll try you again on [day], or you can reach me at [number]. Again, [your name], ${COMPANY}, [number].\u201D Keep it under 25 seconds.`;

    return [
      { label: "Opening line", text: opening },
      { label: "If the front desk asks", text: frontDesk },
      { label: "Likely pain point", text: pain },
      { label: "Talking point", text: talking },
      { label: "Questions to ask", items: questions },
      { label: "If they push back", items: objections },
      { label: "Close", text: close },
      { label: "Voicemail", text: voicemail },
    ];
  }

  // A short follow-up email to paste into a mail program: after a conversation, or after a voicemail / no answer.
  // Built from the same signals as the call plan; the rep fills the bracketed parts.
  function buildFollowUpEmail(input, variant) {
    const safe = input || {};
    const sig = signalsOf(safe);
    const c = safe.company || {};
    const who = firstName(sig.contact && sig.contact.name);
    const sells = sig.verticals.length ? sig.verticals.join(" and ") : sig.topCategory ? lower(sig.topCategory) : lower(c.taxonomy && c.taxonomy.description) || "DME";
    const intel = sig.intel || {};
    let hook;
    if (sig.growing) hook = `${c.name || "Your company"}'s Medicare billing has grown recently, and back-office work tends to grow with it.`;
    else if (sig.isNew) hook = "As a newer supplier, you may still be setting up your back office.";
    else if (sig.rental) hook = "Recurring rental billing and resupply follow-up add up quickly.";
    else if (sig.volume === "high") hook = "At your volume, unworked denials and slow claims follow-up can add up.";
    else hook = "Verifications, prior authorizations and billing follow-up take hours away from patients and deliveries.";
    const biller = intel.currentBiller && !/^in.?house$/i.test(intel.currentBiller) ? intel.currentBiller : "";
    const lines = [
      `Hi${who ? ` ${who}` : ""},`,
      "",
      variant === "missed" ? "I tried you earlier and didn't catch you, so I'll keep this short." : "Thanks for taking my call.",
      "",
      `I'm with ${COMPANY}. We run the back office for DME suppliers that supply ${sells}: intake and benefits verification, prior authorizations, billing and denials follow-up, and patient and resupply calls. ${hook}`,
      biller ? `We often work alongside an existing biller such as ${biller}, taking just the part that is hardest to keep up with.` : "We can work alongside your current team and take just the part that is hardest to keep up with.",
      "",
      "Would [day] at [time] or [day] at [time] work for a 15-minute call?",
      "",
      "Best,",
      "[your name]",
      `${COMPANY} \u00b7 [number]`,
    ];
    return { to: intel.email || "", subject: variant === "missed" ? "Sorry I missed you" : "Following up on our call", body: lines.join("\n") };
  }

  function emailToText(email) {
    return `${email.to ? `To: ${email.to}\n` : ""}Subject: ${email.subject}\n\n${email.body}`;
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
    const script = brief.script.map((s, i) => (s.items ? `${i + 1}. ${s.label}:\n${s.items.map((t) => `   - ${t}`).join("\n")}` : `${i + 1}. ${s.label}: ${s.text}`)).join("\n");
    return `${brief.title}\n\nWhat we know\n${facts}\n\nCall plan\n${script}`;
  }

  const api = { buildCallBrief, buildFollowUpEmail, emailToText, briefToText, trendText };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.dmeCallBrief = api;

  /* ---------------- browser wiring ---------------- */
  if (typeof document === "undefined" || !root.dmeHooks) return;

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const texts = new Map(); // npi -> plain text of the latest brief, for the Copy button

  function briefHtml(brief, key, input) {
    texts.set(key, briefToText(brief));
    texts.set(`${key}:spoke`, emailToText(buildFollowUpEmail(input, "spoke")));
    texts.set(`${key}:missed`, emailToText(buildFollowUpEmail(input, "missed")));
    return `<div class="brief-sections">
      <div class="brief-group"><h5>What we know</h5>
        <dl class="brief-facts">${brief.facts.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.text)}</dd></div>`).join("")}</dl></div>
      <div class="brief-group"><h5>Call plan</h5>
        <ol class="brief-plan">${brief.script.map((s) => `<li><strong>${esc(s.label)}</strong>${s.items ? `<ul class="brief-sub">${s.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<span>${esc(s.text)}</span>`}</li>`).join("")}</ol></div>
      <div class="brief-actions"><button type="button" class="text-action" data-brief-copy="${esc(key)}">Copy brief</button>
        <button type="button" class="text-action" data-brief-copy="${esc(key)}:spoke" data-brief-what="the email">Copy email: after a call</button>
        <button type="button" class="text-action" data-brief-copy="${esc(key)}:missed" data-brief-what="the email">Copy email: after a voicemail</button>
        <span class="muted-note">Built from this lead's own data. No AI.</span></div>
    </div>`;
  }

  // company: the lead in Prospect-card shape. claimed: { status, notes } for a claimed lead (optional).
  root.dmeHooks.briefHtml = async (company, claimed) => {
    const npi = String(company.npi || "");
    const ask = (path, params) => (typeof apiGet === "function" && npi ? apiGet(path, params) : Promise.reject(new Error("offline")));
    const [mixRes, sameRes, notesRes, intelRes, ownerRes] = await Promise.allSettled([
      ask("companies/product-mix", { npi }),
      ask("companies/same-address", { npi }),
      ask("leads/annotations", { npi }),
      ask("leads/intel", { npi }),
      ask("companies/same-owner", { npi }),
    ]);
    const val = (r) => (r.status === "fulfilled" ? r.value : null);
    const state = company.address && company.address.state;
    const input = {
      company,
      mix: val(mixRes) && val(mixRes).mix,
      trend: val(mixRes) && val(mixRes).trend,
      same: val(sameRes),
      notes: val(notesRes),
      intel: val(intelRes),
      claimed,
      owner: val(ownerRes),
      local: root.dmeTime && state ? root.dmeTime.localInfo(state) : null,
    };
    return briefHtml(buildCallBrief(input), npi || "lead", input);
  };

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-brief-copy]");
    if (!btn) return;
    e.stopPropagation();
    const text = texts.get(btn.dataset.briefCopy);
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => showToast(`Copied ${btn.dataset.briefWhat || "the brief"}`), () => showToast(`Couldn't copy ${btn.dataset.briefWhat || "the brief"}`, true));
    else showToast("Couldn't copy the brief", true);
  }, true);
})(typeof window !== "undefined" ? window : globalThis);
