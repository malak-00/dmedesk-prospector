import test from "node:test";
import assert from "node:assert/strict";
import { getBulkMergeEligibility } from "../src/repos/adminRepo.js";

function review(leftOwners = [], rightOwners = []) {
  return { left: { owners: leftOwners }, right: { owners: rightOwners } };
}

const agentA = { userId: "a", displayName: "Agent A" };
const agentB = { userId: "b", displayName: "Agent B" };

test("bulk merge allows both unclaimed and generates an audit reason", () => {
  assert.deepEqual(getBulkMergeEligibility(review()), {
    eligible: true,
    reason: "Bulk merge: both leads are unclaimed.",
  });
});

test("bulk merge allows unclaimed plus one agent", () => {
  assert.deepEqual(getBulkMergeEligibility(review([], [agentA])), {
    eligible: true,
    reason: "Bulk merge: one lead is unclaimed and the other is owned by Agent A.",
  });
});

test("bulk merge allows the same agent on both sides", () => {
  assert.deepEqual(getBulkMergeEligibility(review([agentA], [agentA])), {
    eligible: true,
    reason: "Bulk merge: both leads are owned by Agent A; ownership is consistent.",
  });
});

test("bulk merge excludes cross-agent ownership", () => {
  assert.equal(getBulkMergeEligibility(review([agentA], [agentB])).eligible, false);
});

test("bulk merge excludes a side with multiple distinct owners", () => {
  assert.equal(getBulkMergeEligibility(review([agentA, agentB], [])).eligible, false);
});

test("bulk merge treats repeated rows for one agent as one owner", () => {
  assert.equal(getBulkMergeEligibility(review([agentA, agentA], [agentA])).eligible, true);
});

test("bulk merge explains a registry pair where neither NPI is a lead", () => {
  const registry = { left: { owners: [], isLead: false }, right: { owners: [], isLead: false } };
  assert.deepEqual(getBulkMergeEligibility(registry), {
    eligible: true,
    reason: "Bulk merge: neither NPI is a lead yet (registry match); no claims are affected.",
  });
  // A pair with one real lead keeps the original wording.
  assert.equal(
    getBulkMergeEligibility({ left: { owners: [], isLead: true }, right: { owners: [], isLead: false } }).reason,
    "Bulk merge: both leads are unclaimed."
  );
});

// A query builder that records what was asked and resolves to canned rows.
function fakeSupabase(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: [] };
      calls.push(call);
      const builder = {
        select() { return builder; },
        order() { return builder; },
        range(from, to) { call.range = [from, to]; return builder; },
        limit(n) { call.limit = n; return builder; },
        or(expression) { call.filters.push(["or", expression]); return builder; },
        eq(column, value) { call.filters.push(["eq", column, value]); return builder; },
        in(column, values) { call.filters.push(["in", column, values]); return builder; },
        then(resolve, reject) {
          const result = tables[table] || { data: [], error: null };
          return Promise.resolve(typeof result === "function" ? result(call) : result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const registryRow = (left, right) => ({
  tier: 3, matched_keys: "official+phone", left_npi: left, left_name: `N${left}`, left_group_id: null,
  right_npi: right, right_name: `N${right}`, right_group_id: null, source: "registry",
  left_is_lead: false, right_is_lead: false, first_seen_at: "2026-10-07T00:00:00Z",
});

test("registry scope reads one page, asks for one extra row, and reports hasMore", async () => {
  const { getMatchReviews } = await import("../src/repos/adminRepo.js");
  // Page size 2 -> the Worker requests 3 rows; a 3rd row means there is a next page.
  const supabase = fakeSupabase({
    registry_review_queue: { data: [registryRow("1", "2"), registryRow("1", "3"), registryRow("1", "4")], error: null },
    npi_records: { data: [{ npi: "1", name: "A", address_state: "FL", authorizedofficial_firstname: "F", authorizedofficial_lastname: "S", phone: "8132526078", authorizedofficial_phone: "8137205106" }], error: null },
    leads: { data: [], error: null },
    lead_group_members: { data: [], error: null },
    app_users: { data: [], error: null },
  });
  const result = await getMatchReviews(supabase, { scope: "registry", tier: "3", offset: "4", limit: "2" });
  assert.equal(result.scope, "registry");
  assert.equal(result.hasMore, true);
  assert.equal(result.reviews.length, 2);
  assert.equal(result.reviews[0].source, "registry");
  assert.equal(result.reviews[0].left.isLead, false);
  // Location and official phones are both shown so a match on either is visible.
  assert.equal(result.reviews[0].left.officialPhone, "(813) 720-5106");
  const queueCall = supabase.calls.find((call) => call.table === "registry_review_queue");
  assert.deepEqual(queueCall.range, [4, 6]);
  assert.deepEqual(queueCall.filters, [["eq", "tier", 3]]);
});

test("registry scope caps the page size and degrades when sql/030 is missing", async () => {
  const { getMatchReviews, REGISTRY_PAGE_MAX } = await import("../src/repos/adminRepo.js");
  const supabase = fakeSupabase({ registry_review_queue: { data: null, error: { code: "42P01", message: 'relation "registry_review_queue" does not exist' } } });
  const result = await getMatchReviews(supabase, { scope: "registry", limit: "100000" });
  assert.equal(result.available, false);
  assert.match(result.reason, /sql\/030/);
  assert.deepEqual(supabase.calls[0].range, [0, REGISTRY_PAGE_MAX]);
});

test("bulk merge re-reads only the requested pairs, not a whole queue", async () => {
  const { bulkMergeEligibleMatchReviews } = await import("../src/repos/adminRepo.js");
  const rpcCalls = [];
  const supabase = fakeSupabase({
    identity_review_queue: { data: [], error: null },
    registry_review_queue: { data: [registryRow("1", "2"), registryRow("8", "9")], error: null },
    npi_records: { data: [], error: null },
    leads: { data: [], error: null },
    lead_group_members: { data: [], error: null },
    app_users: { data: [], error: null },
  });
  supabase.rpc = async (name, args) => { rpcCalls.push([name, args]); return { data: { decision: "merged" }, error: null }; };

  // Ask for (2,1) reversed and a pair that is not pending; "8:9" was returned by the
  // view but was never requested, so it must be ignored.
  const result = await bulkMergeEligibleMatchReviews(supabase, {
    pairs: [{ leftNpi: "2", rightNpi: "1" }, { leftNpi: "5", rightNpi: "6" }],
    decidedBy: "admin-1",
  });
  assert.equal(result.merged.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0][1].p_left_npi, "1");
  assert.match(rpcCalls[0][1].p_reason, /neither NPI is a lead yet/);
  const lookups = supabase.calls.filter((call) => call.table.endsWith("_review_queue"));
  assert.ok(lookups.every((call) => call.filters.some(([kind, column]) => kind === "in" && column === "left_npi")));
});

test("merge all: merges safe pairs, reports the ones held back, and hands back a cursor", async () => {
  const { mergeEligibleRegistryReviews, AUTO_MERGE_KEYS } = await import("../src/repos/adminRepo.js");
  const supabase = fakeSupabase({
    registry_review_queue: { data: [registryRow("1000000001", "1000000002"), registryRow("1000000001", "1000000003")], error: null },
  });
  const rpcCalls = [];
  supabase.rpc = async (name, args) => {
    rpcCalls.push([name, args]);
    return args.p_right_npi === "1000000003"
      ? { data: { skipped: true, reason: "Different agents own these NPIs or others in their groups; review manually." }, error: null }
      : { data: { decision: "merged", skipped: false }, error: null };
  };

  const result = await mergeEligibleRegistryReviews(supabase, { after: null, decidedBy: "admin-1" });
  assert.equal(result.merged.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.done, true); // fewer rows than a full batch
  assert.deepEqual(result.next, { leftNpi: "1000000001", rightNpi: "1000000003" });
  assert.ok(rpcCalls.every(([name]) => name === "merge_identity_pair_if_safe"));
  assert.match(rpcCalls[0][1].p_reason, /Automatic merge/);
  // Only the agreed rules are asked for: Tier 2 keys plus official+phone.
  const queueCall = supabase.calls.find((call) => call.table === "registry_review_queue");
  assert.deepEqual(queueCall.filters[0], ["in", "matched_keys", AUTO_MERGE_KEYS]);
  assert.ok(!AUTO_MERGE_KEYS.includes("name+phone") && !AUTO_MERGE_KEYS.includes("name+official"));
});

test("merge all: continues after the cursor, and refuses anything that isn't an NPI", async () => {
  const { mergeEligibleRegistryReviews } = await import("../src/repos/adminRepo.js");
  const supabase = fakeSupabase({ registry_review_queue: { data: [], error: null } });
  supabase.rpc = async () => ({ data: {}, error: null });

  const result = await mergeEligibleRegistryReviews(supabase, {
    after: { leftNpi: "1000000001", rightNpi: "1000000003" },
    decidedBy: "admin-1",
  });
  assert.equal(result.done, true);
  assert.equal(result.next, null);
  const orFilter = supabase.calls[0].filters.find(([kind]) => kind === "or");
  assert.equal(orFilter[1], "left_npi.gt.1000000001,and(left_npi.eq.1000000001,right_npi.gt.1000000003)");

  await assert.rejects(
    () => mergeEligibleRegistryReviews(supabase, { after: { leftNpi: "1),or(1=1", rightNpi: "2" }, decidedBy: "admin-1" }),
    (error) => error.status === 400
  );
});

test("merge all: a failed or already-decided pair is counted, not fatal; a full batch means keep going", async () => {
  const { mergeEligibleRegistryReviews, AUTO_MERGE_BATCH } = await import("../src/repos/adminRepo.js");
  const rows = Array.from({ length: AUTO_MERGE_BATCH }, (_, i) => registryRow("1000000001", String(2000000000 + i)));
  const supabase = fakeSupabase({ registry_review_queue: { data: rows, error: null } });
  let n = 0;
  supabase.rpc = async () => {
    n += 1;
    if (n === 1) return { data: null, error: { message: "this pair has already been decided" } };
    if (n === 2) return { data: null, error: { message: "boom" } };
    return { data: { skipped: false }, error: null };
  };
  const result = await mergeEligibleRegistryReviews(supabase, { decidedBy: "admin-1" });
  assert.equal(result.skipped.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.merged.length, AUTO_MERGE_BATCH - 2);
  assert.equal(result.done, false);
});

test("merge all: before sql/035 the preview and the merge say what to run", async () => {
  const { getRegistryMergePreview, mergeEligibleRegistryReviews } = await import("../src/repos/adminRepo.js");
  const missing = { code: "PGRST202", message: "Could not find the function public.registry_merge_preview" };
  const supabase = fakeSupabase({ registry_review_queue: { data: [registryRow("1000000001", "1000000002")], error: null } });
  supabase.rpc = async () => ({ data: null, error: missing });
  await assert.rejects(() => getRegistryMergePreview(supabase), (error) => error.status === 503 && /sql\/035/.test(error.message));
  await assert.rejects(() => mergeEligibleRegistryReviews(supabase, { decidedBy: "a" }), (error) => error.status === 503);

  supabase.rpc = async () => ({ data: { total: 10, blocked: 3, mergeable: 7 }, error: null });
  assert.deepEqual(await getRegistryMergePreview(supabase), {
    total: 10, blocked: 3, mergeable: 7,
    rules: ["name+state+phone", "name+state+official", "state+official+phone", "official+phone"],
  });
});
