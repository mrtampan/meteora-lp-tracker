// Monitor smart wallets: subscribe onLogs, ambil tx, decode event add/remove liquidity Meteora DLMM.
import fs from 'node:fs';
import { Connection, PublicKey } from '@solana/web3.js';
import { config, paths } from './config.js';
import { getCoder, decodeDlmmEvents, readLbPair } from './events.js';
import { listWallets } from './wallets.js';
import { solPriceUsd, valueInUsd, tokenMeta, tokenLabel } from './price.js';
import { notifyLpEvent } from './telegram.js';
import { recordOpenPosition, removeClosedPosition } from './position-list.js';

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
    if (Array.isArray(s.seen)) return s;
  } catch { /* fresh */ }
  return { seen: [], cursors: {} };
}

function saveState(state) {
  try { fs.writeFileSync(paths.state, JSON.stringify(state, null, 2)); } catch { /* ignore */ }
}

function fmtDateTime(ms) {
  // Waktu Indonesia Barat (UTC+7)
  const d = new Date(ms + 7 * 3600_000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} WIB`;
}

export class LpTracker {
  constructor() {
    this.state = loadState();
    this.seen = new Set(this.state.seen);
    this.subs = new Map();
    this.queue = [];
    this.draining = false;
    this.running = false;
    this.conn = new Connection(config.rpcUrl, {
      commitment: 'confirmed',
      ...(config.wsUrl ? { wsEndpoint: config.wsUrl } : {}),
      disableRetryOnRateLimit: true,
    });
    this.stats = { txs: 0, adds: 0, closes: 0, errors: 0, skipped: 0 };
  }

  get wallets() {
    return listWallets();
  }

  key(wallet, signature) {
    return `${wallet}:${signature}`;
  }

  enqueue(wallet, signature) {
    if (!this.running) return;
    const k = this.key(wallet, signature);
    if (this.seen.has(k) || this.queue.some(q => q.k === k)) return;
    this.queue.push({ k, wallet, signature, at: Date.now() });
  }

  markSeen(k) {
    this.seen.add(k);
    this.state.seen.push(k);
    // Batasi histori: simpan 5000 terakhir saja
    if (this.state.seen.length > 5000) {
      const drop = this.state.seen.splice(0, this.state.seen.length - 5000);
      for (const d of drop) this.seen.delete(d);
    }
    this.state.lastUpdate = new Date().toISOString();
    saveState(this.state);
  }

  async start() {
    this.running = true;
    const wallets = this.wallets;
    if (!wallets.length) throw new Error('Belum ada wallet. Tambahkan dulu: node src/cli.js add <address> <nama>');
    console.log(`[tracker] memantau ${wallets.length} wallet`);
    for (const w of wallets) this.subscribe(w);
    this.timer = setInterval(() => this.drain(), 1500);
    this.reconcileTimer = setInterval(() => this.reconcile(), 90_000);
    await this.backfill();
  }

  subscribe(w) {
    if (this.subs.has(w.address)) return;
    const id = this.conn.onLogs(new PublicKey(w.address), (event) => {
      if (event.err) return;
      this.enqueue(w.address, event.signature);
    }, 'confirmed');
    this.subs.set(w.address, id);
  }

  // Tangkap tx yang terlewat saat downtime/WS putus.
  async backfill() {
    const since = Date.now() - config.backfillMinutes * 60_000;
    for (const w of this.wallets) {
      try {
        const sigs = await this.conn.getSignaturesForAddress(new PublicKey(w.address), { limit: 30 }, 'confirmed');
        for (const s of sigs) {
          if (!s.blockTime || s.blockTime * 1000 < since) continue;
          if (s.err) continue;
          this.enqueue(w.address, s.signature);
        }
      } catch (e) {
        console.warn(`[backfill] ${w.name}: ${e.message}`);
      }
    }
  }

  async reconcile() {
    const current = new Set(this.wallets.map(w => w.address));
    for (const [addr, id] of [...this.subs]) {
      if (current.has(addr)) continue;
      await this.conn.removeOnLogsListener(id).catch(() => {});
      this.subs.delete(addr);
      console.log(`[tracker] stop memantau ${addr.slice(0, 8)}`);
    }
    for (const w of this.wallets) this.subscribe(w);
    await this.backfill();
  }

  async drain() {
    if (this.draining || !this.running) return;
    this.draining = true;
    try {
      const batch = this.queue.splice(0, 15);
      for (const item of batch) {
        if (this.seen.has(item.k)) continue;
        try {
          await this.processTx(item);
        } catch (e) {
          this.stats.errors++;
          console.warn(`[tx] ${item.signature.slice(0, 10)} gagal: ${e.message}`);
        }
        this.markSeen(item.k);
      }
    } finally {
      this.draining = false;
    }
  }

  async processTx({ wallet, signature }) {
    const tx = await this.conn.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 1,
    });
    if (!tx || tx.meta?.err) return;
    this.stats.txs++;

    const coder = await getCoder(this.conn);
    const events = decodeDlmmEvents(tx, coder);
    if (!events.length) return;

    const walletMeta = this.wallets.find(w => w.address === wallet);
    const walletName = walletMeta?.name || wallet.slice(0, 6);
    const solPrice = await solPriceUsd();

    for (const ev of events) {
      const name = String(ev.name || '');
      const isAdd = name === 'addLiquidity';
      const isRemove = /^(removeLiquidity|removeLiquidityByRange|closePosition)$/.test(name);
      if (!isAdd && !isRemove) continue;

      const d = ev.data || {};
      if (d.from && d.from.toString() !== wallet) continue;

      const pool = d.lbPair?.toString?.() || d.pool?.toString?.() || null;
      const amounts = Array.isArray(d.amounts) ? d.amounts.map(a => BigInt(a.toString())) : null;

      // Pair account untuk tahu mana token X/Y
      let pair = null;
      if (pool) {
        try { pair = await readLbPair(this.conn, pool, coder); } catch { /* ignore */ }
      }

      // Tentukan sisi quote (SOL/USDC) dan token.
      let tokenMint = null;
      let quoteMint = null;
      let quoteAmount = 0n;
      let extraUsd = 0; // nilai dari sisi quote kedua (misal USDC pada pool SOL/USDC)

      if (pair && amounts) {
        const xIsQuote = pair.tokenXMint === config.solMint || pair.tokenXMint === config.usdcMint;
        const yIsQuote = pair.tokenYMint === config.solMint || pair.tokenYMint === config.usdcMint;

        if (xIsQuote && yIsQuote) {
          // Pool dua-duanya quote (SOL/USDC): jumlahkan nilai kedua sisi.
          const solIdx = pair.tokenXMint === config.solMint ? 0 : 1;
          const usdcIdx = solIdx === 0 ? 1 : 0;
          const solVal = await valueInUsd({ mint: config.solMint, rawAmount: amounts[solIdx], decimals: 9, solPrice });
          const usdcVal = await valueInUsd({ mint: config.usdcMint, rawAmount: amounts[usdcIdx], decimals: 6, solPrice });
          quoteMint = config.solMint;
          quoteAmount = amounts[solIdx];
          tokenMint = pair.tokenYMint === config.solMint ? pair.tokenXMint : pair.tokenYMint;
          extraUsd = usdcVal.usd || 0;
        } else if (xIsQuote && !yIsQuote) {
          quoteMint = pair.tokenXMint; quoteAmount = amounts[0]; tokenMint = pair.tokenYMint;
        } else if (yIsQuote && !xIsQuote) {
          quoteMint = pair.tokenYMint; quoteAmount = amounts[1]; tokenMint = pair.tokenXMint;
        } else {
          // Tidak ada sisi quote yang dikenali — pakai sisi X sebagai basis nilai 0.
          quoteMint = pair.tokenXMint; quoteAmount = amounts[0]; tokenMint = pair.tokenYMint;
        }
      } else {
        continue; // butuh pair info untuk valuasi
      }

      const decimals = quoteMint === config.usdcMint ? 6 : 9;
      const valuation = await valueInUsd({ mint: quoteMint, rawAmount: quoteAmount, decimals, solPrice });
      const amountUsd = valuation.usd == null && extraUsd === 0 ? null : (valuation.usd || 0) + extraUsd;
      const amountSol = quoteMint === config.solMint
        ? valuation.amount
        : (amountUsd && solPrice ? amountUsd / solPrice : null);

      if (config.minDepositUsd > 0 && (amountUsd ?? 0) < config.minDepositUsd) {
        this.stats.skipped++;
        continue;
      }

      // Metadata token untuk nama yang bisa dibaca
      const meta = await tokenMeta(tokenMint);
      const sym = tokenLabel(meta, tokenMint);
      const quoteSym = quoteMint === config.usdcMint ? 'USDC' : 'SOL';
      // Untuk pool dua-quote (SOL/USDC), sebut kedua sisi dengan benar.
      let pairName;
      if (pair.tokenXMint === config.solMint && pair.tokenYMint === config.usdcMint) {
        pairName = 'SOL/USDC';
      } else if (pair.tokenXMint === config.usdcMint && pair.tokenYMint === config.solMint) {
        pairName = 'USDC/SOL';
      } else {
        pairName = meta?.symbol ? `${meta.symbol}/${quoteSym}` : `${sym}/${quoteSym}`;
      }

      const event = {
        type: isAdd ? 'add' : 'close',
        wallet,
        walletName,
        pool,
        tokenMint,
        tokenSymbol: meta?.symbol || null,
        tokenName: meta?.name || null,
        pairName,
        amountSol,
        amountUsd,
        signature,
        datetime: fmtDateTime((tx.blockTime || Date.now() / 1000) * 1000),
      };

      if (isAdd) this.stats.adds++; else this.stats.closes++;

      console.log(`[${isAdd ? 'ADD' : 'CLOSE'}] ${walletName} | ${pairName} | ${amountSol ? amountSol.toFixed(4) + ' SOL' : ''}${amountUsd ? ` ($${amountUsd.toFixed(2)})` : ''}`);
      await notifyLpEvent(event);
      if (isAdd) recordOpenPosition(event); else removeClosedPosition(event);
    }
  }

  async stop() {
    this.running = false;
    clearInterval(this.timer);
    clearInterval(this.reconcileTimer);
    for (const id of this.subs.values()) {
      await this.conn.removeOnLogsListener(id).catch(() => {});
    }
    this.subs.clear();
  }
}
