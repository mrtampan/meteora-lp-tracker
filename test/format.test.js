// Test: pastikan nama token/pair muncul di pesan.
import { Connection, PublicKey } from '@solana/web3.js';
import { getCoder, decodeDlmmEvents, readLbPair } from '../src/events.js';
import { solPriceUsd, valueInUsd, tokenMeta, tokenLabel } from '../src/price.js';
import { formatLpEvent } from '../src/telegram.js';
import { config } from '../src/config.js';

const conn = new Connection(process.env.RPC_URL, 'confirmed');
const coder = await getCoder(conn);
const solPrice = await solPriceUsd();

const POOLS = [
  '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',
  '95XhdPxhKXVFjoEFTDxNqkYuF9eeZZWG4kCVPAccPNjx',
];

let shown = 0;
for (const POOL of POOLS) {
  if (shown >= 2) break;
  const sigs = await conn.getSignaturesForAddress(new PublicKey(POOL), { limit: 40 }, 'confirmed');
  const pair = await readLbPair(conn, POOL, coder);
  if (!pair) continue;

  for (const s of sigs) {
    if (shown >= 2) break;
    if (s.err) continue;
    let tx;
    try { tx = await conn.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 1 }); } catch { continue; }
    if (!tx) continue;
    for (const ev of decodeDlmmEvents(tx, coder)) {
      if (!/^(addLiquidity|removeLiquidity)$/.test(String(ev.name))) continue;
      const amounts = ev.data.amounts.map(a => BigInt(a.toString()));
      const xIsQuote = pair.tokenXMint === config.solMint || pair.tokenXMint === config.usdcMint;
      const quoteMint = xIsQuote ? pair.tokenXMint : pair.tokenYMint;
      const quoteAmount = xIsQuote ? amounts[0] : amounts[1];
      const tokenMint = xIsQuote ? pair.tokenYMint : pair.tokenXMint;
      const decimals = quoteMint === config.usdcMint ? 6 : 9;
      const v = await valueInUsd({ mint: quoteMint, rawAmount: quoteAmount, decimals, solPrice });
      const amountUsd = v.usd;
      const amountSol = quoteMint === config.solMint ? v.amount : (amountUsd && solPrice ? amountUsd / solPrice : null);

      const meta = await tokenMeta(tokenMint);
      const sym = tokenLabel(meta, tokenMint);
      const quoteSym = quoteMint === config.usdcMint ? 'USDC' : 'SOL';
      const pairName = meta?.symbol ? `${meta.symbol}/${quoteSym}` : `${sym}/${quoteSym}`;

      console.log('\n=== META ===');
      console.log(`mint=${tokenMint}`);
      console.log(`symbol=${meta?.symbol} name=${meta?.name}`);
      console.log(`pairName=${pairName}`);
      console.log('\n--- PESAN TELEGRAM ---');
      console.log(formatLpEvent({
        type: ev.name === 'addLiquidity' ? 'add' : 'close',
        wallet: ev.data.from.toString(),
        walletName: 'Robotaxi create pool',
        pool: POOL,
        tokenMint,
        tokenSymbol: meta?.symbol || null,
        tokenName: meta?.name || null,
        pairName,
        amountSol, amountUsd,
        signature: s.signature,
        datetime: '2026-11-07 11:35:00 WIB',
      }));
      console.log('='.repeat(50));
      shown++;
    }
  }
}
if (!shown) { console.error('Tidak ada event untuk ditest'); process.exit(1); }
