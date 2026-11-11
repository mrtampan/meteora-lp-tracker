#!/usr/bin/env bash
# Setup satu perintah untuk server baru (VPS terpisah).
#
#   bash scripts/deploy.sh
#
# Asumsi: repo/project sudah di-upload, Node.js 18+ dan pm2 sudah terpasang.
# Script ini TIDAK menimpa .env, wallets.json, atau state.json yang sudah ada.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "== Meteora LP Tracker — deploy dari $ROOT =="

# 1. Node & pm2
command -v node >/dev/null || { echo "✗ Node.js belum ada. Install Node 18+ dulu."; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { echo "✗ Node.js $NODE_MAJOR terlalu tua, butuh >= 18."; exit 1; }
echo "✓ node $(node -v)"

if ! command -v pm2 >/dev/null; then
  echo "→ pm2 belum ada, install global…"
  npm i -g pm2
fi
echo "✓ pm2 $(pm2 -v)"

# 2. Dependensi (+ postinstall patch-anchor untuk kompatibilitas ESM)
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
node scripts/patch-anchor.js
echo "✓ dependensi + patch anchor"

# 3. .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠ .env dibuat dari .env.example — ISI RPC_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID dulu!"
  echo "  Setelah diisi, jalankan lagi: bash scripts/deploy.sh"
  exit 1
fi
for key in RPC_URL TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
  grep -qE "^${key}=.+" .env || { echo "✗ $key masih kosong di .env"; exit 1; }
done
echo "✓ .env lengkap"

# 4. Direktori log (dipakai ecosystem.config.cjs)
mkdir -p logs

# 5. Wallet & state
[ -f wallets.json ] || echo '{"wallets": []}' > wallets.json
[ -f state.json ] || echo '{"seen": [], "cursors": {}}' > state.json
echo "✓ wallets.json: $(node -e 'console.log(JSON.parse(require("fs").readFileSync("wallets.json","utf8")).wallets.length)') wallet"

# 6. Jalankan di bawah pm2
pm2 delete meteora-lp-tracker >/dev/null 2>&1 || true
pm2 delete meteora-morning-report >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save

# 7. Auto-start setelah reboot
if ! systemctl is-enabled "pm2-$(whoami)" >/dev/null 2>&1; then
  echo
  echo "⚠ Auto-start belum aktif. Jalankan perintah berikut (sekali saja):"
  pm2 startup systemd -u "$(whoami)" --hp "$HOME" | tail -1
fi

echo
pm2 list
echo
echo "Selesai. Log: pm2 logs meteora-lp-tracker"