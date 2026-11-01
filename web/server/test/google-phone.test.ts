// Google sign-up skips the form that asks for a WhatsApp number, so a Google account gives
// one afterwards (needsPhone in plans.ts): the page asks before the app opens, AI features
// wait for it, and the account cannot remove it later. An e-mail account keeps the choice.
// No Google keys are needed: the account is linked to a made-up Google id directly.
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { users } from "../src/db/schema";
import { call, member } from "./helpers";

/** An analysis as the form sends it; a member's run on the server's standard settings anyway. */
async function analysis(cookie: string) {
  const d = (await call("/api/options", { cookie })).body.defaults;
  const body = { ticker: "BTC-USD", date: new Date().toLocaleDateString("en-CA"), analysts: ["market"], depth: 1, language: "Indonesian", ...d };
  return call("/api/analyses", { cookie, body: { ...body, backendUrl: d.backendUrl ?? undefined } });
}

// The first catalog read starts Python (web/worker), so the analysis call can take a while.
test("a Google account owes a phone number before AI features, and keeps it", async () => {
  const m = await member({ verified: true });
  await db.update(users).set({ googleSub: `google-test-${m.id}` }).where(eq(users.id, m.id));

  const me = await call("/api/me", { cookie: m.cookie });
  expect(me.body).toMatchObject({ google: true, phone: null, needsPhone: true });
  const held = await analysis(m.cookie);
  expect(held.status).toBe(429);
  expect(held.body.error).toBe("Isi nomor WhatsApp-mu dulu untuk memakai analisa AI dan chat agent.");

  const wrong = await call("/api/me", { method: "PATCH", cookie: m.cookie, body: { phone: "12" } });
  expect(wrong.status).toBe(400);
  const saved = await call("/api/me", { method: "PATCH", cookie: m.cookie, body: { phone: "0812-3456-7890" } });
  expect(saved.status).toBe(200);
  expect(saved.body).toMatchObject({ phone: "+6281234567890", needsPhone: false });

  for (const phone of [null, ""]) {
    const cleared = await call("/api/me", { method: "PATCH", cookie: m.cookie, body: { phone } });
    expect(cleared.status).toBe(400);
    expect(cleared.body.error).toBe("Akun yang masuk dengan Google wajib punya nomor WhatsApp");
  }
  expect((await call("/api/me", { cookie: m.cookie })).body.phone).toBe("+6281234567890");

  const runs = await analysis(m.cookie);
  expect(runs.status).toBe(201);
}, 120_000);

test("an e-mail account owes no phone number and may remove its own", async () => {
  const m = await member({ verified: true });
  expect((await call("/api/me", { cookie: m.cookie })).body.needsPhone).toBe(false);
  expect((await call("/api/me", { method: "PATCH", cookie: m.cookie, body: { phone: "0812 3456 7890" } })).status).toBe(200);
  const cleared = await call("/api/me", { method: "PATCH", cookie: m.cookie, body: { phone: null } });
  expect(cleared.status).toBe(200);
  expect(cleared.body).toMatchObject({ phone: null, needsPhone: false });
});
