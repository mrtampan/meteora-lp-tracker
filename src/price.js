import { config } from './config.js';

let cache = { at: 0, price: 0 };

export async function solPriceUsd() {
  if (Date.now() - cache.at < 60_000 && cache.price > 0) return cache.price;
  try {
    const headers = config.jupiterApiKey ? { 'x-api-key': config.jupiterApiKey } : {};
    const res = await fetch(`https://api.jup.ag/price/v3?ids=${config.solMint}`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      const price = Number(data?.[config.solMint]?.usdPrice);
      if (price > 0) { cache = { at: Date.now(), price }; return price; }
    }
  } catch { /* fallback below */ }
  // Fallback: CoinGecko simple price
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      const price = Number(data?.solana?.usd);
      if (price > 0) { cache = { at: Date.now(), price }; return price; }
    }
  } catch { /* give up */ }
  return cache.price || 0;
}

// Konversi raw amount (string bigint) ke jumlah token, lalu ke USD bila memungkinkan.
export function rawToUi(raw, decimals) {
  const s = raw.toString();
  const neg = s.startsWith('-');
  const digits = (neg ? s.slice(1) : s).padStart(decimals + 1, '0');
  const int = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '');
  const val = Number(`${int}${frac ? '.' + frac : ''}`);
  return neg ? -val : val;
}

export async function valueInUsd({ mint, rawAmount, decimals, solPrice }) {
  const amount = rawToUi(rawAmount, decimals);
  if (mint === config.solMint) return { amount, usd: amount * (solPrice || 0), symbol: 'SOL' };
  if (mint === config.usdcMint) {
    const ui = Number(rawAmount.toString()) / 1e6;
    return { amount: ui, usd: ui, symbol: 'USDC' };
  }
  return { amount, usd: null, symbol: null };
}

// ─── Metadata token (symbol & nama) ────────────────────────────────────────
const metaCache = new Map();

export async function tokenMeta(mint) {
  if (!mint) return null;
  const hit = metaCache.get(mint);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.meta;
  try {
    const res = await fetch(`https://datapi.jup.ag/v1/assets/search?query=${mint}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.data || []);
      const exact = list.find(x => x.id === mint) || list[0];
      if (exact) {
        const meta = { symbol: exact.symbol || null, name: exact.name || null };
        metaCache.set(mint, { at: Date.now(), meta });
        return meta;
      }
    }
  } catch { /* fallback below */ }
  // Fallback: on-chain Metaplex metadata (nama sering tersedia di sini)
  metaCache.set(mint, { at: Date.now(), meta: null });
  return null;
}

export function tokenLabel(meta, mint) {
  if (meta?.symbol && meta?.name && meta.name !== meta.symbol) return `${meta.symbol} (${meta.name})`;
  if (meta?.symbol) return meta.symbol;
  if (meta?.name) return meta.name;
  return mint ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : 'Unknown';
}
