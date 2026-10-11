// stream-hub.js —— 设备池 + 每设备一个 DeviceUpstream + 内存预算
// 2026-08-05：根据 Claude 5.0 方案实施
'use strict';
const DeviceUpstream = require('./device-upstream');

class StreamHub {
  constructor({ resolveUpstream, idleTimeoutMs = 30000, globalMaxBytes = 512 * 1024 * 1024 }) {
    this.devices = new Map();     // deviceId -> DeviceUpstream
    this.resolveUpstream = resolveUpstream;
    this.idleTimeoutMs = idleTimeoutMs;
    this.globalMaxBytes = globalMaxBytes;

    // 统计
    this.stats = {
      reconnects: 0,
      frames: 0,
    };
  }

  subscribe(deviceId, consumer) {
    let dev = this.devices.get(deviceId);
    if (!dev) {
      dev = new DeviceUpstream({
        deviceId,
        resolveUpstream: this.resolveUpstream,
        // 8 帧 ≈ 1s @ 8fps
      });
      this.devices.set(deviceId, dev);
    }
    if (dev._idleTimer) { clearTimeout(dev._idleTimer); dev._idleTimer = null; }
    dev.subscribe(consumer);

    consumer.once('close', () => {
      dev.unsubscribe(consumer);
      this._maybeIdle(dev);
    });
    return dev;
  }

  unsubscribe(deviceId, consumer) {
    const dev = this.devices.get(deviceId);
    if (dev) dev.unsubscribe(consumer);
  }

  _maybeIdle(dev) {
    if (dev.hasSubscribers()) return;
    if (dev._idleTimer) clearTimeout(dev._idleTimer);
    dev._idleTimer = setTimeout(() => {
      if (!dev.hasSubscribers() && this.devices.get(dev.deviceId) === dev) {
        this.devices.delete(dev.deviceId);
        dev.close();
        this._enforceBudget();
      }
    }, this.idleTimeoutMs);
  }

  _enforceBudget() {
    let total = 0;
    for (const d of this.devices.values()) total += d.bufferedBytes();
    if (total <= this.globalMaxBytes) return;
    // 超预算：按"最久没收到帧"的设备丢弃最旧帧
    const victims = [...this.devices.values()].sort((a, b) => a.lastByteAt - b.lastByteAt);
    for (const d of victims) {
      while (d.frames.length > 1 && total > this.globalMaxBytes) {
        const old = d.frames.shift();
        d.frameBytes -= old.buf.length;
        total -= old.buf.length;
      }
      if (total <= this.globalMaxBytes) break;
    }
  }

  // 监控指标
  getMetrics() {
    const devices = {};
    for (const [id, d] of this.devices) {
      devices[id] = {
        state: d.state,
        subscribers: d.subscribers.size,
        frames: d.frames.length,
        bufferedBytes: d.frameBytes,
        lastFrameAgeMs: d.lastByteAt ? Date.now() - d.lastByteAt : null,
        attempts: d.attempt,
        lastError: d.lastError,
      };
    }
    return {
      devices,
      totalDevices: this.devices.size,
      totalSubscribers: [...this.devices.values()].reduce((s, d) => s + d.subscribers.size, 0),
      totalFrames: this.stats.frames,
      reconnects: this.stats.reconnects,
    };
  }

  closeAll() {
    for (const d of this.devices.values()) d.close();
    this.devices.clear();
  }
}

module.exports = StreamHub;