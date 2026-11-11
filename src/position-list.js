import fs from 'node:fs';
import { paths } from './config.js';

// Path state diturunkan dari lokasi project (portable, tidak hardcode /home/ubuntu).
const STATE_PATH = paths.state;
const TODAY_KEY = 'today_list';

export function readState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function writeState(state) {
  try {
    // Tulis atomic: temp file lalu rename, supaya state.json tidak korup saat crash.
    const tmp = `${STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_PATH);
  } catch (e) {
    console.error(`[position-list] gagal tulis state.json: ${e.message}`);
  }
}

export function recordOpenPosition(ev) {
  if (!ev || !ev.pool) return;
  const state = readState();
  if (!Array.isArray(state[TODAY_KEY])) state[TODAY_KEY] = [];
  const exists = state[TODAY_KEY].some(
    (item) => item.pool === ev.pool && item.wallet === ev.wallet,
  );
  if (exists) return;

  state[TODAY_KEY].push({
    pool: ev.pool,
    wallet: ev.wallet,
    walletName: ev.walletName || '',
    pairName: ev.pairName || '',
    tokenName: ev.tokenName || '',
    tokenSymbol: ev.tokenSymbol || '',
    tokenMint: ev.tokenMint || ev.mint || '',
    amountSol: ev.amountSol ?? null,
    amountUsd: ev.amountUsd ?? null,
    openDatetime: ev.datetime || new Date().toISOString(),
  });
  writeState(state);
}

export function removeClosedPosition(ev) {
  if (!ev || !ev.pool) return;
  const state = readState();
  if (!Array.isArray(state[TODAY_KEY])) return;
  const before = state[TODAY_KEY].length;
  state[TODAY_KEY] = state[TODAY_KEY].filter(
    (item) => !(item.pool === ev.pool && item.wallet === ev.wallet),
  );
  if (state[TODAY_KEY].length !== before) {
    writeState(state);
  }
}

export function resetTodayList() {
  const state = readState();
  state[TODAY_KEY] = [];
  writeState(state);
}
