import test from "node:test";
import assert from "node:assert/strict";
import { exportCompaniesToLeads } from "../src/repos/leadsRepo.js";

const session = { id: "user-1", displayName: "Jasmine" };
const flatten = (company) => ({ name: company.name || "Acme", phone: "5551230000", state: "FL" });
const companies = [{ npi: "1000000001", name: "Acme" }, { npi: "1000000002", name: "Acme East" }];

// Records every rpc and answers from `handlers`.
function fakeSupabase(handlers) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args]);
      const handler = handlers[name];
      if (!handler) throw new Error("unexpected rpc " + name);
      return handler(args);
    },
  };
}

const claimedBoth = {
  data: {
    claimed: [
      { npi: "1000000001", leadId: "l1", groupId: "g-1" },
      { npi: "1000000002", leadId: "l2", groupId: "g-1" }, // same group: asked about once
    ],
    blocked: [], held: [], skipped: [],
  },
  error: null,
};

test("after a claim, the claimed groups' other NPIs are claimed for the same rep, once per group", async () => {
  const supabase = fakeSupabase({
    claim_leads: () => claimedBoth,
    auto_claim_group_siblings_for: () => ({ data: { claimed: 3, skipped_groups: [] }, error: null }),
  });
  const result = await exportCompaniesToLeads(supabase, companies, session, flatten);
  assert.equal(result.rowsAdded, 2);
  assert.equal(result.groupMatesClaimed, 3);
  assert.equal(result.groupsTooLarge, 0);
  const siblingCall = supabase.calls.find(([name]) => name === "auto_claim_group_siblings_for");
  assert.deepEqual(siblingCall[1], { p_group_ids: ["g-1"], p_actor: null });
});

test("a claim made on behalf of someone records who acted, and oversized groups are counted", async () => {
  const supabase = fakeSupabase({
    claim_leads: () => claimedBoth,
    auto_claim_group_siblings_for: () => ({
      data: { claimed: 0, skipped_groups: [{ group_id: "g-1", skipped: "too_many", siblings: 120 }, { group_id: "g-2", error: "boom" }] },
      error: null,
    }),
  });
  const result = await exportCompaniesToLeads(supabase, companies, session, flatten, { actorId: "admin-1" });
  assert.equal(result.groupMatesClaimed, 0);
  assert.equal(result.groupsTooLarge, 1); // the errored group is not "too large"
  assert.equal(supabase.calls.find(([name]) => name === "auto_claim_group_siblings_for")[1].p_actor, "admin-1");
});

test("nothing is asked when no lead was claimed", async () => {
  const supabase = fakeSupabase({
    claim_leads: () => ({ data: { claimed: [], blocked: [{ npi: "1000000001", owners: [] }], held: [], skipped: [] }, error: null }),
  });
  const result = await exportCompaniesToLeads(supabase, companies, session, flatten);
  assert.equal(result.rowsAdded, 0);
  assert.equal(result.groupMatesClaimed, 0);
  assert.ok(!supabase.calls.some(([name]) => name === "auto_claim_group_siblings_for"));
});

test("before sql/038, and when the group step fails, the claim still succeeds", async () => {
  for (const error of [
    { code: "PGRST202", message: "Could not find the function public.auto_claim_group_siblings_for" },
    { code: "XX000", message: "something broke" },
  ]) {
    const supabase = fakeSupabase({
      claim_leads: () => claimedBoth,
      auto_claim_group_siblings_for: () => ({ data: null, error }),
    });
    const result = await exportCompaniesToLeads(supabase, companies, session, flatten);
    assert.equal(result.rowsAdded, 2, "the claim itself is untouched");
    assert.equal(result.groupMatesClaimed, 0);
  }
});
