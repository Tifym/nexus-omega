export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NEXUS OMEGA v4.0 - AI Trading Engine</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <div class="app">
        <header class="header">
            <div class="brand">
                <div class="logo">⚡ NEXUS OMEGA</div>
                <span class="version">v4.0</span>
            </div>
            <div class="market-ticker">
                <div class="ticker-item">
                    <span class="ticker-label">BTC/USDT Target</span>
                    <span class="ticker-value" id="header-price">Loading...</span>
                    <span class="ticker-change" id="header-spread">0.00% Spread</span>
                </div>
                <div class="ticker-item">
                    <span class="ticker-label">Fear & Greed</span>
                    <span class="ticker-value" id="header-fear-val">--</span>
                    <span class="ticker-change" id="header-fear-class">--</span>
                </div>
            </div>
        </header>

        <main class="main-content">
            <div class="grid-layout">
                <!-- Left Panel: Portfolio -->
                <aside class="panel portfolio-panel glass">
                    <div class="panel-header">
                        <h2>Portfolio</h2>
                        <div class="header-badges">
                            <span class="badge live">LIVE</span>
                            <span class="badge session" id="header-exchanges">0 EXCHANGES</span>
                        </div>
                    </div>
                    
                    <div class="balance-section">
                        <div class="balance-header">
                            <div class="balance-label">Total Balance</div>
                            <div class="balance-change-badge" id="balance-change-badge">+0.00%</div>
                        </div>
                        <div class="balance-value" id="balance-val">$0.00</div>
                        <div class="balance-sub">
                            <span>Initial: <span id="initial-balance">$0.00</span></span>
                            <span class="separator">•</span>
                            <span>Unrealized: <span id="unrealized-pnl-summary">$0.00</span></span>
                        </div>
                    </div>

                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-icon">📊</div>
                            <div class="stat-info">
                                <div class="stat-label">Win Rate</div>
                                <div class="stat-value" id="stat-winrate">0%</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon">🎯</div>
                            <div class="stat-info">
                                <div class="stat-label">Total Trades</div>
                                <div class="stat-value" id="stat-trades">0</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon">📉</div>
                            <div class="stat-info">
                                <div class="stat-label">Max DD</div>
                                <div class="stat-value loss" id="stat-drawdown">0%</div>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon">⚡</div>
                            <div class="stat-info">
                                <div class="stat-label">Profit Factor</div>
                                <div class="stat-value" id="stat-profit-factor">0.00</div>
                            </div>
                        </div>
                    </div>

                    <div class="positions-section">
                        <h3>Active Positions</h3>
                        <div id="active-positions-container">
                            <!-- Populated by JS -->
                            <div class="empty-state">
                                <div class="empty-icon">📈</div>
                                <div class="empty-text">No Active Positions</div>
                                <div class="empty-sub">Waiting for signal...</div>
                            </div>
                        </div>
                    </div>
                </aside>

                <!-- Center Panel: Signal -->
                <section class="panel signal-panel glass">
                    <div class="signal-container">
                        <div class="signal-header">
                            <div class="signal-pair">
                                <span class="pair-icon">₿</span>
                                <span>BTC/USDT</span>
                            </div>
                            <div class="signal-time">
                                <span class="time-icon">●</span>
                                <span id="signal-timestamp">00:00:00</span>
                            </div>
                        </div>

                        <div class="signal-main neutral" id="signal-main-box">
                            <div class="signal-glow"></div>
                            <div class="signal-badge" id="signal-badge">INITIALIZING...</div>
                            
                            <div class="exec-container">
                                <div class="exec-header">
                                    <span class="exec-label">Execution Load</span>
                                    <span class="exec-val" id="exec-val">0% / 65%</span>
                                </div>
                                <div class="exec-bar">
                                    <div class="exec-fill" id="exec-fill-bar" style="width: 0%"></div>
                                    <div class="exec-threshold-marker"></div>
                                </div>
                            </div>
                        </div>

                        <div class="price-card glass">
                            <div class="price-header">
                                <span class="price-label">Consensus Price</span>
                                <span class="price-change profit" id="price-change-pill">LIVE</span>
                            </div>
                            <div class="current-price" id="current-price">$0.00</div>
                        </div>

                        <div class="metrics-grid">
                            <div class="metric-card glass-hover">
                                <div class="metric-icon">🎯</div>
                                <div class="metric-label">Score</div>
                                <div class="metric-value" id="metric-score">0</div>
                            </div>
                            <div class="metric-card glass-hover">
                                <div class="metric-icon">📊</div>
                                <div class="metric-label">RSI</div>
                                <div class="metric-value" id="metric-rsi">--</div>
                            </div>
                            <div class="metric-card glass-hover">
                                <div class="metric-icon">📈</div>
                                <div class="metric-label">ATR</div>
                                <div class="metric-value" id="metric-atr">--</div>
                            </div>
                            <div class="metric-card glass-hover">
                                <div class="metric-icon">⚠️</div>
                                <div class="metric-label">Volatility</div>
                                <div class="metric-value" id="metric-vol">--%</div>
                            </div>
                        </div>

                        <div class="reasons-section">
                            <div class="reasons-label">Signal Analysis</div>
                            <div class="reasons-list" id="reasons-list">
                                <span class="reason-tag">Initializing Neural Engine...</span>
                            </div>
                        </div>

                        <div class="trade-levels" id="trade-levels-container" style="display:none;">
                            <div class="level-box stop glass-hover">
                                <div class="level-icon">🛑</div>
                                <div class="level-label">Dynamic Stop Loss</div>
                                <div class="level-price" id="level-sl">$0.00</div>
                            </div>
                            <div class="level-box target glass-hover">
                                <div class="level-icon">🎯</div>
                                <div class="level-label">Dynamic Take Profit</div>
                                <div class="level-price" id="level-tp">$0.00</div>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Right Panel: History -->
                <aside class="panel history-panel glass">
                    <div class="panel-header">
                        <h2>Trade History</h2>
                        <span class="trade-count" id="history-count">0 trades</span>
                    </div>
                    
                    <div class="history-list" id="history-list-container">
                        <!-- Populated by JS -->
                    </div>
                </aside>
            </div>
        </main>

        <footer class="footer glass">
            <div class="footer-left">
                <span class="data-source">📡 Multi-Exchange Consensus</span>
                <span class="latency" id="footer-latency">⚡ 0ms</span>
            </div>
            <div class="footer-right" id="clock">00:00:00</div>
        </footer>
    </div>

    <!-- JS Controllers -->
    <script src="/app.js"></script>
</body>
</html>`);
}
