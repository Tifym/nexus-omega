// NEXUS OMEGA v4.1 - JARVIS Interface Controller

class NexusOmegaDashboard {
      constructor() {
                this.apiUrl = "";
                this.pollingInterval = null;
                this.audioEnabled = localStorage.getItem("audioEnabled") !== "false";
                this.lastSignal = null;
                this.lastTradeTime = null;
                this.startTime = Date.now();
                this.circuitLines = [];
                this.init();
      }

    init() {
              this.generateCircuitLines();
              this.checkBootSequence();
              this.setupEventListeners();
              this.startUptimeCounter();
    }

    generateCircuitLines() {
              const container = document.getElementById("circuit-bg");
              if (!container) return;
              for (let i = 0; i < 5; i++) {
                            const line = document.createElement("div");
                            line.className = "circuit-line";
                            line.style.top = (Math.random() * 100) + "%";
                            line.style.width = (Math.random() * 200 + 100) + "px";
                            line.style.animationDelay = (Math.random() * 5) + "s";
                            line.style.animationDuration = (Math.random() * 10 + 15) + "s";
                            container.appendChild(line);
              }
    }

    checkBootSequence() {
              if (sessionStorage.getItem("nexus_booted")) {
                            this.showDashboard();
                            this.startPolling();
                            return;
              }
              this.playBootSequence();
    }

    playBootSequence() {
              const bootTexts = [
                { text: "INITIALIZING NEXUS OMEGA...", sub: "Loading core systems", delay: 0 },
                { text: "CONNECTING TO BINANCE...", sub: "WebSocket handshake", delay: 600 },
                { text: "CONNECTING TO COINBASE...", sub: "REST API established", delay: 1000 },
                { text: "CONNECTING TO BYBIT...", sub: "Market data feed active", delay: 1400 },
                { text: "CONNECTING TO OKX...", sub: "Price stream connected", delay: 1800 },
                { text: "CONNECTING TO KRAKEN...", sub: "Aggregating data sources", delay: 2200 },
                { text: "CALIBRATING CONSENSUS...", sub: "Multi-exchange sync", delay: 2600 },
                { text: "NEURAL NETWORKS ONLINE...", sub: "Signal engine ready", delay: 3000 },
                { text: "SYSTEM READY", sub: "All systems operational", delay: 3600 }
                        ];
              if (this.audioEnabled) {
                            this.playSound("startup").catch(() => {});
              }
              bootTexts.forEach(step => {
                            setTimeout(() => {
                                              const bt = document.getElementById("boot-text");
                                              const bs = document.getElementById("boot-subtext");
                                              if (bt) bt.textContent = step.text;
                                              if (bs) bs.textContent = step.sub;
                                              if (step.text === "SYSTEM READY") {
                                                                    setTimeout(() => {
                                                                                              const seq = document.getElementById("boot-sequence");
                                                                                              if (seq) {
                                                                                                                            seq.style.opacity = "0";
                                                                                                                            setTimeout(() => {
                                                                                                                                                              seq.style.display = "none";
                                                                                                                                                              sessionStorage.setItem("nexus_booted", "true");
                                                                                                                                                              this.showDashboard();
                                                                                                                                                              this.startPolling();
                                                                                                                              }, 500);
                                                                                                }
                                                                    }, 500);
                                              }
                            }, step.delay);
              });
    }

    showDashboard() {
              const d = document.getElementById("dashboard");
              if (d) d.style.display = "block";
              this.speak("System online. All exchanges connected.");
    }

    startUptimeCounter() {
              setInterval(() => {
                            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
                            const h = Math.floor(elapsed / 3600).toString().padStart(2, "0");
                            const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, "0");
                            const s = (elapsed % 60).toString().padStart(2, "0");
                            const uEl = document.getElementById("header-uptime");
                            if (uEl) uEl.textContent = h + ":" + m + ":" + s;
              }, 1000);
    }

    async fetchStatus() {
              const start = Date.now();
              try {
                            const resp = await fetch("/api/status");
                            const data = await resp.json();
                            const l1 = document.getElementById("header-latency");
                            const l2 = document.getElementById("footer-latency");
                            if (l1) l1.textContent = (Date.now() - start) + "ms";
                            if (l2) l2.textContent = "Latency: " + (Date.now() - start) + "ms";
                            this.updateDashboard(data);
              } catch (error) {
                            this.showError("Connection lost - retrying...");
                            console.error("Status fetch failed:", error);
              }
    }

    updateDashboard(data) {
              if (data.price) this.updatePriceDisplay(data.price);
              if (data.stats) this.updateStats(data.stats);
              if (data.position) this.updatePosition(data.position);
              else this.clearPosition();
              if (data.lastTrade && data.lastTrade.time !== this.lastTradeTime) {
                            this.lastTradeTime = data.lastTrade.time;
                            this.announceTrade(data.lastTrade);
                            this.addTradeToHistory(data.lastTrade);
              }
    }

    updatePriceDisplay(priceData) {
              const mP = document.getElementById("main-price");
              if (!mP) return;
              const old = parseFloat(mP.dataset.price || 0);
              const nw = priceData.consensus;
              mP.textContent = nw.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              mP.dataset.price = nw;
              if (old !== 0 && old !== nw) {
                            const dir = nw > old ? "up" : "down";
                            mP.classList.remove("up", "down");
                            void mP.offsetWidth;
                            mP.classList.add(dir);
              }
              const sEl = document.getElementById("spread-indicator");
              if (sEl) {
                            if (priceData.spread > 0.3) {
                                              sEl.className = "spread-warning";
                                              sEl.textContent = "High spread: " + priceData.spread.toFixed(2) + "%";
                            } else {
                                              sEl.className = "spread-ok";
                                              sEl.textContent = "Consensus active (" + (priceData.exchanges?.length || 0) + " exchanges)";
                            }
              }
              const hEx = document.getElementById("header-exchanges");
              if (hEx) hEx.textContent = (priceData.exchanges?.length || 0) + "/5";
    }

    updateStats(stats) {
              const b = document.getElementById("balance");
              if (b) b.textContent = "$" + parseFloat(stats.balance).toFixed(2);
              const pnl = parseFloat(stats.profitLoss);
              const pnlEl = document.getElementById("balance-change");
              if (pnlEl) {
                            pnlEl.textContent = (pnl >= 0 ? "+" : "") + "$" + pnl.toFixed(2) + " (" + ((pnl / stats.initialBalance) * 100).toFixed(2) + "%)";
                            pnlEl.className = "balance-change " + (pnl >= 0 ? "positive" : "negative");
              }
              const wr = document.getElementById("win-rate");
              if (wr) wr.textContent = stats.winRate + "%";
              const tt = document.getElementById("total-trades");
              if (tt) tt.textContent = stats.totalTrades;
              const pf = document.getElementById("profit-factor");
              if (pf) pf.textContent = stats.totalLoss > 0 ? (stats.totalProfit / stats.totalLoss).toFixed(2) : "0.00";
    }

    updatePosition(pos) {
              const sb = document.getElementById("pos-side");
              if (sb) {
                            sb.style.display = "inline-block";
                            sb.textContent = pos.side;
                            sb.className = "side-badge " + pos.side.toLowerCase();
              }
              const pvl = document.getElementById("pos-pnl");
              if (pvl) {
                            pvl.textContent = (pos.unrealizedPnl >= 0 ? "+" : "") + "$" + Math.abs(pos.unrealizedPnl).toFixed(2);
                            pvl.className = "pnl-value " + (pos.unrealizedPnl >= 0 ? "profit" : "loss");
              }
              const pe = document.getElementById("pos-entry");
              if (pe) pe.textContent = "$" + pos.entryPrice.toLocaleString();
    }

    clearPosition() {
              const sb = document.getElementById("pos-side");
              if (sb) sb.style.display = "none";
    }

    announceTrade(trade) {
              const isProfit = trade.netPnl > 0;
              this.speak("Trade closed. " + (isProfit ? "Profit" : "Loss") + " of " + Math.abs(trade.netPnl).toFixed(2) + " dollars.");
    }

    addTradeToHistory(trade) {
              const list = document.getElementById("history-list");
              if (!list) return;
              const item = document.createElement("div");
              item.className = "history-item";
              item.innerHTML = "<div>" + trade.side + " " + trade.type + "</div><div>" + (trade.netPnl > 0 ? "+" : "") + "$" + trade.netPnl.toFixed(2) + "</div>";
              list.insertBefore(item, list.firstChild);
              while (list.children.length > 10) list.removeChild(list.lastChild);
    }

    speak(text) {
              if (!this.audioEnabled) return;
              const u = new SpeechSynthesisUtterance(text);
              u.rate = 0.9;
              speechSynthesis.speak(u);
    }

    startPolling() {
              this.fetchStatus();
              this.pollingInterval = setInterval(() => this.fetchStatus(), 10000);
    }

    setupEventListeners() {
              document.addEventListener("click", () => {
                            if (typeof AudioContext !== "undefined" && !this.audioContext) this.audioContext = new AudioContext();
              }, { once: true });
    }

    showError(msg) {
              const el = document.getElementById("error-banner");
              if (el) {
                            el.textContent = msg;
                            el.style.display = "block";
                            setTimeout(() => el.style.display = "none", 5000);
              }
    }
}

document.addEventListener("DOMContentLoaded", () => {
      window.dashboard = new NexusOmegaDashboard();
});
        if (sb) sb.style.display = "none";
}

    announceTrade(trade) {
        const isProfit = trade.netPnl > 0;
              this.speak("Trade closed. " + (isProfit ? "Profit" : "Loss") + " of " + Math.abs(trade.netPnl).toFixed(2) + " dollars.");
    }

    addTradeToHistory(trade) {
        const list = document.getElementById("history-list");
              if (!list) return;
              const item = document.createElement("div");
              item.className = "history-item";
              item.innerHTML = "<div>" + trade.side + " " + trade.type + "</div><div>" + (trade.netPnl > 0 ? "+" : "") + "$" + trade.netPnl.toFixed(2) + "</div>";
              list.insertBefore(item, list.firstChild);
              while (list.children.length > 10) list.removeChild(list.lastChild);
    }

    speak(text) {
        if (!this.audioEnabled) return;
              const u = new SpeechSynthesisUtterance(text);
              u.rate = 0.9;
              speechSynthesis.speak(u);
    }

    startPolling() {
        this.fetchStatus();
              this.pollingInterval = setInterval(() => this.fetchStatus(), 10000);
    }

    setupEventListeners() {
        document.addEventListener("click", () => {
                      if (typeof AudioContext !== "undefined" && !this.audioContext) this.audioContext = new AudioContext();
        }, { once: true });
    }

    showError(msg) {
        const el = document.getElementById("error-banner");
              if (el) {
                            el.textContent = msg;
                            el.style.display = "block";
                            setTimeout(() => el.style.display = "none", 5000);
              }
    }
}

document.addEventListener("DOMContentLoaded", () => {
      window.dashboard = new NexusOmegaDashboard();
});
