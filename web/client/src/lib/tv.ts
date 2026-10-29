// The engine speaks Yahoo Finance symbols (BBCA.JK, BTC-USD, EURUSD=X); the
// TradingView widgets speak EXCHANGE:SYMBOL (IDX:BBCA, BINANCE:BTCUSDT, FX:EURUSD).
// These two functions translate between them for the instruments the app lists.

// Free widgets cannot show exchange futures (COMEX:GC1!) or most index feeds
// (SP:SPX, TVC:DJI), so indices and commodities map to the CFD/spot symbols
// the widgets do serve. Each one below was checked to load in a widget.
const YAHOO_TO_TV: Record<string, string> = {
  '^JKSE': 'IDX:COMPOSITE',
  '^GSPC': 'FOREXCOM:SPXUSD',
  '^NDX': 'FOREXCOM:NSXUSD',
  '^DJI': 'FOREXCOM:DJI',
  '^N225': 'INDEX:NKY',
  '^HSI': 'INDEX:HSI',
  '^GDAXI': 'XETR:DAX',
  '^FTSE': 'FOREXCOM:UKXGBP',
  'GC=F': 'OANDA:XAUUSD',
  'SI=F': 'OANDA:XAGUSD',
  'HG=F': 'OANDA:XCUUSD',
  'CL=F': 'TVC:USOIL',
  'BZ=F': 'TVC:UKOIL',
  'NG=F': 'OANDA:NATGASUSD',
};

const TV_TO_YAHOO: Record<string, string> = Object.fromEntries(
  Object.entries(YAHOO_TO_TV).map(([yahoo, tv]) => [tv, yahoo]),
);

/** Yahoo symbol (as the engine and the analysis history use it) -> TradingView symbol. */
export function toTradingView(yahoo: string): string {
  const s = yahoo.trim().toUpperCase();
  if (YAHOO_TO_TV[s]) return YAHOO_TO_TV[s];
  if (s.endsWith('.JK')) return `IDX:${s.slice(0, -3)}`;
  if (s.endsWith('.HK')) return `HKEX:${Number(s.slice(0, -3))}`;
  const crypto = s.match(/^([A-Z0-9]+)-(USD|USDT|USDC)$/);
  if (crypto) return `BINANCE:${crypto[1]}USDT`;
  const fx = s.match(/^([A-Z]{6})=X$/);
  if (fx) return fx[1].includes('IDR') ? `FX_IDC:${fx[1]}` : `FX:${fx[1]}`;
  if (/^[A-Z]{6}$/.test(s) && s.includes('IDR')) return `FX_IDC:${s}`;
  return s; // plain US tickers resolve on TradingView as-is
}

/** TradingView symbol -> the Yahoo symbol the engine can analyse, or null when there is no clear match. */
export function toYahoo(tv: string): string | null {
  const s = tv.trim().toUpperCase();
  if (TV_TO_YAHOO[s]) return TV_TO_YAHOO[s];
  const [exchange, symbol] = s.includes(':') ? s.split(':', 2) : ['', s];
  if (!symbol) return null;
  switch (exchange) {
    case 'IDX':
      return `${symbol}.JK`;
    case 'HKEX':
      return `${symbol.padStart(4, '0')}.HK`;
    case 'FX':
    case 'FX_IDC':
    case 'OANDA':
    case 'FOREXCOM':
      return /^[A-Z]{6}$/.test(symbol) ? `${symbol}=X` : null;
    case 'BINANCE':
    case 'COINBASE':
    case 'BYBIT':
    case 'KRAKEN':
    case 'BITSTAMP':
    case 'CRYPTO': {
      const m = symbol.match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
      return m ? `${m[1]}-USD` : null;
    }
    case '':
    case 'NASDAQ':
    case 'NYSE':
    case 'AMEX':
    case 'NYSEARCA':
    case 'CBOE':
      return /^[A-Z.\-]+$/.test(symbol) ? symbol : null;
    default:
      return null;
  }
}

/** Accepts either form from a search box and returns both, or null if it cannot be charted. */
export function resolveSymbol(input: string): { tv: string; yahoo: string | null } | null {
  const s = input.trim().toUpperCase();
  if (!s || !/^[A-Z0-9.:\-=^!_]+$/.test(s)) return null;
  if (s.includes(':')) return { tv: s, yahoo: toYahoo(s) };
  return { tv: toTradingView(s), yahoo: s };
}

/** Assets with no company behind them: the fundamentals analyst has nothing to read. */
export function hasNoFundamentals(yahoo: string): boolean {
  const s = yahoo.trim().toUpperCase();
  return /-(USD|USDT|USDC|BTC|ETH)$/.test(s) || s.endsWith('=X') || s.endsWith('=F') || s.startsWith('^');
}

export type MarketTab = {
  key: string;
  label: string;
  /** Symbols for the quotes list, as [TradingView symbol, display name]. */
  quotes: [string, string][];
  /** TradingView screener settings for the "all instruments" table; null when there is none. */
  screener: Record<string, string> | null;
};

export const MARKET_TABS: MarketTab[] = [
  {
    key: 'idx',
    label: 'Saham IDX',
    quotes: [
      ['IDX:COMPOSITE', 'IHSG'],
      ['IDX:BBCA', 'Bank Central Asia'],
      ['IDX:BBRI', 'Bank Rakyat Indonesia'],
      ['IDX:BMRI', 'Bank Mandiri'],
      ['IDX:BBNI', 'Bank Negara Indonesia'],
      ['IDX:TLKM', 'Telkom Indonesia'],
      ['IDX:ASII', 'Astra International'],
      ['IDX:GOTO', 'GoTo'],
      ['IDX:ADRO', 'Adaro'],
      ['IDX:ANTM', 'Aneka Tambang'],
      ['IDX:UNVR', 'Unilever Indonesia'],
      ['IDX:ICBP', 'Indofood CBP'],
    ],
    screener: { market: 'indonesia', defaultScreen: 'most_capitalized', defaultColumn: 'overview' },
  },
  {
    key: 'us',
    label: 'Saham US',
    quotes: [
      ['FOREXCOM:SPXUSD', 'S&P 500'],
      ['FOREXCOM:NSXUSD', 'Nasdaq 100'],
      ['NASDAQ:AAPL', 'Apple'],
      ['NASDAQ:MSFT', 'Microsoft'],
      ['NASDAQ:NVDA', 'NVIDIA'],
      ['NASDAQ:AMZN', 'Amazon'],
      ['NASDAQ:GOOGL', 'Alphabet'],
      ['NASDAQ:META', 'Meta'],
      ['NASDAQ:TSLA', 'Tesla'],
      ['NYSE:JPM', 'JPMorgan'],
    ],
    screener: { market: 'america', defaultScreen: 'most_capitalized', defaultColumn: 'overview' },
  },
  {
    key: 'crypto',
    label: 'Crypto',
    quotes: [
      ['BINANCE:BTCUSDT', 'Bitcoin'],
      ['BINANCE:ETHUSDT', 'Ethereum'],
      ['BINANCE:SOLUSDT', 'Solana'],
      ['BINANCE:BNBUSDT', 'BNB'],
      ['BINANCE:XRPUSDT', 'XRP'],
      ['BINANCE:DOGEUSDT', 'Dogecoin'],
      ['BINANCE:ADAUSDT', 'Cardano'],
      ['BINANCE:AVAXUSDT', 'Avalanche'],
      ['BINANCE:LINKUSDT', 'Chainlink'],
      ['BINANCE:DOTUSDT', 'Polkadot'],
    ],
    screener: { screener_type: 'crypto_mkt', displayCurrency: 'USD', defaultColumn: 'overview' },
  },
  {
    key: 'forex',
    label: 'Forex',
    quotes: [
      ['FX_IDC:USDIDR', 'USD/IDR'],
      ['FX_IDC:EURIDR', 'EUR/IDR'],
      ['FX_IDC:SGDIDR', 'SGD/IDR'],
      ['FX_IDC:JPYIDR', 'JPY/IDR'],
      ['FX:EURUSD', 'EUR/USD'],
      ['FX:GBPUSD', 'GBP/USD'],
      ['FX:USDJPY', 'USD/JPY'],
      ['FX:AUDUSD', 'AUD/USD'],
      ['FX:USDCHF', 'USD/CHF'],
      ['FX:USDCAD', 'USD/CAD'],
    ],
    screener: { market: 'forex', defaultScreen: 'general', defaultColumn: 'overview' },
  },
  {
    key: 'commodities',
    label: 'Komoditas & Indeks',
    quotes: [
      ['OANDA:XAUUSD', 'Emas'],
      ['OANDA:XAGUSD', 'Perak'],
      ['TVC:USOIL', 'Minyak WTI'],
      ['TVC:UKOIL', 'Minyak Brent'],
      ['OANDA:NATGASUSD', 'Gas alam'],
      ['OANDA:XCUUSD', 'Tembaga'],
      ['FOREXCOM:DJI', 'Dow Jones'],
      ['INDEX:NKY', 'Nikkei 225'],
      ['INDEX:HSI', 'Hang Seng'],
      ['XETR:DAX', 'DAX'],
    ],
    screener: null,
  },
];

export const TICKER_TAPE: [string, string][] = [
  ['IDX:COMPOSITE', 'IHSG'],
  ['IDX:BBCA', 'BBCA'],
  ['IDX:BMRI', 'BMRI'],
  ['FX_IDC:USDIDR', 'USD/IDR'],
  ['BINANCE:BTCUSDT', 'BTC'],
  ['BINANCE:ETHUSDT', 'ETH'],
  ['OANDA:XAUUSD', 'Emas'],
  ['FOREXCOM:SPXUSD', 'S&P 500'],
];
