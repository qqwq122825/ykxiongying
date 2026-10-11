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

const IDEMPOTENT_GET_PATHS = [/\/api\/tunnel\/screenshot/, /\/api\/(system|device|apk|file|ai|users)\//, /\/api\/tunnel\/shell$/]
const NON_RETRY_PATHS = [/\/api\/tunnel\/input/, /\/api\/shizuku\/(deploy|repair|stop)/, /\/api\/apk\/build/, /\/api\/file\/(delete|create-folder)/]

function shouldRetryByPath(path, method) {
  if (NON_RETRY_PATHS.some(re => re.test(path))) return false
  if (method && String(method).toUpperCase() !== 'GET' && !IDEMPOTENT_GET_PATHS.some(re => re.test(path))) return false
  return true
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const isStream = path.includes('/minicap/stream') || path.includes('/stream')
  const allowRetry = !isStream && shouldRetryByPath(path, method)
  const maxAttempts = allowRetry ? 2 : 1

  let lastErr = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(1000)
    try {
      const isForm = options.body instanceof FormData
      const headers = { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) }
      const token = getToken()
      if (token) headers.Authorization = `Bearer ${token}`
      let signal = options.signal || null
      if (!signal && !isStream) {
        try { signal = AbortSignal.timeout(30000) } catch (e) { signal = null }
      }
      const fetchOpts = { ...options, headers, method }
      if (signal) fetchOpts.signal = signal
      const res = await fetch(API_BASE + path, fetchOpts)
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
      if (!res.ok || data?.success === false) {
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
        if (allowRetry && attempt < maxAttempts - 1 && (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 0)) {
          lastErr = new Error(cleanMessage(data?.error || data?.message, res.status, path))
          continue
        }
        throw new Error(cleanMessage(data?.error || data?.message, res.status, path))
      }
      return data
    } catch (err) {
      const isTimeout = err && (err.name === 'TimeoutError' || (err.message && (err.message.includes('timeout') || err.message.includes('aborted'))))
      if (allowRetry && attempt < maxAttempts - 1 && (isTimeout || (err && (err.message || '').includes('NetworkError')))) {
        lastErr = isTimeout ? new Error('请求超时，隧道可能抖动，请稍后重试') : err
        continue
      }
      if (isTimeout) throw new Error('请求超时，隧道可能抖动，请稍后重试')
      throw err
    }
  }
  throw lastErr || new Error('请求失败')
}

const qs = (obj={}) => new URLSearchParams(Object.entries(obj).filter(([,v]) => v !== undefined && v !== '')).toString()

 export const api = {
   request: request,
   login: (username, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
   verifyTelegram: (challengeId, code) => request('/api/auth/login-telegram-verify', { method: 'POST', body: JSON.stringify({ challengeId, code }) }),
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
  // ✅ AI 配置（3接口：获取/保存/测试）
  getAiConfig: () => request('/api/ai/config'),
  updateAiConfig: (payload) => request('/api/ai/config', { method: 'PUT', body: JSON.stringify(payload) }),
  testAiConfig: (payload) => request('/api/ai/config/test', { method: 'POST', body: JSON.stringify(payload) }),
}



