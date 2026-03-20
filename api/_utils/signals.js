import { marketFeed } from './market.js';

class SignalEngine {
  constructor() {
    this.priceHistory = [];
    this.maxHistory = 100;
  }

  async fetchHistoricalData() {
    try {
      // Fetch 50 historical 5-minute candles to instantly initialize the EMA and RSI indicators!
      const response = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=50');
      const data = await response.json();
      this.priceHistory = data.map(candle => ({
        price: parseFloat(candle[4]),
        timestamp: candle[6],
        spread: 0 // Spread is moot for historical data 
      }));
    } catch (error) {
      console.log("Historical data prefill failed:", error);
    }
  }

  async generateSignal() {
    try {
      // Instantly backfill memory history if the server just cold-booted!
      if (this.priceHistory.length < 50) {
        await this.fetchHistoricalData();
      }

      const consensus = await marketFeed.getConsensusPrice('BTC');
      if (!consensus) throw new Error('Unable to fetch market data');
      
      const currentPrice = consensus.consensusPrice;
      this.priceHistory.push({ price: currentPrice, timestamp: Date.now(), spread: consensus.spread });
      if (this.priceHistory.length > this.maxHistory) this.priceHistory.shift();
      
      const indicators = this.calculateIndicators();
      const signalData = this.calculateSignalScore(indicators, currentPrice, consensus);
      
      return { ...signalData, price: currentPrice, consensus, timestamp: Date.now(), isRealData: true };
    } catch (error) {
      return { signal: 'NEUTRAL', confidence: 0, score: 0, error: error.message, isRealData: false, timestamp: Date.now() };
    }
  }

  calculateIndicators() {
    const prices = this.priceHistory.map(h => h.price);
    if (prices.length < 50) return null;
    
    return {
      rsi: this.calculateRSI(prices, 14),
      ema20: this.calculateEMA(prices, 20),
      ema50: this.calculateEMA(prices, 50),
      macd: this.calculateMACD(prices),
      bb: this.calculateBollingerBands(prices, 20),
      atr: this.calculateATR(prices, 14),
      volumeTrend: this.estimateVolumeTrend(prices)
    };
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
    const macdLine = ema12 - ema26;
    return {
      macd: macdLine,
      signal: this.calculateEMA(prices.slice(-9), 9),
      histogram: macdLine - this.calculateEMA(prices.slice(-9), 9),
      bullish: macdLine > this.calculateEMA(prices.slice(-9), 9) && macdLine > 0,
      bearish: macdLine < this.calculateEMA(prices.slice(-9), 9) && macdLine < 0
    };
  }

  calculateBollingerBands(prices, period) {
    const slice = prices.slice(-period);
    const sma = slice.reduce((a, b) => a + b) / period;
    const stdDev = Math.sqrt(slice.map(p => Math.pow(p - sma, 2)).reduce((a, b) => a + b) / period);
    return { upper: sma + (stdDev * 2), middle: sma, lower: sma - (stdDev * 2), width: ((stdDev * 4) / sma) * 100 };
  }

  calculateATR(prices, period) {
    if (prices.length < period + 1) return 0;
    let trSum = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      trSum += Math.max(prices[i], prices[i-1]) - Math.min(prices[i], prices[i-1]);
    }
    return trSum / period;
  }

  estimateVolumeTrend(prices) {
    const recent = prices.slice(-5);
    const volatility = (Math.max(...recent) - Math.min(...recent)) / recent[recent.length - 1];
    return { high: volatility > 0.02, spike: volatility > 0.05 };
  }

  calculateSignalScore(indicators, currentPrice, consensus) {
    if (!indicators) return { signal: 'NEUTRAL', confidence: 0, score: 0, reasons: [] };
    
    let score = 0;
    const reasons = [];

    if (indicators.rsi < 30) { score += 25; reasons.push({ type: 'RSI_OVERSOLD', value: indicators.rsi, impact: 25 }); }
    else if (indicators.rsi < 40) { score += 15; reasons.push({ type: 'RSI_LOW', value: indicators.rsi, impact: 15 }); }
    else if (indicators.rsi > 70) { score -= 25; reasons.push({ type: 'RSI_OVERBOUGHT', value: indicators.rsi, impact: -25 }); }
    else if (indicators.rsi > 60) { score -= 15; reasons.push({ type: 'RSI_HIGH', value: indicators.rsi, impact: -15 }); }

    if (indicators.ema20 > indicators.ema50 && currentPrice > indicators.ema20) {
      score += 20; reasons.push({ type: 'EMA_BULLISH', impact: 20 });
    } else if (indicators.ema20 < indicators.ema50 && currentPrice < indicators.ema20) {
      score -= 20; reasons.push({ type: 'EMA_BEARISH', impact: -20 });
    }

    if (indicators.macd.bullish) { score += 15; reasons.push({ type: 'MACD_BULLISH', impact: 15 }); }
    else if (indicators.macd.bearish) { score -= 15; reasons.push({ type: 'MACD_BEARISH', impact: -15 }); }

    if (currentPrice < indicators.bb.lower) { score += 15; reasons.push({ type: 'BB_OVERSOLD', impact: 15 }); }
    else if (currentPrice > indicators.bb.upper) { score -= 15; reasons.push({ type: 'BB_OVERBOUGHT', impact: -15 }); }

    if (indicators.volumeTrend.spike) {
      const direction = score > 0 ? 10 : -10;
      score += direction;
      reasons.push({ type: 'VOLATILE', impact: direction });
    }

    let spreadPenalty = 0;
    if (consensus.spread > 0.5) {
      spreadPenalty = Math.min(20, consensus.spread * 2);
      reasons.push({ type: 'HIGH_SPREAD', value: consensus.spread, impact: -spreadPenalty });
    }

    let signal, confidence;
    const absScore = Math.abs(score);
    
    if (score >= 40) { signal = 'STRONG_LONG'; confidence = Math.min(95, 65 + absScore - 40 - spreadPenalty); }
    else if (score >= 15) { signal = 'LONG'; confidence = Math.min(85, 50 + absScore - 15 - spreadPenalty); }
    else if (score <= -40) { signal = 'STRONG_SHORT'; confidence = Math.min(95, 65 + absScore - 40 - spreadPenalty); }
    else if (score <= -15) { signal = 'SHORT'; confidence = Math.min(85, 50 + absScore - 15 - spreadPenalty); }
    else { signal = 'NEUTRAL'; confidence = Math.max(30, 50 - absScore); }

    return {
      signal, score, confidence: Math.max(0, confidence),
      indicators: { rsi: indicators.rsi, ema20: indicators.ema20, ema50: indicators.ema50, macd: indicators.macd.macd, bbUpper: indicators.bb.upper, bbLower: indicators.bb.lower, atr: indicators.atr },
      reasons, spread: consensus.spread, exchangesActive: consensus.exchangesUsed
    };
  }
}

export const signalEngine = new SignalEngine();
