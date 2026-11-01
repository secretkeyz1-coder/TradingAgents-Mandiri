// Bar times from Yahoo (market.ts exchangeTime): each in the exchange's wall clock with
// the offset of its own day, so bars keep the dates and session times the engine's
// yfinance bars carry on both sides of a daylight-saving change.
import { expect, test } from "bun:test";
import { exchangeTime } from "../src/market";

const at = (iso: string) => Date.parse(iso) / 1000;
const EST = -5 * 3600;

test("a daily bar stamped at local midnight keeps its date across a daylight-saving change", () => {
  // COMEX gold: midnight New York, 04:00 UTC in summer and 05:00 UTC in winter, read with the winter offset.
  expect(exchangeTime(at("2026-10-30T04:00:00Z"), "America/New_York", EST)).toBe("2026-10-30T00:00:00");
  expect(exchangeTime(at("2026-05-04T04:00:00Z"), "America/New_York", EST)).toBe("2026-05-04T00:00:00");
  expect(exchangeTime(at("2026-11-02T05:00:00Z"), "America/New_York", EST)).toBe("2026-11-02T00:00:00");
  // Forex: midnight London, 23:00 UTC the day before in summer.
  expect(exchangeTime(at("2026-07-01T23:00:00Z"), "Europe/London", 0)).toBe("2026-07-02T00:00:00");
});

test("intraday bars keep their session time on both sides of the change", () => {
  // The New York open, 09:30, is 13:30 UTC in summer and 14:30 UTC in winter.
  expect(exchangeTime(at("2026-10-30T13:30:00Z"), "America/New_York", EST)).toBe("2026-10-30T09:30:00");
  expect(exchangeTime(at("2026-11-02T14:30:00Z"), "America/New_York", EST)).toBe("2026-11-02T09:30:00");
  // Jakarta has no daylight saving: 09:00 WIB is 02:00 UTC.
  expect(exchangeTime(at("2026-05-04T02:00:00Z"), "Asia/Jakarta", 7 * 3600)).toBe("2026-05-04T09:00:00");
});

test("without a zone Intl knows, Yahoo's offset applies", () => {
  expect(exchangeTime(at("2026-05-04T02:00:00Z"), undefined, 7 * 3600)).toBe("2026-05-04T09:00:00");
  expect(exchangeTime(at("2026-05-04T02:00:00Z"), "Bukan/Zona", 7 * 3600)).toBe("2026-05-04T09:00:00");
});
