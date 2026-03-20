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
            positionId: null, // tracked via hasOpenPosition diff
            balance: null
        };

        this.checkBootSequence();
    }

    checkBootSequence() {
        // Create an immersive "Click to Start" overlay to unlock browser audio natively!
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = '#000000';
        overlay.style.zIndex = '99999999';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.fontFamily = '"JetBrains Mono", monospace';
        overlay.style.transition = 'opacity 1.5s ease';

        const button = document.createElement('button');
        button.innerText = '[ INITIATE SYSTEM STARTUP ]';
        button.style.padding = '20px 40px';
        button.style.backgroundColor = 'transparent';
        button.style.color = '#00d4ff';
        button.style.border = '2px solid #00d4ff';
        button.style.fontSize = '24px';
        button.style.cursor = 'pointer';
        button.style.marginTop = '20px';
        button.style.letterSpacing = '2px';
        button.style.boxShadow = '0 0 20px rgba(0, 212, 255, 0.3)';

        button.onmouseover = () => {
            button.style.backgroundColor = '#00d4ff';
            button.style.color = '#000';
        };
        button.onmouseout = () => {
            button.style.backgroundColor = 'transparent';
            button.style.color = '#00d4ff';
        };

        overlay.appendChild(button);
        document.body.appendChild(overlay);

        button.addEventListener('click', async () => {
            button.style.opacity = '0';
            this.initAudio();

            const bootLines = [
                "Establishing secure uplink...",
                "Bypassing node security...",
                "Syncing neural trading engine...",
                "Loading... I am an AI Trading bot. Let's make some money!"
            ];

            let yOffset = 40;
            for (let i = 0; i < bootLines.length; i++) {
                await new Promise(r => setTimeout(r, 600));
                this.playBeep(800 + (i * 100), 100, 'square');
                
                const line = document.createElement('div');
                line.style.color = '#00d084';
                line.style.fontSize = '16px';
                line.style.marginTop = '10px';
                line.style.textShadow = '0 0 10px #00d084';
                line.innerText = '> ' + bootLines[i];
                overlay.appendChild(line);

                if (i === bootLines.length - 1) {
                    this.speak(bootLines[i]);
                }
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

    initAudio() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    playBeep(frequency = 800, duration = 200, type = 'sine') {
        if (!this.soundEnabled || !this.audioContext) return;
        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            oscillator.frequency.value = frequency;
            oscillator.type = type;
            gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration / 1000);
            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + duration / 1000);
        } catch (e) {
            console.error('Beep failed:', e);
        }
    }

    speak(text) {
        if (!this.soundEnabled || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.2;
        utterance.volume = 0.8;
        
        let voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            const voice = voices.find(v => v.name.includes('Google UK English Female') || v.name.includes('Samantha') || v.name.includes('Siri'));
            if (voice) utterance.voice = voice;
        }
        window.speechSynthesis.speak(utterance);
    }

    playTradeOpen() {
        this.playBeep(600, 300, 'sine');
        setTimeout(() => this.playBeep(800, 200, 'sine'), 100);
        this.speak("Live trade intercepted. Executing position.");
    }
    
    playTradeClose(isProfit) {
        if (isProfit) {
            this.playBeep(1000, 150, 'sine');
            setTimeout(() => this.playBeep(1200, 150, 'sine'), 100);
            setTimeout(() => this.playBeep(1500, 200, 'sine'), 200);
            this.speak("Trade closed. Taking profit.");
        } else {
            this.playBeep(400, 300, 'sawtooth');
            setTimeout(() => this.playBeep(300, 400, 'sawtooth'), 150);
            this.speak("Trade closed at a loss.");
        }
    }

    startPolling() {
        this.fetchData();
        this.pollingInterval = setInterval(() => this.fetchData(), 2000);
        setInterval(() => this.updateClock(), 1000);
    }

    updateClock() {
        const el = document.getElementById('clock');
        if (el) {
            el.innerText = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
    }

    formatPrice(price) {
        if (!price || isNaN(price)) return '0.00';
        return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    async fetchData() {
        try {
            const response = await fetch(`${this.apiUrl}/api/status`);
            const data = await response.json();
            
            if (data.error) {
                console.error("API Error:", data.error);
                return;
            }
            this.updateDashboard(data);
        } catch (error) {
            console.error("Fetch failed:", error);
        }
    }

    updateDashboard(data) {
        if (!data || !data.signal) return;

        // 1. Header & Market
        document.getElementById('header-price').textContent = '$' + this.formatPrice(data.price.consensus);
        document.getElementById('header-spread').textContent = data.price.spread.toFixed(3) + '% Spread';
        document.getElementById('header-exchanges').textContent = data.price.exchanges.length + ' LIVE EXCH';
        
        let fearGreed = data.signal.fearGreed || 50;
        let fearClass = (fearGreed < 25) ? 'Extreme Fear' : (fearGreed > 75) ? 'Extreme Greed' : 'Neutral';
        document.getElementById('header-fear-val').textContent = fearGreed;
        document.getElementById('header-fear-class').textContent = fearClass;
        
        const fCol = fearGreed < 25 ? 'var(--accent-red)' : fearGreed > 75 ? 'var(--accent-green)' : 'var(--text-secondary)';
        document.getElementById('header-fear-val').style.color = fCol;
        document.getElementById('header-fear-class').style.color = fCol;

        // 2. Portfolio Stats
        document.getElementById('balance-val').textContent = '$' + this.formatPrice(data.stats.balance);
        document.getElementById('initial-balance').textContent = '$' + this.formatPrice(data.stats.initialBalance);
        
        const totalReturn = ((data.stats.balance - data.stats.initialBalance) / data.stats.initialBalance) * 100;
        const changeBadge = document.getElementById('balance-change-badge');
        changeBadge.textContent = (totalReturn >= 0 ? '+' : '') + totalReturn.toFixed(2) + '%';
        changeBadge.style.color = totalReturn >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

        document.getElementById('stat-winrate').textContent = data.stats.winRate + '%';
        document.getElementById('stat-trades').textContent = data.stats.totalTrades;
        document.getElementById('stat-drawdown').textContent = data.stats.maxDrawdown.toFixed(2) + '%';
        
        // 3. Signal Panel (EXECUTION BAR)
        const sMain = document.getElementById('signal-main-box');
        sMain.className = 'signal-main glass-strong ' + (data.signal.text.toLowerCase().replace('_','-'));
        
        const badge = document.getElementById('signal-badge');
        badge.textContent = data.signal.text.replace('_', ' ');

        const confScore = Math.max(0, data.signal.confidence);
        const fillBar = document.getElementById('exec-fill-bar');
        const execLabel = document.getElementById('exec-val');
        
        // Execution triggers at 65% visually
        fillBar.style.width = Math.min(100, (confScore / 100) * 100) + '%';
        execLabel.textContent = confScore + '% / 65%';
        if (confScore >= 65 && data.signal.text !== 'NEUTRAL') {
            fillBar.style.background = 'linear-gradient(90deg, #00d084 0%, #00d4ff 100%)';
            execLabel.style.color = 'var(--accent-green)';
        } else {
            fillBar.style.background = 'linear-gradient(90deg, #f0b90b 0%, #f97316 100%)';
            execLabel.style.color = 'var(--accent-yellow)';
        }

        document.getElementById('current-price').textContent = '$' + this.formatPrice(data.price.consensus);
        
        // Indicators
        document.getElementById('metric-score').textContent = (data.signal.score > 0 ? '+' : '') + data.signal.score;
        document.getElementById('metric-score').className = 'metric-value ' + (data.signal.score > 0 ? 'profit' : data.signal.score < 0 ? 'loss' : '');
        
        if (data.signal.indicators) {
            document.getElementById('metric-rsi').textContent = data.signal.indicators.rsi;
            document.getElementById('metric-atr').textContent = data.signal.indicators.atr;
            document.getElementById('metric-vol').textContent = data.signal.indicators.volatility + '%';
        }

        const rList = document.getElementById('reasons-list');
        rList.innerHTML = '';
        if (data.signal.reasons && data.signal.reasons.length > 0) {
            data.signal.reasons.forEach(r => {
                const tag = document.createElement('span');
                tag.className = 'reason-tag';
                tag.textContent = typeof r === 'string' ? r : r.type;
                rList.appendChild(tag);
            });
        }

        // Active Trade Levels Check
        const lvls = document.getElementById('trade-levels-container');
        if (data.signal.text !== 'NEUTRAL' && data.signal.stopLoss) {
            lvls.style.display = 'grid';
            document.getElementById('level-sl').textContent = '$' + this.formatPrice(data.signal.stopLoss);
            document.getElementById('level-tp').textContent = '$' + this.formatPrice(data.signal.takeProfit);
        } else {
            lvls.style.display = 'none';
        }

        // 4. Active Positions & Proximity Bars
        const posCont = document.getElementById('active-positions-container');
        if (data.position) {
            const p = data.position;
            const currentPrice = data.price.consensus;
            
            const distSL = Math.abs(currentPrice - p.stopLoss);
            const distTP = Math.abs(p.takeProfit - currentPrice);
            
            let html = \`<div class="position-card \${p.side.toLowerCase()} glass-hover">
                <div class="pos-header">
                    <div class="pos-pair"><span class="pos-symbol">BTC/USDT</span><span class="pos-leverage">20x</span></div>
                    <div class="pos-pnl \${p.unrealizedPnl >= 0 ? 'profit' : 'loss'}">\${p.unrealizedPnl >= 0 ? '+' : ''}$\${this.formatPrice(p.unrealizedPnl)}</div>
                </div>
                <div class="pos-details-grid">
                    <div class="pos-detail"><span class="detail-label">Side</span><span class="detail-value side-\${p.side.toLowerCase()}">\${p.side}</span></div>
                    <div class="pos-detail"><span class="detail-label">Entry Price</span><span class="detail-value">$\${this.formatPrice(p.entryPrice)}</span></div>
                </div>
                <div class="position-prox-bars">
                    <div class="prox-container">
                        <div class="prox-label"><span>Stop Loss (\${distSL > distTP ? 'Safe' : 'Danger'})</span><span class="loss">$\${this.formatPrice(p.stopLoss)}</span></div>
                        <div class="prox-bg"><div class="prox-fill stop-loss" style="width: \${Math.min(100, Math.max(5, (1 - (distSL/(distSL+distTP))) * 100))}%;"></div></div>
                    </div>
                    <div class="prox-container">
                        <div class="prox-label"><span>Take Profit (\${distTP < distSL ? 'Close' : 'Far'})</span><span class="profit">$\${this.formatPrice(p.takeProfit)}</span></div>
                        <div class="prox-bg"><div class="prox-fill take-profit" style="width: \${Math.min(100, Math.max(5, (1 - (distTP/(distSL+distTP))) * 100))}%;"></div></div>
                    </div>
                </div>
            </div>\`;
            posCont.innerHTML = html;
            document.getElementById('unrealized-pnl-summary').textContent = (p.unrealizedPnl >= 0 ? '+' : '') + '$' + this.formatPrice(p.unrealizedPnl);
        } else {
            posCont.innerHTML = \`<div class="empty-state"><div class="empty-icon">📈</div><div class="empty-text">No Active Positions</div><div class="empty-sub">Waiting for signal...</div></div>\`;
            document.getElementById('unrealized-pnl-summary').textContent = '$0.00';
        }

        // 5. System Audio State Tracking
        if (data.signal.text !== this.lastState.signalText) {
            if (data.signal.text !== 'NEUTRAL' && this.lastState.signalText !== null) {
                this.playBeep(900, 100, 'sine');
            }
            this.lastState.signalText = data.signal.text;
        }

        const currentlyOpen = data.stats.hasOpenPosition;
        if (currentlyOpen && !this.lastState.positionId && this.lastState.positionId !== null) {
            this.playTradeOpen();
        } else if (!currentlyOpen && this.lastState.positionId && data.lastTrade) {
            this.playTradeClose(data.lastTrade.netPnl > 0);
        }
        if (this.lastState.positionId === null) {
            // First load, don't play sounds
        }
        this.lastState.positionId = currentlyOpen;

        document.getElementById('signal-timestamp').textContent = new Date(data.price.timestamp || Date.now()).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new NexusOmegaDashboard();
});
