import { LpTracker } from './tracker.js';
import { config } from './config.js';
import { listWallets } from './wallets.js';
import { telegramEnabled, listenCommands } from './telegram.js';

async function main() {
  console.log('=== Meteora LP Smart Wallet Tracker ===');
  if (!config.rpcUrl) {
    console.error('ERROR: RPC_URL belum diset. Buat file .env dulu.');
    process.exit(1);
  }
  if (!telegramEnabled()) {
    console.error('ERROR: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID belum diset di .env');
    process.exit(1);
  }
  const wallets = listWallets();
  if (!wallets.length) {
    console.error('ERROR: belum ada wallet dipantau. Tambah: node src/cli.js add <address> <nama>');
    process.exit(1);
  }

  const tracker = new LpTracker();
  await tracker.start();

  console.log(`Telegram: siap | minDepositUsd=${config.minDepositUsd} | backfill=${config.backfillMinutes}m`);
  console.log('Menunggu event add/close liquidity...');

  const shutdown = async (sig) => {
    console.log(`\n[${sig}] berhenti...`);
    await tracker.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  setInterval(() => {
    const s = tracker.stats;
    console.log(`[stats] txs=${s.txs} add=${s.adds} close=${s.closes} skip=${s.skipped} err=${s.errors} queue=${tracker.queue.length}`);
  }, 120_000);

  listenCommands().catch((e) => {
    console.error('Fatal: command listener gagal:', e.message);
    process.exit(1);
  });
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
