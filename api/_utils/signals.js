// ============================================================
// ULTIMATE_SIGNAL_V2.js — WebSocket Edition
// BTC Scalper Signal Engine · 2026
//
// Architecture:
//   ┌─────────────────────────────────────────┐
//   │  WSDataLayer  — 3 exchange WS streams   │
//   │  + Hyperliquid REST (generous limits)   │
//   │  + alt.me REST (daily cadence, cached)  │
//   └──────────────┬──────────────────────────┘
//                  │ .snapshot() — instant, never fails
//   ┌──────────────▼──────────────────────────┐
//   │  Indicators  — pure math, no I/O        │
//   └──────────────┬──────────────────────────┘
//                  │
//   ┌──────────────▼──────────────────────────┐
//   │  ScoreEngine — 18 factors, MTF gates    │
//   └──────────────┬──────────────────────────┘
//                  │
//   ┌──────────────▼──────────────────────────┐
//   │  generateSignal() — call anytime        │
//   └─────────────────────────────────────────┘
//
// Usage:
//   import { engine } from './ULTIMATE_SIGNAL_V2.js';
//   await engine.connect();                    // once on startup
//   const signal = engine.generateSignal();    // synchronous, instant
//   engine.on('signal', s => console.log(s));  // or subscribe
// ============================================================

// ============================================================
// SECTION 1 — CONSTANTS
// ============================================================

const SYMBOL    = 'BTCUSDT';
const SYMBOL_OKX = 'BTC-USDT-SWAP';
const MAX_KLINES = 300;
const RECONNECT_MS = 2_000;

// Minimum candles needed before any signal is valid
const MIN_CANDLES = {
  '15m': 60,
  '1h':  30,
  '5m':  20,
};

// ============================================================
// SECTION 2 — KLINE RING BUFFER
// ============================================================

class KlineBuffer {
  constructor(maxLen = MAX_KLINES) {
    this.buf    = [];
    this.maxLen = maxLen;
  }

  // Accepts a normalised candle object:
  // { timestamp, open, high, low, close, volume, closed }
  push(candle) {
    const last = this.buf[this.buf.length - 1];
    if (last && last.timestamp === candle.timestamp) {
      this.buf[this.buf.length - 1] = candle; // live update
    } else {
      this.buf.push(candle);
      if (this.buf.length > this.maxLen) this.buf.shift();
    }
  }

  // Only finalised candles — safe for all indicator maths
  closed() {
    return this.buf.filter(k => k.closed !== false);
  }

  all() { return this.buf; }

  get length() { return this.buf.length; }

  lastPrice() {
    const b = this.buf[this.buf.length - 1];
    return b ? b.close : 0;
  }

  isReady(min) { return this.closed().length >= min; }
}

// ============================================================
// SECTION 3 — LIQUIDATION ROLLING WINDOW
// ============================================================

class LiqWindow {
  constructor(windowMs = 900_000) { // 15-minute window
    this.events   = [];
    this.windowMs = windowMs;
  }

  add(side, price, qty) {
    this.events.push({ side, price, qty, ts: Date.now() });
    this._prune();
  }

  _prune() {
    const cutoff = Date.now() - this.windowMs;
    this.events = this.events.filter(e => e.ts >= cutoff);
  }

  snapshot() {
    this._prune();
    let longLiq = 0, shortLiq = 0, maxQty = 0, magnet = null;
    for (const e of this.events) {
      // Binance: side='SELL' means a long position was liquidated
      if (e.side === 'SELL') longLiq  += e.qty;
      if (e.side === 'BUY')  shortLiq += e.qty;
      if (e.qty > maxQty) { maxQty = e.qty; magnet = e.price; }
    }
    return { longLiq, shortLiq, magnet, count: this.events.length, valid: true };
  }
}

// ============================================================
// SECTION 4 — WEBSOCKET FACTORY (auto-reconnect)
// ============================================================

function createWS(url, handlers, label) {
  let ws, dead = false;

  function connect() {
    if (dead) return;
    ws = new WebSocket(url);
    ws.onopen    = () => { console.log(`[WS:${label}] connected`); handlers.onOpen?.(ws); };
    ws.onmessage = e => { try { handlers.onMessage(JSON.parse(e.data)); } catch {} };
    ws.onerror   = () => {};
    ws.onclose   = () => {
      if (!dead) {
        console.warn(`[WS:${label}] dropped — reconnect in ${RECONNECT_MS}ms`);
        setTimeout(connect, RECONNECT_MS);
      }
    };
  }

  connect();

  return {
    send(data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); },
    close()    { dead = true; ws?.close(); },
    alive()    { return ws?.readyState === WebSocket.OPEN; },
  };
}

// ============================================================
// SECTION 5 — WS DATA LAYER
// ============================================================

class WSDataLayer {
  constructor() {
    // ── Kline buffers ──────────────────────────────────────
    this.buf = {
      binance15m: new KlineBuffer(MAX_KLINES),
      binance1h:  new KlineBuffer(100),
      binance5m:  new KlineBuffer(60),
      bybit15m:   new KlineBuffer(MAX_KLINES),
      okx15m:     new KlineBuffer(MAX_KLINES),
    };

    // ── Live flow data ─────────────────────────────────────
    this.funding    = { rate: 0,   valid: false };
    this.bookTicker = { bid: 0, ask: 0, spread: 0, valid: false };
    this.liqs       = new LiqWindow(900_000);
    this.ls         = { ratio: 1.0, valid: false };

    // ── REST-only data (slow cadence, cached in-memory) ────
    this.oi        = { changePercent: 0, valid: false };
    this.fearGreed = { value: 50, label: 'Neutral', valid: false };
    this.hl        = { oi: 0, funding: 0, markPx: 0, valid: false };

    this._sockets   = [];
    this._timers    = [];
    this._prevHLOI  = null;
    this._ready     = false;
  }

  // ── Public: connect all streams ────────────────────────────
  async connect() {
    if (this._ready) return;

    // 1. Seed kline history from REST (one-shot, fills buffers immediately)
    await this._seedAllKlines();

    // 2. Open WebSocket streams
    this._openBinanceStream();
    this._openBybitStream();
    this._openOKXStream();

    // 3. Slow REST polls (data with no useful WS equivalent)
    await Promise.all([
      this._pollFearGreed(),
      this._pollHyperliquid(),
      this._pollOI(),
      this._pollLS(),
    ]);

    this._timers.push(
      setInterval(() => this._pollFearGreed(),   600_000), // 10 min
      setInterval(() => this._pollHyperliquid(),  60_000), // 1 min
      setInterval(() => this._pollOI(),          300_000), // 5 min
      setInterval(() => this._pollLS(),          300_000), // 5 min
    );

    this._ready = true;
    console.log('[DataLayer] All streams live');
  }

  // ── Public: instant zero-fail snapshot ─────────────────────
  snapshot() {
    const b15  = this.buf.binance15m.closed();
    const by15 = this.buf.bybit15m.closed();
    const ok15 = this.buf.okx15m.closed();
    const b1h  = this.buf.binance1h.closed();
    const b5m  = this.buf.binance5m.closed();

    // Consensus price across exchanges
    const livePrices = [b15, by15, ok15]
      .filter(k => k.length > 0)
      .map(k => k[k.length - 1].close);
    const consensusPrice = livePrices.length
      ? livePrices.reduce((a, b) => a + b, 0) / livePrices.length
      : 0;
    const anomaly = livePrices.length >= 3
      && (Math.max(...livePrices) - Math.min(...livePrices)) / Math.min(...livePrices) > 0.003;

    // Stale guard
    const lastTs = b15.length ? b15[b15.length - 1].timestamp : 0;
    const stale  = Date.now() - lastTs > 1_800_000;

    return {
      ready:    this._ready && !stale && b15.length >= MIN_CANDLES['15m'],
      stale,
      anomaly,
      sources:  livePrices.length,
      price:    consensusPrice || this.buf.binance15m.lastPrice(),

      klines:   b15,   // 15m primary
      klines1h: b1h,   // 1h HTF gate
      klines5m: b5m,   // 5m micro-entry gate

      funding:   this.funding,
      bookTick:  this.bookTicker,
      liqData:   this.liqs.snapshot(),
      oi:        this.oi,
      ls:        this.ls,
      fearGreed: this.fearGreed,
      hl:        this.hl,
    };
  }

  destroy() {
    this._sockets.forEach(s => s.close());
    this._timers.forEach(clearInterval);
    this._ready = false;
  }

  // ════════════════════════════════════════════════════════
  // BINANCE FUTURES — combined multi-stream
  // Streams: kline 15m/1h/5m · markPrice · bookTicker · forceOrder
  // ════════════════════════════════════════════════════════
  _openBinanceStream() {
    const sym = SYMBOL.toLowerCase();
    const streams = [
      `${sym}@kline_15m`,
      `${sym}@kline_1h`,
      `${sym}@kline_5m`,
      `${sym}@markPrice@1s`,
      `${sym}@bookTicker`,
      `${sym}@forceOrder`,
    ].join('/');

    const url = `wss://fstream.binance.com/stream?streams=${streams}`;

    const ws = createWS(url, {
      onMessage: msg => {
        if (!msg.stream || !msg.data) return;
        const { stream: s, data: d } = msg;

        if (s.includes('@kline_15m') && d.k) {
          this.buf.binance15m.push(_normBinanceKline(d.k));
        }
        if (s.includes('@kline_1h') && d.k) {
          this.buf.binance1h.push(_normBinanceKline(d.k));
        }
        if (s.includes('@kline_5m') && d.k) {
          this.buf.binance5m.push(_normBinanceKline(d.k));
        }
        if (s.includes('@markPrice')) {
          this.funding = { rate: parseFloat(d.r || 0), valid: true };
        }
        if (s.includes('@bookTicker')) {
          const bid = parseFloat(d.b), ask = parseFloat(d.a);
          this.bookTicker = { bid, ask, spread: ask - bid, valid: true };
        }
        if (s.includes('@forceOrder') && d.o) {
          const o = d.o;
          this.liqs.add(o.S, parseFloat(o.p), parseFloat(o.q));
        }
      }
    }, 'Binance');

    this._sockets.push(ws);
  }

  // ════════════════════════════════════════════════════════
  // BYBIT v5 — 15m klines (consensus cross-check)
  // Requires subscribe frame after open + 20s ping keepalive
  // ════════════════════════════════════════════════════════
  _openBybitStream() {
    const url = 'wss://stream.bybit.com/v5/public/linear';
    let pingTimer;

    const ws = createWS(url, {
      onOpen: (socket) => {
        socket.send(JSON.stringify({
          op:   'subscribe',
          args: [`kline.15.${SYMBOL}`],
        }));
        pingTimer = setInterval(() => ws.send({ op: 'ping' }), 20_000);
      },
      onMessage: msg => {
        if (msg.topic?.startsWith('kline.15') && Array.isArray(msg.data)) {
          for (const k of msg.data) {
            this.buf.bybit15m.push({
              timestamp: k.start,
              open:      parseFloat(k.open),
              high:      parseFloat(k.high),
              low:       parseFloat(k.low),
              close:     parseFloat(k.close),
              volume:    parseFloat(k.volume),
              closed:    k.confirm,
            });
          }
        }
      }
    }, 'Bybit');

    // Clean up ping on destroy
    const origClose = ws.close.bind(ws);
    ws.close = () => { clearInterval(pingTimer); origClose(); };

    this._sockets.push(ws);
  }

  // ════════════════════════════════════════════════════════
  // OKX — 15m klines + live L/S ratio
  // Requires subscribe frame + 'ping' string keepalive
  // ════════════════════════════════════════════════════════
  _openOKXStream() {
    const url = 'wss://ws.okx.com:8443/ws/v5/public';
    let pingTimer;

    const ws = createWS(url, {
      onOpen: (socket) => {
        socket.send(JSON.stringify({
          op:   'subscribe',
          args: [
            { channel: 'candle15m', instId: SYMBOL_OKX },
            { channel: 'long-short-account-ratio-contract', ccy: 'BTC', period: '5m' },
          ],
        }));
        // OKX needs a raw 'ping' string, not JSON
        pingTimer = setInterval(() => {
          if (ws.alive()) socket.send('ping');
        }, 25_000);
      },
      onMessage: msg => {
        if (typeof msg === 'string' || msg === 'pong') return;
        if (!msg.arg || !msg.data) return;

        if (msg.arg.channel === 'candle15m') {
          for (const c of msg.data) {
            // OKX format: [ts,o,h,l,c,vol,volCcy,volCcyQuote,confirm]
            this.buf.okx15m.push({
              timestamp: parseInt(c[0]),
              open:      parseFloat(c[1]),
              high:      parseFloat(c[2]),
              low:       parseFloat(c[3]),
              close:     parseFloat(c[4]),
              volume:    parseFloat(c[5]),
              closed:    c[8] === '1',
            });
          }
        }

        if (msg.arg.channel === 'long-short-account-ratio-contract') {
          const r = msg.data[0];
          if (r) this.ls = { ratio: parseFloat(r[1]), valid: true };
        }
      }
    }, 'OKX');

    const origClose = ws.close.bind(ws);
    ws.close = () => { clearInterval(pingTimer); origClose(); };

    this._sockets.push(ws);
  }

  // ════════════════════════════════════════════════════════
  // ONE-SHOT REST SEED — fills kline history on startup
  // so the engine has 300 candles immediately, not after 75h
  // ════════════════════════════════════════════════════════
  async _seedAllKlines() {
    const REST = 'https://fapi.binance.com/fapi/v1/klines';
    const norm = d => d.map(c => ({
      timestamp: c[0], open: +c[1], high: +c[2], low: +c[3],
      close: +c[4], volume: +c[5], closed: true,
    }));

    const fetch15m = fetch(`${REST}?symbol=${SYMBOL}&interval=15m&limit=300`)
      .then(r => r.json()).then(norm)
      .then(ks => { for (const k of ks) this.buf.binance15m.push(k); })
      .catch(e => console.warn('[Seed] 15m failed:', e.message));

    const fetch1h = fetch(`${REST}?symbol=${SYMBOL}&interval=1h&limit=100`)
      .then(r => r.json()).then(norm)
      .then(ks => { for (const k of ks) this.buf.binance1h.push(k); })
      .catch(e => console.warn('[Seed] 1h failed:', e.message));

    const fetch5m = fetch(`${REST}?symbol=${SYMBOL}&interval=5m&limit=60`)
      .then(r => r.json()).then(norm)
      .then(ks => { for (const k of ks) this.buf.binance5m.push(k); })
      .catch(e => console.warn('[Seed] 5m failed:', e.message));

    // Seed Bybit + OKX for consensus baseline
    const bybitSeed = fetch(
      `https://api.bybit.com/v5/market/kline?category=linear&symbol=${SYMBOL}&interval=15&limit=300`
    ).then(r => r.json()).then(d => {
      if (d.retCode !== 0) return;
      const ks = d.result.list.map(c => ({
        timestamp: parseInt(c[0]), open: +c[1], high: +c[2], low: +c[3],
        close: +c[4], volume: +c[5], closed: true,
      })).reverse();
      for (const k of ks) this.buf.bybit15m.push(k);
    }).catch(() => {});

    const okxSeed = fetch(
      `https://www.okx.com/api/v5/market/candles?instId=${SYMBOL_OKX}&bar=15m&limit=300`
    ).then(r => r.json()).then(d => {
      if (d.code !== '0') return;
      const ks = d.data.map(c => ({
        timestamp: parseInt(c[0]), open: +c[1], high: +c[2], low: +c[3],
        close: +c[4], volume: +c[5], closed: true,
      })).reverse();
      for (const k of ks) this.buf.okx15m.push(k);
    }).catch(() => {});

    await Promise.allSettled([fetch15m, fetch1h, fetch5m, bybitSeed, okxSeed]);
    console.log(`[Seed] 15m=${this.buf.binance15m.length} 1h=${this.buf.binance1h.length} 5m=${this.buf.binance5m.length}`);
  }

  // ════════════════════════════════════════════════════════
  // SLOW REST POLLS — only for data with no WS stream
  // ════════════════════════════════════════════════════════

  async _pollHyperliquid() {
    // Generous REST, no documented rate limit — fills OI & funding
    try {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: 'metaAndAssetCtxs' }),
      });
      const [meta, ctxs] = await res.json();
      const idx = meta.universe.findIndex(a => a.name === 'BTC');
      if (idx >= 0 && ctxs[idx]) {
        const ctx = ctxs[idx];
        this.hl = {
          oi:      parseFloat(ctx.openInterest),
          funding: parseFloat(ctx.funding),
          markPx:  parseFloat(ctx.markPx),
          valid:   true,
        };
        if (this._prevHLOI !== null) {
          const pct = ((this.hl.oi - this._prevHLOI) / this._prevHLOI) * 100;
          this.oi = { changePercent: pct, valid: true };
        }
        this._prevHLOI = this.hl.oi;
      }
    } catch {}
  }

  async _pollFearGreed() {
    try {
      const r = await fetch('https://api.alternative.me/fng/?limit=1');
      const d = await r.json();
      this.fearGreed = {
        value: +d.data[0].value,
        label: d.data[0].value_classification,
        valid: true,
      };
    } catch {}
  }

  async _pollOI() {
    if (this.oi.valid) return; // Hyperliquid already filled it
    try {
      const r = await fetch(
        `https://fapi.binance.com/futures/data/openInterestHist?symbol=${SYMBOL}&period=15m&limit=16`
      );
      const d = await r.json();
      const cur = +d[d.length - 1].sumOpenInterestValue;
      const old = +d[0].sumOpenInterestValue;
      this.oi = { changePercent: ((cur - old) / old) * 100, valid: true };
    } catch {}
  }

  async _pollLS() {
    if (this.ls.valid) return; // OKX WS already filled it
    try {
      const r = await fetch(
        `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${SYMBOL}&period=5m&limit=1`
      );
      const d = await r.json();
      this.ls = { ratio: +d[0].longShortRatio, valid: true };
    } catch {}
  }
}

// Normalise a Binance futures kline event payload
function _normBinanceKline(k) {
  return {
    timestamp: k.t,
    open:      parseFloat(k.o),
    high:      parseFloat(k.h),
    low:       parseFloat(k.l),
    close:     parseFloat(k.c),
    volume:    parseFloat(k.v),
    closed:    k.x,
  };
}

// ============================================================
// SECTION 6 — INDICATORS (pure maths, no I/O)
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
          const dx  = pDI + mDI ? (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 : 0;
          dxs.push(dx);
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

  // Cumulative volume delta proxy — buy/sell pressure balance
  cvd(klines) {
    let cum = 0;
    const deltas = [];
    for (const k of klines) {
      const range = k.high - k.low || 0.001;
      const bull  = (k.close - k.low) / range; // 0–1, proportion of bullish move
      cum += k.volume * (bull - 0.5) * 2;
      deltas.push(cum);
    }
    const n = deltas.length;
    if (n < 5) return { direction: 0, momentum: 0, raw: 0 };
    const recent = deltas[n - 1] - deltas[n - 5];
    const vol5   = klines.slice(-5).reduce((s, k) => s + k.volume, 0) || 1;
    return { direction: Math.sign(recent), momentum: recent / vol5, raw: deltas[n - 1] };
  },

  // Order-book imbalance via candle wick structure
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

  // True fractal swing divergence (price vs indicator)
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

  // Volume-weighted price profile
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
// SECTION 7 — MARKET REGIME
// ============================================================

function detectRegime(adx, atr, bbWidth, price) {
  if (adx > 30)                    return 'STRONG_TREND';
  if (adx > 20 || bbWidth > 0.04)  return 'TRENDING';
  if (adx < 15 && bbWidth < 0.02)  return 'TIGHT_RANGE';
  if (atr > price * 0.007)         return 'BREAKOUT_IMMINENT';
  return 'CHOP';
}

// ============================================================
// SECTION 8 — MULTI-TIMEFRAME CONTEXT
// ============================================================

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
  if (snap.sources === 1)    riskFlags.push(`Single Exchange Only`);
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

  // ── 8. Live bid/ask pressure ±5 (NEW — from WS bookTicker)
  if (snap.bookTick?.valid) {
    const { bid, ask } = snap.bookTick;
    const midpoint = (bid + ask) / 2;
    if (currentPrice > midpoint * 1.0001) { score += 5; reasons.push('Price Above Mid — Buy Pressure'); }
    if (currentPrice < midpoint * 0.9999) { score -= 5; reasons.push('Price Below Mid — Sell Pressure'); }
  }

  // ── 9. Funding rate ──────────────────────────────────────
  const fr = fundingData.valid ? fundingData.rate : (hlData.valid ? hlData.funding : null);
  if (fr !== null) {
    if (fr > 0.0005)   { score -= 10; reasons.push(`Funding Overheated (${(fr*100).toFixed(4)}%)`); }
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
    else score = 0; // no signal if not at extremes in tight range
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
// SECTION 11 — SIGNAL ENGINE (wraps data layer)
// ============================================================

class SignalEngine {
  constructor() {
    this._data     = new WSDataLayer();
    this._listeners = [];
    this._loopId   = null;
  }

  // ── Start everything ────────────────────────────────────────
  async connect() {
    await this._data.connect();
  }

  // ── Subscribe to automatic signals (fires on each closed 15m candle)
  on(event, cb) {
    if (event === 'signal') this._listeners.push(cb);
    return this;
  }

  // Start auto-signal loop — checks every 5s, emits on new closed candle
  startLoop() {
    let lastCandleTs = 0;
    this._loopId = setInterval(() => {
      const snap = this._data.snapshot();
      if (!snap.ready || !snap.klines.length) return;
      const latest = snap.klines[snap.klines.length - 1];
      if (latest.closed && latest.timestamp !== lastCandleTs) {
        lastCandleTs = latest.timestamp;
        const result = this._compute(snap);
        this._listeners.forEach(cb => cb(result));
      }
    }, 5_000);
    return this;
  }

  stopLoop() {
    clearInterval(this._loopId);
    this._loopId = null;
  }

  // ── Manual call — instant, synchronous ─────────────────────
  generateSignal() {
    const snap = this._data.snapshot();
    return this._compute(snap);
  }

  destroy() {
    this.stopLoop();
    this._data.destroy();
  }

  // ── Internal compute ─────────────────────────────────────────
  _compute(snap) {
    // Guard: not enough data yet
    if (!snap.ready) {
      return this._neutral(
        snap.stale ? 'Stale candles >30m' : 'Warming up — insufficient candle history'
      );
    }

    const { klines, klines1h, klines5m, price: currentPrice, anomaly } = snap;
    const closes  = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume);

    // ── Regime-specific config ─────────────────────────────
    const atr    = Ind.atr(klines);
    const adx    = Ind.adx(klines);
    const bb     = Ind.bollingerBands(closes);
    const regime = detectRegime(adx, atr, bb.width, currentPrice);

    let reqScore = 50, atrMult = 1.5;
    if (regime === 'TIGHT_RANGE')       { reqScore = 65; atrMult = 1.0; }
    if (regime === 'BREAKOUT_IMMINENT') { reqScore = 45; atrMult = 2.5; }
    if (regime === 'STRONG_TREND')      { reqScore = 48; atrMult = 1.8; }

    // ── Indicators ─────────────────────────────────────────
    const rsiArray   = Ind.rsiArray(closes);
    const rsi        = rsiArray[rsiArray.length - 1];
    const macd       = Ind.macd(closes);
    const volProfile = Ind.volumeProfile(klines, 100, atr);
    const volSMA     = Ind.sma(volumes.slice(0, -1), 20);
    const relativeVol = Math.max(volumes[volumes.length - 1], volumes[volumes.length - 2]) / (volSMA || 1);

    // ── MTF context ────────────────────────────────────────
    const htf   = htfBias(klines1h);
    const micro = microEntry(klines5m);

    // ── Score ──────────────────────────────────────────────
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

    // ── Signal decision ────────────────────────────────────
    let signal = 'NEUTRAL';
    if (rawScore >=  reqScore) signal = 'LONG';
    if (rawScore <= -reqScore) signal = 'SHORT';

    // ── Confidence ────────────────────────────────────────
    let confidence = (Math.abs(rawScore) * 0.5 + reasons.length * 2.5) *
      (snap.sources >= 3 ? 1.0 : snap.sources === 2 ? 0.90 : 0.80);
    if (!anomaly && snap.sources >= 2) confidence *= 1.15;
    if (htf.bias !== 'NEUTRAL')        confidence *= 1.10;
    if (micro.confirm)                 confidence *= 1.08;
    confidence = Math.min(97, Math.max(0, Math.round(confidence)));

    // ── Execution gate ────────────────────────────────────
    const gate = executionGate(signal, confidence, riskFlags);
    if (!gate.approved) { signal = 'NEUTRAL'; confidence = Math.max(0, confidence - 30); }

    // ── Targets ───────────────────────────────────────────
    const targets = buildTargets(signal, currentPrice, atr, atrMult, snap.liqData.magnet);

    // ── Stoch for output ──────────────────────────────────
    const stoch = Ind.stochRsi(closes);
    const cvd   = Ind.cvd(klines);
    const obi   = Ind.obImbalance(klines);

    return {
      // ── Core signal ──────────────────────────────────────
      signal,
      confidence,
      score:    rawScore,
      regime,
      marginMultiplier: gate.multiplier,

      // ── Entry timing (5m) ─────────────────────────────
      microEntry: {
        confirmed:  micro.confirm,
        direction:  micro.direction > 0 ? 'LONG' : micro.direction < 0 ? 'SHORT' : 'WAIT',
        note: micro.confirm
          ? `5m confirms ${micro.direction > 0 ? 'long' : 'short'} — ok to enter`
          : 'Await 5m candle confirmation before entering',
      },

      // ── HTF context (1h) ──────────────────────────────
      htfContext: {
        bias:    htf.bias,
        adx1h:   htf.adx.toFixed(1),
        aligned: (signal === 'LONG' && htf.bias === 'BULL') ||
                 (signal === 'SHORT' && htf.bias === 'BEAR'),
        note:    htf.bias === 'NEUTRAL'
          ? 'No 1h trend — reduce size'
          : `1h is ${htf.bias === 'BULL' ? 'bullish' : 'bearish'}, ADX ${htf.adx.toFixed(0)}`,
      },

      // ── Risk levels (3-level TP ladder) ───────────────
      targets: {
        entry:    +currentPrice.toFixed(2),
        stopLoss: targets.stopLoss,
        tp1:      targets.tp1,      // exit 33%
        tp2:      targets.tp2,      // exit 33%
        tp3:      targets.tp3,      // trail remainder
        atr:      +atr.toFixed(2),
        liqMagnet: snap.liqData.magnet || null,
      },

      // ── Market structure (flow) ────────────────────────
      marketStructure: {
        fundingRate:    snap.funding.valid   ? +snap.funding.rate.toFixed(6) : null,
        hlFunding:      snap.hl.valid        ? +snap.hl.funding.toFixed(6)   : null,
        oiChange15m:    snap.oi.valid        ? +snap.oi.changePercent.toFixed(2) : null,
        longShortRatio: snap.ls.valid        ? +snap.ls.ratio.toFixed(2)     : null,
        fearGreedIndex: snap.fearGreed.valid ? snap.fearGreed.value          : null,
        fearGreedLabel: snap.fearGreed.valid ? snap.fearGreed.label          : null,
        liqLongBTC:     +snap.liqData.longLiq.toFixed(4),
        liqShortBTC:    +snap.liqData.shortLiq.toFixed(4),
        poc:            +volProfile.poc.toFixed(2),
        vah:            +volProfile.vah.toFixed(2),
        val:            +volProfile.val.toFixed(2),
        bid:            snap.bookTick.valid ? +snap.bookTick.bid.toFixed(2)  : null,
        ask:            snap.bookTick.valid ? +snap.bookTick.ask.toFixed(2)  : null,
        spread:         snap.bookTick.valid ? +snap.bookTick.spread.toFixed(2): null,
      },

      // ── Technical snapshot ─────────────────────────────
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
        volatility:  `${((atr / currentPrice) * 100).toFixed(2)}%`,
      },

      // ── Signal quality meta ────────────────────────────
      dataQuality: {
        sources:      snap.sources,
        anomaly:      anomaly,
        wsLive:       true,  // always true — data comes from WS, not REST polling
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
      dataQuality:     { sources: 0, anomaly: false, wsLive: true, candlesReady: 0, stale: false },
      reasons: [], riskFlags: [reason], timestamp: Date.now(),
    };
  }
}

// ============================================================
// SECTION 12 — EXPORTS
// ============================================================

// Singleton — import once, use everywhere
export const engine = new SignalEngine();

// ── Quick-start example ─────────────────────────────────────
//
//  import { engine } from './ULTIMATE_SIGNAL_V2.js';
//
//  // 1. Connect once at startup (seeds klines, opens WS streams)
//  await engine.connect();
//
//  // 2a. Manual call — synchronous, instant, zero I/O
//  const s = engine.generateSignal();
//  console.log(s.signal, s.confidence, s.targets);
//
//  // 2b. Auto loop — fires callback on every closed 15m candle
//  engine
//    .on('signal', s => {
//      if (s.signal !== 'NEUTRAL') {
//        console.log(`${s.signal} @ ${s.targets.entry}`);
//        console.log(`SL ${s.targets.stopLoss}  TP1 ${s.targets.tp1}`);
//        console.log(`TP2 ${s.targets.tp2}  TP3 ${s.targets.tp3}`);
//        console.log(`Confidence ${s.confidence}%  Regime ${s.regime}`);
//        console.log('Reasons:', s.reasons);
//        console.log('Flags:  ', s.riskFlags);
//      }
//    })
//    .startLoop();
//
//  // 3. Clean up
//  engine.destroy();
//
// ── Vercel / Cloudflare Workers note ────────────────────────
//  WebSockets work in Node.js 18+ and Cloudflare Workers natively.
//  For Vercel serverless, use the engine in a long-lived Edge
//  runtime (runtime: 'edge') or a separate persistent process.
//  Do NOT use in standard Vercel lambda functions — they die
//  between requests and close the WS connections.
