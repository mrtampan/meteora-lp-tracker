import { Connection, PublicKey } from '@solana/web3.js';
import { getCoder, decodeDlmmEvents } from '../src/events.js';
import { DLMM_PROGRAM } from '../src/config.js';

const conn = new Connection(process.env.RPC_URL, 'confirmed');
const coder = await getCoder(conn);
const wanted = new Set(['addLiquidity', 'removeLiquidity', 'positionClose']);
const found = new Set();

// scan dua sumber: program signatures + pool activity
const pools = [
  '95XhdPxhKXVFjoEFTDxNqkYuF9eeZZWG4kCVPAccPNjx',
  '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',
  'AXLx5nH6z6cTQ5u6kzTz1RzN4Z8bLgz1Bmx6j3hnFKqS',
];
let sigs = [];
for (const p of pools) {
  try {
    const r = await conn.getSignaturesForAddress(new PublicKey(p), { limit: 60 }, 'confirmed');
    sigs.push(...r);
  } catch {}
}
if (sigs.length < 20) sigs = await conn.getSignaturesForAddress(new PublicKey(DLMM_PROGRAM), { limit: 150 }, 'confirmed');

for (const s of sigs) {
  if (s.err || found.size >= 3) continue;
  let tx;
  try { tx = await conn.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 }); } catch { continue; }
  if (!tx) continue;
  const events = decodeDlmmEvents(tx, coder);
  for (const ev of events) {
    const n = String(ev.name);
    if (!wanted.has(n) || found.has(n)) continue;
    found.add(n);
    console.log(`\n=== ${n} ===`);
    console.log('keys:', Object.keys(ev.data || {}));
    const d = ev.data || {};
    for (const [k, v] of Object.entries(d)) {
      let str;
      if (v && typeof v.toString === 'function' && v.constructor?.name !== 'Object') str = v.toString();
      else if (Array.isArray(v)) str = JSON.stringify(v.map(x => x?.toString?.() ?? x));
      else str = JSON.stringify(v);
      console.log(`  ${k} = ${String(str).slice(0, 100)}`);
    }
    console.log('  sig:', s.signature);
  }
}
if (found.size < 3) console.log('\nbelum ketemu semua. dapat:', [...found]);
