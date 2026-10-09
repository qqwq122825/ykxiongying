'use strict';

const config = require('../../config');

/**
 * KeepAlive 精简版（2026-08-04）：
 * - 去除所有 ping/pong 假活检测（设备端不支持 pong，且不需要主动踢连接）
 * - 仅清理 readyState 异常的连接（真正断开的）
 * - 保留 grace period（设备断开后 30 分钟内视为在线，等待重连）
 * - 目标：最大化设备在线时间，不主动 terminate 任何连接
 */
const GRACE_PERIOD_MS = 30 * 60 * 1000;  // ★ 2026-08-06：30 分钟（最大化保活，4G 抖动宽容）
// Keep only scalar metadata here. Retaining a connection object also retains its
// cleanup closure, WebSocket, timers and pending work for the full grace period.
const RECONNECT_GRACE = new Map();  // deviceId -> { disconnectedAt: timestamp, pool: 'devices'|'bridges'|'admins' }

function markGracePeriod(deviceId, pool, disconnectedAt = Date.now()) {
  if (RECONNECT_GRACE.has(deviceId)) return false;
  RECONNECT_GRACE.set(deviceId, { disconnectedAt, pool });
  return true;
}

function sweepKeepAlive(connections, now = Date.now()) {
  let totalCleaned = 0;
  let totalTerminated = 0;

  for (const [deviceId, info] of RECONNECT_GRACE.entries()) {
    if (now - info.disconnectedAt > GRACE_PERIOD_MS) {
      RECONNECT_GRACE.delete(deviceId);
      console.log(`[KeepAlive] Reconnect grace expired for ${deviceId} (pool=${info.pool})`);
    }
  }

  for (const [key, pool] of Object.entries(connections)) {
    if (!(pool instanceof Map)) continue;
    if (pool.size > 500) {
      console.warn(`[KeepAlive] WARNING: ${key} pool has ${pool.size} entries (limit 500)`);
    }

    for (const [id, conn] of pool.entries()) {
      if (conn.ws && conn.ws.readyState === 1) continue;

      if (conn.ws && typeof conn.ws.terminate === 'function') {
        try {
          conn.ws.terminate();
          totalTerminated++;
        } catch (e) {
          console.error(`[KeepAlive] terminate error for ${key} ${id}: ${e.message}`);
        }
      }
      if (markGracePeriod(id, key, now)) {
        console.log(`[KeepAlive] ${key} ${id} disconnected, grace ${GRACE_PERIOD_MS / 60000}min`);
      }
      // The close handler normally owns deletion. The identity check prevents an
      // old connection from deleting a replacement that arrived during terminate().
      if (pool.get(id) === conn) pool.delete(id);
      totalCleaned++;
    }
  }

  if (totalCleaned > 0) {
    console.log(`[KeepAlive] Cleaned ${totalCleaned} dead connections (terminated ${totalTerminated})`);
  }
  return { totalCleaned, totalTerminated };
}

function startKeepAlive(connections) {
  const interval = 30000; // 30 秒检查一次

  setInterval(() => {
    sweepKeepAlive(connections);
  }, interval);

  console.log(`[KeepAlive] Started (no-terminate mode), interval=${interval/1000}s, grace=${GRACE_PERIOD_MS/1000}s`);
}

/**
 * 检查设备是否在 grace period 内（WS 断开但还在 30 分钟缓冲期）
 */
function isInGracePeriod(deviceId) {
  return RECONNECT_GRACE.has(deviceId);
}

/**
 * 获取设备断开时间
 */
function getDisconnectedAt(deviceId) {
  const info = RECONNECT_GRACE.get(deviceId);
  return info ? info.disconnectedAt : null;
}

/**
 * 获取 grace period 中设备所属的连接池类型
 */
function getGracePool(deviceId) {
  const info = RECONNECT_GRACE.get(deviceId);
  return info ? info.pool : null;
}

/**
 * 获取所有在 grace period 中的设备列表（按 pool 分类）
 */
function getGraceDevicesByPool() {
  const result = { devices: [], bridges: [] };
  for (const [deviceId, info] of RECONNECT_GRACE.entries()) {
    if (info.pool === 'devices') result.devices.push(deviceId);
    else if (info.pool === 'bridges') result.bridges.push(deviceId);
  }
  return result;
}

/**
 * WS 重连时调用：清除 grace period（设备重新连接了）
 */
function clearGracePeriod(deviceId) {
  return RECONNECT_GRACE.delete(deviceId);
}

module.exports = {
  startKeepAlive,
  isInGracePeriod,
  getDisconnectedAt,
  getGracePool,
  getGraceDevicesByPool,
  clearGracePeriod,
  _test: {
    markGracePeriod,
    sweepKeepAlive,
    getGraceEntry: deviceId => RECONNECT_GRACE.get(deviceId),
    resetGracePeriods: () => RECONNECT_GRACE.clear(),
  },
};
