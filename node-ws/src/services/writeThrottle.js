'use strict';

// ============================================================
// 内存级写操作去抖：降低对 fisher_devices 单行 UPDATE 的频率
//   适用场景：last_seen 心跳刷新、battery/network 等高频上报
//   原理：同一 device_id + 同一 key（如 last_seen），在 N 毫秒内重复写直接跳过
//   收益：减少 60%+ 的无意义 UPDATE → 大幅降低行锁争用 → 死锁概率骤降
// ============================================================

const _cache = new Map(); // compositeKey (deviceId + '|' + key) -> lastWriteMs
const _defaults = {
  last_seen:     10000, // 10 秒：同一设备 last_seen 刷盘节流（心跳 30s，但 syncDeviceStatus 上报也会写）
  status_meta:   5000,  // 5  秒：battery/network/screen 等元信息合并
  public_ip:    60000,  // 60 秒：公网 IP 变化不频繁
};

function _now() { return Date.now(); }

/**
 * 判断是否允许写入（通过后会立即标记，下次在窗口内直接拒绝）
 * @param {string} deviceId
 * @param {string} key      last_seen | status_meta | public_ip
 * @param {number} [customMs] 可选自定义窗口（毫秒）
 * @returns {boolean} true=允许写 DB，false=跳过
 */
function allowWrite(deviceId, key, customMs) {
  if (!deviceId || !key) return true;
  const windowMs = customMs || _defaults[key] || 5000;
  const ck = deviceId + '|' + key;
  const now = _now();
  const last = _cache.get(ck);
  if (last && (now - last) < windowMs) return false;
  _cache.set(ck, now);
  return true;
}

/**
 * 手动标记某个 key 为已写（syncDeviceStatus 这种一次写多字段时用）
 */
function markWritten(deviceId, keys) {
  if (!deviceId) return;
  const now = _now();
  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) {
    if (!k) continue;
    _cache.set(deviceId + '|' + k, now);
  }
}

/**
 * 清理长期无活动的缓存条目（避免 device 下线后条目泄漏；每 10 分钟调一次即可）
 */
function cleanup() {
  const cutoff = _now() - 2 * 60 * 60 * 1000; // 2 小时前
  let removed = 0;
  for (const [ck, ts] of _cache.entries()) {
    if (ts < cutoff) { _cache.delete(ck); removed++; }
  }
  return removed;
}

// 60 分钟自动清理一次（.unref() 防止阻止进程退出）
const _cleanupTimer = setInterval(() => {
  try {
    const n = cleanup();
    if (n > 0) console.log(`[writeThrottle] cleanup: removed ${n} stale entries`);
  } catch (e) { /* ignore */ }
}, 60 * 60 * 1000);
_cleanupTimer.unref && _cleanupTimer.unref();

module.exports = { allowWrite, markWritten, cleanup };
