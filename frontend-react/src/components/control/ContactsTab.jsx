/**
 * 通讯录Tab - 联系人列表
 * 从 ControlPage.jsx 提取 (lines 2604-2685)
 */
export default function ContactsTab({
  contactsSearch,
  setContactsSearch,
  contactsLoading,
  contactsTotal,
  getFilteredContacts,
  fetchContacts,
  setSmsPhone,
  setActiveTab,
  centerToast,
}) {
  const filtered = getFilteredContacts()

  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ width: 4, height: 18, background: '#52c41a', borderRadius: 2, marginRight: 8 }} />
            <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>通讯录管理</span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <input
              type="text"
              placeholder="搜索姓名或号码"
              value={contactsSearch}
              onChange={e => setContactsSearch(e.target.value)}
              style={{ width: 200, padding: '6px 10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12 }}
            />
            <button
              onClick={fetchContacts}
              disabled={contactsLoading}
              style={{ padding: '6px 14px', background: 'linear-gradient(135deg, #52c41a, #73d13d)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: contactsLoading ? 'wait' : 'pointer' }}
            >{contactsLoading ? '获取中...' : '🔄 获取通讯录'}</button>
            <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12 }}>共 <strong style={{ color: '#38bdf8' }}>{filtered.length}</strong> 个联系人</span>
          </div>

          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 50 }}>序号</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 200 }}>姓名</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 200 }}>电话</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>邮箱</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 80 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {contactsLoading ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>获取中...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>👥</div>
                    <div style={{ fontSize: 13 }}>请先获取数据</div>
                    <div style={{ fontSize: 11, marginTop: 4, color: '#64748b' }}>点击"获取通讯录"按钮获取联系人</div>
                  </td></tr>
                ) : (
                  filtered.map((c, i) => (
                    <tr key={c.id || i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                      <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                      <td style={{ padding: '8px 12px', color: '#e2e8f0', fontSize: 12 }}>{c.name || c.display_name || '--'}</td>
                      <td style={{ padding: '8px 12px', color: '#38bdf8', fontSize: 12 }}>{c.phone || c.number || c.phone_number || '--'}</td>
                      <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email || '--'}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <button
                          onClick={() => { setSmsPhone(c.phone || c.number || c.phone_number || ''); setActiveTab('✉ 短信记录'); centerToast('已填入号码') }}
                          style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(24,144,255,.3)', background: 'rgba(24,144,255,.1)', color: '#38bdf8', cursor: 'pointer' }}
                        >发短信</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {contactsTotal > 0 && (
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>共 {contactsTotal} 条</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
