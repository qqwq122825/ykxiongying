'use strict';

/**
 * 帧节流：限制每个设备的屏幕帧发送频率
 * 最大 30fps = 每帧最小间隔 ~33ms
 */
class FrameThrottle {
  constructor(maxFps = 30) {
    this.minInterval = Math.floor(1000 / maxFps);
    this.lastFrame = new Map(); // deviceId -> timestamp
  }

  /**
   * 检查是否可以发送帧
   * @returns {boolean}
   */
  canSend(deviceId) {
    const now = Date.now();
    const last = this.lastFrame.get(deviceId) || 0;
    if (now - last >= this.minInterval) {
      this.lastFrame.set(deviceId, now);
      return true;
    }
    return false;
  }

  remove(deviceId) {
    this.lastFrame.delete(deviceId);
  }
}

module.exports = { FrameThrottle };
