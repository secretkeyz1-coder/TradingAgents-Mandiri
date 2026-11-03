// The script runtime (shared/script.ts) counts a trade only at prices the market traded: an entry its bar never
// reached is no trade, an entry its bar reached together with the stop is a loss on that bar, and a stop that a bar
// opens past fills at that open. A target a bar opens past stays at the target, so no gap makes a result better.
// The chart, notifications, the lab and the ledger all follow trades through this runtime, in the real sandbox here.
import { expect, test } from "bun:test";
import { runScript, type ScriptBar } from "../../shared/script";
import { quickjs } from "../src/script-run";

/** 15m bars from [open, high, low, close]; two flat bars at 118 close the series, the last one still forming. */
function bars(rows: [number, number, number, number][]): ScriptBar[] {
  return [...rows, [118, 118, 118, 118], [118, 118, 118, 118]].map(([open, high, low, close], i) => {
    const t = new Date(Date.UTC(2026, 9, 1, 0, 0) + i * 15 * 60_000).toISOString();
    return { time: `${t.slice(0, 10)} ${t.slice(11, 16)}`, open, high, low, close, volume: 1 };
  });
}

async function run(code: string, rows: [number, number, number, number][]) {
  const out = runScript(await quickjs(), code, bars(rows));
  if (!out.ok) throw new Error(out.error);
  return out.result;
}

const FLAT: [number, number, number, number] = [100, 100, 100, 100];

test("an entry its bar never traded is no trade, and is counted as unfilled", async () => {
  // Bar 1 trades between 99 and 101: a buy limit at 95 never fills there, though bar 2 runs past the target.
  const r = await run(`signal(1, "BUY", { entry: 95, sl: 90, tp: 110 });`, [FLAT, [100, 101, 99, 100], [100, 120, 100, 118]]);
  expect(r.signals).toEqual([]);
  expect(r.stats).toMatchObject({ count: 0, unfilled: 1 });
});

test("a fill inside a bar that also reached the stop is a loss on that bar", async () => {
  // Bar 1 dips to 89: the buy limit at 95 fills, and the stop at 90 is touched in the same bar, order unknown.
  const r = await run(`signal(1, "BUY", { entry: 95, sl: 90, tp: 110 });`, [FLAT, [100, 101, 89, 100], [100, 120, 100, 118]]);
  expect(r.signals).toHaveLength(1);
  expect(r.signals[0]).toMatchObject({ outcome: "loss", r: -1, exitIndex: 1 });
  expect(r.stats.unfilled).toBe(0);
});

test("a fill inside a bar that kept clear of the stop goes on to its target", async () => {
  const r = await run(`signal(1, "BUY", { entry: 99.5, sl: 95, tp: 110 });`, [FLAT, [100, 101, 99, 100], [100, 120, 100, 118]]);
  expect(r.signals[0]).toMatchObject({ outcome: "win", exitIndex: 2 });
  expect(r.signals[0].r).toBeCloseTo((110 - 99.5) / (99.5 - 95));
});

test("a stop that a bar opens past is filled at that open, a loss beyond 1R", async () => {
  // In at bar 1's close (100) with the stop at 95; bar 2 opens at 90, below it: 2R lost, not 1R.
  const r = await run(`signal(1, "BUY", { sl: 95, tp: 110 });`, [FLAT, [100, 101, 99, 100], [90, 92, 85, 88]]);
  expect(r.signals[0]).toMatchObject({ outcome: "loss", exitIndex: 2 });
  expect(r.signals[0].r).toBeCloseTo(-2);
  // A sell's stop is above: a bar that opens over it fills there.
  const sell = await run(`signal(1, "SELL", { sl: 105, tp: 90 });`, [FLAT, [100, 101, 99, 100], [112, 115, 110, 114]]);
  expect(sell.signals[0].r).toBeCloseTo(-2.4);
});

test("a stop the bar trades through without a gap is 1R, and a target opened past stays at the target", async () => {
  const touched = await run(`signal(1, "BUY", { sl: 95, tp: 110 });`, [FLAT, [100, 101, 99, 100], [99, 100, 94, 96]]);
  expect(touched.signals[0]).toMatchObject({ outcome: "loss", r: -1 });
  const gapUp = await run(`signal(1, "BUY", { sl: 95, tp: 110 });`, [FLAT, [100, 101, 99, 100], [120, 125, 119, 122]]);
  expect(gapUp.signals[0]).toMatchObject({ outcome: "win", r: 2 });
});
