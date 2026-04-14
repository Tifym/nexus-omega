-- ============================================================
-- Nexus Omega — trade_history & trading_state fix
-- Run this in Supabase SQL Editor ONCE
-- Fixes: balance resets, missing timestamps, partial close display
-- ============================================================

-- 1. Ensure trade_history has created_at with a proper DEFAULT
--    (safe if already exists — ALTER COLUMN only changes default, not existing data)
ALTER TABLE trade_history
  ALTER COLUMN created_at SET DEFAULT now();

-- If created_at column doesn't exist at all, add it:
-- ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 2. Ensure trading_state seed row exists so balance never resets to hardcoded default
INSERT INTO trading_state (id, balance, initial_balance, total_trades, winning_trades, max_drawdown, last_trade_time, consecutive_losses)
VALUES ('main', 2050.75, 2050.75, 0, 0, 0, NULL, 0)
ON CONFLICT (id) DO NOTHING;

-- 3. Verify the data looks correct
SELECT id, balance, initial_balance, total_trades, winning_trades FROM trading_state WHERE id = 'main';
SELECT type, side, net_pnl, created_at FROM trade_history ORDER BY created_at DESC LIMIT 10;
