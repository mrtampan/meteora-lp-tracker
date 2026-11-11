// Ringkasan token Meteora pagi: kumpulkan aktivitas DLMM dari smart wallets dalam 24 jam terakhir.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import { listWallets } from './wallets.js';
import { getCoder, decodeDlmmEvents, readLbPair } from './events.js';
import { tokenMeta, tokenLabel } from './price.js';
import { config } from './config.js';

const WINDOW_HOURS = 24;
const SIGNATURE_LIMIT = 100;
const env = process.env;

function telegramBase() {
  const token = env.TELEGRAM_BOT_TOKEN || config.telegram?.token;
  const chatId = env.TELEGRAM_CHAT_ID || config.telegram?.chatId;
  if (!token || !chatId) return null;
  return { token, chatId };
}

async function fetchConnection() {
  const rpc = config.rpcUrl || 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpc, { commitment: 'confirmed', disableRetryOnRateLimit: true });
  return conn;
}

function cutTime() {
  const now = Date.now();
  return now - WINDOW_HOURS * 60 * 60 * 1000;
}

function signatureTime(sig) {
  return (sig.blockTime || 0) * 1000;
}

async function walletsInWindow(conn, coder, nowMs) {
  const wallets = listWallets();
  if (!wallets.length) return new Map();
  const sinceSec = Math.floor(nowMs / 1000) - WINDOW_HOURS * 3600;
  const result = new Map();

  for (const wallet of wallets) {
    try {
      const sigs = await conn.getSignaturesForAddress(new PublicKey(wallet.address), { limit: SIGNATURE_LIMIT }, 'confirmed');
      const relevant = sigs.filter(s => s.err == null && s.blockTime != null && s.blockTime >= sinceSec);
      if (!relevant.length) continue;

      for (const sig of relevant) {
        let tx;
        try { tx = await conn.getTransaction(sig.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 }); } catch { continue; }
        if (!tx || tx.meta?.err || tx.blockTime == null) continue;
        const events = decodeDlmmEvents(tx, coder);
        if (!events.length) continue;

        const walletName = wallet.name || wallet.address.slice(0, 6);
        for (const ev of events) {
          const name = String(ev.name || '');
          const isAdd = name === 'addLiquidity';
          const isRemove = /^(removeLiquidity|removeLiquidityByRange|closePosition)$/.test(name);
          if (!isAdd && !isRemove) continue;
          const d = ev.data || {};
          const addr = d.from?.toString?.();
          if (addr && addr !== wallet.address) continue;

          const pool = d.lbPair?.toString?.() || d.pool?.toString?.() || null;
          const amounts = Array.isArray(d.amounts) ? d.amounts.map(a => BigInt(a.toString())) : null;

          let pair = null;
          if (pool) {
            try { pair = await readLbPair(conn, pool, coder); } catch { /* ignore */ }
          }

          if (!pair || !amounts) continue;

          const xIsQuote = pair.tokenXMint === config.solMint || pair.tokenXMint === config.usdcMint;
          const yIsQuote = pair.tokenYMint === config.solMint || pair.tokenYMint === config.usdcMint;
          let tokenMint = null;

          if (xIsQuote && yIsQuote) {
            tokenMint = pair.tokenYMint === config.solMint ? pair.tokenXMint : pair.tokenYMint;
          } else if (xIsQuote) {
            tokenMint = pair.tokenYMint;
          } else if (yIsQuote) {
            tokenMint = pair.tokenXMint;
          } else {
            tokenMint = pair.tokenYMint;
          }

          if (!tokenMint) continue;

          const sym = tokenLabel(await tokenMeta(tokenMint), tokenMint);
          const bucket = result.get(tokenMint) || {
            mint: tokenMint,
            label: sym,
            adds: new Map(),
            removes: new Map(),
            lastAt: tx.blockTime * 1000,
            lastSig: sig.signature,
          };

          if (isAdd) {
            const existing = bucket.adds.get(walletName) || 0;
            bucket.adds.set(walletName, existing + 1);
          } else {
            const existing = bucket.removes.get(walletName) || 0;
            bucket.removes.set(walletName, existing + 1);
          }

          if (tx.blockTime * 1000 > bucket.lastAt) {
            bucket.lastAt = tx.blockTime * 1000;
            bucket.lastSig = sig.signature;
          }

          result.set(tokenMint, bucket);
        }
      }
    } catch (e) {
      console.warn(`[morning-summary] wallet ${wallet.name || wallet.address.slice(0, 8)}: ${e.message}`);
    }
  }

  return result;
}

// Semua pemanggil mengirim milidetik (Date.now() atau tx.blockTime*1000).
export function fmtDateTime(ms) {
  const d = new Date(ms + 7 * 3600_000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} WIB`;
}

export function buildSummary(buckets) {
  const entries = Array.from(buckets.values());
  if (!entries.length) return 'Belum ada aktivitas LP Meteora dari smart wallet dalam 24 jam terakhir.';

  entries.sort((a, b) => b.lastAt - a.lastAt);
  const lines = [];
  lines.push(`🌅 Summary token Meteora — ${fmtDateTime(Date.now())}`);
  lines.push(`Cakupan: ${WINDOW_HOURS} jam terakhir · smart wallet: ${listWallets().length} buah`);
  lines.push('');

  for (const b of entries) {
    const addList = Array.from(b.adds.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ×${count}`)
      .join(', ');
    const removeList = Array.from(b.removes.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ×${count}`)
      .join(', ');

    const totalAdds = Array.from(b.adds.values()).reduce((x, y) => x + y, 0);
    const totalRemoves = Array.from(b.removes.values()).reduce((x, y) => x + y, 0);

    lines.push(`• ${b.label}`);
    lines.push(`  Add Liquidity: ${totalAdds} (pool: ${b.mint.slice(0, 8)}…${b.mint.slice(-8)})`);
    lines.push(`  Close/Remove : ${totalRemoves}`);
    if (addList) lines.push(`  Wallet (add) : ${addList}`);
    if (removeList) lines.push(`  Wallet (close): ${removeList}`);
    lines.push(`  Terakhir     : ${fmtDateTime(b.lastAt)} · sig ${b.lastSig.slice(0, 10)}…`);
    lines.push('');
  }

  return lines.join('\n');
}

async function sendTelegram(text) {
  const base = telegramBase();
  if (!base) return console.warn('[morning-summary] Telegram token/chatId belum diset — skip pengiriman.');
  const url = `https://api.telegram.org/bot${base.token}/sendMessage`;

  // Pecah jika melebihi batas 4000 karakter Telegram
  const chunks = [];
  if (text.length <= 4000) {
    chunks.push(text);
  } else {
    const lines = text.split('\n');
    let current = '';
    for (const line of lines) {
      if ((current + '\n' + line).length > 4000) {
        if (current) chunks.push(current);
        current = line;
      } else {
        current = current ? `${current}\n${line}` : line;
      }
    }
    if (current) chunks.push(current);
  }

  for (const chunk of chunks) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: base.chatId,
        text: chunk,
        // Teks biasa: label token sering mengandung _ * ` yang bikin Markdown gagal parse.
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram API ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    if ((json.result || json.error)?.message) {
      console.log(`[morning-summary] Telegram: ${json.result?.message_id ? 'OK' : json.error?.message}`);
    }
  }
}

let isRunning = false;

export function isReportRunning() {
  return isRunning;
}

export async function runMorningReport(existingConn = null) {
  if (isRunning) {
    console.log('[morning-summary] Laporan sedang berjalan, abaikan panggilan ganda.');
    return null;
  }
  isRunning = true;
  try {
    console.log('[morning-summary] memulai ringkasan token Meteora…');
    const conn = existingConn || await fetchConnection();
    const coder = await getCoder(conn);
    const nowMs = Date.now();
    const buckets = await walletsInWindow(conn, coder, nowMs);
    const text = buildSummary(buckets);
    console.log(text);
    await sendTelegram(text);
    console.log('[morning-summary] selesai');
    return text;
  } finally {
    isRunning = false;
  }
}

// Hitung jeda (ms) menuju jam laporan berikutnya dalam WIB (UTC+7).
export function getNextReportDelayMs(hourWib = 7, minuteWib = 0, baseDate = new Date()) {
  const nowMs = baseDate.getTime();
  const nowWibMs = nowMs + 7 * 3600_000;
  const nowWib = new Date(nowWibMs);

  const targetWib = new Date(nowWibMs);
  targetWib.setUTCHours(hourWib, minuteWib, 0, 0);

  // Jika target waktu hari ini sudah lewat atau tinggal <= 1 detik, jadwalkan besok
  if (targetWib.getTime() - nowWib.getTime() <= 1000) {
    targetWib.setUTCDate(targetWib.getUTCDate() + 1);
  }

  // Tambah buffer 1 detik agar saat timer selesai, waktu sistem sudah melewati menit target
  return Math.max(1000, targetWib.getTime() - nowWib.getTime() + 1000);
}

// Menjalankan scheduler di dalam proses utama tracker.
export function startMorningReportScheduler({
  conn = null,
  hourWib = config.reportHourWib ?? 7,
  minuteWib = config.reportMinute ?? 0,
} = {}) {
  let timer = null;
  let stopped = false;

  const scheduleNext = () => {
    if (stopped) return;
    const delayMs = getNextReportDelayMs(hourWib, minuteWib);
    const nextDate = new Date(Date.now() + delayMs);
    const totalSec = Math.round(delayMs / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);

    console.log(
      `[morning-report] Laporan berikutnya: ${fmtDateTime(nextDate.getTime())} (dalam ${hours}j ${minutes}m)`
    );

    timer = setTimeout(async () => {
      if (stopped) return;
      console.log(`[morning-report] Memulai laporan pagi otomatis (${fmtDateTime(Date.now())})...`);
      try {
        await runMorningReport(conn);
      } catch (err) {
        console.error('[morning-report] Gagal menjalankan laporan pagi:', err?.message || err);
      } finally {
        scheduleNext();
      }
    }, delayMs);
  };

  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      console.log('[morning-report] Scheduler laporan pagi dihentikan.');
    },
    runNow() {
      return runMorningReport(conn);
    },
  };
}

// Jalankan hanya bila dieksekusi langsung, bukan saat di-import untuk test/tracker.
// Catatan: di bawah PM2 (fork mode) process.argv[1] adalah ProcessContainerFork.js,
// path script asli ada di env pm_exec_path.
function invokedDirectly() {
  const entry = process.env.pm_exec_path || process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  runMorningReport().catch(err => {
    console.error('[morning-summary] gagal:', err?.message || err);
    process.exit(1);
  });
}
