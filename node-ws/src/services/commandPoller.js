'use strict';

const mysql = require('mysql2/promise');
const config = require('../../config');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      timezone: config.mysql.timezone || '+08:00',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    pool.on('error', (err) => {
      console.error('[CommandPoller] Pool error (caught):', err && err.message ? err.message : err);
    });
  }
  return pool;
}

// ============================================================
// 通用数据库工具：死锁/锁等待自动重试
// MySQL 死锁错误码: 1213 (ER_LOCK_DEADLOCK)
// 锁等待超时错误码: 1205 (ER_LOCK_WAIT_TIMEOUT)
// 用法: await dbWithRetry(() => pool.execute(...), { label: 'xxx' })
// 日志策略（避免日志爆炸）：
//   * 重试 1 次就成功 → 静默
//   * 重试 2+ 次后成功 → 打 1 条 warn（"recovered after N retries"）
//   * 所有重试耗尽还失败 → 打 1 条 error + throw
//   * opts.verbose=true 时才打印每次重试前的详细日志（默认关闭）
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
  const verbose = opts?.verbose === true;
  let lastErr = null;
  let retriedCount = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (retriedCount > 0) {
        console.warn(`[dbWithRetry] ${label} recovered after ${retriedCount} retries`);
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

/**
 * 轮询 pending_commands 表，将命令推送到对应的 bridge/device WS
 */
function startCommandPoller(connections) {
  const interval = config.commandPollInterval || 2000;

  setInterval(async () => {
    try {
      const db = getPool();
      const [rows] = await db.query(
        'SELECT id, device_id, command_json FROM fisher_pending_commands WHERE picked_at IS NULL ORDER BY created_at ASC LIMIT 50'
      );

      if (rows.length === 0) return;

      const ids = rows.map(r => r.id);
      const pickedAt = Math.floor(Date.now() / 1000);
      // 标记为已取走 — 分批小量 + 死锁重试，避免大 IN 列表锁表
      await dbWithRetry(async () => {
        const batchSize = 20;
        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, i + batchSize);
          await db.query('UPDATE fisher_pending_commands SET picked_at = ? WHERE id IN (?)', [pickedAt, batch]);
        }
      }, { label: 'CommandPoller:markPicked', maxRetries: 3 });

      // 按设备分组推送
      const byDevice = {};
      for (const row of rows) {
        if (!byDevice[row.device_id]) byDevice[row.device_id] = [];
        try {
          byDevice[row.device_id].push(JSON.parse(row.command_json));
        } catch {}
      }

      for (const [deviceId, commands] of Object.entries(byDevice)) {
        // 优先发给 bridge
        const bridge = connections.bridges.get(deviceId);
        if (bridge && bridge.ws.readyState === 1) {
          for (const cmd of commands) {
            bridge.ws.send(JSON.stringify(cmd));
          }
          continue;
        }

        // 其次发给 device WS
        const device = connections.devices.get(deviceId);
        if (device && device.ws.readyState === 1) {
          for (const cmd of commands) {
            device.ws.send(JSON.stringify({ type: 'command', sessionId: deviceId, data: cmd }));
          }
        }
      }
    } catch (err) {
      console.error('[CommandPoller] Error:', err.message);
    }
  }, interval);

  console.log(`[CommandPoller] Started, interval=${interval}ms`);
}

module.exports = { startCommandPoller, getPool, dbWithRetry, isDeadlockOrLockWaitError };
