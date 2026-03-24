import { Telegraf } from 'telegraf';
import { marketFeed } from './_utils/market.js';
import { signalEngine } from './_utils/signals.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Handlers
bot.command('status', async (ctx) => {
  try {
    const [price, signal, stateResult, positionResult] = await Promise.all([
      marketFeed.getConsensusPrice('BTC'),
      signalEngine.generateSignal(),
      supabase.from('trading_state').select('*').eq('id', 'main').maybeSingle(),
      supabase.from('positions').select('*').eq('status', 'OPEN').maybeSingle()
    ]);

    const state = stateResult.data || {};
    const pos = positionResult.data;

    let msg = `⚡ *Nexus Omega Status Check* ⚡\n\n`;
    msg += `📊 *Regime:* \`${signal.regime}\`\n`;
    msg += `🎯 *Current Signal:* \`${signal.signal}\` (${signal.confidence}%)\n`;
    msg += `💰 *BTC Price:* \`$${price.consensusPrice.toLocaleString()}\`\n`;
    msg += `🏦 *Account Balance:* \`$${state.balance.toFixed(2)}\`\n\n`;

    if (pos) {
        msg += `✅ *Active Position:* \`${pos.side} @ $${pos.entry_price}\`\n`;
        msg += `📈 *Unrealized PnL:* \`$${pos.unrealized_pnl.toFixed(2)}\`\n`;
    } else {
        msg += `⚪ *No Open Positions*\n`;
    }

    if (state.last_trade_time) {
        msg += `\n⌛ *Last Trade:* ${new Date(Number(state.last_trade_time)).toLocaleTimeString()}\n`;
    }

    ctx.replyWithMarkdown(msg);
  } catch (err) {
    console.error("Status Command Error:", err);
    ctx.reply("❌ Error fetching nexus status.");
  }
});

bot.command('start', (ctx) => ctx.reply("⚡ Nexus Omega Signal Bot Active. Send /status for current market stats. Ensure your CHAT_ID is correctly configured in Vercel."));

// Main Webhook Handler Export for Vercel
export default async function handler(req, res) {
  if (req.method === 'POST') {
    await bot.handleUpdate(req.body, res);
  } else {
    res.status(200).send('Telegram Bot Active (Nexus Omega Engine V5.2)');
  }
}
