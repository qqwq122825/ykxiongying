module.exports = {
  apps: [{
    name: 'device-ws',
    script: 'src/index.js',
    cwd: 'C:/wwwroot/cs/node-ws',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '1G',
    min_uptime: 10000,
    max_restarts: 5,
    restart_delay: 2000,
    kill_timeout: 5000,
    stop_exit_codes: [78],
    watch: false,
    out_file: 'C:\\wwwroot\\cs\\node-ws\\pm2-out.log',
    error_file: 'C:\\wwwroot\\cs\\node-ws\\pm2-err.log',
    merge_logs: true,
    time: true,
    env: { NODE_ENV: 'production', WS_SHUTDOWN_WAIT_MS: '1000' }
  }]
}
