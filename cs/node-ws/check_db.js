const mysql = require('mysql2/promise');
const config = require('./config');

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
    });

    const now = Math.floor(Date.now() / 1000);
    const [rows] = await conn.query(
      `SELECT device_id, app_name, model, brand, is_connected, local_service_connected, accessibility_alive, last_seen, tunnel_deployed, remote_port,
              (? - last_seen) as ago_seconds
       FROM fisher_devices
       WHERE device_id IN (?, ?, ?)
       ORDER BY last_seen DESC`,
      ['cfe498502e2b7210', '70420e047c9e71a7', '4149286562b50b23', now]
    );

    console.log('device_id'.padEnd(20), 'app_name'.padEnd(15), 'model'.padEnd(20), 'is_conn', 'local_svc', 'access', 'ago', 'tunnel');
    console.log('-'.repeat(110));
    for (const r of rows) {
      console.log(
        String(r.device_id).padEnd(20),
        String(r.app_name || '').padEnd(15),
        String(r.model || '').padEnd(20),
        String(r.is_connected).padEnd(8),
        String(r.local_service_connected).padEnd(10),
        String(r.accessibility_alive ?? 'NULL').padEnd(6),
        `${r.ago_seconds}s ago`.padEnd(13),
        r.tunnel_deployed ? `yes(:${r.remote_port})` : 'no'
      );
    }

    await conn.end();
  } catch (e) {
    console.error('ERROR:', e.message);
  }
})();