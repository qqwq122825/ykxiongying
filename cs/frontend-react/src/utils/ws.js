/**
 * WebSocket 工具函数
 */

/**
 * 获取 WebSocket URL
 * @param {string} token - JWT token
 * @returns {string} WebSocket URL
 */
export function getPanelWsUrl(token) {
  // 开发环境（Vite dev server port 5173）
  if (/^517\d$/.test(location.port)) {
    const backend = `${location.protocol}//${location.hostname}:8888`
    const wsBase = backend.replace(/^http/, 'ws').replace(/\/$/, '')
    return `${wsBase}/ws/panel?token=${encodeURIComponent(token)}`
  }

  // 生产环境：使用 localStorage 中配置的服务器地址，或当前域名
  const serverUrl = localStorage.getItem('fc_server_url') || ''
  if (serverUrl) {
    const wsBase = serverUrl.replace(/^http/, 'ws').replace(/\/$/, '')
    return `${wsBase}/ws/panel?token=${encodeURIComponent(token)}`
  }

  // 默认使用当前域名
  const wsBase = location.origin.replace(/^http/, 'ws')
  return `${wsBase}/ws/panel?token=${encodeURIComponent(token)}`
}

/**
 * 获取设备 WebSocket URL
 * @param {string} token - JWT token
 * @param {string} deviceId - 设备 ID
 * @returns {string} 设备 WebSocket URL
 */
export function getDeviceWsUrl(token, deviceId) {
  const wsBase = getPanelWsUrl(token).split('?')[0]
  return `${wsBase}?token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(deviceId)}`
}
