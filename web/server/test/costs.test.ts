// Round-trip trade costs (ledger.ts tradeCost), the ones Uji indikator, the signal ledger and the
// creator records charge: IDX shares pay their broker on both legs, the rest keep their costs.
import { expect, test } from "bun:test";
import { tradeCost } from "../src/ledger";

test("IDX shares pay the broker's round trip on market and limit orders alike", () => {
  expect(tradeCost("BBCA.JK", 10_000)).toBeCloseTo(40);
  expect(tradeCost("BBCA.JK", 10_000, true)).toBeCloseTo(40);
  // Unchanged: crypto 0.2% either way, gold 0.40 USD, the rest 0.10% at market and 0.05% at a limit.
  expect(tradeCost("BTC-USD", 100_000)).toBeCloseTo(200);
  expect(tradeCost("BTC-USD", 100_000, true)).toBeCloseTo(200);
  expect(tradeCost("GC=F", 4_000)).toBeCloseTo(0.4);
  expect(tradeCost("AAPL", 200)).toBeCloseTo(0.2);
  expect(tradeCost("AAPL", 200, true)).toBeCloseTo(0.1);
});
