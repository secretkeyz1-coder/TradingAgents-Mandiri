// Runs users' indicator scripts off the page's main thread, in the QuickJS
// sandbox the server uses too (web/shared/script.ts), so a heavy script never
// freezes the chart and gives the same signals as the alerts and the agent.
import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import { runScript, type QuickJSLike, type ScriptBar } from '../../../../shared/script';

let module: Promise<QuickJSLike> | null = null;

self.onmessage = async (event: MessageEvent<{ id: number; code: string; bars: ScriptBar[]; inputs?: Record<string, number | boolean | string> }>) => {
  module ??= newQuickJSWASMModuleFromVariant(variant) as Promise<QuickJSLike>;
  const { id, code, bars, inputs } = event.data;
  const run = runScript(await module, code, bars, { inputs });
  self.postMessage({ id, run });
};
