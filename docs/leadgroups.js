/* Business groups in the lead lists. Leads that belong to one business sit together under a header:
   the company name when the members share one name (the same company at several locations), or the
   authorized official's name when the company names differ but one person is behind them. A group of
   many leads is split under its company names (a second level) so it stays readable.
   The naming is pure and tested (worker/test/leadgroups.test.js); the rest draws the header rows and
   opens and closes them. The Claimed list gets its groups from the server (identity groups, sql/010);
   the Prospect list from the "related" clusters of related.js. */
(function (root) {
  "use strict";

  const LEGAL = new Set(["inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "pc", "pllc", "lp", "llp"]);
  const TITLES = new Set(["dr", "mr", "mrs", "ms", "md", "do", "dds", "jr", "sr", "ii", "iii", "owner", "ceo"]);
  const SMALL_WORDS = new Set(["inc", "corp", "co", "ltd", "the", "and", "for", "of", "med", "sun", "pro", "bay", "lab", "labs", "spa", "dr", "my", "new", "one", "two", "all", "day", "air", "gas", "sea", "usa"]);
  const BIG_GROUP = 12;      // this many leads (or 3+ company names) and the group gets a second level
  const OPEN_BY_DEFAULT = 4; // groups up to this size start open
  const SECTION_OPEN_MAX = 8; // a section of a big group starts open only when it is this small

  /* ---------------- naming (pure) ---------------- */

  // "H&R HEALTHCARE, LP", "H & R HEALTHCARE LP" and "H & R HEALTHCARE L P" are one company.
  function nameKey(raw) {
    let s = String(raw || "").toLowerCase().replace(/[.'’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    s = s.replace(/\bl l c\b/g, "llc").replace(/\bp l l c\b/g, "pllc").replace(/\bl l p\b/g, "llp").replace(/\bl p\b/g, "lp").replace(/\bp c\b/g, "pc");
    return s.split(" ").filter((t) => t && !LEGAL.has(t)).join(" ");
  }

  // Two or more real words, so "Smith" alone never links anything.
  function personKey(raw) {
    const words = String(raw || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !TITLES.has(w));
    return words.length >= 2 ? words.join(" ") : "";
  }

  // NPPES names arrive in capitals. Left alone if someone already cased them.
  function prettyName(raw) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text || /[a-z]/.test(text)) return text;
    return text.split(" ").map((word, i) => {
      const bare = word.replace(/[^A-Za-z&]/g, "");
      const lower = bare.toLowerCase();
      if (SMALL_WORDS.has(lower)) return i === 0 || !["the", "and", "for", "of"].includes(lower) ? cap(word) : word.toLowerCase();
      if (bare.length <= 3 && bare.length > 0) return word; // ADL, LLC, LP, H&R, PC stay as they are
      return cap(word);
    }).join(" ");
  }
  function cap(word) {
    return word.toLowerCase().replace(/(^|[-'’\/(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }

  function mostCommon(values) {
    const counts = new Map();
    values.forEach((v) => { if (v) counts.set(v, (counts.get(v) || 0) + 1); });
    let best = ""; let bestN = 0;
    counts.forEach((n, v) => { if (n > bestN) { best = v; bestN = n; } });
    return { value: best, count: bestN };
  }

  function statesLine(states) {
    const list = [...new Set(states.filter(Boolean))].sort();
    if (list.length <= 4) return list.join(", ");
    return `${list.slice(0, 4).join(", ")} +${list.length - 4}`;
  }

  // "3 new, 1 voicemail": the statuses in a group, most common first.
  function statusSummary(statuses) {
    const counts = new Map();
    statuses.forEach((s) => { const k = String(s || "new").toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([status, n]) => ({ status, n }));
  }

  // acc: { name, official, state, city, status, due } -> each reads one thing from a member.
  // `indexes` are the members' positions in the list on screen.
  function describeGroup(items, indexes, acc, why) {
    const members = indexes.map((i) => items[i]);
    const sectionStatuses = (idx) => statusSummary(idx.map((i) => (acc.status ? acc.status(items[i]) : "")));
    const rows = members.map((m, p) => ({
      index: indexes[p], name: acc.name(m) || "", key: nameKey(acc.name(m)),
      official: acc.official ? acc.official(m) || "" : "", state: acc.state ? acc.state(m) || "" : "",
      city: acc.city ? acc.city(m) || "" : "",
    }));
    const n = rows.length;
    const distinctNames = new Set(rows.map((r) => r.key || r.name.toLowerCase())).size;
    const states = rows.map((r) => r.state);
    const places = statesLine(states);

    // Same-name clusters, biggest first. A name with one lead is not a cluster.
    const byKey = new Map();
    rows.forEach((r) => { const k = r.key || r.name.toLowerCase(); byKey.set(k, [...(byKey.get(k) || []), r]); });
    const clusters = [...byKey.values()].filter((c) => c.length >= 2)
      .sort((a, b) => b.length - a.length || a[0].name.localeCompare(b[0].name))
      .map((c) => ({ title: prettyName(mostCommon(c.map((r) => r.name)).value), indexes: c.map((r) => r.index), statuses: sectionStatuses(c.map((r) => r.index)) }));
    const clustered = new Set(clusters.flatMap((c) => c.indexes));
    const rest = rows.filter((r) => !clustered.has(r.index)).map((r) => r.index);

    let kind; let title; let subtitle;
    const person = mostCommon(rows.map((r) => personKey(r.official)));
    if (distinctNames === 1) {
      kind = "name";
      title = prettyName(mostCommon(rows.map((r) => r.name)).value);
      const cities = [...new Set(rows.map((r) => r.city).filter(Boolean))];
      const where = new Set(states.filter(Boolean)).size > 1 ? places : cities.slice(0, 3).join(", ");
      subtitle = `${n} locations${where ? ` · ${where}` : ""}`;
    } else if (person.value && person.count / n >= 0.6) {
      kind = "official";
      const display = rows.find((r) => personKey(r.official) === person.value).official;
      title = prettyName(display);
      subtitle = `Authorized official · ${n} businesses${distinctNames < n ? ` · ${distinctNames} company names` : ""}${places ? ` · ${places}` : ""}`;
    } else {
      kind = "mixed";
      title = prettyName(mostCommon(rows.map((r) => r.name)).value) || "Related businesses";
      subtitle = `${n} related businesses${why ? ` · ${why}` : ""}${places ? ` · ${places}` : ""}`;
    }
    return {
      kind, title, subtitle, count: n, states: places,
      statuses: statusSummary(members.map((m) => (acc.status ? acc.status(m) : ""))),
      due: acc.due ? members.filter((m) => acc.due(m)).length : 0,
      big: n >= BIG_GROUP || distinctNames >= 3,
      clusters, rest, restStatuses: sectionStatuses(rest),
    };
  }

  // The order members are drawn in. A big group is split into sections (one per repeated company name,
  // then "Other companies") so it can be read and folded a section at a time. One company covering the
  // whole group needs no section of its own: the group header already says it.
  function layoutGroup(desc, indexes) {
    const flat = !desc.big || desc.clusters.length === 0 || (desc.clusters.length === 1 && desc.rest.length === 0);
    if (flat) return indexes.map((index) => ({ index }));
    const parts = [];
    desc.clusters.forEach((c, k) => {
      parts.push({ sub: `${c.title} \u00b7 ${c.indexes.length} locations`, key: `c${k}`, count: c.indexes.length, statuses: c.statuses });
      c.indexes.forEach((index) => parts.push({ index, key: `c${k}` }));
    });
    if (desc.rest.length) {
      parts.push({ sub: `Other companies \u00b7 ${desc.rest.length}`, key: "rest", count: desc.rest.length, statuses: desc.restStatuses });
      desc.rest.forEach((index) => parts.push({ index, key: "rest" }));
    }
    return parts;
  }
  /* ---------------- accessors for the two lists ---------------- */

  const accessors = {
    claimed: {
      name: (l) => l.name,
      official: (l) => (String(l.contactSource || "").toLowerCase() === "nppes" ? l.contactName : ""),
      state: (l) => l.state, city: (l) => l.city, status: (l) => l.status,
      due: (l) => Boolean(l.reminderAt) && Date.parse(l.reminderAt) < Date.now(),
    },
    prospect: {
      name: (c) => c.name,
      official: (c) => {
        const dms = c.decisionMakers || [];
        return (dms.find((d) => d && d.source === "nppes") || dms[0] || {}).name;
      },
      state: (c) => c.address && c.address.state, city: (c) => c.address && c.address.city,
    },
  };

  // Claimed: the server sent whole groups, so a group is every lead that shares a groupId.
  function claimedGroups(leads) {
    const byId = new Map();
    leads.forEach((l, i) => { if (l.groupId) byId.set(l.groupId, [...(byId.get(l.groupId) || []), i]); });
    return [...byId.entries()].filter(([, idx]) => idx.length >= 2)
      .map(([id, indexes]) => ({ id, indexes, desc: describeGroup(leads, indexes, accessors.claimed) }));
  }

  // Prospect: clusters from related.js ({ clusters: [[index...]], relation(i, j) }).
  function prospectGroups(companies, info) {
    return (info.clusters || []).filter((idx) => idx.length >= 2).map((indexes) => {
      const first = companies[indexes[0]] || {};
      return {
        id: `p:${first.npi || indexes[0]}`, indexes,
        desc: describeGroup(companies, indexes, accessors.prospect, info.relation ? info.relation(indexes[0], indexes[1]) : ""),
      };
    });
  }

  const api = { nameKey, personKey, prettyName, describeGroup, layoutGroup, statusSummary, statesLine, claimedGroups, prospectGroups, OPEN_BY_DEFAULT };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.dmeGroups = api;

  /* ---------------- drawing (browser only) ---------------- */

  if (typeof document === "undefined") return;

  const OPEN_KEY = "dmeGroupsOpen";
  let choices = {};
  try { choices = JSON.parse(sessionStorage.getItem(OPEN_KEY) || "{}") || {}; } catch { choices = {}; }
  function remember(id, open) {
    choices[id] = open;
    const keys = Object.keys(choices);
    if (keys.length > 600) delete choices[keys[0]];
    try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(choices)); } catch { /* not remembered */ }
  }
  const isOpen = (id, size) => (Object.prototype.hasOwnProperty.call(choices, id) ? Boolean(choices[id]) : size <= OPEN_BY_DEFAULT);
  const isSectionOpen = (id, size) => (Object.prototype.hasOwnProperty.call(choices, id) ? Boolean(choices[id]) : size <= SECTION_OPEN_MAX);
  const esc = (v) => (typeof escapeHtml === "function" ? escapeHtml(v) : String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

  // index -> group id for what is on screen, so other badges can stay quiet when a header says it all.
  const shown = { claimed: new Map(), prospect: new Map() };

  function headerHtml(group, open, colspan) {
    const d = group.desc;
    const chips = d.statuses.slice(0, 3).map((s) => `${s.n} ${esc(s.status)}`).join(" · ");
    return `<tr class="group-row${open ? " is-open" : ""}" data-group-head="${esc(group.id)}" tabindex="0" role="button" aria-expanded="${open}">
      <td colspan="${colspan}"><div class="group-head">
        <span class="group-chev" aria-hidden="true">▸</span>
        <div class="group-main"><div class="group-title">${esc(d.title)}</div><div class="group-sub">${esc(d.subtitle)}</div></div>
        <div class="group-side">
          ${d.due ? `<span class="group-due">${d.due} due</span>` : ""}
          ${chips ? `<span class="group-status">${chips}</span>` : ""}
          <span class="group-count">${d.count} leads</span>
        </div>
      </div></td></tr>`;
  }

  function subHeaderHtml(group, part, groupOpen, sectionOpen, colspan) {
    const sid = `${group.id}|${part.key}`;
    const chips = (part.statuses || []).slice(0, 3).map((s) => `${s.n} ${esc(s.status)}`).join(" \u00b7 ");
    return `<tr class="subgroup-row${sectionOpen ? " is-open" : ""}${groupOpen ? "" : " group-collapsed"}" data-group="${esc(group.id)}" data-subgroup-head="${esc(sid)}" tabindex="0" role="button" aria-expanded="${sectionOpen}"><td colspan="${colspan}"><div class="subgroup-head"><span class="group-chev" aria-hidden="true">\u25b8</span><span class="subgroup-title">${esc(part.sub)}</span>${chips ? `<span class="subgroup-meta">${chips}</span>` : ""}</div></td></tr>`;
  }

  // sameName: the company name is already the header, so each lead is told apart by where it is.
  function mark(html, id, open, sid, sectionOpen, sameName) {
    let out = html.replace("<tr ", `<tr data-group="${esc(id)}"${sid ? ` data-subgroup="${esc(sid)}"` : ""} `);
    return out.replace('class="lead-row', `class="lead-row group-member${sameName ? " grp-same-name" : ""}${open ? "" : " group-collapsed"}${sid && !sectionOpen ? " sub-collapsed" : ""}`);
  }
  // The table body for a list: plain rows, with each group's rows gathered under its header.
  function rowsHtml(kind, items, rowHtml, groups, colspan) {
    shown[kind] = new Map();
    const owner = new Map();
    groups.forEach((g) => g.indexes.forEach((i) => { owner.set(i, g); shown[kind].set(i, g.id); }));
    const done = new Set();
    const out = [];
    items.forEach((item, i) => {
      const g = owner.get(i);
      if (!g) { out.push(rowHtml(item, i)); return; }
      if (done.has(g.id)) return;
      done.add(g.id);
      const open = isOpen(g.id, g.indexes.length);
      out.push(headerHtml(g, open, colspan));
      let sid = null;
      let sectionOpen = true;
      layoutGroup(g.desc, g.indexes).forEach((part) => {
        if (part.sub) {
          sid = `${g.id}|${part.key}`;
          sectionOpen = isSectionOpen(sid, part.count);
          out.push(subHeaderHtml(g, part, open, sectionOpen, colspan));
        } else {
          out.push(mark(rowHtml(items[part.index], part.index), g.id, open, part.key ? sid : null, sectionOpen, g.desc.kind === "name"));
        }
      });
      // Space after the group, so the next lead is plainly outside it.
      out.push(`<tr class="group-gap" aria-hidden="true"><td colspan="${colspan}"></td></tr>`);
    });
    return out.join("");
  }

  function closeDetailOf(row) {
    const claimedIdx = row.dataset.claimedIndex;
    if (claimedIdx !== undefined && typeof collapseClaimedRow === "function") {
      if (state.claimedExpandedIndex === Number(claimedIdx)) { collapseClaimedRow(Number(claimedIdx)); state.claimedExpandedIndex = null; }
    } else if (row.dataset.index !== undefined && typeof collapseRow === "function") {
      if (state.expandedIndex === Number(row.dataset.index)) { collapseRow(Number(row.dataset.index)); state.expandedIndex = null; }
    }
  }

  function setOpen(id, open) {
    remember(id, open);
    const sel = (css) => document.querySelectorAll(css);
    const safe = window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
    sel(`tr[data-group-head="${safe}"]`).forEach((h) => { h.classList.toggle("is-open", open); h.setAttribute("aria-expanded", String(open)); });
    sel(`tr[data-group="${safe}"]`).forEach((r) => {
      if (!open && r.classList.contains("lead-row")) closeDetailOf(r);
      r.classList.toggle("group-collapsed", !open);
    });
  }

  function setSectionOpen(sid, open) {
    remember(sid, open);
    const safe = window.CSS && CSS.escape ? CSS.escape(sid) : sid.replace(/"/g, '\\"');
    document.querySelectorAll(`tr[data-subgroup-head="${safe}"]`).forEach((h) => { h.classList.toggle("is-open", open); h.setAttribute("aria-expanded", String(open)); });
    document.querySelectorAll(`tr[data-subgroup="${safe}"]`).forEach((r) => {
      if (!open && r.classList.contains("lead-row")) closeDetailOf(r);
      r.classList.toggle("sub-collapsed", !open);
    });
  }

  function toggleFrom(head) {
    const id = head.dataset.groupHead;
    setOpen(id, !head.classList.contains("is-open"));
  }
  document.addEventListener("click", (e) => {
    const head = e.target.closest("tr.group-row");
    if (head) { toggleFrom(head); return; }
    const section = e.target.closest("tr.subgroup-row");
    if (section) setSectionOpen(section.dataset.subgroupHead, !section.classList.contains("is-open"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const head = e.target.closest && e.target.closest("tr.group-row, tr.subgroup-row");
    if (!head || e.target !== head) return;
    e.preventDefault();
    if (head.classList.contains("subgroup-row")) setSectionOpen(head.dataset.subgroupHead, !head.classList.contains("is-open"));
    else toggleFrom(head);
  });

  api.rowsHtml = rowsHtml;
  api.inShownGroup = (kind, index) => Boolean(shown[kind] && shown[kind].has(index));
})(typeof window !== "undefined" ? window : globalThis);
