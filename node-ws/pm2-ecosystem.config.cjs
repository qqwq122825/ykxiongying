const path = require('path');
const cwd = __dirname;

module.exports = {
  apps: [{
    name: 'fisher-ws-server',
    script: 'src/index.js',
    cwd: cwd,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '300M',
    max_restarts: 20,
    restart_delay: 2000,
    kill_timeout: 5000,
    watch: false,
    out_file: path.join(cwd, 'pm2-out.log'),
    error_file: path.join(cwd, 'pm2-err.log'),
    merge_logs: true,
    time: true,
    env: { NODE_ENV: 'production' }
  }]
}
