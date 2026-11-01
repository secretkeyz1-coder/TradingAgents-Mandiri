// Accounts and sessions. The first admin is made from APP_USER / APP_PASSWORD
// at boot and receives everything stored before accounts existed. The admin
// makes accounts; with SIGNUP=open people also sign up themselves, by e-mail
// (verified by a link, which starts the Pro trial) or with Google. The login
// page posts here and gets an HMAC-signed session cookie; scripts may send HTTP
// Basic credentials instead. With no APP_PASSWORD (local development) there is
// no login: every request acts as that first admin.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { z } from "zod";
import { config } from "./config";
import { db } from "./db";
import { agentMemories, agentSessions, agentSkills, analyses, authTokens, chartDrawings, payments, users, watchlist, watchRuns } from "./db/schema";
import { log } from "./log";
import { composeMail, mailEnabled, sendMail } from "./mail";
import { limitsOf, onTrial, planOf, trialEnd } from "./plans";
import { hashRecovery, matchStep, newRecoveryCodes, newSecret, otpauthUri } from "./totp";
import { BRAND } from "../../shared/brand";
import { PLAN_IDS, TRIAL_DAYS } from "../../shared/plans";

export type User = typeof users.$inferSelect;
/** Every authenticated route reads the signed-in user with c.get("user"). */
export type AppEnv = { Variables: { user: User; requestId: string } };

const COOKIE = "ta_session";
const SESSION_DAYS = 30;
// Failed logins per client address before it has to wait out the window.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export const authEnabled = () => Boolean(config.appPassword);
export const isAdmin = (u: User) => u.role === "admin";

// Signs the cookie. Sessions survive restarts; SESSION_SECRET (or APP_PASSWORD) changing ends them all.
const secret = config.sessionSecret;
/** A signature for a value carried in a link (an invoice page); `purpose` keeps one link's signature from passing for another's. */
export const sign = (purpose: string, value: string) => createHmac("sha256", secret).update(`${purpose}:${value}`).digest("base64url").slice(0, 32);

/** Hashed once, so a login for a name that does not exist costs the same time as a wrong password. */
const decoyHash = Bun.password.hash("decoy-password-for-timing");

/** Sign in by user name or e-mail address. An account with no password (Google only) never matches. */
async function checkPassword(login: string, password: string): Promise<User | null> {
  const name = login.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(name.includes("@") ? eq(users.email, name) : eq(users.username, name));
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
    log.info("first_admin_created", { username });
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
  const user = at < 0 ? null : await checkPassword(decoded.slice(0, at), decoded.slice(at + 1));
  // Basic auth has no room for a second step, so an account with one cannot use it.
  return user?.totpEnabledAt ? null : user;
}

// --------------------------------------------------------------------------- two-step sign-in (totp.ts)

const TICKET_MS = 10 * 60_000;
const TWO_FACTOR_OFF = { totpSecret: null, totpPending: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] as string[] };

/** Proof that the password (or the Google account, or a reset link) was right, for the code step: who, until when, signed. */
function ticketFor(u: User): string {
  const body = `${u.id}.${Date.now() + TICKET_MS}.${u.sessionVersion}`;
  return `${body}.${sign("2fa", body)}`;
}

async function ticketUser(ticket: string): Promise<User | null> {
  const [id, expires, version, signature = ""] = ticket.split(".");
  if (!z.uuid().safeParse(id).success || !(Number(expires) > Date.now())) return null;
  const want = Buffer.from(sign("2fa", `${id}.${expires}.${version}`));
  if (signature.length !== want.length || !timingSafeEqual(Buffer.from(signature), want)) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user && !user.disabled && user.totpEnabledAt && user.sessionVersion === Number(version) ? user : null;
}

/** A code from the authenticator app, or an unused recovery code. Either works once: it is marked used here. */
async function secondFactor(user: User, code: string): Promise<boolean> {
  if (!user.totpSecret) return false;
  const step = matchStep(user.totpSecret, code);
  if (step !== null) {
    const [used] = await db
      .update(users)
      .set({ totpLastStep: step })
      .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
      .returning({ id: users.id });
    return Boolean(used);
  }
  const hash = hashRecovery(code);
  // Taken out in one statement, so two requests cannot both spend a code or put back each other's.
  const [spent] = await db
    .update(users)
    .set({ recoveryCodes: sql`${users.recoveryCodes} - ${hash}::text` })
    .where(and(eq(users.id, user.id), sql`${users.recoveryCodes} @> ${JSON.stringify([hash])}::jsonb`))
    .returning({ id: users.id });
  return Boolean(spent);
}

/** secondFactor with wrong codes counted per account, as sign-in counts them per address: six digits fall to guessing otherwise. */
async function checkedCode(user: User, code: string): Promise<{ error: string; status: 401 | 429 } | null> {
  const key = `2fa:${user.id}`;
  const wait = blockedFor(key);
  if (wait) return { error: `Terlalu banyak kode salah. Coba lagi dalam ${Math.ceil(wait / 60_000)} menit.`, status: 429 };
  if (await secondFactor(user, code)) {
    failures.delete(key);
    return null;
  }
  recordFailure(key);
  return { error: "Kode salah atau sudah pernah dipakai.", status: 401 };
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
  preferences: u.preferences ?? {},
  email: u.email,
  emailVerified: Boolean(u.emailVerifiedAt),
  phone: u.phone,
  google: Boolean(u.googleSub),
  hasPassword: Boolean(u.passwordHash),
  twoFactor: Boolean(u.totpEnabledAt),
  /** The public track record page (creators.ts). */
  publicProfile: u.publicProfile,
  displayName: u.displayName,
  bio: u.bio,
  /** The plan in force, its end (null = none) and what it allows. */
  plan: planOf(u),
  planUntil: planOf(u) === u.plan ? u.planUntil : null,
  onTrial: onTrial(u),
  trialUsed: Boolean(u.trialStartedAt),
  limits: limitsOf(u),
  createdAt: u.createdAt,
});

// --------------------------------------------------------------------------- sign-up and e-mail links

/** Self sign-up (e-mail and Google) only with SIGNUP=open; otherwise only the admin makes accounts. */
export const signupOpen = () => authEnabled() && process.env.SIGNUP === "open";
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
export const googleEnabled = () => authEnabled() && Boolean(GOOGLE_ID && GOOGLE_SECRET);
const OAUTH_COOKIE = "ta_oauth";
const OAUTH_PATH = "/api/auth/google";

/** Where links in e-mails point: PUBLIC_URL, else the address this request came in on. */
function siteUrl(c: Context): string {
  const configured = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");
  if (configured) return configured;
  const url = new URL(c.req.url);
  return `${c.req.header("x-forwarded-proto") ?? url.protocol.slice(0, -1)}://${c.req.header("host") ?? url.host}`;
}

const secureCookie = (c: Context) => c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:";

/** At most `max` attempts per key within the window (in memory: a restart forgets them). */
function limiter(max: number, windowMs: number) {
  const seen = new Map<string, number[]>();
  return (key: string) => {
    const now = Date.now();
    const recent = (seen.get(key) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= max) return false;
    recent.push(now);
    seen.set(key, recent);
    if (seen.size > 10_000) seen.clear();
    return true;
  };
}
const signupLimit = limiter(5, 3_600_000);
const mailLimit = limiter(5, 3_600_000);

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A one-time link token. Only its hash is stored; earlier unused ones of the same kind stop working. */
async function issueToken(userId: string, kind: "verify" | "reset", email: string, ttlMs: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)));
  await db.insert(authTokens).values({ userId, kind, tokenHash: hashToken(token), email, expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

/** Spends a link token once: its row, or null when it is unknown, used or expired. */
async function useToken(token: string, kind: "verify" | "reset") {
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning();
  return row ?? null;
}

/** The address is proven: record it, and start the one Pro trial of an account on Gratis. */
async function markVerified(user: User, email: string): Promise<User> {
  const trial = !user.trialStartedAt && user.role !== "admin" && planOf(user) === "free";
  const [updated] = await db
    .update(users)
    .set({
      email,
      emailVerifiedAt: user.emailVerifiedAt && user.email === email ? user.emailVerifiedAt : new Date(),
      ...(trial ? { plan: "pro" as const, planUntil: trialEnd(), trialStartedAt: new Date() } : {}),
    })
    .where(eq(users.id, user.id))
    .returning();
  return updated;
}

async function sendVerification(c: Context, user: User, email: string) {
  const token = await issueToken(user.id, "verify", email, 24 * 3_600_000);
  const trial = !user.trialStartedAt && user.role !== "admin" && planOf(user) === "free";
  return sendMail(
    composeMail(
      email,
      `Verifikasi email ${BRAND.name}`,
      [
        `Halo ${user.username},`,
        `Klik tombol di bawah untuk memastikan ${email} milikmu.${trial ? ` Setelah itu paket Pro aktif gratis selama ${TRIAL_DAYS} hari.` : ""}`,
      ],
      { label: "Verifikasi email", url: `${siteUrl(c)}/api/verify-email?token=${token}` },
      ["Tautan ini berlaku 24 jam. Abaikan email ini kalau kamu tidak merasa mendaftar."],
    ),
  );
}

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Email tidak valid").max(200));

/** "0812-3456-7890" → "+6281234567890"; empty → null; undefined when it is not a phone number. */
function normalizePhone(raw: string | null | undefined): string | null | undefined {
  const digits = (raw ?? "").replace(/[\s().-]/g, "");
  if (!digits) return null;
  const e164 = digits.startsWith("+") ? digits : digits.startsWith("62") ? `+${digits}` : digits.startsWith("0") ? `+62${digits.slice(1)}` : `+${digits}`;
  return /^\+\d{9,15}$/.test(e164) ? e164 : undefined;
}

/** A free user name from the e-mail's local part: "budi.s", else "budi.s4821". */
async function freeUsername(email: string): Promise<string> {
  const base = (
    email
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "")
      .replace(/^[^a-z0-9]+/, "") || "trader"
  )
    .slice(0, 24)
    .padEnd(3, "0");
  for (let i = 0; i < 20; i++) {
    const name = i === 0 ? base : `${base}${1000 + Math.floor(Math.random() * 9000)}`;
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, name));
    if (!taken) return name;
  }
  return `trader${randomBytes(4).toString("hex")}`;
}

// --------------------------------------------------------------------------- before the guard

export const authApi = new Hono<AppEnv>();

authApi.get("/session", async (c) => {
  if (!authEnabled()) {
    // Read fresh: localAdmin is the row as it was at boot.
    const [fresh] = localAdmin ? await db.select().from(users).where(eq(users.id, localAdmin.id)) : [];
    return c.json({ auth: false, user: fresh ?? localAdmin ? publicUser(fresh ?? localAdmin!) : null });
  }
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
  // With two-step sign-in the password only earns a ticket for the code step.
  if (user.totpEnabledAt) return c.json({ auth: false, twoFactor: true, ticket: ticketFor(user) });
  await startSession(c, user);
  return c.json({ auth: true, user: publicUser(user) });
});

authApi.post("/login/2fa", async (c) => {
  if (!authEnabled()) return c.json({ error: "Login tidak aktif di server ini" }, 400);
  const address = clientAddress(c);
  const wait = blockedFor(address);
  if (wait) return c.json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60_000)} menit.` }, 429);
  const body = z.object({ ticket: z.string().max(300), code: z.string().trim().min(6).max(20) }).safeParse(await c.req.json().catch(() => null));
  const user = body.success ? await ticketUser(body.data.ticket) : null;
  if (!body.success || !user) return c.json({ error: "Langkah masuk ini sudah kedaluwarsa. Masuk lagi dari awal." }, 410);
  const refused = await checkedCode(user, body.data.code);
  if (refused) {
    recordFailure(address);
    return c.json({ error: refused.error }, refused.status);
  }
  failures.delete(address);
  await startSession(c, user);
  return c.json({ auth: true, user: publicUser(user) });
});

authApi.post("/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/** What the login page offers. */
authApi.get("/auth/config", (c) => c.json({ signup: signupOpen(), google: googleEnabled(), mail: mailEnabled(), trialDays: TRIAL_DAYS }));

/** A new member starts on the simple screen (Pemula); an account without `ui` opens the full workspace (Pro). */
const BEGINNER = { ui: { mode: "pemula" } };

const signupSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, "Kata sandi minimal 8 karakter").max(200),
  phone: z.string().max(24).optional(),
  acceptTerms: z.literal(true, { error: "Setujui Syarat & Ketentuan dan Kebijakan Privasi dulu" }),
});

authApi.post("/signup", async (c) => {
  if (!signupOpen()) return c.json({ error: "Pendaftaran belum dibuka" }, 403);
  if (!signupLimit(clientAddress(c))) return c.json({ error: "Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti." }, 429);
  const body = signupSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const { email, password } = body.data;
  const phone = normalizePhone(body.data.phone);
  if (phone === undefined) return c.json({ error: "Nomor HP tidak valid, contoh 0812 3456 7890" }, 400);
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (exists) return c.json({ error: "Email ini sudah terdaftar. Masuk, atau pakai Lupa kata sandi." }, 409);
  const [created] = await db
    .insert(users)
    .values({ username: await freeUsername(email), email, phone, passwordHash: await Bun.password.hash(password), termsAcceptedAt: new Date(), preferences: BEGINNER })
    .onConflictDoNothing()
    .returning();
  if (!created) return c.json({ error: "Email ini sudah terdaftar. Masuk, atau pakai Lupa kata sandi." }, 409);
  const sent = await sendVerification(c, created, email);
  await startSession(c, created);
  return c.json({ auth: true, user: publicUser(created), mailed: sent.ok }, 201);
});

/** The link in the verification e-mail: confirm the address, then open the app with a notice. */
authApi.get("/verify-email", async (c) => {
  const row = await useToken(c.req.query("token") ?? "", "verify");
  if (!row) return c.redirect("/app#/?notice=verify-failed");
  // The address may have been taken by another account since the link was sent.
  const [other] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, row.email), ne(users.id, row.userId)));
  if (other) return c.redirect("/app#/?notice=email-taken");
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!user || user.disabled) return c.redirect("/app#/?notice=verify-failed");
  const started = !user.trialStartedAt;
  const updated = await markVerified(user, row.email);
  return c.redirect(`/app#/?notice=${started && updated.trialStartedAt ? "trial-started" : "email-verified"}`);
});

authApi.post("/password/forgot", async (c) => {
  const body = z.object({ email: emailSchema }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Email tidak valid" }, 400);
  if (!mailLimit(`forgot:${clientAddress(c)}`) || !mailLimit(`forgot:${body.data.email}`)) {
    return c.json({ error: "Terlalu sering. Coba lagi nanti." }, 429);
  }
  // The same answer whether or not the address has an account, so this form cannot find accounts.
  const [user] = await db.select().from(users).where(eq(users.email, body.data.email));
  if (user && !user.disabled) {
    const token = await issueToken(user.id, "reset", body.data.email, 3_600_000);
    await sendMail(
      composeMail(
        body.data.email,
        `Atur ulang kata sandi ${BRAND.name}`,
        [`Halo ${user.username},`, "Ada permintaan mengatur ulang kata sandi akunmu. Klik tombol di bawah untuk membuat kata sandi baru."],
        { label: "Buat kata sandi baru", url: `${siteUrl(c)}/app#/reset?token=${token}` },
        ["Tautan ini berlaku 1 jam dan hanya bisa dipakai sekali. Kalau kamu tidak meminta, abaikan email ini: kata sandimu tetap."],
      ),
    );
  }
  return c.json({ ok: true, mail: mailEnabled() });
});

authApi.post("/password/reset", async (c) => {
  const body = z
    .object({ token: z.string().max(200), password: z.string().min(8, "Kata sandi minimal 8 karakter").max(200) })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const row = await useToken(body.data.token, "reset");
  const [user] = row ? await db.select().from(users).where(eq(users.id, row.userId)) : [];
  if (!row || !user || user.disabled) return c.json({ error: "Tautan sudah kedaluwarsa atau sudah dipakai. Minta tautan baru." }, 400);
  // A new session version signs out every other browser.
  const [updated] = await db
    .update(users)
    .set({ passwordHash: await Bun.password.hash(body.data.password), sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, user.id))
    .returning();
  // The link reached the inbox, so the address is proven as well.
  const verified = updated.email === row.email ? await markVerified(updated, row.email) : updated;
  // The link proves the inbox, not the phone: two-step sign-in still asks for its code.
  if (verified.totpEnabledAt) return c.json({ auth: false, twoFactor: true, ticket: ticketFor(verified) });
  await startSession(c, verified);
  return c.json({ auth: true, user: publicUser(verified) });
});

/** Sign in or sign up with Google (authorization code with PKCE); the state and verifier ride in a short signed cookie. */
authApi.get("/auth/google", async (c) => {
  if (!googleEnabled()) return c.redirect("/app#/?notice=google-off");
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await setSignedCookie(c, OAUTH_COOKIE, `${state}|${verifier}|${Date.now() + 600_000}`, secret, {
    httpOnly: true,
    sameSite: "Lax",
    secure: secureCookie(c),
    path: OAUTH_PATH,
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: GOOGLE_ID,
    redirect_uri: `${siteUrl(c)}${OAUTH_PATH}/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

authApi.get("/auth/google/callback", async (c) => {
  const fail = (why: string) => c.redirect(`/app#/?notice=${why}`);
  const saved = await getSignedCookie(c, secret, OAUTH_COOKIE);
  deleteCookie(c, OAUTH_COOKIE, { path: OAUTH_PATH });
  const [state, verifier, until] = (saved || "").split("|");
  if (!saved || !state || state !== c.req.query("state") || !(Number(until) > Date.now())) return fail("google-failed");
  const code = c.req.query("code");
  if (!code) return fail("google-cancelled");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_ID,
      client_secret: GOOGLE_SECRET,
      redirect_uri: `${siteUrl(c)}${OAUTH_PATH}/callback`,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const tokens = (await res?.json().catch(() => null)) as { id_token?: string } | null;
  if (!res?.ok || !tokens?.id_token) return fail("google-failed");
  // Google checks the token's signature; this checks it is for this app, from Google, with a verified address.
  const info = (await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`, { signal: AbortSignal.timeout(10_000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)) as { aud?: string; iss?: string; sub?: string; email?: string; email_verified?: string | boolean } | null;
  const verified = info?.email_verified === true || info?.email_verified === "true";
  if (!info?.sub || !info.email || info.aud !== GOOGLE_ID || !["accounts.google.com", "https://accounts.google.com"].includes(info.iss ?? "") || !verified) {
    return fail("google-failed");
  }
  const email = info.email.toLowerCase();
  let [user] = await db.select().from(users).where(eq(users.googleSub, info.sub));
  if (!user) {
    const [byEmail] = await db.select().from(users).where(eq(users.email, email));
    if (byEmail) {
      // Link Google to the account with this address. If the address was never verified, whoever
      // signed up with it may not own it: their password and sessions end, only the inbox owner gets in.
      const unproven = !byEmail.emailVerifiedAt;
      [user] = await db
        .update(users)
        .set({ googleSub: info.sub, ...(unproven ? { passwordHash: null, sessionVersion: sql`${users.sessionVersion} + 1` } : {}) })
        .where(eq(users.id, byEmail.id))
        .returning();
    } else {
      if (!signupOpen()) return fail("signup-closed");
      [user] = await db
        .insert(users)
        .values({ username: await freeUsername(email), email, googleSub: info.sub, passwordHash: null, termsAcceptedAt: new Date(), preferences: BEGINNER })
        .returning();
    }
    user = await markVerified(user, email);
  }
  if (user.disabled) return fail("account-disabled");
  if (user.totpEnabledAt) return c.redirect(`/app#/2fa?ticket=${encodeURIComponent(ticketFor(user))}`);
  await startSession(c, user);
  return c.redirect("/app");
});

// --------------------------------------------------------------------------- the signed-in user

export const meApi = new Hono<AppEnv>();

meApi.get("/me", (c) => c.json(publicUser(c.get("user"))));

const passwordSchema = z.string().min(8, "Kata sandi minimal 8 karakter").max(200);

meApi.post("/me/password", async (c) => {
  const body = z.object({ current: z.string().max(500).optional(), next: passwordSchema }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const me = c.get("user");
  // An account that signs in only with Google sets its first password without one.
  if (me.passwordHash && !(await Bun.password.verify(body.data.current ?? "", me.passwordHash))) return c.json({ error: "Kata sandi sekarang salah" }, 400);
  // A new session version signs out every other browser; this one gets a fresh cookie.
  const [updated] = await db
    .update(users)
    .set({ passwordHash: await Bun.password.hash(body.data.next), sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, me.id))
    .returning();
  if (authEnabled()) await startSession(c, updated);
  return c.json({ ok: true });
});

const codeSchema = z.object({ code: z.string().trim().min(6).max(20) });

/** Step one of turning two-step sign-in on: a new secret for the authenticator app, kept pending until a code proves it. */
meApi.post("/me/2fa/setup", async (c) => {
  const me = c.get("user");
  if (me.totpEnabledAt) return c.json({ error: "Verifikasi dua langkah sudah aktif" }, 400);
  const secret = newSecret();
  await db.update(users).set({ totpPending: secret }).where(eq(users.id, me.id));
  return c.json({ secret, uri: otpauthUri(secret, me.email ?? me.username, BRAND.name) });
});

/** Step two: the first code from the app turns it on, signs out every other browser, and gives the recovery codes once. */
meApi.post("/me/2fa/enable", async (c) => {
  const body = codeSchema.safeParse(await c.req.json().catch(() => null));
  const [me] = await db.select().from(users).where(eq(users.id, c.get("user").id));
  if (!me?.totpPending) return c.json({ error: "Mulai dari tombol Aktifkan" }, 400);
  const step = body.success ? matchStep(me.totpPending, body.data.code) : null;
  if (step === null) return c.json({ error: "Kode tidak cocok. Pastikan jam ponselmu tepat, lalu ketik kode yang sedang tampil." }, 400);
  const { codes, hashes } = newRecoveryCodes();
  const [updated] = await db
    .update(users)
    .set({ totpSecret: me.totpPending, totpPending: null, totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, me.id))
    .returning();
  if (authEnabled()) await startSession(c, updated);
  return c.json({ user: publicUser(updated), recoveryCodes: codes });
});

meApi.post("/me/2fa/disable", async (c) => {
  const body = codeSchema.safeParse(await c.req.json().catch(() => null));
  const [me] = await db.select().from(users).where(eq(users.id, c.get("user").id));
  if (!me?.totpEnabledAt) return c.json({ error: "Verifikasi dua langkah belum aktif" }, 400);
  // A wrong code is a 400 here, not a 401: the page reads 401 as signed out.
  const refused = body.success ? await checkedCode(me, body.data.code) : { error: "Kode salah atau sudah pernah dipakai.", status: 401 };
  if (refused) return c.json({ error: refused.error }, refused.status === 429 ? 429 : 400);
  const [updated] = await db.update(users).set(TWO_FACTOR_OFF).where(eq(users.id, me.id)).returning();
  return c.json({ user: publicUser(updated) });
});

/** New recovery codes in place of the old ones, for a code from the app. */
meApi.post("/me/2fa/recovery", async (c) => {
  const body = codeSchema.safeParse(await c.req.json().catch(() => null));
  const [me] = await db.select().from(users).where(eq(users.id, c.get("user").id));
  if (!me?.totpEnabledAt) return c.json({ error: "Verifikasi dua langkah belum aktif" }, 400);
  const refused = body.success ? await checkedCode(me, body.data.code) : { error: "Kode salah atau sudah pernah dipakai.", status: 401 };
  if (refused) return c.json({ error: refused.error }, refused.status === 429 ? 429 : 400);
  const { codes, hashes } = newRecoveryCodes();
  await db.update(users).set({ recoveryCodes: hashes }).where(eq(users.id, me.id));
  return c.json({ recoveryCodes: codes });
});

meApi.patch("/me", async (c) => {
  const body = z
    .object({
      telegramChatId: z.string().trim().max(40).regex(/^-?\d*$/, "Chat ID Telegram berupa angka").nullable().optional(),
      phone: z.string().max(24).nullable().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const phone = body.data.phone === undefined ? undefined : normalizePhone(body.data.phone);
  if (body.data.phone && phone === undefined) return c.json({ error: "Nomor HP tidak valid, contoh 0812 3456 7890" }, 400);
  const [updated] = await db
    .update(users)
    .set({
      ...(body.data.telegramChatId !== undefined ? { telegramChatId: body.data.telegramChatId || null } : {}),
      ...(body.data.phone !== undefined ? { phone } : {}),
    })
    .where(eq(users.id, c.get("user").id))
    .returning();
  return c.json(publicUser(updated));
});

/** Send the verification link again. */
meApi.post("/me/verify-email", async (c) => {
  const me = c.get("user");
  if (!me.email) return c.json({ error: "Akun ini belum punya email" }, 400);
  if (me.emailVerifiedAt) return c.json({ ok: true, mailed: false });
  if (!mailLimit(`verify:${me.id}`)) return c.json({ error: "Terlalu sering. Coba lagi nanti." }, 429);
  const sent = await sendVerification(c, me, me.email);
  return c.json({ ok: true, mailed: sent.ok });
});

/** Add or change the e-mail address: a new one takes effect once its link is opened. */
meApi.post("/me/email", async (c) => {
  const body = z.object({ email: emailSchema }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const me = c.get("user");
  const { email } = body.data;
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, me.id)));
  if (taken) return c.json({ error: "Email ini sudah dipakai akun lain" }, 409);
  if (!mailLimit(`email:${me.id}`)) return c.json({ error: "Terlalu sering. Coba lagi nanti." }, 429);
  // An account without an address takes it now (unverified), so it can sign in and reset with it.
  const [user] = me.email ? [me] : await db.update(users).set({ email }).where(eq(users.id, me.id)).returning();
  const sent = await sendVerification(c, user, email);
  return c.json({ user: publicUser(user), mailed: sent.ok });
});

// The page's own settings (panel layout, indicator inputs, Pemula or Pro). Opaque to the
// server: each top-level key is replaced whole, null removes it, and the total is capped.
const PREFERENCE_KEYS = ["layout", "indicators", "ui"] as const;
const MAX_PREFERENCES_BYTES = 16_000;

meApi.patch("/me/preferences", async (c) => {
  const body = z
    .object(Object.fromEntries(PREFERENCE_KEYS.map((k) => [k, z.record(z.string(), z.unknown()).nullable().optional()])))
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Preferensi tidak valid" }, 400);
  // Read fresh: without sign-in the request user is a cached object.
  const [me] = await db.select().from(users).where(eq(users.id, c.get("user").id));
  const next: Record<string, unknown> = { ...(me.preferences ?? {}) };
  for (const [key, value] of Object.entries(body.data)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  if (JSON.stringify(next).length > MAX_PREFERENCES_BYTES) return c.json({ error: "Preferensi terlalu besar" }, 413);
  const [updated] = await db.update(users).set({ preferences: next }).where(eq(users.id, me.id)).returning();
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
      email: emailSchema.optional(),
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
    .values({ ...rest, passwordHash: await Bun.password.hash(password), preferences: rest.role === "member" ? BEGINNER : {} })
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
      plan: z.enum(PLAN_IDS).optional(),
      /** The last day of the plan (WIB), or null for no end. */
      planUntil: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal berupa YYYY-MM-DD")
        .nullable()
        .optional(),
      /** Mark the e-mail verified by hand (when mail cannot be sent). */
      emailVerified: z.literal(true).optional(),
      /** Turn two-step sign-in off for someone who lost their phone and recovery codes. */
      twoFactor: z.literal(false).optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join("; ") }, 400);
  const me = c.get("user");
  const { plan, planUntil, emailVerified, twoFactor, ...change } = body.data;
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
  const until = planUntil === undefined ? undefined : planUntil === null ? null : new Date(`${planUntil}T23:59:59+07:00`);
  const patch = {
    ...rest,
    ...(password !== undefined ? { passwordHash: await Bun.password.hash(password) } : {}),
    ...(signOut ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}),
    ...(plan !== undefined ? { plan } : {}),
    ...(until !== undefined ? { planUntil: until } : {}),
    ...(twoFactor === false ? TWO_FACTOR_OFF : {}),
  };
  // "Verifikasi manual" alone changes no column here (markVerified below does), and an empty update throws.
  let [updated] = Object.values(patch).some((v) => v !== undefined)
    ? await db.update(users).set(patch).where(eq(users.id, id)).returning()
    : await db.select().from(users).where(eq(users.id, id));
  if (!updated) return c.json({ error: "Not found" }, 404);
  if (emailVerified && updated.email) updated = await markVerified(updated, updated.email);
  if (plan !== undefined || until !== undefined) {
    // An admin's grant goes into the payment history too, at no charge.
    await db.insert(payments).values({
      userId: updated.id,
      reference: `GRANT-${randomBytes(4).toString("hex").toUpperCase()}`,
      plan: updated.plan,
      period: "month",
      amount: 0,
      status: "paid",
      adminNote: `Diatur admin ${me.username}`,
      paidAt: new Date(),
      periodStart: new Date(),
      periodEnd: updated.planUntil,
      confirmedBy: me.id,
    });
  }
  return c.json(publicUser(updated));
});
