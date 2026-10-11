'use strict';

const config = require('../../config');
const { getPool, dbWithRetry } = require('./commandPoller');

const MIN_REMOTE_PORT = 19902;
const MAX_REMOTE_PORT = 29999;
const allocationInFlight = new Map();

async function allocateRemotePort(deviceId) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT remote_port FROM fisher_devices WHERE device_id = ? FOR UPDATE',
      [deviceId]
    );
    const currentPort = Number(rows[0]?.remote_port || 0);
    if (currentPort >= MIN_REMOTE_PORT && currentPort <= MAX_REMOTE_PORT) {
      await conn.commit();
      return currentPort;
    }

    const [maxRows] = await conn.execute(
      'SELECT MAX(remote_port) AS max_port FROM fisher_devices WHERE remote_port >= ? AND remote_port <= ? FOR UPDATE',
      [MIN_REMOTE_PORT, MAX_REMOTE_PORT]
    );
    let port = Math.max(MIN_REMOTE_PORT, Number(maxRows[0]?.max_port || MIN_REMOTE_PORT - 1) + 1);
    while (port <= MAX_REMOTE_PORT) {
      const [occupied] = await conn.execute(
        'SELECT COUNT(*) AS count FROM fisher_devices WHERE remote_port = ? AND device_id <> ?',
        [port, deviceId]
      );
      if (Number(occupied[0]?.count || 0) === 0) break;
      port += 1;
    }
    if (port > MAX_REMOTE_PORT) throw new Error(`no available ports (${MIN_REMOTE_PORT}-${MAX_REMOTE_PORT})`);

    const now = Math.floor(Date.now() / 1000);
    await conn.execute(
      `INSERT INTO fisher_devices
         (device_id, remote_port, tunnel_deployed, is_connected, last_seen, first_seen, created_at)
       VALUES (?, ?, 1, 1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         remote_port = IF(remote_port >= ?, remote_port, VALUES(remote_port)),
         tunnel_deployed = 1,
         is_connected = 1,
         last_seen = VALUES(last_seen)`,
      [deviceId, port, now, now, now, MIN_REMOTE_PORT]
    );
    await conn.commit();

    const [finalRows] = await pool.execute(
      'SELECT remote_port FROM fisher_devices WHERE device_id = ? LIMIT 1',
      [deviceId]
    );
    return Number(finalRows[0]?.remote_port || port);
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

function buildTunnelConfig(deviceId, remotePort) {
  return {
    frpsHost: config.frps.addr,
    frpsPort: config.frps.port,
    frpsToken: config.frps.token,
    remotePort,
    proxyName: `tunnel_${String(deviceId).substring(0, 8)}`,
  };
}

async function ensureTunnelAllocated(deviceId, ws) {
  if (!deviceId) return null;
  if (!allocationInFlight.has(deviceId)) {
    allocationInFlight.set(deviceId, dbWithRetry(
      () => allocateRemotePort(deviceId),
      { label: `ensureTunnelAllocated:${String(deviceId).substring(0, 12)}`, maxRetries: 3 }
    ).finally(() => allocationInFlight.delete(deviceId)));
  }

  const remotePort = await allocationInFlight.get(deviceId);
  const tunnelConfig = buildTunnelConfig(deviceId, remotePort);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'tunnel_config',
      sessionId: deviceId,
      deviceId,
      data: tunnelConfig,
    }));
    console.log(`[WS-Device] pushed tunnel_config to ${String(deviceId).substring(0, 12)}... remotePort=${remotePort}`);
  }
  return tunnelConfig;
}

module.exports = { ensureTunnelAllocated, buildTunnelConfig };
