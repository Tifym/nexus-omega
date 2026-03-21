import { marketFeed } from './_utils/market.js';
import { signalEngine } from './_utils/signals.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const DEFAULT_STATE = {
  balance: 2050.75,
  initial_balance: 2050.75,
  total_trades: 0,
  winning_trades: 0,
  max_drawdown: 0,
  last_trade_time: null
};

// READ-ONLY: all trading is handled exclusively by /api/evaluate (cron job)
export default async function handler(req, res) {
  try {
    // Fetch everything in parallel
    const [consensusResult, signalResult, stateResult, positionResult, historyResult] = await Promise.all([
      marketFeed.getConsensusPrice('BTC'),
      signalEngine.generateSignal(),
      supabase.from('trading_state').select('*').eq('id', 'main').maybeSingle(),
      supabase.from('positions').select('*').eq('status', 'OPEN').maybeSingle(),
      supabase.from('trade_history').select('*').order('created_at', { ascending: false }).limit(20)
    ]);

    const consensus = consensusResult;
    const signal    = signalResult;
    const state     = stateResult.data || DEFAULT_STATE;
    const position  = positionResult.data || null;
    const history   = historyResult.data || [];

    // Cooldown calculation
    const now = Date.now();
    const lastTime = state.last_trade_time ? Number(state.last_trade_time) : 0;
    const cooldownMs = 5 * 60 * 1000;
    const cooldownActive = lastTime && (now - lastTime) < cooldownMs;
    const cooldownRemaining = cooldownActive
      ? Math.ceil((cooldownMs - (now - lastTime)) / 60000)
      : 0;

    // Win rate
    const winRate = state.total_trades > 0
      ? ((state.winning_trades / state.total_trades) * 100).toFixed(1)
      : 0;

    res.status(200).json({
      signal: {
        text:       signal.signal  || 'NEUTRAL',
        confidence: signal.confidence || 0,
        score:      signal.score   || 0,
        regime:     signal.regime  || 'UNKNOWN',
        marketStructure: signal.marketStructure || {},
        entryConditions: signal.entryConditions || {},
        targets:    signal.targets || {},
        indicators: signal.indicators || {},
        reasons:    signal.reasons || [],
        riskFlags:  signal.riskFlags || [],
        stopLoss:   (signal.targets && signal.targets.stopLoss) || 0,
        takeProfit: (signal.targets && signal.targets.tp2) || 0,
        timestamp:  signal.timestamp  || now
      },
      price: {
        consensus:  consensus.consensusPrice || 0,
        spread:     consensus.spread || 0,
        exchanges:  consensus.allPrices || [],
        timestamp:  consensus.timestamp || now,
        isReal:    !consensus.stale
      },
      stats: {
        balance:        state.balance        ?? DEFAULT_STATE.balance,
        initialBalance: state.initial_balance ?? DEFAULT_STATE.initial_balance,
        totalTrades:    state.total_trades   ?? 0,
        winRate,
        profitLoss:    ((state.balance - state.initial_balance) || 0).toFixed(2),
        maxDrawdown:    state.max_drawdown   ?? 0,
        hasOpenPosition: !!position,
        cooldownActive:  !!cooldownActive,
        cooldownRemaining
      },
      position: position ? {
        side:         position.side,
        entryPrice:   position.entry_price,
        margin:       position.margin,
        currentPrice: consensus.consensusPrice,
        unrealizedPnl: position.unrealized_pnl || 0,
        stopLoss:     position.stop_loss,
        takeProfit:   position.take_profit,
        entryTime:    position.entry_time
      } : null,
      history: history.map(t => ({
        type:       t.type,
        side:       t.side,
        entryPrice: t.entry_price,
        exitPrice:  t.exit_price,
        netPnl:     t.net_pnl,
        pnlPercent: t.pnl_percent,
        reason:     t.reason,
        time:       t.created_at
      })),
      lastTrade: history[0] ? {
        type:       history[0].type,
        side:       history[0].side,
        netPnl:     history[0].net_pnl,
        pnlPercent: history[0].pnl_percent,
        reason:     history[0].reason,
        time:       history[0].created_at
      } : null
    });

  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: error.message });
  }
}
