// Smoke test decoder: ambil tx nyata di DLMM program, pastikan decode event jalan.
import { Connection, PublicKey } from '@solana/web3.js';
import { getCoder, decodeDlmmEvents } from '../src/events.js';
import { DLMM_PROGRAM } from '../src/config.js';

const rpc = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(rpc, 'confirmed');
const coder = await getCoder(conn);

const sigs = await conn.getSignaturesForAddress(new PublicKey(DLMM_PROGRAM), { limit: 40 }, 'confirmed');
console.log(`Ambil ${sigs.length} signature dari program DLMM`);

let decoded = 0, add = 0, remove = 0, checked = 0;
for (const s of sigs) {
  if (s.err) continue;
  checked++;
  const tx = await conn.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 });
  if (!tx) continue;
  const events = decodeDlmmEvents(tx, coder);
  if (!events.length) continue;
  decoded++;
  for (const ev of events) {
    const n = String(ev.name || '');
    if (n === 'addLiquidity') add++;
    if (/^(removeLiquidity|removeLiquidityByRange|closePosition)$/.test(n)) remove++;
    if (decoded <= 3) {
      const d = ev.data || {};
      console.log(`  ${s.signature.slice(0, 12)} | ${n} | from=${d.from?.toString?.().slice(0,8)} lbPair=${(d.lbPair||d.pool)?.toString?.().slice(0,8)} amounts=${JSON.stringify((d.amounts||[]).map(a=>a.toString()))}`);
    }
  }
  if (decoded >= 5) break;
}

console.log(`\nHasil: ${checked} tx diperiksa | ${decoded} tx punya event | addLiquidity=${add} | remove/close=${remove}`);
if (decoded === 0) { console.error('GAGAL: tidak ada event ter-decode'); process.exit(1); }
console.log('OK: decoder berfungsi');
