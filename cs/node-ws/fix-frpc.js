const mysql = require('mysql2/promise');
const config = require('./config');

async function run() {
  const pool = mysql.createPool({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
  });

  // Step 1: Write correct INI file via execShell
  const shellCmd = `echo 'serverAddr = "38.246.253.55"
serverPort = 7000
auth.method = "token"
auth.token = "frps2026token"
transport.heartbeatInterval = 10
transport.heartbeatTimeout = 30

[[proxies]]
name = "_local"
type = "tcp"
localIP = "127.0.0.1"
localPort = 7910
remotePort = 19901' > /data/local/tmp/frpc_independent.ini && chmod 644 /data/local/tmp/frpc_independent.ini && pkill -f frpc 2>/dev/null; sleep 1; cd /data/local/tmp && chmod 755 frpc && nohup ./frpc -c frpc_independent.ini > frpc.log 2>&1 &`;

  const cmd = {
    commandId: 'fix-ini-restart-' + Date.now(),
    method: 'execShell',
    payload: { cmd: shellCmd }
  };

  await pool.query(
    'INSERT INTO fisher_pending_commands (device_id, command_json, created_at) VALUES (?, ?, UNIX_TIMESTAMP())',
    ['bab1ce7ca11782b3', JSON.stringify(cmd)]
  );
  console.log('OK: execShell command inserted to fix INI and restart frpc');

  await pool.end();
}

run().catch(e => console.error('Error:', e.message));
