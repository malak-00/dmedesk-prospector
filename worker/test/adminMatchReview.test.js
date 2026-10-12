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

test("registry scope reads one page through registry_review_page and passes the cursor on", async () => {
  const { getMatchReviews } = await import("../src/repos/adminRepo.js");
  const calls = [];
  const supabase = fakeSupabase({
    npi_records: { data: [{ npi: "1", name: "A", address_state: "FL", authorizedofficial_firstname: "F", authorizedofficial_lastname: "S", phone: "8132526078", authorizedofficial_phone: "8137205106" }], error: null },
    leads: { data: [], error: null },
    lead_group_members: { data: [], error: null },
    app_users: { data: [], error: null },
  });
  supabase.rpc = async (name, args) => {
    calls.push([name, args]);
    return { data: { rows: [registryRow("1", "2"), registryRow("1", "3")], hasMore: true, next: { leftNpi: "1000000001", rightNpi: "1000000003" } }, error: null };
  };

  const result = await getMatchReviews(supabase, {
    scope: "registry", tier: "3", after: { leftNpi: "1000000000", rightNpi: "1000000002" }, limit: "2",
  });
  assert.equal(result.scope, "registry");
  assert.equal(result.hasMore, true);
  assert.deepEqual(result.next, { leftNpi: "1000000001", rightNpi: "1000000003" });
  assert.equal(result.reviews.length, 2);
  assert.equal(result.reviews[0].source, "registry");
  assert.equal(result.reviews[0].left.isLead, false);
  // Location and official phones are both shown so a match on either is visible.
  assert.equal(result.reviews[0].left.officialPhone, "(813) 720-5106");
  assert.deepEqual(calls[0], ["registry_review_page", { p_tier: 3, p_after_left: "1000000000", p_after_right: "1000000002", p_limit: 2 }]);
  // The slow review views are not read for this list any more.
  assert.ok(!supabase.calls.some((call) => call.table.endsWith("_review_queue")));
});

test("registry scope ignores a malformed cursor, caps the page size and degrades when sql/037 is missing", async () => {
  const { getMatchReviews, REGISTRY_PAGE_MAX } = await import("../src/repos/adminRepo.js");
  const calls = [];
  const supabase = { calls: [], rpc: async (name, args) => { calls.push(args); return { data: null, error: { code: "PGRST202", message: "Could not find the function public.registry_review_page" } }; } };
  const result = await getMatchReviews(supabase, { scope: "registry", limit: "100000", after: { leftNpi: "1),or(1=1", rightNpi: "x" } });
  assert.equal(result.available, false);
  assert.match(result.reason, /sql\/037/);
  assert.equal(calls[0].p_limit, REGISTRY_PAGE_MAX);
  assert.equal(calls[0].p_after_left, null);
  assert.equal(calls[0].p_after_right, null);
});

test("bulk merge of registry pairs goes straight to the safe-merge function and never reads the queue views", async () => {
  const { bulkMergeRegistryPairs } = await import("../src/repos/adminRepo.js");
  const calls = [];
  const supabase = {
    from() { throw new Error("must not read a table or view"); },
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (args.p_right_npi === "1000000003") return { data: { skipped: true, reason: "Different agents own these NPIs or others in their groups; review manually." }, error: null };
      if (args.p_right_npi === "1000000004") return { data: null, error: { message: "this pair has already been decided" } };
      if (args.p_right_npi === "1000000005") return { data: null, error: { message: "boom" } };
      return { data: { skipped: false }, error: null };
    },
  };
  const result = await bulkMergeRegistryPairs(supabase, {
    decidedBy: "admin-1",
    pairs: [
      { leftNpi: "1000000002", rightNpi: "1000000001", tier: 3, matchedKeys: ["official", "phone"] }, // given reversed
      { leftNpi: "1000000001", rightNpi: "1000000003" },
      { leftNpi: "1000000001", rightNpi: "1000000004" },
      { leftNpi: "1000000001", rightNpi: "1000000005" },
      { leftNpi: "1000000001", rightNpi: "1000000005" }, // duplicate
      { leftNpi: "not-an-npi", rightNpi: "1000000001" }, // ignored
    ],
  });
  assert.equal(result.requested, 4);
  assert.equal(result.merged.length, 1);
  assert.deepEqual(result.merged[0], { leftNpi: "1000000001", rightNpi: "1000000002" });
  assert.equal(result.skipped.length, 2);
  assert.equal(result.failed.length, 1);
  assert.ok(calls.every(([name]) => name === "merge_identity_pair_if_safe"));
  const first = calls.find(([, args]) => args.p_right_npi === "1000000002")[1];
  assert.equal(first.p_matched_keys, "official+phone");
  assert.equal(first.p_tier, 3);
  assert.match(first.p_reason, /Bulk merge of selected registry match/);

  await assert.rejects(() => bulkMergeRegistryPairs(supabase, { pairs: [], decidedBy: "a" }), (error) => error.status === 400);
  const many = Array.from({ length: 41 }, (_, i) => ({ leftNpi: "1000000001", rightNpi: String(2000000000 + i) }));
  await assert.rejects(() => bulkMergeRegistryPairs(supabase, { pairs: many, decidedBy: "a" }), (error) => error.status === 400);
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

// Batches are read through registry_merge_next_batch (sql/036); merges go through
// merge_identity_pair_if_safe. This fake answers both and records every call.
function mergeAllSupabase({ batch = [], batchError = null, merge }) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "registry_merge_next_batch") return { data: batchError ? null : batch, error: batchError };
      return merge ? merge(args, calls.filter(([n]) => n === name).length) : { data: { skipped: false }, error: null };
    },
  };
}

test("merge all: merges safe pairs, reports the ones held back, and hands back a cursor", async () => {
  const { mergeEligibleRegistryReviews, AUTO_MERGE_KEYS } = await import("../src/repos/adminRepo.js");
  const supabase = mergeAllSupabase({
    batch: [registryRow("1000000001", "1000000002"), registryRow("1000000001", "1000000003")],
    merge: (args) => args.p_right_npi === "1000000003"
      ? { data: { skipped: true, reason: "Different agents own these NPIs or others in their groups; review manually." }, error: null }
      : { data: { decision: "merged", skipped: false }, error: null },
  });

  const result = await mergeEligibleRegistryReviews(supabase, { after: null, decidedBy: "admin-1" });
  assert.equal(result.merged.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.done, true); // fewer rows than a full batch
  assert.deepEqual(result.next, { leftNpi: "1000000001", rightNpi: "1000000003" });
  const merges = supabase.calls.filter(([name]) => name === "merge_identity_pair_if_safe");
  assert.equal(merges.length, 2);
  assert.match(merges[0][1].p_reason, /Automatic merge/);
  // Only the agreed rules are asked for: Tier 2 keys plus official+phone.
  const batchCall = supabase.calls.find(([name]) => name === "registry_merge_next_batch");
  assert.deepEqual(batchCall[1].p_keys, AUTO_MERGE_KEYS);
  assert.equal(batchCall[1].p_after_left, null);
  assert.ok(!AUTO_MERGE_KEYS.includes("name+phone") && !AUTO_MERGE_KEYS.includes("name+official"));
});

test("merge all: continues after the cursor, and refuses anything that isn't an NPI", async () => {
  const { mergeEligibleRegistryReviews } = await import("../src/repos/adminRepo.js");
  const supabase = mergeAllSupabase({ batch: [] });

  const result = await mergeEligibleRegistryReviews(supabase, {
    after: { leftNpi: "1000000001", rightNpi: "1000000003" },
    decidedBy: "admin-1",
  });
  assert.equal(result.done, true);
  assert.equal(result.next, null);
  assert.equal(supabase.calls[0][1].p_after_left, "1000000001");
  assert.equal(supabase.calls[0][1].p_after_right, "1000000003");

  await assert.rejects(
    () => mergeEligibleRegistryReviews(supabase, { after: { leftNpi: "1),or(1=1", rightNpi: "2" }, decidedBy: "admin-1" }),
    (error) => error.status === 400
  );
});

test("merge all: a failed or already-decided pair is counted, not fatal; a full batch means keep going", async () => {
  const { mergeEligibleRegistryReviews, AUTO_MERGE_BATCH } = await import("../src/repos/adminRepo.js");
  const rows = Array.from({ length: AUTO_MERGE_BATCH }, (_, i) => registryRow("1000000001", String(2000000000 + i)));
  const supabase = mergeAllSupabase({
    batch: rows,
    merge: (args, n) => {
      if (n === 1) return { data: null, error: { message: "this pair has already been decided" } };
      if (n === 2) return { data: null, error: { message: "boom" } };
      return { data: { skipped: false }, error: null };
    },
  });
  const result = await mergeEligibleRegistryReviews(supabase, { decidedBy: "admin-1" });
  assert.equal(result.skipped.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.merged.length, AUTO_MERGE_BATCH - 2);
  assert.equal(result.done, false);
});

test("merge all: before sql/035 and sql/036 the preview and the merge say what to run", async () => {
  const { getRegistryMergePreview, mergeEligibleRegistryReviews } = await import("../src/repos/adminRepo.js");
  const previewMissing = { code: "PGRST202", message: "Could not find the function public.registry_merge_preview" };
  let supabase = { rpc: async () => ({ data: null, error: previewMissing }) };
  await assert.rejects(() => getRegistryMergePreview(supabase), (error) => error.status === 503 && /sql\/035/.test(error.message));

  supabase = mergeAllSupabase({ batchError: { code: "PGRST202", message: "Could not find the function public.registry_merge_next_batch" } });
  await assert.rejects(() => mergeEligibleRegistryReviews(supabase, { decidedBy: "a" }), (error) => error.status === 503 && /sql\/036/.test(error.message));

  supabase = { rpc: async () => ({ data: { total: 10, blocked: 3, mergeable: 7 }, error: null }) };
  assert.deepEqual(await getRegistryMergePreview(supabase), {
    total: 10, blocked: 3, mergeable: 7,
    rules: ["name+state+phone", "name+state+official", "state+official+phone", "official+phone"],
  });
});