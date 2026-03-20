// ═══════════════════════════════════════════════════════════════
// NEXUS OMEGA v4.0 - Glassmorphism UI Controller
// ═══════════════════════════════════════════════════════════════

class NexusOmegaDashboard {
    constructor() {
        this.apiUrl = '';
        this.pollingInterval = null;
        this.soundEnabled = true;
        this.audioContext = null;

        this.lastState = {
            signalText: null,
            positionOpen: null,
            balance: null
        };

        this.checkBootSequence();
    }

    // ── Helpers ───────────────────────────────────────────────
    set(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    el(id) {
        return document.getElementById(id);
    }

    // ── Boot Overlay ──────────────────────────────────────────
    checkBootSequence() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position:fixed; top:0; left:0; width:100vw; height:100vh;
            background:#000; z-index:99999999;
            display:flex; flex-direction:column;
            justify-content:center; align-items:center;
            font-family:'JetBrains Mono',monospace; transition:opacity 1.5s ease;
        `;

        const logo = document.createElement('div');
        logo.style.cssText = 'font-size:32px; font-weight:800; letter-spacing:4px; background:linear-gradient(135deg,#f0b90b,#f97316); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; margin-bottom:20px;';
        logo.textContent = '⚡ NEXUS OMEGA';

        const button = document.createElement('button');
        button.textContent = '[ INITIATE SYSTEM STARTUP ]';
        button.style.cssText = `
            padding:20px 40px; background:transparent; color:#00d4ff;
            border:2px solid #00d4ff; font-size:20px; cursor:pointer;
            letter-spacing:2px; box-shadow:0 0 20px rgba(0,212,255,0.3);
            font-family:'JetBrains Mono',monospace; transition:all 0.2s;
        `;
        button.onmouseover = () => { button.style.background='#00d4ff'; button.style.color='#000'; };
        button.onmouseout  = () => { button.style.background='transparent'; button.style.color='#00d4ff'; };

        overlay.appendChild(logo);
        overlay.appendChild(button);
        document.body.appendChild(overlay);

        button.addEventListener('click', async () => {
            button.style.opacity = '0';
            this.initAudio();

            const bootLines = [
                'Establishing secure uplink...',
                'Bypassing node security...',
                'Syncing neural trading engine...',
                'Loading... I am an AI trading bot. Let\'s make some money!'
            ];

            for (let i = 0; i < bootLines.length; i++) {
                await new Promise(r => setTimeout(r, 600));
                this.playBeep(800 + i * 100, 100, 'square');
                const line = document.createElement('div');
                line.style.cssText = 'color:#00d084; font-size:14px; margin-top:10px; text-shadow:0 0 10px #00d084;';
                line.textContent = '> ' + bootLines[i];
                overlay.appendChild(line);
                if (i === bootLines.length - 1) this.speak(bootLines[i]);
            }

            await new Promise(r => setTimeout(r, 2500));
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.remove();
                this.startPolling();
                this.updateClock();
            }, 1500);
        });
    }

    // ── Audio ─────────────────────────────────────────────────
    initAudio() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    playBeep(frequency = 800, duration = 200, type = 'sine') {
        if (!this.soundEnabled || !this.audioContext) return;
        try {
            const osc  = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            osc.connect(gain);
            gain.connect(this.audioContext.destination);
            osc.frequency.value = frequency;
            osc.type = type;
            gain.gain.setValueAtTime(0.1, this.audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration / 1000);
            osc.start(this.audioContext.currentTime);
            osc.stop(this.audioContext.currentTime + duration / 1000);
        } catch (e) { /* audio failed silently */ }
    }

    speak(text) {
        if (!this.soundEnabled || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = 1.0; utt.pitch = 1.2; utt.volume = 0.8;
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(v =>
            v.name.includes('Google UK English Female') ||
            v.name.includes('Samantha') ||
            v.name.includes('Siri')
        );
        if (preferred) utt.voice = preferred;
        window.speechSynthesis.speak(utt);
    }

    playTradeOpen()        { this.playBeep(600,300,'sine'); setTimeout(()=>this.playBeep(800,200,'sine'),100); this.speak('Live trade intercepted. Executing position.'); }
    playTradeProfitClose() { this.playBeep(1000,150,'sine'); setTimeout(()=>this.playBeep(1200,150,'sine'),100); setTimeout(()=>this.playBeep(1500,200,'sine'),200); this.speak('Trade closed. Taking profit.'); }
    playTradeLossClose()   { this.playBeep(400,300,'sawtooth'); setTimeout(()=>this.playBeep(300,400,'sawtooth'),150); this.speak('Trade closed at a loss.'); }

    // ── Polling ───────────────────────────────────────────────
    startPolling() {
        this.fetchData();
        this.pollingInterval = setInterval(() => this.fetchData(), 15000);
        setInterval(() => this.updateClock(), 1000);
    }

    updateClock() {
        const el = this.el('clock');
        if (el) el.textContent = new Date().toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
    }

    formatPrice(price) {
        if (!price || isNaN(price)) return '0.00';
        return parseFloat(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    async fetchData() {
        try {
            const start    = Date.now();
            const response = await fetch(`${this.apiUrl}/api/status`);
            const data     = await response.json();
            const latency  = Date.now() - start;
            const latEl    = this.el('footer-latency');
            if (latEl) latEl.textContent = `⚡ ${latency}ms`;
            if (data.error) { console.error('API Error:', data.error); return; }
            this.updateDashboard(data);
        } catch (err) {
            console.error('Fetch failed:', err);
        }
    }

    // ── Dashboard Renderer ────────────────────────────────────
    updateDashboard(data) {
        if (!data || !data.signal || !data.price || !data.stats) return;

        // ── 1. Header ────────────────────────────────────────
        this.set('header-price',    '$' + this.formatPrice(data.price.consensus));
        this.set('header-spread',   (data.price.spread || 0).toFixed(3) + '% Spread');
        const excLen = (data.price.exchanges || []).length;
        this.set('header-exchanges', excLen + ' LIVE EXCH');

        const fg    = data.signal.fearGreed || 50;
        const fgCls = fg < 25 ? 'Extreme Fear' : fg > 75 ? 'Extreme Greed' : 'Neutral';
        const fgCol = fg < 25 ? 'var(--accent-red)' : fg > 75 ? 'var(--accent-green)' : 'var(--text-secondary)';
        this.set('header-fear-val',   fg);
        this.set('header-fear-class', fgCls);
        const fvEl = this.el('header-fear-val');   if (fvEl) fvEl.style.color = fgCol;
        const fcEl = this.el('header-fear-class'); if (fcEl) fcEl.style.color = fgCol;

        // ── 2. Portfolio ─────────────────────────────────────
        this.set('balance-val',     '$' + this.formatPrice(data.stats.balance));
        this.set('initial-balance', '$' + this.formatPrice(data.stats.initialBalance));

        const ret   = ((data.stats.balance - data.stats.initialBalance) / data.stats.initialBalance) * 100;
        const badge = this.el('balance-change-badge');
        if (badge) {
            badge.textContent = (ret >= 0 ? '+' : '') + ret.toFixed(2) + '%';
            badge.style.color = ret >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        }

        this.set('stat-winrate',      data.stats.winRate + '%');
        this.set('stat-trades',       data.stats.totalTrades);
        this.set('stat-drawdown',     (data.stats.maxDrawdown || 0).toFixed(2) + '%');
        this.set('unrealized-pnl-summary', '$0.00');

        // ── 3. Signal Panel ──────────────────────────────────
        const signalText = (data.signal.text || 'NEUTRAL');
        const sMain = this.el('signal-main-box');
        if (sMain) sMain.className = 'signal-main glass-strong ' + signalText.toLowerCase().replace(/_/g, '-');

        this.set('signal-badge', signalText.replace(/_/g, ' '));

        const conf    = Math.max(0, data.signal.confidence || 0);
        const fillBar = this.el('exec-fill-bar');
        const execLbl = this.el('exec-val');
        if (fillBar) {
            fillBar.style.width = Math.min(100, conf) + '%';
            const fired = conf >= 65 && signalText !== 'NEUTRAL';
            fillBar.style.background = fired
                ? 'linear-gradient(90deg,#00d084 0%,#00d4ff 100%)'
                : 'linear-gradient(90deg,#f0b90b 0%,#f97316 100%)';
            if (execLbl) {
                execLbl.textContent = conf + '% / 65%';
                execLbl.style.color  = fired ? 'var(--accent-green)' : 'var(--accent-yellow)';
            }
        }

        this.set('current-price', '$' + this.formatPrice(data.price.consensus));
        this.set('signal-timestamp', new Date(data.price.timestamp || Date.now()).toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}));

        // ── 4. Indicators ────────────────────────────────────
        const score   = data.signal.score || 0;
        const scoreEl = this.el('metric-score');
        if (scoreEl) {
            scoreEl.textContent = (score > 0 ? '+' : '') + score;
            scoreEl.className   = 'metric-value ' + (score > 0 ? 'profit' : score < 0 ? 'loss' : '');
        }

        const ind = data.signal.indicators || {};
        this.set('metric-rsi', ind.rsi  || '--');
        this.set('metric-atr', ind.atr  || '--');
        this.set('metric-vol', (ind.volatility || '--') + (ind.volatility ? '%' : ''));

        // ── 5. Reasons ───────────────────────────────────────
        const rList = this.el('reasons-list');
        if (rList) {
            rList.innerHTML = '';
            const reasons = data.signal.reasons || [];
            if (reasons.length === 0) {
                rList.innerHTML = '<span class="reason-tag">Computing indicators...</span>';
            } else {
                reasons.forEach(r => {
                    const tag = document.createElement('span');
                    tag.className   = 'reason-tag';
                    tag.textContent = typeof r === 'string' ? r : (r.type || JSON.stringify(r));
                    rList.appendChild(tag);
                });
            }
        }

        // ── 6. Signal Trade Levels ───────────────────────────
        const lvls = this.el('trade-levels-container');
        if (lvls) {
            const hasSL = data.signal.stopLoss && signalText !== 'NEUTRAL';
            lvls.style.display = hasSL ? 'grid' : 'none';
            if (hasSL) {
                this.set('level-sl', '$' + this.formatPrice(data.signal.stopLoss));
                this.set('level-tp', '$' + this.formatPrice(data.signal.takeProfit));
            }
        }

        // ── 7. Active Positions ──────────────────────────────
        const posCont = this.el('active-positions-container');
        if (posCont) {
            if (data.position) {
                const p    = data.position;
                const cur  = data.price.consensus;
                const distSL = Math.abs(cur - p.stopLoss);
                const distTP = Math.abs(p.takeProfit - cur);
                const total  = distSL + distTP || 1;
                const slPct  = Math.min(100, Math.max(5, (1 - distSL / total) * 100));
                const tpPct  = Math.min(100, Math.max(5, (1 - distTP / total) * 100));
                const pnl    = p.unrealizedPnl || 0;

                posCont.innerHTML = `
                <div class="position-card ${p.side.toLowerCase()} glass-hover">
                    <div class="pos-header">
                        <div class="pos-pair">
                            <span class="pos-symbol">BTC/USDT</span>
                            <span class="pos-leverage">20x</span>
                        </div>
                        <div class="pos-pnl ${pnl >= 0 ? 'profit' : 'loss'}">${pnl >= 0 ? '+' : ''}$${this.formatPrice(pnl)}</div>
                    </div>
                    <div class="pos-details-grid">
                        <div class="pos-detail"><span class="detail-label">Side</span><span class="detail-value side-${p.side.toLowerCase()}">${p.side}</span></div>
                        <div class="pos-detail"><span class="detail-label">Entry Price</span><span class="detail-value">$${this.formatPrice(p.entryPrice)}</span></div>
                        <div class="pos-detail"><span class="detail-label">Current Price</span><span class="detail-value">$${this.formatPrice(cur)}</span></div>
                        <div class="pos-detail"><span class="detail-label">Margin</span><span class="detail-value">$${this.formatPrice(p.margin)}</span></div>
                    </div>
                    <div class="position-prox-bars">
                        <div class="prox-container">
                            <div class="prox-label"><span>Stop Loss</span><span class="loss">$${this.formatPrice(p.stopLoss)}</span></div>
                            <div class="prox-bg"><div class="prox-fill stop-loss" style="width:${slPct}%"></div></div>
                        </div>
                        <div class="prox-container" style="margin-top:8px">
                            <div class="prox-label"><span>Take Profit</span><span class="profit">$${this.formatPrice(p.takeProfit)}</span></div>
                            <div class="prox-bg"><div class="prox-fill take-profit" style="width:${tpPct}%"></div></div>
                        </div>
                    </div>
                </div>`;

                this.set('unrealized-pnl-summary', (pnl >= 0 ? '+' : '') + '$' + this.formatPrice(pnl));
            } else {
                posCont.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📈</div>
                    <div class="empty-text">No Active Positions</div>
                    <div class="empty-sub">Waiting for signal...</div>
                </div>`;
            }
        }

        // ── 8. Recent Trades ─────────────────────────────────
        // (fetched via /api/trades periodically if needed)

        // ── 9. Sound / Event Tracking ────────────────────────
        if (this.lastState.signalText !== null && data.signal.text !== this.lastState.signalText) {
            if (data.signal.text !== 'NEUTRAL') this.playBeep(900, 100, 'sine');
        }
        this.lastState.signalText = data.signal.text;

        const isOpen = data.stats.hasOpenPosition;
        if (this.lastState.positionOpen !== null) {
            if (isOpen && !this.lastState.positionOpen) this.playTradeOpen();
            if (!isOpen && this.lastState.positionOpen && data.lastTrade) {
                data.lastTrade.netPnl > 0 ? this.playTradeProfitClose() : this.playTradeLossClose();
            }
        }
        this.lastState.positionOpen = isOpen;
    }
}

// Kick off
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new NexusOmegaDashboard();
});
