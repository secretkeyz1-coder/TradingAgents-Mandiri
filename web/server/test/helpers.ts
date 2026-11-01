// What the tests share: requests to the app in this process (no server, no port),
// sign-in, throwaway members made by the admin, the mail outbox, and TOTP codes
// that never reuse a time step (the server takes each step once).
import { app } from "../src/app";
import { outbox } from "../src/mail";
import { codeAt } from "../src/totp";

export type Res = { status: number; body: any; cookie: string; headers: Headers };

export async function call(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<Res> {
  const res = await app.request(path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON: a page or plain text */
  }
  return { status: res.status, body, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0], headers: res.headers };
}

/** A session cookie for these credentials; throws when the sign-in does not complete. */
export async function signIn(username: string, password: string): Promise<string> {
  const r = await call("/api/login", { body: { username, password } });
  if (r.status !== 200 || r.body?.auth !== true) throw new Error(`sign-in failed for ${username}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.cookie;
}

let adminSession = "";
/** The first admin's session (test/setup.ts made the account from APP_USER and APP_PASSWORD). */
export async function admin(): Promise<string> {
  adminSession ||= await signIn(process.env.APP_USER!, process.env.APP_PASSWORD!);
  return adminSession;
}

let serial = 0;
/** A new member made by the admin, signed in; `plan` gives a paid plan for 30 days. */
export async function member(opts: { plan?: "free" | "pro" | "creator"; verified?: boolean } = {}) {
  const username = `t${Date.now().toString(36)}${serial++}`;
  const email = `${username}@example.test`;
  const password = crypto.randomUUID();
  const cookieAdmin = await admin();
  const made = await call("/api/users", { cookie: cookieAdmin, body: { username, password, role: "member", email } });
  if (made.status !== 201) throw new Error(`could not make ${username}: ${made.status} ${JSON.stringify(made.body)}`);
  const patch: Record<string, unknown> = {};
  if (opts.verified) patch.emailVerified = true;
  if (opts.plan && opts.plan !== "free") {
    patch.plan = opts.plan;
    patch.planUntil = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  }
  if (Object.keys(patch).length) await call(`/api/users/${made.body.id}`, { method: "PATCH", cookie: cookieAdmin, body: patch });
  return { id: made.body.id as string, username, email, password, cookie: await signIn(username, password), created: made.body };
}

/** The newest message "sent" to this address. */
export const lastMail = (to: string) => outbox.findLast((m) => m.to === to);

export const step = () => Math.floor(Date.now() / 30_000);
let usedStep = 0;
/** Mark a step as used (a code sent outside nextCode). */
export const useStep = (s: number) => (usedStep = Math.max(usedStep, s));
/** A code for a step the server has not seen yet: this one or the next, else wait for one to come. */
export async function nextCode(secret: string): Promise<string> {
  for (;;) {
    const s = [step(), step() + 1].find((x) => x > usedStep);
    if (s !== undefined) {
      usedStep = s;
      return codeAt(secret, s);
    }
    await Bun.sleep(1000);
  }
}

export { codeAt };
