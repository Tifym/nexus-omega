import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const INITIAL_BALANCE = 2050.75;

export default async function handler(req, res) {
  // Simple secret check — prevents accidental triggering
  if (req.query.secret !== 'nexus-reset-2024') {
    return res.status(403).json({ error: 'Forbidden. Use ?secret=nexus-reset-2024' });
  }

  const log = { actions: [] };

  try {
    // 1. Find ALL open positions
    const { data: openPositions, error: posError } = await supabase
      .from('positions')
      .select('*')
      .eq('status', 'OPEN');

    if (posError) throw posError;
    log.openPositionsFound = openPositions?.length ?? 0;

    // 2. Mark all open positions as CANCELLED (void them)
    if (openPositions && openPositions.length > 0) {
      const ids = openPositions.map(p => p.id);
      for (const pos of openPositions) {
        await supabase
          .from('positions')
          .update({ status: 'CANCELLED', exit_price: pos.current_price || pos.entry_price })
          .eq('id', pos.id);

        // Also void their trade_history OPEN entries
        // (trade_history has no good FK, so we just leave them as a record)
        log.actions.push({ cancelled: pos.id, side: pos.side, margin: pos.margin });
      }
    }

    // 3. Reset trading_state back to defaults
    const { error: stateError } = await supabase
      .from('trading_state')
      .upsert({
        id: 'main',
        balance: INITIAL_BALANCE,
        initial_balance: INITIAL_BALANCE,
        total_trades: 0,
        winning_trades: 0,
        max_drawdown: 0,
        last_trade_time: null
      });

    if (stateError) throw stateError;
    log.actions.push({ reset: 'trading_state', balance: INITIAL_BALANCE });

    // 4. Clear trade_history (fresh start)
    const { error: histError } = await supabase
      .from('trade_history')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all rows

    if (histError) {
      // Non-fatal — some Supabase setups require specific RLS for this
      log.actions.push({ warning: 'Could not clear trade_history: ' + histError.message });
    } else {
      log.actions.push({ cleared: 'trade_history' });
    }

    res.status(200).json({
      success: true,
      message: `Reset complete. Cancelled ${log.openPositionsFound} stuck positions. Balance restored to $${INITIAL_BALANCE}.`,
      log
    });

  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: err.message, log });
  }
}
