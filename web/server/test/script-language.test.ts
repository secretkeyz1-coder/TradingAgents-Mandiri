// The script language's Pine-like parts (shared/script.ts, ADR 0024), in the real sandbox on bars made here:
// orders that wait for their price, two targets with breakeven, one position at a time as Pine holds it, the
// timeframe and time zone of the bars and sessions read in another zone, a higher timeframe built without
// repainting, ta.* that compute as Pine's do, and drawings.
import { describe, expect, test } from "bun:test";
import { runScript, type ScriptBar } from "../../shared/script";
import { quickjs } from "../src/script-run";

type Row = [number, number, number, number];

/** Bars from [open, high, low, close], `minutes` apart from `start` (wall-clock text); two flat bars at 100 close it, the last forming. */
function bars(rows: Row[], start = "2026-10-01 00:00", minutes = 15): ScriptBar[] {
  const t0 = Date.parse(`${start.replace(" ", "T")}:00Z`);
  return [...rows, [100, 100, 100, 100] as Row, [100, 100, 100, 100] as Row].map(([open, high, low, close], i) => {
    const t = new Date(t0 + i * minutes * 60_000).toISOString();
    return { time: `${t.slice(0, 10)} ${t.slice(11, 16)}`, open, high, low, close, volume: 10 + i };
  });
}

async function run(code: string, b: ScriptBar[], opts: { timeframe?: string; tz?: string } = {}) {
  const out = runScript(await quickjs(), code, b, opts);
  if (!out.ok) throw new Error(out.error);
  return out.result;
}

const FLAT: Row = [100, 100, 100, 100];

describe("orders that wait for their price", () => {
  test("a buy stop fills on the first later bar that reaches it, and follows from there", async () => {
    // Placed after bar 1 at 102 for 3 bars: bar 2 stays under it, bar 3 trades through and bar 4 reaches the target.
    const r = await run(`signal(1, "BUY", { entry: 102, wait: 3, sl: 98, tp: 110 });`, bars([FLAT, [100, 101, 99, 100], [100, 101.5, 99.5, 101], [101, 103, 100.5, 102.5], [102.5, 111, 102, 110]]));
    expect(r.signals[0]).toMatchObject({ order: "stop", wait: 3, fillIndex: 3, outcome: "win", exitIndex: 4 });
    expect(r.signals[0].r).toBeCloseTo(2);
  });

  test("an order its wait never reaches is unfilled, shown and counted", async () => {
    const r = await run(`signal(1, "BUY", { entry: 105, wait: 2, sl: 98, tp: 110 });`, bars([FLAT, [100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100], [100, 101, 99, 100]]));
    expect(r.signals[0]).toMatchObject({ outcome: "unfilled", fillIndex: null, exitIndex: 3, r: null });
    expect(r.stats).toMatchObject({ count: 1, unfilled: 1 });
  });

  test("a stop that a bar opens past fills at that open, so its R is measured from there", async () => {
    // Buy stop at 102, bar 2 opens at 104: filled at 104; the target at 110 then pays (110 - 104) / 4 = 1.5R.
    const r = await run(`signal(1, "BUY", { entry: 102, wait: 3, sl: 98, tp: 110 });`, bars([FLAT, [100, 101, 99, 100], [104, 105, 103.5, 104.5], [104.5, 111, 104, 110]]));
    expect(r.signals[0]).toMatchObject({ fillIndex: 2, fill: 104, outcome: "win" });
    expect(r.signals[0].r).toBeCloseTo(1.5);
  });

  test("a bar that fills the order and reaches the stop is a loss there", async () => {
    const r = await run(`signal(1, "BUY", { entry: 102, wait: 3, sl: 98, tp: 110 });`, bars([FLAT, [100, 101, 99, 100], [100, 103, 97, 99], [99, 111, 98.5, 110]]));
    expect(r.signals[0]).toMatchObject({ fillIndex: 2, outcome: "loss", exitIndex: 2, r: -1 });
  });

  test("a stop order's fill bar counts a target it reaches, since price went through the entry first", async () => {
    // Buy stop at 102 fills in bar 2, which runs on to 111 without touching the stop: the target at 110 is taken there.
    const one = await run(`signal(1, "BUY", { entry: 102, wait: 3, sl: 98, tp: 110 });`, bars([FLAT, [100, 101, 99, 100], [100, 111, 99.5, 110]]));
    expect(one.signals[0]).toMatchObject({ fillIndex: 2, outcome: "win", exitIndex: 2 });
    expect(one.signals[0].r).toBeCloseTo(2);
    // Two targets on that bar: both, breakeven only from the next bar (half at +1R, half at +2R).
    const two = await run(`signal(1, "BUY", { entry: 102, wait: 3, sl: 98, tp: [106, 110] });`, bars([FLAT, [100, 101, 99, 100], [100, 111, 99.5, 110]]));
    expect(two.signals[0]).toMatchObject({ outcome: "win", tp1Index: 2, exitIndex: 2 });
    expect(two.signals[0].r).toBeCloseTo(1.5);
    // Only the first: the rest goes on, its stop at breakeven from the next bar.
    const first = await run(`signal(1, "BUY", { entry: 102, wait: 3, sl: 98, tp: [106, 110] });`, bars([FLAT, [100, 101, 99, 100], [100, 107, 99.5, 105], [105, 105.5, 101, 101.5]]));
    expect(first.signals[0]).toMatchObject({ outcome: "partial", tp1Index: 2, exitIndex: 3 });
    expect(first.signals[0].r).toBeCloseTo(0.5);
  });

  test("a limit order's fill bar does not count a target: price may have been there before it came back to the entry", async () => {
    // Sell limit at 103: bar 2 trades 96 to 103.5, so the target at 97 may have come before the fill; bar 3 takes it.
    const r = await run(`signal(1, "SELL", { entry: 103, wait: 3, sl: 106, tp: 97 });`, bars([FLAT, [100, 101, 99, 100], [100, 103.5, 96, 103], [103, 103.2, 96.5, 97]]));
    expect(r.signals[0]).toMatchObject({ order: "limit", fillIndex: 2, outcome: "win", exitIndex: 3 });
  });

  test("a sell limit above the close fills when price comes up to it", async () => {
    const r = await run(`signal(1, "SELL", { entry: 103, wait: 3, sl: 106, tp: 97 });`, bars([FLAT, [100, 101, 99, 100], [100, 103.5, 99.5, 103], [103, 103.2, 96, 97]]));
    expect(r.signals[0]).toMatchObject({ order: "limit", fillIndex: 2, outcome: "win" });
    expect(r.signals[0].r).toBeCloseTo(2);
  });
});

describe("two targets", () => {
  const code = `signal(1, "BUY", { sl: 95, tp: [105, 110] });`;
  test("the first target, then breakeven: half at +1R, half at 0", async () => {
    const r = await run(code, bars([FLAT, [100, 101, 99, 100], [100, 106, 99.5, 104], [104, 104.5, 99, 100]]));
    expect(r.signals[0]).toMatchObject({ outcome: "partial", targets: [105, 110], takeProfit: 110, tp1Index: 2, size: 0.5, breakeven: true, exitIndex: 3 });
    expect(r.signals[0].r).toBeCloseTo(0.5);
    expect(r.stats.partial).toBe(1);
  });

  test("both targets: half at +1R and half at +2R", async () => {
    const r = await run(code, bars([FLAT, [100, 101, 99, 100], [100, 106, 99.5, 104], [104, 111, 103, 110]]));
    expect(r.signals[0]).toMatchObject({ outcome: "win" });
    expect(r.signals[0].r).toBeCloseTo(1.5);
  });

  test("the stop before the first target is the whole position's loss, and breakeven can be turned off", async () => {
    const loss = await run(code, bars([FLAT, [100, 101, 99, 100], [100, 101, 94, 95]]));
    expect(loss.signals[0]).toMatchObject({ outcome: "loss", r: -1 });
    const noBe = await run(`signal(1, "BUY", { sl: 95, tp: [105, 110], size: 0.25, breakeven: false });`, bars([FLAT, [100, 101, 99, 100], [100, 106, 99.5, 104], [104, 104.5, 94, 95]]));
    // A quarter at +1R, then three quarters at the original stop: 0.25 - 0.75 = -0.5R.
    expect(noBe.signals[0]).toMatchObject({ outcome: "partial" });
    expect(noBe.signals[0].r).toBeCloseTo(-0.5);
  });

  test("an open trade past its first target says so, for the chart to show where its stop now stands", async () => {
    const r = await run(`signal(1, "BUY", { sl: 95, tp: [105, 110], breakeven: false });`, bars([FLAT, [100, 101, 99, 100], [100, 106, 99.5, 104]]));
    expect(r.signals[0]).toMatchObject({ outcome: "open", fillIndex: 1, fill: 100, tp1Index: 2, breakeven: false, r: null });
  });
});

describe("one position at a time", () => {
  test("a signal while the position is open is skipped; one on the bar it closes is taken", async () => {
    const code = `
      signal(1, "BUY", { entry: 102, wait: 2, sl: 98, tp: 104, exclusive: true });
      signal(2, "BUY", { sl: 96, tp: 106, exclusive: true });
      signal(3, "BUY", { sl: 96, tp: 106, exclusive: true });`;
    // Bar 2 fills the order (its own signal is skipped); bar 3 reaches the target and closes it, so bar 3's signal opens the next.
    const r = await run(code, bars([FLAT, [100, 101, 99, 100], [100, 103, 100, 102.5], [102.5, 105, 102, 104], [104, 105, 103, 104]]));
    expect(r.signals.map((s) => s.index)).toEqual([1, 3]);
    expect(r.signals[0]).toMatchObject({ fillIndex: 2, outcome: "win", exitIndex: 3 });
    expect(r.signals[0].r).toBeCloseTo(0.5);
  });
});

describe("time, sessions and timeframes", () => {
  test("a script knows its timeframe, its bars' instants and their price step", async () => {
    const r = await run(`plot(close.map((_, i) => timeframe), "tf"); plot(close.map((_, i) => epoch[i] / 60000), "m"); plot(close.map(() => mintick), "tick");`, bars([[100.25, 100.5, 100, 100.25]]), { timeframe: "15m", tz: "Asia/Jakarta" });
    expect(r.plots[0].values[0]).toBe(15);
    // 00:00 in Jakarta is 17:00 UTC the day before.
    expect(new Date(r.plots[1].values[0]! * 60000).toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(r.plots[2].values[0]).toBe(0.01);
  });

  test("a session is read in the zone it names, whatever zone the bars are in", async () => {
    // Hourly bars stamped in UTC from 06:00: 08:00 UTC is 15:00 in Jakarta, inside London's 1500-1900 WIB.
    const b = bars(Array(6).fill(FLAT), "2026-10-01 06:00", 60);
    const r = await run(`plot(session("1500-1900", "Asia/Jakarta").map(Number), "wib"); plot(session("1500-1900").map(Number), "own");`, b, { timeframe: "1h", tz: "UTC" });
    expect(r.plots[0].values.slice(0, 6)).toEqual([0, 0, 1, 1, 1, 1]);
    // Without a zone the bars' own clock is read: 15:00 UTC is still ahead.
    expect(r.plots[1].values.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test("New York keeps its daylight saving rule", async () => {
    // 13:30 UTC is 09:30 in New York in summer (UTC-4), 08:30 in winter (UTC-5).
    const code = `plot(close.map((_, i) => hour(i, "America/New_York") * 100 + minute(i, "America/New_York")), "ny");`;
    const summer = await run(code, bars([FLAT], "2026-07-01 13:30"), { tz: "UTC" });
    const winter = await run(code, bars([FLAT], "2026-12-01 13:30"), { tz: "UTC" });
    expect(summer.plots[0].values[0]).toBe(930);
    expect(winter.plots[0].values[0]).toBe(830);
  });

  test("a higher timeframe from these bars: closed() is the last finished bar, value() changes on the bar that ends one", async () => {
    // Eight 15m bars from 00:00, closes 1 to 8: hour 00 ends at 4, hour 01 at 8.
    const rows: Row[] = [1, 2, 3, 4, 5, 6, 7, 8].map((c) => [c, c, c, c]);
    const r = await run(`const h = htf(60); plot(h.closed(h.close), "closed"); plot(h.value(h.close), "value"); plot(close.map(() => h.n), "n");`, bars(rows), { timeframe: "15m", tz: "UTC" });
    expect(r.plots[0].values.slice(0, 8)).toEqual([null, null, null, null, 4, 4, 4, 4]);
    // value() takes an hour's close on the bar that ends it (00:45), never earlier.
    expect(r.plots[1].values.slice(0, 8)).toEqual([null, null, null, 4, 4, 4, 4, 8]);
    expect(r.plots[2].values[0]).toBe(3);
  });
});

describe("ta.* as Pine computes them", () => {
  test("rma, and so atr and rsi, start from an SMA", async () => {
    const rows: Row[] = [10, 12, 11, 13, 15, 14].map((c) => [c, c + 1, c - 1, c]);
    const r = await run(`plot(ta.rma(close, 3), "rma"); plot(ta.rsi(close, 3), "rsi");`, bars(rows));
    expect(r.plots[0].values.slice(0, 4)).toEqual([null, null, 11, (13 + 2 * 11) / 3]);
    // rsi has no change on bar 0, so its first value is on bar 3.
    expect(r.plots[1].values.slice(0, 3)).toEqual([null, null, null]);
    expect(r.plots[1].values[3]).not.toBeNull();
  });

  test("pivots take separate left and right bars and sit on the bar that confirms them", async () => {
    // Lows: a dip at bar 3, two higher bars on its left and one on its right.
    const rows: Row[] = [9, 8, 7, 5, 6, 7, 8].map((l) => [10, 11, l, 10]);
    const r = await run(`plot(ta.pivotlow(2, 1), "pl");`, bars(rows));
    expect(r.plots[0].values.findIndex((v) => v != null)).toBe(4);
    expect(r.plots[0].values[4]).toBe(5);
  });

  test("barssince, valuewhen, supertrend and dmi give values in range", async () => {
    const rows: Row[] = Array.from({ length: 60 }, (_, i) => {
      const c = 100 + 10 * Math.sin(i / 5);
      return [c, c + 1, c - 1, c];
    });
    const r = await run(
      `const up = ta.crossover(close, ta.sma(close, 5));
       plot(ta.barssince(up), "since"); plot(ta.valuewhen(up, close, 0), "when");
       const st = ta.supertrend(3, 10); plot(st.direction, "dir"); const d = ta.dmi(14, 14); plot(d.adx, "adx");`,
      bars(rows),
    );
    const since = r.plots[0].values.filter((v): v is number => v != null);
    expect(since.length).toBeGreaterThan(0);
    expect(since.every((v) => v >= 0)).toBe(true);
    expect(r.plots[2].values.filter((v) => v != null).every((v) => v === 1 || v === -1)).toBe(true);
    const adx = r.plots[3].values.filter((v): v is number => v != null);
    expect(adx.length).toBeGreaterThan(0);
    expect(adx.every((v) => v >= 0 && v <= 100)).toBe(true);
  });
});

describe("drawings", () => {
  test("lines and labels come back with the run, and lineSet changes a line", async () => {
    const r = await run(
      `const id = line(0, 100, 2, 101, { color: "teal", width: 2, extend: "right" });
       lineSet(id, { x2: 3, y2: 102, style: "dotted" });
       label(1, 99, "BUY 6/8", { position: "below", color: "green" });`,
      bars([FLAT, FLAT, FLAT, FLAT]),
    );
    expect(r.lines).toEqual([{ x1: 0, y1: 100, x2: 3, y2: 102, color: "teal", style: "dotted", width: 2, extend: "right" }]);
    expect(r.labels).toEqual([{ index: 1, price: 99, text: "BUY 6/8", color: "green", position: "below" }]);
  });

  test("past the limit the oldest drawing goes, as Pine's max_lines_count; deleted and na ids take no changes", async () => {
    const out = runScript(
      await quickjs(),
      `const a = line(0, 1, 1, 1);
       const b = line(0, 2, 1, 2);
       const c = line(0, 3, 1, 3);
       lineSet(a, { y2: 9 });
       lineSet(NaN, { y2: 9 });
       lineDelete(b);
       line(0, 4, 1, 4);
       labelDelete(label(0, 5, "x"));
       label(1, 6, "y");`,
      bars([FLAT, FLAT]),
      { limits: { maxLines: 2 } },
    );
    if (!out.ok) throw new Error(out.error);
    expect(out.result.lines.map((l) => l.y1)).toEqual([3, 4]);
    expect(out.result.labels.map((l) => l.text)).toEqual(["y"]);
  });

  test("a line id that never existed is an error, so a typo shows", async () => {
    const out = runScript(await quickjs(), `lineSet(7, { y2: 1 });`, bars([FLAT]), {});
    expect(out.ok).toBe(false);
  });
});
