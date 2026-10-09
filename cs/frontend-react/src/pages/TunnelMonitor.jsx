/**
 * 设备健康监控面板
 * - 19901 跳板去除后，每台设备独立分配端口 (19902-29999)
 * - 端口分配由 Node.js 在 bridge WS 握手时自动完成
 * - 端口回收机制：每小时释放 7 天未上线的设备端口
 * - 本页面只展示健康状态，不做主动操作（除紧急清理外）
 */
import { useState, useEffect, useCallback, useRef } from 'react'

const NODE_BASE = `${window.location.protocol}//${window.location.hostname}`

function fmtBytes(n) {
  if (!n) return '0 B'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

function fmtLastSeen(seconds) {
  if (!seconds) return '—'
  const diff = Math.floor(Date.now() / 1000) - seconds
  if (diff < 0) return '刚刚'
  if (diff < 60) return `${diff}秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  return `${Math.floor(diff / 86400)}天前`
}

// 健康状态分类
function getHealth(p) {
  if (!p.frpsProxy) {
    // 端口分配了但 frpc 没连上 → 设备离线
    if (p.minutesSinceLastSeen !== null && p.minutesSinceLastSeen > 10) return { label: '设备离线', color: '#ff4d4f', icon: '🔴' }
    // 端口刚分配还在初始化
    return { label: '连接中', color: '#1890ff', icon: '🔵' }
  }
  if (p.frpsProxy.status === 'online') {
    if (p.minutesSinceLastSeen !== null && p.minutesSinceLastSeen > 30) return { label: '空闲中', color: '#fa8c16', icon: '🟡' }
    return { label: '健康', color: '#52c41a', icon: '🟢' }
  }
  return { label: 'frpc 离线', color: '#ff4d4f', icon: '🔴' }
}

export default function TunnelMonitor() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [filter, setFilter] = useState('')
  const [stats, setStats] = useState({ total: 0, online: 0, idle: 0, offline: 0, accessible: 0 })
  const timerRef = useRef(null)

  const loadData = useCallback(async () => {
    try {
      const token = localStorage.getItem('token') || ''
      // ★ 2026-08-06 方案A：/internal/* 被 Nginx 限制仅本机访问(公网返回403)
      // 改走 PHP 端同构端点 /api/tunnel/tunnel-status（全局 Auth 中间件做 JWT 校验）
      const res = await fetch(`${NODE_BASE}/api/tunnel/tunnel-status`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)

      // 计算统计
      const ports = json.ports || []
      const s = { total: ports.length, online: 0, idle: 0, offline: 0, accessible: 0 }
      ports.forEach(p => {
        const h = getHealth(p)
        if (h.label === '健康') s.online++
        else if (h.label === '空闲中') s.idle++
        else if (h.label === 'frpc 离线' || h.label === '设备离线') s.offline++
        if (p.accessibilityAlive) s.accessible++
      })
      setStats(s)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    if (autoRefresh) {
      timerRef.current = setInterval(loadData, 15000)  // 智能轮询：15 秒一次(后台静默探测)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [loadData, autoRefresh])

  const filteredPorts = data?.ports?.filter(p => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return String(p.port).includes(q) || (p.deviceId || '').toLowerCase().includes(q)
  }) || []

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto', color: '#e0e0e0' }}>
      {/* 顶部标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 4, height: 22, background: '#1890ff', borderRadius: 2 }} />
        <span style={{ fontSize: 18, fontWeight: 600 }}>设备健康监控</span>
        <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>实时同步 Bridge + frpc 状态</span>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#aaa', cursor: 'pointer' }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          自动刷新
        </label>
        <button onClick={loadData} disabled={loading} style={{ padding: '4px 12px', fontSize: 12, borderRadius: 4, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.06)', color: '#e0e0e0', cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? '刷新中...' : '🔄 立即刷新'}
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={{ background: 'rgba(255,77,79,.1)', border: '1px solid rgba(255,77,79,.3)', borderRadius: 8, padding: 12, marginBottom: 16, color: '#ff4d4f', fontSize: 12 }}>
          ⚠ {error}
        </div>
      )}

      {/* 概览统计卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard label="总设备" value={stats.total} color="#1890ff" icon="📱" />
        <StatCard label="健康" value={stats.online} color="#52c41a" icon="🟢" />
        <StatCard label="空闲(>30分钟)" value={stats.idle} color="#fa8c16" icon="🟡" />
        <StatCard label="frpc 离线" value={stats.offline} color="#ff4d4f" icon="🔴" />
        <StatCard label="无障碍在线" value={`${stats.accessible}/${stats.total}`} color="#722ed1" icon="♿" />
      </div>

      {/* 说明卡片 */}
      <div style={{ background: 'rgba(82,196,26,.06)', border: '1px solid rgba(82,196,26,.3)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: '#95de64' }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>✅ 自动分配模式</div>
        <div style={{ color: '#95de64', fontSize: 11, lineHeight: 1.6 }}>
          设备连上 Bridge WS 时,Node.js 自动分配独立端口 (19902-29999),并在 frps 注册为 <code style={{ background: 'rgba(255,255,255,.1)', padding: '0 4px', borderRadius: 2 }}>tunnel_&lt;deviceId前8位&gt;</code>。
          端口分配完全自动,无需手动干预。设备 7 天未上线会自动释放端口。
        </div>
      </div>

      {/* 设备健康列表 */}
      <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>📋 设备健康列表</span>
          <span style={{ fontSize: 11, color: '#888' }}>({filteredPorts.length} / {data?.ports?.length || 0})</span>
          <input
            type="text"
            placeholder="按端口号或设备ID搜索..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12, borderRadius: 4, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.05)', color: '#e0e0e0', width: 220, outline: 'none' }}
          />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)', color: '#888' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>健康</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>端口</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>设备ID</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>frpc 状态</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>无障碍</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>最后活跃</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>归属</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>流量(今日)</th>
                <th style={{ textAlign: 'right', padding: '6px 8px' }}>连接</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr><td colSpan="9" style={{ padding: 20, textAlign: 'center', color: '#888' }}>加载中...</td></tr>
              )}
              {!loading && filteredPorts.length === 0 && (
                <tr><td colSpan="9" style={{ padding: 20, textAlign: 'center', color: '#888' }}>无设备</td></tr>
              )}
              {filteredPorts.map((p, i) => {
                const health = getHealth(p)
                return (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, background: `${health.color}22`, color: health.color, fontSize: 11, fontWeight: 600 }}>
                        {health.icon} {health.label}
                      </span>
                    </td>
                    <td style={{ padding: '6px 8px', color: '#1890ff', fontWeight: 600, fontFamily: 'monospace' }}>
                      {p.port}
                    </td>
                    <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11, color: '#ccc' }}>{p.deviceId}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {p.frpsProxy ? (
                        <span style={{ padding: '2px 6px', borderRadius: 4, background: p.frpsProxy.status === 'online' ? 'rgba(82,196,26,.2)' : 'rgba(255,77,79,.2)', color: p.frpsProxy.status === 'online' ? '#52c41a' : '#ff4d4f', fontSize: 10, fontWeight: 600 }}>
                          {p.frpsProxy.status}
                        </span>
                      ) : (
                        <span style={{ color: '#888', fontSize: 10 }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', color: p.accessibilityAlive ? '#52c41a' : '#ff4d4f', fontSize: 14, textAlign: 'center' }}>
                      {p.accessibilityAlive ? '✅' : '❌'}
                    </td>
                    <td style={{ padding: '6px 8px', color: '#aaa', fontSize: 11 }}>
                      {fmtLastSeen(p.lastSeen)}
                    </td>
                    <td style={{ padding: '6px 8px', color: '#888', fontSize: 11 }}>{p.owner || '(未分配)'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#aaa', fontSize: 10 }}>
                      {p.frpsProxy ? (
                        <>
                          ↓ {fmtBytes(p.frpsProxy.todayTrafficIn)}
                          <br />
                          ↑ {fmtBytes(p.frpsProxy.todayTrafficOut)}
                        </>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: '#888', fontSize: 11 }}>
                      {p.frpsProxy ? p.frpsProxy.curConns : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 底部说明 */}
      <div style={{ marginTop: 16, fontSize: 11, color: '#666', textAlign: 'center' }}>
        数据来源:DB fisher_devices + frps Dashboard API · 15 秒自动刷新
      </div>
    </div>
  )
}

function StatCard({ label, value, color, icon }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${color}44`, borderRadius: 8, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 12, color: '#aaa' }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}
