import React from 'react'
import { createRoot } from 'react-dom/client'
import { useEffect, useState, useRef } from 'react'
import App from './App.jsx'
import ControlPage from './pages/ControlPage.jsx'
import ComponentShowcase from './pages/ComponentShowcase.jsx'
import { api, getToken, setToken } from './api/client'
import './styles/design-tokens.css'
import './styles/components.css'
import './styles/global.css'
import './styles/login.css'
import './styles/dashboard.css'
import './styles/theme-pages.css'
import './styles/node-injection-fixes.css'
import './styles/control-page.css'

// ★ 2026-08-06：默认 dark（夜间护眼），用户切 light 才进白天
const __savedTheme = localStorage.getItem('fc_theme')
if (__savedTheme === 'light') {
  document.documentElement.setAttribute('data-theme', 'light')
} else if (__savedTheme === 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark')
  document.documentElement.classList.add('dark')
} else {
  // 默认 dark：深蓝渐变 + 青绿强调（护眼）
  document.documentElement.setAttribute('data-theme', 'dark')
  document.documentElement.classList.add('dark')
  localStorage.setItem('fc_theme', 'dark')
}

const params = new URLSearchParams(window.location.search)
const isControlPage = params.get('page') === 'control' || params.has('controlDeviceId') || params.has('deviceId') || params.has('device_id')
const isShowcasePage = params.get('page') === 'showcase'

/**
 * 检查当前用户是否有权限控制该设备
 * - admin 角色可以控制所有设备
 * - 普通用户只能控制 owner_username 等于自己的设备
 */
function DeviceAuthGate() {
  const [state, setState] = useState('checking') // checking | allowed | denied | no_token
  const [user, setUser] = useState(null)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setState('no_token')
      return
    }

    // 先验证 token，获取用户信息
    api.verify()
      .then((r) => {
        const userData = r.data?.user || r.user
        setUser(userData)

        // admin 角色直接放行（兼容 admin/superadmin/super-admin 多种角色值）
        if (userData?.role === 'admin' || userData?.role === 'superadmin' || userData?.role === 'super-admin') {
          setState('allowed')
          return
        }

        // 非 admin 用户：检查设备归属
        const deviceId = params.get('controlDeviceId') || params.get('deviceId') || params.get('device_id') || ''
        if (!deviceId) {
          setState('denied')
          return
        }

        // 查询设备详情，检查 owner_username
        return api.request(`/api/device/${encodeURIComponent(deviceId)}`)
          .then((res) => {
            const deviceData = res.data || res
            const deviceOwner = deviceData?.ownerUsername || deviceData?.owner_username || ''
            const currentUser = userData?.username || ''

            if (deviceOwner && deviceOwner !== currentUser) {
              console.warn(`[AUTH] 权限拒绝：设备归属 ${deviceOwner}，当前用户 ${currentUser}`)
              setState('denied')
            } else if (!deviceOwner) {
              // 设备无归属（未分配），非admin用户不能操作
              console.warn(`[AUTH] 权限拒绝：设备未分配归属，非admin用户不能操作`)
              setState('denied')
            } else {
              setState('allowed')
            }
          })
          .catch(() => {
            // 查询失败（设备不存在等），显示设备不存在
            setState('denied')
          })
      })
      .catch(() => {
        setToken('')
        setState('no_token')
      })
  }, [])

  if (state === 'checking') {
    return <div className="boot"><div className="boot-text">正在验证登录状态</div></div>
  }

  if (state === 'denied') {
    return <DeviceNotFoundNotice />
  }

  if (state === 'no_token') {
    return <App />
  }

  return <ControlPage user={user} />
}

/**
 * 设备不存在/无权限提示页 — 美化版，带 3 秒倒计时自动跳转首页
 */
function DeviceNotFoundNotice() {
  const [countdown, setCountdown] = useState(3)

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          window.location.href = '/'
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#0f0f1a',
      color: '#e2e8f0',
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    }}>
      <div style={{
        textAlign: 'center',
        padding: '48px 40px',
        borderRadius: 16,
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        border: '1px solid rgba(239,68,68,0.15)',
        maxWidth: 400,
        width: '90%',
      }}>
        {/* 图标 */}
        <div style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: 'rgba(239,68,68,0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>

        {/* 标题 */}
        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          margin: '0 0 8px',
          color: '#f1f5f9',
        }}>
          该设备不存在
        </h1>

        {/* 描述 */}
        <p style={{
          fontSize: 14,
          color: '#94a3b8',
          margin: '0 0 28px',
          lineHeight: 1.6,
        }}>
          设备可能已离线、被删除，或不属于你的账号
        </p>

        {/* 倒计时条 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          marginBottom: 4,
        }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>即将返回首页</span>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: 8,
            background: 'rgba(96,165,250,0.15)',
            color: '#60a5fa',
            fontSize: 15,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {countdown}
          </span>
        </div>

        {/* 进度条 */}
        <div style={{
          width: '100%',
          height: 3,
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 2,
          overflow: 'hidden',
          margin: '10px 0 24px',
        }}>
          <div style={{
            height: '100%',
            width: `${((3 - countdown) / 3) * 100}%`,
            background: 'linear-gradient(90deg, #60a5fa, #3b82f6)',
            borderRadius: 2,
            transition: 'width 1s linear',
          }} />
        </div>

        {/* 手动返回链接 */}
        <a
          href="/"
          onClick={(e) => { e.preventDefault(); window.location.href = '/' }}
          style={{
            display: 'inline-block',
            fontSize: 13,
            color: '#60a5fa',
            textDecoration: 'none',
            padding: '6px 16px',
            borderRadius: 6,
            background: 'rgba(96,165,250,0.08)',
            transition: 'background 0.2s',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => e.target.style.background = 'rgba(96,165,250,0.15)'}
          onMouseLeave={(e) => e.target.style.background = 'rgba(96,165,250,0.08)'}
        >
          立即返回首页 &rarr;
        </a>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  isShowcasePage ? <ComponentShowcase /> : (isControlPage ? <DeviceAuthGate /> : <App />)
)
