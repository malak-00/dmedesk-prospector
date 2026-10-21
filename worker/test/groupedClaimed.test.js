import test from "node:test";
import assert from "node:assert/strict";
import { chunkIntoGroupPages, parseListParams } from "../src/lib/leadView.js";
import { listClaimedPage } from "../src/repos/leadsRepo.js";

const NOW = Date.parse("2026-10-21T15:00:00Z");
const key = (id, group_id = null) => ({ id, group_id });

test("a business group is never split across pages and sits where its first member falls", () => {
  // In the order the rep asked for: group g1's members are scattered.
  const keys = [key("a1", "g1"), key("b1", "g2"), key("a2", "g1"), key("c1"), key("b2", "g2"), key("a3", "g1")];
  const { pages, groups } = chunkIntoGroupPages(keys, 3);
  assert.equal(groups, 3);
  assert.deepEqual(pages.map((p) => p.ids), [["a1", "a2", "a3"], ["b1", "b2", "c1"]]);
  assert.deepEqual(pages.map((p) => p.groups), [1, 2]);
});

test("a page runs over by the group that crossed the line, and an empty list has no pages", () => {
  const big = Array.from({ length: 7 }, (_, i) => key(`m${i}`, "big"));
  const { pages } = chunkIntoGroupPages([key("x"), ...big, key("y")], 3);
  assert.deepEqual(pages.map((p) => p.ids.length), [8, 1]);
  assert.deepEqual(chunkIntoGroupPages([], 50), { pages: [], groups: 0 });
});

test("grouped is only switched on by the query string", () => {
  assert.equal(parseListParams({}, NOW).grouped, false);
  assert.equal(parseListParams({ grouped: "1" }, NOW).grouped, true);
  assert.equal(parseListParams({ grouped: "yes" }, NOW).grouped, false);
});

// A database that answers the few queries a grouped page makes, a few rows at a time (like a
// PostgREST row cap), and records them.
function fakeDb({ keys, rows, branches = [] }) {
  const log = [];
  const from = (table) => ({
    select: (columns, options) => {
      const entry = { table, columns, options, calls: [] };
      log.push(entry);
      const q = new Proxy({}, {
        get(_, method) {
          if (method === "then") {
            return (resolve) => {
              const has = (name) => entry.calls.find((c) => c[0] === name);
              if (options && options.head) return resolve({ data: null, count: 5, error: null });
              if (table === "leads" && columns === "id, group_id") {
                const [from0] = has("range") ? has("range").slice(1) : [0];
                return resolve({ data: keys.slice(from0, from0 + 3), error: null }); // at most 3 rows per call
              }
              if (table === "leads" && columns === "*") {
                const wanted = new Set(has("in")[2]);
                return resolve({ data: rows.filter((r) => wanted.has(r.id)), error: null });
              }
              if (table === "leads" && String(columns).startsWith("npi,company_name")) return resolve({ data: branches, error: null });
              return resolve({ data: [], error: null });
            };
          }
          return (...args) => { entry.calls.push([method, ...args]); return q; };
        },
      });
      return q;
    },
  });
  return { log, from };
}

const lead = (id, npi, group_id, over = {}) => ({ id, npi, group_id, company_name: `Co ${npi}`, status: "new", claimed_at: "2026-10-01", claimed_by: "u1", ...over });

test("a grouped Claimed page loads whole groups, in sort order, with the counts of the whole list", async () => {
  const rows = [lead("a1", "1", "g1"), lead("b1", "2", "g2"), lead("a2", "3", "g1"), lead("c1", "4", null), lead("b2", "5", "g2"), lead("a3", "6", "g1")];
  const keys = rows.map((r) => ({ id: r.id, group_id: r.group_id }));
  const db = fakeDb({ keys, rows });
  const params = parseListParams({ page: "2", pageSize: "10", grouped: "1", sort: "company", dir: "asc" }, NOW);
  // pageSize clamps to 10, so everything fits on one page; ask for page 1.
  const one = await listClaimedPage(db, { id: "u1", displayName: "Ana" }, { ...params, page: 1, pageSize: 3 });
  assert.equal(one.grouped, true);
  assert.equal(one.total, 6);
  assert.equal(one.groups, 3);
  assert.equal(one.pages, 2);
  assert.deepEqual(one.leads.map((l) => l.npi), ["1", "3", "6"], "g1 comes together at the place of its first member");
  assert.ok(one.leads.every((l) => l.groupId === "g1"));

  const two = await listClaimedPage(db, { id: "u1", displayName: "Ana" }, { ...params, page: 2, pageSize: 3 });
  assert.deepEqual(two.leads.map((l) => l.npi), ["2", "5", "4"]);

  // The id-only query paged through every row even though each call returned only three.
  const keyCalls = db.log.filter((e) => e.columns === "id, group_id");
  assert.ok(keyCalls.length >= 3, "keeps asking until a batch comes back empty");
  assert.ok(keyCalls[0].calls.some((c) => c[0] === "eq" && c[1] === "claimed_by" && c[2] === "u1"), "still only this rep's leads");
});

test("members already shown in the group are not repeated as other locations", async () => {
  const rows = [lead("a1", "1", "g1"), lead("a2", "2", "g1")];
  const branches = [
    { npi: "1", company_name: "Co 1", claimed_by: "u1", is_disconnected: false, group_id: "g1" },
    { npi: "2", company_name: "Co 2", claimed_by: "u1", is_disconnected: false, group_id: "g1" },
    { npi: "9", company_name: "Co 9", claimed_by: null, is_disconnected: false, group_id: "g1" }, // not claimed: still worth showing
  ];
  const db = fakeDb({ keys: rows.map((r) => ({ id: r.id, group_id: r.group_id })), rows, branches });
  const result = await listClaimedPage(db, { id: "u1", displayName: "Ana" }, { ...parseListParams({ grouped: "1" }, NOW) });
  assert.equal(result.leads.length, 2);
  for (const l of result.leads) {
    assert.deepEqual(l.branches.map((b) => b.npi), ["9"]);
  }
});

test("a grouped page past the end falls back to the last page, and nothing claimed gives one empty page", async () => {
  const rows = [lead("a1", "1", "g1")];
  const db = fakeDb({ keys: rows.map((r) => ({ id: r.id, group_id: r.group_id })), rows });
  const past = await listClaimedPage(db, { id: "u1", displayName: "Ana" }, { ...parseListParams({ grouped: "1" }, NOW), page: 9 });
  assert.equal(past.page, 1);
  assert.equal(past.leads.length, 1);

  const none = await listClaimedPage(fakeDb({ keys: [], rows: [] }), { id: "u1", displayName: "Ana" }, parseListParams({ grouped: "1" }, NOW));
  assert.deepEqual([none.leads.length, none.total, none.pages], [0, 0, 1]);
});
