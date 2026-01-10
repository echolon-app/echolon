module.exports = {
  apps: [
    {
      name: 'echolon-proxy',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3500,
        REQUEST_TIMEOUT: 30000,
        PING_INTERVAL: 30000,
      },
      error_file: '/var/log/echolon-proxy/error.log',
      out_file: '/var/log/echolon-proxy/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};

