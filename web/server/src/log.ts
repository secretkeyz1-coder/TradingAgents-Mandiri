// One JSON object per line: time, level, event name, and that event's fields, so the
// container log can be searched (`docker compose logs app | grep '"level":"error"'`)
// and shipped to any log service as it is. LOG_LEVEL (debug, info, warn, error,
// silent) sets the floor; the test suite runs at warn.
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const floor = ORDER[(process.env.LOG_LEVEL ?? "info") as Level] ?? ORDER.info;

/** An Error becomes its name, message and stack; JSON.stringify would print {}. */
function plain(_key: string, value: unknown) {
  return value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
}

function write(level: Level, event: string, fields: Record<string, unknown>) {
  if (ORDER[level] < floor) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields }, plain);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields: Record<string, unknown> = {}) => write("debug", event, fields),
  info: (event: string, fields: Record<string, unknown> = {}) => write("info", event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) => write("warn", event, fields),
  error: (event: string, fields: Record<string, unknown> = {}) => write("error", event, fields),
};
