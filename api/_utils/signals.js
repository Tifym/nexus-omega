import { marketFeed } from './market.js';

class SignalEngine {
  constructor() {
    this.priceHistory = [];
    this.maxHistory = 100;
  }

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

  async fetchHistoricalData() {
    try {
      // Coinbase unauthenticated timeline feed to bypass Vercel US IP blocks
      const response = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=300');
      const data = await response.json();
      
      this.priceHistory = data.slice(0, 60).reverse().map(candle => ({
        price: parseFloat(candle[4]), 
        timestamp: candle[0] * 1000,
        spread: 0.1 
      }));
    } catch (error) {
      console.log("Historical data prefill failed:", error);
    }
  }

  async generateSignal() {
    try {
      if (this.priceHistory.length < 20) {
        await this.fetchHistoricalData();
      }

      const consensus = await marketFeed.getConsensusPrice('BTC');
      if (!consensus) throw new Error('Unable to fetch market data');
      
      const fearGreed = await this.fetchFearGreedIndex();
      
      const currentPrice = consensus.consensusPrice;
      this.priceHistory.push({ price: currentPrice, timestamp: Date.now(), spread: consensus.spread });
      if (this.priceHistory.length > this.maxHistory) this.priceHistory.shift();
      
      const indicators = this.calculateIndicators();
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

  calculateIndicators() {
    const prices = this.priceHistory.map(h => h.price);
    if (prices.length < 20) return null;
    
    // Simulate Klines for ATR
    const klines = this.priceHistory.map((h, i, arr) => {
        if (i === 0) return { high: h.price, low: h.price, close: h.price };
        const prev = arr[i-1].price;
        return { 
            high: Math.max(h.price, prev) * 1.001, 
            low: Math.min(h.price, prev) * 0.999, 
            close: h.price 
        };
    });

    return {
      rsi: this.calculateRSI(prices, 14),
      ema20: this.calculateEMA(prices, 20),
      ema50: this.calculateEMA(prices, Math.min(50, prices.length)),
      macd: this.calculateMACD(prices),
      bb: this.calculateBollingerBands(prices, 20),
      atr: this.calculateATR(klines, 14),
      volatility: this.calculateVolatility(prices.slice(-20)),
      higherHighs: this.detectHigherHighs(prices.slice(-20)),
      lowerLows: this.detectLowerLows(prices.slice(-20)),
      support: Math.min(...prices.slice(-20)),
      resistance: Math.max(...prices.slice(-20))
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
    return macdLine;
  }

  calculateBollingerBands(prices, period) {
    const slice = prices.slice(-period);
    const sma = slice.reduce((a, b) => a + b) / period;
    const stdDev = Math.sqrt(slice.map(p => Math.pow(p - sma, 2)).reduce((a, b) => a + b) / period);
    return { upper: sma + (stdDev * 2), middle: sma, lower: sma - (stdDev * 2), width: ((stdDev * 4) / sma) * 100 };
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

  calculateVolatility(prices) {
    if (!prices || prices.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance) * Math.sqrt(365 * 96) * 100;
  }

  detectHigherHighs(prices) {
    let highs = 0;
    for (let i = 2; i < prices.length; i++) {
        if (prices[i] > prices[i-1] && prices[i-1] > prices[i-2]) highs++;
    }
    return highs >= 3;
  }

  detectLowerLows(prices) {
    let lows = 0;
    for (let i = 2; i < prices.length; i++) {
        if (prices[i] < prices[i-1] && prices[i-1] < prices[i-2]) lows++;
    }
    return lows >= 3;
  }

  calculateSignalScore(indicators, currentPrice, consensus, fearGreed) {
    if (!indicators) return { signal: 'NEUTRAL', confidence: 0, score: 0, reasons: [] };
    
    let score = 0;
    const reasons = [];

    if (indicators.rsi < 30) { score += 25; reasons.push(`RSI Oversold (${indicators.rsi.toFixed(1)})`); }
    else if (indicators.rsi < 40) { score += 15; reasons.push(`RSI Low (${indicators.rsi.toFixed(1)})`); }
    else if (indicators.rsi > 70) { score -= 25; reasons.push(`RSI Overbought (${indicators.rsi.toFixed(1)})`); }
    else if (indicators.rsi > 60) { score -= 15; reasons.push(`RSI High (${indicators.rsi.toFixed(1)})`); }

    if (indicators.ema20 > indicators.ema50 && currentPrice > indicators.ema20) {
      score += 20; reasons.push('Bullish EMA Trend (20>50)');
    } else if (indicators.ema20 < indicators.ema50 && currentPrice < indicators.ema20) {
      score -= 20; reasons.push('Bearish EMA Trend (20<50)');
    }

    if (indicators.macd > 0 && indicators.macd > this.calculateMACD(this.priceHistory.map(h=>h.price).slice(0, -1))) {
        score += 15; reasons.push('MACD Bullish Crossover');
    } else if (indicators.macd < 0 && indicators.macd < this.calculateMACD(this.priceHistory.map(h=>h.price).slice(0, -1))) {
        score -= 15; reasons.push('MACD Bearish Crossover');
    }

    if (currentPrice < indicators.bb.lower) { score += 15; reasons.push('Price Below Lower Band'); }
    else if (currentPrice > indicators.bb.upper) { score -= 15; reasons.push('Price Above Upper Band'); }

    if (indicators.higherHighs && !indicators.lowerLows) { score += 15; reasons.push('Higher Highs Pattern'); }
    else if (indicators.lowerLows && !indicators.higherHighs) { score -= 15; reasons.push('Lower Lows Pattern'); }

    const distanceToSupport = ((currentPrice - indicators.support) / indicators.support) * 100;
    const distanceToResistance = ((indicators.resistance - currentPrice) / currentPrice) * 100;
    
    if (distanceToSupport < 2 && distanceToResistance > 5) { score += 10; reasons.push('Near Support'); }
    else if (distanceToResistance < 2 && distanceToSupport > 5) { score -= 10; reasons.push('Near Resistance'); }

    const fearGreedValue = fearGreed?.value || 50;
    if (fearGreedValue < 25) { score += 10; reasons.push('Extreme Fear (Contrarian)'); }
    else if (fearGreedValue > 75) { score -= 10; reasons.push('Extreme Greed (Contrarian)'); }

    if (indicators.volatility > 5) { score *= 0.8; reasons.push('High Volatility Warning'); }

    let signal;
    const confluenceCount = reasons.length;
    let confidence = Math.min(95, Math.max(50, 50 + Math.abs(score) * 0.5 + confluenceCount * 3));
    
    if (score >= 50) { signal = 'STRONG_LONG'; }
    else if (score >= 25) { signal = 'LONG'; }
    else if (score <= -50) { signal = 'STRONG_SHORT'; }
    else if (score <= -25) { signal = 'SHORT'; }
    else { signal = 'NEUTRAL'; confidence = Math.max(30, confidence - 20); }

    // Calculate dynamic SL/TP
    let stopLoss = 0, takeProfit = 0;
    const atrMultiplier = indicators.atr ? (indicators.atr / currentPrice * 100) : 2.5; 
    
    if (signal.includes('LONG')) {
      stopLoss = currentPrice * (1 - Math.max(atrMultiplier * 1.5, 2.5) / 100);
      takeProfit = currentPrice * (1 + 5.0 / 100); // 5% target
    } else if (signal.includes('SHORT')) {
      stopLoss = currentPrice * (1 + Math.max(atrMultiplier * 1.5, 2.5) / 100);
      takeProfit = currentPrice * (1 - 5.0 / 100); 
    } else {
      stopLoss = currentPrice * 0.975;
      takeProfit = currentPrice * 1.05;
    }

    return {
      signal, score: Math.round(score), confidence: Math.round(confidence),
      indicators: { 
          rsi: indicators.rsi?.toFixed(2), 
          ema20: indicators.ema20?.toFixed(2), 
          ema50: indicators.ema50?.toFixed(2), 
          macd: indicators.macd?.toFixed(4), 
          atr: indicators.atr?.toFixed(2),
          volatility: indicators.volatility?.toFixed(2)
      },
      reasons: reasons.slice(0, 6), 
      fearGreed: fearGreedValue,
      stopLoss, takeProfit,
      spread: consensus.spread, exchangesActive: consensus.exchangesUsed
    };
  }
}

export const signalEngine = new SignalEngine();
