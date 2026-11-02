// The IDX price grid the trading plan rounds to (src/lib/idx.ts): each band's step, and levels
// rounded the way the plan rounds them (a stop beyond the level, a target before it). From web/client:
//   bun test test/idx.test.ts
import { expect, test } from 'bun:test';
import { idxTick, onIdxTick } from '../src/lib/idx';

test('each price band has its step', () => {
  expect([150, 199, 200, 499, 500, 1_995, 2_000, 4_990, 5_000, 9_000].map(idxTick)).toEqual([1, 1, 2, 2, 5, 5, 10, 10, 25, 25]);
});

test('levels land on the grid in the asked direction', () => {
  expect(onIdxTick(5_287.47, 'up')).toBe(5_300);
  expect(onIdxTick(5_287.47, 'down')).toBe(5_275);
  expect(onIdxTick(5_287.47, 'nearest')).toBe(5_275);
  expect(onIdxTick(4_245.07, 'up')).toBe(4_250);
  expect(onIdxTick(4_245.07, 'down')).toBe(4_240);
  expect(onIdxTick(4_999, 'up')).toBe(5_000);
  expect(onIdxTick(199.6, 'up')).toBe(200);
});

test('a price already on the grid stays, despite floating-point noise', () => {
  expect(onIdxTick(4_940, 'nearest')).toBe(4_940);
  expect(onIdxTick(4_940 - 1e-10, 'down')).toBe(4_940);
  expect(onIdxTick(4_940 + 1e-10, 'up')).toBe(4_940);
});
