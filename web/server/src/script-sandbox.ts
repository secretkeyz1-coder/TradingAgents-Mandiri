// The QuickJS module the server runs users' scripts in (shared/script.ts), made once per thread. Kept apart from
// script-run.ts, which also loads candles (and with them every exchange's client), so a thread that only runs scripts
// (script-check-thread.ts) starts light.
import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import type { QuickJSLike } from "../../shared/script";

let module: Promise<QuickJSLike> | null = null;

/** The sandbox's module, made on first use. */
export const quickjs = () => (module ??= newQuickJSWASMModuleFromVariant(variant) as Promise<QuickJSLike>);
