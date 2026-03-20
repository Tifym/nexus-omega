import { marketFeed } from './_utils/market.js';
import { signalEngine } from './_utils/signals.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  try {
    const consensus = await marketFeed.getConsensusPrice('BTC');
    const signal = await signalEngine.generateSignal();

    const { data: state } = await supabase.from('trading_state').select('*').eq('id', 'main').single();
    const { data: position } = await supabase.from('positions').select('*').eq('status', 'OPEN').maybeSingle();
    const { data: lastTrade } = await supabase.from('trade_history').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();

    const cooldownActive = state.last_trade_time && (Date.now() - state.last_trade_time) < (5 * 60 * 1000);
    const cooldownRemaining = cooldownActive ? Math.ceil((5 * 60 * 1000 - (Date.now() - state.last_trade_time)) / 1000 / 60) : 0;

    let tradeExecuted = null;
    let currentPosition = position;
    let tradeAction = null;

    // 1. Position Check (Exits)
    if (position && consensus && consensus.consensusPrice) {
      const price = consensus.consensusPrice;
      const unrealizedPnl = position.side === 'LONG' 
        ? ((price - position.entry_price) / position.entry_price) * position.margin
        : ((position.entry_price - price) / position.entry_price) * position.margin;

      await supabase.from('positions').update({ unrealized_pnl: unrealizedPnl, current_price: price }).eq('id', position.id);
      
      let shouldExit = false;
      let exitReason = '';

      if (position.side === 'LONG' && price <= position.stop_loss) { shouldExit = true; exitReason = 'Stop Loss'; }
      else if (position.side === 'SHORT' && price >= position.stop_loss) { shouldExit = true; exitReason = 'Stop Loss'; }
      else if (position.side === 'LONG' && price >= position.take_profit) { shouldExit = true; exitReason = 'Take Profit'; }
      else if (position.side === 'SHORT' && price <= position.take_profit) { shouldExit = true; exitReason = 'Take Profit'; }
      // Dynamic early exit via signal reversal
      else if (position.side === 'LONG' && signal.signal.includes('SHORT') && signal.confidence >= 65) { shouldExit = true; exitReason = 'Signal Reversal'; }
      else if (position.side === 'SHORT' && signal.signal.includes('LONG') && signal.confidence >= 65) { shouldExit = true; exitReason = 'Signal Reversal'; }

      if (shouldExit) {
        const netPnl = unrealizedPnl - (position.margin * 0.001); // 0.1% fee
        const newBalance = state.balance + position.margin + netPnl;
        
        await supabase.from('positions').update({ status: 'CLOSED', exit_price: price }).eq('id', position.id);
        
        const newTrade = {
          type: 'CLOSE', side: position.side, entry_price: position.entry_price, exit_price: price,
          margin: position.margin, leverage: position.leverage, net_pnl: netPnl, 
          pnl_percent: (netPnl / position.margin) * 100, reason: exitReason
        };
        const { data: insertedTrade } = await supabase.from('trade_history').insert(newTrade).select().single();
        
        await supabase.from('trading_state').update({
          balance: newBalance,
          total_trades: state.total_trades + 1,
          winning_trades: netPnl > 0 ? state.winning_trades + 1 : state.winning_trades,
          last_trade_time: Date.now(),
          max_drawdown: Math.max(state.max_drawdown, ((state.initial_balance - newBalance) / state.initial_balance * 100))
        }).eq('id', 'main');

        tradeExecuted = insertedTrade;
        currentPosition = null;
        tradeAction = 'CLOSE';
      }
    }

    // 2. Signal Check (Entries)
    if (!currentPosition && !cooldownActive && signal.confidence >= 65 && !signal.signal.includes('NEUTRAL')) {
      const isLong = signal.signal.includes('LONG');
      const entryPrice = signal.price;
      const margin = state.balance * 0.95; // 95% of balance
      if (margin > 10) {
        const entryFee = margin * 0.001;
        const newPosition = {
          side: isLong ? 'LONG' : 'SHORT',
          entry_price: entryPrice,
          current_price: entryPrice,
          margin: margin,
          leverage: 20,
          stop_loss: signal.stopLoss,
          take_profit: signal.takeProfit,
          data_sources: { signalScore: signal.score, indicators: signal.indicators },
          status: 'OPEN',
          entry_time: Date.now(),
          unrealized_pnl: -entryFee
        };

        const { data: insertedPosition } = await supabase.from('positions').insert(newPosition).select().single();
        
        await supabase.from('trading_state').update({ 
            balance: state.balance - margin,  // Deduct margin entirely from balance until closed
            last_trade_time: Date.now()
        }).eq('id', 'main');
        
        const newTrade = {
          type: 'OPEN', side: newPosition.side, entry_price: entryPrice, margin: margin,
          leverage: 20, reason: `${signal.signal} Trigger (${signal.confidence}%)`
        };
        const { data: insertedTrade } = await supabase.from('trade_history').insert(newTrade).select().single();
        
        tradeExecuted = insertedTrade;
        currentPosition = insertedPosition;
        tradeAction = 'OPEN';
      }
    }

    // Refresh state if changed
    const finalState = tradeAction ? (await supabase.from('trading_state').select('*').eq('id', 'main').single()).data : state;

    res.status(200).json({
      signal: {
        text: signal.signal,
        confidence: signal.confidence,
        score: signal.score,
        indicators: signal.indicators,
        reasons: signal.reasons,
        fearGreed: signal.fearGreed,
        takeProfit: signal.takeProfit,
        stopLoss: signal.stopLoss,
        timestamp: signal.timestamp
      },
      price: { consensus: consensus.consensusPrice, spread: consensus.spread, exchanges: consensus.allPrices, timestamp: consensus.timestamp, isReal: !consensus.stale },
      stats: { balance: finalState.balance, initialBalance: finalState.initial_balance, totalTrades: finalState.total_trades, winRate: finalState.total_trades > 0 ? ((finalState.winning_trades / finalState.total_trades) * 100).toFixed(1) : 0, profitLoss: (finalState.balance - finalState.initial_balance).toFixed(2), maxDrawdown: finalState.max_drawdown, hasOpenPosition: !!currentPosition, cooldownActive, cooldownRemaining },
      position: currentPosition ? { side: currentPosition.side, entryPrice: currentPosition.entry_price, margin: currentPosition.margin, currentPrice: consensus.consensusPrice, unrealizedPnl: currentPosition.unrealized_pnl, stopLoss: currentPosition.stop_loss, takeProfit: currentPosition.take_profit, entryTime: currentPosition.entry_time } : null,
      lastTrade: tradeExecuted || (lastTrade ? { type: lastTrade.type, side: lastTrade.side, netPnl: lastTrade.net_pnl, pnlPercent: lastTrade.pnl_percent, reason: lastTrade.reason, time: lastTrade.created_at } : null)
    });
  } catch (error) {
    console.error("Status endpoint error:", error);
    res.status(500).json({ error: error.message });
  }
}
