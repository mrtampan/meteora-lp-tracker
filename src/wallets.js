import fs from 'node:fs';
import { paths } from './config.js';

const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(paths.wallets, 'utf8'));
    if (!Array.isArray(data.wallets)) return { wallets: [] };
    return data;
  } catch {
    return { wallets: [] };
  }
}

function save(data) {
  fs.writeFileSync(paths.wallets, JSON.stringify(data, null, 2));
}

export function listWallets() {
  return load().wallets;
}

export function addWallet({ address, name }) {
  if (!PUBKEY_RE.test(address)) return { ok: false, error: 'Format address Solana tidak valid' };
  const data = load();
  const existing = data.wallets.find(w => w.address === address);
  if (existing) {
    existing.name = name || existing.name;
    save(data);
    return { ok: true, updated: true, wallet: existing };
  }
  const wallet = { name: name || address.slice(0, 6), address, addedAt: new Date().toISOString() };
  data.wallets.push(wallet);
  save(data);
  return { ok: true, wallet };
}

export function removeWallet(address) {
  const data = load();
  const before = data.wallets.length;
  data.wallets = data.wallets.filter(w => w.address !== address);
  if (data.wallets.length === before) return { ok: false, error: 'Wallet tidak ditemukan' };
  save(data);
  return { ok: true };
}

export function walletName(address) {
  const w = load().wallets.find(x => x.address === address);
  return w?.name || null;
}
