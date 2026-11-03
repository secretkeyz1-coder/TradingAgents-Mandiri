// The check every AI-written script passes before a member sees it (server/src/script-check.ts): it runs, shows
// something, does not decide a bar from the bars after it, and does not place most entries where its bar never traded.
import { describe, expect, test } from "bun:test";
import { SCRIPT_TEMPLATES } from "../../shared/script";
import { GUIDE_EXAMPLE } from "../../shared/script-guide";
import { checkScript } from "../src/script-check";
import { walkBars } from "./helpers";

const bars = walkBars(1200);
const context = { timeframe: "15m", tz: "UTC" };

describe("the check of an AI-written script", () => {
  test("a script that decides each bar from the bars up to it passes", async () => {
    const code = `const ema = ta.ema(close, 10); const atr = ta.atr(14); plot(ema, "EMA");
for (let i = 20; i < n; i++) if (close[i - 1] <= ema[i - 1] && close[i] > ema[i]) signal(i, "BUY", { sl: close[i] - 2 * atr[i], tp: close[i] + 4 * atr[i] });`;
    const c = await checkScript(code, bars, context);
    expect(c.ran).toBe(true);
    expect(c.problems).toEqual([]);
    expect(c.stats!.count).toBeGreaterThan(5);
  });

  test("a signal that needs the next bar is caught", async () => {
    const code = `const ema = ta.ema(close, 10); const atr = ta.atr(14);
for (let i = 20; i < n - 1; i++) if (close[i] <= ema[i] && close[i + 1] > ema[i]) signal(i, "BUY", { sl: close[i] - 2 * atr[i], tp: close[i] + 4 * atr[i] });`;
    const c = await checkScript(code, bars, context);
    expect(c.problems.join(" ")).toContain("candle sesudahnya");
  });

  test("a pivot read on its own bar is caught", async () => {
    const code = `const atr = ta.atr(14);
for (let i = 20; i < n - 2; i++) {
  if (low[i] < low[i - 1] && low[i] < low[i - 2] && low[i] < low[i + 1] && low[i] < low[i + 2]) signal(i, "BUY", { sl: low[i] - atr[i], tp: close[i] + 2 * atr[i] });
}`;
    const c = await checkScript(code, bars, context);
    expect(c.problems.join(" ")).toContain("candle sesudahnya");
  });

  test("a plot that reads the next bar is caught", async () => {
    const c = await checkScript(`plot(close.map((x, i) => (i + 1 < n ? close[i + 1] : NaN)), "depan");`, bars, context);
    expect(c.problems.join(" ")).toContain('Plot "depan"');
  });

  test("entries outside their bar without wait are named, with the fix", async () => {
    const code = `const atr = ta.atr(14);
for (let i = 20; i < n; i += 10) signal(i, "BUY", { entry: high[i] + 3 * atr[i], sl: low[i] - atr[i], tp: high[i] + 6 * atr[i] });`;
    const c = await checkScript(code, bars, context);
    expect(c.problems.join(" ")).toContain("wait");
  });

  test("a script that shows nothing, or does not run, says so", async () => {
    expect((await checkScript(`const x = 1;`, bars, context)).problems[0]).toContain("tidak menghasilkan");
    const broken = await checkScript(`nope();`, bars, context);
    expect(broken.ran).toBe(false);
    expect(broken.problems[0]).toContain("Skrip error");
  });

  test("the guide's full Pine example passes", async () => {
    const code = SCRIPT_TEMPLATES.find((t) => t.name === GUIDE_EXAMPLE)!.code;
    const c = await checkScript(code, bars, context);
    expect(c.ran).toBe(true);
    expect(c.problems).toEqual([]);
    expect(c.drawn.lines).toBeGreaterThan(0);
  }, 30_000);
});
