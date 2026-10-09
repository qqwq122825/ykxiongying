const API_BASE = ''

export function getToken() { return localStorage.getItem('auth_token') || localStorage.getItem('token') || localStorage.getItem('fc_token') || '' }
export function setToken(token) {
  if (token) {
    localStorage.setItem('auth_token', token)
    localStorage.setItem('token', token)
    localStorage.setItem('fc_token', token)
  } else {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('token')
    localStorage.removeItem('fc_token')
  }
}

function cleanMessage(message, status, path) {
  const s = String(message || '')
  if (path.includes('/api/auth/login') && status === 401) return '用户名或密码错误'
  if (s.includes('ç') || s.includes('æ') || s.includes('å') || s.includes('è')) {
    if (path.includes('/api/auth/login')) return '用户名或密码错误'
    if (s.includes('Token')) return '登录已过期，请重新登录'
    return '操作失败，请稍后重试'
  }
  return s || `HTTP ${status}`
}

export async function request(path, options = {}) {
  const isForm = options.body instanceof FormData
  const headers = { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(API_BASE + path, { ...options, headers })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok || data?.success === false) {
    // 账号被禁用或 token 失效时自动登出
    if ((res.status === 401 || res.status === 403) && !path.includes('/api/auth/login')) {
      const msg = data?.message || ''
      if (msg.includes('禁用') || msg.includes('disabled') || res.status === 401) {
        setToken(null)
        if (typeof window !== 'undefined' && !window.__fc_redirecting) {
          window.__fc_redirecting = true
          alert(msg || '登录已过期，请重新登录')
          window.location.href = '/login'
        }
      }
    }
    throw new Error(cleanMessage(data?.error || data?.message, res.status, path))
  }
  return data
}

const qs = (obj={}) => new URLSearchParams(Object.entries(obj).filter(([,v]) => v !== undefined && v !== '')).toString()

 export const api = {
   request: request,
   login: (username, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
   bridgeCommand: (deviceId, payload) => request(`/api/bridge/command/${encodeURIComponent(deviceId)}`, { method: 'POST', body: JSON.stringify(payload) }),
  verify: () => request('/api/auth/verify'),
  systemInfo: () => request('/api/system/info'),
  devices: () => request('/api/device/list'),
  deleteDevice: (id) => request(`/api/device/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  assignDevice: (id, username) => request(`/api/device/${encodeURIComponent(id)}/assign`, { method: 'PUT', body: JSON.stringify({ username }) }),
  deviceGroups: () => request('/api/device/groups'),
  users: () => request('/api/users'),
  loginLogs: () => request('/api/users/login-logs'),
  clearLoginLogs: () => request('/api/users/login-logs', { method: 'DELETE' }),
  apkInfo: () => request('/api/apk/info'),
  apkList: () => request('/api/apk/list'),
  buildStatus: () => request('/api/apk/build-status'),
  buildLogs: () => request('/api/apk/build-logs'),
  buildHistory: () => request('/api/apk/build-history'),
  buildApk: (payload) => request('/api/apk/build', { method: 'POST', body: JSON.stringify(payload) }),
  deleteApk: (filename) => request('/api/apk/delete', { method: 'POST', body: JSON.stringify({ filename }) }),
  fileList: (deviceId, path = '/') => request(`/api/file/list?${qs({ deviceId, path })}`),
  fileSearch: (deviceId, path='/', keyword='') => request(`/api/file/search?${qs({ deviceId, path, keyword })}`),
  fileDelete: (deviceId, path) => request('/api/file/delete', { method:'POST', body: JSON.stringify({ deviceId, path }) }),
  fileMkdir: (deviceId, path, name) => request('/api/file/create-folder', { method:'POST', body: JSON.stringify({ deviceId, path, name }) }),
  updateRemark: (id, remark) => request(`/api/device/${encodeURIComponent(id)}/remark`, { method: 'PUT', body: JSON.stringify({ remark }) }),
}



