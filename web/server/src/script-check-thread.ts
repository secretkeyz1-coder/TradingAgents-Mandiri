// The draft check (script-check.ts) on a thread of its own, started by checkOffThread: a script runs synchronously in
// QuickJS, so on the server's thread a slow draft would hold up every other request while it ran. One message in, the
// check out; the thread is stopped after it answers.
import type { ScriptBar } from "../../shared/script";
import { checkScript } from "./script-check";

declare const self: Worker;

self.onmessage = async (event: MessageEvent<{ code: string; bars: ScriptBar[]; context: { timeframe?: string; tz?: string | null } }>) => {
  const { code, bars, context } = event.data;
  self.postMessage(await checkScript(code, bars, context));
};
