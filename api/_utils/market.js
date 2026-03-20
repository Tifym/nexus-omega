     const EXCHANGES = {
         BINANCE: { name: 'Binance', restUrl: 'https://api.binance.com/api/v3', weight: 1.0, timeout: 3000 },
         COINBASE: { name: 'Coinbase', restUrl: 'https://api.exchange.coinbase.com', weight: 0.95, timeout: 3000 },
         BYBIT: { name: 'Bybit', restUrl: 'https://api.bybit.com/v5/market', weight: 0.9, timeout: 3000 },
         OKX: { name: 'OKX', restUrl: 'https://www.okx.com/api/v5/market', weight: 0.9, timeout: 3000 },
         KRAKEN: { name: 'Kraken', restUrl: 'https://api.kraken.com/0/public', weight: 0.85, timeout: 4000 }
     };

class MultiExchangeFeed {
    constructor() {
          this.cache = new Map();
          this.cacheTTL = 5000;
          this.lastFetch = 0;
    }

  async fetchWithTimeout(url, timeout, options = {}) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
                const resp = await fetch(url, { ...options, signal: controller.signal, headers: { 'Accept': 'application/json', ...options.headers } });
                clearTimeout(id);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return await resp.json();
        } catch (e) { clearTimeout(id); throw e; }
  }

          async fetchBinance(symbol = 'BTCUSDT') {
                try {
                        const data = await this.fetchWithTimeout(
                                  EXCHANGES.BINANCE.restUrl + '/ticker/24hr?symbol=' + symbol,
                                  EXCHANGES.BINANCE.timeout
                                );
                        return {
                                  exchange: 'Binance',
                                  symbol: symbol.replace('USDT', '-USD'),
                                  price: parseFloat(data.lastPrice),
                                  bid: parseFloat(data.bidPrice),
                                  ask: parseFloat(data.askPrice),
                                  volume_24h: parseFloat(data.volume),
                                  price_change_24h: parseFloat(data.priceChangePercent),
                                  timestamp: data.closeTime,
                                  latency_ms: Date.now() - this.lastFetch,
                                  weight: EXCHANGES.BINANCE.weight
                        };
                } catch (e) { return null; }
          }

  async fetchCoinbase(symbol = 'BTC-USD') {
        try {
                const [ticker, stats] = await Promise.all([
                          this.fetchWithTimeout(EXCHANGES.COINBASE.restUrl + '/products/' + symbol + '/ticker', EXCHANGES.COINBASE.timeout),
                          this.fetchWithTimeout(EXCHANGES.COINBASE.restUrl + '/products/' + symbol + '/stats', EXCHANGES.COINBASE.timeout)
                        ]);
                return {
                          exchange: 'Coinbase',
                          symbol: symbol,
                          price: parseFloat(ticker.price),
                          bid: parseFloat(ticker.bid),
                          ask: parseFloat(ticker.ask),
                          volume_24h: parseFloat(stats.volume),
                          price_change_24h: ((parseFloat(stats.last) - parseFloat(stats.open)) / parseFloat(stats.open)) * 100,
                          timestamp: new Date(ticker.time).getTime(),
                          latency_ms: Date.now() - this.lastFetch,
                          weight: EXCHANGES.COINBASE.weight
                };
        } catch (e) { return null; }
  }

          async fetchBybit(symbol = 'BTCUSDT') {
                try {
                        const data = await this.fetchWithTimeout(
                                  EXCHANGES.BYBIT.restUrl + '/tickers?category=spot&symbol=' + symbol,
                                  EXCHANGES.BYBIT.timeout
                                );
                        if (data.retCode !== 0) throw new Error(data.retMsg);
                        const ticker = data.result.list[0];
                        return {
                                  exchange: 'Bybit',
                                  symbol: symbol.replace('USDT', '-USD'),
                                  price: parseFloat(ticker.lastPrice),
                                  bid: parseFloat(ticker.bid1Price),
                                  ask: parseFloat(ticker.ask1Price),
                                  volume_24h: parseFloat(ticker.volume24h),
                                  price_change_24h: parseFloat(ticker.price24hPcnt) * 100,
                                  timestamp: parseInt(ticker.ts),
                                  latency_ms: Date.now() - this.lastFetch,
                                  weight: EXCHANGES.BYBIT.weight
                        };
                } catch (e) { return null; }
          }

  async fetchOKX(symbol = 'BTC-USDT') {
        try {
                const data = await this.fetchWithTimeout(
                          EXCHANGES.OKX.restUrl + '/ticker?instId=' + symbol,
                          EXCHANGES.OKX.timeout
                        );
                if (data.code !== '0') throw new Error(data.msg);
                const ticker = data.data[0];
                return {
                          exchange: 'OKX',
                          symbol: symbol.replace('-USDT', '-USD'),
                          price: parseFloat(ticker.last),
                          bid: parseFloat(ticker.bidPx),
                          ask: parseFloat(ticker.askPx),
                          volume_24h: parseFloat(ticker.vol24h),
                          price_change_24h: parseFloat(ticker.change24h),
                          timestamp: parseInt(ticker.ts),
                          latency_ms: Date.now() - this.lastFetch,
                          weight: EXCHANGES.OKX.weight
                };
        } catch (e) { return null; }
  }

          async fetchKraken(pair = 'XBTUSDT') {
                try {
                        const data = await this.fetchWithTimeout(
                                  EXCHANGES.KRAKEN.restUrl + '/Ticker?pair=' + pair,
                                  EXCHANGES.KRAKEN.timeout
                                );
                        const ticker = data.result[pair];
                        if (!ticker) throw new Error('Pair not found');
                        const lastPrice = parseFloat(ticker.c[0]);
                        const openPrice = parseFloat(ticker.o);
                        return {
                                  exchange: 'Kraken',
                                  symbol: 'BTC-USD',
                                  price: lastPrice,
                                  bid: parseFloat(ticker.b[0]),
                                  ask: parseFloat(ticker.a[0]),
                                  volume_24h: parseFloat(ticker.v[1]),
                                  price_change_24h: ((lastPrice - openPrice) / openPrice) * 100,
                                  timestamp: Date.now(),
                                  latency_ms: Date.now() - this.lastFetch,
                                  weight: EXCHANGES.KRAKEN.weight
                        };
                } catch (e) { return null; }
          }

  async fetchAllPrices(symbol = 'BTC') {
        this.lastFetch = Date.now();
        const promises = [
                this.fetchBinance('BTCUSDT'),
                this.fetchCoinbase('BTC-USD'),
                this.fetchBybit('BTCUSDT'),
                this.fetchOKX('BTC-USDT'),
                this.fetchKraken('XBTUSDT')
              ];
        const results = await Promise.allSettled(promises);
        const validData = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
        if (validData.length === 0) throw new Error('All exchange data sources failed');
        return validData;
  }

          calculateConsensus(exchangeData) {
                if (exchangeData.length === 0) return null;
                const sorted = [...exchangeData].sort((a, b) => a.price - b.price);
                const totalWeight = sorted.reduce((sum, d) => sum + d.weight, 0);
                let cumulativeWeight = 0;
                let medianPrice = sorted[0].price;
                for (const data of sorted) {
                        cumulativeWeight += data.weight;
                        if (cumulativeWeight >= totalWeight / 2) {
                                  medianPrice = data.price;
                                  break;
                        }
                }
                const validPrices = sorted.filter(d => Math.abs(d.price - medianPrice) / medianPrice < 0.01);
                const consensusPrice = validPrices.reduce((sum, d) => sum + d.price * d.weight, 0) / 
                                            validPrices.reduce((sum, d) => sum + d.weight, 0);
                const spread = (Math.max(...validPrices.map(d => d.price)) - 
                                                   Math.min(...validPrices.map(d => d.price))) / consensusPrice * 100;
                return {
                        consensusPrice,
                        medianPrice,
                        spread,
                        exchangesUsed: validPrices.length,
                        exchangesTotal: exchangeData.length,
                        allPrices: exchangeData.map(d => ({
                                  exchange: d.exchange,
                                  price: d.price,
                                  change_24h: d.change_24h,
                                  latency: d.latency
                        })),
                        timestamp: Date.now()
                };
          }

  async getConsensusPrice(symbol = 'BTC') {
        const cached = this.cache.get(symbol);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) return cached;
        try {
                const allData = await this.fetchAllPrices(symbol);
                const consensus = this.calculateConsensus(allData);
                this.cache.set(symbol, consensus);
                return consensus;
        } catch (error) {
                if (cached) return { ...cached, stale: true };
                throw error;
        }
  }
}

export const marketFeed = new MultiExchangeFeed();
export { EXCHANGES };
