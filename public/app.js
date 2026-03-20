// ═══════════════════════════════════════════════════════════════
// NEXUS OMEGA v4.1 - JARVIS Interface Controller
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
        // Create an immersive "Click to Start" overlay to unlock browser audio permissions natively!
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0'; overlay.style.left = '0';
        overlay.style.width = '100vw'; overlay.style.height = '100vh';
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
            <div style="padding: 30px; border: 2px solid #00ffcc; box-shadow: 0 0 20px rgba(0,255,204,0.2); background: rgba(0, 255, 204, 0.05); text-align: center;">
                <div style="font-size: 14px; margin-bottom: 10px; opacity: 0.7;">CONNECTION ESTABLISHED</div>
                <div>[ INITIATE SYSTEM STARTUP ]</div>
            </div>
        `;
        
        document.body.appendChild(overlay);

        overlay.addEventListener('click', () => {
            // Wake up the Audio Context the exact second the user clicks!
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            
            overlay.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(overlay);
                this.playBootSequence();
            }, 500);
        });
    }

    playBootSequence() {
        // Play the dramatic intro!
        this.speak("Loading... I am an A. I. trading bot. Let's make some money!");

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

        bootTexts.forEach(step => {
            setTimeout(() => {
                document.getElementById('boot-text').textContent = step.text;
                document.getElementById('boot-subtext').textContent = step.sub;
                
                // Play a dynamic beep frequency for each line of the boot!
                if (step.text === 'SYSTEM READY') {
                    this.beep(1200, 300); // Triumphant high beep
                } else {
                    this.beep(800 + Math.random() * 200, 60); // Random retro computer tick
                }
                
                if (step.text === 'SYSTEM READY') {
                    setTimeout(() => {
                        document.getElementById('boot-sequence').style.opacity = '0';
                        setTimeout(() => {
                            document.getElementById('boot-sequence').style.display = 'none';
                            this.showDashboard();
                            this.startPolling();
                        }, 500);
                    }, 500);
                }
            }, step.delay);
        });
    }

    showDashboard() {
        document.getElementById('dashboard').style.display = 'block';
    }

    startUptimeCounter() {
        setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
            const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');
            document.getElementById('header-uptime').textContent = `${hours}:${minutes}:${seconds}`;
            
            const now = new Date();
            document.getElementById('timestamp').textContent = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        }, 1000);
    }

    async fetchStatus() {
        const start = Date.now();
        try {
            const response = await fetch('/api/status');
            const data = await response.json();
            
            document.getElementById('header-latency').textContent = `${Date.now() - start}ms`;
            document.getElementById('footer-latency').textContent = `Latency: ${Date.now() - start}ms`;
            
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
        const oldPrice = parseFloat(mainPrice.dataset.price || 0);
        const newPrice = priceData.consensus;
        
        mainPrice.textContent = newPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        mainPrice.dataset.price = newPrice;
        
        if (oldPrice !== 0 && oldPrice !== newPrice) {
            const direction = newPrice > oldPrice ? 'up' : 'down';
            mainPrice.classList.remove('up', 'down');
            void mainPrice.offsetWidth; 
            mainPrice.classList.add(direction);
        }

        const spreadEl = document.getElementById('spread-indicator');
        if (priceData.spread > 0.3) {
            spreadEl.className = 'spread-warning';
            spreadEl.textContent = `⚠️ High spread: ${priceData.spread.toFixed(2)}%`;
        } else {
            spreadEl.className = 'spread-ok';
            spreadEl.textContent = `✓ Consensus active (${priceData.exchanges?.length || 0} exchanges)`;
        }

        const exchangeGrid = document.getElementById('exchange-prices');
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

        document.getElementById('header-exchanges').textContent = `${priceData.exchanges?.length || 0}/5`;
    }

    updateSignalDisplay(signal) {
        const textEl = document.getElementById('signal-text');
        const confValueEl = document.getElementById('confidence-value');
        const confBarEl = document.getElementById('confidence-bar');
        
        textEl.textContent = signal.text;
        
        textEl.className = 'signal-text';
        if (signal.text.includes('LONG')) textEl.classList.add('signal-long');
        else if (signal.text.includes('SHORT')) textEl.classList.add('signal-short');
        else textEl.classList.add('signal-neutral');
        
        const conf = Math.round(signal.confidence);
        confValueEl.textContent = `${conf}%`;
        confBarEl.style.width = `${conf}%`;
    }

    updateStats(stats) {
        document.getElementById('balance').textContent = '$' + parseFloat(stats.balance).toFixed(2);
        
        const pnl = parseFloat(stats.profitLoss);
        const pnlEl = document.getElementById('balance-change');
        pnlEl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${((pnl / stats.initialBalance) * 100).toFixed(2)}%)`;
        pnlEl.className = `balance-change ${pnl >= 0 ? 'positive' : 'negative'}`;

        document.getElementById('win-rate').textContent = stats.winRate + '%';
        document.getElementById('total-trades').textContent = stats.totalTrades;
        document.getElementById('max-drawdown').textContent = stats.maxDrawdown + '%';
        
        const pf = stats.totalLoss > 0 ? (stats.totalProfit / stats.totalLoss).toFixed(2) : '0.00';
        document.getElementById('profit-factor').textContent = pf;

        const cooldownEl = document.getElementById('cooldown');
        const cooldownBar = document.getElementById('cooldown-bar');
        const cooldownSection = document.getElementById('cooldown-section');
        
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

    updatePosition(pos) {
        document.querySelector('.position-title').textContent = 'Active Position';
        
        const sideBadge = document.getElementById('pos-side');
        sideBadge.style.display = 'inline-block';
        sideBadge.textContent = pos.side;
        sideBadge.className = `side-badge ${pos.side.toLowerCase()}`;

        document.getElementById('position-pnl').style.display = 'block';
        const pnlEl = document.getElementById('pos-pnl');
        const pnl = pos.unrealizedPnl;
        pnlEl.textContent = (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2);
        pnlEl.className = `pnl-value ${pnl >= 0 ? 'profit' : 'loss'}`;
        
        const pnlPercent = (pnl / (pos.entryPrice * pos.quantity / 20)) * 100;
        document.getElementById('pos-pnl-percent').textContent = (pnlPercent >= 0 ? '+' : '') + pnlPercent.toFixed(2) + '%';

        document.getElementById('position-details').style.display = 'grid';
        document.getElementById('pos-entry').textContent = '$' + pos.entryPrice.toLocaleString();
        document.getElementById('pos-sl').textContent = '$' + pos.stopLoss.toLocaleString();
        document.getElementById('pos-tp').textContent = '$' + pos.takeProfit.toLocaleString();
        document.getElementById('pos-size').textContent = pos.quantity.toFixed(4) + ' BTC';

        const sourcesEl = document.getElementById('data-sources');
        sourcesEl.innerHTML = '';
        pos.dataSources?.forEach(src => {
            const tag = document.createElement('span');
            tag.className = 'source-tag';
            tag.textContent = src.exchange;
            sourcesEl.appendChild(tag);
        });
    }

    clearPosition() {
        document.querySelector('.position-title').textContent = 'No Active Position';
        document.getElementById('pos-side').style.display = 'none';
        document.getElementById('position-pnl').style.display = 'none';
        document.getElementById('position-details').style.display = 'none';
        document.getElementById('data-sources').innerHTML = '';
    }

    announceTrade(trade) {
        const isProfit = trade.netPnl > 0;
        
        const phrases = isProfit 
            ? ['Profit secured.', 'Target acquired.', 'Excellent execution.', 'Cashing in!']
            : ['Position closed.', 'Stop loss triggered.', 'Exiting position.'];
        
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        const amount = Math.abs(trade.netPnl).toFixed(2);
        const textToSpeech = `${phrase} ${isProfit ? 'Profit' : 'Loss'} of ${amount} dollars.`;
        
        this.speak(textToSpeech, true);
    }

    addTradeToHistory(trade) {
        const list = document.getElementById('history-list');
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
        
        while (list.children.length > 10) list.removeChild(list.lastChild);
    }

    speak(text, isAlert = false) {
        if (!this.audioEnabled) return;
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Deep robotic pitch for JARVIS aesthetic
        utterance.rate = 0.9;
        utterance.pitch = isAlert ? 0.3 : 0.6; 
        
        // Use a robotic-sounding system voice
        const voices = speechSynthesis.getVoices();
        if (voices.length > 0) {
            const roboticVoice = voices.find(v => v.name.includes('Google') || v.name.includes('Microsoft Desktop')) || voices[0];
            utterance.voice = roboticVoice;
        }

        speechSynthesis.speak(utterance);
    }

    startPolling() {
        this.fetchStatus();
        this.pollingInterval = setInterval(() => this.fetchStatus(), 10000);
    }

    setupEventListeners() {
        // Keep the global mute toggle just in case
        document.addEventListener('click', () => {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }, { once: true });
    }

    showError(msg) {
        const el = document.getElementById('error-banner');
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(() => el.style.display = 'none', 5000);
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new NexusOmegaDashboard();
});
