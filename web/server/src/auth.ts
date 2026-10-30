// Accounts and sessions. The admin creates accounts (no sign-up); the first
// admin is made from APP_USER / APP_PASSWORD at boot and receives everything
// stored before accounts existed. The login page posts here and gets an
// HMAC-signed session cookie; scripts may send HTTP Basic credentials instead.
// With no APP_PASSWORD (local development) there is no login: every request
// acts as that first admin.
import { createHmac } from "node:crypto";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { z } from "zod";
import { config } from "./config";
import { db } from "./db";
import { agentMemories, agentSessions, agentSkills, analyses, chartDrawings, users, watchlist, watchRuns } from "./db/schema";

export type User = typeof users.$inferSelect;
/** Every authenticated route reads the signed-in user with c.get("user"). */
export type AppEnv = { Variables: { user: User } };

const COOKIE = "ta_session";
const SESSION_DAYS = 30;
// Failed logins per client address before it has to wait out the window.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export const authEnabled = () => Boolean(config.appPassword);
export const isAdmin = (u: User) => u.role === "admin";

// Signs the cookie. Sessions survive restarts; SESSION_SECRET (or APP_PASSWORD) changing ends them all.
const secret = process.env.SESSION_SECRET || createHmac("sha256", config.appPassword || "local").update("tradingagents-session").digest("hex");

/** Hashed once, so a login for a name that does not exist costs the same time as a wrong password. */
const decoyHash = Bun.password.hash("decoy-password-for-timing");

async function checkPassword(username: string, password: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.username, username.trim().toLowerCase()));
  const ok = await Bun.password.verify(password, user?.passwordHash ?? (await decoyHash));
  return user && ok && !user.disabled ? user : null;
}

/**
 * At boot: make the first admin if there are no accounts, then give every row
 * stored before accounts existed to the first admin. Returns that admin.
 */
let localAdmin: User | null = null;
export async function ensureAccounts(): Promise<User> {
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n === 0) {
    const username = (config.appUser || "admin").toLowerCase();
    const password = config.appPassword || crypto.randomUUID();
    await db.insert(users).values({
      username,
      passwordHash: await Bun.password.hash(password),
      role: "admin",
      telegramChatId: process.env.TELEGRAM_CHAT_ID || null,
    });
    console.log(`account: first admin "${username}" created from APP_USER / APP_PASSWORD`);
  }
  const [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.disabled, false)))
    .orderBy(users.createdAt)
    .limit(1);
  if (!admin) throw new Error("Tidak ada admin aktif di tabel users");
  for (const table of [analyses, agentSessions, agentMemories, chartDrawings, agentSkills, watchlist, watchRuns]) {
    await db.update(table).set({ userId: admin.id }).where(isNull(table.userId));
  }
  localAdmin = admin;
  return admin;
}

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

async function startSession(c: Context, user: User) {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await setSignedCookie(c, COOKIE, `${user.id}|${user.sessionVersion}|${expires}`, secret, {
    httpOnly: true,
    sameSite: "Lax",
    // The proxy terminates TLS; run directly on localhost the cookie must work over plain HTTP.
    secure: c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

async function sessionUser(c: Context): Promise<User | null> {
  const value = await getSignedCookie(c, secret, COOKIE);
  if (!value) return null;
  const [id, version, expires] = value.split("|");
  if (!id || !(Number(expires) > Date.now())) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user && !user.disabled && user.sessionVersion === Number(version) ? user : null;
}

async function basicUser(c: Context): Promise<User | null> {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const at = decoded.indexOf(":");
  return at < 0 ? null : checkPassword(decoded.slice(0, at), decoded.slice(at + 1));
}

/** Guards /api/*: sets c.get("user"). No WWW-Authenticate challenge: the page shows its own login form. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!authEnabled()) {
    const [fresh] = localAdmin ? await db.select().from(users).where(eq(users.id, localAdmin.id)) : [];
    c.set("user", fresh ?? localAdmin!);
    return next();
  }
  const user = (await sessionUser(c)) ?? (await basicUser(c));
  if (!user) return c.json({ error: "Belum masuk" }, 401);
  c.set("user", user);
  return next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) =>
  isAdmin(c.get("user")) ? next() : c.json({ error: "Khusus admin" }, 403);

/** What the page may know about an account. */
export const publicUser = (u: User) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  disabled: u.disabled,
  dailyAnalysisLimit: u.dailyAnalysisLimit,
  dailyChatLimit: u.dailyChatLimit,
  telegramChatId: u.telegramChatId,
  createdAt: u.createdAt,
});

// --------------------------------------------------------------------------- before the guard

export const authApi = new Hono<AppEnv>();

authApi.get("/session", async (c) => {
  if (!authEnabled()) return c.json({ auth: false, user: localAdmin ? publicUser(localAdmin) : null });
  const user = await sessionUser(c);
  return user ? c.json({ auth: true, user: publicUser(user) }) : c.json({ error: "Belum masuk" }, 401);
});

const loginSchema = z.object({ username: z.string().max(200), password: z.string().max(500) });

authApi.post("/login", async (c) => {
  if (!authEnabled()) return c.json({ auth: false, user: localAdmin ? publicUser(localAdmin) : null });
  const address = clientAddress(c);
  const wait = blockedFor(address);
  if (wait) return c.json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60_000)} menit.` }, 429);
  const body = loginSchema.safeParse(await c.req.json().catch(() => null));
  const user = body.success ? await checkPassword(body.data.username, body.data.password) : null;
  if (!user) {
    recordFailure(address);
    return c.json({ error: "Nama pengguna atau kata sandi salah, atau akun dinonaktifkan." }, 401);
  }
  failures.delete(address);
  await startSession(c, user);
  return c.json({ auth: true, user: publicUser(user) });
});

authApi.post("/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// --------------------------------------------------------------------------- the signed-in user

export const meApi = new Hono<AppEnv>();

meApi.get("/me", (c) => c.json(publicUser(c.get("user"))));

const passwordSchema = z.string().min(8, "Kata sandi minimal 8 karakter").max(200);

meApi.post("/me/password", async (c) => {
  const body = z.object({ current: z.string().max(500), next: passwordSchema }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const me = c.get("user");
  if (!(await Bun.password.verify(body.data.current, me.passwordHash))) return c.json({ error: "Kata sandi sekarang salah" }, 400);
  // A new session version signs out every other browser; this one gets a fresh cookie.
  const [updated] = await db
    .update(users)
    .set({ passwordHash: await Bun.password.hash(body.data.next), sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, me.id))
    .returning();
  if (authEnabled()) await startSession(c, updated);
  return c.json({ ok: true });
});

meApi.patch("/me", async (c) => {
  const body = z
    .object({ telegramChatId: z.string().trim().max(40).regex(/^-?\d*$/, "Chat ID Telegram berupa angka").nullable() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const [updated] = await db
    .update(users)
    .set({ telegramChatId: body.data.telegramChatId || null })
    .where(eq(users.id, c.get("user").id))
    .returning();
  return c.json(publicUser(updated));
});

// --------------------------------------------------------------------------- admin: accounts

export const usersApi = new Hono<AppEnv>();
usersApi.use("/users", requireAdmin);
usersApi.use("/users/*", requireAdmin);

usersApi.get("/users", async (c) => {
  const rows = await db.select().from(users).orderBy(users.createdAt);
  return c.json(rows.map(publicUser));
});

const limitSchema = z.number().int().min(0).max(10_000).nullable();
const roleSchema = z.enum(["admin", "member"]);

usersApi.post("/users", async (c) => {
  const body = z
    .object({
      username: z
        .string()
        .trim()
        .toLowerCase()
        .regex(USERNAME, "Nama pengguna 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung"),
      password: passwordSchema,
      role: roleSchema.default("member"),
      dailyAnalysisLimit: limitSchema.optional(),
      dailyChatLimit: limitSchema.optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const { password, ...rest } = body.data;
  const [created] = await db
    .insert(users)
    .values({ ...rest, passwordHash: await Bun.password.hash(password) })
    .onConflictDoNothing()
    .returning();
  return created ? c.json(publicUser(created), 201) : c.json({ error: `Nama pengguna ${rest.username} sudah dipakai` }, 409);
});

usersApi.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404);
  const body = z
    .object({
      role: roleSchema.optional(),
      disabled: z.boolean().optional(),
      password: passwordSchema.optional(),
      dailyAnalysisLimit: limitSchema.optional(),
      dailyChatLimit: limitSchema.optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const me = c.get("user");
  const change = body.data;
  if (id === me.id && (change.disabled || change.role === "member")) {
    return c.json({ error: "Kamu tidak bisa menonaktifkan atau menurunkan akunmu sendiri" }, 400);
  }
  if (change.disabled || change.role === "member") {
    const [{ others }] = await db
      .select({ others: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.disabled, false), ne(users.id, id)));
    if (!others) return c.json({ error: "Harus ada minimal satu admin aktif" }, 400);
  }
  const { password, ...rest } = change;
  const signOut = password !== undefined || change.disabled === true;
  const [updated] = await db
    .update(users)
    .set({
      ...rest,
      ...(password !== undefined ? { passwordHash: await Bun.password.hash(password) } : {}),
      ...(signOut ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}),
    })
    .where(eq(users.id, id))
    .returning();
  return updated ? c.json(publicUser(updated)) : c.json({ error: "Not found" }, 404);
});
