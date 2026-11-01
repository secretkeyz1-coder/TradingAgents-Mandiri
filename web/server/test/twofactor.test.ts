// Two-step sign-in (auth.ts, totp.ts): setup and enable, a ticket after the password,
// every code and recovery code good once, a reset link that still asks for the code,
// the admin's switch-off, and the wait after ten wrong codes. The tests run in order
// on one member. Codes come from the real clock, so a test may wait for the next
// 30-second step.
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { admin, call, codeAt, lastMail, member, nextCode, step, useStep } from "./helpers";

describe("two-step sign-in", () => {
  let m: Awaited<ReturnType<typeof member>>;
  let password = "";
  let cookie = "";
  let secret = "";
  let recovery: string[] = [];
  let renewed: string[] = [];
  let enabledAt = 0;
  const ticket = async () => (await call("/api/login", { body: { username: m.username, password } })).body.ticket as string;

  test("with 2FA off the password alone signs in", async () => {
    m = await member({ verified: true });
    password = m.password;
    const r = await call("/api/login", { body: { username: m.username, password } });
    expect(r.status).toBe(200);
    expect(r.body.auth).toBe(true);
    cookie = r.cookie;
  });

  test("setup gives a base32 secret and an otpauth link", async () => {
    const r = await call("/api/me/2fa/setup", { method: "POST", cookie });
    expect(r.status).toBe(200);
    secret = r.body.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(String(r.body.uri).startsWith("otpauth://totp/")).toBe(true);
  });

  test("enable refuses a code that is not current", async () => {
    expect((await call("/api/me/2fa/enable", { cookie, body: { code: codeAt(secret, step() + 7) } })).status).toBe(400);
  });

  test("enable turns it on with eight recovery codes and signs out the other browsers", async () => {
    enabledAt = step();
    const r = await call("/api/me/2fa/enable", { cookie, body: { code: codeAt(secret, enabledAt) } });
    useStep(enabledAt);
    expect(r.status).toBe(200);
    expect(r.body.user.twoFactor).toBe(true);
    recovery = r.body.recoveryCodes;
    expect(new Set(recovery).size).toBe(8);
    expect((await call("/api/session", { cookie })).status).toBe(401);
    expect((await call("/api/session", { cookie: r.cookie })).status).toBe(200);
    cookie = r.cookie;
  });

  test("only hashes of the recovery codes are kept", async () => {
    const [row] = await db.select().from(users).where(eq(users.id, m.id));
    expect(row.recoveryCodes).toHaveLength(8);
    expect(row.recoveryCodes.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    expect(row.recoveryCodes.some((h) => recovery.includes(h))).toBe(false);
    expect(row.totpPending).toBeNull();
  });

  test("Basic auth is refused once 2FA is on", async () => {
    const basic = Buffer.from(`${m.username}:${password}`).toString("base64");
    expect((await call("/api/me", { headers: { authorization: `Basic ${basic}` } })).status).toBe(401);
  });

  test("the password then earns only a ticket; a used or tampered one fails, the next code signs in", async () => {
    const login = await call("/api/login", { body: { username: m.username, password } });
    expect(login.status).toBe(200);
    expect(login.body.auth).toBe(false);
    expect(login.body.twoFactor).toBe(true);
    expect(login.cookie.includes("=")).toBe(false);
    const t = String(login.body.ticket);
    expect(t.split(".")).toHaveLength(4);
    expect((await call("/api/login/2fa", { body: { ticket: t, code: codeAt(secret, enabledAt) } })).status).toBe(401);
    const tampered = t.slice(0, -1) + (t.endsWith("A") ? "B" : "A");
    expect((await call("/api/login/2fa", { body: { ticket: tampered, code: codeAt(secret, enabledAt + 1) } })).status).toBe(410);
    const r = await call("/api/login/2fa", { body: { ticket: t, code: await nextCode(secret) } });
    expect(r.status).toBe(200);
    expect(r.body.auth).toBe(true);
    cookie = r.cookie;
  }, 90_000);

  test("a recovery code signs in once, in any case; of two racing sign-ins only one gets in", async () => {
    expect((await call("/api/login/2fa", { body: { ticket: await ticket(), code: recovery[0].toUpperCase() } })).status).toBe(200);
    expect((await call("/api/login/2fa", { body: { ticket: await ticket(), code: recovery[0] } })).status).toBe(401);
    const tickets = await Promise.all([ticket(), ticket()]);
    const race = await Promise.all(tickets.map((t) => call("/api/login/2fa", { body: { ticket: t, code: recovery[2] } })));
    expect(race.filter((x) => x.status === 200)).toHaveLength(1);
  });

  test("new recovery codes for a code from the app, and the old ones stop working", async () => {
    const r = await call("/api/me/2fa/recovery", { cookie, body: { code: await nextCode(secret) } });
    expect(r.status).toBe(200);
    renewed = r.body.recoveryCodes;
    expect(renewed).toHaveLength(8);
    expect(renewed.some((c) => recovery.includes(c))).toBe(false);
    expect((await call("/api/login/2fa", { body: { ticket: await ticket(), code: recovery[1] } })).status).toBe(401);
  }, 90_000);

  test("a reset link proves the inbox, not the phone: it still asks for the code", async () => {
    await call("/api/password/forgot", { body: { email: m.email } });
    for (let i = 0; i < 20 && !lastMail(m.email)?.text.includes("reset?token="); i++) await Bun.sleep(50);
    const token = lastMail(m.email)?.text.match(/reset\?token=([\w-]+)/)?.[1];
    expect(token).toBeTruthy();
    password = crypto.randomUUID();
    let r = await call("/api/password/reset", { body: { token, password } });
    expect(r.status).toBe(200);
    expect(r.body.twoFactor).toBe(true);
    expect(typeof r.body.ticket).toBe("string");
    expect(r.cookie.includes("=")).toBe(false);
    r = await call("/api/login/2fa", { body: { ticket: r.body.ticket, code: renewed[0] } });
    expect(r.status).toBe(200);
    expect(r.body.auth).toBe(true);
    cookie = r.cookie;
  });

  test("2FA off with a recovery code, then the password alone signs in again", async () => {
    const r = await call("/api/me/2fa/disable", { cookie, body: { code: renewed[1] } });
    expect(r.status).toBe(200);
    expect(r.body.user.twoFactor).toBe(false);
    const login = await call("/api/login", { body: { username: m.username, password } });
    expect(login.body.auth).toBe(true);
    cookie = login.cookie;
  });

  test("the admin can turn a member's 2FA off, and the password signs in again", async () => {
    let r = await call("/api/me/2fa/setup", { method: "POST", cookie });
    const second = r.body.secret as string;
    const s = step();
    r = await call("/api/me/2fa/enable", { cookie, body: { code: codeAt(second, s) } });
    useStep(s);
    cookie = r.cookie || cookie;
    r = await call(`/api/users/${m.id}`, { method: "PATCH", cookie: await admin(), body: { twoFactor: false } });
    expect(r.status).toBe(200);
    expect(r.body.twoFactor).toBe(false);
    const login = await call("/api/login", { body: { username: m.username, password } });
    expect(login.body.auth).toBe(true);
    cookie = login.cookie;
  });

  test("ten wrong codes for one account, then it must wait, even with the right code", async () => {
    let r = await call("/api/me/2fa/setup", { method: "POST", cookie });
    const third = r.body.secret as string;
    const s = step();
    r = await call("/api/me/2fa/enable", { cookie, body: { code: codeAt(third, s) } });
    useStep(s);
    cookie = r.cookie || cookie;
    const guesses: number[] = [];
    for (let i = 0; i < 11; i++) guesses.push((await call("/api/me/2fa/recovery", { cookie, body: { code: codeAt(third, s + 9 + i) } })).status);
    expect(guesses.slice(0, 10).every((x) => x === 400)).toBe(true);
    expect(guesses[10]).toBe(429);
    expect((await call("/api/me/2fa/recovery", { cookie, body: { code: await nextCode(third) } })).status).toBe(429);
  }, 90_000);
});
