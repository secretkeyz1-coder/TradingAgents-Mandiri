// State that must agree across server instances: one instance leads the schedulers
// (locks.ts), leases keep one-at-a-time work to one holder, attempt limits count for
// every instance (limits.ts), and the status page reads what the leader checked
// (shared.ts). A second "instance" here is a second database session of this process.
import { afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db, pgClient } from "../src/db";
import { leases, rateLimits, sharedValues } from "../src/db/schema";
import { allow, clearFailures, lockedFor, recordFailure } from "../src/limits";
import { contendForLeadership, holdLease, isLeader, leaderOnly, leaseHeld, resignLeadership } from "../src/locks";
import { writeShared } from "../src/shared";
import { forgetStatus } from "../src/status";
import { admin, call, member } from "./helpers";

const LOCK = "tradingagents:scheduler";
afterAll(() => resignLeadership());

test("one instance leads the schedulers, and another takes over when it goes", async () => {
  await resignLeadership();
  let ticks = 0;
  const tick = leaderOnly(() => ticks++);

  const other = await pgClient.reserve();
  await other`select pg_advisory_lock(hashtext(${LOCK}))`;
  expect(await contendForLeadership()).toBe(false);
  tick();
  expect(isLeader()).toBe(false);
  expect(ticks).toBe(0);

  await other`select pg_advisory_unlock(hashtext(${LOCK}))`;
  other.release();
  expect(await contendForLeadership()).toBe(true);
  expect(await contendForLeadership()).toBe(true);
  tick();
  expect(ticks).toBe(1);

  // The leader's connection dies (the database restarted): it stops leading as soon as the connection
  // closes, its timers go quiet, and its next try takes the lock that died with the connection.
  const [held] = await pgClient`select pid from pg_locks where locktype = 'advisory' and granted
    and database = (select oid from pg_database where datname = current_database())`;
  await pgClient`select pg_terminate_backend(${held.pid})`;
  for (let i = 0; i < 100 && isLeader(); i++) await Bun.sleep(50);
  expect(isLeader()).toBe(false);
  tick();
  expect(ticks).toBe(1);
  expect(await contendForLeadership()).toBe(true);

  await resignLeadership();
  expect(isLeader()).toBe(false);
});

test("a lease lets one holder work at a time, and frees itself when its holder is gone", async () => {
  const first = await holdLease("test:lease", 60_000);
  expect(first).not.toBeNull();
  expect(await holdLease("test:lease", 60_000)).toBeNull();
  expect(await leaseHeld("test:lease")).toBe(true);
  await first!.release();
  expect(await leaseHeld("test:lease")).toBe(false);

  // A holder that crashed: its lease runs out, the next holder takes over, and the old handle cannot end the new lease.
  const crashed = await holdLease("test:lease", 60_000);
  await db.update(leases).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(leases.key, "test:lease"));
  expect(await leaseHeld("test:lease")).toBe(false);
  const next = await holdLease("test:lease", 60_000);
  expect(next).not.toBeNull();
  await crashed!.release();
  expect(await leaseHeld("test:lease")).toBe(true);
  await next!.release();
});

test("a held lease is renewed while its work runs", async () => {
  const lease = await holdLease("test:renew", 3_000);
  const expiry = async () => (await db.select({ at: leases.expiresAt }).from(leases).where(eq(leases.key, "test:renew")))[0].at.getTime();
  const before = await expiry();
  await Bun.sleep(1_500);
  expect(await expiry()).toBeGreaterThan(before);
  await lease!.release();
});

test("attempt limits count in one window per key, and start over when it ends", async () => {
  expect(await allow("test:allow", 2, 60_000)).toBe(true);
  expect(await allow("test:allow", 2, 60_000)).toBe(true);
  expect(await allow("test:allow", 2, 60_000)).toBe(false);
  await db.update(rateLimits).set({ resetAt: sql`now() - interval '1 second'` }).where(eq(rateLimits.key, "test:allow"));
  expect(await allow("test:allow", 2, 60_000)).toBe(true);

  for (let i = 0; i < 3; i++) await recordFailure("test:fail", 60_000);
  expect(await lockedFor("test:fail", 4)).toBe(0);
  await recordFailure("test:fail", 60_000);
  const wait = await lockedFor("test:fail", 4);
  expect(wait).toBeGreaterThan(50_000);
  expect(wait).toBeLessThanOrEqual(60_000);
  await clearFailures("test:fail");
  expect(await lockedFor("test:fail", 4)).toBe(0);
});

test("ten wrong passwords lock that address out, even for the right password, and no other", async () => {
  const m = await member();
  const from = (ip: string) => ({ "x-real-ip": ip });
  for (let i = 0; i < 10; i++) {
    expect((await call("/api/login", { headers: from("203.0.113.7"), body: { username: m.username, password: "salah" } })).status).toBe(401);
  }
  expect((await call("/api/login", { headers: from("203.0.113.7"), body: { username: m.username, password: m.password } })).status).toBe(429);
  expect((await call("/api/login", { headers: from("203.0.113.8"), body: { username: m.username, password: m.password } })).status).toBe(200);
});

test("the status page shows the round the leading instance checked last", async () => {
  const at = Date.now() - 60_000;
  await writeShared("status:latest", { at, parts: [{ key: "database", name: "Database", state: "ok", detail: "Menjawab dalam 3 ms" }] });
  forgetStatus();
  try {
    const r = await call("/api/public/status");
    expect(r.status).toBe(200);
    expect(r.body.checkedAt).toBe(new Date(at).toISOString());
    expect(r.body.parts.map((p: { key: string }) => p.key)).toEqual(["database"]);
  } finally {
    // The other files' status checks start from no round at all, whatever order the files run in.
    await db.delete(sharedValues).where(eq(sharedValues.key, "status:latest"));
    forgetStatus();
  }
});

test("a chat session another instance is answering shows busy and cannot be deleted", async () => {
  const m = await member();
  const session = await call("/api/agent/sessions", { cookie: m.cookie, body: { symbol: "BTC-USD" } });
  expect(session.status).toBe(201);
  const id = session.body.id as string;
  const answering = await holdLease(`agent:${id}`, 60_000);
  expect((await call(`/api/agent/sessions/${id}`, { cookie: m.cookie })).body.busy).toBe(true);
  expect((await call(`/api/agent/sessions/${id}`, { method: "DELETE", cookie: m.cookie })).status).toBe(409);
  await answering!.release();
  expect((await call(`/api/agent/sessions/${id}`, { cookie: m.cookie })).body.busy).toBe(false);
  expect((await call(`/api/agent/sessions/${id}`, { method: "DELETE", cookie: m.cookie })).status).toBe(200);
});

test("one Lab run at a time, whichever instance runs it", async () => {
  const cookie = await admin();
  const running = await holdLease("lab", 60_000);
  expect((await call("/api/lab", { cookie })).body.busy).toBe(true);
  const r = await call("/api/lab/run", { cookie, body: { strategy: { kind: "engine", name: "fib" }, symbols: ["BTC-USD"], timeframe: "1d", days: 30 } });
  expect(r.status).toBe(429);
  expect(r.body.error).toContain("Lab sedang");
  await running!.release();
  expect((await call("/api/lab", { cookie })).body.busy).toBe(false);
});
