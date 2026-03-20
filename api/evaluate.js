     import { marketFeed } from './_utils/market.js';
import { signalEngine } from './_utils/signals.js';
import { tradingEngine } from './_utils/trading.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
    try {
          const startTime = Date.now();
           const results = { timestamp: Date.now(), actions: [], errors: [] };

      let consensus;
          try {
                  consensus = await marketFeed.getConsensusPrice('BTC');
                  results.consensus = { price: consensus.consensusPrice, spread: consensus.spread, exchanges: consensus.exchangesUsed + '/' + consensus.exchangesTotal, latency: Date.now() - startTime };
          } catch (error) {
                  results.errors.push('Price fetch failed: ' + error.message);
                  return res.status(503).json(results);
          }

      const signal = await signalEngine.generateSignal();
          results.signal = { direction: signal.signal, confidence: signal.confidence, score: signal.score, indicators: signal.indicators };

      const openPosition = await tradingEngine.getOpenPosition();
           if (isOppositeSignal && signal.confidence >= 75) {
                     const closeResult = await tradingEngine.closePosition(openPosition, consensus.consensusPrice, 'SIGNAL_REVERSAL', consensus);
                     results.actions.push({ type: 'CLOSE', reason: 'SIGNAL_REVERSAL', pnl: closeResult.netPnl, pnlPercent: closeResult.pnlPercent });
                     if (signal.signal.includes('STRONG')) {
                                 try {
                                               const newPos = await tradingEngine.openPosition(signal, consensus.consensusPrice, consensus);
                                               results.actions.push({ type: 'OPEN', side: newPos.side, confidence: newPos.confidence, entryPrice: newPos.entryPrice });
                                 } catch (error) {
                                               results.errors.push('Re-entry failed: ' + error.message);
                                 }
                     }
           } else {
                     const exitCheck = await tradingEngine.checkPositionExit(openPosition, consensus);
                     if (exitCheck.shouldClose) {
                                 const closeResult = await tradingEngine.closePosition(openPosition, exitCheck.price, exitCheck.reason, consensus);
                                 results.actions.push({ type: 'CLOSE', reason: exitCheck.reason, pnl: closeResult.netPnl, pnlPercent: closeResult.pnlPercent });
                     } else {
                                 results.actions.push({ type: 'UPDATE', positionId: openPosition.id, unrealizedPnl: exitCheck.unrealizedPnl, pnlPercent: exitCheck.pnlPercent });
                     }
           }
    }
} else {
        const canTrade = await tradingEngine.canTrade();
        if (canTrade && signal.signal.includes('LONG') && !signal.signal.includes('SHORT')) {
                  try {
                              const newPos = await tradingEngine.openPosition(signal, consensus.consensusPrice, consensus);
                              results.actions.push({ type: 'OPEN', side: newPos.side, confidence: newPos.confidence, entryPrice: newPos.entryPrice, stopLoss: newPos.stopLoss, takeProfit: newPos.takeProfit });
                  } catch (error) {
                              results.actions.push({ type: 'SKIPPED', reason: error.message });
                  }
        } else if (!canTrade) {
                  results.actions.push({ type: 'COOLDOWN', message: '5-minute cooldown active' });
        }
}

    await supabase.from('market_snapshots').insert({
            btc_consensus_price: consensus.consensusPrice,
            btc_binance_price: consensus.allPrices.find(p => p.exchange === 'Binance')?.price,
            btc_coinbase_price: consensus.allPrices.find(p => p.exchange === 'Coinbase')?.price,
            btc_bybit_price: consensus.allPrices.find(p => p.exchange === 'Bybit')?.price,
            btc_okx_price: consensus.allPrices.find(p => p.exchange === 'OKX')?.price,
            btc_kraken_price: consensus.allPrices.find(p => p.exchange === 'Kraken')?.price,
            spread_percent: consensus.spread,
            source: 'multi_exchange_consensus'
    });

    results.executionTime = Date.now() - startTime;
    res.status(200).json(results);
} catch (error) {
      res.status(500).json({ error: error.message, timestamp: Date.now() });
}
}
