import { config } from './config.js';
import { readState, resetTodayList } from './position-list.js';

const MAX_LEN = 4000;

export function telegramEnabled() {
  return Boolean(config.telegram.token && config.telegram.chatId);
}

async function post(method, body) {
  if (!telegramEnabled()) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${config.telegram.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegram.chatId, ...body }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.ok === false) {
      console.error(`[telegram] ${method} gagal: ${res.status} ${json?.description || ''}`);
      return null;
    }
    return json.result;
  } catch (e) {
    console.error(`[telegram] ${method} error: ${e.message}`);
    return null;
  }
}

export async function sendHtml(html) {
  const text = html.length > MAX_LEN ? `${html.slice(0, MAX_LEN - 20)}\n…dipotong` : html;
  return post('sendMessage', {
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtUsd(n) {
  if (n == null || !Number.isFinite(n) || n === 0) return null;
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toPrecision(3)}`;
}

function fmtSol(n) {
  if (n == null || !Number.isFinite(n)) return null;
  if (n >= 1000) return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} SOL`;
  return `${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} SOL`;
}

// Escape HTML lalu jadikan clickable di Telegram.
function link(text, url) {
  return `<a href="${url}">${esc(text)}</a>`;
}

function shortMint(mint) {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function tokenUrl(mint) {
  return `https://solscan.io/token/${mint}`;
}

function txUrl(sig) {
  return `https://solscan.io/tx/${sig}`;
}

// Tautan ke LP Agent — basis URL bisa di-override lewat LPAGENT_BASE di .env.
const LPAGENT_BASE = (config.lpagent?.baseUrl || 'https://app.lpagent.io').replace(/\/+$/, '');

function lpAgentUrl(ev) {
  // Portfolio LP Agent untuk wallet yang bertransaksi (address + chain=SOL).
  if (!ev.wallet) return null;
  return `${LPAGENT_BASE}/portfolio?address=${ev.wallet}&chain=SOL`;
}

export function formatLpEvent(ev) {
  const isAdd = ev.type === 'add';
  const header = isAdd ? '🟢 <b>ADD LIQUIDITY</b>' : '🔴 <b>CLOSE LIQUIDITY</b>';
  const tokenMint = ev.tokenMint || ev.mint;
  const lines = [header, ''];

  // Nama pair / token — paling penting buat dibaca cepat
  if (ev.pairName) {
    lines.push(`🎯 <b>Pair:</b> <b>${esc(ev.pairName)}</b>`);
  }
  if (ev.tokenName) {
    lines.push(`📛 <b>Token:</b> ${esc(ev.tokenName)}${ev.tokenSymbol ? ` (${esc(ev.tokenSymbol)})` : ''}`);
  }
  if (ev.pairName || ev.tokenName) lines.push('');

  lines.push(`👤 <b>Wallet:</b> ${esc(ev.walletName)}`);
  lines.push(`🔗 <code>${esc(ev.wallet)}</code>`);
  lines.push('');

  if (tokenMint) {
    lines.push(`🪙 <b>Mint:</b> ${link(shortMint(tokenMint), tokenUrl(tokenMint))}`);
    lines.push(`   <code>${esc(tokenMint)}</code>`);
  }
  lines.push(`🏊 <b>Pool:</b> <code>${esc(ev.pool)}</code>`);

  lines.push('');
  const solStr = fmtSol(ev.amountSol);
  const usdStr = fmtUsd(ev.amountUsd);
  const hasSol = solStr && ev.amountSol > 0;
  if (hasSol) lines.push(`💰 <b>Nilai:</b> ${solStr}${usdStr ? ` (~${usdStr})` : ''}`);
  else if (usdStr) lines.push(`💰 <b>Nilai:</b> ${usdStr}`);
  else lines.push('💰 <b>Nilai:</b> <i>tidak terdeteksi</i>');

  if (ev.otherAmount && ev.otherSymbol) {
    lines.push(`   + ${esc(ev.otherAmount.toFixed(4))} ${esc(ev.otherSymbol)}`);
  }

  lines.push('');
  lines.push(`🕒 <b>Waktu:</b> ${esc(ev.datetime)}`);
  if (ev.signature) lines.push(`📄 <a href="${txUrl(ev.signature)}">Lihat transaksi</a>`);
  const agentUrl = lpAgentUrl(ev);
  if (agentUrl) lines.push(`🤖 ${link('Lihat di LP Agent', agentUrl)}`);

  return lines.join('\n');
}

export async function notifyLpEvent(ev) {
  return sendHtml(formatLpEvent(ev));
}

// ── perintah bot ──────────────────────────────────────────────────────────
// State (state.json) dikelola oleh position-list.js — satu sumber kebenaran.
const TODAY_KEY = 'today_list';

export async function handleCommand(msg) {
  const text = (msg.text || '').trim();
  if (!text) return;

  // /list — tampilkan posisi hari ini
  if (text === '/list' || text === '/list@' + (msg.bot?.username || '')) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const state = readState();
    const list = Array.isArray(state[TODAY_KEY]) ? state[TODAY_KEY] : [];

    const todayItems = list.filter((item) => {
      if (!item || !item.openDatetime) return false;
      try {
        return new Date(item.openDatetime).toISOString().slice(0, 10) === today;
      } catch {
        return false;
      }
    });

    if (!todayItems.length) {
      return sendHtml('<b>📋 Posisi Hari Ini</b>\n\nBelum ada posisi hari ini, Bos.');
    }

    todayItems.sort((a, b) => new Date(a.openDatetime) - new Date(b.openDatetime));

    const rows = todayItems.map((item) => {
      const token = item.pairName || item.tokenName || item.tokenSymbol || '—';
      const waktu = item.openDatetime;
      return `🟢 <b>${esc(token)}</b> — ${esc(waktu)}`;
    });

    const body = [
      '<b>📋 Posisi Hari Ini</b>',
      '',
      ...rows,
      '',
      `<i>Total: ${todayItems.length} posisi</i>`,
    ].join('\n');

    return sendHtml(body);
  }

  // /deletelist — reset list posisi hari ini
  if (text === '/deletelist' || text === '/deletelist@' + (msg.bot?.username || '')) {
    resetTodayList();
    // Verifikasi hasil tulis ulang — jangan lapor sukses kalau masih ada sisa.
    const after = readState();
    const remaining = Array.isArray(after[TODAY_KEY]) ? after[TODAY_KEY].length : 0;
    if (remaining !== 0) {
      return sendHtml(`<b>⚠️ Gagal Reset</b>\n\nMasih ada ${remaining} posisi di list, Bos.`);
    }
    return sendHtml('<b>🧹 List Posisi Reset</b>\n\nList posisi berhasil di-reset, Bos. Total: 0.');
  }
}

// ── pemroses perintah Telegram ────────────────────────────────────────────
const MAX_POLL = 100;

async function fetchUpdates(offset) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegram.token}/getUpdates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offset: offset == null ? undefined : offset + 1,
          limit: MAX_POLL,
          timeout: 0,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      console.warn(`[telegram] getUpdates error: ${res?.status} ${json?.description || ''}`);
      return [];
    }
    return Array.isArray(json.result) ? json.result : [];
  } catch (e) {
    console.warn(`[telegram] getUpdates fetch error: ${e.message}`);
    return [];
  }
}

export async function listenCommands() {
  let offset = null;
  console.log('[telegram] command listener dimulai');
  while (true) {
    const updates = await fetchUpdates(offset);
    if (!updates.length) {
      await new Promise((r) => setTimeout(r, 3_000));
      continue;
    }
    for (const u of updates) {
      if (typeof u.update_id !== 'number') continue;
      offset = u.update_id;
      const message = u.message || {};
      if (message.chat?.id === config.telegram.chatId && message.text) {
        await handleCommand(message).catch((e) => {
          console.warn(`[telegram] handleCommand error: ${e.message}`);
        });
      }
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
}
