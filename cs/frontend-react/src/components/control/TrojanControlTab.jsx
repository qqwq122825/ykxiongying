/**
 * 木马控制Tab - 双手机面板 + 控制面板
 * 从 ControlPage.jsx 提取
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { toast, centerToast } from '../../utils/toast'
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
  const apiBase = window.location.origin
  const parseJsonResponse = useCallback(async (res) => {
    const text = await res.text()
    try {
      return text ? JSON.parse(text) : {}
    } catch {
      const brief = text.replace(/\s+/g, ' ').slice(0, 120)
      return { success: false, error: `接口返回非JSON(${res.status})：${brief || res.statusText}` }
    }
  }, [])

  // ★ sendTunnelInput 内部直接调用 bumpPolling 逻辑（避免 useCallback 循环依赖）
  const sendTunnelInput = useCallback(async (action, params) => {
    // 调用 bumpPollingRef（forward ref，避免 useCallback 循环依赖）
    if (bumpPollingRef.current) bumpPollingRef.current()
    try {
      const token = localStorage.getItem('token') || ''
      const res = await fetch(`${apiBase}/api/tunnel/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, params, deviceId: resolvedDeviceId })
      })
      return await parseJsonResponse(res)
    } catch (e) {
      return { success: false, error: e.message }
    }
  }, [resolvedDeviceId, parseJsonResponse, apiBase])
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
      const res = await fetch(`${apiBase}/api/tunnel/screenshot?deviceId=${encodeURIComponent(resolvedDeviceId)}&t=${Date.now()}`, {
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
    // ★ 请求去重：上一次未完成时跳过
    if (readerInFlightRef.current) return
    readerInFlightRef.current = true
    try {
      const token = localStorage.getItem('token') || ''
      const res = await fetch(`${apiBase}/api/tunnel/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cmd: 'uiautomator dump /dev/stdout', deviceId: resolvedDeviceId })
      })
      const result = await parseJsonResponse(res)
      const output = result?.data?.output || result?.output || result?.stdout || result?.result || ''
      if (output && output.includes('<')) {
        const xmlStart = output.indexOf('<?xml')
        const xmlContent = xmlStart >= 0 ? output.substring(xmlStart) : output
        const parsed = parseHierarchyXml(xmlContent)
        if (parsed) setHttpReaderData(parsed)
        else setHttpReaderData(xmlContent)
      }
    } catch (e) {
      addLog(`阅读器数据获取失败: ${e.message}`)
    } finally {
      readerInFlightRef.current = false
    }
  }, [resolvedDeviceId, addLog, parseJsonResponse, apiBase])

  const fetchReaderAfterAction = useCallback(() => {
    fetchReaderData()
  }, [fetchReaderData])

  const sendTunnelShell = useCallback(async (cmd) => {
    try {
      const token = localStorage.getItem('token') || ''
      const res = await fetch(`${apiBase}/api/tunnel/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cmd, deviceId: resolvedDeviceId })
      })
      return await parseJsonResponse(res)
    } catch (e) {
      return { success: false, error: e.message }
    }
  }, [resolvedDeviceId, parseJsonResponse, apiBase])

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

  // ★ bumpPolling：智能轮询调度器（仅作用于阅读器；投屏已改用 minicap MJPEG 流）
  const bumpPolling = useCallback(() => {
    // 立即触发一次 dump（点击后不等 1000ms idle 周期）
    if (httpReaderActive) fetchReaderData()
    // 切到 500ms 高频（无论之前是 idle 还是 active）
    pollingModeRef.current = 'active'
    if (readerIntervalRef.current && httpReaderActive) {
      clearInterval(readerIntervalRef.current)
      readerIntervalRef.current = setInterval(fetchReaderData, POLL_ACTIVE)
    }
    // 2 秒后回 idle
    if (pollingActiveTimerRef.current) clearTimeout(pollingActiveTimerRef.current)
    pollingActiveTimerRef.current = setTimeout(() => {
      pollingModeRef.current = 'idle'
      if (readerIntervalRef.current && httpReaderActive) {
        clearInterval(readerIntervalRef.current)
        readerIntervalRef.current = setInterval(fetchReaderData, POLL_IDLE)
      }
      pollingActiveTimerRef.current = null
    }, POLL_ACTIVE_DURATION)
  }, [fetchReaderData, httpReaderActive])

  // ★ bumpPolling 在 sendTunnelInput（定义在更早）中也能被调用（forward ref）
  bumpPollingRef.current = bumpPolling

  const toggleHttpReader = useCallback(() => {
    if (httpReaderActive) {
      setHttpReaderActive(false)
      setHttpReaderLoading(false)
      if (readerIntervalRef.current) { clearInterval(readerIntervalRef.current); readerIntervalRef.current = null }
      addLog('HTTP阅读: 已关闭')
    } else {
      setHttpReaderActive(true)
      setHttpReaderLoading(true)
      setHttpReaderData(null)
      addLog('HTTP阅读: 连接中...')
      fetchReaderData().finally(() => setHttpReaderLoading(false))
      bumpPolling()
      readerIntervalRef.current = setInterval(fetchReaderData, POLL_IDLE)
    }
  }, [httpReaderActive, fetchReaderData, addLog, bumpPolling])

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
  const panelStyle = { background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 6, padding: '6px 4px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 130 }
  const panelTitle = { fontSize: 12, fontWeight: 600, color: '#e0e0e0', marginBottom: 4, textAlign: 'center', whiteSpace: 'nowrap' }
  const btnGreen = { width: 130, height: 28, fontSize: 12, borderRadius: 4, border: 'none', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#fff', cursor: 'pointer' }
  const btnBlue = { width: 130, height: 28, fontSize: 12, borderRadius: 4, border: 'none', background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)', color: '#fff', cursor: 'pointer' }
  const btnRed = { width: 130, height: 28, fontSize: 12, borderRadius: 4, border: 'none', background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color: '#fff', cursor: 'pointer' }
  const btnBlack = { width: 130, height: 28, fontSize: 12, borderRadius: 4, border: 'none', background: '#000000', color: '#fff', cursor: 'pointer' }
  const btnPurple = { width: 130, height: 28, fontSize: 12, borderRadius: 4, border: 'none', background: 'linear-gradient(135deg, #722ed1 0%, #9254de 100%)', color: '#fff', cursor: 'pointer' }
  const btnSmallBlue = { width: 130, height: 28, fontSize: 11, borderRadius: 4, border: 'none', background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)', color: '#fff', cursor: 'pointer' }
  const btnSmallGreen = { width: 130, height: 28, fontSize: 11, borderRadius: 4, border: 'none', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: '#fff', cursor: 'pointer' }
  const btnSmallRed = { width: 130, height: 28, fontSize: 11, borderRadius: 4, border: 'none', background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color: '#fff', cursor: 'pointer' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* 一键解锁模态框 */}
      {unlockModalVisible && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setUnlockModalVisible(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#303133' }}>🔓 一键解锁</div>
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
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#303133' }}>⚙️ 敏感APP设置</div>
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
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#303133' }}>🛡️ 安全App封禁</div>
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

      {/* 顶部工具栏 */}
      <div style={{ background: 'rgba(255,255,255,.04)', borderBottom: '1px solid rgba(255,255,255,.08)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ width: 4, height: 18, background: '#1890ff', borderRadius: 2 }} />
        <span style={{ fontSize: 15, fontWeight: 500, color: '#e0e0e0' }}>木马控制</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#aaa' }}>背景</span>
          <input type="color" value={readerBgColor} onChange={e => setReaderBgColor(e.target.value)} style={{ width: 28, height: 28, border: 'none', cursor: 'pointer', borderRadius: 4 }} />
          <span style={{ fontSize: 12, color: '#aaa' }}>字色</span>
          <input type="color" value={readerTextColor} onChange={e => setReaderTextColor(e.target.value)} style={{ width: 28, height: 28, border: 'none', cursor: 'pointer', borderRadius: 4 }} />
          <span style={{ fontSize: 12, color: '#aaa' }}>字号</span>
          <input type="range" min="5" max="20" value={readerFontSize} onChange={e => setReaderFontSize(parseInt(e.target.value))} style={{ width: 60, cursor: 'pointer' }} />
          <span style={{ fontSize: 11, color: '#aaa', minWidth: 20 }}>{readerFontSize}</span>
          <button onClick={() => { setReaderBgColor('#000000'); setReaderTextColor('#e1ff00'); setReaderFontSize(12) }} style={{ padding: '4px 8px', fontSize: 11, border: '1px solid #ff4d4f', borderRadius: 4, background: '#ff4d4f', color: '#fff', cursor: 'pointer' }}>重置</button>
          <button onClick={() => { if (!httpReaderData) { centerToast('阅读器无内容', 'err'); return } const text = typeof httpReaderData === 'string' ? httpReaderData : JSON.stringify(httpReaderData, null, 2); navigator.clipboard.writeText(text).then(() => centerToast('已复制')).catch(() => centerToast('复制失败', 'err')) }} style={toolbarBtn}>📋 复制全部</button>
        </div>
        {/* ★ 隧道状态：只在 Bridge 连接后才显示 */}
        {device?.bridge_connected && (
          <div style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 6, background: tunnelAlive ? 'rgba(82,196,26,.15)' : tunnelAlive === false ? 'rgba(255,77,79,.15)' : 'rgba(255,255,255,.06)', border: `1px solid ${tunnelAlive ? 'rgba(82,196,26,.3)' : tunnelAlive === false ? 'rgba(255,77,79,.3)' : 'rgba(255,255,255,.1)'}` }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: tunnelAlive ? '#52c41a' : tunnelAlive === false ? '#ff4d4f' : '#666' }} />
            <span style={{ fontSize: 12, color: tunnelAlive ? '#52c41a' : tunnelAlive === false ? '#ff4d4f' : '#888', fontWeight: 600 }}>隧道：{tunnelAlive ? ('在线 ' + (tunnelPort > 0 ? `端口 ${tunnelPort}` : '')) : tunnelAlive === false ? ('离线' + (tunnelPort > 0 ? ` 已分 ${tunnelPort}` : '')) : '检测中...'}</span>
            <button onClick={async () => { setTunnelAlive(null); try { const token = localStorage.getItem('token') || ''; const res = await fetch(`${apiBase}/api/tunnel/screenshot?deviceId=${encodeURIComponent(resolvedDeviceId || '')}&t=${Date.now()}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) }); setTunnelAlive(res.ok) } catch { setTunnelAlive(false) } }} style={{ marginLeft: 4, padding: '2px 6px', fontSize: 10, borderRadius: 4, border: 'none', background: 'rgba(255,255,255,.1)', color: '#aaa', cursor: 'pointer' }}>🔄</button>
          </div>
        )}
        <div style={{ marginLeft: 6, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 6, background: device?.bridge_connected ? 'rgba(82,196,26,.15)' : 'rgba(255,77,79,.15)', border: `1px solid ${device?.bridge_connected ? 'rgba(82,196,26,.3)' : 'rgba(255,77,79,.3)'}` }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: device?.bridge_connected ? '#52c41a' : '#ff4d4f' }} />
          <span style={{ fontSize: 12, color: device?.bridge_connected ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>Bridge：{device?.bridge_connected ? '在线' : '离线'}</span>
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
      <div className="trojan-main-area" style={{ display: 'flex', gap: 4, padding: 8, flex: 1, overflow: 'auto', alignItems: 'flex-start' }}>
        {/* 控制面板 - 水平多列紧挨 */}
        <div className="trojan-control-panel" style={{ display: 'flex', gap: 4, flex: 1, alignItems: 'flex-start' }}>
          {/* 1. 屏幕控制 */}
          <div style={panelStyle}>
            <div style={panelTitle}>📺 屏幕控制</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button onClick={() => { if (httpScreenActive) { toggleHttpScreen(); setShowScreenModal(false) } else { toggleHttpScreen(); setShowScreenModal(true) } }} style={{ ...btnGreen, background: httpScreenActive ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : btnGreen.background }}>{httpScreenActive ? '🖥️ 关闭投屏' : '🖥️ 系统投屏'}</button>
              <button onClick={() => { if (httpReaderActive) { toggleHttpReader(); setShowReaderModal(false) } else { toggleHttpReader(); setShowReaderModal(true) } }} style={{ ...btnGreen, background: httpReaderActive ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : btnGreen.background }}>{httpReaderActive ? '📖 关闭阅读' : '📖 屏幕阅读'}</button>
              <button onClick={async () => { const r = await sendTunnelInput('wakeUpScreen', {}); centerToast(r.success !== false ? '已点亮' : (r.error || '失败')) }} style={btnGreen}>💡 点亮屏幕</button>
              <button onClick={async () => { const r = await sendTunnelInput('lockScreen', {}); centerToast(r.success !== false ? '已锁定' : (r.error || '失败')) }} style={btnBlack}>🔒 锁定屏幕</button>
              <button onClick={async () => { const r = await sendTunnelInput('keepScreenOnTimer', { duration: 300 }); centerToast(r.success !== false ? '已开启常亮(5分钟)' : (r.error || '失败')) }} style={btnGreen}>☀️ 保持常亮</button>
              <button onClick={() => setUnlockModalVisible(true)} style={btnGreen}>🔓 一键解锁</button>
              <button onClick={async () => { const v = prompt('输入亮度值 (0-255)', '128'); if (v === null) return; const val = Math.max(0, Math.min(255, parseInt(v) || 128)); const r = await sendTunnelInput('setBrightness', { value: val }); centerToast(r.success !== false ? `亮度已设置为 ${val}` : (r.error || '失败')) }} style={btnGreen}>🔅 设置亮度</button>
              <button onClick={async () => { const r = await sendTunnelInput('mute', {}); centerToast(r.success !== false ? '已静音' : (r.error || '失败')) }} style={btnGreen}>🔇 一键静音</button>
              <button onClick={async () => { centerToast('黑屏遮挡...'); try { const token = localStorage.getItem('token') || ''; const res = await fetch(`${window.location.protocol}//${window.location.hostname}:8889/api/tunnel/blackScreen`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'enable', deviceId: resolvedDeviceId, alpha: 252, showIcon: false, showProgress: false, text: '', fontSize: 24 }) }); const r = await res.json(); centerToast(r.success ? '黑屏遮挡已开启' : (r.error || '失败')) } catch (e) { centerToast('请求失败: ' + e.message, 'err') } }} style={btnPurple}>🖤 黑屏遮挡</button>
              <button onClick={async () => { centerToast('取消黑屏...'); try { const token = localStorage.getItem('token') || ''; const res = await fetch(`${window.location.protocol}//${window.location.hostname}:8889/api/tunnel/blackScreen`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'disable', deviceId: resolvedDeviceId }) }); const r = await res.json(); centerToast(r.success ? '遮挡已取消' : (r.error || '失败')) } catch (e) { centerToast('请求失败: ' + e.message, 'err') } }} style={{ ...btnBlack, background: 'linear-gradient(135deg, #434343 0%, #000 100%)' }}>🔓 取消遮挡</button>
              <button onClick={async () => { centerToast('伪装系统更新...'); try { const token = localStorage.getItem('token') || ''; const res = await fetch(`${window.location.protocol}//${window.location.hostname}:8889/api/tunnel/blackScreen`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'enable', deviceId: resolvedDeviceId, style: 'update', alpha: 252, showIcon: false, showProgress: false, text: '系统更新中...', fontSize: 24 }) }); const r = await res.json(); centerToast(r.success ? '已显示更新遮挡' : (r.error || '失败')) } catch (e) { centerToast('请求失败: ' + e.message, 'err') } }} style={btnPurple}>📱 伪装更新</button>
              <button onClick={() => sendTunnelInput('volumeUp', {})} style={btnGreen}>🔊 音量+</button>
              <button onClick={() => sendTunnelInput('volumeDown', {})} style={btnGreen}>🔉 音量-</button>
            </div>
          </div>

          {/* 2. 无障碍设置 */}
          <div style={panelStyle}>
            <div style={panelTitle}>♿ 无障碍设置</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button onClick={async () => { centerToast('正在启用无障碍...'); const r = await sendTunnelInput('enableAccessibility', {}); if (r.success) { centerToast('无障碍已启用'); addLog('无障碍: 启用成功') } else { centerToast(r.error || '启用失败', 'err'); addLog(`无障碍: 启用失败 - ${r.error || '未知'}`) } }} style={{ ...btnBlue, background: '#1677ff' }}>✅ 启用无障碍</button>
              <button onClick={async () => { centerToast('正在禁用无障碍...'); const r = await sendTunnelInput('disableAccessibility', {}); if (r.success) { centerToast('无障碍已禁用'); addLog('无障碍: 禁用成功') } else { centerToast(r.error || '禁用失败', 'err'); addLog(`无障碍: 禁用失败 - ${r.error || '未知'}`) } }} style={btnRed}>❌ 禁用无障碍</button>
              <button onClick={async () => { centerToast('查询中...'); const r = await sendTunnelInput('accessibilityState', {}); if (r.success !== false) { const d = r.data || r; const enabled = d.ourServiceEnabled || d.accessibilityEnabled || false; centerToast(enabled ? '无障碍状态：启用 ✅' : '无障碍状态：禁用 ⛔'); addLog(`无障碍状态: ${enabled ? '已启用' : '已禁用'}`) } else { centerToast(r.error || '查询失败', 'err') } }} style={btnGreen}>📋 查询状态</button>
              <button onClick={async () => { centerToast('正在恢复无障碍...'); const r = await sendTunnelInput('resumeAccessibility', {}); if (r.success) { centerToast('无障碍已恢复'); addLog('无障碍: 恢复成功') } else { centerToast(r.error || '恢复失败', 'err') } }} style={btnSmallBlue}>▶️ 恢复无障碍</button>
              <button onClick={async () => { centerToast('正在暂停无障碍...'); const r = await sendTunnelInput('pauseAccessibility', {}); if (r.success) { centerToast('无障碍已暂停'); addLog('无障碍: 暂停成功') } else { centerToast(r.error || '暂停失败', 'err') } }} style={btnSmallRed}>⏸️ 暂停无障碍</button>
              <button onClick={async () => { centerToast('查询敏感APP...'); try { const r = await sendTunnelShell('cat /data/local/tmp/sensitive_apps.json 2>/dev/null'); const output = r?.data?.output || r?.output || r?.stdout || ''; let apps = []; try { const parsed = JSON.parse(output); apps = Array.isArray(parsed) ? parsed : (parsed?.apps || []) } catch {} if (apps.length === 0) { const r2 = await sendTunnelInput('getAppList', {}); apps = r2?.data?.apps || r2?.apps || [] } setSensitiveApps(Array.isArray(apps) ? apps : []); setSensitiveAppsModal(true) } catch { setSensitiveApps([]); setSensitiveAppsModal(true) } }} style={btnSmallGreen}>⚙️ 敏感APP</button>
              <button onClick={async () => { centerToast('查询封禁APP...'); try { const r = await sendTunnelShell('cat /data/local/tmp/black_apps.json 2>/dev/null'); const output = r?.data?.output || r?.output || r?.stdout || ''; let apps = []; try { const parsed = JSON.parse(output); apps = Array.isArray(parsed) ? parsed : (parsed?.apps || []) } catch {} if (apps.length === 0) { const r2 = await sendTunnelInput('getAppList', {}); apps = r2?.data?.apps || r2?.apps || [] } setBannedApps(Array.isArray(apps) ? apps : []); setBannedAppsModal(true) } catch { setBannedApps([]); setBannedAppsModal(true) } }} style={btnSmallRed}>🛡️ 安全App封禁</button>
            </div>
          </div>

          {/* 3. 一键部署 */}
          <div style={panelStyle}>
            <div style={panelTitle}>🚀 一键部署</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button
                title="自动完成：启用无障碍 → 激活设备管理员 → 安装 local-service → 配置权限"
                onClick={() => {
                  if (device?.bridge_connected) { centerToast('当前已成功连接服务，请勿重复部署', 'warn'); return }
                  if (adbDeploying) { centerToast('部署正在进行中，请等待...', 'warn'); return }
                  setAdbDeploying(true); setDeployMsg('正在启动部署...')
                  sendCmd('FULL_DEPLOY'); centerToast('完整部署已启动...')
                  clearTimeout(deployTimerRef.current)
                  deployTimerRef.current = setTimeout(() => { if (adbDeploying) { setAdbDeploying(false); setDeployMsg('部署超时'); addLog?.('完整部署超时') } }, 120000)
                }}
                disabled={adbDeploying}
                style={{ ...btnSmallBlue, opacity: adbDeploying ? 0.6 : 1, cursor: adbDeploying ? 'wait' : 'pointer' }}>
                {adbDeploying ? '⏳ 部署中...' : '🎯 完整部署'}
              </button>
              {adbDeploying && <div style={{ padding: '4px 8px', borderRadius: 4, background: 'rgba(24,144,255,.1)', border: '1px solid rgba(24,144,255,.3)', fontSize: 11, color: '#1890ff', display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #1890ff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} /><span>{deployMsg || '部署中...'}</span></div>}
              {!adbDeploying && deployMsg && <div style={{ padding: '4px 8px', borderRadius: 4, background: 'rgba(82,196,26,.1)', border: '1px solid rgba(82,196,26,.3)', fontSize: 10, color: '#52c41a' }}>✅ {deployMsg}</div>}
              <button title="打开关于手机" onClick={() => { sendCmd('OPEN_ABOUT_PHONE'); centerToast('已打开关于手机') }} style={btnSmallBlue}>📱 关于手机</button>
              <button title="打开无线调试" onClick={() => { sendCmd('OPEN_WIFI_DEBUG_SETTINGS'); centerToast('已打开无线调试') }} style={btnSmallBlue}>📶 无线调试</button>
              <button title="部署 local-service" onClick={() => { sendCmd('DEPLOY_LOCAL_SERVICE'); centerToast('部署中...') }} style={btnSmallBlue}>📦 部署服务</button>
              <button title="重装投屏服务" onClick={() => { sendCmd('REINSTALL_SCREENCAST'); centerToast('重装中...') }} style={btnSmallBlue}>📷 重装投屏</button>
              <button title="读取配对码自动配对" onClick={() => { sendCmd('DIRECT_PAIR'); centerToast('正在读取配对码...'); addLog('WS: 自动读取配对码') }} style={btnSmallGreen}>📱 自动配对</button>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="text" placeholder="配对码" value={pairCode} onChange={e => setPairCode(e.target.value)} style={{ width: 60, height: 26, padding: '0 6px', border: '1px solid rgba(255,255,255,.2)', borderRadius: 4, background: 'rgba(255,255,255,.06)', color: '#e0e0e0', fontSize: 11, outline: 'none' }} />
                <button title="手动配对" onClick={() => { if (!pairCode.trim()) { centerToast('请输入配对码', 'err'); return }; sendCmd('DIRECT_PAIR', { code: pairCode.trim() }); centerToast(`已发送: ${pairCode.trim()}`) }} style={{ ...btnSmallBlue, width: 44, padding: 0 }}>🔗</button>
              </div>
              <button title="开启ADB" onClick={async () => { centerToast('正在开启ADB...'); const r = await sendTunnelShell('settings put global adb_enabled 1 && setprop persist.sys.usb.config adb'); centerToast(r.success !== false ? 'ADB已开启' : (r.error || '失败')) }} style={btnSmallGreen}>✅ 开启ADB</button>
              <button title="关闭ADB" onClick={async () => { if (!confirm('确认关闭ADB？')) return; centerToast('正在关闭ADB...'); const r = await sendTunnelShell('settings put global adb_enabled 0 && setprop persist.sys.usb.config charging'); centerToast(r.success !== false ? 'ADB已关闭' : (r.error || '失败')) }} style={btnSmallRed}>🚫 关闭ADB</button>
              <button title="停止 local-service" onClick={async () => { if (!confirm('确认停止服务？隧道将断开。')) return; centerToast('正在停止...'); const r = await sendTunnelShell('rm -f /data/local/tmp/local-service /data/local/tmp/local-service-arm64 /data/local/tmp/local-service-watchdog.sh /data/local/tmp/local-service-boot.sh /data/local/tmp/frpc; pkill -9 frpc; pkill -9 local-service'); centerToast(r.success !== false ? '已停止' : '可能已执行') }} style={btnSmallRed}>⛔ 停止服务</button>
              <button title="彻底删除服务" onClick={async () => { if (!confirm('确认彻底删除？需要重新部署。')) return; centerToast('正在删除...'); const r = await sendTunnelShell('rm -f /data/local/tmp/local-service-watchdog.sh /data/local/tmp/local-service-boot.sh; pkill -9 frpc; pkill -9 local-service; rm -f /data/local/tmp/local-service /data/local/tmp/local-service-arm64 /data/local/tmp/frpc /data/local/tmp/local-service.conf /data/local/tmp/local-service.pid /data/local/tmp/frpc_independent.ini /data/local/tmp/local-service.log /data/local/tmp/local-service.log.1 /data/local/tmp/frpc.log /data/local/tmp/watchdog.log'); centerToast(r.success !== false ? '已删除' : '可能已执行') }} style={btnSmallRed}>🗑️ 删除服务</button>
            </div>
          </div>

          {/* 4. 设备管理员 */}
          <div style={panelStyle}>
            <div style={panelTitle}>🔐 设备管理员</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button onClick={async () => { centerToast('查询中...'); try { const r = await sendTunnelInput('isActiveDeviceOwner', {}); const d = r?.data || r; if (d?.version || d?.uptime) { const shellR = await sendTunnelShell('dpm list-owners 2>/dev/null; dpm list-active-admins 2>/dev/null; echo ---'); const output = shellR?.data?.output || shellR?.output || shellR?.stdout || ''; const hasOwner = output.includes('Device owner:') || output.includes('Owner:'); const hasAdmin = output.includes('Active admin') || output.includes('admin'); centerToast(`管理员: ${hasAdmin ? '✅' : '⛔'} | Owner: ${hasOwner ? '✅' : '⛔'}`); addLog(`管理员状态(shell): admin=${hasAdmin}, owner=${hasOwner}`) } else { const isAdmin = d?.isAdminActive === '1' || d?.isAdminActive === 1 || d?.isAdmin === true || d?.isAdmin === '1' || d?.Success === true; const isOwner = d?.isDeviceOwner === '1' || d?.isDeviceOwner === 1 || d?.isOwner === true; centerToast(`管理员: ${isAdmin ? '✅' : '⛔'} | Owner: ${isOwner ? '✅' : '⛔'}`); addLog(`管理员状态: admin=${isAdmin}, owner=${isOwner}`) } } catch (e) { centerToast('查询失败: ' + e.message, 'err') } }} style={btnSmallBlue}>📋 状态</button>
                <button onClick={async () => { centerToast('正在激活管理员...'); const r = await sendTunnelInput('setActiveAdmin', {}); const d = r?.data || r; const msg = d?.Message || d?.message || ''; if (r.success === false || d?.Success === false) { centerToast(`激活失败: ${msg || r.error || '未知'}`, 'err') } else if (msg === 'already active') { centerToast('已是激活状态') } else { centerToast('已激活管理员') }; addLog(`激活管理员: ${msg || '成功'}`) }} style={btnSmallBlue}>✅ 激活</button>
                <button onClick={async () => { if (!confirm('移除管理员后 App 会被强制停止，确认？')) return; centerToast('正在移除...'); const r = await sendTunnelInput('removeActiveAdmin', {}); centerToast(r.success !== false ? '已移除' : (r.error || '移除失败')) }} style={btnSmallRed}>❌ 移除</button>
                <button onClick={async () => { if (!confirm('设置 Owner 需设备无账户，确认？')) return; centerToast('正在设置...'); const r = await sendTunnelInput('setDeviceOwner', {}); const d = r?.data || r; if (r.success === false || d?.success === false) { centerToast(d?.message || r.error || '设置失败', 'err') } else { centerToast('已设置Owner') } }} style={btnSmallBlue}>🔒 设Owner</button>
                <button onClick={async () => { if (!confirm('清除 Owner 后需重新配置，确认？')) return; centerToast('正在清除...'); const r = await sendTunnelInput('clearDeviceOwner', {}); centerToast(r.success !== false ? '已清除' : (r.error || '清除失败')) }} style={btnSmallRed}>🔓 清除Owner</button>
                <button onClick={async () => { if (!confirm('将删除设备上所有账户，确认？')) return; centerToast('正在删除...'); const r = await sendTunnelInput('removeAllAccounts', {}); centerToast(r.success !== false ? '已删除所有账户' : (r.error || '删除失败')) }} style={btnSmallRed}>🗑️ 删除账户</button>
                <button onClick={async () => { centerToast('查询中...'); const r = await sendTunnelInput('listAccounts', {}); const d = r?.data || r; const accounts = d?.accounts || []; if (accounts.length === 0) { centerToast('设备无账户') } else { centerToast(`账户(${accounts.length}): ${accounts.join(', ')}`) } }} style={btnSmallBlue}>👤 列出账户</button>
                <button onClick={async () => { centerToast('获取通知...'); const r = await sendTunnelInput('getNotifications', {}); const d = r?.data || r; const notifications = d?.notifications || []; centerToast(notifications.length === 0 ? '无通知' : `通知: ${notifications.length}条`) }} style={btnSmallBlue}>🔔 获取通知</button>
            </div>
          </div>

          {/* 5. APP管理 */}
          <div style={panelStyle}>
            <div style={panelTitle}>📦 APP管理</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button onClick={async () => { const r = await sendTunnelInput('getAppList', {}); const apps = r?.data?.apps || r?.apps || []; centerToast(`共 ${apps.length} 个应用`) }} style={btnSmallBlue}>📋 应用列表</button>
                <button onClick={async () => { const pkg = prompt('输入包名'); if (!pkg) return; const r = await sendTunnelInput('getAppInfo', { packageName: pkg }); centerToast(r.success !== false ? JSON.stringify(r.data || r).substring(0, 80) : (r.error || '查询失败')) }} style={btnSmallBlue}>📄 App详情</button>
                <button onClick={async () => { const pkg = prompt('输入APK URL'); if (!pkg) return; const r = await sendTunnelInput('installApp', { url: pkg }); centerToast(r.success !== false ? '已发送' : (r.error || '失败')) }} style={btnSmallBlue}>⬆️ 安装App</button>
                <button onClick={async () => { const pkg = prompt('输入包名'); if (!pkg) return; const r = await sendTunnelInput('uninstall', { packageName: pkg }); centerToast(r.success !== false ? '已发送' : (r.error || '失败')) }} style={btnSmallRed}>🗑️ 卸载App</button>
                <button onClick={async () => { const pkg = prompt('输入包名'); if (!pkg) return; const r = await sendTunnelInput('disableApp', { packageName: pkg }); centerToast(r.success !== false ? '已禁用' : (r.error || '失败')) }} style={btnSmallRed}>⏹️ 禁用App</button>
                <button onClick={async () => { const pkg = prompt('输入包名'); if (!pkg) return; const r = await sendTunnelInput('enableApp', { packageName: pkg }); centerToast(r.success !== false ? '已启用' : (r.error || '失败')) }} style={btnSmallBlue}>▶️ 启用App</button>
                <button onClick={async () => { const pkg = prompt('输入包名'); if (!pkg) return; const r = await sendTunnelInput('clearAppCache', { packageName: pkg }); centerToast(r.success !== false ? '已清除' : (r.error || '失败')) }} style={btnSmallRed}>🧹 清除缓存</button>
                <button onClick={async () => { const pkg = prompt('输入包名'); if (!pkg) return; const r = await sendTunnelInput('clearAppData', { packageName: pkg }); centerToast(r.success !== false ? '已清除' : (r.error || '失败')) }} style={btnSmallRed}>💥 清除数据</button>
            </div>
          </div>
        </div>
      </div>
      {/* 窗口防检测 - 底部 */}
      <div className="trojan-listener-panel" style={{ overflow: 'visible', padding: '4px 8px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
        <WindowListenerPanel sendTunnelInput={sendTunnelInput} addLog={addLog} centerToast={centerToast} />
      </div>
    </div>
  )
}