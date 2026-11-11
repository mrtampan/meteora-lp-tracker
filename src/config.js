import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(ROOT, '.env') });

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

const fileConfig = loadJson(path.join(ROOT, 'config.json'), {});

export const ROOT_DIR = ROOT;
export const paths = {
  root: ROOT,
  wallets: path.join(ROOT, 'wallets.json'),
  state: path.join(ROOT, 'state.json'),
  logDir: path.join(ROOT, 'logs'),
};

export const config = {
  rpcUrl: process.env.RPC_URL || fileConfig.rpcUrl || '',
  wsUrl: process.env.WS_URL || fileConfig.wsUrl || '',
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || fileConfig.telegramBotToken || '',
    chatId: process.env.TELEGRAM_CHAT_ID || fileConfig.telegramChatId || '',
  },
  // Minimum quote-side (SOL/USDC) value of a deposit to report. 0 = report everything.
  minDepositUsd: num(process.env.MIN_DEPOSIT_USD ?? fileConfig.minDepositUsd, 0),
  // How far back to backfill on startup (minutes)
  backfillMinutes: num(process.env.BACKFILL_MINUTES ?? fileConfig.backfillMinutes, 10),
  jupiterApiKey: process.env.JUPITER_API_KEY || fileConfig.jupiterApiKey || '',
  // Basis URL tautan "Lihat di LP Agent" di pesan Telegram.
  lpagent: {
    baseUrl: process.env.LPAGENT_BASE || fileConfig.lpagentBaseUrl || 'https://app.lpagent.io',
  },
  solMint: 'So11111111111111111111111111111111111111112',
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

export const DLMM_PROGRAM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';

if (!config.rpcUrl) console.warn('[warn] RPC_URL belum diset di .env — tracker tidak bisa jalan.');
