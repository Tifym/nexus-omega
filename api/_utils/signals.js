// ============================================================
// ULTIMATE_SIGNAL_V1.js
// BTC Scalper Signal Engine — 2026 Edition
// Combines SignalEngineV5_2 + Nexus Omega war-room data
// Targets: 15m primary, 1h context gate, 5m micro-entry
// ============================================================

// ─── ULTRA-FAST IN-MEMORY CACHE ──────────────────────────────
const _cache = {
  oi:       { data: null, ts: 0, ttl: 300_000 },
  ls:       { data: null, ts: 0, ttl: 300_000 },
  liq:      { data: null, ts: 0, ttl: 120_000 },
  funding:  { data: null, ts: 0, ttl: 180_000 },
  news:     { data: null, ts: 0, ttl: 600_000 },
  whale:    { data: null, ts: 0, ttl: 120_000 },
  fear:     { data: null, ts: 0, ttl: 600_000 },
};

function cached(key) {
  const c = _cache[key];
  return (c.data !== null && Date.now() - c.ts < c.ttl) ? c.data : null;
}

function setCache(key, data) {
  _cache[key].data = data;
  _cache[key].ts = Date.now();
  return data;
}

// ─── CIRCUIT BREAKER ─────────────────────────────────────────
class CircuitBreaker {
  constructor(threshold = 3, cooldownMs = 60_000) {
    this.failures = 0;
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.cooldownUntil = 0;
  }
  isOpen() {
    if (Date.now() < this.cooldownUntil) return true;
    if (this.failures >= this.threshold) {
      this.cooldownUntil = Date.now() + this.cooldownMs;
      this.failures = 0;
      return true;
    }
    return false;
  }
  fail() { this.failures++; }
  succeed() { this.failures = 0; }
}

// ─── SAFE FETCH WITH TIMEOUT ─────────────────────────────────
async function safeFetch(url, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// ============================================================
// SECTION 1 — CORE MATH INDICATORS
// ============================================================

class Indicators {
  static ema(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) ema = (data[i] - ema) * k + ema;
    return ema;
  }

  static sma(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  // Returns full RSI array — needed for divergence detection
  static rsiArray(data, period = 14) {
    if (data.length < period + 1) return [50];
    const rsis = [];
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const d = data[i] - data[i - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    let ag = gains / period, al = losses / period;
    rsis.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    for (let i = period + 1; i < data.length; i++) {
      const d = data[i] - data[i - 1];
      ag = (ag * (period - 1) + Math.max(d, 0)) / period;
      al = (al * (period - 1) + Math.max(-d, 0)) / period;
      rsis.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    }
    return rsis;
  }

  static atr(klines, period = 14) {
    if (klines.length < period + 1) return 0;
    let trs = [];
    for (let i = 1; i < klines.length; i++) {
      const c = klines[i], p = klines[i - 1];
      trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    }
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
    return atr;
  }

  // Returns { macd, signal, hist, histArray } — histArray aligns with closes
  static macd(data) {
    if (data.length < 26) return { macd: 0, signal: 0, hist: 0, histArray: [] };
    const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
    let e12 = data.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    let e26 = data.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
    const macdLine = [];
    for (let i = 12; i < data.length; i++) {
      e12 = (data[i] - e12) * k12 + e12;
      if (i >= 26) { e26 = (data[i] - e26) * k26 + e26; macdLine.push(e12 - e26); }
    }
    if (macdLine.length < 9) return { macd: 0, signal: 0, hist: 0, histArray: [] };
    let sig = macdLine.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
    const histArray = new Array(35).fill(0);
    for (let i = 9; i < macdLine.length; i++) {
      sig = (macdLine[i] - sig) * k9 + sig;
      histArray.push(macdLine[i] - sig);
    }
    const last = macdLine[macdLine.length - 1];
    return { macd: last, signal: sig, hist: last - sig, histArray };
  }

  static adx(klines, period = 14) {
    if (klines.length < period * 2) return 20;
    let sTR = 0, sPDM = 0, sMDM = 0, dxs = [];
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
          dxs.push(pDI + mDI !== 0 ? (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 : 0);
        }
      } else {
        sTR  = sTR  - sTR  / period + tr;
        sPDM = sPDM - sPDM / period + pDM;
        sMDM = sMDM - sMDM / period + mDM;
        const pDI = (sPDM / sTR) * 100, mDI = (sMDM / sTR) * 100;
        dxs.push(pDI + mDI !== 0 ? (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 : 0);
      }
    }
    let adx = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dxs.length; i++) adx = (adx * (period - 1) + dxs[i]) / period;
    return adx;
  }

  static bollingerBands(closes, period = 20) {
    if (closes.length < period) return { upper: 0, lower: 0, basis: 0, width: 0 };
    const s = closes.slice(-period);
    const basis = s.reduce((a, b) => a + b, 0) / period;
    const variance = s.reduce((a, b) => a + (b - basis) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const upper = basis + sd * 2, lower = basis - sd * 2;
    return { upper, lower, basis, width: basis > 0 ? (upper - lower) / basis : 0 };
  }

  // Stochastic RSI — provides faster overbought/oversold than plain RSI
  static stochRsi(closes, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3) {
    const rsis = this.rsiArray(closes, rsiPeriod);
    if (rsis.length < stochPeriod) return { k: 50, d: 50 };
    const stochs = [];
    for (let i = stochPeriod - 1; i < rsis.length; i++) {
      const slice = rsis.slice(i - stochPeriod + 1, i + 1);
      const lo = Math.min(...slice), hi = Math.max(...slice);
      stochs.push(hi === lo ? 50 : ((rsis[i] - lo) / (hi - lo)) * 100);
    }
    const k = stochs.length >= kPeriod
      ? stochs.slice(-kPeriod).reduce((a, b) => a + b, 0) / kPeriod
      : stochs[stochs.length - 1];
    const d = stochs.length >= kPeriod * 2
      ? stochs.slice(-kPeriod * 2, -kPeriod).reduce((a, b) => a + b, 0) / kPeriod
      : k;
    return { k, d };
  }

  // Cumulative Volume Delta proxy (estimate buy/sell pressure per candle)
  static cvdDelta(klines) {
    let cumDelta = 0;
    const deltas = [];
    for (const k of klines) {
      // Estimate: if close > open = buy dominant; weight by candle range
      const range = k.high - k.low || 0.001;
      const bullShare = range > 0 ? (k.close - k.low) / range : 0.5;
      const delta = k.volume * (bullShare - 0.5) * 2; // -vol to +vol
      cumDelta += delta;
      deltas.push(cumDelta);
    }
    // Return recent momentum: direction of CVD over last 5 candles
    const n = deltas.length;
    if (n < 5) return { direction: 0, momentum: 0 };
    const recent = deltas[n - 1] - deltas[n - 5];
    const norm = klines.slice(-5).reduce((s, k) => s + k.volume, 0) || 1;
    return { direction: Math.sign(recent), momentum: recent / norm };
  }

  // Order-book imbalance proxy via bid/ask pressure from candle tails
  static obImbalance(klines, lookback = 10) {
    const slice = klines.slice(-lookback);
    let buyPressure = 0, sellPressure = 0;
    for (const k of slice) {
      const range = k.high - k.low || 0.001;
      const lowerWick = (Math.min(k.open, k.close) - k.low) / range;
      const upperWick = (k.high - Math.max(k.open, k.close)) / range;
      buyPressure  += lowerWick * k.volume; // long lower wick = buyers absorbed sellers
      sellPressure += upperWick * k.volume; // long upper wick = sellers absorbed buyers
    }
    const total = buyPressure + sellPressure || 1;
    return { ratio: buyPressure / total, bullish: buyPressure > sellPressure };
  }

  // Swing-point fractal divergence (true highs/lows, not just local)
  static divergence(prices, indicator, lookback = 30) {
    if (prices.length < lookback || indicator.length < lookback) return { type: 'NONE', score: 0 };
    const p = prices.slice(-lookback), ind = indicator.slice(-lookback);
    const swings = (arr, isLow) => {
      const result = [];
      for (let i = 2; i < arr.length - 2; i++) {
        const center = arr[i];
        if (isLow
          ? center < arr[i-1] && center < arr[i-2] && center < arr[i+1] && center < arr[i+2]
          : center > arr[i-1] && center > arr[i-2] && center > arr[i+1] && center > arr[i+2])
          result.push({ idx: i, price: p[i], val: ind[i] });
      }
      return result;
    };
    const lows  = swings(p, true);
    const highs = swings(p, false);
    if (lows.length >= 2) {
      const [prev, rec] = [lows[lows.length-2], lows[lows.length-1]];
      if (rec.price < prev.price && rec.val > prev.val) return { type: 'BULLISH', score: 25 };
    }
    if (highs.length >= 2) {
      const [prev, rec] = [highs[highs.length-2], highs[highs.length-1]];
      if (rec.price > prev.price && rec.val < prev.val) return { type: 'BEARISH', score: -25 };
    }
    return { type: 'NONE', score: 0 };
  }

  // Volume-weighted price profile (POC / VAH / VAL)
  static volumeProfile(klines, lookback = 100, atr = 100) {
    if (klines.length < 2) return { poc: 0, vah: 0, val: 0 };
    const data = klines.slice(-lookback);
    const bucketSize = Math.max(50, Math.round(atr * 0.6));
    const buckets = {};
    for (const k of data) {
      const tp = (k.high + k.low + k.close) / 3;
      const b = Math.round(tp / bucketSize) * bucketSize;
      buckets[b] = (buckets[b] || 0) + k.volume;
    }
    let poc = 0, maxVol = 0;
    for (const [p, v] of Object.entries(buckets))
      if (v > maxVol) { maxVol = v; poc = parseFloat(p); }
    return { poc, vah: poc + atr * 1.5, val: poc - atr * 1.5 };
  }
}

// ============================================================
// SECTION 2 — MARKET REGIME
// ============================================================

function detectRegime(adx, atr, bbWidth, price) {
  if (adx > 30) return 'STRONG_TREND';
  if (adx > 20 || bbWidth > 0.04) return 'TRENDING';
  if (adx < 15 && bbWidth < 0.02) return 'TIGHT_RANGE';
  if (atr > price * 0.007) return 'BREAKOUT_IMMINENT';
  return 'CHOP';
}

// ============================================================
// SECTION 3 — EXCHANGE DATA FETCHERS (Multi-source consensus)
// ============================================================

async function fetchBinance(interval = '15m', limit = 300) {
  const d = await safeFetch(
    `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`
  );
  const klines = d.map(c => ({
    timestamp: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5]
  }));
  return { klines, price: klines[klines.length - 1].close, source: 'Binance', weight: 1.0 };
}

async function fetchBybit(interval = '15', limit = 300) {
  const d = await safeFetch(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=${interval}&limit=${limit}`
  );
  if (d.retCode !== 0) throw new Error('Bybit error');
  const klines = d.result.list
    .map(c => ({ timestamp: +c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] }))
    .reverse();
  return { klines, price: klines[klines.length - 1].close, source: 'Bybit', weight: 0.95 };
}

async function fetchOKX(interval = '15m', limit = 300) {
  const d = await safeFetch(
    `https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=${interval}&limit=${limit}`
  );
  if (d.code !== '0') throw new Error('OKX error');
  const klines = d.data
    .map(c => ({ timestamp: +c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] }))
    .reverse();
  return { klines, price: klines[klines.length - 1].close, source: 'OKX', weight: 0.90 };
}

// ── 1-hour context for multi-timeframe gate ───────────────────
async function fetchHigherTF() {
  try {
    const d = await safeFetch(
      'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=100'
    );
    return d.map(c => ({
      timestamp: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5]
    }));
  } catch { return null; }
}

// ── 5-minute micro-entry context ─────────────────────────────
async function fetchMicroTF() {
  try {
    const d = await safeFetch(
      'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=60'
    );
    return d.map(c => ({
      timestamp: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5]
    }));
  } catch { return null; }
}

// ============================================================
// SECTION 4 — FLOW DATA FETCHERS
// ============================================================

async function fetchFunding() {
  const hit = cached('funding');
  if (hit) return hit;
  try {
    const d = await safeFetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', 3000);
    return setCache('funding', { rate: +d.lastFundingRate, valid: true });
  } catch {
    try {
      const d = await safeFetch('https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1');
      return setCache('funding', { rate: +d.result.list[0].fundingRate, valid: true });
    } catch { return { rate: 0, valid: false }; }
  }
}

async function fetchOI() {
  const hit = cached('oi');
  if (hit) return hit;
  try {
    const d = await safeFetch(
      'https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=15m&limit=16', 3000
    );
    const cur = +d[d.length - 1].sumOpenInterestValue;
    const old = +d[0].sumOpenInterestValue;
    return setCache('oi', { changePercent: ((cur - old) / old) * 100, valid: true });
  } catch {
    try {
      const d = await safeFetch(
        'https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=15min&limit=16'
      );
      const list = d.result.list;
      const cur = +list[list.length - 1].openInterest;
      const old = +list[0].openInterest;
      return setCache('oi', { changePercent: ((cur - old) / old) * 100, valid: true });
    } catch { return _cache.oi.data || { changePercent: 0, valid: false }; }
  }
}

async function fetchLSRatio() {
  const hit = cached('ls');
  if (hit) return hit;
  try {
    const d = await safeFetch(
      'https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=5m', 3000
    );
    return setCache('ls', { ratio: +d.data[0][1], valid: true });
  } catch {
    try {
      const d = await safeFetch(
        'https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1'
      );
      return setCache('ls', { ratio: +d[0].longShortRatio, valid: true });
    } catch { return _cache.ls.data || { ratio: 1.0, valid: false }; }
  }
}

async function fetchLiquidations() {
  const hit = cached('liq');
  if (hit) return hit;
  try {
    const d = await safeFetch('https://fapi.binance.com/fapi/v1/allForceOrders?symbol=BTCUSDT&limit=100', 3000);
    const cutoff = Date.now() - 900_000; // last 15 min
    let longLiq = 0, shortLiq = 0, maxQty = 0, magnetPrice = null;
    for (const o of d) {
      if (o.time < cutoff) continue;
      const qty = +o.executedQty, price = +o.price;
      if (o.side === 'SELL') longLiq += qty;
      if (o.side === 'BUY') shortLiq += qty;
      if (qty > maxQty) { maxQty = qty; magnetPrice = price; }
    }
    return setCache('liq', { longLiq, shortLiq, magnet: magnetPrice, valid: true });
  } catch { return _cache.liq.data || { longLiq: 0, shortLiq: 0, magnet: null, valid: false }; }
}

// ── Fear & Greed Index (alternative.me) ──────────────────────
async function fetchFearGreed() {
  const hit = cached('fear');
  if (hit) return hit;
  try {
    const d = await safeFetch('https://api.alternative.me/fng/?limit=1', 4000);
    const v = d.data[0];
    return setCache('fear', { value: +v.value, label: v.value_classification, valid: true });
  } catch { return { value: 50, label: 'Neutral', valid: false }; }
}

// ── Whale exchange flow proxy via CoinGecko BTC market data ──
async function fetchWhaleSignal() {
  const hit = cached('whale');
  if (hit) return hit;
  try {
    const d = await safeFetch(
      'https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false',
      5000
    );
    const mdd = d.market_data;
    return setCache('whale', {
      priceChange1h:  mdd.price_change_percentage_1h_in_currency?.usd || 0,
      priceChange24h: mdd.price_change_percentage_24h || 0,
      volToMcap:      mdd.total_volume?.usd / mdd.market_cap?.usd || 0,
      ath:            mdd.ath?.usd || 0,
      valid: true
    });
  } catch { return { priceChange1h: 0, priceChange24h: 0, volToMcap: 0, ath: 0, valid: false }; }
}

// ── News sentiment via RSS2JSON proxy ────────────────────────
const NEWS_WORDS = {
  pos: ['bullish','surge','rally','gain','rise','soar','jump','breakout','approval','institutional','adoption','launch','recovery','bounce','long squeeze','record','ath'],
  neg: ['bearish','crash','dump','fall','drop','decline','plunge','ban','hack','collapse','lawsuit','fraud','regulation','liquidation','sell-off','panic','contagion','short squeeze']
};

async function fetchNewsSentiment() {
  const hit = cached('news');
  if (hit) return hit;
  const feeds = [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss'
  ];
  let pos = 0, neg = 0, count = 0;
  for (const feed of feeds) {
    try {
      const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}&count=8`;
      const d = await safeFetch(url, 6000);
      if (!d.items) continue;
      for (const item of d.items) {
        const text = (item.title + ' ' + (item.description || '')).toLowerCase();
        for (const w of NEWS_WORDS.pos) if (text.includes(w)) pos++;
        for (const w of NEWS_WORDS.neg) if (text.includes(w)) neg++;
        count++;
      }
    } catch { /* skip feed */ }
  }
  const total = pos + neg || 1;
  const score = Math.round(((pos - neg) / total) * 100);
  return setCache('news', { score: Math.max(-100, Math.min(100, score)), count, valid: count > 0 });
}

// ============================================================
// SECTION 5 — MULTI-TIMEFRAME ALIGNMENT GATE
// ============================================================

function htfBias(klines1h) {
  if (!klines1h || klines1h.length < 50) return { bias: 'NEUTRAL', strength: 0 };
  const closes = klines1h.map(k => k.close);
  const ema20 = Indicators.ema(closes, 20);
  const ema50 = Indicators.ema(closes, 50);
  const last   = closes[closes.length - 1];
  const adx    = Indicators.adx(klines1h);

  if (ema20 > ema50 && last > ema20) return { bias: 'BULL', strength: adx };
  if (ema20 < ema50 && last < ema20) return { bias: 'BEAR', strength: adx };
  return { bias: 'NEUTRAL', strength: adx };
}

// 5-minute momentum confirmation for scalp entry
function microMomentum(klines5m) {
  if (!klines5m || klines5m.length < 20) return { confirm: false, direction: 0 };
  const closes = klines5m.map(k => k.close);
  const rsis   = Indicators.rsiArray(closes);
  const rsi    = rsis[rsis.length - 1];
  const ema8   = Indicators.ema(closes, 8);
  const ema21  = Indicators.ema(closes, 21);
  const last   = closes[closes.length - 1];
  const cvd    = Indicators.cvdDelta(klines5m);

  if (rsi < 45 && ema8 > ema21 && last > ema8 && cvd.direction > 0)
    return { confirm: true, direction: 1 };
  if (rsi > 55 && ema8 < ema21 && last < ema8 && cvd.direction < 0)
    return { confirm: true, direction: -1 };
  return { confirm: false, direction: 0 };
}

// ============================================================
// SECTION 6 — SCORING ENGINE
// ============================================================

function computeScore({
  closes, klines, rsiArray, macd, atr, adx, bb, volProfile,
  fundingData, oiData, lsData, liqData, fearGreed, newsSentiment,
  whaleSig, relativeVol, currentPrice, anomalyFlag, regime,
  htf, micro
}) {
  let score  = 0;
  const reasons   = [];
  const riskFlags = [];

  // ── Guard: anomaly & single source ───────────────────────
  if (anomalyFlag) riskFlags.push('Exchange Divergence >0.3%');

  // ── 1. Macro trend alignment (30 pts) ────────────────────
  const ema20   = Indicators.ema(closes, 20);
  const ema50   = Indicators.ema(closes, 50);
  const ema200  = Indicators.ema(closes, 200);
  if (ema20 > ema50 && ema50 > ema200 && currentPrice > ema200) {
    score += 30; reasons.push('Macro Bull Alignment (EMA 20>50>200)');
  } else if (ema20 < ema50 && ema50 < ema200 && currentPrice < ema200) {
    score -= 30; reasons.push('Macro Bear Alignment (EMA 20<50<200)');
  }

  // ── 2. Higher-TF bias gate — scale raw score ─────────────
  if (htf.bias === 'BULL')    score *= 1.10;
  else if (htf.bias === 'BEAR') score *= 1.10; // amplify in correct direction
  else score *= 0.85; // punish counter-trend scalps

  // ── 3. Fractal divergence RSI (25 pts) ───────────────────
  const rsi     = rsiArray[rsiArray.length - 1];
  const rsiDiv  = Indicators.divergence(closes, rsiArray, 20);
  if (rsiDiv.type !== 'NONE') {
    score += rsiDiv.score;
    reasons.push(rsiDiv.type === 'BULLISH' ? 'Bullish RSI Divergence' : 'Bearish RSI Divergence');
  }

  // ── 4. Fractal divergence MACD (25 pts) ──────────────────
  const macdDiv = Indicators.divergence(closes, macd.histArray, 20);
  if (macdDiv.type !== 'NONE') {
    score += macdDiv.score;
    reasons.push(macdDiv.type === 'BULLISH' ? 'Bullish MACD Divergence' : 'Bearish MACD Divergence');
  }

  // ── 5. Stochastic RSI — fast scalp trigger (15 pts) ──────
  const stoch = Indicators.stochRsi(closes);
  if (stoch.k < 20 && stoch.d < 20 && stoch.k > stoch.d) {
    score += 15; reasons.push(`StochRSI Oversold Crossup (${stoch.k.toFixed(0)})`);
  } else if (stoch.k > 80 && stoch.d > 80 && stoch.k < stoch.d) {
    score -= 15; reasons.push(`StochRSI Overbought Crossdown (${stoch.k.toFixed(0)})`);
  }

  // ── 6. CVD momentum (10 pts) ─────────────────────────────
  const cvd = Indicators.cvdDelta(klines);
  if (cvd.momentum > 0.15)      { score += 10; reasons.push(`Bullish CVD Momentum (+${(cvd.momentum*100).toFixed(0)}%)`); }
  else if (cvd.momentum < -0.15) { score -= 10; reasons.push(`Bearish CVD Momentum (${(cvd.momentum*100).toFixed(0)}%)`); }

  // ── 7. Order-book imbalance proxy (8 pts) ────────────────
  const obi = Indicators.obImbalance(klines);
  if (obi.ratio > 0.65)       { score += 8;  reasons.push(`Buy-Side OB Imbalance (${(obi.ratio*100).toFixed(0)}%)`); }
  else if (obi.ratio < 0.35)  { score -= 8;  reasons.push(`Sell-Side OB Imbalance (${(obi.ratio*100).toFixed(0)}%)`); }

  // ── 8. Funding rate ───────────────────────────────────────
  if (fundingData.valid) {
    if (fundingData.rate > 0.0005)   { score -= 10; reasons.push('Funding Overheated (longs pay)'); }
    else if (fundingData.rate < -0.0001) { score += 15; reasons.push('Funding Negative (shorts pay)'); }
  }

  // ── 9. Open Interest (15 pts) ────────────────────────────
  if (oiData.valid) {
    if (oiData.changePercent > 0.5 && rsi > 50)  { score += 15; reasons.push('OI Rising: Longs Piling In'); }
    if (oiData.changePercent < -0.5 && rsi > 50) { score -= 15; reasons.push('OI Falling: Squeeze Risk'); }
    if (oiData.changePercent > 0.5 && rsi < 50)  { score -= 15; reasons.push('OI Rising: Shorts Piling In'); }
  }

  // ── 10. Long/Short Ratio (15 pts) ────────────────────────
  if (lsData.valid) {
    if (lsData.ratio > 2.0)  { score -= 15; reasons.push('Longs Crowded (L/S Ratio High)'); }
    if (lsData.ratio < 0.8)  { score += 15; reasons.push('Shorts Crowded (L/S Ratio Low)'); }
  }

  // ── 11. Liquidation exhaustion (20 pts) ──────────────────
  if (liqData.valid && liqData.longLiq > 0 && liqData.shortLiq > 0) {
    if (liqData.longLiq > liqData.shortLiq * 2 && rsi < 45) {
      score += 20; reasons.push('Long Liq Exhaustion — Bottom Signal');
    } else if (liqData.shortLiq > liqData.longLiq * 2 && rsi > 55) {
      score -= 20; reasons.push('Short Liq Exhaustion — Top Signal');
    }
  }

  // ── 12. Fear & Greed contrarian (15 pts) ─────────────────
  if (fearGreed.valid) {
    if (fearGreed.value <= 20) { score += 15; reasons.push(`Extreme Fear (${fearGreed.value}) — Contrarian Long`); }
    if (fearGreed.value >= 80) { score -= 15; reasons.push(`Extreme Greed (${fearGreed.value}) — Contrarian Short`); }
  }

  // ── 13. News sentiment (10 pts max) ──────────────────────
  if (newsSentiment.valid) {
    if (newsSentiment.score > 40)      { score += 10; reasons.push(`Bullish News Sentiment (+${newsSentiment.score})`); }
    else if (newsSentiment.score < -40) { score -= 10; reasons.push(`Bearish News Sentiment (${newsSentiment.score})`); }
  }

  // ── 14. Whale momentum signal (10 pts) ───────────────────
  if (whaleSig.valid) {
    // High vol-to-mcap ratio + negative 1h change = smart money exit
    if (whaleSig.volToMcap > 0.05 && whaleSig.priceChange1h < -1.5) {
      score -= 10; reasons.push('Whale Distribution Pattern Detected');
    } else if (whaleSig.volToMcap > 0.05 && whaleSig.priceChange1h > 1.5) {
      score += 10; reasons.push('Whale Accumulation Pattern Detected');
    }
  }

  // ── 15. Volume surge (10 pts) ────────────────────────────
  if (relativeVol > 3.0) {
    const lastClose = closes[closes.length - 1], prevClose = closes[closes.length - 2];
    if (lastClose > prevClose) { score += 10; reasons.push(`Extreme Bull Volume Surge (${relativeVol.toFixed(1)}x)`); }
    else                       { score -= 10; reasons.push(`Extreme Bear Volume Surge (${relativeVol.toFixed(1)}x)`); }
  }

  // ── 16. Volume Profile breakout (15 pts) ─────────────────
  if (currentPrice > volProfile.vah && relativeVol > 1.2) {
    score += 15; reasons.push('VAH Breakout w/ Volume');
  } else if (currentPrice < volProfile.val && relativeVol > 1.2) {
    score -= 15; reasons.push('VAL Breakdown w/ Volume');
  }

  // ── 17. Bollinger Band breakout in BREAKOUT regime (20 pts)
  if (regime === 'BREAKOUT_IMMINENT') {
    if (currentPrice > bb.upper && relativeVol > 1.5) { score += 20; reasons.push('BB Bullish Breakout Vol'); }
    if (currentPrice < bb.lower && relativeVol > 1.5) { score -= 20; reasons.push('BB Bearish Breakout Vol'); }
  }

  // ── 18. 5-min micro-entry confirmation boost (+12 pts) ───
  if (micro.confirm) {
    if (micro.direction > 0 && score > 0) { score += 12; reasons.push('5m Micro-Entry LONG Confirmed'); }
    if (micro.direction < 0 && score < 0) { score += 12; reasons.push('5m Micro-Entry SHORT Confirmed'); }
    // Counter-signal: punish if micro disagrees with direction
    if (micro.direction > 0 && score < 0) { score += 10; riskFlags.push('5m Micro Disagrees with Signal Direction'); }
    if (micro.direction < 0 && score > 0) { score -= 10; riskFlags.push('5m Micro Disagrees with Signal Direction'); }
  }

  // ── Post-score multipliers ────────────────────────────────
  if (anomalyFlag)       score *= 0.60; // heavy penalty for exchange divergence
  if (relativeVol < 0.6) { score *= 0.50; riskFlags.push('Low Volume — Fakeout Risk'); }
  if (regime === 'CHOP') { score *= 0.80; riskFlags.push('Choppy Regime — Reduced Confidence'); }
  if (htf.bias === 'NEUTRAL') score *= 0.85;

  return { score: Math.round(score), reasons: reasons.slice(0, 10), riskFlags };
}

// ============================================================
// SECTION 7 — EXECUTION GATE & RISK MANAGEMENT
// ============================================================

function executionGate(signal, confidence, riskFlags) {
  if (signal === 'NEUTRAL') return { approved: false, multiplier: 0 };
  if (confidence >= 85)    return { approved: true, multiplier: 1.0 };
  if (confidence >= 70)    return { approved: true, multiplier: 0.75 };
  if (confidence >= 55)    return { approved: true, multiplier: 0.50 };
  riskFlags.push(`${signal} Rejected — Confidence ${confidence.toFixed(0)}% < 55%`);
  return { approved: false, multiplier: 0 };
}

// Partial TP ladder for scalpers — three levels
function buildTargets(signal, price, atr, atrMult, liqMagnet) {
  if (signal === 'LONG') {
    let sl = price - atr * atrMult;
    if (liqMagnet && liqMagnet < price && (price - liqMagnet) < atr)
      sl = liqMagnet * 0.999;
    return {
      stopLoss:    +sl.toFixed(2),
      tp1:         +(price + atr * atrMult * 1.0).toFixed(2), // 1:1 — take 33%
      tp2:         +(price + atr * atrMult * 2.0).toFixed(2), // 1:2 — take 33%
      tp3:         +(price + atr * atrMult * 3.5).toFixed(2), // 1:3.5 — trail rest
      riskReward:  (atr * atrMult * 2.0 / (atr * atrMult)).toFixed(1)
    };
  } else if (signal === 'SHORT') {
    let sl = price + atr * atrMult;
    if (liqMagnet && liqMagnet > price && (liqMagnet - price) < atr)
      sl = liqMagnet * 1.001;
    return {
      stopLoss:    +sl.toFixed(2),
      tp1:         +(price - atr * atrMult * 1.0).toFixed(2),
      tp2:         +(price - atr * atrMult * 2.0).toFixed(2),
      tp3:         +(price - atr * atrMult * 3.5).toFixed(2),
      riskReward:  '2.0'
    };
  }
  return { stopLoss: price, tp1: price, tp2: price, tp3: price, riskReward: '0' };
}

// ============================================================
// SECTION 8 — MAIN SIGNAL ENGINE
// ============================================================

const _breaker = new CircuitBreaker(3, 60_000);

export async function generateSignal() {

  // ── Circuit breaker check ─────────────────────────────────
  if (_breaker.isOpen()) {
    return fallback('Circuit Breaker Active — Cooling Off', true);
  }

  try {
    // ── A. Parallel fetch: all exchanges + HTF + micro ────────
    const [binRes, byRes, okRes, htfRes, microRes] = await Promise.allSettled([
      fetchBinance(), fetchBybit(), fetchOKX(), fetchHigherTF(), fetchMicroTF()
    ]);

    const validSources = [binRes, byRes, okRes]
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .sort((a, b) => b.weight - a.weight);

    if (validSources.length === 0) {
      _breaker.fail();
      return fallback('All Exchange Feeds Failed');
    }

    _breaker.succeed();

    // ── B. Price anomaly detection across exchanges ───────────
    let anomalyFlag = false;
    if (validSources.length >= 3) {
      const prices = validSources.map(v => v.price);
      if ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices) > 0.003)
        anomalyFlag = true;
    }

    const primary       = validSources[0];
    const { klines, source, weight, price: currentPrice } = primary;
    const closes        = klines.map(k => k.close);
    const volumes       = klines.map(k => k.volume);

    // ── C. Stale data guard (>30 min) ────────────────────────
    if (Date.now() - klines[klines.length - 1].timestamp > 1_800_000)
      return fallback('Stale Candles — >30 min Old');

    // ── D. Parallel fetch all flow data ──────────────────────
    const [fundingData, oiData, lsData, liqData, fearGreed, newsSentiment, whaleSig] =
      await Promise.all([
        fetchFunding(), fetchOI(), fetchLSRatio(), fetchLiquidations(),
        fetchFearGreed(), fetchNewsSentiment(), fetchWhaleSignal()
      ]);

    // ── E. Compute indicators ─────────────────────────────────
    const volSMA      = Indicators.sma(volumes.slice(0, -1), 20);
    const relativeVol = Math.max(volumes[volumes.length - 1], volumes[volumes.length - 2]) / (volSMA || 1);
    const rsiArray    = Indicators.rsiArray(closes, 14);
    const rsi         = rsiArray[rsiArray.length - 1];
    const macd        = Indicators.macd(closes);
    const adx         = Indicators.adx(klines);
    const atr         = Indicators.atr(klines);
    const bb          = Indicators.bollingerBands(closes);
    const volProfile  = Indicators.volumeProfile(klines, 100, atr);
    const regime      = detectRegime(adx, atr, bb.width, currentPrice);

    // ── F. Multi-timeframe context ────────────────────────────
    const klines1h    = htfRes.status === 'fulfilled' ? htfRes.value : null;
    const klines5m    = microRes.status === 'fulfilled' ? microRes.value : null;
    const htf         = htfBias(klines1h);
    const micro       = microMomentum(klines5m);

    // ── G. Regime-specific required score ─────────────────────
    let reqScore = 50, atrMult = 1.5;
    if (regime === 'TIGHT_RANGE')       { reqScore = 65; atrMult = 1.0; }
    if (regime === 'BREAKOUT_IMMINENT') { reqScore = 45; atrMult = 2.5; }
    if (regime === 'STRONG_TREND')      { reqScore = 48; atrMult = 1.8; }

    // ── H. Score computation ──────────────────────────────────
    const { score: rawScore, reasons, riskFlags } = computeScore({
      closes, klines, rsiArray, macd, atr, adx, bb, volProfile,
      fundingData, oiData, lsData, liqData, fearGreed, newsSentiment,
      whaleSig, relativeVol, currentPrice, anomalyFlag, regime, htf, micro
    });

    if (validSources.length === 1) riskFlags.push(`Single Source Only (${source})`);

    // ── I. Signal decision ────────────────────────────────────
    let signal = 'NEUTRAL';
    if (rawScore >= reqScore)  signal = 'LONG';
    if (rawScore <= -reqScore) signal = 'SHORT';

    // ── J. Confidence calculation ─────────────────────────────
    let confidence = (Math.abs(rawScore) * 0.5 + reasons.length * 2.5) * weight;
    if (validSources.length >= 2 && !anomalyFlag) confidence *= 1.15;
    if (validSources.length === 1)               confidence *= 0.85;
    if (htf.bias !== 'NEUTRAL')                  confidence *= 1.10;
    if (micro.confirm)                           confidence *= 1.08;
    confidence = Math.min(97, Math.max(0, confidence));

    // ── K. Execution gate ─────────────────────────────────────
    const gate = executionGate(signal, confidence, riskFlags);
    if (!gate.approved) { signal = 'NEUTRAL'; confidence = Math.max(0, confidence - 30); }

    // ── L. Target levels ──────────────────────────────────────
    const targets = buildTargets(signal, currentPrice, atr, atrMult, liqData.magnet);

    // ── M. Final output ───────────────────────────────────────
    return {
      signal,                              // 'LONG' | 'SHORT' | 'NEUTRAL'
      confidence:     Math.round(confidence),
      score:          rawScore,
      regime,
      marginMultiplier: gate.multiplier,

      // --- 5-minute entry timing ---
      microEntry: {
        confirmed:  micro.confirm,
        direction:  micro.direction > 0 ? 'LONG' : micro.direction < 0 ? 'SHORT' : 'WAIT',
        note: micro.confirm
          ? `5m confirms ${micro.direction > 0 ? 'long' : 'short'} entry`
          : 'Await 5m confirmation before entering'
      },

      // --- Higher-TF context ---
      htfContext: {
        bias:     htf.bias,
        adx1h:    htf.strength.toFixed(1),
        aligned:  (signal === 'LONG' && htf.bias === 'BULL') || (signal === 'SHORT' && htf.bias === 'BEAR'),
        note:     htf.bias === 'NEUTRAL'
          ? 'No HTF trend — reduce size'
          : `1H trend ${htf.bias === 'BULL' ? 'bullish' : 'bearish'}, ADX ${htf.strength.toFixed(0)}`
      },

      // --- Execution targets (3-level TP ladder) ---
      targets: {
        entry:    +currentPrice.toFixed(2),
        stopLoss: targets.stopLoss,
        tp1:      targets.tp1,   // 33% exit
        tp2:      targets.tp2,   // 33% exit
        tp3:      targets.tp3,   // trail remainder
        riskReward: targets.riskReward,
        liqMagnet:  liqData.magnet || null
      },

      // --- Market structure (flow data) ---
      marketStructure: {
        fundingRate:     fundingData.valid ? +fundingData.rate.toFixed(6) : null,
        oiChange15m:     oiData.valid ? +oiData.changePercent.toFixed(2) : null,
        longShortRatio:  lsData.valid ? +lsData.ratio.toFixed(2) : null,
        fearGreedIndex:  fearGreed.valid ? fearGreed.value : null,
        fearGreedLabel:  fearGreed.valid ? fearGreed.label : null,
        newsSentiment:   newsSentiment.valid ? newsSentiment.score : null,
        whaleVolRatio:   whaleSig.valid ? +whaleSig.volToMcap.toFixed(4) : null,
        poc:             +volProfile.poc.toFixed(2),
        vah:             +volProfile.vah.toFixed(2),
        val:             +volProfile.val.toFixed(2),
      },

      // --- Technical snapshot ---
      indicators: {
        price:       +currentPrice.toFixed(2),
        rsi:         +rsi.toFixed(2),
        stochK:      +Indicators.stochRsi(closes).k.toFixed(2),
        stochD:      +Indicators.stochRsi(closes).d.toFixed(2),
        macdHist:    +macd.hist.toFixed(5),
        adx:         +adx.toFixed(2),
        atr:         +atr.toFixed(2),
        bbWidth:     +bb.width.toFixed(4),
        ema20:       +Indicators.ema(closes, 20).toFixed(2),
        ema50:       +Indicators.ema(closes, 50).toFixed(2),
        ema200:      +Indicators.ema(closes, 200).toFixed(2),
        relativeVol: +relativeVol.toFixed(2),
        cvdDir:      Indicators.cvdDelta(klines).direction > 0 ? 'BULL' : 'BEAR',
        obiRatio:    +Indicators.obImbalance(klines).ratio.toFixed(2),
        volatility:  `${((atr / currentPrice) * 100).toFixed(2)}%`
      },

      // --- Signal quality metadata ---
      sources:    validSources.map(s => s.source),
      anomaly:    anomalyFlag,
      reasons,
      riskFlags,
      timestamp:  Date.now()
    };

  } catch (err) {
    _breaker.fail();
    console.error('[ULTIMATE_SIGNAL] Exception:', err);
    return fallback(err.message);
  }
}

// ── Fallback/neutral state ────────────────────────────────────
function fallback(reason, isCooldown = false) {
  return {
    signal: 'NEUTRAL', confidence: 0, score: 0, regime: 'UNKNOWN', marginMultiplier: 0,
    microEntry:      { confirmed: false, direction: 'WAIT', note: 'System unavailable' },
    htfContext:      { bias: 'NEUTRAL', adx1h: '0', aligned: false, note: 'No data' },
    targets:         { entry: 0, stopLoss: 0, tp1: 0, tp2: 0, tp3: 0, riskReward: '0', liqMagnet: null },
    marketStructure: {},
    indicators:      {},
    sources: [], anomaly: false,
    reasons: [],
    riskFlags: [isCooldown ? 'Cooldown Active' : 'Data Outage', reason],
    timestamp: Date.now()
  };
}

// ── Quick-use default export ──────────────────────────────────
export const signalEngine = { generateSignal };
export default { generateSignal };
