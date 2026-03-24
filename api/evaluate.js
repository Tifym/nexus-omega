import { marketFeed } from './_utils/market.js';
import { signalEngine } from './_utils/signals.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const DEFAULT_STATE = {
  balance: 2050.75, initial_balance: 2050.75,
  total_trades: 0, winning_trades: 0,
  max_drawdown: 0, last_trade_time: null,
  consecutive_losses: 0
};

export default async function handler(req, res) {
  const log = { timestamp: Date.now(), actions: [], errors: [] };

  try {
    // 1. Fetch
    const [consensus, signal] = await Promise.all([
      marketFeed.getConsensusPrice('BTC'),
      signalEngine.generateSignal()
    ]);

    log.price  = consensus.consensusPrice;
    log.signal = { text: signal.signal, confidence: signal.confidence, regime: signal.regime };

    // 2. Load state
    const { data: stateRow } = await supabase.from('trading_state').select('*').eq('id', 'main').maybeSingle();
    const state = stateRow || DEFAULT_STATE;
    if (!stateRow) await supabase.from('trading_state').upsert({ id: 'main', ...DEFAULT_STATE });

    // 3. Load position
    const { data: openPosArr } = await supabase.from('positions').select('*').eq('status', 'OPEN').order('entry_time', { ascending: false }).limit(1);
    const openPos = openPosArr?.[0] ?? null;

    const now = Date.now();
    const lastTime = state.last_trade_time ? Number(String(state.last_trade_time)) : 0;
    const cooldownMs = 5 * 60 * 1000; // 5 min
    const onCooldown = lastTime > 0 && (now - lastTime) < cooldownMs;

    // 6. Stale Signal Protection
    if (now - signal.timestamp > 900000) {
      log.actions.push({ type: 'SKIPPED', reason: 'Stale Signal Timestamp (>15m)' });
      return res.status(200).json({ ...log, executionTime: Date.now() - log.timestamp });
    }
    
    let staleCandleActive = false;
    if (signal.riskFlags && signal.riskFlags.some(flag => flag.includes('Stale Candle'))) staleCandleActive = true;

    if (openPos && consensus.consensusPrice) {
      const price = consensus.consensusPrice;
      const margin = openPos.margin || 0;
      const notional = margin * 20;

      // 7. Round Trip Fee (0.12%)
      const rawPnl = openPos.side === 'LONG'
        ? ((price - openPos.entry_price) / openPos.entry_price) * notional
        : ((openPos.entry_price - price) / openPos.entry_price) * notional;
      const netPnl = rawPnl - (notional * 0.0012);

      // 8. Live Unrealized Drawdown Tracking & 9. Maximum Drawdown Circuit Breaker
      const liveBalance = state.balance + netPnl;
      let newMaxDrawdown = state.max_drawdown || 0;
      if (liveBalance > 0) {
        const liveDrawdown = ((state.initial_balance - (state.balance + netPnl)) / state.initial_balance) * 100;
        if (liveDrawdown > newMaxDrawdown) newMaxDrawdown = liveDrawdown;
      }

      await supabase.from('positions').update({ current_price: price, unrealized_pnl: netPnl }).eq('id', openPos.id);
      await supabase.from('trading_state').update({ max_drawdown: Math.max(0, newMaxDrawdown) }).eq('id', 'main');
      
      let shouldExitFull = false, shouldExitPartial = false, exitReason = '';

      // Standard Targets
      if (openPos.side === 'LONG' && price <= openPos.stop_loss) { shouldExitFull = true; exitReason = 'Stop Loss'; }
      if (openPos.side === 'SHORT' && price >= openPos.stop_loss) { shouldExitFull = true; exitReason = 'Stop Loss'; }

      if (openPos.side === 'LONG' && price >= openPos.take_profit2) { shouldExitFull = true; exitReason = 'Take Profit 2'; }
      if (openPos.side === 'SHORT' && price <= openPos.take_profit2) { shouldExitFull = true; exitReason = 'Take Profit 2'; }

      // 4. Signal Reversal Exit
      if (!shouldExitFull && signal.signal !== 'NEUTRAL' && signal.confidence >= 65) {
          if (openPos.side === 'LONG' && signal.signal.includes('SHORT')) { shouldExitFull = true; exitReason = 'Signal Reversal'; }
          if (openPos.side === 'SHORT' && signal.signal.includes('LONG')) { shouldExitFull = true; exitReason = 'Signal Reversal'; }
      }

      // 5. Removed Regime Collapse Exit (Allows bot to hold through temporary chop)


      // 3. Partial exit at TP1 (50% close)
      if (!shouldExitFull && !openPos.partially_closed) {
          if (openPos.side === 'LONG' && price >= openPos.take_profit1) { shouldExitPartial = true; exitReason = 'Take Profit 1 (Partial)'; }
          if (openPos.side === 'SHORT' && price <= openPos.take_profit1) { shouldExitPartial = true; exitReason = 'Take Profit 1 (Partial)'; }
      }

      if (shouldExitFull) {
        const isWin = netPnl > 0;
        // 10. Consecutive Loss Counter Reset/Increment
        const newConsecutiveLosses = isWin ? 0 : (state.consecutive_losses || 0) + 1;
        const newBalance = state.balance + margin + netPnl;
        
        await supabase.from('positions').update({ status: 'CLOSED', exit_price: price }).eq('id', openPos.id);
        await supabase.from('trade_history').insert({
          type: 'CLOSE', side: openPos.side, entry_price: openPos.entry_price, exit_price: price,
          margin, leverage: 20, net_pnl: netPnl, pnl_percent: (netPnl / margin) * 100, reason: exitReason
        });
        await supabase.from('trading_state').update({
          balance: newBalance,
          total_trades: (state.total_trades || 0) + 1,
          winning_trades: isWin ? (state.winning_trades || 0) + 1 : (state.winning_trades || 0),
          last_trade_time: now, 
          consecutive_losses: newConsecutiveLosses
        }).eq('id', 'main');
        log.actions.push({ type: 'CLOSE', reason: exitReason, pnl: netPnl.toFixed(2) });

      } else if (shouldExitPartial) {
        const halfMargin = margin / 2;
        const halfNotional = halfMargin * 20;
        const halfNetPnl = netPnl / 2;
        const newBalance = state.balance + halfMargin + halfNetPnl;

        await supabase.from('positions').update({ 
            margin: halfMargin, notional: halfNotional, 
            partially_closed: true, unrealized_pnl: halfNetPnl
        }).eq('id', openPos.id);

        await supabase.from('trade_history').insert({
          type: 'PARTIAL_CLOSE', side: openPos.side, entry_price: openPos.entry_price, exit_price: price,
          margin: halfMargin, leverage: 20, net_pnl: halfNetPnl, pnl_percent: (halfNetPnl / halfMargin) * 100, reason: exitReason
        });

        await supabase.from('trading_state').update({
          balance: newBalance
        }).eq('id', 'main');
        
        log.actions.push({ type: 'PARTIAL_CLOSE', reason: exitReason, pnl: halfNetPnl.toFixed(2) });

      } else {
        log.actions.push({ type: 'HOLD', unrealizedPnl: netPnl.toFixed(2) });
      }

    } else if (!openPos && !onCooldown) {
      
      let blockedFlag = null;
      if (staleCandleActive) blockedFlag = 'Stale Candle';
      if ((state.max_drawdown || 0) >= 20) blockedFlag = 'Drawdown Limit Reached';
      if ((state.consecutive_losses || 0) >= 3) blockedFlag = 'Loss Streak Pause';

      if (blockedFlag) {
          log.actions.push({ type: 'SKIPPED', reason: blockedFlag });
      } else if (signal.confidence >= 55 && !signal.signal.includes('NEUTRAL')) {
          // 1. Position Sizing
          const isLong = signal.signal.includes('LONG');
          const marginMult = signal.marginMultiplier || 0.95;
          const desiredMargin = (state.balance || DEFAULT_STATE.balance) * marginMult;
          const margin = Math.min(desiredMargin, (state.balance || DEFAULT_STATE.balance)); // Balance safety constraint

          if (margin > 10) {
            const posId = `pos_${now}_${Math.random().toString(36).slice(2, 8)}`;
            const notional = margin * 20; 
            
            // 2. Store both TP1 and TP2
            const { error: insertError } = await supabase.from('positions').insert({
              id: posId, side: isLong ? 'LONG' : 'SHORT',
              entry_price: consensus.consensusPrice, current_price: consensus.consensusPrice,
              margin, notional, leverage: 20,
              stop_loss: signal.targets.stopLoss,
              take_profit1: signal.targets.tp1,
              take_profit2: signal.targets.tp2,
              partially_closed: false,
              unrealized_pnl: 0, status: 'OPEN', entry_time: now,
              confidence: signal.confidence, signal_score: signal.score
            });

            if (insertError) {
              console.error("Position Insert Failed:", insertError);
              log.errors.push(`Failed to insert position: ${insertError.message}`);
              log.actions.push({ type: 'FAILED_OPEN', reason: insertError.message });
            } else {
              await supabase.from('trade_history').insert({
                type: 'OPEN', side: isLong ? 'LONG' : 'SHORT', entry_price: consensus.consensusPrice, margin, leverage: 20,
                reason: `${signal.signal} | Conf: ${signal.confidence}% | Rgm: ${signal.regime} | Flags: ${(signal.riskFlags || []).join(',')}`
              });

              await supabase.from('trading_state').update({
                balance: (state.balance || DEFAULT_STATE.balance) - margin,
                last_trade_time: now
              }).eq('id', 'main');

              log.actions.push({ type: 'OPEN', side: isLong ? 'LONG' : 'SHORT', confidence: signal.confidence, entry: consensus.consensusPrice });
            }
          } else {
              log.actions.push({ type: 'SKIPPED', reason: 'Insufficient balance' });
          }
      } else {
          log.actions.push({ type: 'WAITING', confidence: signal.confidence });
      }
    } else {
      if (onCooldown) log.actions.push({ type: 'COOLDOWN' });
      else if (openPos) log.actions.push({ type: 'WAITING', reason: 'Pos Open Block' });
    }

    supabase.from('market_snapshots').insert({
      btc_consensus_price: consensus.consensusPrice,
      btc_coinbase_price: (consensus.allPrices || []).find(p => p.exchange === 'Coinbase')?.price,
      btc_binance_price: (consensus.allPrices || []).find(p => p.exchange === 'Binance')?.price,
      spread_percent: consensus.spread,
      source: 'multi_exchange_consensus'
    }).then(() => {}).catch(() => {});

    res.status(200).json({ ...log, executionTime: Date.now() - log.timestamp });

  } catch (err) {
    console.error('Evaluate error:', err);
    log.errors.push(err.message);
    res.status(500).json({ error: err.message, log });
  }
}
