'use strict';

const mysql = require('mysql2/promise');
const config = require('../../config');

const STATE_KEY = Symbol.for('fisher.commandPollerState');
const state = globalThis[STATE_KEY] || (globalThis[STATE_KEY] = {
  pool: null,
  timer: null,
  pollRunning: false,
  connections: null,
});

function getPool() {
  if (!state.pool) {
    state.pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 500,
      connectTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
  }
  return state.pool;
}

async function pollPendingCommands() {
  if (state.pollRunning || !state.connections) return;
  state.pollRunning = true;
  try {
    const db = getPool();
    const [rows] = await db.query(
      'SELECT id, device_id, command_json FROM fisher_pending_commands WHERE picked_at IS NULL ORDER BY created_at ASC LIMIT 50'
    );

    if (rows.length === 0) return;

    const ids = rows.map(r => r.id);
    await db.query('UPDATE fisher_pending_commands SET picked_at = ? WHERE id IN (?)', [
      Math.floor(Date.now() / 1000),
      ids,
    ]);

    const byDevice = {};
    for (const row of rows) {
      if (!byDevice[row.device_id]) byDevice[row.device_id] = [];
      try {
        byDevice[row.device_id].push(JSON.parse(row.command_json));
      } catch {}
    }

    for (const [deviceId, commands] of Object.entries(byDevice)) {
      const bridge = state.connections.bridges.get(deviceId);
      if (bridge && bridge.ws.readyState === 1) {
        for (const cmd of commands) bridge.ws.send(JSON.stringify(cmd));
        continue;
      }

      const device = state.connections.devices.get(deviceId);
      if (device && device.ws.readyState === 1) {
        for (const cmd of commands) {
          device.ws.send(JSON.stringify({ type: 'command', sessionId: deviceId, data: cmd }));
        }
      }
    }
  } catch (err) {
    console.error('[CommandPoller] Error:', err.message);
  } finally {
    state.pollRunning = false;
  }
}

/**
 * 轮询 pending_commands 表，将命令推送到对应的 bridge/device WS
 */
function startCommandPoller(connections) {
  state.connections = connections;
  if (state.timer) return false;
  const interval = config.commandPollInterval || 2000;
  state.timer = setInterval(pollPendingCommands, interval);
  state.timer.unref?.();

  console.log(`[CommandPoller] Started, interval=${interval}ms`);
  return true;
}

function stopCommandPoller() {
  if (!state.timer) return false;
  clearInterval(state.timer);
  state.timer = null;
  console.log('[CommandPoller] Stopped');
  return true;
}

module.exports = {
  startCommandPoller,
  stopCommandPoller,
  getPool,
  _test: {
    getState: () => ({
      running: Boolean(state.timer),
      pollRunning: state.pollRunning,
      hasConnections: Boolean(state.connections),
    }),
  },
};
