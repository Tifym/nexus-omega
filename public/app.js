// ═══════════════════════════════════════════════════════════════
// NEXUS OMEGA v4.1 - JARVIS Interface Controller (FIXED)
// ═══════════════════════════════════════════════════════════════

class NexusOmegaDashboard {
    constructor() {
        this.apiUrl = '';
        this.pollingInterval = null;
        this.audioEnabled = localStorage.getItem('audioEnabled') !== 'false';
        this.lastSignal = null;
        this.lastTradeTime = null;
        this.startTime = Date.now();
        this.audioCtx = null;
        this.circuitLines = [];
        this.booted = false;

        this.init();
    }

    init() {
        this.generateCircuitLines();
        this.checkBootSequence();
        this.startUptimeCounter();
        this.setupEventListeners();
    }

    generateCircuitLines() {
        const container = document.getElementById('circuit-bg');
        if (!container) return;

        for (let i = 0; i < 5; i++) {
            const line = document.createElement('div');
            line.className = 'circuit-line';
            line.style.top = `${Math.random() * 100}%`;
            line.style.width = `${Math.random() * 200 + 100}px`;
            line.style.animationDelay = `${Math.random() * 5}s`;
            line.style.animationDuration = `${Math.random() * 10 + 15}s`;
            container.appendChild(line);
        }
    }

    // ─── AUDIO SYNTHESIS: Generate Sci-Fi Beeps without MP3s! ───
    beep(freq = 800, duration = 80) {
        if (!this.audioEnabled || !this.audioCtx) return;

        // Ensure audio context is running (browser requires user gesture)
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        try {
            const oscillator = this.audioCtx.createOscillator();
            const gainNode = this.audioCtx.createGain();

            // Square wave for the crunchy, retro computer aesthetic
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(freq, this.audioCtx.currentTime); 

            gainNode.gain.setValueAtTime(0.05, this.audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + (duration/1000));

            oscillator.connect(gainNode);
            gainNode.connect(this.audioCtx.destination);

            oscillator.start();
            oscillator.stop(this.audioCtx.currentTime + (duration/1000));
        } catch (e) {
            console.log('Beep failed', e);
        }
    }

    checkBootSequence() {
        // If the boot sequence ALREADY played this session, skip straight to the dashboard
        if (sessionStorage.getItem('nexus_booted')) {
            this.showDashboard();
            this.startPolling();
            return;
        }

        // Create an immersive "Click to Start" overlay to unlock browser audio permissions natively!
        const overlay = document.createElement('div');
        overlay.id = 'start-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0'; 
        overlay.style.left = '0';
        overlay.style.width = '100vw'; 
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.95)';
        overlay.style.zIndex = '9999';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.cursor = 'pointer';
        overlay.style.color = '#00ffcc';
        overlay.style.fontFamily = 'monospace';
        overlay.style.fontSize = '24px';
        overlay.style.letterSpacing = '2px';
        overlay.style.transition = 'opacity 0.5s';

        overlay.innerHTML = `
            <div style="padding: 30px; border: 2px solid #00ffcc; box-shadow: 0 0 20px rgba(0,255,204,0.2); background: rgba(0, 255, 204, 0.05); text-align: center; animation: pulse 2s infinite;">
                <div style="font-size: 14px; margin-bottom: 10px; opacity: 0.7;">CONNECTION ESTABLISHED</div>
                <div style="font-size: 28px; margin-bottom: 15px;">[ INITIATE SYSTEM STARTUP ]</div>
                <div style="font-size: 12px; opacity: 0.5;">Click anywhere to initialize audio systems</div>
            </div>
            <style>
                @keyframes pulse {
                    0%, 100% { box-shadow: 0 0 20px rgba(0,255,204,0.2); }
                    50% { box-shadow: 0 0 40px rgba(0,255,204,0.4); }
                }
            </style>
        `;

        document.body.appendChild(overlay);

        overlay.addEventListener('click', () => {
            // Wake up the Audio Context the exact second the user clicks!
            if (!this.audioCtx) {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Resume if suspended (browser policy requires user gesture)
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }

            overlay.style.opacity = '0';
            setTimeout(() => {
                if (overlay.parentNode) {
                    document.body.removeChild(overlay);
                }
                this.playBootSequence();
            }, 500);
        });
    }

    playBootSequence() {
        const bootTexts = [
            { text: 'INITIALIZING NEXUS OMEGA...', sub: 'Loading core systems', delay: 0 },
            { text: 'CONNECTING TO BINANCE...', sub: 'WebSocket handshake', delay: 800 },
            { text: 'CONNECTING TO COINBASE...', sub: 'REST API established', delay: 1400 },
            { text: 'CONNECTING TO BYBIT...', sub: 'Market data feed active', delay: 2000 },
            { text: 'CONNECTING TO OKX...', sub: 'Price stream connected', delay: 2600 },
            { text: 'CONNECTING TO KRAKEN...', sub: 'Aggregating data sources', delay: 3200 },
            { text: 'CALIBRATING CONSENSUS...', sub: 'Multi-exchange sync', delay: 3800 },
            { text: 'NEURAL NETWORKS ONLINE...', sub: 'Signal engine ready', delay: 4400 },
            { text: 'SYSTEM READY', sub: 'All systems operational', delay: 5200 }
        ];

        // Initial beep
        this.beep(600, 100);

        bootTexts.forEach(step => {
            setTimeout(() => {
                const bootText = document.getElementById('boot-text');
                const bootSub = document.getElementById('boot-subtext');

                if (bootText) bootText.textContent = step.text;
                if (bootSub) bootSub.textContent = step.sub;

                // Play a dynamic beep frequency for each line of the boot!
                if (step.text === 'SYSTEM READY') {
                    this.beep(1200, 300); // Triumphant high beep
                    this.speak("Loading... I am an A. I. trading bot. Let's make some money!");
                } else {
                    // Random retro computer tick between 600-1000Hz
                    const freq = 600 + Math.random() * 400;
                    this.beep(freq, 60);
                }

                if (step.text === 'SYSTEM READY') {
                    setTimeout(() => {
                        const bootSeq = document.getElementById('boot-sequence');
                        if (bootSeq) {
                            bootSeq.style.opacity = '0';
                            setTimeout(() => {
                                bootSeq.style.display = 'none';
                                sessionStorage.setItem('nexus_booted', 'true');
                                this.showDashboard();
                                this.startPolling();
                            }, 500);
                        }
                    }, 1000);
                }
            }, step.delay);
        });
    }

    showDashboard() {
        const dashboard = document.getElementById('dashboard');
        if (dashboard) {
            dashboard.style.display = 'block';
            void dashboard.offsetWidth;
        }
        this.booted = true;
    }

    startUptimeCounter() {
        setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
            const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');

            const uptimeEl = document.getElementById('header-uptime');
            if (uptimeEl) uptimeEl.textContent = `${hours}:${minutes}:${seconds}`;

            const now = new Date();
            const tsEl = document.getElementById('timestamp');
            if (tsEl) tsEl.textContent = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        }, 1000);
    }

    async fetchStatus() {
        const start = Date.now();
        try {
            const response = await fetch('/api/status');
            const data = await response.json();

            const latency = Date.now() - start;
            const headerLat = document.getElementById('header-latency');
            const footerLat = document.getElementById('footer-latency');

            if (headerLat) headerLat.textContent = `${latency}ms`;
            if (footerLat) footerLat.textContent = `Latency: ${latency}ms`;

            this.updateDashboard(data);
        } catch (error) {
            this.showError('Connection lost - retrying...');
            console.error('Status fetch failed:', error);
        }
    }

    updateDashboard(data) {
        if (data.price) this.updatePriceDisplay(data.price);
        if (data.signal) this.updateSignalDisplay(data.signal);
        if (data.stats) this.updateStats(data.stats);

        if (data.position) {
            this.updatePosition(data.position);
        } else {
            this.clearPosition();
        }

        if (data.lastTrade && data.lastTrade.time !== this.lastTradeTime) {
            this.lastTradeTime = data.lastTrade.time;
            this.announceTrade(data.lastTrade);
            this.addTradeToHistory(data.lastTrade);
        }
    }

    updatePriceDisplay(priceData) {
        const mainPrice = document.getElementById('main-price');
        if (!mainPrice) return;

        const oldPrice = parseFloat(mainPrice.dataset.price || 0);
        const newPrice = priceData.consensus;

        mainPrice.textContent = newPrice.toLocaleString('en-US', { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
        });
        mainPrice.dataset.price = newPrice;

        if (oldPrice !== 0 && oldPrice !== newPrice) {
            const direction = newPrice > oldPrice ? 'up' : 'down';
            mainPrice.classList.remove('up', 'down');
            void mainPrice.offsetWidth; 
            mainPrice.classList.add(direction);
        }

        const spreadEl = document.getElementById('spread-indicator');
        if (spreadEl) {
            if (priceData.spread > 0.3) {
                spreadEl.className = 'spread-warning';
                spreadEl.textContent = `⚠️ High spread: ${priceData.spread.toFixed(2)}%`;
            } else {
                spreadEl.className = 'spread-ok';
                spreadEl.textContent = `✓ Consensus active (${priceData.exchanges?.length || 0} exchanges)`;
            }
        }

        const exchangeGrid = document.getElementById('exchange-prices');
        if (exchangeGrid) {
            exchangeGrid.innerHTML = '';

            priceData.exchanges?.forEach(ex => {
                const div = document.createElement('div');
                div.className = 'exchange-tile';

                const change24h = ex.change_24h || 0;
                const latency = ex.latency || 0;
                const changeClass = change24h >= 0 ? 'up' : 'down';

                div.innerHTML = `
                    <div class="exchange-name">${ex.exchange}</div>
                    <div class="exchange-price">$${ex.price.toLocaleString()}</div>
                    <div class="exchange-change ${changeClass}">${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%</div>
                    <div class="exchange-latency">${latency}ms</div>
                `;
                exchangeGrid.appendChild(div);
            });
        }

        const headerExchanges = document.getElementById('header-exchanges');
        if (headerExchanges) {
            headerExchanges.textContent = `${priceData.exchanges?.length || 0}/5`;
        }
    }

    updateSignalDisplay(signal) {
        const textEl = document.getElementById('signal-text');
        const confValueEl = document.getElementById('confidence-value');
        const confBarEl = document.getElementById('confidence-bar');

        if (textEl) {
            textEl.textContent = signal.text;

            textEl.className = 'signal-text';
            if (signal.text.includes('LONG')) textEl.classList.add('signal-long');
            else if (signal.text.includes('SHORT')) textEl.classList.add('signal-short');
            else textEl.classList.add('signal-neutral');
        }

        if (confValueEl) confValueEl.textContent = `${Math.round(signal.confidence)}%`;
        if (confBarEl) confBarEl.style.width = `${signal.confidence}%`;
    }

    updateStats(stats) {
        const balanceEl = document.getElementById('balance');
        if (balanceEl) {
            balanceEl.textContent = '$' + parseFloat(stats.balance).toFixed(2);
        }

        const pnl = parseFloat(stats.profitLoss);
        const pnlEl = document.getElementById('balance-change');
        if (pnlEl) {
            pnlEl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${((pnl / stats.initialBalance) * 100).toFixed(2)}%)`;
            pnlEl.className = `balance-change ${pnl >= 0 ? 'positive' : 'negative'}`;
        }

        const winRateEl = document.getElementById('win-rate');
        if (winRateEl) winRateEl.textContent = stats.winRate + '%';

        const totalTradesEl = document.getElementById('total-trades');
        if (totalTradesEl) totalTradesEl.textContent = stats.totalTrades;

        const maxDrawdownEl = document.getElementById('max-drawdown');
        if (maxDrawdownEl) maxDrawdownEl.textContent = stats.maxDrawdown + '%';

        const profitFactorEl = document.getElementById('profit-factor');
        if (profitFactorEl) {
            const pf = stats.totalLoss > 0 ? (stats.totalProfit / stats.totalLoss).toFixed(2) : '0.00';
            profitFactorEl.textContent = pf;
        }

        const cooldownEl = document.getElementById('cooldown');
        const cooldownBar = document.getElementById('cooldown-bar');
        const cooldownSection = document.getElementById('cooldown-section');

        if (cooldownSection && cooldownEl && cooldownBar) {
            if (stats.cooldownActive) {
                cooldownSection.classList.remove('cooldown-ready');
                const remaining = stats.cooldownRemaining;
                cooldownEl.textContent = `${remaining}m ${Math.floor((stats.cooldownRemaining % 1) * 60)}s`;
                cooldownBar.style.width = `${(remaining / 5) * 100}%`;
            } else {
                cooldownSection.classList.add('cooldown-ready');
                cooldownEl.textContent = 'READY TO TRADE';
                cooldownBar.style.width = '100%';
            }
        }
    }

    updatePosition(pos) {
        const titleEl = document.querySelector('.position-title');
        if (titleEl) titleEl.textContent = 'Active Position';

        const sideBadge = document.getElementById('pos-side');
        if (sideBadge) {
            sideBadge.style.display = 'inline-block';
            sideBadge.textContent = pos.side;
            sideBadge.className = `side-badge ${pos.side.toLowerCase()}`;
        }

        const positionPnl = document.getElementById('position-pnl');
        if (positionPnl) positionPnl.style.display = 'block';

        const pnlEl = document.getElementById('pos-pnl');
        if (pnlEl) {
            const pnl = pos.unrealizedPnl;
            pnlEl.textContent = (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2);
            pnlEl.className = `pnl-value ${pnl >= 0 ? 'profit' : 'loss'}`;
        }

        const pnlPercentEl = document.getElementById('pos-pnl-percent');
        if (pnlPercentEl) {
            const pnlPercent = (pos.unrealizedPnl / (pos.entryPrice * pos.quantity / 20)) * 100;
            pnlPercentEl.textContent = (pnlPercent >= 0 ? '+' : '') + pnlPercent.toFixed(2) + '%';
        }

        const positionDetails = document.getElementById('position-details');
        if (positionDetails) positionDetails.style.display = 'grid';

        const posEntry = document.getElementById('pos-entry');
        const posSl = document.getElementById('pos-sl');
        const posTp = document.getElementById('pos-tp');
        const posSize = document.getElementById('pos-size');

        if (posEntry) posEntry.textContent = '$' + pos.entryPrice.toLocaleString();
        if (posSl) posSl.textContent = '$' + pos.stopLoss.toLocaleString();
        if (posTp) posTp.textContent = '$' + pos.takeProfit.toLocaleString();
        if (posSize) posSize.textContent = pos.quantity.toFixed(4) + ' BTC';

        const sourcesEl = document.getElementById('data-sources');
        if (sourcesEl) {
            sourcesEl.innerHTML = '';
            pos.dataSources?.forEach(src => {
                const tag = document.createElement('span');
                tag.className = 'source-tag';
                tag.textContent = src.exchange || src;
                sourcesEl.appendChild(tag);
            });
        }
    }

    clearPosition() {
        const titleEl = document.querySelector('.position-title');
        if (titleEl) titleEl.textContent = 'No Active Position';

        const posSide = document.getElementById('pos-side');
        if (posSide) posSide.style.display = 'none';

        const positionPnl = document.getElementById('position-pnl');
        if (positionPnl) positionPnl.style.display = 'none';

        const positionDetails = document.getElementById('position-details');
        if (positionDetails) positionDetails.style.display = 'none';

        const sourcesEl = document.getElementById('data-sources');
        if (sourcesEl) sourcesEl.innerHTML = '';
    }

    announceTrade(trade) {
        const isProfit = trade.netPnl > 0;

        const phrases = isProfit 
            ? ['Profit secured.', 'Target acquired.', 'Excellent execution.', 'Cashing in!']
            : ['Position closed.', 'Stop loss triggered.', 'Exiting position.'];

        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        const amount = Math.abs(trade.netPnl).toFixed(2);
        const textToSpeech = `${phrase} ${isProfit ? 'Profit' : 'Loss'} of ${amount} dollars.`;

        // Play appropriate sound effect
        if (isProfit) {
            // Victory arpeggio
            setTimeout(() => this.beep(880, 100), 0);
            setTimeout(() => this.beep(1100, 100), 100);
            setTimeout(() => this.beep(1320, 200), 200);
        } else {
            // Sad descending tone
            setTimeout(() => this.beep(440, 150), 0);
            setTimeout(() => this.beep(330, 300), 150);
        }

        this.speak(textToSpeech, true);
    }

    addTradeToHistory(trade) {
        const list = document.getElementById('history-list');
        if (!list) return;

        const item = document.createElement('div');
        item.className = 'history-item';
        item.style.animation = 'fade-in 0.5s ease';

        const isProfit = trade.netPnl > 0;

        item.innerHTML = `
            <div class="history-icon ${isProfit ? 'win' : 'loss'}">
                ${isProfit ? '↑' : '↓'}
            </div>
            <div class="history-details">
                <div class="history-type">${trade.side} ${trade.type}</div>
                <div class="history-reason">${trade.reason}</div>
            </div>
            <div class="history-pnl">
                <div class="history-pnl-value ${isProfit ? 'profit' : 'loss'}">
                    ${isProfit ? '+' : ''}$${trade.netPnl.toFixed(2)}
                </div>
                <div class="history-time">${new Date(trade.time).toLocaleTimeString()}</div>
            </div>
        `;

        list.insertBefore(item, list.firstChild);

        while (list.children.length > 10) {
            if (list.lastChild) list.removeChild(list.lastChild);
        }
    }

    speak(text, isAlert = false) {
        if (!this.audioEnabled) return;

        // Check if speech synthesis is available
        if (!('speechSynthesis' in window)) {
            console.log('Speech synthesis not supported');
            return;
        }

        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);

        // Deep robotic pitch for JARVIS aesthetic
        utterance.rate = 0.9;
        utterance.pitch = isAlert ? 0.3 : 0.6; 
        utterance.volume = 0.8;

        // Try to find a good voice
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            // Prefer a deeper, more robotic voice
            const preferredVoice = voices.find(v => 
                v.name.includes('Google US English') || 
                v.name.includes('Microsoft David') ||
                v.name.includes('Male')
            ) || voices[0];
            utterance.voice = preferredVoice;
        }

        window.speechSynthesis.speak(utterance);
    }

    startPolling() {
        this.fetchStatus();
        this.pollingInterval = setInterval(() => this.fetchStatus(), 10000);
    }

    setupEventListeners() {
        // Keep the global mute toggle just in case
        document.addEventListener('click', () => {
            if (!this.audioCtx) {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
        }, { once: true });
    }

    showError(msg) {
        const el = document.getElementById('error-banner');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => el.style.display = 'none', 5000);
        }
    }
}

// Global functions
function toggleMute() {
    const btn = document.getElementById('mute-toggle');
    const isMuted = btn.textContent.includes('Off');
    btn.textContent = isMuted ? '🔊 Sound On' : '🔇 Sound Off';
    btn.classList.toggle('muted', !isMuted);
    localStorage.setItem('audioEnabled', isMuted);
    if (window.dashboard) window.dashboard.audioEnabled = isMuted;
}

function refreshData() {
    if (window.dashboard) window.dashboard.fetchStatus();
}

// Initialize when voices are loaded (for speech synthesis)
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
        // Voices loaded
    };
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new NexusOmegaDashboard();
});
