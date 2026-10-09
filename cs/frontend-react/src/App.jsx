import { useEffect, useState, useRef } from 'react'
import { api, setToken, getToken } from './api/client'
import { getPanelWsUrl } from './utils/ws'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

function useWs(user) {
  const wsRef = useRef(null)
  const pingRef = useRef(null)
  const reconnectRef = useRef(null)
  const intentionalCloseRef = useRef(false)
  const attemptRef = useRef(0)

  useEffect(() => {
    if (!user) return

    const token = getToken()
    if (!token) return

    intentionalCloseRef.current = false
    attemptRef.current = 0

    function clearTimers() {
      clearInterval(pingRef.current)
      clearTimeout(reconnectRef.current)
      pingRef.current = null
      reconnectRef.current = null
    }

    function connect() {
      clearTimers()

      const ws = new WebSocket(getPanelWsUrl(token))
      wsRef.current = ws

      ws.onopen = () => {
        attemptRef.current = 0
        ws.send(JSON.stringify({ type: 'get_bot_list' }))
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }))
          }
        }, 20000)
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'pong') return
          if (msg.type === 'device_update' && typeof window.__refreshDevices === 'function') {
            window.__refreshDevices()
          }
        } catch {
          /* ignore malformed messages */
        }
      }

      ws.onclose = () => {
        clearInterval(pingRef.current)
        pingRef.current = null
        if (intentionalCloseRef.current || !getToken()) return

        const delay = Math.min(30000, 2000 * (2 ** attemptRef.current))
        attemptRef.current += 1
        reconnectRef.current = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      intentionalCloseRef.current = true
      clearTimers()
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [user])
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  useWs(user)

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api.verify()
      .then((r) => setUser(r.data?.user || r.user))
      .catch(() => setToken(''))
      .finally(() => setLoading(false))
  }, [])

  async function handleLogin(username, password) {
    const r = await api.login(username, password)
    const data = r.data || r
    setToken(data.token)
    // 登录后立即 verify 获取完整用户信息（含 permissions）
    try {
      const v = await api.verify()
      setUser(v.data?.user || v.user || data.user)
    } catch {
      setUser(data.user)
    }
  }

  function logout() {
    setToken('')
    setUser(null)
  }

  if (loading) {
    return (
      <div className="boot">
        <div className="loader">
          <div className="loader-dot" />
          <div className="loader-dot" />
          <div className="loader-dot" />
        </div>
        <div className="boot-text">正在加载</div>
      </div>
    )
  }

  return user ? <Dashboard user={user} onLogout={logout} /> : <Login onLogin={handleLogin} />
}
