// The daily analysis (watch.ts) as its messages name it. The server stores the symbols as
// a watchlist, but the app calls the feature Analisa harian (the chart's button) and
// Analisa terjadwal (its tab), and Pemula's Pantauanku feeds the same list, so no
// message a member reads says "watchlist".
import { expect, test } from "bun:test";
import { call, member } from "./helpers";

test("the daily analysis's errors name it as the app does", async () => {
  const verified = await member({ verified: true });
  const empty = await call("/api/watchlist/run", { method: "POST", cookie: verified.cookie });
  expect(empty.status).toBe(400);
  expect(empty.body.error).toBe("Belum ada simbol untuk analisa harian");

  // Not verified yet: no Pro trial, so the free plan's three symbols; the run is refused
  // before the list is read (with symbols on it, the analysis quota answers first).
  const m = await member();
  const refused = await call("/api/watchlist/run", { method: "POST", cookie: m.cookie });
  expect(refused.status).toBe(400);
  expect(refused.body.error).toBe("Verifikasi email kamu dulu untuk menjalankan analisa harian");
  for (const code of ["BBCA", "BBRI", "TLKM"]) {
    expect((await call("/api/watchlist", { cookie: m.cookie, body: { symbol: `${code}.JK`, tvSymbol: `IDX:${code}` } })).status).toBe(201);
  }
  const full = await call("/api/watchlist", { cookie: m.cookie, body: { symbol: "ASII.JK", tvSymbol: "IDX:ASII" } });
  expect(full.status).toBe(400);
  expect(full.body.error).toStartWith("Paket Gratis maksimal 3 simbol untuk analisa harian.");

  for (const r of [empty, refused, full]) expect(JSON.stringify(r.body).toLowerCase()).not.toContain("watchlist");
});
