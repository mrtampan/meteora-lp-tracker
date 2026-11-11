// PM2 ecosystem — meteora-lp-tracker
//
// Laporan pagi kini berjalan otomatis di dalam proses tracker (menghemat memori PM2).
// Jam laporan bisa diatur lewat .env atau env var (default: 07:00 WIB / UTC+7):
//   REPORT_HOUR_WIB=7
//   REPORT_MINUTE=0
//
//   pm2 start ecosystem.config.cjs
//   pm2 save

module.exports = {
  apps: [
    {
      // Listener onLogs & scheduler laporan pagi internal
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
  ],
};
