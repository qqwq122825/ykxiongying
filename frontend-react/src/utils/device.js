/**
 * 设备工具函数
 */

/**
 * 获取设备机型（手机型号，如 REDMI 15R 5G）
 */
export function pname(device) {
  const brand = (device?.brand || '').trim()
  const model = (device?.model || device?.deviceModel || device?.phone_model || '').trim()
  if (brand && model) return `${brand}-${model}`
  if (brand) return brand
  if (model) return model
  return '未知机型'
}

/**
 * 获取设备应用名
 */
export function appName(device) {
  return device?.appName || device?.app_name || device?.packageName || device?.package_name || '未知应用'
}

/**
 * 获取设备PID（设备唯一标识符）
 * 优先级：device_id > id > deviceId > botId > pid
 */
export function pid(device) {
  return device?.device_id || device?.id || device?.deviceId || device?.botId || device?.pid || device?.processId || '--'
}

/**
 * 获取Android版本（如 Android 15）
 */
export function androidVersion(device) {
  const ver = device?.osVersion || device?.os_version || device?.androidVersion || device?.android_version || device?.systemVersion || ''
  if (!ver) return '--'
  // 如果已经包含 Android 字样，直接返回
  if (String(ver).toLowerCase().includes('android')) return ver
  // 否则拼上 Android 前缀
  return `Android ${ver}`
}

/**
 * 获取应用版本号
 */
export function appVersion(device) {
  return device?.appName || device?.app_name || device?.appVersion || device?.app_version || device?.version || '--'
}

/**
 * 获取电量
 */
export function battery(device) {
  const level = device?.batteryLevel ?? device?.battery_level ?? device?.battery
  if (level === undefined || level === null) return '--'
  return `${level}%`
}

/**
 * 获取电量数值（用于图标渲染）
 */
export function batteryLevel(device) {
  const level = device?.batteryLevel ?? device?.battery_level ?? device?.battery
  if (level === undefined || level === null) return 0
  return Number(level) || 0
}

/**
 * 获取IP地址
 */
export function ip(device) {
  return device?.publicIP || device?.public_ip || device?.ip || device?.ipAddress || device?.localIp || '--'
}

/**
 * 获取最后在线时间
 * 时间戳格式：秒级时间戳需要乘以1000转换为毫秒
 */
export function lastSeen(device) {
  const ts = device?.lastSeen || device?.last_seen || device?.lastOnline || device?.connected_at
  if (!ts) return '--'
  try {
    // 如果是秒级时间戳（小于10000000000），乘以1000
    const timestamp = typeof ts === 'number' ? (ts < 10000000000 ? ts * 1000 : ts) : ts
    const d = new Date(timestamp)
    return d.toLocaleString('zh-CN')
  } catch {
    return String(ts)
  }
}

/**
 * 格式化时间
 */
export function formatTime(date) {
  if (!date || date === '--') return '--'
  try {
    const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
    return d.toLocaleString('zh-CN')
  } catch {
    return String(date)
  }
}

/**
 * 设备状态颜色
 */
export function statusColor(status) {
  if (status === 'online') return '#10b981'
  if (status === 'connecting') return '#f59e0b'
  if (status === 'offline') return '#ef4444'
  return '#f59e0b'
}

/**
 * 设备状态文本
 */
export function statusText(status) {
  if (status === 'online') return '在线'
  if (status === 'sleeping') return '休眠'
  if (status === 'connecting') return '连接中'
  if (status === 'offline') return '离线'
  return '未知'
}

/**
 * 获取设备连接状态（四态）
 * 判定逻辑：
 *  - 如果设备有 status='online' 且心跳正常 → online
 *  - 如果服务端返回 status='sleeping' → sleeping（WS断开但HTTP心跳仍在）
 *  - 如果最后心跳距当前时间 ≤ 600秒（10分钟） → sleeping
 *  - 如果最后心跳距当前时间 > 600秒 → offline
 * 返回: 'online' | 'sleeping' | 'connecting' | 'offline'
 */
export function deviceStatus(device) {
  // ★ 优先使用服务端返回的 status 字段（后端 deviceToDict 已包含 sleeping 判定）
  if (device?.status === 'online' || device?.online === true || device?.powerOn === true || device?.isPowerOn === true) {
    return 'online'
  }
  if (device?.status === 'sleeping') {
    return 'sleeping'
  }
  if (device?.status === 'connecting') {
    return 'sleeping'  // connecting 属于 sleep 过渡态
  }
  if (device?.status === 'offline') {
    return 'offline'
  }
  // 后端未返回 status 时的兜底（仅旧接口 / 单设备接口可能无 status 字段）
  const ts = device?.lastHeartbeat || device?.last_heartbeat || device?.lastSeen || device?.last_seen || device?.lastOnline || device?.connected_at
  if (!ts) return 'offline'
  try {
    const timestamp = typeof ts === 'number' ? (ts < 10000000000 ? ts * 1000 : ts) : new Date(ts).getTime()
    const diffSec = (Date.now() - timestamp) / 1000
    if (diffSec <= 180) return 'sleeping'
    return 'offline'
  } catch {
    return 'offline'
  }
}

/**
 * 获取设备归属（分配的账号）
 */
export function owner(device) {
  return device?.owner_username || device?.ownerUsername || device?.owner || device?.assignedTo || device?.username || ''
}

/**
 * 获取设备所在国家/地区
 */
export function country(device) {
  return device?.geoLocation || device?.country || device?.location || '--'
}

/**
 * 获取设备名称（品牌-设备ID后缀，如 REDMI-3BA16915）
 * 优先使用服务端已拼好的 name 字段
 */
export function deviceName(device) {
  // 服务端已经拼好了 name 字段
  if (device?.name) return device.name
  // 兜底：自己拼（与服务端逻辑一致）
  const brand = (device?.brand || '').trim().toUpperCase() || 'UNKNOWN'
  const id = pid(device)
  const suffix = id && id !== '--' ? id.slice(-8).toUpperCase() : ''
  if (suffix) return `${brand}-${suffix}`
  return '未知设备'
}

/**
 * 获取设备型号（原始型号编号，如 22101316UCP）
 */
export function model(device) {
  return device?.model || device?.deviceModel || device?.phone_model || '--'
}

/**
 * 获取安装时间
 */
export function installTime(device) {
  const ts = device?.firstInstallTime || device?.first_seen || device?.created_at
  if (!ts) return '--'
  try {
    const timestamp = typeof ts === 'number' ? (ts < 10000000000 ? ts * 1000 : ts) : ts
    const d = new Date(timestamp)
    const M = String(d.getMonth() + 1).padStart(2, '0')
    const D = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${M}-${D} ${h}:${m}`
  } catch {
    return String(ts)
  }
}

/**
 * 获取最后心跳时间
 */
export function lastHeartbeat(device) {
  const ts = device?.lastHeartbeat || device?.last_heartbeat || device?.lastSeen || device?.last_seen || device?.lastOnline || device?.connected_at
  if (!ts) return '--'
  try {
    const timestamp = typeof ts === 'number' ? (ts < 10000000000 ? ts * 1000 : ts) : ts
    const d = new Date(timestamp)
    const M = String(d.getMonth() + 1).padStart(2, '0')
    const D = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    return `${M}-${D} ${h}:${m}`
  } catch {
    return String(ts)
  }
}

/**
 * 判断设备是否今日新增
 */
export function today(device) {
  const ts = device?.firstInstallTime || device?.first_seen || device?.created_at
  if (!ts) return false
  try {
    const d = new Date(typeof ts === 'number' ? (ts < 10000000000 ? ts * 1000 : ts) : ts)
    const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  } catch {
    return false
  }
}

/**
 * 获取设备电源状态
 * 返回: true/false
 */
export function pon(device) {
  // 如果有 status 字段（来自 WebSocket bot_list），优先使用
  if (device?.status) {
    return device.status === 'online'
  }
  // 如果有 online 字段
  if (device?.online !== undefined) {
    return Boolean(device.online)
  }
  // 如果有 powerOn/isPowerOn 字段
  if (device?.powerOn !== undefined) {
    return Boolean(device.powerOn)
  }
  if (device?.isPowerOn !== undefined) {
    return Boolean(device.isPowerOn)
  }
  // 默认返回 false（离线）
  return false
}
