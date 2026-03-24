/**
 * SignalEngine V5.2 -> Telegram Markdown Formatter
 * Generates beautiful, emoji-rich trading alerts.
 */

export function formatTelegramSignal(signal, price, isNewRegime = false, events = []) {
    const { signal: text, confidence, regime, score, riskFlags, reasons, targets, indicators, marketStructure } = signal;
    
    // Choose main emoji and title
    let title = "⚪ *NEUTRAL / WAITING*";
    let mainEmoji = "⚪";
    
    if (text === "LONG") {
        if (confidence >= 85) { title = "🟢 *STRONG LONG*"; mainEmoji = "🟢"; }
        else if (confidence >= 70) { title = "🟢 *LONG*"; mainEmoji = "🟢"; }
        else if (confidence >= 55) { title = "🟡 *WEAK LONG*"; mainEmoji = "🟡"; }
        else { title = "🔵 *LONG BIAS*"; mainEmoji = "🔵"; }
    } else if (text === "SHORT") {
        if (confidence >= 85) { title = "🔴 *STRONG SHORT*"; mainEmoji = "🔴"; }
        else if (confidence >= 70) { title = "🔴 *SHORT*"; mainEmoji = "🔴"; }
        else if (confidence >= 55) { title = "🟠 *WEAK SHORT*"; mainEmoji = "🟠"; }
        else { title = "🔵 *SHORT BIAS*"; mainEmoji = "🔵"; }
    }

    // Regime Mapping
    const regimeEmojis = {
        'STRONG_TREND': '🔥 STRONG TREND',
        'TRENDING': '📈 TRENDING',
        'CHOP': '📊 CHOP',
        'BREAKOUT_IMMINENT': '🚀 BREAKOUT IMMINENT',
        'TIGHT_RANGE': '🪓 TIGHT RANGE'
    };
    const regimeTag = regimeEmojis[regime] || `📊 ${regime}`;

    // Build the message
    let msg = `${mainEmoji} ${title}\n\n`;
    
    msg += `💰 *BTC Price:* \`$${price.toLocaleString()}\`\n`;
    msg += `🎯 *Confidence:* \`${confidence}%\`\n`;
    msg += `${regimeTag ? regimeTag : ''}\n\n`;

    // Indicators section
    msg += `📊 *Indicators:*\n`;
    msg += `• RSI: \`${indicators.rsi || '--'}\`\n`;
    msg += `• ADX: \`${indicators.adx || '--'}\`\n`;
    msg += `• Volatility: \`${indicators.volatility || '--'}\` (Rel: \`${indicators.relativeVol || '--'}\`x)\n`;
    if (marketStructure.longShortRatio) msg += `• L/S Ratio: \`${marketStructure.longShortRatio}\`\n`;
    msg += `• POC: \`${marketStructure.poc || '--'}\`\n\n`;

    // Targets Section
    if (text !== "NEUTRAL") {
        msg += `🎯 *Target Levels:*\n`;
        msg += `🛑 *Stop:* \`$${targets.stopLoss.toFixed(1)}\`\n`;
        msg += `✅ *TP 1 (50%):* \`$${targets.tp1.toFixed(1)}\`\n`;
        msg += `✅ *TP 2 (100%):* \`$${targets.tp2.toFixed(1)}\`\n\n`;
    }

    // Reasons/Flow Signals
    if (reasons && reasons.length > 0) {
        msg += `📝 *Signal Analysis:*\n`;
        reasons.slice(0, 5).forEach(r => {
            let emoji = "•";
            if (r.includes("Divergence")) emoji = r.includes("Bullish") ? "📈" : "📉";
            if (r.includes("Breakout")) emoji = "🚀";
            if (r.includes("Funding")) emoji = "💰";
            if (r.includes("OI")) emoji = r.includes("Rising") ? "📈" : "📉";
            if (r.includes("Liq")) emoji = "💥";
            msg += `${emoji} ${r}\n`;
        });
        msg += `\n`;
    }

    // Specific Events (Funding Flipped, OI Surge, etc.)
    if (events && events.length > 0) {
        msg += `🔔 *Active Events:*\n`;
        events.forEach(e => msg += `• ${e}\n`);
        msg += `\n`;
    }

    // Risk Flags
    if (riskFlags && riskFlags.length > 0) {
        msg += `⚠️ *Risk Warnings:*\n`;
        riskFlags.forEach(f => msg += `• ${f}\n`);
        msg += `\n`;
    }

    msg += `_⚡ Nexus Omega V5.2 | Automated Intelligence_`;

    return msg;
}
