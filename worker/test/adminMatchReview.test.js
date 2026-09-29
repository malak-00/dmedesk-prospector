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
