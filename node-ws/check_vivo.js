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
      `SELECT device_id, is_connected, local_service_connected, accessibility_alive, last_seen, FROM_UNIXTIME(last_seen) as readable_time
       FROM fisher_devices
       WHERE device_id = ?
       LIMIT 1`,
      ['cfe498502e2b7210']
    );

    console.log('rows:', rows);

    await conn.end();
  } catch (e) {
    console.error('ERROR:', e.message);
  }
})();