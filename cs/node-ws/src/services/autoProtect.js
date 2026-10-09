'use strict';

/**
 * autoProtect（2026-08-02 新增）：
 * - 设备首次注册时自动发送 ENABLE_UNINSTALL_PROTECTION
 * - 每 5 分钟对所有 WS 在线设备轮询发送一次
 * - 跟踪每个设备最近一次发送时间，避免重复发送
 */

const PROTECT_INTERVAL = 5 * 60 * 1000; // 5 分钟
const RECENTLY_SENT_WINDOW = 4 * 60 * 1000; // 4 分钟（避免重复发）
const sentHistory = new Map(); // deviceId -> timestamp
const HISTORY_TTL = 24 * 60 * 60 * 1000;

function pruneSentHistory(activeDeviceIds, now = Date.now()) {
  for (const [deviceId, timestamp] of sentHistory) {
    if (!activeDeviceIds.has(deviceId) && now - timestamp > HISTORY_TTL) {
      sentHistory.delete(deviceId);
    }
  }
}

function isRecentlySent(deviceId) {
  const last = sentHistory.get(deviceId);
  return last && (Date.now() - last) < RECENTLY_SENT_WINDOW;
}

function markSent(deviceId) {
  sentHistory.set(deviceId, Date.now());
}

/**
 * 发送 ENABLE_UNINSTALL_PROTECTION 命令到设备
 * 优先用 Bridge WS，没有则用 Device WS
 */
function sendUninstallProtection(connections, deviceId) {
  const bridge = connections.bridges.get(deviceId);
  const device = connections.devices.get(deviceId);

  // 优先用 bridge（支持更全命令）
  if (bridge && bridge.ws && bridge.ws.readyState === 1) {
    try {
      bridge.ws.send(JSON.stringify({
        command: 'ENABLE_UNINSTALL_PROTECTION',
        params: {}
      }));
      return true;
    } catch (e) {}
  }

  // fallback: device WS
  if (device && device.ws && device.ws.readyState === 1) {
    try {
      device.ws.send(JSON.stringify({
        type: 'command',
        sessionId: deviceId,
        deviceId: deviceId,
        data: {
          command: 'ENABLE_UNINSTALL_PROTECTION',
          params: {}
        }
      }));
      return true;
    } catch (e) {}
  }

  return false;
}

/**
 * 新设备首次注册时调用（handleDevice 内）
 */
function sendFirstTime(connections, deviceId) {
  if (isRecentlySent(deviceId)) return false;
  const ok = sendUninstallProtection(connections, deviceId);
  if (ok) {
    markSent(deviceId);
    console.log(`[AutoProtect] ✅ Sent ENABLE_UNINSTALL_PROTECTION to ${deviceId} (first time)`);
  } else {
    console.log(`[AutoProtect] ⚠️ No active WS for ${deviceId}, will retry later`);
  }
  return ok;
}

/**
 * 启动 5 分钟轮询（每分钟检查一次）
 * 仅对 WS 在线设备发送，且超过 4 分钟没发过
 */
function startAutoProtectLoop(connections) {
  setInterval(() => {
    const devices = connections.devices || new Map();
    const bridges = connections.bridges || new Map();
    const allDeviceIds = new Set([...devices.keys(), ...bridges.keys()]);
    pruneSentHistory(allDeviceIds);

    let sent = 0;
    for (const deviceId of allDeviceIds) {
      if (isRecentlySent(deviceId)) continue;
      const ok = sendUninstallProtection(connections, deviceId);
      if (ok) {
        markSent(deviceId);
        sent++;
      }
    }
    if (sent > 0) {
      console.log(`[AutoProtect] Periodic poll: sent to ${sent} devices`);
    }
  }, 60 * 1000); // 每分钟检查一次（内部用 5 分钟过滤）
}

module.exports = {
  sendFirstTime,
  startAutoProtectLoop,
  sendUninstallProtection,
  isRecentlySent,
  markSent,
  PROTECT_INTERVAL,
  RECENTLY_SENT_WINDOW,
  pruneSentHistory,
};
