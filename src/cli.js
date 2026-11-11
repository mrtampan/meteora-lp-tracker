#!/usr/bin/env node
import { listWallets, addWallet, removeWallet } from './wallets.js';
import { config } from './config.js';
import { telegramEnabled, sendHtml } from './telegram.js';

const [, , cmd, ...args] = process.argv;

function printWallets() {
  const wallets = listWallets();
  if (!wallets.length) {
    console.log('Belum ada wallet.');
    return;
  }
  console.log(`Total: ${wallets.length} wallet\n`);
  for (const w of wallets) {
    console.log(`  ${w.name.padEnd(18)} ${w.address}`);
  }
}

switch (cmd) {
  case 'add': {
    const [address, ...nameParts] = args;
    if (!address) { console.error('Pakai: node src/cli.js add <address> [nama]'); process.exit(1); }
    const res = addWallet({ address, name: nameParts.join(' ') });
    if (!res.ok) { console.error(`Gagal: ${res.error}`); process.exit(1); }
    console.log(`${res.updated ? 'Diperbarui' : 'Ditambahkan'}: ${res.wallet.name} — ${res.wallet.address}`);
    break;
  }
  case 'remove': {
    const [address] = args;
    if (!address) { console.error('Pakai: node src/cli.js remove <address>'); process.exit(1); }
    const res = removeWallet(address);
    if (!res.ok) { console.error(`Gagal: ${res.error}`); process.exit(1); }
    console.log('Wallet dihapus.');
    break;
  }
  case 'wallets':
  case 'list':
    printWallets();
    break;
  case 'test': {
    console.log('RPC:', config.rpcUrl || '(belum diset)');
    console.log('Telegram token:', config.telegram.token ? 'ok' : 'belum diset');
    console.log('Telegram chat :', config.telegram.chatId || 'belum diset');
    console.log('Wallets:', listWallets().length);
    if (!telegramEnabled()) {
      console.error('\nTelegram belum siap, test message tidak dikirim.');
      process.exit(1);
    }
    const res = await sendHtml('✅ <b>Meteora LP Tracker</b>\nKoneksi Telegram berhasil. Notifikasi siap dikirim.');
    if (res) console.log('\nPesan test terkirim ke Telegram.');
    else { console.error('\nGagal kirim pesan (cek token/chat id).'); process.exit(1); }
    break;
  }
  default:
    console.log(`Meteora LP Smart Wallet Tracker

Usage:
  node src/cli.js add <address> [nama]   Tambah wallet yang dipantau
  node src/cli.js remove <address>       Hapus wallet
  node src/cli.js wallets                Lihat daftar wallet
  node src/cli.js test                   Test koneksi Telegram
  npm start                              Jalankan tracker`);
}
