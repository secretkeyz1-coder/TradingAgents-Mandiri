// One login for the whole app, set by APP_USER / APP_PASSWORD. The login page
// posts here and gets an HMAC-signed session cookie; scripts may send HTTP Basic
// credentials instead. With no APP_PASSWORD (local development) all of this is off.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { z } from "zod";
import { config } from "./config";

const COOKIE = "ta_session";
const SESSION_DAYS = 30;
// Failed logins per client address before it has to wait out the window.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

export const authEnabled = () => Boolean(config.appPassword);

// Sessions survive restarts; changing the password (or SESSION_SECRET) ends them all.
const secret = process.env.SESSION_SECRET || createHmac("sha256", config.appPassword).update("tradingagents-session").digest("hex");

/** Constant-time comparison, so a wrong guess takes as long as a right one. */
function same(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

const credentialsOk = (user: string, password: string) =>
  same(user, config.appUser) && same(password, config.appPassword);

/** Behind the proxy, X-Real-IP is the client (nginx sets it); run directly, every caller shares one bucket. */
const clientAddress = (c: Context) => c.req.header("x-real-ip") ?? "direct";
const failures = new Map<string, { count: number; until: number }>();

function blockedFor(address: string): number {
  const entry = failures.get(address);
  if (!entry || entry.until < Date.now()) return 0;
  return entry.count >= MAX_FAILURES ? entry.until - Date.now() : 0;
}

function recordFailure(address: string) {
  const now = Date.now();
  const entry = failures.get(address);
  if (!entry || entry.until < now) failures.set(address, { count: 1, until: now + FAILURE_WINDOW_MS });
  else entry.count += 1;
}

async function sessionUser(c: Context): Promise<string | null> {
  const value = await getSignedCookie(c, secret, COOKIE);
  if (!value) return null;
  const [user, expires] = value.split("|");
  return user === config.appUser && Number(expires) > Date.now() ? user : null;
}

function basicUser(c: Context): string | null {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const at = decoded.indexOf(":");
  if (at < 0) return null;
  const [user, password] = [decoded.slice(0, at), decoded.slice(at + 1)];
  return credentialsOk(user, password) ? user : null;
}

/** Guards /api/*. No WWW-Authenticate challenge: the page shows its own login form. */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!authEnabled()) return next();
  if ((await sessionUser(c)) || basicUser(c)) return next();
  return c.json({ error: "Belum masuk" }, 401);
};

export const authApi = new Hono();

authApi.get("/session", async (c) => {
  if (!authEnabled()) return c.json({ auth: false, user: null });
  const user = await sessionUser(c);
  return user ? c.json({ auth: true, user }) : c.json({ error: "Belum masuk" }, 401);
});

const loginSchema = z.object({ username: z.string().max(200), password: z.string().max(500) });

authApi.post("/login", async (c) => {
  if (!authEnabled()) return c.json({ auth: false, user: null });
  const address = clientAddress(c);
  const wait = blockedFor(address);
  if (wait) return c.json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60_000)} menit.` }, 429);
  const body = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success || !credentialsOk(body.data.username, body.data.password)) {
    recordFailure(address);
    return c.json({ error: "Nama pengguna atau kata sandi salah." }, 401);
  }
  failures.delete(address);
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await setSignedCookie(c, COOKIE, `${config.appUser}|${expires}`, secret, {
    httpOnly: true,
    sameSite: "Lax",
    // The proxy terminates TLS; run directly on localhost the cookie must work over plain HTTP.
    secure: c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return c.json({ auth: true, user: config.appUser });
});

authApi.post("/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});
