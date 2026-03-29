// ============================================================
// /api/data-sync.js — 24/7 Signal Cron Worker
// Runs every 2 minutes via Vercel Cron (vercel.json)
// Fetches live data → computes signal → caches in Supabase
// /api/status reads from this cache, not live on every request
// ============================================================

import { signalEngine } from './_utils/signals.js';
import { marketFeed }   from './_utils/market.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── Fetch recent liquidations via Binance REST ────────────────
// REST equivalent of the WS forceOrder stream
async function fetchRecentLiqs() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(
      'https://fapi.binance.com/fapi/v1/forceOrders?symbol=BTCUSDT&limit=100',
      { signal: ctrl.signal }
    );
    if (!r.ok) return null;
    const data = await r.json();

    // data is an array of recent forced orders (liquidations)
    const cutoff = Date.now() - 900_000; // last 15 minutes
    let longLiq = 0, shortLiq = 0, maxQty = 0, magnet = null;

    for (const o of data) {
      if (o.time < cutoff) continue;
      const qty   = parseFloat(o.executedQty);
      const price = parseFloat(o.price);
      // BUY = short was liquidated, SELL = long was liquidated
      if (o.side === 'SELL') longLiq  += qty;
      if (o.side === 'BUY')  shortLiq += qty;
      if (qty > maxQty) { maxQty = qty; magnet = price; }
    }
    return { longLiq, shortLiq, magnet, count: data.length, valid: true };
  } catch { return null; }
}

export default async function handler(req, res) {
  // Allow both cron invocations and manual triggers
  // Cron sends: { "Authorization": "Bearer <CRON_SECRET>" }
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    // Not blocking — just log; cron may not send auth header
    console.warn('[data-sync] No/wrong cron secret — proceeding anyway');
  }

  const startMs = Date.now();

  try {
    // ── 1. Parallel: fetch signal + consensus price + liqs ────
    const [signal, consensus, liqs] = await Promise.all([
      signalEngine.generateSignal(),
      marketFeed.getConsensusPrice('BTC').catch(() => null),
      fetchRecentLiqs(),
    ]);

    const price = consensus?.consensusPrice || signal.indicators?.price || 0;

    // ── 2. Enrich signal with liq data OVERRIDE ───────────────
    // (REST edition returns liqData = null; patch it in here)
    if (liqs && signal.marketStructure) {
      signal.marketStructure.liqLongBTC  = +liqs.longLiq.toFixed(4);
      signal.marketStructure.liqShortBTC = +liqs.shortLiq.toFixed(4);
      signal.marketStructure.liqMagnet   = liqs.magnet;
    }

    // ── 3. Write computed signal to Supabase signal_cache ─────
    const cacheRow = {
      id:           'main',
      signal:       signal.signal,
      confidence:   signal.confidence,
      score:        signal.score,
      regime:       signal.regime,
      reasons:      signal.reasons,
      risk_flags:   signal.riskFlags,
      targets:      signal.targets,
      indicators:   signal.indicators,
      market_structure: signal.marketStructure,
      htf_context:  signal.htfContext,
      micro_entry:  signal.microEntry,
      data_quality: signal.dataQuality,
      consensus_price:  price,
      price_exchanges:  consensus?.allPrices || [],
      price_spread:     consensus?.spread     || 0,
      liq_long:         liqs?.longLiq  ?? 0,
      liq_short:        liqs?.shortLiq ?? 0,
      liq_magnet:       liqs?.magnet   ?? null,
      computed_at:      new Date().toISOString(),
      compute_ms:       Date.now() - startMs,
    };

    const { error } = await supabase
      .from('signal_cache')
      .upsert(cacheRow, { onConflict: 'id' });

    if (error) throw error;

    // ── 4. Also snapshot market data ─────────────────────────
    // Non-blocking — fire and forget
    supabase.from('market_snapshots').insert({
      btc_consensus_price: price,
      spread_percent:      consensus?.spread || 0,
      signal_text:         signal.signal,
      confidence:          signal.confidence,
      source:              'cron_data_sync',
    }).then(() => {}).catch(() => {});

    console.log(`[data-sync] ✅ ${signal.signal} conf=${signal.confidence}% price=$${price} in ${Date.now() - startMs}ms`);

    res.status(200).json({
      ok:         true,
      signal:     signal.signal,
      confidence: signal.confidence,
      price:      price,
      computeMs:  Date.now() - startMs,
    });

  } catch (err) {
    console.error('[data-sync] ❌', err.message);
    res.status(500).json({ error: err.message });
  }
}
