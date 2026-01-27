module.exports = {
  apps: [
    {
      name: 'echolon-sample-api',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3501,
      },
      error_file: '/var/log/echolon-sample-api/error.log',
      out_file: '/var/log/echolon-sample-api/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
