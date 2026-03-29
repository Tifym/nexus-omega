// ============================================================
// NEXUS OMEGA — signals.js (Serverless REST Edition)
// Compatible with Vercel serverless / Node.js 18+
// No WebSocket — uses REST seeds cached in module memory.
// ============================================================

// ============================================================
// SECTION 1 — CONSTANTS
// ============================================================

const SYMBOL     = 'BTCUSDT';
const SYMBOL_OKX = 'BTC-USDT-SWAP';
const MAX_KLINES = 300;

const MIN_CANDLES = {
  '15m': 60,
  '1h':  30,
  '5m':  20,
};

// ============================================================
// SECTION 2 — IN-MEMORY CACHE (persists across warm requests)
// ============================================================

const _cache = {
  klines15m:  [],
  klines1h:   [],
  klines5m:   [],
  bybit15m:   [],
  okx15m:     [],
  fearGreed:  { value: 50, label: 'Neutral', valid: false },
  funding:    { rate: 0,   valid: false },
  oi:         { changePercent: 0, valid: false },
  ls:         { ratio: 1.0, valid: false },
  hl:         { oi: 0, funding: 0, markPx: 0, valid: false },
  bookTick:   { bid: 0, ask: 0, spread: 0, valid: false },
  lastUpdated: 0,
  ttlMs: 60_000,  // refresh every 60s
};

// ============================================================
// SECTION 3 — KLINE HELPER
// ============================================================

function mergeKlines(existing, incoming) {
  const map = new Map();
  for (const k of existing) map.set(k.timestamp, k);
  for (const k of incoming) map.set(k.timestamp, k);
  const out = [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
  return out.slice(-MAX_KLINES);
}

// ============================================================
// SECTION 4 — REST DATA FETCHER
// ============================================================

async function fetchWithTimeout(url, ms = 4000, opts = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

const normBinance = c => ({
  timestamp: c[0], open: +c[1], high: +c[2], low: +c[3],
  close: +c[4], volume: +c[5], closed: true,
});

async function fetchKlines15m() {
  try {
    const d = await fetchWithTimeout(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=15m&limit=300`, 5000
    );
    return d.map(normBinance);
  } catch { return []; }
}

async function fetchKlines1h() {
  try {
    const d = await fetchWithTimeout(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=1h&limit=100`, 5000
    );
    return d.map(normBinance);
  } catch { return []; }
}

async function fetchKlines5m() {
  try {
    const d = await fetchWithTimeout(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=5m&limit=60`, 5000
    );
    return d.map(normBinance);
  } catch { return []; }
}

async function fetchBybit15m() {
  try {
    const d = await fetchWithTimeout(
      `https://api.bybit.com/v5/market/kline?category=linear&symbol=${SYMBOL}&interval=15&limit=300`, 5000
    );
    if (d.retCode !== 0) return [];
    return d.result.list.map(c => ({
      timestamp: parseInt(c[0]), open: +c[1], high: +c[2], low: +c[3],
      close: +c[4], volume: +c[5], closed: true,
    })).reverse();
  } catch { return []; }
}

async function fetchOKX15m() {
  try {
    const d = await fetchWithTimeout(
      `https://www.okx.com/api/v5/market/candles?instId=${SYMBOL_OKX}&bar=15m&limit=300`, 5000
    );
    if (d.code !== '0') return [];
    return d.data.map(c => ({
      timestamp: parseInt(c[0]), open: +c[1], high: +c[2], low: +c[3],
      close: +c[4], volume: +c[5], closed: true,
    })).reverse();
  } catch { return []; }
}

async function fetchFearGreed() {
  try {
    const d = await fetchWithTimeout('https://api.alternative.me/fng/?limit=1', 4000);
    return { value: +d.data[0].value, label: d.data[0].value_classification, valid: true };
  } catch { return _cache.fearGreed; }
}

async function fetchHyperliquid() {
  try {
    const res = await fetchWithTimeout('https://api.hyperliquid.xyz/info', 5000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    const [meta, ctxs] = res;
    const idx = meta.universe.findIndex(a => a.name === 'BTC');
    if (idx >= 0 && ctxs[idx]) {
      const ctx = ctxs[idx];
      return {
        oi:      parseFloat(ctx.openInterest),
        funding: parseFloat(ctx.funding),
        markPx:  parseFloat(ctx.markPx),
        valid:   true,
      };
    }
    return _cache.hl;
  } catch { return _cache.hl; }
}

async function fetchOI() {
  try {
    const d = await fetchWithTimeout(
      `https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=15m&limit=16`, 4000
    );
    const cur = +d[d.length - 1].sumOpenInterestValue;
    const old = +d[0].sumOpenInterestValue;
    return { changePercent: ((cur - old) / old) * 100, valid: true };
  } catch { return _cache.oi; }
}

async function fetchLS() {
  try {
    const d = await fetchWithTimeout(
      `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${SYMBOL}&period=5m&limit=1`, 4000
    );
    return { ratio: +d[0].longShortRatio, valid: true };
  } catch { return _cache.ls; }
}

async function fetchFunding() {
  try {
    const d = await fetchWithTimeout(
      `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${SYMBOL}`, 4000
    );
    return { rate: parseFloat(d.lastFundingRate), valid: true };
  } catch { return _cache.funding; }
}

async function fetchBookTicker() {
  try {
    const d = await fetchWithTimeout(
      `https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${SYMBOL}`, 4000
    );
    const bid = parseFloat(d.bidPrice), ask = parseFloat(d.askPrice);
    return { bid, ask, spread: ask - bid, valid: true };
  } catch { return _cache.bookTick; }
}

// ============================================================
// SECTION 5 — CACHE REFRESH LOGIC
// ============================================================

let _refreshPromise = null;

async function refreshCache() {
  // Parallel fetch everything
  const [k15, k1h, k5m, by15, ox15, fg, hl, oi, ls, funding, book] = await Promise.all([
    fetchKlines15m(),
    fetchKlines1h(),
    fetchKlines5m(),
    fetchBybit15m(),
    fetchOKX15m(),
    fetchFearGreed(),
    fetchHyperliquid(),
    fetchOI(),
    fetchLS(),
    fetchFunding(),
    fetchBookTicker(),
  ]);

  if (k15.length > 10) _cache.klines15m = mergeKlines(_cache.klines15m, k15);
  if (k1h.length > 5)  _cache.klines1h  = mergeKlines(_cache.klines1h,  k1h);
  if (k5m.length > 5)  _cache.klines5m  = mergeKlines(_cache.klines5m,  k5m);
  if (by15.length > 10) _cache.bybit15m  = mergeKlines(_cache.bybit15m,  by15);
  if (ox15.length > 10) _cache.okx15m    = mergeKlines(_cache.okx15m,    ox15);

  _cache.fearGreed = fg;
  _cache.hl        = hl;
  _cache.funding   = funding;
  _cache.bookTick  = book;

  // OI: prefer Hyperliquid delta if available
  if (hl.valid && _cache.hl.oi > 0) {
    const prev = _cache.oi.valid && _cache.oi._prevHLOI ? _cache.oi._prevHLOI : hl.oi;
    const pct  = prev > 0 ? ((hl.oi - prev) / prev) * 100 : 0;
    _cache.oi  = { changePercent: pct, valid: true, _prevHLOI: hl.oi };
  } else {
    _cache.oi = oi;
  }

  _cache.ls          = ls;
  _cache.lastUpdated = Date.now();

  console.log(`[signals] Cache refreshed — 15m:${_cache.klines15m.length} 1h:${_cache.klines1h.length} 5m:${_cache.klines5m.length}`);
}

async function ensureFreshCache() {
  const age = Date.now() - _cache.lastUpdated;
  if (age < _cache.ttlMs && _cache.klines15m.length >= MIN_CANDLES['15m']) return;

  // Deduplicate concurrent refreshes
  if (!_refreshPromise) {
    _refreshPromise = refreshCache().finally(() => { _refreshPromise = null; });
  }
  await _refreshPromise;
}

// ============================================================
// SECTION 6 — BUILD SNAPSHOT (same shape as old WSDataLayer)
// ============================================================

function buildSnapshot() {
  const b15  = _cache.klines15m;
  const by15 = _cache.bybit15m;
  const ok15 = _cache.okx15m;
  const b1h  = _cache.klines1h;
  const b5m  = _cache.klines5m;

  const livePrices = [b15, by15, ok15]
    .filter(k => k.length > 0)
    .map(k => k[k.length - 1].close);

  const consensusPrice = livePrices.length
    ? livePrices.reduce((a, b) => a + b, 0) / livePrices.length
    : 0;

  const anomaly = livePrices.length >= 3
    && (Math.max(...livePrices) - Math.min(...livePrices)) / Math.min(...livePrices) > 0.003;

  const lastTs = b15.length ? b15[b15.length - 1].timestamp : 0;
  const stale  = Date.now() - lastTs > 1_800_000;

  return {
    ready:    !stale && b15.length >= MIN_CANDLES['15m'],
    stale,
    anomaly,
    sources:  livePrices.length,
    price:    consensusPrice || (b15.length ? b15[b15.length - 1].close : 0),

    klines:   b15,
    klines1h: b1h,
    klines5m: b5m,

    funding:   _cache.funding,
    bookTick:  _cache.bookTick,
    liqData:   { longLiq: 0, shortLiq: 0, magnet: null, count: 0, valid: false },
    oi:        _cache.oi,
    ls:        _cache.ls,
    fearGreed: _cache.fearGreed,
    hl:        _cache.hl,
  };
}

// ============================================================
// SECTION 7 — INDICATORS (pure maths, no I/O)
// ============================================================

const Ind = {
  ema(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) ema = (data[i] - ema) * k + ema;
    return ema;
  },

  sma(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  },

  rsiArray(data, period = 14) {
    if (data.length < period + 1) return [50];
    let ag = 0, al = 0;
    for (let i = 1; i <= period; i++) {
      const d = data[i] - data[i - 1];
      if (d > 0) ag += d; else al -= d;
    }
    ag /= period; al /= period;
    const out = [al === 0 ? 100 : 100 - 100 / (1 + ag / al)];
    for (let i = period + 1; i < data.length; i++) {
      const d = data[i] - data[i - 1];
      ag = (ag * (period - 1) + Math.max(d, 0)) / period;
      al = (al * (period - 1) + Math.max(-d, 0)) / period;
      out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    }
    return out;
  },

  atr(klines, period = 14) {
    if (klines.length < period + 1) return 0;
    const trs = [];
    for (let i = 1; i < klines.length; i++) {
      const c = klines[i], p = klines[i - 1];
      trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    }
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
    return atr;
  },

  macd(data) {
    if (data.length < 26) return { macd: 0, signal: 0, hist: 0, histArray: [] };
    const k12 = 2/13, k26 = 2/27, k9 = 2/10;
    let e12 = data.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    let e26 = data.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
    const line = [];
    for (let i = 12; i < data.length; i++) {
      e12 = (data[i] - e12) * k12 + e12;
      if (i >= 26) { e26 = (data[i] - e26) * k26 + e26; line.push(e12 - e26); }
    }
    if (line.length < 9) return { macd: 0, signal: 0, hist: 0, histArray: [] };
    let sig = line.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
    const histArray = new Array(35).fill(0);
    for (let i = 9; i < line.length; i++) {
      sig = (line[i] - sig) * k9 + sig;
      histArray.push(line[i] - sig);
    }
    const last = line[line.length - 1];
    return { macd: last, signal: sig, hist: last - sig, histArray };
  },

  adx(klines, period = 14) {
    if (klines.length < period * 2) return 20;
    let sTR = 0, sPDM = 0, sMDM = 0;
    const dxs = [];
    for (let i = 1; i < klines.length; i++) {
      const c = klines[i], p = klines[i - 1];
      const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
      const up = c.high - p.high, dn = p.low - c.low;
      const pDM = up > dn && up > 0 ? up : 0;
      const mDM = dn > up && dn > 0 ? dn : 0;
      if (i <= period) {
        sTR += tr; sPDM += pDM; sMDM += mDM;
        if (i === period) {
          const pDI = (sPDM / sTR) * 100, mDI = (sMDM / sTR) * 100;
          dxs.push(pDI + mDI ? (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 : 0);
        }
      } else {
        sTR  = sTR  - sTR  / period + tr;
        sPDM = sPDM - sPDM / period + pDM;
        sMDM = sMDM - sMDM / period + mDM;
        const pDI = (sPDM / sTR) * 100, mDI = (sMDM / sTR) * 100;
        dxs.push(pDI + mDI ? (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 : 0);
      }
    }
    let adx = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dxs.length; i++) adx = (adx * (period - 1) + dxs[i]) / period;
    return adx;
  },

  bollingerBands(closes, period = 20) {
    if (closes.length < period) return { upper: 0, lower: 0, basis: 0, width: 0 };
    const s     = closes.slice(-period);
    const basis = s.reduce((a, b) => a + b, 0) / period;
    const sd    = Math.sqrt(s.reduce((a, b) => a + (b - basis) ** 2, 0) / period);
    const upper = basis + sd * 2, lower = basis - sd * 2;
    return { upper, lower, basis, width: basis > 0 ? (upper - lower) / basis : 0 };
  },

  stochRsi(closes, rsiP = 14, stochP = 14, kP = 3) {
    const rsis = this.rsiArray(closes, rsiP);
    if (rsis.length < stochP) return { k: 50, d: 50 };
    const stochs = [];
    for (let i = stochP - 1; i < rsis.length; i++) {
      const slice = rsis.slice(i - stochP + 1, i + 1);
      const lo = Math.min(...slice), hi = Math.max(...slice);
      stochs.push(hi === lo ? 50 : ((rsis[i] - lo) / (hi - lo)) * 100);
    }
    const k = stochs.length >= kP
      ? stochs.slice(-kP).reduce((a, b) => a + b, 0) / kP
      : stochs[stochs.length - 1];
    const d = stochs.length >= kP * 2
      ? stochs.slice(-(kP * 2), -kP).reduce((a, b) => a + b, 0) / kP
      : k;
    return { k, d };
  },

  cvd(klines) {
    let cum = 0;
    const deltas = [];
    for (const k of klines) {
      const range = k.high - k.low || 0.001;
      const bull  = (k.close - k.low) / range;
      cum += k.volume * (bull - 0.5) * 2;
      deltas.push(cum);
    }
    const n = deltas.length;
    if (n < 5) return { direction: 0, momentum: 0, raw: 0 };
    const recent = deltas[n - 1] - deltas[n - 5];
    const vol5   = klines.slice(-5).reduce((s, k) => s + k.volume, 0) || 1;
    return { direction: Math.sign(recent), momentum: recent / vol5, raw: deltas[n - 1] };
  },

  obImbalance(klines, n = 10) {
    const s = klines.slice(-n);
    let buy = 0, sell = 0;
    for (const k of s) {
      const range = k.high - k.low || 0.001;
      buy  += ((Math.min(k.open, k.close) - k.low)  / range) * k.volume;
      sell += ((k.high - Math.max(k.open, k.close)) / range) * k.volume;
    }
    const total = buy + sell || 1;
    return { ratio: buy / total, bullish: buy > sell };
  },

  divergence(prices, indicator, lookback = 30) {
    if (prices.length < lookback || indicator.length < lookback)
      return { type: 'NONE', score: 0 };
    const p   = prices.slice(-lookback);
    const ind = indicator.slice(-lookback);

    const swings = (arr, isLow) => {
      const out = [];
      for (let i = 2; i < arr.length - 2; i++) {
        const v = arr[i];
        const ok = isLow
          ? v < arr[i-1] && v < arr[i-2] && v < arr[i+1] && v < arr[i+2]
          : v > arr[i-1] && v > arr[i-2] && v > arr[i+1] && v > arr[i+2];
        if (ok) out.push({ price: p[i], val: ind[i] });
      }
      return out;
    };

    const lows  = swings(p, true);
    const highs = swings(p, false);

    if (lows.length >= 2) {
      const [prev, rec] = [lows[lows.length - 2], lows[lows.length - 1]];
      if (rec.price < prev.price && rec.val > prev.val)
        return { type: 'BULLISH', score: 25 };
    }
    if (highs.length >= 2) {
      const [prev, rec] = [highs[highs.length - 2], highs[highs.length - 1]];
      if (rec.price > prev.price && rec.val < prev.val)
        return { type: 'BEARISH', score: -25 };
    }
    return { type: 'NONE', score: 0 };
  },

  volumeProfile(klines, lookback = 100, atr = 100) {
    const data = klines.slice(-lookback);
    const bs   = Math.max(50, Math.round(atr * 0.6));
    const bkts = {};
    for (const k of data) {
      const tp = (k.high + k.low + k.close) / 3;
      const b  = Math.round(tp / bs) * bs;
      bkts[b]  = (bkts[b] || 0) + k.volume;
    }
    let poc = 0, maxV = 0;
    for (const [p, v] of Object.entries(bkts))
      if (v > maxV) { maxV = v; poc = +p; }
    return { poc, vah: poc + atr * 1.5, val: poc - atr * 1.5 };
  },
};

// ============================================================
// SECTION 8 — REGIME + MTF
// ============================================================

function detectRegime(adx, atr, bbWidth, price) {
  if (adx > 30)                    return 'STRONG_TREND';
  if (adx > 20 || bbWidth > 0.04)  return 'TRENDING';
  if (adx < 15 && bbWidth < 0.02)  return 'TIGHT_RANGE';
  if (atr > price * 0.007)         return 'BREAKOUT_IMMINENT';
  return 'CHOP';
}

function htfBias(klines1h) {
  if (!klines1h || klines1h.length < 30) return { bias: 'NEUTRAL', adx: 0 };
  const c   = klines1h.map(k => k.close);
  const e20 = Ind.ema(c, 20);
  const e50 = Ind.ema(c, 50);
  const adx = Ind.adx(klines1h);
  const px  = c[c.length - 1];
  if (e20 > e50 && px > e20) return { bias: 'BULL', adx };
  if (e20 < e50 && px < e20) return { bias: 'BEAR', adx };
  return { bias: 'NEUTRAL', adx };
}

function microEntry(klines5m) {
  if (!klines5m || klines5m.length < 20) return { confirm: false, direction: 0 };
  const c   = klines5m.map(k => k.close);
  const rsi = Ind.rsiArray(c);
  const r   = rsi[rsi.length - 1];
  const e8  = Ind.ema(c, 8);
  const e21 = Ind.ema(c, 21);
  const px  = c[c.length - 1];
  const cvd = Ind.cvd(klines5m);

  if (r < 45 && e8 > e21 && px > e8 && cvd.direction > 0)
    return { confirm: true, direction:  1 };
  if (r > 55 && e8 < e21 && px < e8 && cvd.direction < 0)
    return { confirm: true, direction: -1 };
  return { confirm: false, direction: 0 };
}

// ============================================================
// SECTION 9 — SCORING ENGINE (18 factors)
// ============================================================

function computeScore(snap, derived) {
  const {
    fundingData, oiData, lsData, liqData, fearGreed, hlData,
    relativeVol, currentPrice, anomalyFlag, regime,
    htf, micro, closes, klines, rsiArray, macd, atr, bb, volProfile,
  } = derived;

  let score = 0;
  const reasons   = [];
  const riskFlags = [];

  if (anomalyFlag)           riskFlags.push('Exchange Price Divergence >0.3%');
  if (snap.sources === 1)    riskFlags.push('Single Exchange Only');
  if (snap.bookTick?.valid && snap.bookTick.spread > atr * 0.05)
                             riskFlags.push(`Wide Spread (${snap.bookTick.spread.toFixed(1)})`);

  const rsi = rsiArray[rsiArray.length - 1];

  // ── 1. Macro EMA trend alignment ±30 ─────────────────────
  const e20  = Ind.ema(closes, 20);
  const e50  = Ind.ema(closes, 50);
  const e200 = Ind.ema(closes, 200);
  if (e20 > e50 && e50 > e200 && currentPrice > e200) {
    score += 30; reasons.push('Bull Alignment EMA 20>50>200');
  } else if (e20 < e50 && e50 < e200 && currentPrice < e200) {
    score -= 30; reasons.push('Bear Alignment EMA 20<50<200');
  }

  // ── 2. HTF 1h bias multiplier ─────────────────────────────
  if (htf.bias === 'BULL')    score *= 1.10;
  else if (htf.bias === 'BEAR') score *= 1.10;
  else score *= 0.85;

  // ── 3. RSI fractal divergence ±25 ────────────────────────
  const rsiDiv = Ind.divergence(closes, rsiArray, 20);
  if (rsiDiv.type !== 'NONE') {
    score += rsiDiv.score;
    reasons.push(rsiDiv.type === 'BULLISH' ? 'Bullish RSI Divergence' : 'Bearish RSI Divergence');
  }

  // ── 4. MACD hist fractal divergence ±25 ──────────────────
  const macdDiv = Ind.divergence(closes, macd.histArray, 20);
  if (macdDiv.type !== 'NONE') {
    score += macdDiv.score;
    reasons.push(macdDiv.type === 'BULLISH' ? 'Bullish MACD Divergence' : 'Bearish MACD Divergence');
  }

  // ── 5. StochRSI crossover ±15 ─────────────────────────────
  const stoch = Ind.stochRsi(closes);
  if (stoch.k < 20 && stoch.d < 20 && stoch.k > stoch.d) {
    score += 15; reasons.push(`StochRSI Oversold Cross-Up (${stoch.k.toFixed(0)})`);
  } else if (stoch.k > 80 && stoch.d > 80 && stoch.k < stoch.d) {
    score -= 15; reasons.push(`StochRSI Overbought Cross-Down (${stoch.k.toFixed(0)})`);
  }

  // ── 6. CVD momentum ±10 ──────────────────────────────────
  const cvd = Ind.cvd(klines);
  if (cvd.momentum > 0.15)       { score += 10; reasons.push(`Bull CVD Momentum +${(cvd.momentum*100).toFixed(0)}%`); }
  else if (cvd.momentum < -0.15) { score -= 10; reasons.push(`Bear CVD Momentum ${(cvd.momentum*100).toFixed(0)}%`); }

  // ── 7. Order-book imbalance ±8 ────────────────────────────
  const obi = Ind.obImbalance(klines);
  if (obi.ratio > 0.65)      { score += 8; reasons.push(`Buy OB Imbalance ${(obi.ratio*100).toFixed(0)}%`); }
  else if (obi.ratio < 0.35) { score -= 8; reasons.push(`Sell OB Imbalance ${(obi.ratio*100).toFixed(0)}%`); }

  // ── 8. Live bid/ask pressure ±5 ─────────────────────────
  if (snap.bookTick?.valid) {
    const { bid, ask } = snap.bookTick;
    const midpoint = (bid + ask) / 2;
    if (currentPrice > midpoint * 1.0001) { score += 5; reasons.push('Price Above Mid — Buy Pressure'); }
    if (currentPrice < midpoint * 0.9999) { score -= 5; reasons.push('Price Below Mid — Sell Pressure'); }
  }

  // ── 9. Funding rate ──────────────────────────────────────
  const fr = fundingData.valid ? fundingData.rate : (hlData.valid ? hlData.funding : null);
  if (fr !== null) {
    if (fr > 0.0005)    { score -= 10; reasons.push(`Funding Overheated (${(fr*100).toFixed(4)}%)`); }
    else if (fr < -0.0001) { score += 15; reasons.push(`Funding Negative (${(fr*100).toFixed(4)}%)`); }
  }

  // ── 10. Open Interest delta ±15 ──────────────────────────
  if (oiData.valid) {
    if (oiData.changePercent > 0.5 && rsi > 50)  { score += 15; reasons.push('OI Rising: Longs Piling In'); }
    if (oiData.changePercent < -0.5 && rsi > 50) { score -= 15; reasons.push('OI Falling: Squeeze Risk'); }
    if (oiData.changePercent > 0.5 && rsi < 50)  { score -= 15; reasons.push('OI Rising: Shorts Piling In'); }
  }

  // ── 11. Long/Short ratio ±15 ─────────────────────────────
  if (lsData.valid) {
    if (lsData.ratio > 2.0) { score -= 15; reasons.push('Longs Crowded (L/S High)'); }
    if (lsData.ratio < 0.8) { score += 15; reasons.push('Shorts Crowded (L/S Low)'); }
  }

  // ── 12. Liquidation exhaustion ±20 ───────────────────────
  if (liqData.valid && liqData.longLiq > 0 && liqData.shortLiq > 0) {
    if (liqData.longLiq > liqData.shortLiq * 2 && rsi < 45) {
      score += 20; reasons.push('Long Liq Exhaustion — Bottom Signal');
    } else if (liqData.shortLiq > liqData.longLiq * 2 && rsi > 55) {
      score -= 20; reasons.push('Short Liq Exhaustion — Top Signal');
    }
  }

  // ── 13. Fear & Greed contrarian ±15 ──────────────────────
  if (fearGreed.valid) {
    if (fearGreed.value <= 20) { score += 15; reasons.push(`Extreme Fear ${fearGreed.value} — Contrarian Long`); }
    if (fearGreed.value >= 80) { score -= 15; reasons.push(`Extreme Greed ${fearGreed.value} — Contrarian Short`); }
  }

  // ── 14. Volume surge ±10 ─────────────────────────────────
  if (relativeVol > 3.0) {
    const last = closes[closes.length - 1], prev = closes[closes.length - 2];
    if (last > prev) { score += 10; reasons.push(`Extreme Bull Volume (${relativeVol.toFixed(1)}x)`); }
    else             { score -= 10; reasons.push(`Extreme Bear Volume (${relativeVol.toFixed(1)}x)`); }
  }

  // ── 15. Volume profile breakout ±15 ──────────────────────
  if (currentPrice > volProfile.vah && relativeVol > 1.2) {
    score += 15; reasons.push('VAH Breakout w/ Volume');
  } else if (currentPrice < volProfile.val && relativeVol > 1.2) {
    score -= 15; reasons.push('VAL Breakdown w/ Volume');
  }

  // ── 16. BB breakout (BREAKOUT_IMMINENT regime only) ±20 ──
  if (regime === 'BREAKOUT_IMMINENT') {
    if (currentPrice > bb.upper && relativeVol > 1.5) { score += 20; reasons.push('BB Bull Breakout'); }
    if (currentPrice < bb.lower && relativeVol > 1.5) { score -= 20; reasons.push('BB Bear Breakdown'); }
  }

  // ── 17. 5m micro-entry confirmation ±12 ──────────────────
  if (micro.confirm) {
    if (micro.direction > 0 && score >= 0) { score += 12; reasons.push('5m Micro LONG Confirmed'); }
    if (micro.direction < 0 && score <= 0) { score += 12; reasons.push('5m Micro SHORT Confirmed'); }
    if (micro.direction > 0 && score < 0)  { riskFlags.push('5m Micro Disagrees — Caution'); score -= 8; }
    if (micro.direction < 0 && score > 0)  { riskFlags.push('5m Micro Disagrees — Caution'); score -= 8; }
  }

  // ── 18. Tight Range RSI extreme override ─────────────────
  if (regime === 'TIGHT_RANGE') {
    if (rsi < 30) { score += 40; reasons.push('Tight Range RSI Extreme Oversold'); }
    else if (rsi > 70) { score -= 40; reasons.push('Tight Range RSI Extreme Overbought'); }
    else score = 0;
  }

  // ── Post-score multipliers ────────────────────────────────
  if (anomalyFlag)        score *= 0.60;
  if (relativeVol < 0.6)  { score *= 0.50; riskFlags.push('Low Volume — Fakeout Risk'); }
  if (regime === 'CHOP')  { score *= 0.80; riskFlags.push('Choppy Regime'); }
  if (htf.bias === 'NEUTRAL') score *= 0.85;

  return { score: Math.round(score), reasons: reasons.slice(0, 10), riskFlags };
}

// ============================================================
// SECTION 10 — EXECUTION GATE & TARGETS
// ============================================================

function executionGate(signal, confidence, riskFlags) {
  if (signal === 'NEUTRAL') return { approved: false, multiplier: 0 };
  if (confidence >= 85) return { approved: true, multiplier: 1.00 };
  if (confidence >= 70) return { approved: true, multiplier: 0.75 };
  if (confidence >= 55) return { approved: true, multiplier: 0.50 };
  riskFlags.push(`${signal} Rejected — Confidence ${confidence.toFixed(0)}% < 55%`);
  return { approved: false, multiplier: 0 };
}

function buildTargets(signal, price, atr, atrMult, liqMagnet) {
  const A = atr * atrMult;
  if (signal === 'LONG') {
    let sl = price - A;
    if (liqMagnet && liqMagnet < price && (price - liqMagnet) < atr) sl = liqMagnet * 0.999;
    return { stopLoss: +sl.toFixed(2), tp1: +(price + A).toFixed(2), tp2: +(price + A * 2).toFixed(2), tp3: +(price + A * 3.5).toFixed(2) };
  }
  if (signal === 'SHORT') {
    let sl = price + A;
    if (liqMagnet && liqMagnet > price && (liqMagnet - price) < atr) sl = liqMagnet * 1.001;
    return { stopLoss: +sl.toFixed(2), tp1: +(price - A).toFixed(2), tp2: +(price - A * 2).toFixed(2), tp3: +(price - A * 3.5).toFixed(2) };
  }
  return { stopLoss: price, tp1: price, tp2: price, tp3: price };
}

// ============================================================
// SECTION 11 — SIGNAL ENGINE (public API)
// ============================================================

class SignalEngine {
  // ── Main entry point — async, fetches fresh data then computes
  async generateSignal() {
    await ensureFreshCache();
    const snap = buildSnapshot();
    return this._compute(snap);
  }

  _compute(snap) {
    if (!snap.ready) {
      return this._neutral(
        snap.stale ? 'Stale candles >30m' : 'Warming up — insufficient candle history'
      );
    }

    const { klines, klines1h, klines5m, price: currentPrice, anomaly } = snap;
    const closes  = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume);

    const atr    = Ind.atr(klines);
    const adx    = Ind.adx(klines);
    const bb     = Ind.bollingerBands(closes);
    const regime = detectRegime(adx, atr, bb.width, currentPrice);

    let reqScore = 50, atrMult = 1.5;
    if (regime === 'TIGHT_RANGE')       { reqScore = 65; atrMult = 1.0; }
    if (regime === 'BREAKOUT_IMMINENT') { reqScore = 45; atrMult = 2.5; }
    if (regime === 'STRONG_TREND')      { reqScore = 48; atrMult = 1.8; }

    const rsiArray   = Ind.rsiArray(closes);
    const rsi        = rsiArray[rsiArray.length - 1];
    const macd       = Ind.macd(closes);
    const volProfile = Ind.volumeProfile(klines, 100, atr);
    const volSMA     = Ind.sma(volumes.slice(0, -1), 20);
    const relativeVol = Math.max(volumes[volumes.length - 1], volumes[volumes.length - 2]) / (volSMA || 1);

    const htf   = htfBias(klines1h);
    const micro = microEntry(klines5m);

    const derived = {
      fundingData:  snap.funding,
      oiData:       snap.oi,
      lsData:       snap.ls,
      liqData:      snap.liqData,
      fearGreed:    snap.fearGreed,
      hlData:       snap.hl,
      relativeVol, currentPrice,
      anomalyFlag:  anomaly,
      regime, htf, micro,
      closes, klines, rsiArray, macd, atr, bb, volProfile,
    };

    const { score: rawScore, reasons, riskFlags } = computeScore(snap, derived);

    let signal = 'NEUTRAL';
    if (rawScore >=  reqScore) signal = 'LONG';
    if (rawScore <= -reqScore) signal = 'SHORT';

    let confidence = (Math.abs(rawScore) * 0.5 + reasons.length * 2.5) *
      (snap.sources >= 3 ? 1.0 : snap.sources === 2 ? 0.90 : 0.80);
    if (!anomaly && snap.sources >= 2) confidence *= 1.15;
    if (htf.bias !== 'NEUTRAL')        confidence *= 1.10;
    if (micro.confirm)                 confidence *= 1.08;
    confidence = Math.min(97, Math.max(0, Math.round(confidence)));

    const gate = executionGate(signal, confidence, riskFlags);
    if (!gate.approved) { signal = 'NEUTRAL'; confidence = Math.max(0, confidence - 30); }

    const targets = buildTargets(signal, currentPrice, atr, atrMult, snap.liqData.magnet);

    const stoch = Ind.stochRsi(closes);
    const cvd   = Ind.cvd(klines);
    const obi   = Ind.obImbalance(klines);

    return {
      signal,
      confidence,
      score:    rawScore,
      regime,
      marginMultiplier: gate.multiplier,

      microEntry: {
        confirmed:  micro.confirm,
        direction:  micro.direction > 0 ? 'LONG' : micro.direction < 0 ? 'SHORT' : 'WAIT',
        note: micro.confirm
          ? `5m confirms ${micro.direction > 0 ? 'long' : 'short'} — ok to enter`
          : 'Await 5m candle confirmation before entering',
      },

      htfContext: {
        bias:    htf.bias,
        adx1h:   htf.adx.toFixed(1),
        aligned: (signal === 'LONG' && htf.bias === 'BULL') ||
                 (signal === 'SHORT' && htf.bias === 'BEAR'),
        note:    htf.bias === 'NEUTRAL'
          ? 'No 1h trend — reduce size'
          : `1h is ${htf.bias === 'BULL' ? 'bullish' : 'bearish'}, ADX ${htf.adx.toFixed(0)}`,
      },

      targets: {
        entry:    +currentPrice.toFixed(2),
        stopLoss: targets.stopLoss,
        tp1:      targets.tp1,
        tp2:      targets.tp2,
        tp3:      targets.tp3,
        atr:      +atr.toFixed(2),
        liqMagnet: snap.liqData.magnet || null,
      },

      marketStructure: {
        fundingRate:    snap.funding.valid   ? +snap.funding.rate.toFixed(6) : null,
        hlFunding:      snap.hl.valid        ? +snap.hl.funding.toFixed(6)   : null,
        oiChange15m:    snap.oi.valid        ? +snap.oi.changePercent.toFixed(2) : null,
        longShortRatio: snap.ls.valid        ? +snap.ls.ratio.toFixed(2)     : null,
        fearGreedIndex: snap.fearGreed.valid ? snap.fearGreed.value          : null,
        fearGreedLabel: snap.fearGreed.valid ? snap.fearGreed.label          : null,
        liqLongBTC:     0,
        liqShortBTC:    0,
        poc:            +volProfile.poc.toFixed(2),
        vah:            +volProfile.vah.toFixed(2),
        val:            +volProfile.val.toFixed(2),
        bid:            snap.bookTick.valid ? +snap.bookTick.bid.toFixed(2)  : null,
        ask:            snap.bookTick.valid ? +snap.bookTick.ask.toFixed(2)  : null,
        spread:         snap.bookTick.valid ? +snap.bookTick.spread.toFixed(2): null,
      },

      indicators: {
        price:       +currentPrice.toFixed(2),
        rsi:         +rsi.toFixed(2),
        stochK:      +stoch.k.toFixed(2),
        stochD:      +stoch.d.toFixed(2),
        macdHist:    +macd.hist.toFixed(5),
        adx:         +adx.toFixed(2),
        atr:         +atr.toFixed(2),
        bbWidth:     +bb.width.toFixed(4),
        ema20:       +Ind.ema(closes, 20).toFixed(2),
        ema50:       +Ind.ema(closes, 50).toFixed(2),
        ema200:      +Ind.ema(closes, 200).toFixed(2),
        relativeVol: +relativeVol.toFixed(2),
        cvdDir:      cvd.direction > 0 ? 'BULL' : cvd.direction < 0 ? 'BEAR' : 'FLAT',
        cvdMomentum: +cvd.momentum.toFixed(3),
        obiRatio:    +obi.ratio.toFixed(2),
        volatility:  +((atr / currentPrice) * 100).toFixed(2),
      },

      dataQuality: {
        sources:      snap.sources,
        anomaly:      anomaly,
        cacheAgeMs:   Date.now() - _cache.lastUpdated,
        candlesReady: klines.length,
        stale:        snap.stale,
      },
      reasons,
      riskFlags,
      timestamp: Date.now(),
    };
  }

  _neutral(reason) {
    return {
      signal: 'NEUTRAL', confidence: 0, score: 0, regime: 'UNKNOWN', marginMultiplier: 0,
      microEntry:      { confirmed: false, direction: 'WAIT', note: reason },
      htfContext:      { bias: 'NEUTRAL', adx1h: '0', aligned: false, note: reason },
      targets:         { entry: 0, stopLoss: 0, tp1: 0, tp2: 0, tp3: 0, atr: 0, liqMagnet: null },
      marketStructure: {},
      indicators:      {},
      dataQuality:     { sources: 0, anomaly: false, cacheAgeMs: 0, candlesReady: 0, stale: false },
      reasons: [], riskFlags: [reason], timestamp: Date.now(),
    };
  }
}

// ============================================================
// SECTION 12 — EXPORTS
// ============================================================

// Named `signalEngine` so existing status.js + evaluate.js imports work with zero changes
export const signalEngine = new SignalEngine();

// Also export as `engine` for backwards compatibility
export const engine = signalEngine;
