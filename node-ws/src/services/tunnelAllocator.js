'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { getPool, dbWithRetry } = require('./commandPoller');

const MIN_REMOTE_PORT = 19902;
const MAX_REMOTE_PORT = 29999;
const allocationInFlight = new Map();
const TUNNEL_LOG_FILE = path.join(__dirname, '../../tunnel-allocation.log');

function writeTunnelLog(event, details = {}) {
  const record = {
    time: new Date().toISOString(),
    event,
    ...details,
  };
  try {
    fs.appendFileSync(TUNNEL_LOG_FILE, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    console.error(`[TunnelLog] write failed: ${err.message}`);
  }
  return record;
}

async function allocateRemotePort(deviceId) {
  writeTunnelLog('allocation_start', { deviceId, minPort: MIN_REMOTE_PORT, maxPort: MAX_REMOTE_PORT });
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT remote_port FROM fisher_devices WHERE device_id = ? FOR UPDATE',
      [deviceId]
    );
    const currentPort = Number(rows[0]?.remote_port || 0);
    writeTunnelLog('db_row_locked', { deviceId, currentPort });
    if (currentPort >= MIN_REMOTE_PORT && currentPort <= MAX_REMOTE_PORT) {
      await conn.commit();
      writeTunnelLog('allocation_reused', { deviceId, remotePort: currentPort });
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
    const finalPort = Number(finalRows[0]?.remote_port || port);
    writeTunnelLog('allocation_assigned', { deviceId, requestedPort: port, remotePort: finalPort });
    return finalPort;
  } catch (err) {
    try { await conn.rollback(); } catch {}
    writeTunnelLog('allocation_failed', { deviceId, error: err.message });
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

async function ensureTunnelAllocated(deviceId, ws, trigger = 'unknown') {
  if (!deviceId) return null;
  writeTunnelLog('ensure_requested', {
    deviceId,
    trigger,
    wsReadyState: ws ? ws.readyState : null,
    wsOpen: Boolean(ws && ws.readyState === 1),
  });
  if (!allocationInFlight.has(deviceId)) {
    allocationInFlight.set(deviceId, dbWithRetry(
      () => allocateRemotePort(deviceId),
      { label: `ensureTunnelAllocated:${String(deviceId).substring(0, 12)}`, maxRetries: 3 }
    ).finally(() => allocationInFlight.delete(deviceId)));
  }

  try {
    const remotePort = await allocationInFlight.get(deviceId);
    const tunnelConfig = buildTunnelConfig(deviceId, remotePort);
    writeTunnelLog('config_ready', {
      deviceId,
      trigger,
      remotePort,
      proxyName: tunnelConfig.proxyName,
      frpsHost: tunnelConfig.frpsHost,
      frpsPort: tunnelConfig.frpsPort,
      wsReadyState: ws ? ws.readyState : null,
    });
    if (ws && ws.readyState === 1) {
      writeTunnelLog('config_push_attempt', { deviceId, trigger, remotePort, proxyName: tunnelConfig.proxyName });
      ws.send(JSON.stringify({
        type: 'tunnel_config',
        sessionId: deviceId,
        deviceId,
        data: tunnelConfig,
      }));
      writeTunnelLog('config_push_sent', { deviceId, trigger, remotePort, proxyName: tunnelConfig.proxyName });
      console.log(`[WS-Device] pushed tunnel_config to ${String(deviceId).substring(0, 12)}... remotePort=${remotePort}`);
    } else {
      writeTunnelLog('config_push_skipped_ws_closed', { deviceId, trigger, remotePort, wsReadyState: ws ? ws.readyState : null });
    }
    return tunnelConfig;
  } catch (err) {
    writeTunnelLog('ensure_failed', { deviceId, trigger, error: err.message });
    throw err;
  }
}

module.exports = { ensureTunnelAllocated, buildTunnelConfig, writeTunnelLog, TUNNEL_LOG_FILE };
