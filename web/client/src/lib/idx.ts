// The Indonesia Stock Exchange's price steps (fraksi harga): an order price must be a multiple of
// the step for its price band, or the broker app refuses it. An indicator's levels are exact numbers
// (SL 5.287,47), so the trading plan puts them on this grid before a trader copies them. The bands
// are the exchange's rule for shares: Rp1 under Rp200, Rp2 under Rp500, Rp5 under Rp2.000, Rp10
// under Rp5.000, and Rp25 from Rp5.000.
const BANDS: [below: number, step: number][] = [
  [200, 1],
  [500, 2],
  [2_000, 5],
  [5_000, 10],
  [Infinity, 25],
];

/** The IDX price step at a price. */
export function idxTick(price: number): number {
  return BANDS.find(([below]) => price < below)![1];
}

/** A price on the IDX grid: the nearest step, or the step at or below, or at or above it. */
export function onIdxTick(price: number, way: 'nearest' | 'down' | 'up'): number {
  const step = idxTick(price);
  const steps = price / step;
  // The small slack keeps a price already on the grid (4.940 as 4939.999…) where it is.
  const n = way === 'down' ? Math.floor(steps + 1e-9) : way === 'up' ? Math.ceil(steps - 1e-9) : Math.round(steps);
  return n * step;
}
