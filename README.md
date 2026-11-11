# Meteora LP Smart Wallet Tracker

Memantau smart wallet di Solana dan mengirim notifikasi ke Telegram setiap kali
wallet tersebut **menambah** atau **menutup** likuiditas di Meteora DLMM.

Diambil dari [yunus-0x/meridian](https://github.com/yunus-0x/meridian) — hanya
bagian monitoring & decoder event. Fitur auto-entry, screening token, dan
manajemen posisi **tidak** disertakan.

## Yang ditampilkan di Telegram

- Mint address token (klik ke Solscan) + pool address
- Nama smart wallet + alamatnya
- Tanggal & jam (WIB)
- Nilai yang disetor/ditarik dalam SOL dan USD
- Link transaksi di Solscan

## Install

Butuh Node.js 18+.

```sh
cd ~/meteora-lp-tracker
npm install
node scripts/patch-anchor.js   # wajib: fix ESM import @meteora-ag/dlmm
cp .env.example .env
```

Edit `.env`:

```
RPC_URL=https://solana-rpc.publicnode.com
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
MIN_DEPOSIT_USD=0
BACKFILL_MINUTES=10
```

RPC harus mendukung WebSocket (untuk `onLogs`). Endpoint publik seperti
`api.mainnet-beta.solana.com` sering kena rate limit — pakai Helius, QuickNode,
atau `solana-rpc.publicnode.com`.

## Menambah wallet yang dipantau

```sh
node src/cli.js add <alamat_wallet> "Nama Wallet"
node src/cli.js wallets
node src/cli.js remove <alamat_wallet>
node src/cli.js test      # tes koneksi Telegram
```

## Jalankan

```sh
npm start
```

Atau (disarankan) lewat PM2 dengan `ecosystem.config.cjs` yang sudah disiapkan —
menjalankan tracker **dan** laporan pagi sekaligus:

```sh
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs meteora-lp-tracker
```

`pm2 save` wajib supaya proses hidup lagi setelah server reboot
(aktifkan dulu auto-start sekali dengan `pm2 startup`).

## Laporan pagi (07:00 WIB)

`src/morning-summary.mjs` merangkum aktivitas DLMM 24 jam terakhir dari semua
smart wallet, lalu mengirim satu pesan ke Telegram: token apa, berapa kali add,
berapa kali close, wallet mana saja, dan transaksi terakhirnya.

Jadwalnya diatur PM2 lewat `cron_restart`, bukan cron sistem. Jam target selalu
**07:00 WIB** — `ecosystem.config.cjs` menghitung ulang jam menurut timezone
server, jadi tidak perlu diubah saat pindah server (mis. server UTC+8 → cron
PM2 menjadi `0 8 * * *`).

```sh
pm2 restart meteora-morning-report   # jalankan sekali sekarang (uji)
pm2 logs meteora-morning-report      # cek hasilnya
npm run report                       # jalankan manual tanpa PM2
REPORT_HOUR_WIB=6 pm2 restart ecosystem.config.cjs   # ubah jam jadi 06:00 WIB
```

## Perintah bot Telegram

Kirim ke bot yang sama dengan `TELEGRAM_CHAT_ID`:

- `/list` — daftar posisi yang dibuka **hari ini** (urut jam buka)
- `/deletelist` — kosongkan daftar posisi hari ini (diverifikasi setelah ditulis)

Posisi dicatat otomatis saat event ADD LIQUIDITY terdeteksi dan dihapus saat
CLOSE. Datanya ada di `state.json` key `today_list`.

## Deploy ke server baru

```sh
git clone / rsync project ke server baru
cd meteora-lp-tracker
bash scripts/deploy.sh          # cek Node, install deps, patch anchor, start pm2
```

Script akan berhenti dan menyuruh mengisi `.env` bila belum ada. File yang
**tidak** boleh tertimpa saat migrasi (bawa dari server lama):

- `.env` — kredensial RPC & Telegram
- `wallets.json` — daftar wallet yang dipantau
- `state.json` — dedupe signature & daftar posisi (kalau tidak dibawa, tracker
  akan mengirim ulang notifikasi untuk transaksi di jendela `BACKFILL_MINUTES`)

## Struktur

```
src/
  config.js         # env + konstanta (mint SOL/USDC, program DLMM)
  wallets.js        # CRUD daftar wallet (wallets.json)
  events.js         # decoder event Anchor DLMM (addLiquidity/removeLiquidity)
  price.js          # harga SOL→USD (Jupiter, fallback CoinGecko)
  position-list.js  # satu-satunya pengelola state.json (posisi hari ini)
  telegram.js       # format pesan, kirim, listener /list & /deletelist
  tracker.js        # subscribe onLogs, backfill, queue, valuasi
  morning-summary.mjs # laporan pagi 24 jam (dijadwalkan PM2)
  index.js          # entry point tracker
  cli.js            # command line
scripts/
  patch-anchor.js   # fix ESM import @meteora-ag/dlmm (dijalankan saat install)
  deploy.sh         # setup satu perintah di server baru
ecosystem.config.cjs # definisi PM2: tracker + laporan pagi
test/                # skrip verifikasi decoder & pipeline
```

## Catatan teknis

- Event dibaca dari CPI instruction ber-discriminator `e445a52e51cb9a1d` di
  program DLMM (`LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo`), lalu
  di-decode via Anchor coder dari IDL resmi `@meteora-ag/dlmm`.
- Harga pool dibaca dari akun `lbPair` untuk tahu mana token X/Y dan mana sisi
  quote (SOL/USDC).
- `positionClose` diperlakukan sebagai **CLOSE LIQUIDITY**.
- State disimpan di `state.json` (dedupe signature), sehingga restart tidak
  mengirim ulang notifikasi lama.
- `BACKFILL_MINUTES` menentukan seberapa jauh transaksi lama di-scan saat start.
