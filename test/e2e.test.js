// End-to-end offline test: decode event nyata → valuasi → format Telegram.
import { Connection, PublicKey } from '@solana/web3.js';
import { getCoder, decodeDlmmEvents, readLbPair } from '../src/events.js';
import { solPriceUsd, valueInUsd } from '../src/price.js';
import { formatLpEvent } from '../src/telegram.js';
import { config, DLMM_PROGRAM } from '../src/config.js';

const conn = new Connection(process.env.RPC_URL, 'confirmed');
const coder = await getCoder(conn);
const solPrice = await solPriceUsd();
console.log(`SOL price: $${solPrice}`);

const POOL = '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6';
const sigs = await conn.getSignaturesForAddress(new PublicKey(POOL), { limit: 40 }, 'confirmed');

let shown = 0;
for (const s of sigs) {
  if (shown >= 2) break;
  let tx;
  try { tx = await conn.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 }); } catch { continue; }
  if (!tx) continue;
  const events = decodeDlmmEvents(tx, coder);
  const rel = events.filter(e => e.name === 'addLiquidity' || e.name === 'removeLiquidity');
  if (!rel.length) continue;

  const pair = await readLbPair(conn, POOL, coder);
  if (!pair) { console.log('pair read failed'); continue; }

  for (const ev of rel) {
    const d = ev.data;
    const amounts = d.amounts.map(a => BigInt(a.toString()));
    const xIsQuote = pair.tokenXMint === config.solMint || pair.tokenXMint === config.usdcMint;
    const quoteMint = xIsQuote ? pair.tokenXMint : pair.tokenYMint;
    const quoteAmount = xIsQuote ? amounts[0] : amounts[1];
    const tokenMint = xIsQuote ? pair.tokenYMint : pair.tokenXMint;
    const decimals = quoteMint === config.usdcMint ? 6 : 9;
    const v = await valueInUsd({ mint: quoteMint, rawAmount: quoteAmount, decimals, solPrice });
    const amountUsd = v.usd;
    const amountSol = quoteMint === config.solMint ? v.amount : (amountUsd && solPrice ? amountUsd / solPrice : null);

    const payload = {
      type: ev.name === 'addLiquidity' ? 'add' : 'close',
      wallet: d.from.toString(),
      walletName: 'TestWallet',
      pool: POOL,
      tokenMint,
      amountSol, amountUsd,
      signature: s.signature,
      datetime: '2026-11-07 10:00:00 WIB',
    };
    console.log('\n--- RAW ---');
    console.log(JSON.stringify({ ...payload, amountSol, amountUsd }, null, 2));
    console.log('\n--- TELEGRAM ---');
    console.log(formatLpEvent(payload));
    console.log('\n' + '='.repeat(50));
    shown++;
  }
}
