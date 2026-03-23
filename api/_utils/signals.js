import { marketFeed } from './market.js';

// Ultra-fast in-memory cache for Vercel warm-starts
const flowCache = {
    oi: { data: null, timestamp: 0 },
    liq: { data: null, timestamp: 0 },
    ls: { data: null, timestamp: 0 }
};

class SignalEngineV5_1 {
  constructor() {
    this.failureCount = 0;
    this.cooldownActive = false;
  }

  // --- 1. CORE MATH & INDICATORS ---
  calculateEMA(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) ema = (data[i] - ema) * k + ema;
    return ema;
  }

  calculateSMA(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  calculateRSIArray(data, period) {
      if (data.length < period + 1) return [50];
      const rsis = [];
      let gains = 0, losses = 0;
      for (let i = 1; i <= period; i++) {
          const change = data[i] - data[i-1];
          if (change > 0) gains += change; else losses -= change;
      }
      let avgGain = gains/period; let avgLoss = losses/period;
      rsis.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
      
      for(let i = period+1; i < data.length; i++) {
          const change = data[i] - data[i-1];
          let gain = change > 0 ? change : 0;
          let loss = change < 0 ? -change : 0;
          avgGain = (avgGain * (period - 1) + gain) / period;
          avgLoss = (avgLoss * (period - 1) + loss) / period;
          rsis.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
      }
      return rsis;
  }

  calculateATR(klines, period) {
    if (klines.length < period) return 0;
    let trs = [];
    for (let i = 1; i < klines.length; i++) {
      const curr = klines[i], prev = klines[i-1];
      trs.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close)));
    }
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
    return atr;
  }

  calculateMACD(data) {
    if (data.length < 26) return { macd: 0, signal: 0, hist: 0, histArray: [] };
    let ema12 = data.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    let ema26 = data.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
    const k12 = 2/13, k26 = 2/27, k9 = 2/10;
    const macdLine = [];
    for (let i = 12; i < data.length; i++) {
        ema12 = (data[i] - ema12) * k12 + ema12;
        if (i >= 26) { ema26 = (data[i] - ema26) * k26 + ema26; macdLine.push(ema12 - ema26); }
    }
    if (macdLine.length === 0) return { macd: 0, signal: 0, hist: 0, histArray: [] };
    let signalLine = macdLine.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
    const histArray = new Array(35).fill(0);
    for (let i = 9; i < macdLine.length; i++) {
        signalLine = (macdLine[i] - signalLine) * k9 + signalLine;
        histArray.push(macdLine[i] - signalLine);
    }
    const currentMacd = macdLine[macdLine.length - 1];
    return { macd: currentMacd, signal: signalLine, hist: currentMacd - signalLine, histArray };
  }

  calculateADX(klines, period = 14) {
    if (klines.length < period * 2) return 20;
    let smoothTR = 0, smoothPDM = 0, smoothMDM = 0;
    let dxs = [];
    for (let i = 1; i < klines.length; i++) {
        const curr = klines[i], prev = klines[i-1];
        const tr = Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close));
        const upMove = curr.high - prev.high; const downMove = prev.low - curr.low;
        let pDM = (upMove > downMove && upMove > 0) ? upMove : 0;
        let mDM = (downMove > upMove && downMove > 0) ? downMove : 0;
        
        if (i <= period) {
            smoothTR += tr; smoothPDM += pDM; smoothMDM += mDM;
            if (i === period) {
                const pDI = (smoothPDM / smoothTR) * 100, mDI = (smoothMDM / smoothTR) * 100;
                dxs.push((pDI + mDI !== 0) ? (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 : 0);
            }
        } else {
            smoothTR = smoothTR - (smoothTR / period) + tr;
            smoothPDM = smoothPDM - (smoothPDM / period) + pDM;
            smoothMDM = smoothMDM - (smoothMDM / period) + mDM;
            const pDI = (smoothPDM / smoothTR) * 100, mDI = (smoothMDM / smoothTR) * 100;
            dxs.push((pDI + mDI !== 0) ? (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 : 0);
        }
    }
    let adx = dxs.slice(0, period).reduce((a,b)=>a+b,0)/period;
    for(let i = period; i < dxs.length; i++) adx = ((adx * (period-1)) + dxs[i]) / period;
    return adx;
  }

  calculateBollingerBands(closes, period = 20) {
      if (closes.length < period) return { upper: 0, lower: 0, basis: 0, width: 0 };
      const slice = closes.slice(-period);
      const basis = slice.reduce((a,b)=>a+b,0)/period;
      const variance = slice.reduce((a,b) => a + Math.pow(b - basis, 2), 0) / period;
      const stdDev = Math.sqrt(variance);
      const upper = basis + (stdDev * 2);
      const lower = basis - (stdDev * 2);
      return { upper, lower, basis, width: (upper - lower) / basis };
  }

  // --- 2. ALPHA: PROPER FRACTAL DIVERGENCE & VOLUME PROFILE ---
  detectTrueSwings(prices, indicators, lookback = 30) {
      if (prices.length < lookback || indicators.length < lookback) return { type: 'NONE', score: 0 };
      
      const p = prices.slice(-lookback);
      const ind = indicators.slice(-lookback);
      
      const getSwingLows = () => {
          let swings = [];
          for (let i = 2; i < p.length - 2; i++) {
              if (p[i] < p[i-1] && p[i] < p[i-2] && p[i] < p[i+1] && p[i] < p[i+2]) {
                  swings.push({ idx: i, price: p[i], val: ind[i] });
              }
          }
          return swings;
      };

      const getSwingHighs = () => {
          let swings = [];
          for (let i = 2; i < p.length - 2; i++) {
              if (p[i] > p[i-1] && p[i] > p[i-2] && p[i] > p[i+1] && p[i] > p[i+2]) {
                  swings.push({ idx: i, price: p[i], val: ind[i] });
              }
          }
          return swings;
      };

      const lows = getSwingLows();
      if (lows.length >= 2) {
          const recent = lows[lows.length-1];
          const prev = lows[lows.length-2];
          if (recent.price < prev.price && recent.val > prev.val) return { type: 'BULLISH', score: 25 }; 
      }

      const highs = getSwingHighs();
      if (highs.length >= 2) {
          const recent = highs[highs.length-1];
          const prev = highs[highs.length-2];
          if (recent.price > prev.price && recent.val < prev.val) return { type: 'BEARISH', score: -25 }; 
      }

      return { type: 'NONE', score: 0 };
  }

  calculateVolumeProfile(klines, lookback = 100, atr = 100) {
      if (klines.length < 2) return { poc: 0, vah: 0, val: 0, outOfValueArea: false };
      const data = klines.slice(-lookback);
      const buckets = {};
      const bucketSize = Math.max(50, Math.round(atr * 0.6)); 
      data.forEach(k => {
          const typicalPrice = (k.high + k.low + k.close) / 3;
          const bucket = Math.round(typicalPrice / bucketSize) * bucketSize;
          buckets[bucket] = (buckets[bucket] || 0) + k.volume;
      });
      let poc = 0, maxVol = 0;
      for (const [price, vol] of Object.entries(buckets)) {
          if (vol > maxVol) { maxVol = vol; poc = parseFloat(price); }
      }
      return { poc, vah: poc + (atr * 1.5), val: poc - (atr * 1.5) };
  }

  // --- 3. MULTI-SOURCE SYNTHETIC CONSENSUS ---
  async fetchBinanceKlines() {
      const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=300', { signal: ctrl.signal });
      if(!res.ok) throw new Error("Binance Klines fail");
      const data = await res.json();
      return { klines: data.map(c => ({ timestamp: c[0], open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) })), price: parseFloat(data[data.length-1][4]), source: 'Binance', weight: 1.0 };
  }

  async fetchBybitKlines() {
      const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=15&limit=300', { signal: ctrl.signal });
      const data = await res.json();
      if(data.retCode !== 0) throw new Error("Bybit error");
      let klines = data.result.list.map(c => ({ timestamp: parseFloat(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) })).reverse();
      return { klines, price: klines[klines.length-1].close, source: 'Bybit', weight: 0.95 };
  }

  async fetchOKXKlines() {
      const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch('https://www.okx.com/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=15m&limit=300', { signal: ctrl.signal });
      const data = await res.json();
      if(data.code !== '0') throw new Error("OKX error");
      let klines = data.data.map(c => ({ timestamp: parseFloat(c[0]), open: parseFloat(c[1]), high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]) })).reverse();
      return { klines, price: klines[klines.length-1].close, source: 'OKX', weight: 0.90 };
  }

  // --- 4. FLOW DATA (With Caching for Free-Tier limits) ---
  async fetchFundingRate() {
      try {
          const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 3000);
          const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', { signal: ctrl.signal });
          const data = await res.json();
          return { rate: parseFloat(data.lastFundingRate || 0), valid: true };
      } catch(e) { return { rate: 0, valid: false }; }
  }

  async getCachedOI() {
      const now = Date.now();
      if (flowCache.oi.data && (now - flowCache.oi.timestamp < 300000)) return flowCache.oi.data; // 5 min cache
      try {
          const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 3000);
          const res = await fetch('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=15m&limit=16', { signal: ctrl.signal });
          const data = await res.json();
          let changePercent = 0;
          if (data.length >= 2) {
              const currentOI = parseFloat(data[data.length - 1].sumOpenInterestValue);
              const oldOI = parseFloat(data[0].sumOpenInterestValue);
              changePercent = ((currentOI - oldOI) / oldOI) * 100;
          }
          const result = { changePercent, valid: true };
          flowCache.oi = { data: result, timestamp: now };
          return result;
      } catch(e) { return flowCache.oi.data || { changePercent: 0, valid: false }; }
  }

  async getCachedLSRatio() {
      const now = Date.now();
      if (flowCache.ls.data && (now - flowCache.ls.timestamp < 300000)) return flowCache.ls.data;
      try {
          const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 3000);
          const res = await fetch('https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=5m', { signal: ctrl.signal });
          const data = await res.json();
          const ratio = parseFloat(data.data[0][1]);
          const result = { ratio, valid: true };
          flowCache.ls = { data: result, timestamp: now };
          return result;
      } catch(e) { return flowCache.ls.data || { ratio: 1.0, valid: false }; }
  }

  async getCachedLiquidations() {
      const now = Date.now();
      if (flowCache.liq.data && (now - flowCache.liq.timestamp < 120000)) return flowCache.liq.data; // 2 min cache
      try {
          const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 3000);
          const res = await fetch('https://fapi.binance.com/fapi/v1/allForceOrders?symbol=BTCUSDT&limit=100', { signal: ctrl.signal });
          if (!res.ok) throw new Error();
          const data = await res.json();
          let longLiq = 0, shortLiq = 0, highestLiqPrice = null, maxQty = 0;
          const fifteenMinsAgo = now - 900000;
          data.forEach(order => {
            if (order.time >= fifteenMinsAgo) {
                const qty = parseFloat(order.executedQty), price = parseFloat(order.price);
                if (order.side === 'SELL') longLiq += qty; 
                if (order.side === 'BUY') shortLiq += qty; 
                if (qty > maxQty) { maxQty = qty; highestLiqPrice = price; }
            }
          });
          const result = { longLiq, shortLiq, magnet: highestLiqPrice, valid: true };
          flowCache.liq = { data: result, timestamp: now };
          return result;
      } catch(e) { return flowCache.liq.data || { longLiq: 0, shortLiq: 0, magnet: null, valid: false }; }
  }

  detectRegime(adx, atr, bbWidth, currentPrice) {
      if (adx > 35) return 'STRONG_TREND';
      if (adx > 25 && bbWidth > 0.05) return 'TRENDING';
      if (adx < 20 && bbWidth < 0.03) return 'TIGHT_RANGE';
      if (atr > currentPrice * 0.008 && bbWidth < 0.04) return 'BREAKOUT_IMMINENT';
      return 'CHOP';
  }

  // --- 5. EXECUTION ENGINE v5.1 ---
  async generateSignal() {
      try {
          // Circuit Breaker (3 fails = 1 min cooloff)
          if (this.failureCount >= 3) {
              if (!this.cooldownActive) {
                  this.cooldownActive = true;
                  setTimeout(() => { this.failureCount = 0; this.cooldownActive = false; }, 60000);
              }
              return this.fallback("API Cooldown Mode", true);
          }

          // A. Parallel Fetch
          const [binance, bybit, okx] = await Promise.allSettled([this.fetchBinanceKlines(), this.fetchBybitKlines(), this.fetchOKXKlines()]);
          const validSources = [binance, bybit, okx].filter(r => r.status === 'fulfilled').map(r => r.value);
          
          if (validSources.length === 0) {
              this.failureCount++;
              return this.fallback("Data Outage - All Exchanges Failed");
          }
          this.failureCount = 0;

          // B. Anomaly Checks
          validSources.sort((a,b) => b.weight - a.weight);
          let primary = validSources[0];
          let anomalyFlag = false;
          if (validSources.length >= 3) {
              const prices = validSources.map(v => v.price);
              if ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices) > 0.003) anomalyFlag = true;
          }

          // C. Pull Flow Data
          const [fundingData, oiData, lsData, liqData] = await Promise.all([
              this.fetchFundingRate(), this.getCachedOI(), this.getCachedLSRatio(), this.getCachedLiquidations()
          ]);

          const { klines, source, weight, price: currentPrice } = primary;
          const closes = klines.map(k => k.close);
          const volumes = klines.map(k => k.volume);
          const rsiArray = this.calculateRSIArray(closes, 14);
          const rsi = rsiArray[rsiArray.length - 1];
          const macd = this.calculateMACD(closes);
          const adx = this.calculateADX(klines, 14);
          const atr = this.calculateATR(klines, 14);
          const bb = this.calculateBollingerBands(closes, 20);
          const volProfile = this.calculateVolumeProfile(klines, 100, atr);
          
          const ema20 = this.calculateEMA(closes, 20);
          const ema50 = this.calculateEMA(closes, 50);
          const trend200 = this.calculateEMA(closes, 200);
          const volSMA = this.calculateSMA(volumes.slice(0, -1), 20);
          const relativeVol = Math.max(volumes[volumes.length-1], volumes[volumes.length-2]) / (volSMA || 1);

          let regime = this.detectRegime(adx, atr, bb.width, currentPrice);
          let rawScore = 0;
          const reasons = [];
          const riskFlags = [];

          if (anomalyFlag) { riskFlags.push("Exchange Anomaly (>0.3% div)"); }
          if (validSources.length === 1) { riskFlags.push(`Single Source Only (${source})`); }

          // --- 1. BASE RAW SCORE (Trend + Divergence + Structure) ---
          
          // Trend Alignment
          if (ema20 > ema50 && ema50 > trend200 && currentPrice > trend200) { rawScore += 30; reasons.push("Macro Bullish Alignment"); }
          if (ema20 < ema50 && ema50 < trend200 && currentPrice < trend200) { rawScore -= 30; reasons.push("Macro Bearish Alignment"); }

          // RSI & MACD Swing Divergence
          const rsiDiv = this.detectTrueSwings(closes, rsiArray, 20);
          if (rsiDiv.type !== 'NONE') { rawScore += rsiDiv.score; reasons.push(rsiDiv.type === 'BULLISH' ? 'Bullish RSI Divergence' : 'Bearish RSI Divergence'); }

          const macdDiv = this.detectTrueSwings(closes, macd.histArray, 20);
          if (macdDiv.type !== 'NONE') { rawScore += macdDiv.score; reasons.push(macdDiv.type === 'BULLISH' ? 'Bullish MACD Divergence' : 'Bearish MACD Divergence'); }

          // Flow Adjustments
          let fundingRegime = 'NEUTRAL';
          if (fundingData.valid) {
              if (fundingData.rate > 0.0005) {
                  fundingRegime = 'OVERHEATED';
                  rawScore -= 10;
              } else if (fundingData.rate < -0.0001) {
                  fundingRegime = 'CROWDED_SHORTS';
                  rawScore += 15;
              }
          }

          if (oiData.valid) {
              if (oiData.changePercent > 0.5 && rsi > 50) { rawScore += 15; reasons.push("OI Rising confirming trend"); }
              else if (oiData.changePercent < -0.5 && rsi > 50) { rawScore -= 15; reasons.push("OI Falling (Squeeze risk)"); }
              else if (oiData.changePercent > 0.5 && rsi < 50) { rawScore -= 15; reasons.push("OI Rising confirming shorts"); }
          }

          if (lsData.valid) {
              if (lsData.ratio > 2.0) { rawScore -= 15; reasons.push("Longs Crowded (L/S Ratio High)"); }
              else if (lsData.ratio < 0.8) { rawScore += 15; reasons.push("Shorts Crowded (L/S Ratio Low)"); }
          }

          let liqImbalance = 'NEUTRAL';
          if (liqData.valid && liqData.longLiq > 0 && liqData.shortLiq > 0) {
              if (liqData.longLiq > liqData.shortLiq * 2) {
                  liqImbalance = 'LONG_DOMINANT';
                  if (rsi < 45) { rawScore += 20; reasons.push("Long Liq Exhaustion (Bottom Signal)"); }
              } else if (liqData.shortLiq > liqData.longLiq * 2) {
                  liqImbalance = 'SHORT_DOMINANT';
                  if (rsi > 55) { rawScore -= 20; reasons.push("Short Liq Exhaustion (Top Signal)"); }
              }
          }

          // --- 2. REGIME GATES & TARGETING ---
          if (regime === 'CHOP') { rawScore = 0; reasons.length = 0; reasons.push("Market is CHOP (Consolidating)", "Waiting for volatility expansion..."); riskFlags.push("Regime Block: Chop"); }
          
          let atrMultiplier = 1.5;
          let reqScore = regime === 'STRONG_TREND' ? 50 : 60;
          
          if (regime === 'TIGHT_RANGE') {
              reqScore = 75; atrMultiplier = 1.0;
              if (rsi < 30) rawScore += 40; else if (rsi > 70) rawScore -= 40; else rawScore = 0;
          }
          if (regime === 'BREAKOUT_IMMINENT') {
              reqScore = 45; atrMultiplier = 2.5;
              if (currentPrice > bb.upper && relativeVol > 1.5) { rawScore += 20; reasons.push("Bullish BB Breakout Vol"); }
              else if (currentPrice < bb.lower && relativeVol > 1.5) { rawScore -= 20; reasons.push("Bearish BB Breakout Vol"); }
          }

          // --- 3. APPLY MULTIPLIERS (Volume Penalty / Anomaly) ---
          if (anomalyFlag) rawScore *= 0.6; // Harsh penalty on score confidence
          if (currentPrice > volProfile.vah && relativeVol > 1.2) { rawScore += 15; reasons.push("VAH Breakout Vol"); }
          if (currentPrice < volProfile.val && relativeVol > 1.2) { rawScore -= 15; reasons.push("VAL Breakdown Vol"); }
          if (relativeVol < 0.6) {
              rawScore *= 0.5; // Fakeout / Low Vol
              riskFlags.push("Fakeout/Low Vol Penalty");
          }

          // --- 4. CHECK FINAL SIGNAL ---
          let signal = 'NEUTRAL';
          if (rawScore >= reqScore && regime !== 'CHOP') signal = 'LONG';
          else if (rawScore <= -reqScore && regime !== 'CHOP') signal = 'SHORT';

          // Source Multiplier Check
          let confidence = (Math.abs(rawScore) * 0.5 + (reasons.length * 2)) * weight;
          if (validSources.length >= 2 && !anomalyFlag) confidence *= 1.15; // Cross-validated boost
          if (validSources.length === 1) confidence *= 0.85; // Single source reduction

          confidence = Math.min(95, Math.max(0, confidence));

          // --- 5. EXECUTION MULTIPLIERS EXACT FIX ---
          let marginMultiplier = 0;
          if (signal !== 'NEUTRAL') {
              if (confidence >= 85) marginMultiplier = 0.95;
              else if (confidence >= 70) marginMultiplier = 0.75;
              else if (confidence >= 55) marginMultiplier = 0.50;
              else {
                  marginMultiplier = 0;
                  riskFlags.push(`${signal} Rejected (Conf ${confidence.toFixed(1)}% < 55%)`);
                  signal = 'NEUTRAL';
              }
          }
          if (signal === 'NEUTRAL') confidence = Math.max(0, confidence - 30);

          // Stop Strategy Engine
          const adaptiveAtr = (atr || currentPrice * 0.005) * atrMultiplier;
          let stopLoss = currentPrice, tp1 = currentPrice, tp2 = currentPrice;

          if (signal === 'LONG') {
              stopLoss = currentPrice - adaptiveAtr;
              tp1 = currentPrice + (adaptiveAtr * 1.5);
              tp2 = currentPrice + (adaptiveAtr * 3.0);
              // Hide stop below liquidation cluster if one exists nearby (Liquidation-Aware Stops)
              if (liqData.magnet && liqData.magnet < currentPrice && (currentPrice - liqData.magnet) < atr) {
                  stopLoss = liqData.magnet * 0.999; 
              }
          } else if (signal === 'SHORT') {
              stopLoss = currentPrice + adaptiveAtr;
              tp1 = currentPrice - (adaptiveAtr * 1.5);
              tp2 = currentPrice - (adaptiveAtr * 3.0);
              if (liqData.magnet && liqData.magnet > currentPrice && (liqData.magnet - currentPrice) < atr) {
                  stopLoss = liqData.magnet * 1.001; 
              }
          }

          return {
              signal,
              confidence: Math.round(confidence),
              score: Math.round(rawScore),
              regime,
              marginMultiplier,
              marketStructure: {
                  fundingRate: fundingData.valid ? fundingData.rate : null,
                  fundingRegime,
                  oiChange4h: oiData.valid ? oiData.changePercent.toFixed(2) : null,
                  longShortRatio: lsData.valid ? lsData.ratio.toFixed(2) : null,
                  liqImbalance,
                  liquidationMagnet: liqData.magnet || null,
                  poc: volProfile.poc
              },
              targets: { tp1, tp2, stopLoss, liquidationMagnet: liqData.magnet || null },
              indicators: { rsi: rsi?.toFixed(2), ema20: ema20?.toFixed(2), ema50: ema50?.toFixed(2), macd: macd.hist?.toFixed(4), atr: atr?.toFixed(2), adx: adx?.toFixed(2), bbWidth: bb.width?.toFixed(4), volatility: `${((atr / currentPrice) * 100).toFixed(2)}%` },
              reasons: reasons.slice(0, 8),
              riskFlags,
              timestamp: Date.now()
          };
      } catch (err) {
          console.error("Signal Engine v5.1 Exception:", err);
          return this.fallback(err.message);
      }
  }

  fallback(reason, isCooldown = false) {
      return { 
          signal: 'NEUTRAL', confidence: 0, score: 0, regime: 'UNKNOWN', marginMultiplier: 0,
          marketStructure: { fundingRate: null, oiChange4h: null, longShortRatio: null, liqImbalance: 'NEUTRAL', liquidationMagnet: null, poc: 0 },
          targets: { tp1: 0, tp2: 0, stopLoss: 0, liquidationMagnet: null }, indicators: {},
          reasons: [], riskFlags: [isCooldown ? "Cooldown Mode" : "Data Outage", reason], timestamp: Date.now()
      };
  }
}

export const signalEngine = new SignalEngineV5_1();
