import { marketFeed } from './_utils/market.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
    try {
          const consensus = await marketFeed.getConsensusPrice('BTC');
          const { data: state } = await supabase.from('trading_state').select('*').eq('id', 'main').single();
          const { data: position } = await supabase.from('positions').select('*').eq('status', 'OPEN').maybeSingle();
          const { data: lastTrade } = await supabase.from('trade_history').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();

      const cooldownActive = state.last_trade_time && (Date.now() - state.last_trade_time) < (5 * 60 * 1000);
          const cooldownRemaining = cooldownActive ? Math.ceil((5 * 60 * 1000 - (Date.now() - state.last_trade_time)) / 1000 / 60) : 0;

      res.status(200).json({
              price: { consensus: consensus.consensusPrice, spread: consensus.spread, exchanges: consensus.allPrices, timestamp: consensus.timestamp, isReal: !consensus.stale },
              stats: { balance: state.balance, initialBalance: state.initial_balance, totalTrades: state.total_trades, winRate: state.total_trades > 0 ? ((state.winning_trades / state.total_trades) * 100).toFixed(1) : 0, profitLoss: (state.balance - state.initial_balance).toFixed(2), maxDrawdown: state.max_drawdown, hasOpenPosition: !!position, cooldownActive, cooldownRemaining },
              position: position ? { side: position.side, entryPrice: position.entry_price, currentPrice: consensus.consensusPrice, unrealizedPnl: position.unrealized_pnl, stopLoss: position.stop_loss, takeProfit: position.take_profit, entryTime: position.entry_time, dataSources: position.data_sources } : null,
              lastTrade: lastTrade ? { type: lastTrade.type, side: lastTrade.side, netPnl: lastTrade.net_pnl, pnlPercent: lastTrade.pnl_percent, reason: lastTrade.reason, time: lastTrade.created_at } : null
      });
    } catch (error) {
          res.status(500).json({ error: error.message });
    }
}
