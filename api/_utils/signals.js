import { marketFeed } from './market.js';

class SignalEngine {
  async fetchFearGreedIndex() {
    try {
      const resp = await fetch('https://api.alternative.me/fng/');
      const data = await resp.json();
      if (data && data.data && data.data[0]) {
        return {
          value: parseInt(data.data[0].value),
          classification: data.data[0].value_classification
        };
      }
      return null;
    } catch (e) {
      console.log('Fear Greed fetch error', e);
      return null;
    }
  }

  async fetchCleanKlines() {
    try {
      // Fetch exact 15-minute candles from Coinbase for strict timeframe stability (900 seconds)
      const response = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900');
      const data = await response.json();
      
      // Format: [ timestamp, low, high, open, close ] -> Reverse to chronological
      return data.slice(0, 100).reverse().map(c => ({
        timestamp: c[0] * 1000,
        low: parseFloat(c[1]),
        high: parseFloat(c[2]),
        open: parseFloat(c[3]),
        close: parseFloat(c[4])
      }));
    } catch (error) {
      console.log("Historical data fetch failed:", error);
      return [];
    }
  }

  async generateSignal() {
    try {
      const consensus = await marketFeed.getConsensusPrice('BTC');
      if (!consensus) throw new Error('Unable to fetch market data');
      
      const fearGreed = await this.fetchFearGreedIndex();
      const currentPrice = consensus.consensusPrice;
      
      const klines = await this.fetchCleanKlines();
      if (klines.length < 50) throw new Error('Not enough candle data for reliable indicators');

      // Update the tip of the current building candle with real-time price
      const lastCandle = klines[klines.length - 1];
      if (Date.now() - lastCandle.timestamp < 900000) {
        lastCandle.close = currentPrice;
        lastCandle.high = Math.max(lastCandle.high, currentPrice);
        lastCandle.low = Math.min(lastCandle.low, currentPrice);
      }

      const closes = klines.map(k => k.close);
      
      const indicators = {
        rsi: this.calculateRSI(closes, 14),
        ema20: this.calculateEMA(closes, 20),
        ema50: this.calculateEMA(closes, 50),
        ema99: this.calculateEMA(closes, Math.min(closes.length, 99)), // Macro Trend
        macd: this.calculateMACD(closes),
        atr: this.calculateATR(klines, 14),
      };

      const signalData = this.calculateSignalScore(indicators, currentPrice, consensus, fearGreed);
      
      return { 
        ...signalData, 
        price: currentPrice, 
        consensus, 
        isRealData: true,
        timestamp: Date.now()
      };
    } catch (error) {
      return { signal: 'NEUTRAL', confidence: 0, score: 0, error: error.message, isRealData: false, timestamp: Date.now(), reasons: [] };
    }
  }

  calculateRSI(prices, period) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change; else losses += Math.abs(change);
    }
    const avgGain = gains / period, avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  }

  calculateEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
    for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
    return ema;
  }

  calculateMACD(prices) {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    return ema12 - ema26;
  }

  calculateATR(klines, period) {
    if (klines.length < period) return 0;
    const trs = [];
    for (let i = 1; i < klines.length; i++) {
      const high = klines[i].high;
      const low = klines[i].low;
      const prevClose = klines[i-1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr);
    }
    return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  calculateSignalScore(indicators, currentPrice, consensus, fearGreed) {
    if (!indicators) return { signal: 'NEUTRAL', confidence: 0, score: 0, reasons: [] };
    
    let score = 0;
    const reasons = [];

    // 1. MUST align with Macro Trend (15m EMA 99)
    const isMacroBullish = indicators.ema50 > indicators.ema99;
    const isMacroBearish = indicators.ema50 < indicators.ema99;

    if (isMacroBullish) { score += 20; reasons.push('Macro Trend Bullish (EMA50 > EMA99)'); }
    if (isMacroBearish) { score -= 20; reasons.push('Macro Trend Bearish (EMA50 < EMA99)'); }

    // 2. Micro Trend Confirmation
    if (indicators.ema20 > indicators.ema50) { score += 15; reasons.push('Micro Trend Confirmation (EMA20 > 50)'); }
    else if (indicators.ema20 < indicators.ema50) { score -= 15; reasons.push('Micro Trend Confirmation (EMA20 < 50)'); }

    // 3. Momentum (RSI) - Look for value entries
    if (indicators.rsi > 30 && indicators.rsi < 50) { score += 15; reasons.push(`RSI Bullish Rebound (${indicators.rsi.toFixed(1)})`); }
    else if (indicators.rsi < 70 && indicators.rsi > 50) { score -= 15; reasons.push(`RSI Bearish Rejection (${indicators.rsi.toFixed(1)})`); }

    // 4. MACD Trajectory
    if (indicators.macd > 0) { score += 15; reasons.push('MACD Positive Bias'); }
    else { score -= 15; reasons.push('MACD Negative Bias'); }

    // 5. Sentiment
    const fg = fearGreed?.value || 50;
    if (fg < 30) { score += 10; reasons.push('High Fear (Buy Support)'); }
    else if (fg > 70) { score -= 10; reasons.push('High Greed (Sell Pressure)'); }

    let signal;
    // Calculate raw confidence multiplier 
    let confidence = 50 + (Math.abs(score) * 0.45) + (reasons.length * 2);

    // Strict Execution Gate: Only trade if Macro Trend matches Micro Trend to avoid fakeouts
    if (score >= 40 && isMacroBullish && currentPrice > indicators.ema99) { 
      signal = 'LONG'; 
    }
    else if (score <= -40 && isMacroBearish && currentPrice < indicators.ema99) { 
      signal = 'SHORT'; 
    }
    else { 
      signal = 'NEUTRAL'; 
      confidence = Math.max(0, confidence - 30); // Heavily penalize confidence on choppy markets
    }

    confidence = Math.min(95, Math.max(0, confidence));

    // DYNAMIC PROFIT TARGETS: 1:2 Risk/Reward Ratio based on real Market Volume
    const atrValue = indicators.atr || (currentPrice * 0.005); 
    let stopLoss = 0, takeProfit = 0;

    if (signal === 'LONG') {
      stopLoss = currentPrice - (atrValue * 1.5); // Allow 1.5 ATR breathing room
      takeProfit = currentPrice + (atrValue * 3.0); // Target 3.0 ATR profit
    } else if (signal === 'SHORT') {
      stopLoss = currentPrice + (atrValue * 1.5);
      takeProfit = currentPrice - (atrValue * 3.0);
    } else {
      stopLoss = currentPrice * 0.98;
      takeProfit = currentPrice * 1.02;
    }

    return {
      signal, score: Math.round(score), confidence: Math.round(confidence),
      indicators: { 
          rsi: indicators.rsi?.toFixed(2), 
          ema20: indicators.ema20?.toFixed(2), 
          ema50: indicators.ema50?.toFixed(2), 
          macd: indicators.macd?.toFixed(4), 
          atr: indicators.atr?.toFixed(2),
          volatility: 'Live'
      },
      reasons: reasons.slice(0, 6), 
      fearGreed: fg,
      stopLoss, takeProfit,
      spread: consensus.spread, exchangesActive: consensus.exchangesUsed
    };
  }
}

export const signalEngine = new SignalEngine();
