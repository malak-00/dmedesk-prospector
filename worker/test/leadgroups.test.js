import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// docs/leadgroups.js is a browser script that also exports its pure part under Node.
const source = fs.readFileSync(new URL("../../docs/leadgroups.js", import.meta.url), "utf8");
const sandbox = { module: { exports: {} }, globalThis: {} };
vm.runInNewContext(source, sandbox);
const g = sandbox.module.exports;
// Values built inside the vm sandbox have that realm's prototypes; compare their plain JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

const lead = (name, over = {}) => ({ name, state: "FL", city: "Miami", status: "new", contactName: "", contactSource: "", ...over });
const all = (items) => items.map((_, i) => i);

test("one company at several locations is named by the company, however it is spelled", () => {
  assert.equal(g.nameKey("H&R HEALTHCARE, LP"), g.nameKey("H & R HEALTHCARE, LP"));
  assert.equal(g.nameKey("H & R HEALTHCARE L P"), g.nameKey("H&R HEALTHCARE, LP"));
  assert.notEqual(g.nameKey("Local Health Inc"), g.nameKey("Local Health Indiana Inc"));

  const items = [
    lead("H&R HEALTHCARE, LP", { state: "CT", city: "WALLINGFORD" }),
    lead("H & R HEALTHCARE, LP", { state: "FL", city: "OAKLAND PARK" }),
    lead("H & R HEALTHCARE L P", { state: "ME", city: "LEWISTON" }),
    lead("H&R HEALTHCARE, LP", { state: "NJ", city: "LAKEWOOD", status: "voicemail" }),
  ];
  const d = g.describeGroup(items, all(items), { name: (l) => l.name, state: (l) => l.state, city: (l) => l.city, status: (l) => l.status });
  assert.equal(d.kind, "name");
  assert.equal(d.title, "H&R Healthcare, LP");
  assert.equal(d.subtitle, "4 locations · CT, FL, ME, NJ");
  assert.deepEqual(plain(d.statuses), [{ status: "new", n: 3 }, { status: "voicemail", n: 1 }]);
});

test("different company names with one authorized official are named by the official", () => {
  const official = { contactName: "RAMAKRISHNA MACHU", contactSource: "nppes" };
  const items = [
    lead("ADL MEDICAL SUPPLY INC", { ...official, state: "GA" }),
    lead("MEDICAL EQUIPMENT SUPPLY PLACE INC", { ...official, state: "GA" }),
    lead("MEDIFLOW LLC", { ...official, state: "TX" }),
    lead("SIMPLE LANE MEDICAL LLC", { ...official, state: "TX" }),
  ];
  const d = g.claimedGroups(items.map((l, i) => ({ ...l, groupId: "g1" })))[0].desc;
  assert.equal(d.kind, "official");
  assert.equal(d.title, "Ramakrishna Machu");
  assert.equal(d.subtitle, "Authorized official · 4 businesses · GA, TX", "no need to say 4 names when each business has its own");
  assert.equal(d.big, true, "3+ company names get the two-level layout");
  assert.equal(d.clusters.length, 0, "but with no repeated name there is nothing to nest");
});

test("a contact that did not come from NPPES is not treated as the official, so the group falls back", () => {
  const items = [lead("ALPHA CO", { contactName: "Sam Rivera", contactSource: "website" }), lead("BETA CO", { contactName: "Sam Rivera", contactSource: "website" })];
  const d = g.claimedGroups(items.map((l) => ({ ...l, groupId: "g" })))[0].desc;
  assert.equal(d.kind, "mixed");
  assert.equal(d.subtitle.startsWith("2 related businesses"), true);
});

test("a big group is nested under its repeated company names, then the rest", () => {
  const official = { contactName: "SELMA DZELIL", contactSource: "nppes" };
  const items = [
    ...Array.from({ length: 6 }, (_, i) => lead("LOCAL HEALTH INC", { ...official, city: `Town ${i}`, state: "IL" })),
    lead("PETERSON PHARMACY INC", { ...official, state: "WI" }),
    lead("CLIO ROAD PHARMACY INC", { ...official, state: "MI" }),
    lead("LOCAL HEALTH INDIANA INC", { ...official, state: "IN" }),
    ...Array.from({ length: 3 }, (_, i) => lead(`SOLO ${i} INC`, { ...official })),
  ];
  const group = g.claimedGroups(items.map((l) => ({ ...l, groupId: "big" })))[0];
  assert.equal(group.desc.count, 12);
  assert.equal(group.desc.big, true);
  assert.deepEqual(plain(group.desc.clusters).map((c) => [c.title, c.indexes.length]), [["Local Health Inc", 6]]);
  const parts = plain(g.layoutGroup(group.desc, group.indexes));
  assert.deepEqual(parts.filter((p) => p.sub).map((p) => p.sub), ["Local Health Inc · 6 locations", "Other companies · 6"]);
  assert.equal(parts.filter((p) => p.index !== undefined).length, 12, "every lead is drawn exactly once");
});

test("a small group is drawn flat, and a single lead is no group", () => {
  const items = [lead("A", { groupId: "g1" }), lead("B", { groupId: "g1" }), lead("C", { groupId: "g2" })];
  const groups = g.claimedGroups(items);
  assert.equal(groups.length, 1);
  assert.deepEqual(plain(g.layoutGroup(groups[0].desc, groups[0].indexes)), [{ index: 0 }, { index: 1 }]);
});

test("names read well: capitals are tidied, acronyms and existing casing are kept", () => {
  assert.equal(g.prettyName("MEDICAL EQUIPMENT SUPPLY PLACE INC"), "Medical Equipment Supply Place Inc");
  assert.equal(g.prettyName("ADL MEDICAL SUPPLY LLC"), "ADL Medical Supply LLC");
  assert.equal(g.prettyName("Bayview Home Medical"), "Bayview Home Medical");
  assert.equal(g.prettyName("O'BRIEN HOME CARE"), "O'Brien Home Care");
  assert.equal(g.prettyName(""), "");
});

test("a Prospect group takes its reason from the cluster, and counts overdue callbacks on Claimed", () => {
  const companies = [
    { npi: "1", name: "ALPHA MEDICAL", address: { state: "TX", city: "Austin" }, decisionMakers: [{ name: "Pat Jones", source: "nppes" }] },
    { npi: "2", name: "BETA SUPPLY", address: { state: "TX", city: "Dallas" }, decisionMakers: [{ name: "Pat Jones", source: "nppes" }] },
  ];
  const groups = g.prospectGroups(companies, { clusters: [[0, 1]], relation: () => "same owner" });
  assert.equal(groups[0].id, "p:1");
  assert.equal(groups[0].desc.kind, "official");
  assert.equal(groups[0].desc.title, "Pat Jones");

  const past = new Date(Date.now() - 86_400_000).toISOString();
  const claimed = g.claimedGroups([lead("X", { groupId: "g", reminderAt: past }), lead("X", { groupId: "g" })]);
  assert.equal(claimed[0].desc.due, 1);
});

// ---- drawing: the table body for a list, with each group gathered under its header ------------

function browserGroups() {
  const listeners = [];
  const win = {};
  const ctx = {
    window: win,
    document: { addEventListener: (type, fn) => listeners.push([type, fn]) },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    escapeHtml: (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
  };
  vm.runInNewContext(source, ctx);
  return { api: win.dmeGroups, listeners };
}

const rowHtml = (item, i) => `\n    <tr class="lead-row " data-claimed-index="${i}"><td>${item.name}</td></tr>`;

test("groups are drawn under a header; plain leads are untouched; small groups start open, big ones closed", () => {
  const { api } = browserGroups();
  const small = Array.from({ length: 3 }, (_, i) => lead(`Small ${i}`, { groupId: "gs" }));
  const big = Array.from({ length: 6 }, (_, i) => lead("Big Co", { groupId: "gb", city: `T${i}` }));
  // The rows of group "gs" are not next to each other in the list: they are still gathered.
  const items = [small[0], lead("Solo Inc"), big[0], small[1], big[1], big[2], big[3], big[4], big[5], small[2]];
  const html = api.rowsHtml("claimed", items, rowHtml, api.claimedGroups(items), 10);

  const rows = html.split("<tr ").slice(1).map((r) => r.slice(0, 200));
  const kinds = rows.map((r) => (r.startsWith('class="group-row') ? "head" : r.startsWith('class="group-gap') ? "gap" : r.includes('data-group="') ? "member" : "plain"));
  // Each group is closed by a gap row, so the lead after it is plainly outside the group.
  assert.deepEqual(kinds, ["head", "member", "member", "member", "gap", "plain", "head", ...Array(6).fill("member"), "gap"]);

  assert.match(html, /data-group-head="gs"[^>]*aria-expanded="true"/, "3 leads: open");
  assert.match(html, /data-group-head="gb"[^>]*aria-expanded="false"/, "6 leads: closed");
  const bigMembers = html.split("<tr ").filter((r) => r.includes('data-group="gb"') && r.includes("lead-row"));
  assert.equal(bigMembers.length, 6);
  assert.ok(bigMembers.every((r) => r.includes("group-collapsed")), "a closed group hides its leads");
  const smallMembers = html.split("<tr ").filter((r) => r.includes('data-group="gs"') && r.includes("lead-row"));
  assert.ok(smallMembers.every((r) => !r.includes("group-collapsed")));

  // The lead keeps its own index, so selection, status and notes still point at the right one.
  assert.ok(html.includes('data-claimed-index="9"'));
  assert.ok(api.inShownGroup("claimed", 0) && !api.inShownGroup("claimed", 1), "the solo lead is not in a group");
  assert.match(html, /<div class="group-title">Big Co<\/div>/);
  assert.match(html, /6 leads/);
});

test("a big group is drawn with sub-headers, and headers open and close with a click", () => {
  const { api, listeners } = browserGroups();
  const o = { contactName: "SELMA DZELIL", contactSource: "nppes" };
  const items = [
    ...Array.from({ length: 6 }, (_, i) => lead("LOCAL HEALTH INC", { ...o, groupId: "g", city: `T${i}` })),
    ...Array.from({ length: 6 }, (_, i) => lead(`OTHER ${i} PHARMACY`, { ...o, groupId: "g" })),
  ];
  const html = api.rowsHtml("claimed", items, rowHtml, api.claimedGroups(items), 10);
  assert.match(html, /<div class="group-title">Selma Dzelil<\/div>/);
  assert.match(html, /class="subgroup-title">Local Health Inc · 6 locations</);
  assert.match(html, /class="subgroup-title">Other companies · 6</);
  assert.ok(listeners.some(([type]) => type === "click") && listeners.some(([type]) => type === "keydown"), "headers respond to click and keyboard");
});

test("a lead with the same name twice is escaped, not injected", () => {
  const { api } = browserGroups();
  const items = [lead('Evil "<b>Co</b>"', { groupId: "g" }), lead('Evil "<b>Co</b>"', { groupId: "g" })];
  const html = api.rowsHtml("claimed", items, rowHtml, api.claimedGroups(items), 10);
  assert.ok(!html.includes('<div class="group-title"><b>'), "the title is HTML-escaped");
});
test("in a big group each section folds: small ones start open, large ones start folded, and one company needs no section", () => {
  const { api } = browserGroups();
  const o = { contactName: "MARCUS DELANEY", contactSource: "nppes" };
  const items = [
    ...Array.from({ length: 20 }, (_, i) => lead("ATHLETIC INSTITUTE", { ...o, groupId: "g", city: `C${i}`, status: i < 3 ? "voicemail" : "new" })),
    ...Array.from({ length: 5 }, (_, i) => lead("ATI PHYSICAL THERAPY", { ...o, groupId: "g", city: `D${i}` })),
    ...Array.from({ length: 3 }, (_, i) => lead(`ODD ${i} LLC`, { ...o, groupId: "g" })),
  ];
  const html = api.rowsHtml("claimed", items, rowHtml, api.claimedGroups(items), 10);
  const sections = html.split("<tr ").filter((r) => r.includes("data-subgroup-head="));
  assert.equal(sections.length, 3);
  assert.match(sections[0], /aria-expanded="false"/, "20 leads: folded");
  assert.match(sections[0], /3 voicemail/, "a section shows its status mix");
  assert.match(sections[1], /aria-expanded="true"/, "5 leads: open");
  assert.match(sections[2], /aria-expanded="true"/, "3 leads: open");

  const members = html.split("<tr ").filter((r) => r.includes("data-subgroup=") && r.includes("lead-row"));
  assert.equal(members.length, 28);
  assert.equal(members.filter((r) => r.includes("sub-collapsed")).length, 20, "only the folded section's leads are hidden");

  // One company covering the whole group: the header already says it, so no section of its own.
  const chain = Array.from({ length: 15 }, (_, i) => lead("RIDLEYS FAMILY PHARMACY", { ...o, groupId: "c", city: `T${i}` }));
  const chainHtml = api.rowsHtml("claimed", chain, rowHtml, api.claimedGroups(chain), 10);
  assert.ok(!chainHtml.includes("data-subgroup-head="));
  assert.match(chainHtml, /15 locations/);
});