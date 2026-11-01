// Numbers about the server for a Prometheus scrape (GET /metrics, behind
// METRICS_TOKEN): requests by route pattern and status with their durations, the
// analysis queue, recent server errors, whether this instance runs the
// schedulers, and the process's uptime and memory. Request figures are this
// process's own (each instance is scraped on its own); the queue, error and scan
// figures come from the database and read the same on every instance.
import { count, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { analyses, serverErrors } from "./db/schema";
import { isLeader } from "./locks";
import { readShared } from "./shared";

/** Upper bounds of the duration histogram, in seconds. */
const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const STARTED = Date.now();
const requests = new Map<string, number>();
const durations = new Map<string, { buckets: number[]; sum: number; count: number }>();

/** Counts one answered request under its route pattern ("/api/analyses/:id"), never its path, which carries ids. */
export function observeRequest(method: string, route: string, status: number, seconds: number) {
  const key = JSON.stringify([method, route, status]);
  requests.set(key, (requests.get(key) ?? 0) + 1);
  let d = durations.get(route);
  if (!d) durations.set(route, (d = { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }));
  BUCKETS.forEach((le, i) => {
    if (seconds <= le) d.buckets[i] += 1;
  });
  d.sum += seconds;
  d.count += 1;
}

const label = (value: string | number) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

/** The figures in Prometheus's text format. */
export async function metricsText(): Promise<string> {
  const out: string[] = [];
  const head = (name: string, type: "counter" | "gauge" | "histogram", help: string) => out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);

  head("ta_http_requests_total", "counter", "HTTP requests this process answered, by method, route pattern and status.");
  for (const [key, n] of requests) {
    const [method, route, status] = JSON.parse(key) as [string, string, number];
    out.push(`ta_http_requests_total{method="${label(method)}",route="${label(route)}",status="${status}"} ${n}`);
  }
  head("ta_http_request_duration_seconds", "histogram", "Time this process took to answer HTTP requests, by route pattern.");
  for (const [route, d] of durations) {
    const r = label(route);
    BUCKETS.forEach((le, i) => out.push(`ta_http_request_duration_seconds_bucket{route="${r}",le="${le}"} ${d.buckets[i]}`));
    out.push(`ta_http_request_duration_seconds_bucket{route="${r}",le="+Inf"} ${d.count}`);
    out.push(`ta_http_request_duration_seconds_sum{route="${r}"} ${d.sum.toFixed(6)}`);
    out.push(`ta_http_request_duration_seconds_count{route="${r}"} ${d.count}`);
  }

  const [queue] = await db
    .select({
      queued: sql<number>`(count(*) filter (where ${analyses.status} = 'queued'))::int`,
      running: sql<number>`(count(*) filter (where ${analyses.status} = 'running'))::int`,
      wait: sql<string | null>`extract(epoch from now() - min(${analyses.createdAt}) filter (where ${analyses.status} = 'queued'))`,
    })
    .from(analyses)
    .where(inArray(analyses.status, ["queued", "running"]));
  head("ta_analyses", "gauge", "Analyses and backtests queued or running, on every instance and worker.");
  out.push(`ta_analyses{status="queued"} ${queue?.queued ?? 0}`, `ta_analyses{status="running"} ${queue?.running ?? 0}`);
  head("ta_analysis_oldest_queued_seconds", "gauge", "How long the oldest queued analysis has waited; 0 when none waits.");
  out.push(`ta_analysis_oldest_queued_seconds ${Math.max(0, Math.round(Number(queue?.wait ?? 0)))}`);

  const [errors] = await db.select({ n: count() }).from(serverErrors).where(gte(serverErrors.createdAt, new Date(Date.now() - 3_600_000)));
  head("ta_server_errors_last_hour", "gauge", "Server errors recorded in the last hour (requests that ended in a 500, background work that broke).");
  out.push(`ta_server_errors_last_hour ${errors?.n ?? 0}`);

  const scan = await readShared<{ at: number; ok: boolean }>("scan:last");
  head("ta_signal_scan_last_timestamp_seconds", "gauge", "When the last full signal scan finished, in Unix time; 0 before the first.");
  out.push(`ta_signal_scan_last_timestamp_seconds ${scan ? Math.round(scan.at / 1000) : 0}`);
  head("ta_signal_scan_last_ok", "gauge", "1 when the last full signal scan finished without an error.");
  out.push(`ta_signal_scan_last_ok ${scan?.ok ? 1 : 0}`);

  head("ta_scheduler_leader", "gauge", "1 when this instance runs the schedulers.");
  out.push(`ta_scheduler_leader ${isLeader() ? 1 : 0}`);
  head("ta_process_uptime_seconds", "gauge", "Seconds since this process started.");
  out.push(`ta_process_uptime_seconds ${Math.round((Date.now() - STARTED) / 1000)}`);
  head("ta_process_resident_memory_bytes", "gauge", "Resident memory of this process.");
  out.push(`ta_process_resident_memory_bytes ${process.memoryUsage().rss}`);
  return `${out.join("\n")}\n`;
}
