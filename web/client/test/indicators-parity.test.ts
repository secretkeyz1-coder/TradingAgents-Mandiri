// Parity of the indicator engines that exist twice: the chart draws the TypeScript ones
// (src/lib/indicators/pob.ts, fib.ts, scalper.ts) and the Telegram notifications come from
// the Python ones the signal scan runs (web/worker/pob.py, fib.py, and Scalper Pro+ in
// chart_agent.scalper_signal through signals.py). Both must find the same signals on the same
// bars, with the same levels and outcomes, or a notification points at a signal the chart
// does not show.
//
// Every fixture in test/fixtures (real candles, saved once) runs through each engine the server
// scans its timeframe with (COMBOS in web/server/src/alerts.ts), on both sides with the
// server's settings; test/parity_runner.py runs the Python side. From web/client:
//   bun test test/
// Python is $PYTHON, else the repo's .venv, else python3. The scalper needs pandas
// (chart_agent imports it); pob.py and fib.py need only the standard library.
import { describe, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Candle } from '../src/lib/api';
import { fib, FIB_DEFAULTS } from '../src/lib/indicators/fib';
import { pob, POB_DEFAULTS } from '../src/lib/indicators/pob';
import { scalper, SCALPER_DEFAULTS } from '../src/lib/indicators/scalper';

const FIXTURES = join(import.meta.dir, 'fixtures');
const RUNNER = join(import.meta.dir, 'parity_runner.py');
const VENV = join(import.meta.dir, '..', '..', '..', '.venv');
const VENV_PYTHON = [join(VENV, 'Scripts', 'python.exe'), join(VENV, 'bin', 'python')].find((p) => existsSync(p));
const PYTHON = process.env.PYTHON || VENV_PYTHON || 'python3';
const REL_TOL = 1e-6;
/** Differing signals printed when a comparison fails; the first one is usually the cause of the rest. */
const SHOW = 6;
/** Per test: a cold Python start that imports pandas takes several seconds on Windows. */
const TIMEOUT_MS = 60_000;

type Engine = 'pob' | 'fib' | 'scalper';
type Timeframe = '15m' | '1h' | '1d';
type Fixture = { name: string; symbol: string; interval: Timeframe; candles: Candle[] };
type Value = string | number | boolean | null | undefined;
/** A signal reduced to fields both sides share; `noLevels` marks one whose levels the chart cannot give. */
type Sig = { index: number; time: string; side: string; noLevels?: boolean; [field: string]: Value };

/** The timeframes the server scans each engine on (COMBOS in web/server/src/alerts.ts). */
const SCANNED: Record<Engine, Timeframe[]> = { pob: ['15m', '1h'], scalper: ['15m'], fib: ['15m', '1h', '1d'] };

/** Fields compared exactly, then within REL_TOL. */
const FIELDS: Record<Engine, { exact: string[]; close: string[] }> = {
  pob: {
    exact: ['time', 'side', 'setup', 'plus', 'ck2', 'ck3', 'label', 'outcome', 'exitIndex'],
    close: ['entry', 'stopLoss', 'takeProfit', 'zoneTop', 'zoneBottom', 'r'],
  },
  fib: { exact: ['time', 'side', 'label', 'outcome', 'exitIndex'], close: ['entry', 'stopLoss', 'takeProfit', 'legFrom', 'legTo', 'r'] },
  // The chart neither labels nor follows a scalper signal (it draws only the newest one's levels),
  // so the server's label ("BUY · UT Bot") and outcome have nothing to compare with.
  scalper: { exact: ['time', 'side'], close: ['entry', 'stopLoss', 'takeProfit'] },
};

/** Chart-only scalper settings: they change the drawing, not the signals, and the server has no such input. */
const DRAWING_ONLY = new Set(['extendBars', 'showTrail', 'showEmas', 'showZone', 'showTrendlines', 'showDashboard']);

/** A bar's time as the scan prints it ("2026-10-31 12:15"), so both sides name a bar alike. */
const scanTime = (t: string) => t.replace('T', ' ').slice(0, 16);

function fail(message: string): never {
  throw new Error(message);
}

function runPython(job: object): Record<string, unknown> {
  let proc;
  try {
    proc = Bun.spawnSync([PYTHON, RUNNER], { stdin: new TextEncoder().encode(JSON.stringify(job)), stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    fail(`cannot start ${PYTHON} (set PYTHON to a Python 3 with pandas): ${(err as Error).message}`);
  }
  if (proc.exitCode !== 0) {
    const tail = proc.stderr.toString().trim().split('\n').slice(-20).join('\n');
    fail(`${PYTHON} parity_runner.py ${proc.exitCode == null ? 'was killed' : `exited with ${proc.exitCode}`}:\n${tail}`);
  }
  const lines = proc.stdout.toString().trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

/** The chart's signals: what the TypeScript engine draws, with the server's settings. */
function chartSignals(engine: Engine, candles: Candle[], tf: Timeframe): Sig[] {
  const at = (index: number) => scanTime(candles[index].time);
  if (engine === 'pob') return (pob(candles, tf as '15m' | '1h')?.signals ?? []).map((x) => ({ ...x, time: at(x.index) }));
  if (engine === 'fib') return (fib(candles)?.signals ?? []).map((x) => ({ ...x, time: at(x.index) }));
  return (scalper(candles, SCALPER_DEFAULTS)?.signals ?? []).map(({ index, side }) => {
    // The chart draws levels for the newest signal only: these are the ones it drew while this signal
    // was the newest, from the bars up to it plus the forming one. Too few bars there gives none.
    const setup = scalper(candles.slice(0, index + 2), SCALPER_DEFAULTS)?.setup;
    if (!setup) return { index, time: at(index), side, noLevels: true };
    if (setup.index !== index || setup.side !== side) {
      fail(`scalper.ts repaints: on the bars up to ${at(index)} its newest signal is ${setup.side} at ${at(setup.index)}, not ${side}`);
    }
    return { index, time: at(index), side, entry: setup.entry, stopLoss: setup.stopLoss, takeProfit: setup.takeProfit };
  });
}

/** The notifications' signals: what parity_runner.py gets from web/worker, under the TypeScript names. */
function serverSignals(engine: Engine, candles: Candle[], tf: Timeframe): Sig[] {
  return runPython({ engine, timeframe: tf, candles }).signals as Sig[];
}

const near = (a: Value, b: Value) =>
  a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= REL_TOL * Math.max(Math.abs(a), Math.abs(b)) + 1e-12);

const show = (v: Value) => (typeof v === 'number' ? String(Number(v.toPrecision(10))) : JSON.stringify(v ?? null));

function brief(s: Sig) {
  const extra = ['setup', 'label', 'entry', 'stopLoss', 'takeProfit', 'outcome'].filter((f) => s[f] !== undefined && s[f] !== null);
  return `bar ${s.index} ${s.time} ${s.side} (${extra.map((f) => `${f} ${show(s[f])}`).join(', ')})`;
}

/** Signals matched by bar and side; every difference as a line, oldest bar first. */
function compare(engine: Engine, chart: Sig[], server: Sig[]) {
  const { exact, close } = FIELDS[engine];
  const key = (s: Sig) => `${s.index}|${s.side}`;
  const serverBy = new Map(server.map((s) => [key(s), s]));
  const chartKeys = new Set(chart.map(key));
  const rows: { index: number; text: string }[] = [];
  let identical = 0;
  let levelsCompared = 0;
  for (const a of chart) {
    const b = serverBy.get(key(a));
    if (!b) {
      rows.push({ index: a.index, text: `only on the chart: ${brief(a)}` });
      continue;
    }
    const bad: string[] = [];
    for (const f of exact) if (a[f] !== b[f]) bad.push(`${f} ${show(a[f])} | ${show(b[f])}`);
    if (!a.noLevels) {
      levelsCompared++;
      for (const f of close) {
        const x = a[f];
        const y = b[f];
        if (near(x, y)) continue;
        const rel = typeof x === 'number' && typeof y === 'number' ? ` (rel ${(Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y))).toExponential(1)})` : '';
        bad.push(`${f} ${show(x)} | ${show(y)}${rel}`);
      }
    }
    if (bad.length) rows.push({ index: a.index, text: `bar ${a.index} ${a.time} ${a.side}: ${bad.join('; ')}` });
    else identical++;
  }
  for (const b of server) if (!chartKeys.has(key(b))) rows.push({ index: b.index, text: `only in the notifications: ${brief(b)}` });
  rows.sort((x, y) => x.index - y.index);
  return { rows, identical, levelsCompared };
}

const fixtures: Fixture[] = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ name: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) }));

describe('indicator parity: chart (TypeScript) vs notifications (Python)', () => {
  test('fixtures are present', () => {
    if (!fixtures.length) fail(`no fixtures in ${FIXTURES}`);
  });

  test('the server runs each engine with the chart defaults', () => {
    // A user may change the scalper's settings on the chart; the notifications always use these defaults.
    const server = runPython({ engine: 'defaults' }).defaults as Record<Engine, Record<string, unknown>>;
    const chart: Record<Engine, Record<string, unknown>> = { pob: POB_DEFAULTS, fib: FIB_DEFAULTS, scalper: SCALPER_DEFAULTS };
    const problems: string[] = [];
    for (const engine of ['pob', 'fib', 'scalper'] as const) {
      for (const [key, value] of Object.entries(server[engine])) {
        const mine = chart[engine][key];
        const same = typeof mine === 'boolean' ? mine === Boolean(value) : mine === value;
        if (!same) problems.push(`${engine}.${key}: chart ${JSON.stringify(mine)} | server ${JSON.stringify(value)}`);
      }
      for (const key of Object.keys(chart[engine])) {
        if (!(key in server[engine]) && !DRAWING_ONLY.has(key)) problems.push(`${engine}.${key}: chart ${JSON.stringify(chart[engine][key])} | server has no such setting`);
      }
    }
    if (problems.length) fail(`default settings differ (chart | server):\n  ${problems.join('\n  ')}`);
  }, TIMEOUT_MS);

  for (const fx of fixtures) {
    for (const engine of (Object.keys(SCANNED) as Engine[]).filter((e) => SCANNED[e].includes(fx.interval))) {
      test(
        `${engine} ${fx.interval} on ${fx.name} (${fx.candles.length} bars)`,
        () => {
          const chart = chartSignals(engine, fx.candles, fx.interval);
          const server = serverSignals(engine, fx.candles, fx.interval);
          const { rows, identical, levelsCompared } = compare(engine, chart, server);
          const levels = engine === 'scalper' ? `, levels compared on ${levelsCompared}` : '';
          const head = `${engine} ${fx.interval} on ${fx.name}: chart ${chart.length} signals, notifications ${server.length}; ${identical} identical${levels}`;
          console.log(head);
          if (rows.length) {
            const more = rows.length > SHOW ? `\n  … and ${rows.length - SHOW} more` : '';
            fail(`${head}, ${rows.length} differ (values: chart | notifications)\n  ${rows.slice(0, SHOW).map((r) => r.text).join('\n  ')}${more}`);
          }
        },
        TIMEOUT_MS,
      );
    }
  }
});
