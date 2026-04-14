import { marketFeed }   from './_utils/market.js';
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

// READ-ONLY: all trading decisions handled by /api/evaluate (cron)
// Signal data comes from /api/data-sync cache (Supabase signal_cache)
// Falls back to live computation if cache is stale (>3 min)
export default async function handler(req, res) {
  try {
    const now = Date.now();

    // ── 1. Parallel: DB reads (instant) ─────────────────────
    const [cacheResult, stateResult, positionResult, historyResult] = await Promise.all([
      supabase.from('signal_cache').select('*').eq('id', 'main').maybeSingle(),
      supabase.from('trading_state').select('*').eq('id', 'main').maybeSingle(),
      supabase.from('positions').select('*').eq('status', 'OPEN').maybeSingle(),
      supabase.from('trade_history').select('*').order('created_at', { ascending: false }).limit(20),
    ]);

    const state    = stateResult.data    || DEFAULT_STATE;
    const position = positionResult.data || null;
    const history  = historyResult.data  || [];
    const cached   = cacheResult.data;

    // If trading_state row is missing, seed it so balance never resets
    if (!stateResult.data) {
      supabase.from('trading_state').upsert({ id: 'main', ...DEFAULT_STATE }).then(() => {}).catch(() => {});
    }

    // ── 2. Decide: use cache or live fallback ─────────────────
    const cacheAge  = cached?.computed_at
      ? now - new Date(cached.computed_at).getTime()
      : Infinity;
    const cacheStale = cacheAge > 180_000; // stale after 3 min

    let signal, consensus;

    if (cached && !cacheStale) {
      // ── Fast path: serve from Supabase cache (< 5ms) ──────
      // Reconstruct the signal object from cached fields
      signal = {
        signal:          cached.signal,
        confidence:      cached.confidence,
        score:           cached.score,
        regime:          cached.regime,
        reasons:         cached.reasons       || [],
        riskFlags:       cached.risk_flags    || [],
        targets:         cached.targets       || {},
        indicators:      cached.indicators    || {},
        marketStructure: cached.market_structure || {},
        htfContext:      cached.htf_context   || {},
        microEntry:      cached.micro_entry   || {},
        dataQuality:     cached.data_quality  || {},
        timestamp:       new Date(cached.computed_at).getTime(),
        _fromCache:      true,
        _cacheAgeMs:     Math.round(cacheAge),
      };
      consensus = {
        consensusPrice: cached.consensus_price,
        spread:         cached.price_spread || 0,
        allPrices:      cached.price_exchanges || [],
        timestamp:      new Date(cached.computed_at).getTime(),
      };
    } else {
      // ── Slow path: live fetch (cold start or stale cache) ───
      console.log(`[status] Cache ${cached ? `stale (${Math.round(cacheAge/1000)}s)` : 'miss'} — live fetch`);
      [consensus, signal] = await Promise.all([
        marketFeed.getConsensusPrice('BTC').catch(() => ({ consensusPrice: 0, spread: 0, allPrices: [] })),
        signalEngine.generateSignal(),
      ]);
    }

    // ── 3. Cooldown calculation ───────────────────────────────
    const lastTime       = state.last_trade_time ? Number(state.last_trade_time) : 0;
    const cooldownMs     = 2 * 60 * 1000;
    const cooldownActive = lastTime && (now - lastTime) < cooldownMs;
    const cooldownRemaining = cooldownActive
      ? Math.ceil((cooldownMs - (now - lastTime)) / 60000)
      : 0;

    // ── 4. Win rate ───────────────────────────────────────────
    const winRate = state.total_trades > 0
      ? ((state.winning_trades / state.total_trades) * 100).toFixed(1)
      : 0;

    // ── 5. Build response ─────────────────────────────────────
    const ms = signal.marketStructure || {};
    res.status(200).json({
      signal: {
        text:       signal.signal     || 'NEUTRAL',
        confidence: signal.confidence || 0,
        score:      signal.score      || 0,
        regime:     signal.regime     || 'UNKNOWN',
        fearGreed:  ms.fearGreedIndex ?? 50,
        marketStructure: ms,
        targets:    signal.targets    || {},
        indicators: signal.indicators || {},
        reasons:    signal.reasons    || [],
        riskFlags:  signal.riskFlags  || [],
        stopLoss:   signal.targets?.stopLoss  || 0,
        takeProfit: signal.targets?.tp2       || 0,
        timestamp:  signal.timestamp          || now,
        // ── Meta for frontend debug terminal ──────────────
        _fromCache:  signal._fromCache  || false,
        _cacheAgeMs: signal._cacheAgeMs || 0,
      },
      price: {
        consensus:  consensus.consensusPrice || 0,
        spread:     consensus.spread         || 0,
        exchanges:  consensus.allPrices      || [],
        timestamp:  consensus.timestamp      || now,
        isReal:     true,
      },
      stats: {
        balance:          state.balance         ?? DEFAULT_STATE.balance,
        initialBalance:   state.initial_balance ?? DEFAULT_STATE.initial_balance,
        totalTrades:      state.total_trades    ?? 0,
        winRate,
        profitLoss:      ((state.balance - state.initial_balance) || 0).toFixed(2),
        maxDrawdown:      state.max_drawdown    ?? 0,
        hasOpenPosition:  !!position,
        cooldownActive:   !!cooldownActive,
        cooldownRemaining,
      },
      position: position ? {
        side:          position.side,
        entryPrice:    position.entry_price,
        margin:        position.margin,
        currentPrice:  consensus.consensusPrice,
        unrealizedPnl: position.unrealized_pnl || 0,
        stopLoss:      position.stop_loss,
        takeProfit:    position.take_profit2 || position.take_profit || 0,
        entryTime:     position.entry_time,
      } : null,
      history: history.map(t => ({
        type:       t.type,
        side:       t.side,
        entryPrice: t.entry_price,
        exitPrice:  t.exit_price,
        netPnl:     t.net_pnl,
        pnlPercent: t.pnl_percent,
        reason:     t.reason,
        time:       t.created_at,
        margin:     t.margin,
      })),
      lastTrade: history[0] ? {
        type:       history[0].type,
        side:       history[0].side,
        netPnl:     history[0].net_pnl,
        pnlPercent: history[0].pnl_percent,
        reason:     history[0].reason,
        time:       history[0].created_at,
      } : null,
    });

  } catch (error) {
    console.error('Status error:', error);
    res.status(500).json({ error: error.message });
  }
}
