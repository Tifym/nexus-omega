-- ============================================================
-- NEXUS OMEGA - Complete Database Schema + Stored Procedures
-- ============================================================

-- 1. TRADING STATE
CREATE TABLE IF NOT EXISTS trading_state (
  id TEXT PRIMARY KEY DEFAULT 'main',
  balance NUMERIC NOT NULL DEFAULT 2050.75,
  initial_balance NUMERIC NOT NULL DEFAULT 2050.75,
  total_trades INTEGER NOT NULL DEFAULT 0,
  winning_trades INTEGER NOT NULL DEFAULT 0,
  max_drawdown NUMERIC NOT NULL DEFAULT 0,
  last_trade_time BIGINT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. POSITIONS
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL CHECK (side IN ('LONG','SHORT')),
  symbol TEXT DEFAULT 'BTC-USD',
  entry_price NUMERIC NOT NULL,
  current_price NUMERIC,
  exit_price NUMERIC,
  quantity NUMERIC,
  notional NUMERIC,
  margin NUMERIC,
  leverage INTEGER NOT NULL DEFAULT 20,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  entry_fee NUMERIC DEFAULT 0,
  unrealized_pnl NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  entry_time BIGINT,
  exit_time BIGINT,
  signal_score NUMERIC,
  confidence NUMERIC,
  reasons JSONB,
  data_sources JSONB,
  breakeven_moved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TRADE HISTORY
CREATE TABLE IF NOT EXISTS trade_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('OPEN','CLOSE')),
  side TEXT CHECK (side IN ('LONG','SHORT')),
  entry_price NUMERIC,
  exit_price NUMERIC,
  margin NUMERIC,
  notional NUMERIC,
  leverage INTEGER DEFAULT 20,
  net_pnl NUMERIC DEFAULT 0,
  pnl_percent NUMERIC DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. MARKET SNAPSHOTS (used by evaluate.js)
CREATE TABLE IF NOT EXISTS market_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  btc_consensus_price NUMERIC,
  btc_binance_price NUMERIC,
  btc_coinbase_price NUMERIC,
  btc_bybit_price NUMERIC,
  btc_okx_price NUMERIC,
  btc_kraken_price NUMERIC,
  spread_percent NUMERIC,
  source TEXT DEFAULT 'multi_exchange_consensus',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- RPC STORED PROCEDURES
-- ============================================================

-- open_position
CREATE OR REPLACE FUNCTION open_position(
  _id TEXT, _side TEXT, _symbol TEXT, _entry_price NUMERIC,
  _quantity NUMERIC, _notional NUMERIC, _leverage INTEGER, _margin NUMERIC,
  _stop_loss NUMERIC, _take_profit NUMERIC, _entry_time BIGINT, _entry_fee NUMERIC,
  _signal_score NUMERIC, _confidence NUMERIC, _reasons JSONB,
  _data_sources JSONB, _consensus_price NUMERIC
) RETURNS VOID AS $$
BEGIN
  INSERT INTO positions (id, side, symbol, entry_price, current_price, quantity, notional,
    leverage, margin, stop_loss, take_profit, entry_time, entry_fee, signal_score,
    confidence, reasons, data_sources, status)
  VALUES (_id, _side, _symbol, _entry_price, _consensus_price, _quantity, _notional,
    _leverage, _margin, _stop_loss, _take_profit, _entry_time, _entry_fee, _signal_score,
    _confidence, _reasons, _data_sources, 'OPEN');

  UPDATE trading_state
  SET balance = balance - _margin,
      last_trade_time = _entry_time,
      updated_at = NOW()
  WHERE id = 'main';

  INSERT INTO trade_history (type, side, entry_price, margin, notional, leverage, reason)
  VALUES ('OPEN', _side, _entry_price, _margin, _notional, _leverage,
    'Signal: ' || _signal_score::TEXT || ' (' || _confidence::TEXT || '% confidence)');
END;
$$ LANGUAGE plpgsql;

-- close_position
CREATE OR REPLACE FUNCTION close_position(
  _position_id TEXT, _exit_price NUMERIC, _exit_time BIGINT,
  _exit_fee NUMERIC, _reason TEXT, _consensus_price NUMERIC, _exchanges_data JSONB
) RETURNS TABLE(net_pnl NUMERIC, pnl_percent NUMERIC, balance_after NUMERIC) AS $$
DECLARE
  pos positions%ROWTYPE;
  _raw_pnl NUMERIC;
  _net_pnl NUMERIC;
  _pnl_pct NUMERIC;
  _new_balance NUMERIC;
  _state trading_state%ROWTYPE;
BEGIN
  SELECT * INTO pos FROM positions WHERE id = _position_id;
  SELECT * INTO _state FROM trading_state WHERE id = 'main';

  IF pos.side = 'LONG' THEN
    _raw_pnl := ((_exit_price - pos.entry_price) / pos.entry_price) * pos.notional;
  ELSE
    _raw_pnl := ((pos.entry_price - _exit_price) / pos.entry_price) * pos.notional;
  END IF;

  _net_pnl   := _raw_pnl - pos.entry_fee - _exit_fee;
  _pnl_pct   := (_net_pnl / pos.margin) * 100;
  _new_balance := _state.balance + pos.margin + _net_pnl;

  UPDATE positions
  SET status = 'CLOSED', exit_price = _exit_price, exit_time = _exit_time,
      unrealized_pnl = _net_pnl
  WHERE id = _position_id;

  UPDATE trading_state
  SET balance      = _new_balance,
      total_trades = total_trades + 1,
      winning_trades = CASE WHEN _net_pnl > 0 THEN winning_trades + 1 ELSE winning_trades END,
      max_drawdown = GREATEST(max_drawdown, GREATEST(0, (initial_balance - _new_balance) / initial_balance * 100)),
      last_trade_time = _exit_time,
      updated_at = NOW()
  WHERE id = 'main';

  INSERT INTO trade_history (type, side, entry_price, exit_price, margin, notional,
    leverage, net_pnl, pnl_percent, reason)
  VALUES ('CLOSE', pos.side, pos.entry_price, _exit_price, pos.margin, pos.notional,
    pos.leverage, _net_pnl, _pnl_pct, _reason);

  RETURN QUERY SELECT _net_pnl, _pnl_pct, _new_balance;
END;
$$ LANGUAGE plpgsql;

-- move_stop_to_breakeven
CREATE OR REPLACE FUNCTION move_stop_to_breakeven(
  _position_id TEXT, _new_stop NUMERIC
) RETURNS VOID AS $$
BEGIN
  UPDATE positions
  SET stop_loss = _new_stop, breakeven_moved = TRUE
  WHERE id = _position_id;
END;
$$ LANGUAGE plpgsql;

-- update_position_prices
CREATE OR REPLACE FUNCTION update_position_prices(
  _position_id TEXT, _current_price NUMERIC, _unrealized_pnl NUMERIC
) RETURNS VOID AS $$
BEGIN
  UPDATE positions
  SET current_price = _current_price, unrealized_pnl = _unrealized_pnl
  WHERE id = _position_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SEED INITIAL STATE
-- ============================================================
INSERT INTO trading_state (id, balance, initial_balance, total_trades, winning_trades, max_drawdown)
VALUES ('main', 2050.75, 2050.75, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Verify
SELECT * FROM trading_state;
