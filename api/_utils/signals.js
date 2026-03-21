import { marketFeed } from './market.js';

class SignalEngine {
  constructor() {
    this.useBinance = true;
  }

  // Helper Functions
  calculateEMA(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
        ema = (data[i] - ema) * k + ema;
    }
    return ema;
  }

  calculateSMA(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  calculateRSI(data, period) {
    if (data.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
      const change = data[i] - data[i - 1];
      if (change > 0) gains += change; else losses += Math.abs(change);
    }
    const avgGain = gains / period, avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  }

  calculateATR(klines, period) {
    if (klines.length < period) return 0;
    const trs = [];
    for (let i = 1; i < klines.length; i++) {
      const curr = klines[i], prev = klines[i-1];
      const tr = Math.max(
          curr.high - curr.low,
          Math.abs(curr.high - prev.close),
          Math.abs(curr.low - prev.close)
      );
      trs.push(tr);
    }
    return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  calculateMACD(data) {
    if (data.length < 26) return { macd: 0, signal: 0, hist: 0 };
    const emas12 = [];
    const emas26 = [];
    for(let i=12; i<=data.length; i++) emas12.push(this.calculateEMA(data.slice(0, i), 12));
    for(let i=26; i<=data.length; i++) emas26.push(this.calculateEMA(data.slice(0, i), 26));
    
    const macdLine = [];
    for(let i=0; i<emas26.length; i++) {
        macdLine.push(emas12[emas12.length - emas26.length + i] - emas26[i]);
    }
    
    const signalLine = this.calculateEMA(macdLine, 9);
    const currentMacd = macdLine[macdLine.length - 1];
    
    return {
        macd: currentMacd,
        signal: signalLine,
        hist: currentMacd - signalLine
    };
  }

  calculateADX(klines, period = 14) {
    if (klines.length < period * 2) return 20;
    let trs = [], pDMs = [], mDMs = [];
    
    for (let i = 1; i < klines.length; i++) {
        const curr = klines[i];
        const prev = klines[i-1];
        const tr = Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close));
        const upMove = curr.high - prev.high;
        const downMove = prev.low - curr.low;
        let pDM = 0, mDM = 0;
        if (upMove > downMove && upMove > 0) pDM = upMove;
        if (downMove > upMove && downMove > 0) mDM = downMove;
        
        trs.push(tr); pDMs.push(pDM); mDMs.push(mDM);
    }
    
    const wilderSmooth = (values, p) => {
        let smoothed = [values.slice(0, p).reduce((a, b) => a + b, 0)];
        for (let i = p; i < values.length; i++) {
            smoothed.push(smoothed[smoothed.length - 1] - (smoothed[smoothed.length - 1] / p) + values[i]);
        }
        return smoothed;
    };
    
    const smoothedTR = wilderSmooth(trs, period);
    const smoothedPDM = wilderSmooth(pDMs, period);
    const smoothedMDM = wilderSmooth(mDMs, period);
    
    let dxs = [];
    for (let i = 0; i < smoothedTR.length; i++) {
        const tr = smoothedTR[i];
        if (tr === 0) { dxs.push(0); continue; }
        const pDI = (smoothedPDM[i] / tr) * 100;
        const mDI = (smoothedMDM[i] / tr) * 100;
        let dx = 0;
        if (pDI + mDI !== 0) dx = (Math.abs(pDI - mDI) / (pDI + mDI)) * 100;
        dxs.push(dx);
    }
    
    let adx = dxs.slice(0, period).reduce((a,b)=>a+b,0)/period;
    for(let i = period; i<dxs.length; i++) {
        adx = ((adx * (period-1)) + dxs[i]) / period;
    }
    return adx;
  }

  // Data Fetching
  async fetchFundingRate() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', { signal: controller.signal });
      clearTimeout(timeoutId);
      if(!res.ok) throw new Error("Binance FR fail");
      const data = await res.json();
      return { rate: parseFloat(data.lastFundingRate), valid: true };
    } catch(err) {
      return { rate: 0, valid: false };
    }
  }

  async fetchKlines() {
    let klines = [];
    let source = 'binance';
    const limit = 300;
    
    try {
      if (!this.useBinance) throw new Error("Binance skipped");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=${limit}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if(!res.ok) throw new Error("Binance Klines fail");
      
      const data = await res.json();
      klines = data.map(c => ({
        timestamp: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5])
      }));
    } catch(err) {
      // Fallback to Coinbase
      source = 'coinbase';
      try {
          const res = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900');
          const data = await res.json();
          klines = data.slice(0, limit).reverse().map(c => ({
            timestamp: c[0] * 1000,
            low: parseFloat(c[1]),
            high: parseFloat(c[2]),
            open: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5])
          }));
      } catch(e) {
          console.error("All history failed", e);
      }
    }
    return { klines, source };
  }

  async generateSignal() {
    try {
      const [consensus, fundingData, klineData] = await Promise.all([
          marketFeed.getConsensusPrice('BTC'),
          this.fetchFundingRate(),
          this.fetchKlines()
      ]);

      if (!consensus) throw new Error("Consensus failed");
      const { klines, source } = klineData;
      const currentPrice = consensus.consensusPrice;

      if (klines.length < 200) {
          return this.fallbackNeutral("Insufficient candle data (<200).");
      }

      // Time validation - reject if stale
      const lastCandleTime = klines[klines.length - 1].timestamp;
      if (Date.now() - lastCandleTime > 1800000) { // older than 30 mins
          return this.fallbackNeutral("Stale market data protection active.");
      }

      const riskFlags = [];
      if (source === 'coinbase') riskFlags.push("Fallback Source (Coinbase)");
      if (!fundingData.valid) riskFlags.push("Missing Flow Data");

      const closes = klines.map(k => k.close);
      const volumes = klines.map(k => k.volume);
      
      const adx = this.calculateADX(klines, 14);
      const macd = this.calculateMACD(closes);
      const rsi = this.calculateRSI(closes, 14);
      
      const ema20 = this.calculateEMA(closes, 20);
      const ema50 = this.calculateEMA(closes, 50);
      const ema99 = this.calculateEMA(closes, 99); // Session Trend
      
      // 4H Trend Approx (16 candles of 15m)
      const ema4H_200 = this.calculateEMA(closes, 200) || ema50; 
      
      const atr = this.calculateATR(klines, 14);
      const volSMA = this.calculateSMA(volumes, 20);
      const currentVol = volumes[volumes.length - 1];

      // Regime Detection
      let regime = 'RANGING';
      if (adx > 30) regime = 'TRENDING';
      else if (atr > currentPrice * 0.006) regime = 'HIGH_VOLATILITY';

      let score = 0;
      let confidence = 50; 
      const reasons = [];

      // 1. Trend Alignment (30% weight)
      // Check if 15m aligns with 4H macro
      const macroBullish = currentPrice > ema4H_200 && ema50 > ema99;
      const macroBearish = currentPrice < ema4H_200 && ema50 < ema99;
      
      if (macroBullish) { score += 30; reasons.push("15m/4H Macro Trend Confluence (Bullish)"); }
      if (macroBearish) { score -= 30; reasons.push("15m/4H Macro Trend Confluence (Bearish)"); }

      // 2. Momentum (25% weight)
      if (regime === 'TRENDING') {
          if (macroBullish && rsi > 50) { score += 15; reasons.push(`Trending Bull Momentum (RSI ${rsi.toFixed(1)})`); }
          if (macroBullish && rsi < 40) { score += 10; reasons.push(`Trending Pullback Opportunity (RSI ${rsi.toFixed(1)})`); }
          if (macroBearish && rsi < 50) { score -= 15; reasons.push(`Trending Bear Momentum (RSI ${rsi.toFixed(1)})`); }
          if (macroBearish && rsi > 60) { score -= 10; reasons.push(`Trending Bear Bounce (RSI ${rsi.toFixed(1)})`); }
      } else {
          // Ranging Mode (Mean Reversion)
          if (rsi < 30) { score += 25; reasons.push(`Mean-Reversion Oversold (RSI ${rsi.toFixed(1)})`); }
          if (rsi > 70) { score -= 25; reasons.push(`Mean-Reversion Overbought (RSI ${rsi.toFixed(1)})`); }
      }

      // MACD Histogram confirms momentum
      if (macd.hist > 0) { score += 10; reasons.push("MACD Histogram Positive"); }
      if (macd.hist < 0) { score -= 10; reasons.push("MACD Histogram Negative"); }

      // 3. Market Structure (Funding Rate / Crowded Trades)
      if (fundingData.valid) {
          if (fundingData.rate > 0.015) { 
              score -= 20; reasons.push(`Overcrowded Longs (Funding: ${(fundingData.rate*100).toFixed(3)}%)`); 
              riskFlags.push("High Funding/Crowded Long");
          } else if (fundingData.rate < -0.015) { 
              score += 20; reasons.push(`Overcrowded Shorts (Funding: ${(fundingData.rate*100).toFixed(3)}%)`); 
              riskFlags.push("Negative Funding/Crowded Short");
          } else {
              reasons.push("Neutral Funding Market Structure");
          }
      }

      // 4. Volume Confirmation (20% weight)
      const relativeVol = currentVol / (volSMA || 1);
      if (relativeVol > 1.5) {
          if (closes[closes.length-1] > closes[closes.length-2]) { score += 10; reasons.push(`Strong Bullish Volume (${relativeVol.toFixed(1)}x avg)`); }
          else { score -= 10; reasons.push(`Strong Bearish Volume (${relativeVol.toFixed(1)}x avg)`); }
      } else if (relativeVol < 0.5) {
          riskFlags.push("Low Volume");
          score = score * 0.5; // Halve the score conviction on low volume
      }

      // Determine Signal & Confidence based on Regime Thresholds
      let signal = 'NEUTRAL';
      confidence += Math.abs(score) * 0.3 + (reasons.length * 1.5);

      if (regime === 'TRENDING') {
          if (score >= 60) signal = 'LONG';
          else if (score <= -60) signal = 'SHORT';
      } else {
          // Chop filter: require higher score to trade in ranging market
          if (score >= 75) signal = 'LONG';
          else if (score <= -75) signal = 'SHORT';
      }

      // Max Confidence Cap (Hunter Protection)
      confidence = Math.min(85, Math.max(0, confidence));
      if (signal === 'NEUTRAL') confidence = Math.max(0, confidence - 30);

      const isAsianSession = new Date().getUTCHours() >= 0 && new Date().getUTCHours() < 8;
      const volMultiplier = isAsianSession ? 1.2 : 1.8;
      const adaptiveAtr = (atr || currentPrice * 0.005) * volMultiplier;

      let stopLoss = currentPrice, tp1 = currentPrice, tp2 = currentPrice;

      if (signal === 'LONG') {
          stopLoss = currentPrice - (adaptiveAtr * 1.5);
          tp1 = currentPrice + (adaptiveAtr * 1.5);
          tp2 = currentPrice + (adaptiveAtr * 3.0);
      } else if (signal === 'SHORT') {
          stopLoss = currentPrice + (adaptiveAtr * 1.5);
          tp1 = currentPrice - (adaptiveAtr * 1.5);
          tp2 = currentPrice - (adaptiveAtr * 3.0);
      }

      return {
          signal,
          confidence: Math.round(confidence),
          score: Math.round(score),
          regime,
          entryConditions: {
              price: currentPrice,
              validAbove: ema50,
              volumeConfirmed: relativeVol > 1.0,
              fundingRegime: fundingData.rate > 0.01 ? 'OVERHEATED' : (fundingData.rate < -0.01 ? 'CROWDED_SHORTS' : 'NEUTRAL')
          },
          targets: {
              tp1, tp2, stopLoss, liquidationMagnet: null
          },
          reasons: reasons.slice(0, 8),
          riskFlags,
          timestamp: Date.now()
      };

    } catch (err) {
        console.error("Signal Engine v3 Exception:", err);
        return this.fallbackNeutral(err.message);
    }
  }

  fallbackNeutral(reason) {
      return { 
          signal: 'NEUTRAL', confidence: 0, score: 0, regime: 'UNKNOWN',
          targets: { tp1: 0, tp2: 0, stopLoss: 0, liquidationMagnet: null },
          reasons: [], riskFlags: [reason], timestamp: Date.now()
      };
  }
}

export const signalEngine = new SignalEngine();
