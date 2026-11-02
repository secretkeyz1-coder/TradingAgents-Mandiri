// GET /api/options also says how long an analysis usually takes (routes.ts typicalMinutes): the
// median of the last 50 completed analyses, so the Riset AI form can promise an honest wait.
// Its rows finish after anything another test file makes, so the last 50 are all its own, and
// they are deleted afterwards.
import { expect, test } from "bun:test";
import { inArray } from "drizzle-orm";
import { db } from "../src/db";
import { analyses } from "../src/db/schema";
import { forgetTypical } from "../src/routes";
import { call, member } from "./helpers";

test("the options say how long an analysis usually takes", async () => {
  const m = await member();
  const later = Date.now() + 86_400_000;
  // Half took three minutes and half five: the median sits between them, at four.
  const rows = await db
    .insert(analyses)
    .values(
      Array.from({ length: 50 }, (_, i) => ({
        userId: m.id,
        ticker: "BBCA.JK",
        tradeDate: "2026-10-30",
        request: {} as never,
        status: "completed" as const,
        startedAt: new Date(later + i * 1000),
        finishedAt: new Date(later + i * 1000 + (i % 2 ? 5 : 3) * 60_000),
      })),
    )
    .returning({ id: analyses.id });
  try {
    forgetTypical();
    const r = await call("/api/options", { cookie: m.cookie });
    expect(r.status).toBe(200);
    expect(r.body.typicalMinutes).toBe(4);
  } finally {
    await db.delete(analyses).where(inArray(analyses.id, rows.map((r) => r.id)));
    forgetTypical();
  }
});
