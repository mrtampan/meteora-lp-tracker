// Cari wallet aktif yang sedang add/close liquidity di DLMM untuk dijadikan contoh watchlist.
import { Connection, PublicKey } from '@solana/web3.js';
import { getCoder, decodeDlmmEvents } from '../src/events.js';
import { DLMM_PROGRAM } from '../src/config.js';

const conn = new Connection(process.env.RPC_URL, 'confirmed');
const coder = await getCoder(conn);

const POOLS = [
  '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',
  '95XhdPxhKXVFjoEFTDxNqkYuF9eeZZWG4kCVPAccPNjx',
  'AXLx5nH6z6cTQ5u6kzTz1RzN4Z8bLgz1Bmx6j3hnFKqS',
];

const counts = new Map();
let scanned = 0;

for (const pool of POOLS) {
  let sigs = [];
  try {
    sigs = await conn.getSignaturesForAddress(new PublicKey(pool), { limit: 80 }, 'confirmed');
  } catch { continue; }
  for (const s of sigs) {
    if (s.err) continue;
    let tx;
    try { tx = await conn.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 }); } catch { continue; }
    if (!tx) continue;
    scanned++;
    for (const ev of decodeDlmmEvents(tx, coder)) {
      if (!/^(addLiquidity|removeLiquidity)$/.test(String(ev.name))) continue;
      const from = ev.data?.from?.toString?.();
      if (!from) continue;
      const rec = counts.get(from) || { adds: 0, removes: 0 };
      if (ev.name === 'addLiquidity') rec.adds++; else rec.removes++;
      counts.set(from, rec);
    }
  }
}

const ranked = [...counts.entries()]
  .map(([addr, c]) => ({ addr, ...c, total: c.adds + c.removes }))
  .sort((a, b) => b.total - a.total);

console.log(`scan ${scanned} tx, ${ranked.length} wallet unik\n`);
for (const r of ranked.slice(0, 10)) {
  console.log(`${r.addr}  add=${r.adds} remove=${r.removes}`);
}
