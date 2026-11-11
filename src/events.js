// Decode Anchor event CPI instructions emitted by the Meteora DLMM program.
// Hanya event add/remove liquidity yang diambil; sisanya diabaikan.
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { DLMM_PROGRAM } from './config.js';

const EVENT_CPI = Buffer.from([228, 69, 165, 46, 81, 203, 154, 29]);

let coderPromise = null;
let idlEvents = [];
export function getCoder(connection) {
  if (!coderPromise) {
    coderPromise = (async () => {
      const { createProgram } = await import('@meteora-ag/dlmm');
      const program = createProgram(connection);
      const idl = program.idl;
      idlEvents = (idl?.events || []).map(e => e.name);
      return program.coder;
    })();
  }
  return coderPromise;
}

export function getIdlEvents() {
  return idlEvents;
}

export function decodeDlmmEvents(tx, eventCoder) {
  if (!tx?.meta || tx.meta.err || tx.blockTime == null) return [];
  const message = tx.transaction.message;
  const staticKeys = message.staticAccountKeys || message.accountKeys || [];
  const allKeys = [
    ...staticKeys,
    ...(tx.meta.loadedAddresses?.writable || []),
    ...(tx.meta.loadedAddresses?.readonly || []),
  ];
  const events = [];
  for (const group of tx.meta.innerInstructions || []) {
    for (const ix of group.instructions) {
      try {
        if (String(allKeys[ix.programIdIndex]) !== DLMM_PROGRAM || !ix.data) continue;
        const bytes = typeof ix.data === 'string' ? Buffer.from(bs58.decode(ix.data)) : Buffer.from(ix.data);
        if (bytes.length < 16 || !bytes.subarray(0, 8).equals(EVENT_CPI)) continue;
        const payload = bytes.subarray(8).toString('base64');
        let event = null;
        if (eventCoder.events?.decode) {
          try { event = eventCoder.events.decode(payload); } catch { /* fallback below */ }
        }
        if (!event && typeof eventCoder.decode === 'function') {
          try { event = eventCoder.decode(payload); } catch { /* skip */ }
        }
        if (event) events.push(event);
      } catch { /* skip undecodable */ }
    }
  }
  return events;
}

// Fetch lbPair account untuk dapat mint X/Y dan bin step.
export async function readLbPair(connection, poolAddress, eventCoder) {
  const info = await connection.getAccountInfo(new PublicKey(poolAddress), 'confirmed');
  if (!info || info.owner.toString() !== DLMM_PROGRAM) return null;
  try {
    const pair = eventCoder.accounts.decode('lbPair', info.data);
    return {
      tokenXMint: pair.tokenXMint.toString(),
      tokenYMint: pair.tokenYMint.toString(),
      activeId: pair.activeId,
    };
  } catch {
    return null;
  }
}
