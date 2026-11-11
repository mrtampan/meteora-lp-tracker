// PM2 ecosystem — portable: jam laporan dihitung dari timezone server,
// target tetap 07:00 WIB (UTC+7) di server mana pun.
//
//   pm2 start ecosystem.config.cjs
//   pm2 save
//
// Ubah jam laporan tanpa edit file: REPORT_HOUR_WIB=6 pm2 restart ecosystem.config.cjs
const REPORT_HOUR_WIB = Number(process.env.REPORT_HOUR_WIB ?? 7);
const REPORT_MINUTE = Number(process.env.REPORT_MINUTE ?? 0);

const WIB_OFFSET = 7; // WIB selalu UTC+7, tanpa DST
const serverOffset = -new Date().getTimezoneOffset() / 60; // mis. +8 untuk CST
const localHour = (((REPORT_HOUR_WIB - WIB_OFFSET + serverOffset) % 24) + 24) % 24;
const reportCron = `${REPORT_MINUTE} ${localHour} * * *`;

module.exports = {
  apps: [
    {
      // Listener onLogs — harus selalu hidup.
      name: 'meteora-lp-tracker',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      exp_backoff_restart_delay: 200,
      time: true,
      out_file: './logs/tracker-out.log',
      error_file: './logs/tracker-error.log',
      merge_logs: true,
    },
    {
      // Laporan pagi: script sekali jalan, dijadwalkan ulang tiap hari oleh PM2.
      // autorestart=false wajib, kalau tidak PM2 akan restart terus setelah exit.
      name: 'meteora-morning-report',
      script: 'src/morning-summary.mjs',
      cwd: __dirname,
      autorestart: false,
      cron_restart: reportCron,
      time: true,
      out_file: './logs/report-out.log',
      error_file: './logs/report-error.log',
      merge_logs: true,
    },
  ],
};