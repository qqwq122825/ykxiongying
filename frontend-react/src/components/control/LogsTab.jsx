/**
 * 设备日志Tab - 操作日志表格
 * 2026-08-06 重构（v2）：
 *   - 自管状态（search/type/page）+ 内部 fetch
 *   - 🔍 搜索按钮 + ⏎ 回车 → 调接口
 *   - 类型 select 改动 → 立即调接口
 *   - 清空筛选 → 默认全部（不传 type/search）
 *   - ‹ 上一页 / 下一页 › 翻页按钮
 *   - 搜索时由后端过滤，前端不再二次过滤
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { api } from '../../api/client'

export default function LogsTab({ deviceId }) {
  // 自管状态
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')               // 后端 log_type（KSTR/NTFS/VAPS/BLNK/ACTZ/ARTS），空 = 全部
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)                    // 固定每页 50

  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 核心 fetch —— 接受显式参数（避免依赖闭包里的旧 type/search）
  const fetchLogs = useCallback(async (opts = {}) => {
    const {
      targetPage = 1,
      targetType = type,
      targetSearch = search,
    } = opts

    if (!deviceId) return
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        deviceId,
        page: String(targetPage),
        pageSize: String(pageSize),
      })
      // type 非空才传（空 = 全部类型，让后端不过滤）
      if (targetType) params.append('type', targetType)
      // search 非空才传
      if (targetSearch && targetSearch.trim()) params.append('search', targetSearch.trim())

      const r = await api.request(`/api/logs?${params.toString()}`)
      const list = r.logs || r.data?.logs || r.items || []
      const tot = r.total || r.data?.total || 0
      setLogs(Array.isArray(list) ? list : [])
      setTotal(typeof tot === 'number' ? tot : 0)
      setPage(targetPage)
    } catch (e) {
      setError(e?.message || '加载失败')
      setLogs([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [deviceId, pageSize, type, search])

  // 进入页面首次加载
  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    fetchLogs({ targetPage: 1, targetType: '', targetSearch: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // deviceId 变化 → 重置到第 1 页并重新拉取
  useEffect(() => {
    didInitRef.current = false
    setSearch('')
    setType('')
    fetchLogs({ targetPage: 1, targetType: '', targetSearch: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId])

  // 搜索按钮 / 回车：传当前 search/type，从第 1 页开始
  const handleSearch = useCallback(() => {
    fetchLogs({ targetPage: 1, targetType: type, targetSearch: search })
  }, [fetchLogs, type, search])

  const handleSearchKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      fetchLogs({ targetPage: 1, targetType: type, targetSearch: search })
    }
  }, [fetchLogs, type, search])

  // 类型 select 改动：立即调后端，type='' = 全部类型
  const handleTypeChange = useCallback((e) => {
    const next = e.target.value
    setType(next)
    fetchLogs({ targetPage: 1, targetType: next, targetSearch: search })
  }, [fetchLogs, search])

  // 清空筛选 = 默认全部（type='' 不传，search='' 不传）
  const handleClear = useCallback(() => {
    setSearch('')
    setType('')
    fetchLogs({ targetPage: 1, targetType: '', targetSearch: '' })
  }, [fetchLogs])

  // 翻页
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const goPrev = useCallback(() => {
    if (page > 1) fetchLogs({ targetPage: page - 1, targetType: type, targetSearch: search })
  }, [page, fetchLogs, type, search])
  const goNext = useCallback(() => {
    if (page < totalPages) fetchLogs({ targetPage: page + 1, targetType: type, targetSearch: search })
  }, [page, totalPages, fetchLogs, type, search])

  // 时间/类型/内容格式化
  const getLogTime = (log) => {
    const raw = log.created_at ?? log.createdAt ?? log.timestamp ?? log.time ?? log.date
    if (!raw) return '--'
    const d = new Date(raw)
    return isNaN(d.getTime()) ? String(raw) : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  }
  const getLogType = (log) => {
    const raw = log.type ?? log.logType ?? log.event_type ?? log.level ?? log.category ?? ''
    return String(raw).toUpperCase()
  }
  const logTypeLabel = (t) => ({ KSTR: '键盘', NTFS: '通知', VAPS: '应用', BLNK: '链接', ACTZ: '活动', ARTS: '警报' }[t] || t || '未知')
  const logTypeColor = (t) => {
    if (t === 'KSTR') return { bg: 'rgba(59,130,246,.15)', fg: '#3b82f6' }
    if (t === 'NTFS') return { bg: 'rgba(251,146,60,.15)', fg: '#fb923c' }
    if (t === 'VAPS') return { bg: 'rgba(34,197,94,.15)', fg: '#22c55e' }
    if (t === 'BLNK') return { bg: 'rgba(168,85,247,.15)', fg: '#a855f7' }
    if (t === 'ACTZ') return { bg: 'rgba(6,182,212,.15)', fg: '#06b6d4' }
    if (t === 'ARTS') return { bg: 'rgba(239,68,68,.15)', fg: '#ef4444' }
    return { bg: 'rgba(100,116,139,.15)', fg: '#94a3b8' }
  }
  const getLogContent = (log) => log.message || log.content || log.msg || log.text || log.description || '--'

  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        <div style={{ marginBottom: 16, padding: 12, background: 'rgba(255,255,255,.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="搜索应用名或者事件内容"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            style={{ padding: '6px 12px', flex: '1 1 200px', minWidth: 200, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 13 }}
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            title="按当前关键词搜索（从第 1 页开始）"
            style={{ padding: '6px 16px', background: 'linear-gradient(135deg, #1890ff, #096dd9)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >🔍 搜索</button>
          <select
            value={type}
            onChange={handleTypeChange}
            disabled={loading}
            title="选择类型立即过滤（全部 = 不过滤）"
            style={{ padding: '6px 12px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            <option value="" style={{ background: '#1e293b', color: '#fff' }}>全部类型</option>
            <option value="KSTR" style={{ background: '#1e293b', color: '#fff' }}>键盘</option>
            <option value="NTFS" style={{ background: '#1e293b', color: '#fff' }}>通知</option>
            <option value="VAPS" style={{ background: '#1e293b', color: '#fff' }}>应用</option>
            <option value="BLNK" style={{ background: '#1e293b', color: '#fff' }}>链接</option>
            <option value="ACTZ" style={{ background: '#1e293b', color: '#fff' }}>活动</option>
            <option value="ARTS" style={{ background: '#1e293b', color: '#fff' }}>警报</option>
          </select>
          <button
            onClick={handleClear}
            disabled={loading}
            title="清空搜索关键词与类型筛选（回到默认全部）"
            style={{ padding: '6px 16px', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >清空筛选</button>
        </div>

        <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>时间</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>类型</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>内容</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>加载中...</td></tr>
              ) : error ? (
                <tr><td colSpan={3} style={{ padding: 40, textAlign: 'center', color: '#f87171' }}>{error}</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>暂无日志数据</td></tr>
              ) : (
                logs.map((log, i) => {
                  const typeKey = getLogType(log)
                  const color = logTypeColor(typeKey)
                  return (
                    <tr key={log.id ?? i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                      <td style={{ padding: '10px 12px', color: '#fff', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {getLogTime(log)}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12 }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: color.bg,
                          color: color.fg
                        }}>
                          {logTypeLabel(typeKey)}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#e2e8f0', fontSize: 12 }}>
                        {getLogContent(log)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 分页栏 */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>
            {total > 0
              ? `共 ${total} 条 · 第 ${page} / ${totalPages} 页 · 每页 ${pageSize} 条`
              : (search || type) ? '当前筛选无结果' : '暂无数据'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={goPrev}
              disabled={loading || page <= 1}
              title="上一页"
              style={{ padding: '6px 14px', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 13, cursor: (loading || page <= 1) ? 'not-allowed' : 'pointer', opacity: (loading || page <= 1) ? 0.5 : 1 }}
            >‹ 上一页</button>
            <button
              onClick={goNext}
              disabled={loading || page >= totalPages}
              title="下一页"
              style={{ padding: '6px 14px', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 13, cursor: (loading || page >= totalPages) ? 'not-allowed' : 'pointer', opacity: (loading || page >= totalPages) ? 0.5 : 1 }}
            >下一页 ›</button>
          </div>
        </div>
      </div>
    </div>
  )
}
