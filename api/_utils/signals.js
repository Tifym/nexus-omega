import { marketFeed } from './market.js';

class SignalEngine {
  constructor() {
    this.priceHistory = [];
    this.candleHistory = []; 
    this.maxHistory = 100;
  }

  async fetchHistoricalData() {
    try {
      // Unblockable Coinbase historical timeline to outsmart Vercel/Binance IP firewalls
      const response = await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900'); // 15m intervals
      const data = await response.json();
      
      this.candleHistory = data.slice(0, 100).reverse().map(candle => ({
        timestamp: candle[0] * 1000,
        low: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        open: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5])
      }));
      
      this.priceHistory = this.candleHistory.map(c => c.close);
    } catch (error) {
      console.log("Historical data prefill failed:", error);
    }
  }

  async fetchFearGreedIndex() {
    try {
      const response = await fetch('https://api.alternative.me/fng/');
      const data = await response.json();
      if (data && data.data && data.data[0]) {
        return parseInt(data.data[0].value);
      }
    } catch (e) {
      return 50;
    }
    return 50;
  }

  async generateSignal() {
    try {
      if (this.candleHistory.length < 30) {
        await this.fetchHistoricalData();
      }

      const consensus = await marketFeed.getConsensusPrice('BTC');
      if (!consensus) throw new Error('Unable to fetch market data');
      
      const currentPrice = consensus.consensusPrice;
      const now = Date.now();
      const lastCandle = this.candleHistory[this.candleHistory.length - 1];
      
      if (lastCandle && now - lastCandle.timestamp > 15 * 60 * 1000) {
        this.candleHistory.push({
          timestamp: now, open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice, volume: 0
        });
      } else if (lastCandle) {
        lastCandle.close = currentPrice;
        if (currentPrice > lastCandle.high) lastCandle.high = currentPrice;
        if (currentPrice < lastCandle.low) lastCandle.low = currentPrice;
      }
      
      if (this.candleHistory.length > this.maxHistory) this.candleHistory.shift();
      this.priceHistory = this.candleHistory.map(c => c.close);

      const klines = this.candleHistory;
      const closes = this.priceHistory;
      const volumes = klines.map(k => k.volume);
      
      if (closes.length < 30) return this.generateNeutralSignal('Insufficient Data');

      // ─────────────────────────────────────────────────────────────────
      // EXECUTIVE AI LOGIC - PORTED EXACTLY FROM YOUR WORKER.JS
      // ─────────────────────────────────────────────────────────────────

      const rsi = this.calculateRSI(closes, 14);
      const ema20 = this.calculateEMA(closes, 20);
      const ema50 = this.calculateEMA(closes, 50);
      const macd = this.calculateMACD(closes);
      const bb = this.calculateBollingerBands(closes);
      const atr = this.calculateATR(klines, 14);
      const fearGreedValue = await this.fetchFearGreedIndex();
      
      const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const currentVolume = volumes[volumes.length - 1];
      const volumeRatio = currentVolume / (avgVolume || 1);
      
      const priceChange1h = closes.length >= 5 ? ((currentPrice - closes[closes.length - 5]) / closes[closes.length - 5]) * 100 : 0;
      const volatility = this.calculateVolatility(closes.slice(-20));
      
      const higherHighs = this.detectHigherHighs(closes.slice(-20));
      const lowerLows = this.detectLowerLows(closes.slice(-20));
      const support = Math.min(...closes.slice(-20));
      const resistance = Math.max(...closes.slice(-20));
      const distanceToSupport = ((currentPrice - support) / support) * 100;
      const distanceToResistance = ((resistance - currentPrice) / currentPrice) * 100;
      
      const isExtremeFear = fearGreedValue < 25;
      const isExtremeGreed = fearGreedValue > 75;

      let score = 0;
      const reasons = [];
      
      if (rsi !== null) {
        if (rsi < 30) { score += 25; reasons.push(`RSI Oversold (${rsi.toFixed(1)})`); }
        else if (rsi < 40) { score += 15; reasons.push(`RSI Low (${rsi.toFixed(1)})`); }
        else if (rsi > 70) { score -= 25; reasons.push(`RSI Overbought (${rsi.toFixed(1)})`); }
        else if (rsi > 60) { score -= 15; reasons.push(`RSI High (${rsi.toFixed(1)})`); }
      }
      
      if (ema20 && ema50) {
        if (ema20 > ema50 && currentPrice > ema20) { score += 20; reasons.push('Bullish EMA Trend (20>50)'); }
        else if (ema20 < ema50 && currentPrice < ema20) { score -= 20; reasons.push('Bearish EMA Trend (20<50)'); }
      }
      
      if (macd !== null) {
        const prevMacd = this.calculateMACD(closes.slice(0, -1));
        if (macd > 0 && macd > prevMacd) { score += 15; reasons.push('MACD Bullish Crossover'); }
        else if (macd < 0 && macd < prevMacd) { score -= 15; reasons.push('MACD Bearish Crossover'); }
      }
      
      if (volumeRatio > 2) {
        score += (priceChange1h > 0 ? 10 : -10);
        reasons.push(`High Volume (${volumeRatio.toFixed(1)}x avg)`);
      }
      
      if (bb) {
        if (currentPrice < bb.lower) { score += 15; reasons.push('Price Below Lower Band'); }
        else if (currentPrice > bb.upper) { score -= 15; reasons.push('Price Above Upper Band'); }
      }
      
      if (higherHighs && !lowerLows) { score += 15; reasons.push('Higher Highs Pattern'); }
      else if (lowerLows && !higherHighs) { score -= 15; reasons.push('Lower Lows Pattern'); }
      
      if (distanceToSupport < 2 && distanceToResistance > 5) { score += 10; reasons.push('Near Support'); }
      else if (distanceToResistance < 2 && distanceToSupport > 5) { score -= 10; reasons.push('Near Resistance'); }
      
      if (isExtremeFear) { score += 10; reasons.push('Extreme Fear (Contrarian)'); }
      else if (isExtremeGreed) { score -= 10; reasons.push('Extreme Greed (Contrarian)'); }
      
      if (volatility > 5) { score *= 0.8; reasons.push('High Volatility Warning'); }
      
      let signal, confidence;
      const confluenceCount = reasons.length;
      confidence = Math.min(95, Math.max(50, 50 + Math.abs(score) * 0.5 + confluenceCount * 3));
      
      if (score >= 50) { signal = 'STRONG LONG'; }
      else if (score >= 25) { signal = 'LONG'; }
      else if (score <= -50) { signal = 'STRONG SHORT'; }
      else if (score <= -25) { signal = 'SHORT'; }
      else { signal = 'NEUTRAL'; confidence = Math.max(30, confidence - 20); }
      
      const STOP_LOSS_PERCENT = 2.5;
      const TAKE_PROFIT_PERCENT = 5.0;

      let stopLoss, takeProfit;
      const atrMultiplier = atr ? (atr / currentPrice) * 100 : STOP_LOSS_PERCENT;
      
      if (signal.includes('LONG')) {
        stopLoss = currentPrice * (1 - Math.max(atrMultiplier * 1.5, STOP_LOSS_PERCENT) / 100);
        takeProfit = currentPrice * (1 + TAKE_PROFIT_PERCENT / 100);
      } else if (signal.includes('SHORT')) {
        stopLoss = currentPrice * (1 + Math.max(atrMultiplier * 1.5, STOP_LOSS_PERCENT) / 100);
        takeProfit = currentPrice * (1 - TAKE_PROFIT_PERCENT / 100);
      } else {
        stopLoss = currentPrice * 0.975;
        takeProfit = currentPrice * 1.05;
      }
      
      return {
        signal, text: signal, score: Math.round(score), confidence: Math.round(confidence),
        price: currentPrice, consensus, rsi: rsi?.toFixed(2), ema20: ema20?.toFixed(2), ema50: ema50?.toFixed(2),
        macd: macd?.toFixed(4), fearGreed: fearGreedValue, reasons,
        timestamp: Date.now(), stopLoss, takeProfit, isRealData: true
      };
    } catch (error) {
      return this.generateNeutralSignal('Engine Error: ' + error.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // MATH UTILITIES
  // ─────────────────────────────────────────────────────────────────

  calculateRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return null;
    let gains = 0, losses = 0;
    
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
    }
    
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
  }

  calculateEMA(prices, period) {
    if (!prices || prices.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) ema = (prices[i] - ema) * multiplier + ema;
    return ema;
  }

  calculateMACD(prices) {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    if (!ema12 || !ema26) return null;
    return ema12 - ema26;
  }

  calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (!prices || prices.length < period) return null;
    const slice = prices.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.map(p => Math.pow(p - sma, 2)).reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(variance);
    return { upper: sma + (stdDev * std), middle: sma, lower: sma - (stdDev * std) };
  }

  calculateATR(klines, period = 14) {
    if (!klines || klines.length < period) return null;
    const trs = [];
    for (let i = 1; i < klines.length; i++) {
      const high = klines[i].high, low = klines[i].low, prevClose = klines[i-1].close;
      trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  calculateVolatility(prices) {
    if (!prices || prices.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < prices.length; i++) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance) * Math.sqrt(365 * 96) * 100;
  }
  
  detectHigherHighs(prices) {
    let highs = 0;
    for (let i = 2; i < prices.length; i++) { if (prices[i] > prices[i-1] && prices[i-1] > prices[i-2]) highs++; }
    return highs >= 3;
  }
  
  detectLowerLows(prices) {
    let lows = 0;
    for (let i = 2; i < prices.length; i++) { if (prices[i] < prices[i-1] && prices[i-1] < prices[i-2]) lows++; }
    return lows >= 3;
  }

  generateNeutralSignal(reason) {
    return { signal: 'NEUTRAL', text: 'NEUTRAL', score: 0, confidence: 30, reasons: [reason], timestamp: Date.now() };
  }
}

export const signalEngine = new SignalEngine();
