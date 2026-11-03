// The script templates the editor offers (and the ledger runs, LEDGER_SCRIPTS in server/src/ledger.ts), in the
// language of script.ts, which re-exports them. Kept apart so the runtime file holds only the runtime.

export const SCRIPT_TEMPLATES: { name: string; code: string }[] = [
  {
    name: 'Donchian breakout (trend following)',
    code: `// Trend following: BUY saat close menembus harga tertinggi N candle sebelumnya, SELL saat menembus
// harga terendahnya. SL dan TP dalam ATR. Uji di Lab pada 4j dan harian, dengan kedaluwarsa panjang.
const len = input("Periode Donchian", 20);
const slAtr = input("SL (ATR)", 2);
const tpAtr = input("TP (ATR)", 4);
const hi = ta.highest(high, len);
const lo = ta.lowest(low, len);
const atr = ta.atr(14);
plot(hi, "Donchian atas", "teal");
plot(lo, "Donchian bawah", "teal");
for (let i = len + 2; i < n; i++) {
  if (close[i] > hi[i - 1] && close[i - 1] <= hi[i - 2]) signal(i, "BUY", { sl: close[i] - slAtr * atr[i], tp: close[i] + tpAtr * atr[i], label: "Breakout" });
  if (close[i] < lo[i - 1] && close[i - 1] >= lo[i - 2]) signal(i, "SELL", { sl: close[i] + slAtr * atr[i], tp: close[i] - tpAtr * atr[i], label: "Breakdown" });
}`,
  },
  {
    name: 'Trend EMA 50/200 + pullback',
    code: `// Ikut tren besar: saat EMA 50 di atas EMA 200, BUY ketika harga kembali naik melewati EMA 20
// setelah koreksi; kebalikannya untuk SELL. SL 1,5 ATR, TP 3 ATR.
const slAtr = input("SL (ATR)", 1.5);
const tpAtr = input("TP (ATR)", 3);
const fast = ta.ema(close, 20);
const mid = ta.ema(close, 50);
const slow = ta.ema(close, 200);
const atr = ta.atr(14);
plot(mid, "EMA 50", "orange");
plot(slow, "EMA 200", "royalblue");
const up = ta.crossover(close, fast);
const down = ta.crossunder(close, fast);
for (let i = 200; i < n; i++) {
  if (mid[i] > slow[i] && up[i]) signal(i, "BUY", { sl: close[i] - slAtr * atr[i], tp: close[i] + tpAtr * atr[i], label: "Pullback" });
  if (mid[i] < slow[i] && down[i]) signal(i, "SELL", { sl: close[i] + slAtr * atr[i], tp: close[i] - tpAtr * atr[i], label: "Pullback" });
}`,
  },
  {
    name: 'EMA cross + ATR',
    code: `// BUY saat EMA cepat memotong ke atas EMA lambat, SELL sebaliknya.
const fastLen = input("EMA cepat", 20);
const slowLen = input("EMA lambat", 50);
const rr = input("Risk reward", 2);
const fast = ta.ema(close, fastLen);
const slow = ta.ema(close, slowLen);
const atr = ta.atr(14);
plot(fast, "EMA cepat", "orange");
plot(slow, "EMA lambat", "royalblue");
const up = ta.crossover(fast, slow);
const down = ta.crossunder(fast, slow);
for (let i = slowLen; i < n; i++) {
  const risk = 1.5 * atr[i];
  if (up[i]) signal(i, "BUY", { sl: close[i] - risk, tp: close[i] + risk * rr, label: "EMA cross" });
  if (down[i]) signal(i, "SELL", { sl: close[i] + risk, tp: close[i] - risk * rr, label: "EMA cross" });
}`,
  },
  {
    name: 'RSI keluar oversold/overbought',
    code: `// BUY saat RSI naik keluar dari bawah 30, SELL saat turun keluar dari atas 70.
const len = input("RSI", 14);
const lo = input("Oversold", 30);
const hi = input("Overbought", 70);
const rsi = ta.rsi(close, len);
const atr = ta.atr(14);
for (let i = len + 1; i < n; i++) {
  if (rsi[i - 1] < lo && rsi[i] >= lo) signal(i, "BUY", { sl: low[i] - atr[i], tp: close[i] + 2 * atr[i], label: "RSI " + rsi[i].toFixed(0) });
  if (rsi[i - 1] > hi && rsi[i] <= hi) signal(i, "SELL", { sl: high[i] + atr[i], tp: close[i] - 2 * atr[i], label: "RSI " + rsi[i].toFixed(0) });
}`,
  },
  {
    name: 'Bollinger breakout',
    code: `// BUY saat close menembus band atas, SELL saat menembus band bawah.
const band = ta.bb(close, input("Panjang BB", 20), input("Kelipatan", 2));
plot(band.upper, "BB atas", "gray");
plot(band.mid, "BB tengah", "gray");
plot(band.lower, "BB bawah", "gray");
for (let i = 21; i < n; i++) {
  if (close[i] > band.upper[i] && close[i - 1] <= band.upper[i - 1]) signal(i, "BUY", { sl: band.mid[i], tp: close[i] + 2 * (close[i] - band.mid[i]) });
  if (close[i] < band.lower[i] && close[i - 1] >= band.lower[i - 1]) signal(i, "SELL", { sl: band.mid[i], tp: close[i] - 2 * (band.mid[i] - close[i]) });
}`,
  },
  {
    name: 'RSI(2) pullback (mean reversion)',
    code: `// Mean reversion (sering menang, untung kecil): BELI saat RSI(2) jatuh di bawah batas selagi tren
// besar naik (close di atas SMA 200), KELUAR saat close kembali di atas SMA 5. SL pelindung 3 ATR dan
// TP pengaman 5 ATR jarang tersentuh; posisi ditutup paling lambat 10 candle, satu posisi sekaligus.
// Uji di Lab pada harian: S&P 500 (^GSPC), emas (GC=F), BTC-USD.
const longOnly = input("Beli saja", true);
const level = input("Batas RSI(2)", 10);
const slAtr = input("SL pelindung (ATR)", 3);
const tpAtr = input("TP pengaman (ATR)", 5);
const maxBars = input("Maks candle", 10);
const rsi2 = ta.rsi(close, 2);
const trend = ta.sma(close, 200);
const mean = ta.sma(close, 5);
const atr = ta.atr(14);
plot(trend, "SMA 200", "royalblue");
plot(mean, "SMA 5", "orange");
const backUp = close.map((c, k) => c > mean[k]);
const backDown = close.map((c, k) => c < mean[k]);
for (let i = 200; i < n; i++) {
  if (close[i] > trend[i] && rsi2[i] < level)
    signal(i, "BUY", { sl: close[i] - slAtr * atr[i], tp: close[i] + tpAtr * atr[i], exit: backUp, maxBars, exclusive: true, label: "RSI2 " + rsi2[i].toFixed(0) });
  if (!longOnly && close[i] < trend[i] && rsi2[i] > 100 - level)
    signal(i, "SELL", { sl: close[i] + slAtr * atr[i], tp: close[i] - tpAtr * atr[i], exit: backDown, maxBars, exclusive: true, label: "RSI2 " + rsi2[i].toFixed(0) });
}`,
  },
  {
    name: 'Bollinger revert (mean reversion)',
    code: `// Mean reversion: BELI saat close jatuh di bawah Bollinger bawah (20, 2) selagi tren besar naik
// (di atas SMA 200), KELUAR saat close kembali di atas garis tengah. SL pelindung 3 ATR, TP pengaman
// 5 ATR, paling lama 10 candle, satu posisi sekaligus.
const longOnly = input("Beli saja", true);
const slAtr = input("SL pelindung (ATR)", 3);
const tpAtr = input("TP pengaman (ATR)", 5);
const maxBars = input("Maks candle", 10);
const band = ta.bb(close, 20, 2);
const trend = ta.sma(close, 200);
const atr = ta.atr(14);
plot(trend, "SMA 200", "royalblue");
plot(band.upper, "BB atas", "gray");
plot(band.mid, "BB tengah", "gray");
plot(band.lower, "BB bawah", "gray");
const backUp = close.map((c, k) => c > band.mid[k]);
const backDown = close.map((c, k) => c < band.mid[k]);
for (let i = 200; i < n; i++) {
  if (close[i] > trend[i] && close[i] < band.lower[i])
    signal(i, "BUY", { sl: close[i] - slAtr * atr[i], tp: close[i] + tpAtr * atr[i], exit: backUp, maxBars, exclusive: true, label: "BB bawah" });
  if (!longOnly && close[i] < trend[i] && close[i] > band.upper[i])
    signal(i, "SELL", { sl: close[i] + slAtr * atr[i], tp: close[i] - tpAtr * atr[i], exit: backDown, maxBars, exclusive: true, label: "BB atas" });
}`,
  },
  {
    name: 'Trendline Rejection (dari Pine)',
    code: `// Trendline Rejection Scalper (M15 / M30 / H1), terjemahan dari Pine v6 "TL Rejection".
// 1. Trendline otomatis dari 2 pivot (higher low / lower high) yang berjarak >= N candle dan kemiringannya wajar (x ATR).
// 2. Sinyal di sentuhan ke-3 dst., di zona ±toleransi ATR, dengan candle rejection: pin bar, engulfing atau false break.
// 3. Filter: volatilitas (ATR), ukuran SL, ruang ke S/R berikutnya, (opsional) searah tren HTF dan di dalam sesi.
// 4. Skor 0–8: sentuhan ke-3+ (1), tren HTF (2), RSI pullback (1), volume (1), S/R atau Fibo 0,5–0,618 (2), sesi (1).
// 5. Entry order stop di luar candle rejection, berlaku 3 candle. SL di luar trendline. TP1 = 1R (tutup 50%, SL ke
//    titik impas), TP2 = 2R atau S/R berikutnya.
// Tidak dibawa: tabel statistik dan label hasil R (kartu skrip dan Lab menghitungnya dari sinyal), ukuran teks label.
// Beda dengan simulasi di Pine: order stop yang dilompati harga terisi di harga buka, dan TP di candle yang mengisi
// order tidak dihitung (ADR 0023). Seperti tabel Pine, satu posisi sekaligus; alert Pine juga berbunyi saat posisi
// masih terbuka, di sini sinyal itu dilewati (labelnya tetap digambar).

// Preset
const preset = input("Mode parameter (Auto/Manual)", "Auto");
// Trendline (mode Manual)
const pivLIn = input("Pivot kiri", 3);
const pivRIn = input("Pivot kanan", 3);
const spaceIn = input("Jarak min. antar sentuhan (candle)", 8);
const zoneIn = input("Toleransi zona (x ATR)", 0.25);
const htfIn = input("TF bias HTF (menit)", 60);
const tp2In = input("TP2 (R)", 2);
// Trendline (umum)
const slopeMin = input("Slope min (x ATR per candle)", 0.05);
const slopeMax = input("Slope maks (x ATR per candle)", 0.5);
const breakTol = input("Toleransi patah (x ATR)", 0.5);
// Filter & skor
const reqTrend = input("Wajib searah tren HTF", true);
const emaFastL = input("EMA cepat (HTF)", 20);
const emaSlowL = input("EMA lambat (HTF)", 50);
const rsiLen = input("RSI length", 14);
const rsiBuyLo = input("RSI pullback BUY min", 35);
const rsiBuyHi = input("RSI pullback BUY maks", 50);
const volLen = input("Rata-rata volume", 20);
const atrLen = input("ATR length", 14);
const atrAvgLen = input("Rata-rata ATR", 50);
const atrMinRat = input("ATR minimal (x rata-rata)", 0.7);
const srTol = input("Toleransi S/R horizontal (x ATR)", 0.3);
const reqSess = input("Wajib di dalam sesi", false);
const sessLdn = input("Sesi London", "1500-1900");
const sessNy = input("Sesi New York", "2000-2359");
const tz = input("Zona waktu sesi", "Asia/Bangkok");
// Sinyal & risiko
const minScore = input("Skor minimal sinyal", 4);
const aPlus = input("Skor A+", 6);
const maxSlAtr = input("SL maksimal (x ATR)", 1.5);
const slBuf = input("Buffer SL di luar trendline (x ATR)", 0.5);
const minRoomR = input("Ruang min. ke S/R berikutnya (R)", 1.5);
const expiry = input("Order kedaluwarsa setelah (candle)", 3);
// Tampilan
const showLvls = input("Garis entry / SL / TP", true);
const showBroken = input("Simpan trendline lama / patah", true);

const TEAL = "#00897B";
const MAROON = "#880E4F";
const GREEN = "#4CAF50";
const RED = "#FF5252";
const BLUE = "#2962FF";
const TEAL_70 = "rgba(0, 137, 123, 0.7)";
const MAROON_70 = "rgba(136, 14, 79, 0.7)";
const GRAY_50 = "rgba(120, 123, 134, 0.5)";
const GRAY_70 = "rgba(120, 123, 134, 0.7)";

// Preset Auto mengikuti timeframe chart (<= M15, M30, >= H1).
const isAuto = preset === "Auto";
const isM15 = timeframe <= 15;
const isM30 = timeframe > 15 && timeframe <= 30;
const pivL = isAuto ? (isM15 || isM30 ? 3 : 5) : pivLIn;
const pivR = isAuto ? (isM15 || isM30 ? 3 : 5) : pivRIn;
const minSpace = isAuto ? (isM15 || isM30 ? 8 : 6) : spaceIn;
const zoneTol = isAuto ? (isM15 || isM30 ? 0.25 : 0.3) : zoneIn;
const htfMin = isAuto ? (isM15 ? 60 : 240) : htfIn;
const tp2R = isAuto ? (isM15 ? 1.5 : isM30 ? 2 : 2.5) : tp2In;

// Indikator
const atr = ta.atr(atrLen);
const atrAvg = ta.sma(atr, atrAvgLen);
const rsi = ta.rsi(close, rsiLen);
const vol = volume.map((v) => nz(v));
const volAvg = ta.sma(vol, volLen);
const inLdn = session(sessLdn, tz);
const inNy = session(sessNy, tz);
const hiR = ta.highest(high, pivR + 1);
const loR = ta.lowest(low, pivR + 1);

// Bias HTF tanpa repaint: candle HTF yang sudah tutup (request.security dengan [1] dan lookahead_on). Di chart yang
// timeframe-nya sudah lebih tinggi dari HTF itu, dipakai timeframe chart.
const h = htf(Number.isFinite(timeframe) ? Math.max(htfMin, timeframe) : htfMin);
const ef = ta.ema(h.close, emaFastL);
const es = ta.ema(h.close, emaSlowL);
const htfUp = h.closed(h.close.map((c, k) => c > es[k] && ef[k] > es[k]));
const htfDn = h.closed(h.close.map((c, k) => c < es[k] && ef[k] < es[k]));

// Trendline: dir 1 = garis naik dari pivot low, -1 = garis turun dari pivot high.
const newLine = () => ({ b1: NaN, y1: NaN, b2: NaN, y2: NaN, slope: NaN, active: false, lastTouch: NaN, touches: 0, ext: NaN, prevB: NaN, prevY: NaN, ln: NaN });
const up = newLine();
const dn = newLine();
const valueAt = (t, b) => t.y2 + t.slope * (b - t.b2);
// Level S/R horizontal dari pivot, 20 terakhir.
const lvls = [];

function processPivot(t, p, pb, dir, atrV, extInit, i) {
  const onLine = t.active && Math.abs(p - valueAt(t, pb)) <= zoneTol * atrV;
  if (!onLine && !na(t.prevY)) {
    const sp = pb - t.prevB;
    const slp = (p - t.prevY) / sp;
    const structOK = dir === 1 ? p > t.prevY : p < t.prevY;
    const absSlp = Math.abs(slp);
    if (structOK && sp >= minSpace && absSlp >= slopeMin * atrV && absSlp <= slopeMax * atrV) {
      // Pensiunkan garis lama.
      if (!na(t.ln)) {
        if (t.active) lineSet(t.ln, { x2: i, y2: valueAt(t, i), extend: "none", color: GRAY_50 });
        if (!showBroken) lineDelete(t.ln);
      }
      t.b1 = t.prevB;
      t.y1 = t.prevY;
      t.b2 = pb;
      t.y2 = p;
      t.slope = slp;
      t.active = true;
      t.touches = 2;
      t.lastTouch = pb;
      t.ext = extInit;
      t.ln = line(t.b1, t.y1, t.b2, t.y2, { extend: "right", color: dir === 1 ? TEAL : MAROON, width: 2 });
    }
  }
  t.prevB = pb;
  t.prevY = p;
}

function checkBreak(t, dir, atrV, i) {
  if (!t.active) return;
  const now = valueAt(t, i);
  const prev = now - t.slope;
  const prevClose = i > 0 ? close[i - 1] : NaN;
  const broken =
    dir === 1
      ? close[i] < now - breakTol * atrV || (close[i] < now && prevClose < prev)
      : close[i] > now + breakTol * atrV || (close[i] > now && prevClose > prev);
  if (broken) {
    t.active = false;
    lineSet(t.ln, { x2: i, y2: now, extend: "none", style: "dotted", color: GRAY_70 });
    if (!showBroken) lineDelete(t.ln);
  }
}

const nearLevel = (price, tol) => lvls.some((v) => Math.abs(v - price) <= tol);
const nextAbove = (price) => lvls.reduce((res, v) => (v > price && (na(res) || v < res) ? v : res), NaN);
const nextBelow = (price) => lvls.reduce((res, v) => (v < price && (na(res) || v > res) ? v : res), NaN);

function drawLevels(i, e, s, t1, t2) {
  const x2 = i + expiry + 8;
  line(i, e, x2, e, { color: BLUE, style: "dashed" });
  line(i, s, x2, s, { color: RED, style: "dashed" });
  line(i, t1, x2, t1, { color: GREEN, style: "dotted" });
  line(i, t2, x2, t2, { color: GREEN, style: "dashed" });
}

const pl = ta.pivotlow(low, pivL, pivR);
const ph = ta.pivothigh(high, pivL, pivR);

for (let i = 0; i < n; i++) {
  const atrV = atr[i];
  if (!na(pl[i])) {
    processPivot(up, pl[i], i - pivR, 1, atrV, hiR[i], i);
    lvls.push(pl[i]);
  }
  if (!na(ph[i])) {
    processPivot(dn, ph[i], i - pivR, -1, atrV, loR[i], i);
    lvls.push(ph[i]);
  }
  while (lvls.length > 20) lvls.shift();
  if (up.active) up.ext = Math.max(up.ext, high[i]);
  if (dn.active) dn.ext = Math.min(dn.ext, low[i]);
  checkBreak(up, 1, atrV, i);
  checkBreak(dn, -1, atrV, i);

  // Pola candle
  const rng = high[i] - low[i];
  const body = Math.abs(close[i] - open[i]);
  const upWick = high[i] - Math.max(open[i], close[i]);
  const loWick = Math.min(open[i], close[i]) - low[i];
  const pinBull = rng > 0 && loWick >= 2 * body && close[i] >= low[i] + 0.66 * rng;
  const pinBear = rng > 0 && upWick >= 2 * body && close[i] <= high[i] - 0.66 * rng;
  const engBull = i > 0 && close[i] > open[i] && close[i - 1] < open[i - 1] && close[i] >= open[i - 1] && open[i] <= close[i - 1];
  const engBear = i > 0 && close[i] < open[i] && close[i - 1] > open[i - 1] && close[i] <= open[i - 1] && open[i] >= close[i - 1];
  const volaOK = !na(atrAvg[i]) && atrV >= atrMinRat * atrAvg[i];
  const volHigh = !na(volAvg[i]) && volAvg[i] > 0 && vol[i] > volAvg[i];
  const inSess = inLdn[i] || inNy[i];

  // BUY
  const upNow = up.active ? valueAt(up, i) : NaN;
  const touchUp = up.active && i - up.lastTouch >= minSpace && low[i] <= upNow + zoneTol * atrV && low[i] >= upNow - breakTol * atrV && close[i] > upNow;
  const fbUp = touchUp && low[i] < upNow;
  const rejUp = touchUp && (pinBull || engBull || fbUp);
  const touchNoUp = up.touches + 1;
  const fibRngUp = up.ext - up.y2;
  const inFibUp = up.active && fibRngUp > 0 && low[i] <= up.ext - 0.5 * fibRngUp + zoneTol * atrV && low[i] >= up.ext - 0.618 * fibRngUp - zoneTol * atrV;
  const confUp = inFibUp || (up.active && nearLevel(low[i], srTol * atrV));
  const scoreUp =
    (touchNoUp >= 3 ? 1 : 0) + (htfUp[i] ? 2 : 0) + (rsi[i] >= rsiBuyLo && rsi[i] <= rsiBuyHi ? 1 : 0) + (volHigh ? 1 : 0) + (confUp ? 2 : 0) + (inSess ? 1 : 0);
  const entryUp = high[i] + mintick;
  const slUp = Math.min(low[i], upNow - slBuf * atrV);
  const riskUp = entryUp - slUp;
  const resUp = nextAbove(entryUp);
  const slOkUp = riskUp > 0 && riskUp <= maxSlAtr * atrV;
  const roomUp = na(resUp) || resUp - entryUp >= minRoomR * riskUp;
  const tp1Up = entryUp + riskUp;
  const tp2Up = na(resUp) ? entryUp + tp2R * riskUp : Math.min(resUp, entryUp + tp2R * riskUp);
  const buySig = rejUp && volaOK && (!reqTrend || htfUp[i]) && (!reqSess || inSess) && scoreUp >= minScore && slOkUp && roomUp;
  if (touchUp) {
    up.touches += 1;
    up.lastTouch = i;
  }

  // SELL
  const dnNow = dn.active ? valueAt(dn, i) : NaN;
  const touchDn = dn.active && i - dn.lastTouch >= minSpace && high[i] >= dnNow - zoneTol * atrV && high[i] <= dnNow + breakTol * atrV && close[i] < dnNow;
  const fbDn = touchDn && high[i] > dnNow;
  const rejDn = touchDn && (pinBear || engBear || fbDn);
  const touchNoDn = dn.touches + 1;
  const fibRngDn = dn.y2 - dn.ext;
  const inFibDn = dn.active && fibRngDn > 0 && high[i] >= dn.ext + 0.5 * fibRngDn - zoneTol * atrV && high[i] <= dn.ext + 0.618 * fibRngDn + zoneTol * atrV;
  const confDn = inFibDn || (dn.active && nearLevel(high[i], srTol * atrV));
  const scoreDn =
    (touchNoDn >= 3 ? 1 : 0) + (htfDn[i] ? 2 : 0) + (rsi[i] >= 100 - rsiBuyHi && rsi[i] <= 100 - rsiBuyLo ? 1 : 0) + (volHigh ? 1 : 0) + (confDn ? 2 : 0) + (inSess ? 1 : 0);
  const entryDn = low[i] - mintick;
  const slDn = Math.max(high[i], dnNow + slBuf * atrV);
  const riskDn = slDn - entryDn;
  const supDn = nextBelow(entryDn);
  const slOkDn = riskDn > 0 && riskDn <= maxSlAtr * atrV;
  const roomDn = na(supDn) || entryDn - supDn >= minRoomR * riskDn;
  const tp1Dn = entryDn - riskDn;
  const tp2Dn = na(supDn) ? entryDn - tp2R * riskDn : Math.max(supDn, entryDn - tp2R * riskDn);
  const sellSig = rejDn && volaOK && (!reqTrend || htfDn[i]) && (!reqSess || inSess) && scoreDn >= minScore && slOkDn && roomDn;
  if (touchDn) {
    dn.touches += 1;
    dn.lastTouch = i;
  }

  // Sinyal: order stop yang menunggu sebanyak expiry candle, dua target, satu posisi sekaligus, tanpa batas umur trade.
  if (buySig) {
    label(i, low[i], "BUY " + scoreUp + "/8\\n#" + touchNoUp, { position: "below", color: scoreUp >= aPlus ? GREEN : TEAL_70 });
    if (showLvls) drawLevels(i, entryUp, slUp, tp1Up, tp2Up);
    signal(i, "BUY", { entry: entryUp, wait: expiry, sl: slUp, tp: [tp1Up, tp2Up], size: 0.5, exclusive: true, maxBars: 2000, label: "skor " + scoreUp + "/8 · sentuhan #" + touchNoUp });
  }
  if (sellSig) {
    label(i, high[i], "SELL " + scoreDn + "/8\\n#" + touchNoDn, { position: "above", color: scoreDn >= aPlus ? RED : MAROON_70 });
    if (showLvls) drawLevels(i, entryDn, slDn, tp1Dn, tp2Dn);
    signal(i, "SELL", { entry: entryDn, wait: expiry, sl: slDn, tp: [tp1Dn, tp2Dn], size: 0.5, exclusive: true, maxBars: 2000, label: "skor " + scoreDn + "/8 · sentuhan #" + touchNoDn });
  }
}`,
  },
];
