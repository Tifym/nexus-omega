          import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export class TradingEngine {
    constructor() {
          this.config = {
                  leverage: 20,
                  maxPositionSize: 0.95,
                  stopLossPercent: 0.025,
                  takeProfitPercent: 0.05,
                  minConfidence: 65,
                  cooldownMinutes: 5,
                  tradingFee: 0.0006,
                  maxHoldTime: 8 * 60 * 60 * 1000,
                  trailingStopPercent: 0.015,
                  breakevenTrigger: 0.02,
                  breakevenBuffer: 0.001
          };
    }

  async getState() {
        const { data, error } = await supabase.from('trading_state').select('*').eq('id', 'main').single();
        if (error) throw error;
        return data;
  }

  async getOpenPosition() {
        const { data, error } = await supabase.from('positions').select('*').eq('status', 'OPEN').maybeSingle();
        if (error) throw error;
        return data;
  }

  async canTrade() {
        const state = await this.getState();
        if (!state.last_trade_time) return true;
        const cooldownMs = this.config.cooldownMinutes * 60 * 1000;
        return (Date.now() - state.last_trade_time) >= cooldownMs;
  }

          async openPosition(signal, price, consensus) {
                const state = await this.getState();
                if (!await this.canTrade()) {
                        const remaining = Math.ceil((this.config.cooldownMinutes * 60 * 1000 - (Date.now() - state.last_trade_time)) / 1000 / 60);
                        throw new Error('Cooldown active: ' + remaining + ' minutes remaining');
                }
                if (signal.confidence < this.config.minConfidence) throw new Error('Confidence too low: ' + signal.confidence + '%');

      const availableBalance = state.balance * this.config.maxPositionSize;
                const notional = availableBalance * this.config.leverage;
                const margin = notional / this.config.leverage;
                const quantity = notional / price;

      const isLong = signal.signal.includes('LONG');
                const stopLoss = isLong ? price * (1 - this.config.stopLossPercent) : price * (1 + this.config.stopLossPercent);
                const takeProfit = isLong ? price * (1 + this.config.takeProfitPercent) : price * (1 - this.config.takeProfitPercent);
                const entryFee = notional * this.config.tradingFee;

      if (state.balance < entryFee) throw new Error('Insufficient balance for fees');

      const positionId = 'pos_' + Date.now();

      const { error } = await supabase.rpc('open_position', {
              _id: positionId, _side: isLong ? 'LONG' : 'SHORT', _symbol: 'BTC-USD', _entry_price: price,
              _quantity: quantity, _notional: notional, _leverage: this.config.leverage, _margin: margin,
              _stop_loss: stopLoss, _take_profit: takeProfit, _entry_time: Date.now(), _entry_fee: entryFee,
              _signal_score: signal.score, _confidence: signal.confidence, _reasons: signal.reasons,
              _data_sources: consensus.allPrices, _consensus_price: consensus.consensusPrice
      });

      if (error) throw error;
                return { positionId, side: isLong ? 'LONG' : 'SHORT', entryPrice: price, quantity, margin, stopLoss, takeProfit, confidence: signal.confidence };
          }

          async checkPositionExit(position, currentConsensus) {
                const currentPrice = currentConsensus.consensusPrice;
                const isLong = position.side === 'LONG';
                let unrealizedPnl = isLong 
        ? ((currentPrice - position.entry_price) / position.entry_price) * position.notional
                        : ((position.entry_price - currentPrice) / position.entry_price) * position.notional;
                const pnlPercent = (unrealizedPnl / position.notional) * 100;

      if (isLong && currentPrice <= position.stop_loss) return { shouldClose: true, reason: 'STOP_LOSS', price: currentPrice };
                if (!isLong && currentPrice >= position.stop_loss) return { shouldClose: true, reason: 'STOP_LOSS', price: currentPrice };
                if (isLong && currentPrice >= position.take_profit) return { shouldClose: true, reason: 'TAKE_PROFIT', price: currentPrice };
                if (!isLong && currentPrice <= position.take_profit) return { shouldClose: true, reason: 'TAKE_PROFIT', price: currentPrice };

      const holdTime = Date.now() - new Date(position.entry_time).getTime();
                if (holdTime > this.config.maxHoldTime && Math.abs(pnlPercent) < 1) {
                        return { shouldClose: true, reason: 'MAX_TIME', price: currentPrice };
                }

      await supabase.rpc('update_position_prices', { _position_id: position.id, _current_price: currentPrice, _unrealized_pnl: unrealizedPnl });
                return { shouldClose: false, unrealizedPnl, pnlPercent };
          }

  async closePosition(position, exitPrice, reason, consensus) {
        const exitFee = position.notional * this.config.tradingFee;
        const { data, error } = await supabase.rpc('close_position', {
                _position_id: position.id, _exit_price: exitPrice, _exit_time: Date.now(),
                _exit_fee: exitFee, _reason: reason, _consensus_price: consensus.consensusPrice,
                _exchanges_data: consensus.allPrices
        });
        if (error) throw error;
        return { netPnl: data.net_pnl, pnlPercent: data.pnl_percent, balanceAfter: data.balance_after, reason };
  }
}

export const tradingEngine = new TradingEngine();
