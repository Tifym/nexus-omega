import { marketFeed } from './_utils/market.js';
import { signalEngine } from './_utils/signals.js';
import { createClient } from '@supabase/supabase-js';
import { formatTelegramSignal } from './_utils/tg_formatter.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        return res.status(500).json({ error: "Missing Telegram configuration (TOKEN/CHAT_ID)" });
    }

    try {
        // 1. Fetch live data
        const [consensus, signal, stateResult] = await Promise.all([
            marketFeed.getConsensusPrice('BTC'),
            signalEngine.generateSignal(),
            supabase.from('trading_state').select('*').eq('id', 'main').maybeSingle()
        ]);

        const state = stateResult.data || {};
        const lastSent = state.last_sent_signal || 'NEUTRAL';
        const lastRegime = state.last_sent_regime || 'UNKNOWN';

        // 2. Determine if we should send alert
        let shouldSend = false;
        let events = [];

        if (signal.signal !== lastSent) {
            shouldSend = true;
            events.push(`Signal Flip: ${lastSent} → ${signal.signal}`);
        }
        if (signal.regime !== lastRegime) {
            shouldSend = true;
            events.push(`Regime Shift: ${lastRegime} → ${signal.regime}`);
        }
        if (signal.confidence >= 80 && lastSent !== signal.signal) {
            shouldSend = true;
            events.push(`High-Conviction Alert 🔥`);
        }

        const currentFunding = signal.marketStructure.fundingRate;
        const lastFunding = state.last_recorded_funding || 0;
        if ((currentFunding > 0 && lastFunding < 0) || (currentFunding < 0 && lastFunding > 0)) {
            shouldSend = true;
            events.push("💰 FUNDING FLIP DETECTED");
        }

        // 3. Send Message
        if (shouldSend) {
            const botMsg = formatTelegramSignal(signal, consensus.consensusPrice, signal.regime !== lastRegime, events);
            const tgUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
            
            await fetch(tgUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: botMsg,
                    parse_mode: 'Markdown'
                })
            });

            // Update State
            await supabase.from('trading_state').update({
                last_sent_signal: signal.signal,
                last_sent_regime: signal.regime,
                last_recorded_funding: currentFunding
            }).eq('id', 'main');

            return res.status(200).json({ status: "SENT", signal: signal.signal });
        }

        return res.status(200).json({ status: "SKIPPED", signal: signal.signal });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
