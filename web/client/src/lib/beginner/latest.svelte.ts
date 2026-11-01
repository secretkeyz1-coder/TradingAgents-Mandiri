// The asset in focus's latest price, as AssetView reads it, for the cards beside it
// (the price box in Kabari saya reads its direction and its example from it).
export const latest = $state<{ symbol: string; price: number | null }>({ symbol: '', price: null });
