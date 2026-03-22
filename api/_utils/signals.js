import { marketFeed } from './market.js';

class SignalEngine {
  constructor() {
    this.useBinance = true;
    this.failureCount = 0;
  }

  // --- 2. PERFORMANCE OPTIMIZATIONS : FAST INDICATORS ---
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
    let trs = [];
    for (let i = 1; i < klines.length; i++) {
      const curr = klines[i], prev = klines[i-1];
      const tr = Math.max(
          curr.high - curr.low,
          Math.abs(curr.high - prev.close),
          Math.abs(curr.low - prev.close)
      );
      trs.push(tr);
    }
    // Simple Wilder's Smoothing for ATR
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr;
  }

  // Single-pass MACD
  calculateMACD(data) {
    if (data.length < 26) return { macd: 0, signal: 0, hist: 0 };
    
    // Calculate initial EMAs
    let ema12 = data.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    let ema26 = data.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
    const k12 = 2 / 13;
    const k26 = 2 / 27;
    const k9 = 2 / 10;
    
    const macdLine = [];
    
    // Fast forward EMAs to calculate all historical MACD points
    for (let i = 12; i < data.length; i++) {
        ema12 = (data[i] - ema12) * k12 + ema12;
        if (i >= 26) {
            ema26 = (data[i] - ema26) * k26 + ema26;
            macdLine.push(ema12 - ema26);
        }
    }
    
    if (macdLine.length === 0) return { macd: 0, signal: 0, hist: 0 };
    
    // Signal Line (EMA9 of MACD line)
    let signalLine = macdLine.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
    for (let i = 9; i < macdLine.length; i++) {
        signalLine = (macdLine[i] - signalLine) * k9 + signalLine;
    }
    
    const currentMacd = macdLine[macdLine.length - 1];
    
    return {
        macd: currentMacd,
        signal: signalLine,
        hist: currentMacd - signalLine
    };
  }

  // Proper Wilder's ADX
  calculateADX(klines, period = 14) {
    if (klines.length < period * 2) return 20;
    let pDIs = [], mDIs = [], dxs = [];
    let smoothTR = 0, smoothPDM = 0, smoothMDM = 0;
    
    for (let i = 1; i < klines.length; i++) {
        const curr = klines[i];
        const prev = klines[i-1];
        
        const tr = Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close));
        const upMove = curr.high - prev.high;
        const downMove = prev.low - curr.low;
        
        let pDM = (upMove > downMove && upMove > 0) ? upMove : 0;
        let mDM = (downMove > upMove && downMove > 0) ? downMove : 0;
        
        if (i <= period) {
            smoothTR += tr;
            smoothPDM += pDM;
            smoothMDM += mDM;
            if (i === period) {
                const pDI = (smoothPDM / smoothTR) * 100;
                const mDI = (smoothMDM / smoothTR) * 100;
                const dx = (Math.abs(pDI - mDI) / (pDI + mDI)) * 100;
                dxs.push(dx);
            }
        } else {
            smoothTR = smoothTR - (smoothTR / period) + tr;
            smoothPDM = smoothPDM - (smoothPDM / period) + pDM;
            smoothMDM = smoothMDM - (smoothMDM / period) + mDM;
            
            const pDI = (smoothPDM / smoothTR) * 100;
            const mDI = (smoothMDM / smoothTR) * 100;
            const dx = (pDI + mDI !== 0) ? (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 : 0;
            dxs.push(dx);
        }
    }
    
    if (dxs.length < period) return 20;
    
    let adx = dxs.slice(0, period).reduce((a,b)=>a+b,0)/period;
    for(let i = period; i < dxs.length; i++) {
        adx = ((adx * (period-1)) + dxs[i]) / period;
    }
    return adx;
  }

  // --- 6. ERROR HANDLING & VALIDATION ---
  validateDataIntegrity(klines) {
    if (!klines || klines.length < 200) throw new Error("Missing sufficient data (<200 candles)");
    
    // Check Chronological order explicitly
    if (klines[0].timestamp > klines[klines.length - 1].timestamp) {
        throw new Error('Chronological inversion detected');
    }

    // Check Gaps (15m intervals = 900,000ms) - Allow some tolerance for missing candles during exchange maintenance
    let gaps = 0;
    let zeroVolume = 0;
    for (let i = 1; i < klines.length; i++) {
        const diff = klines[i].timestamp - klines[i-1].timestamp;
        if (diff > 900000 * 2) gaps++; // Gap larger than 2 candles
        if (klines[i].volume === 0) zeroVolume++;
    }
    
    if (gaps > 5) throw new Error("Too many data gaps detected (Exchange maintenance?)");
    if (zeroVolume > 10) throw new Error("Too many zero-volume candles detected");
  }

  // --- 3. ALPHA LAYER ADDITION (Liquidations + OI) ---
  async fetchFundingRate() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', { signal: controller.signal });
      clearTimeout(timeoutId);
      if(!res.ok) return { rate: 0, valid: false };
      const data = await res.json();
      return { rate: parseFloat(data.lastFundingRate), valid: true };
    } catch(err) {
      return { rate: 0, valid: false };
    }
  }

  async fetchOpenInterest() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      // Fetch OI over last 4h (16 periods of 15m)
      const res = await fetch('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=15m&limit=16', { signal: controller.signal });
      clearTimeout(timeoutId);
      if(!res.ok) return { changePercent: 0, valid: false };
      
      const data = await res.json();
      if (data.length < 2) return { changePercent: 0, valid: false };
      
      const currentOI = parseFloat(data[data.length - 1].sumOpenInterestValue);
      const oldOI = parseFloat(data[0].sumOpenInterestValue);
      const changePercent = ((currentOI - oldOI) / oldOI) * 100;
      
      return { changePercent, valid: true };
    } catch(err) {
      return { changePercent: 0, valid: false };
    }
  }

  async fetchLiquidations() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      // allForceOrders returns recent liquidations. Public endpoint.
      const res = await fetch('https://fapi.binance.com/fapi/v1/allForceOrders?symbol=BTCUSDT&limit=100', { signal: controller.signal });
      clearTimeout(timeoutId);
      if(!res.ok) return { longLiq: 0, shortLiq: 0, magnet: null, valid: false };
      
      const data = await res.json();
      let longLiq = 0, shortLiq = 0;
      let highestLiqPrice = null;
      let maxQty = 0;
      
      // Calculate liquidation totals and find largest cluster
      const fifteenMinsAgo = Date.now() - 900000;
      data.forEach(order => {
        if (order.time >= fifteenMinsAgo) {
            const qty = parseFloat(order.executedQty);
            const price = parseFloat(order.price);
            if (order.side === 'SELL') longLiq += qty; // Longs getting liquidated
            if (order.side === 'BUY') shortLiq += qty; // Shorts getting liquidated
            
            if (qty > maxQty) {
                maxQty = qty;
                highestLiqPrice = price;
            }
        }
      });
      return { longLiq, shortLiq, magnet: highestLiqPrice, valid: true };
    } catch(err) {
      return { longLiq: 0, shortLiq: 0, magnet: null, valid: false };
    }
  }

  async fetchKlines() {
    let klines = [];
    let source = 'binance';
    const limit = 300; // Extend lookback to 300
    
    try {
      if (!this.useBinance) throw new Error("Binance skipped");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      // Binance returns oldest -> newest
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
      source = 'coinbase';
      try {
          const res = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900');
          const data = await res.json();
          // Coinbase returns newest -> oldest. Use exact reverse()!
          klines = data.slice(0, limit).reverse().map(c => ({
            timestamp: c[0] * 1000,
            low: parseFloat(c[1]),
            high: parseFloat(c[2]),
            open: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseFloat(c[5]) || 0 // Correct volume mapping mapping index [5]
          }));
      } catch(e) {
          throw new Error("Both data sources failed");
      }
    }
    
    // Explicit Validation
    this.validateDataIntegrity(klines);
    return { klines, source };
  }

  async generateSignal() {
    try {
      // Circuit Breaker
      if (this.failureCount >= 3) {
          setTimeout(() => { this.failureCount = 0; }, 60000); // Cool off 1 min
          return this.fallback("API Unstable", true, true);
      }

      // Use Promise.allSettled so partial failures don't kill the signal
      const results = await Promise.allSettled([
          marketFeed.getConsensusPrice('BTC'),
          this.fetchKlines(),
          this.fetchFundingRate(),
          this.fetchOpenInterest(),
          this.fetchLiquidations()
      ]);

      const consensusResult = results[0];
      const klineResult = results[1];
      
      if (consensusResult.status === 'rejected' || klineResult.status === 'rejected') {
          this.failureCount++;
          throw new Error("Critical data missing (Price or Klines)");
      }

      const consensus = consensusResult.value;
      const { klines, source } = klineResult.value;
      const fundingData = results[2].status === 'fulfilled' ? results[2].value : { valid: false, rate: 0 };
      const oiData = results[3].status === 'fulfilled' ? results[3].value : { valid: false, changePercent: 0 };
      const liqData = results[4].status === 'fulfilled' ? results[4].value : { valid: false, longLiq: 0, shortLiq: 0 };

      this.failureCount = 0; // Reset
      const currentPrice = consensus.consensusPrice;

      // Time validation - reject if stale
      const lastCandleTime = klines[klines.length - 1].timestamp;
      if (Date.now() - lastCandleTime > 1800000) { 
          return this.fallback("Stale market data protection active.", true, false);
      }

      // Risk Flags array
      const riskFlags = [];
      if (source === 'coinbase') riskFlags.push("Fallback Source (Coinbase) -20% conf");
      if (!fundingData.valid) riskFlags.push("Missing Funding Data");
      if (!oiData.valid) riskFlags.push("Missing OI Data");
      if (!liqData.valid) riskFlags.push("Missing Flow Data");

      const closes = klines.map(k => k.close);
      const volumes = klines.map(k => k.volume);
      
      // Calculate Leading & Lagging Indicators
      const adx = this.calculateADX(klines, 14); // Lagging
      const macd = this.calculateMACD(closes); // Lagging
      const rsi = this.calculateRSI(closes, 14); // Momentum
      
      const ema20 = this.calculateEMA(closes, 20); // Fast Trend
      const ema50 = this.calculateEMA(closes, 50); // Slow Trend
      const trend200 = this.calculateEMA(closes, 200); // ~50 hours Session Trend
      
      const atr = this.calculateATR(klines, 14); // Volatility
      const volSMA = this.calculateSMA(volumes, 20); // Avg Volume
      const currentVol = volumes[volumes.length - 1];

      // Regime Detection
      let regime = 'RANGING';
      if (adx > 30) regime = 'TRENDING';
      else if (atr > currentPrice * 0.006) regime = 'HIGH_VOLATILITY';

      // --- 4. SIGNAL SCORING SYSTEM ---
      let rawScore = 0;
      let confidence = 50; 
      const reasons = [];

      // A. Trend Alignment (30% weight)
      const trendBullish = ema20 > ema50 && ema50 > trend200 && currentPrice > trend200;
      const trendBearish = ema20 < ema50 && ema50 < trend200 && currentPrice < trend200;
      
      if (trendBullish) { rawScore += 30; reasons.push("Perfect Trend Alignment (Bullish)"); }
      if (trendBearish) { rawScore -= 30; reasons.push("Perfect Trend Alignment (Bearish)"); }

      // B. Momentum (RSI + MACD) (25% weight)
      if (regime === 'TRENDING') {
          if (trendBullish && rsi > 50) { rawScore += 15; reasons.push(`Trend Momentum Confirm (RSI ${rsi.toFixed(1)})`); }
          if (trendBullish && rsi < 40) { rawScore += 10; reasons.push(`Trend Pullback Buy (RSI ${rsi.toFixed(1)})`); }
          if (trendBearish && rsi < 50) { rawScore -= 15; reasons.push(`Trend Momentum Confirm (RSI ${rsi.toFixed(1)})`); }
      } else {
          // Mean Reversion (Chop filter)
          if (rsi < 30) { rawScore += 25; reasons.push(`Mean-Reversion Oversold (RSI ${rsi.toFixed(1)})`); }
          if (rsi > 70) { rawScore -= 25; reasons.push(`Mean-Reversion Overbought (RSI ${rsi.toFixed(1)})`); }
      }

      if (macd.hist > 0) { rawScore += 10; reasons.push("MACD Hist Positive (Momentum)"); }
      else if (macd.hist < 0) { rawScore -= 10; reasons.push("MACD Hist Negative (Momentum)"); }

      // C. Market Structure (Funding + OI) (25% weight)
      // 0.05% = 0.0005. 0.01% = 0.0001
      let fundingRegime = 'NEUTRAL';
      let liqImbalance = 'NEUTRAL';

      if (fundingData.valid) {
          if (fundingData.rate > 0.0005) {
              fundingRegime = 'OVERHEATED';
              if (oiData.valid && oiData.changePercent > 5) {
                  rawScore -= 25; reasons.push(`Overcrowded Longs Building (FR: ${(fundingData.rate*100).toFixed(3)}%, OI: +${oiData.changePercent.toFixed(1)}%)`);
                  riskFlags.push("Crowded Long Buildup");
              } else {
                  rawScore -= 15; reasons.push(`High Funding Rate (${(fundingData.rate*100).toFixed(3)}%)`); 
              }
          } else if (fundingData.rate < -0.0001) {
              fundingRegime = 'CROWDED_SHORTS';
              rawScore += 20; reasons.push(`Shorts Paying Heavily (FR: ${(fundingData.rate*100).toFixed(3)}%)`);
          }
      }

      if (oiData.valid && oiData.changePercent > 0 && rsi > 50) {
          rawScore += 10; reasons.push("OI Rising w/ Price (Trend Confidence)");
      } else if (oiData.valid && oiData.changePercent < 0 && rsi > 50) {
          rawScore -= 10; reasons.push("OI Falling w/ Price (Squeeze Risk)");
          riskFlags.push("Squeeze Risk");
      }

      // D. Liquidation Extremes (Exhaustion Detection)
      if (liqData.valid) {
          if (liqData.longLiq > liqData.shortLiq * 3) {
              liqImbalance = 'LONG_DOMINANT'; // Longs wiped out
              if (rsi < 45) { rawScore += 15; reasons.push("Long Liquidation Exhaustion (Bottom Signal)"); }
          } else if (liqData.shortLiq > liqData.longLiq * 3) {
              liqImbalance = 'SHORT_DOMINANT';
              if (rsi > 55) { rawScore -= 15; reasons.push("Short Liquidation Exhaustion (Top Signal)"); }
          }
      }

      // 4. Determine Dynamic Signal Thresholds
      let signal = 'NEUTRAL';
      let scoreRequirement = regime === 'TRENDING' ? 60 : 75; // Weak trend needs higher score

      // E. Volume Penalty Logic (Move to End)
      const relativeVol = currentVol / (volSMA || 1);
      let finalScore = rawScore;
      if (relativeVol < 0.5) {
          finalScore = finalScore * 0.5; // Halve the conviction
          riskFlags.push(`Low Volume (${relativeVol.toFixed(1)}x avg)`);
      } else if (relativeVol > 1.5) {
          if (closes[closes.length-1] > closes[closes.length-2]) { finalScore += 10; reasons.push("Bullish Vol Confirmed"); }
          else { finalScore -= 10; reasons.push("Bearish Vol Confirmed"); }
      }

      if (finalScore >= scoreRequirement) signal = 'LONG';
      else if (finalScore <= -scoreRequirement) signal = 'SHORT';

      // 5. Calculate Final Confidence
      confidence += Math.abs(finalScore) * 0.3 + (reasons.length * 1.5);
      if (source === 'coinbase') confidence -= 10; // Fallback penalty

      if (signal === 'NEUTRAL') confidence = Math.max(0, confidence - 30);
      confidence = Math.min(85, Math.max(0, confidence)); // Hard Cap at 85%

      // 6. Dynamic ATR Execution & Liquidation Magnets
      // Session Logic: Asian (00:00-08:00 UTC) = lower liquidity = 1.8x. NY/London = 1.2x.
      const currentHour = new Date().getUTCHours();
      const isAsianSession = currentHour >= 0 && currentHour < 8;
      const atrMultiplier = isAsianSession ? 1.8 : 1.2; 
      
      const adaptiveAtr = (atr || currentPrice * 0.005) * atrMultiplier;

      let stopLoss = currentPrice, tp1 = currentPrice, tp2 = currentPrice;

      if (signal === 'LONG') {
          stopLoss = currentPrice - (adaptiveAtr * 1.5);
          tp1 = currentPrice + (adaptiveAtr * 1.5);
          tp2 = currentPrice + (adaptiveAtr * 3.0);
          
          // Tighten stops if near short liq cluster (hunter protection)
          if (liqData.magnet && liqData.magnet < currentPrice && (currentPrice - liqData.magnet) < adaptiveAtr) {
              stopLoss = liqData.magnet * 0.999; 
              riskFlags.push("Stop Loss Adjusted below Liquidations");
          }
      } else if (signal === 'SHORT') {
          stopLoss = currentPrice + (adaptiveAtr * 1.5);
          tp1 = currentPrice - (adaptiveAtr * 1.5);
          tp2 = currentPrice - (adaptiveAtr * 3.0);
          
          if (liqData.magnet && liqData.magnet > currentPrice && (liqData.magnet - currentPrice) < adaptiveAtr) {
              stopLoss = liqData.magnet * 1.001; 
              riskFlags.push("Stop Loss Adjusted above Liquidations");
          }
      }

      // --- 7. V4 OUTPUT STRUCTURE ---
      return {
          signal,
          confidence: Math.round(confidence),
          score: Math.round(finalScore),
          regime,
          marketStructure: {
              fundingRate: fundingData.valid ? fundingData.rate : null,
              oiChange4h: oiData.valid ? oiData.changePercent.toFixed(2) : null,
              liqImbalance,
              liquidationMagnet: liqData.magnet || null
          },
          entryConditions: {
              price: currentPrice,
              validAbove: ema50,
              invalidBelow: stopLoss,
              volumeConfirmed: relativeVol > 1.0,
              fundingRegime
          },
          targets: {
              tp1, tp2, stopLoss, liquidationMagnet: liqData.magnet || null
          },
          indicators: {
              rsi: rsi?.toFixed(2),
              ema20: ema20?.toFixed(2),
              ema50: ema50?.toFixed(2),
              macd: macd.hist?.toFixed(4),
              atr: atr?.toFixed(2),
              adx: adx?.toFixed(2)
          },
          reasons: reasons.slice(0, 8),
          riskFlags,
          timestamp: Date.now()
      };

    } catch (err) {
        console.error("Signal Engine v4 Exception:", err);
        return this.fallback(err.message, false, false);
    }
  }

  fallback(reason, isApiStable = true, isRealData = true) {
      return { 
          signal: 'NEUTRAL', confidence: 0, score: 0, regime: 'UNKNOWN',
          marketStructure: { fundingRate: null, oiChange4h: null, liqImbalance: 'NEUTRAL', liquidationMagnet: null },
          entryConditions: { price: 0, validAbove: 0, invalidBelow: 0, volumeConfirmed: false, fundingRegime: 'NEUTRAL' },
          targets: { tp1: 0, tp2: 0, stopLoss: 0, liquidationMagnet: null },
          indicators: {},
          reasons: [], riskFlags: [reason, isApiStable ? "" : "API Unstable"], timestamp: Date.now()
      };
  }
}

export const signalEngine = new SignalEngine();
