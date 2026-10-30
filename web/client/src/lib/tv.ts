// The engine speaks Yahoo Finance symbols (BBCA.JK, BTC-USD, EURUSD=X); the
// TradingView widgets speak EXCHANGE:SYMBOL (IDX:BBCA, BINANCE:BTCUSDT, FX:EURUSD).
// These two functions translate between them for the instruments the app lists.

// Free widgets cannot show exchange futures (COMEX:GC1!) or most index feeds
// (SP:SPX, TVC:DJI), so indices and commodities map to the CFD/spot symbols
// the widgets do serve. Each one below was checked to load in a widget.
const YAHOO_TO_TV: Record<string, string> = {
  '^JKSE': 'IDX:COMPOSITE',
  '^JKLQ45': 'IDX:LQ45',
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
  'PL=F': 'OANDA:XPTUSD',
  'PA=F': 'OANDA:XPDUSD',
  'ZW=F': 'OANDA:WHEATUSD',
  'ZC=F': 'OANDA:CORNUSD',
  'ZS=F': 'OANDA:SOYBNUSD',
  'SB=F': 'OANDA:SUGARUSD',
  // FX:USDSGD stays empty in the widgets.
  'USDSGD=X': 'OANDA:USDSGD',
  'BRK-B': 'NYSE:BRK.B',
  // Yahoo tells these coins apart from same-named tokens with an id suffix.
  'APT21794-USD': 'BINANCE:APTUSDT',
  'SUI20947-USD': 'BINANCE:SUIUSDT',
  'UNI7083-USD': 'BINANCE:UNIUSDT',
  'PEPE24478-USD': 'BINANCE:PEPEUSDT',
  'POL28321-USD': 'BINANCE:POLUSDT',
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

export type MarketGroup = {
  name: string;
  /** [TradingView symbol, display name]. */
  symbols: [string, string][];
};

export type MarketTab = {
  key: string;
  label: string;
  /** The quotes list, in sections; each symbol also has to resolve on Yahoo for the engine (see toYahoo). */
  groups: MarketGroup[];
  /** TradingView screener settings for the "all instruments" table; null when there is none. */
  screener: Record<string, string> | null;
};

export const MARKET_TABS: MarketTab[] = [
  {
    key: 'idx',
    label: 'Saham IDX',
    groups: [
      {
        name: 'Indeks',
        symbols: [
          ['IDX:COMPOSITE', 'IHSG'],
          ['IDX:LQ45', 'LQ45'],
        ],
      },
      {
        name: 'Perbankan',
        symbols: [
          ['IDX:BBCA', 'Bank Central Asia'],
          ['IDX:BBRI', 'Bank Rakyat Indonesia'],
          ['IDX:BMRI', 'Bank Mandiri'],
          ['IDX:BBNI', 'Bank Negara Indonesia'],
          ['IDX:BRIS', 'Bank Syariah Indonesia'],
          ['IDX:BBTN', 'Bank Tabungan Negara'],
          ['IDX:BNGA', 'Bank CIMB Niaga'],
          ['IDX:ARTO', 'Bank Jago'],
        ],
      },
      {
        name: 'Telko & teknologi',
        symbols: [
          ['IDX:TLKM', 'Telkom Indonesia'],
          ['IDX:ISAT', 'Indosat'],
          ['IDX:EXCL', 'XL Axiata'],
          ['IDX:MTEL', 'Dayamitra Telekomunikasi'],
          ['IDX:TOWR', 'Sarana Menara Nusantara'],
          ['IDX:GOTO', 'GoTo'],
          ['IDX:BUKA', 'Bukalapak'],
          ['IDX:EMTK', 'Elang Mahkota Teknologi'],
        ],
      },
      {
        name: 'Konsumer & kesehatan',
        symbols: [
          ['IDX:UNVR', 'Unilever Indonesia'],
          ['IDX:ICBP', 'Indofood CBP'],
          ['IDX:INDF', 'Indofood Sukses Makmur'],
          ['IDX:MYOR', 'Mayora Indah'],
          ['IDX:CPIN', 'Charoen Pokphand'],
          ['IDX:JPFA', 'Japfa Comfeed'],
          ['IDX:AMRT', 'Sumber Alfaria Trijaya'],
          ['IDX:MAPI', 'Mitra Adiperkasa'],
          ['IDX:ACES', 'Aspirasi Hidup Indonesia'],
          ['IDX:HMSP', 'HM Sampoerna'],
          ['IDX:GGRM', 'Gudang Garam'],
          ['IDX:KLBF', 'Kalbe Farma'],
          ['IDX:SIDO', 'Sido Muncul'],
        ],
      },
      {
        name: 'Tambang & energi',
        symbols: [
          ['IDX:ADRO', 'Alamtri Resources'],
          ['IDX:AADI', 'Adaro Andalan Indonesia'],
          ['IDX:PTBA', 'Bukit Asam'],
          ['IDX:ITMG', 'Indo Tambangraya'],
          ['IDX:HRUM', 'Harum Energy'],
          ['IDX:ANTM', 'Aneka Tambang'],
          ['IDX:INCO', 'Vale Indonesia'],
          ['IDX:MDKA', 'Merdeka Copper Gold'],
          ['IDX:AMMN', 'Amman Mineral'],
          ['IDX:NCKL', 'Trimegah Bangun Persada'],
          ['IDX:MBMA', 'Merdeka Battery Materials'],
          ['IDX:TINS', 'Timah'],
          ['IDX:BRMS', 'Bumi Resources Minerals'],
          ['IDX:PGAS', 'Perusahaan Gas Negara'],
          ['IDX:MEDC', 'Medco Energi'],
          ['IDX:AKRA', 'AKR Corporindo'],
        ],
      },
      {
        name: 'Industri, properti & infrastruktur',
        symbols: [
          ['IDX:ASII', 'Astra International'],
          ['IDX:UNTR', 'United Tractors'],
          ['IDX:SMGR', 'Semen Indonesia'],
          ['IDX:INTP', 'Indocement'],
          ['IDX:JSMR', 'Jasa Marga'],
          ['IDX:BSDE', 'Bumi Serpong Damai'],
          ['IDX:CTRA', 'Ciputra Development'],
          ['IDX:PWON', 'Pakuwon Jati'],
          ['IDX:INKP', 'Indah Kiat Pulp & Paper'],
          ['IDX:TKIM', 'Pabrik Kertas Tjiwi Kimia'],
          ['IDX:BRPT', 'Barito Pacific'],
          ['IDX:TPIA', 'Chandra Asri Pacific'],
        ],
      },
    ],
    screener: { market: 'indonesia', defaultScreen: 'most_capitalized', defaultColumn: 'overview' },
  },
  {
    key: 'us',
    label: 'Saham US',
    groups: [
      {
        name: 'Indeks',
        symbols: [
          ['FOREXCOM:SPXUSD', 'S&P 500'],
          ['FOREXCOM:NSXUSD', 'Nasdaq 100'],
          ['FOREXCOM:DJI', 'Dow Jones'],
        ],
      },
      {
        name: 'Teknologi',
        symbols: [
          ['NASDAQ:AAPL', 'Apple'],
          ['NASDAQ:MSFT', 'Microsoft'],
          ['NASDAQ:NVDA', 'NVIDIA'],
          ['NASDAQ:GOOGL', 'Alphabet'],
          ['NASDAQ:META', 'Meta'],
          ['NASDAQ:AMZN', 'Amazon'],
          ['NASDAQ:TSLA', 'Tesla'],
          ['NASDAQ:AVGO', 'Broadcom'],
          ['NASDAQ:AMD', 'AMD'],
          ['NYSE:ORCL', 'Oracle'],
          ['NYSE:CRM', 'Salesforce'],
          ['NASDAQ:ADBE', 'Adobe'],
          ['NASDAQ:NFLX', 'Netflix'],
          ['NASDAQ:INTC', 'Intel'],
          ['NASDAQ:QCOM', 'Qualcomm'],
        ],
      },
      {
        name: 'Keuangan',
        symbols: [
          ['NYSE:JPM', 'JPMorgan'],
          ['NYSE:BAC', 'Bank of America'],
          ['NYSE:GS', 'Goldman Sachs'],
          ['NYSE:MS', 'Morgan Stanley'],
          ['NYSE:V', 'Visa'],
          ['NYSE:MA', 'Mastercard'],
          ['NYSE:BRK.B', 'Berkshire Hathaway'],
        ],
      },
      {
        name: 'Kesehatan & konsumer',
        symbols: [
          ['NYSE:LLY', 'Eli Lilly'],
          ['NYSE:UNH', 'UnitedHealth'],
          ['NYSE:JNJ', 'Johnson & Johnson'],
          ['NYSE:PFE', 'Pfizer'],
          ['NYSE:KO', 'Coca-Cola'],
          ['NASDAQ:PEP', 'PepsiCo'],
          ['NASDAQ:WMT', 'Walmart'],
          ['NASDAQ:COST', 'Costco'],
          ['NYSE:MCD', "McDonald's"],
          ['NYSE:NKE', 'Nike'],
          ['NYSE:DIS', 'Disney'],
        ],
      },
      {
        name: 'Energi & industri',
        symbols: [
          ['NYSE:XOM', 'Exxon Mobil'],
          ['NYSE:CVX', 'Chevron'],
          ['NYSE:CAT', 'Caterpillar'],
          ['NYSE:BA', 'Boeing'],
          ['NYSE:GE', 'GE Aerospace'],
        ],
      },
    ],
    screener: { market: 'america', defaultScreen: 'most_capitalized', defaultColumn: 'overview' },
  },
  {
    key: 'crypto',
    label: 'Crypto',
    groups: [
      {
        name: 'Utama',
        symbols: [
          ['BINANCE:BTCUSDT', 'Bitcoin'],
          ['BINANCE:ETHUSDT', 'Ethereum'],
          ['BINANCE:BNBUSDT', 'BNB'],
          ['BINANCE:SOLUSDT', 'Solana'],
          ['BINANCE:XRPUSDT', 'XRP'],
          ['BINANCE:DOGEUSDT', 'Dogecoin'],
          ['BINANCE:ADAUSDT', 'Cardano'],
          ['BINANCE:TRXUSDT', 'TRON'],
          ['BINANCE:LTCUSDT', 'Litecoin'],
          ['BINANCE:BCHUSDT', 'Bitcoin Cash'],
        ],
      },
      {
        name: 'Platform & layer 2',
        symbols: [
          ['BINANCE:AVAXUSDT', 'Avalanche'],
          ['BINANCE:DOTUSDT', 'Polkadot'],
          ['BINANCE:NEARUSDT', 'NEAR'],
          ['BINANCE:APTUSDT', 'Aptos'],
          ['BINANCE:SUIUSDT', 'Sui'],
          ['BINANCE:ATOMUSDT', 'Cosmos'],
          ['BINANCE:ICPUSDT', 'Internet Computer'],
          ['BINANCE:POLUSDT', 'Polygon'],
          ['BINANCE:ARBUSDT', 'Arbitrum'],
          ['BINANCE:OPUSDT', 'Optimism'],
        ],
      },
      {
        name: 'DeFi, data & AI',
        symbols: [
          ['BINANCE:LINKUSDT', 'Chainlink'],
          ['BINANCE:UNIUSDT', 'Uniswap'],
          ['BINANCE:AAVEUSDT', 'Aave'],
          ['BINANCE:INJUSDT', 'Injective'],
          ['BINANCE:FILUSDT', 'Filecoin'],
          ['BINANCE:RENDERUSDT', 'Render'],
        ],
      },
      {
        name: 'Meme',
        symbols: [
          ['BINANCE:SHIBUSDT', 'Shiba Inu'],
          ['BINANCE:PEPEUSDT', 'Pepe'],
        ],
      },
    ],
    screener: { screener_type: 'crypto_mkt', displayCurrency: 'USD', defaultColumn: 'overview' },
  },
  {
    key: 'forex',
    label: 'Forex',
    groups: [
      {
        name: 'Rupiah',
        symbols: [
          ['FX_IDC:USDIDR', 'USD/IDR'],
          ['FX_IDC:EURIDR', 'EUR/IDR'],
          ['FX_IDC:SGDIDR', 'SGD/IDR'],
          ['FX_IDC:JPYIDR', 'JPY/IDR'],
          ['FX_IDC:GBPIDR', 'GBP/IDR'],
          ['FX_IDC:AUDIDR', 'AUD/IDR'],
          ['FX_IDC:CNYIDR', 'CNY/IDR'],
          ['FX_IDC:MYRIDR', 'MYR/IDR'],
        ],
      },
      {
        name: 'Mayor',
        symbols: [
          ['FX:EURUSD', 'EUR/USD'],
          ['FX:GBPUSD', 'GBP/USD'],
          ['FX:USDJPY', 'USD/JPY'],
          ['FX:USDCHF', 'USD/CHF'],
          ['FX:AUDUSD', 'AUD/USD'],
          ['FX:USDCAD', 'USD/CAD'],
          ['FX:NZDUSD', 'NZD/USD'],
        ],
      },
      {
        name: 'Silang',
        symbols: [
          ['FX:EURGBP', 'EUR/GBP'],
          ['FX:EURJPY', 'EUR/JPY'],
          ['FX:GBPJPY', 'GBP/JPY'],
          ['FX:AUDJPY', 'AUD/JPY'],
          ['FX:EURAUD', 'EUR/AUD'],
          ['FX:EURCHF', 'EUR/CHF'],
        ],
      },
      {
        name: 'Asia',
        symbols: [
          ['OANDA:USDSGD', 'USD/SGD'],
          ['FX:USDHKD', 'USD/HKD'],
          ['FX_IDC:USDMYR', 'USD/MYR'],
          ['FX_IDC:USDTHB', 'USD/THB'],
          ['FX_IDC:USDCNY', 'USD/CNY'],
        ],
      },
    ],
    screener: { market: 'forex', defaultScreen: 'general', defaultColumn: 'overview' },
  },
  {
    key: 'commodities',
    label: 'Komoditas & Indeks',
    groups: [
      {
        name: 'Logam',
        symbols: [
          ['OANDA:XAUUSD', 'Emas'],
          ['OANDA:XAGUSD', 'Perak'],
          ['OANDA:XPTUSD', 'Platinum'],
          ['OANDA:XPDUSD', 'Paladium'],
          ['OANDA:XCUUSD', 'Tembaga'],
        ],
      },
      {
        name: 'Energi',
        symbols: [
          ['TVC:USOIL', 'Minyak WTI'],
          ['TVC:UKOIL', 'Minyak Brent'],
          ['OANDA:NATGASUSD', 'Gas alam'],
        ],
      },
      {
        name: 'Pertanian',
        symbols: [
          ['OANDA:WHEATUSD', 'Gandum'],
          ['OANDA:CORNUSD', 'Jagung'],
          ['OANDA:SOYBNUSD', 'Kedelai'],
          ['OANDA:SUGARUSD', 'Gula'],
        ],
      },
      {
        name: 'Indeks dunia',
        symbols: [
          ['FOREXCOM:DJI', 'Dow Jones'],
          ['FOREXCOM:UKXGBP', 'FTSE 100'],
          ['XETR:DAX', 'DAX'],
          ['INDEX:NKY', 'Nikkei 225'],
          ['INDEX:HSI', 'Hang Seng'],
        ],
      },
    ],
    screener: null,
  },
];

/** Every symbol of a tab, in list order. */
export const tabSymbols = (tab: MarketTab): [string, string][] => tab.groups.flatMap((g) => g.symbols);

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
