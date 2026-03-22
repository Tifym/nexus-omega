import { marketFeed } from './_utils/market.js';
import { signalEngine } from './_utils/signals.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const DEFAULT_STATE = {
  balance: 2050.75, initial_balance: 2050.75,
  total_trades: 0, winning_trades: 0,
  max_drawdown: 0, last_trade_time: null
};

export default async function handler(req, res) {
  const log = { timestamp: Date.now(), actions: [], errors: [] };

  try {
    // 1. Fetch price + signal in parallel
    const [consensus, signal] = await Promise.all([
      marketFeed.getConsensusPrice('BTC'),
      signalEngine.generateSignal()
    ]);

    log.price  = consensus.consensusPrice;
    log.signal = { text: signal.signal, confidence: signal.confidence };

    // 2. Load current state from Supabase
    const { data: stateRow } = await supabase
      .from('trading_state').select('*').eq('id', 'main').maybeSingle();
    const state = stateRow || DEFAULT_STATE;

    // Upsert state row if missing
    if (!stateRow) {
      await supabase.from('trading_state').upsert({ id: 'main', ...DEFAULT_STATE });
    }

    // Use limit(1) so we still get a result even if multiple OPEN rows exist (shouldn't happen, but defensive)
    const { data: openPosArr } = await supabase
      .from('positions').select('*').eq('status', 'OPEN').order('entry_time', { ascending: false }).limit(1);
    const openPos = openPosArr?.[0] ?? null;

    const now = Date.now();
    // Defensively parse last_trade_time — Supabase may return it as a string or bigint
    const lastTime = state.last_trade_time ? Number(String(state.last_trade_time)) : 0;
    const cooldownMs = 5 * 60 * 1000;
    const onCooldown = lastTime > 0 && (now - lastTime) < cooldownMs;

    // 3. Check exits on open position
    if (openPos && consensus.consensusPrice) {
      const price = consensus.consensusPrice;
      const margin = openPos.margin || 0;
      const notional = margin * 20; // leverage

      const rawPnl = openPos.side === 'LONG'
        ? ((price - openPos.entry_price) / openPos.entry_price) * notional
        : ((openPos.entry_price - price) / openPos.entry_price) * notional;
      const netPnl = rawPnl - (notional * 0.0006); // trading fee

      // Update live price
      await supabase.from('positions')
        .update({ current_price: price, unrealized_pnl: netPnl })
        .eq('id', openPos.id);

      let shouldExit = false, exitReason = '';
      if (openPos.side === 'LONG'  && price <= openPos.stop_loss)  { shouldExit = true; exitReason = 'Stop Loss'; }
      if (openPos.side === 'SHORT' && price >= openPos.stop_loss)  { shouldExit = true; exitReason = 'Stop Loss'; }
      if (openPos.side === 'LONG'  && price >= openPos.take_profit){ shouldExit = true; exitReason = 'Take Profit'; }
      if (openPos.side === 'SHORT' && price <= openPos.take_profit){ shouldExit = true; exitReason = 'Take Profit'; }

      if (shouldExit) {
        const newBalance = state.balance + margin + netPnl;
        await supabase.from('positions').update({ status: 'CLOSED', exit_price: price }).eq('id', openPos.id);
        await supabase.from('trade_history').insert({
          type: 'CLOSE', side: openPos.side,
          entry_price: openPos.entry_price, exit_price: price,
          margin, leverage: 20,
          net_pnl: netPnl, pnl_percent: (netPnl / margin) * 100, reason: exitReason
        });
        await supabase.from('trading_state').update({
          balance: newBalance,
          total_trades: (state.total_trades || 0) + 1,
          winning_trades: netPnl > 0 ? (state.winning_trades || 0) + 1 : (state.winning_trades || 0),
          max_drawdown: Math.max(state.max_drawdown || 0, Math.max(0, (state.initial_balance - newBalance) / state.initial_balance * 100)),
          last_trade_time: now
        }).eq('id', 'main');
        log.actions.push({ type: 'CLOSE', reason: exitReason, pnl: netPnl.toFixed(2) });
      } else {
        log.actions.push({ type: 'HOLD', unrealizedPnl: netPnl.toFixed(2) });
      }

    } else if (!openPos && !onCooldown && signal.confidence >= 55 && !signal.signal.includes('NEUTRAL')) {
      // 4. Open new position sized dynamically by V5 Engine
      const isLong = signal.signal.includes('LONG');
      const marginMult = signal.marginMultiplier || 0.95;
      const margin = (state.balance || DEFAULT_STATE.balance) * marginMult;

      if (margin > 10) {
        const posId = `pos_${now}_${Math.random().toString(36).slice(2, 8)}`;
        const notional = margin * 20; // leverage 20x
        const { error: insertError } = await supabase.from('positions').insert({
          id: posId,
          side: isLong ? 'LONG' : 'SHORT',
          entry_price: consensus.consensusPrice,
          current_price: consensus.consensusPrice,
          margin,
          notional,
          leverage: 20,
          stop_loss: signal.targets.stopLoss,
          take_profit: signal.targets.tp2,
          unrealized_pnl: 0,
          status: 'OPEN',
          entry_time: now,
          confidence: signal.confidence,
          signal_score: signal.score
        });

        if (insertError) {
          console.error("Position Insert Failed:", insertError);
          log.errors.push(`Failed to insert position: ${insertError.message}`);
          log.actions.push({ type: 'FAILED_OPEN', reason: insertError.message });
        } else {
          await supabase.from('trade_history').insert({
          type: 'OPEN',
          side: isLong ? 'LONG' : 'SHORT',
          entry_price: consensus.consensusPrice,
          margin, leverage: 20,
          reason: `${signal.signal} | Conf: ${signal.confidence}% | Rgm: ${signal.regime || 'UNK'} | Flags: ${(signal.riskFlags || []).join(',')}`
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
      if (onCooldown)  log.actions.push({ type: 'COOLDOWN' });
      else if (openPos) log.actions.push({ type: 'HOLD_EXISTING' });
      else             log.actions.push({ type: 'WAITING', confidence: signal.confidence });
    }

    // 5. Log market snapshot (best effort)
    supabase.from('market_snapshots').insert({
      btc_consensus_price: consensus.consensusPrice,
      btc_coinbase_price: (consensus.allPrices || []).find(p => p.exchange === 'Coinbase')?.price,
      btc_binance_price: (consensus.allPrices || []).find(p => p.exchange === 'Binance')?.price,
      spread_percent: consensus.spread,
      source: 'multi_exchange_consensus'
    }).then(() => {}).catch(() => {}); // fire and forget

    res.status(200).json({ ...log, executionTime: Date.now() - log.timestamp });

  } catch (err) {
    console.error('Evaluate error:', err);
    log.errors.push(err.message);
    res.status(500).json({ error: err.message, log });
  }
}
