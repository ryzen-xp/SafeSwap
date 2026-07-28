import assert from "node:assert/strict";
import test from "node:test";
import {
  distributionsMatchBalance,
  sumDistributionAmounts,
} from "./dispute-resolution.ts";

test("matches exact decimal totals without floating-point rounding", () => {
  const distributions = [
    { address: "recipient-a", amount: "0.1" },
    { address: "recipient-b", amount: "0.2" },
  ];

  assert.equal(sumDistributionAmounts(distributions), "0.3");
  assert.equal(distributionsMatchBalance(distributions, "0.3"), true);
});

test("supports Stellar's seven-decimal precision", () => {
  const distributions = [
    { address: "recipient-a", amount: "1.0000001" },
    { address: "recipient-b", amount: "0.0000001" },
  ];

  assert.equal(sumDistributionAmounts(distributions), "1.0000002");
  assert.equal(distributionsMatchBalance(distributions, "1.0000002"), true);
  assert.equal(distributionsMatchBalance(distributions, "1.0000003"), false);
});

test("rejects amounts beyond supported precision", () => {
  assert.throws(
    () =>
      distributionsMatchBalance(
        [{ address: "recipient-a", amount: "0.00000001" }],
        "0.00000001"
      ),
    /at most 7 decimal places/
  );
});
