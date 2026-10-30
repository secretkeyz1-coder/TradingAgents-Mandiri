// The page's side of the script sandbox: one Web Worker (script.worker.ts),
// started on first use, answering runs in order.
import type { ScriptBar, ScriptRun } from '../../../../shared/script';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (run: ScriptRun) => void>();
// QuickJS stops a script after 3 s; this only guards against the worker itself dying.
const HARD_TIMEOUT_MS = 15_000;

function start(): Worker {
  const w = new Worker(new URL('./script.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; run: ScriptRun }>) => {
    pending.get(e.data.id)?.(e.data.run);
    pending.delete(e.data.id);
  };
  w.onerror = (e) => {
    for (const done of pending.values()) done({ ok: false, error: `Sandbox gagal: ${e.message || 'worker berhenti'}`, ms: 0 });
    pending.clear();
    worker = null;
  };
  return w;
}

export function runInSandbox(code: string, bars: ScriptBar[], inputs?: Record<string, number | boolean | string>): Promise<ScriptRun> {
  worker ??= start();
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      // A stuck worker is replaced; other runs waiting on it are answered too.
      worker?.terminate();
      worker = null;
      for (const done of pending.values()) done({ ok: false, error: 'Sandbox tidak menjawab', ms: HARD_TIMEOUT_MS });
      pending.clear();
      resolve({ ok: false, error: 'Sandbox tidak menjawab', ms: HARD_TIMEOUT_MS });
    }, HARD_TIMEOUT_MS);
    pending.set(id, (run) => {
      clearTimeout(timer);
      resolve(run);
    });
    worker!.postMessage({ id, code, bars, inputs });
  });
}
