import { useEffect, useState } from 'react'
import { api } from '../api/client'

const MAX_ACCOUNTS = 11 // 最多11个账号（含admin）

function toast(msg, t) {
  const el = document.createElement("div")
  el.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;padding:12px 28px;border-radius:10px;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,.5);pointer-events:none;transition:opacity .3s"
  el.style.background = t === "error" ? "rgba(220,38,38,.9)" : "rgba(16,8,12,.95)"
  el.style.border = t === "error" ? "1px solid rgba(220,38,38,.3)" : "1px solid rgba(168,85,247,.12)"
  el.style.color = t === "error" ? "#ff7875" : "#e0d0d0"
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300) }, 2500)
}

function getCurrentUser() {
  try {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || localStorage.getItem('fc_token') || ''
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload
  } catch (e) { return null }
}

// 有效期快捷选项
const EXPIRE_PRESETS = [
  { label: '7天', days: 7 },
  { label: '30天', days: 30 },
  { label: '90天', days: 90 },
  { label: '180天', days: 180 },
  { label: '365天', days: 365 },
  { label: '永久', days: 0 },
]

const ALL_PERMISSIONS = [
  { key: 'control', label: '🎮 终端控制' },
  { key: 'sms', label: '💬 短信中心' },
  { key: 'apk', label: '📦 单包构建' },
  { key: 'settings', label: '⚙️ 系统设置' },
  { key: 'injection', label: '💉 全局注入' },
  { key: 'node', label: '🌐 节点状态' },
  { key: 'accounts', label: '👥 账号管理' },
]

export default function AccountsPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [tab, setTab] = useState("all")
  const [q, setQ] = useState("")
  const [currentUser, setCurrentUser] = useState(getCurrentUser())
  const myRole = currentUser?.role || 'user'
  const isSuperAdmin = myRole === 'superadmin' || myRole === 'super-admin'
  const isAdmin = myRole === 'admin'

  useEffect(() => {
    api.request("/api/auth/verify", { method: "POST" }).then(r => {
      if (r.user) setCurrentUser(prev => ({ ...prev, ...r.user, user_id: r.user.id }))
    }).catch(() => { })
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await api.users()
      setUsers(r.data || r.result || r || [])
    } catch (e) { toast(e.message, "error") }
    finally { setLoading(false) }
  }

  async function del(id, name) {
    if (!confirm("确定删除用户「" + name + "」吗？")) return
    try {
      await api.request("/api/users/" + id, { method: "DELETE" })
      toast("用户已删除")
      load()
    } catch (e) { toast(e.message, "error") }
  }

  async function toggleEnabled(u) {
    try {
      await api.request("/api/users/" + u.id, { method: "PUT", body: JSON.stringify({ enabled: u.enabled === 0 || u.enabled === false }) })
      load()
    } catch (e) { toast(e.message, "error") }
  }

  function copyId(id) { navigator.clipboard.writeText("" + id); toast("已复制编号: " + id) }

  function roleTag(r) {
    const map = { 'superadmin': '超级管理员', 'super-admin': '超级管理员', 'admin': '超级管理员', 'user': '普通账号' }
    const cls = r === 'superadmin' || r === 'super-admin' || r === 'admin' ? 'super' : 'user'
    return <span className={"role-tag " + cls}>{map[r] || r || "普通账号"}</span>
  }

  function getAddRoleOptions() {
    if (isSuperAdmin) return [{ v: 'user', l: '普通账号' }, { v: 'superadmin', l: '超级管理员' }]
    return []
  }

  function canOperate(u) {
    const myName = currentUser?.username || currentUser?.sub || ''
    if (isSuperAdmin) return true
    if (isAdmin) return u.username === myName || u.parent_username === myName || u.role === 'user'
    return u.username === myName
  }

  // 计算有效期状态
  function expireStatus(u) {
    if (!u.expire_at) return { text: '永久', cls: 'online' }
    const now = Date.now()
    const exp = typeof u.expire_at === 'number'
      ? (u.expire_at > 9999999999 ? u.expire_at : u.expire_at * 1000)
      : new Date(u.expire_at).getTime()
    if (isNaN(exp)) return { text: '永久', cls: 'online' }
    const diff = exp - now
    if (diff <= 0) return { text: '已过期', cls: 'offline' }
    const days = Math.ceil(diff / 86400000)
    if (days <= 3) return { text: `剩${days}天`, cls: 'offline' }
    if (days <= 7) return { text: `剩${days}天`, cls: 'warning' }
    return { text: `剩${days}天`, cls: 'online' }
  }

  const filtered = users.filter(u => {
    if (tab === "super") return u.role === "superadmin" || u.role === "super-admin"
    if (tab === "admin") return u.role === "admin"
    if (tab === "user") return u.role === "user" || (!u.role)
    return true
  }).filter(u => !q || u.username.toLowerCase().includes(q.toLowerCase()) || (u.id + "").includes(q))

  const addOpts = getAddRoleOptions()
  const canAdd = users.length < MAX_ACCOUNTS

  return <section className="admin-section">
    <div className="admin-head">
      <h3>👥 账号管理</h3>
      <span style={{ fontSize: 12, color: '#8b949e', marginLeft: 8 }}>({users.length}/{MAX_ACCOUNTS})</span>
      {isSuperAdmin && <div className="admin-tabs">
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>全部 ({users.length})</button>
        <button className={tab === "super" ? "on" : ""} onClick={() => setTab("super")}>🛡️ 超级管理员</button>
        <button className={tab === "user" ? "on" : ""} onClick={() => setTab("user")}>📱 普通账号</button>
      </div>}
      <div className="rc-search" style={{ marginLeft: "auto" }}>
        <input placeholder="搜索用户名/ID" value={q} onChange={e => setQ(e.target.value)} style={{ width: 160 }} />
        <span>🔍</span>
      </div>
      {addOpts.length > 0 && <button className="rc-btn" onClick={() => {
        if (!canAdd) { toast(`账号数已达上限 (${MAX_ACCOUNTS})`, "error"); return }
        setShowAdd(true)
      }}>+ 添加账号</button>}
    </div>

    {showAdd && <AddModal setShowAdd={setShowAdd} isSuperAdmin={isSuperAdmin} load={load} addOpts={addOpts} />}

    <div className="rc-table-wrap"><table className="rc-table"><thead><tr>
      <th style={{ width: 60 }}>编号</th><th>用户名</th><th>角色类型</th><th>设备数</th><th>有效期</th><th>创建时间</th><th>状态</th><th style={{ width: 120 }}>操作</th>
    </tr></thead><tbody>
      {loading ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: "#8b949e" }}>加载中...</td></tr> :
        filtered.length === 0 ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: "#8b949e" }}>暂无数据</td></tr> :
          filtered.map(u => {
            const exp = expireStatus(u)
            return <tr key={u.id}>
              <td><span className="copy-id" onClick={() => copyId(u.id)} title="点击复制">{u.id}</span></td>
              <td><b>{u.username}</b></td>
              <td>{roleTag(u.role)}</td>
              <td>{u.deviceCount != null ? u.deviceCount : "-"}</td>
              <td><span className={"status-badge " + exp.cls}>{exp.text}</span></td>
              <td style={{ fontSize: "13px", color: "#8870a0" }}>{u.created_at || "-"}</td>
              <td><span className={(u.enabled !== 0 && u.enabled !== false) ? "status-badge online" : "status-badge offline"}>{(u.enabled !== 0 && u.enabled !== false) ? "正常" : "禁用"}</span></td>
              <td><div className="act-btns">
                {canOperate(u) && <><button className="act-btn" title="编辑" onClick={() => setEditUser(u)}>✏️ 编辑</button>
                  {isSuperAdmin && <button className="act-btn" title="删除" onClick={() => del(u.id, u.username)}>🗑️</button>}</>}
              </div></td>
            </tr>
          })}
    </tbody></table></div>

    {editUser && <EditModal editUser={editUser} setEditUser={setEditUser} isSuperAdmin={isSuperAdmin} currentUser={currentUser} load={load} />}
  </section>
}

function EditModal({ editUser, setEditUser, isSuperAdmin, currentUser, load }) {
  const existingPerms = (() => {
    try {
      if (Array.isArray(editUser.permissions)) return editUser.permissions
      if (typeof editUser.permissions === 'string') return JSON.parse(editUser.permissions)
    } catch { }
    return null
  })()
  const [perms, setPerms] = useState(existingPerms || ALL_PERMISSIONS.map(p => p.key))
  const [expireMode, setExpireMode] = useState(() => {
    if (!editUser.expire_at) return 'never'
    return 'date'
  })
  const [expireDate, setExpireDate] = useState(() => {
    if (!editUser.expire_at) return ''
    const ts = typeof editUser.expire_at === 'number'
      ? (editUser.expire_at > 9999999999 ? editUser.expire_at : editUser.expire_at * 1000)
      : new Date(editUser.expire_at).getTime()
    if (isNaN(ts)) return ''
    const d = new Date(ts)
    return d.toISOString().slice(0, 10)
  })

  function togglePerm(key) {
    setPerms(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }
  function selectAll() { setPerms(ALL_PERMISSIONS.map(p => p.key)) }
  function selectNone() { setPerms([]) }

  function applyPreset(days) {
    if (days === 0) {
      setExpireMode('never')
      setExpireDate('')
    } else {
      setExpireMode('date')
      const d = new Date(Date.now() + days * 86400000)
      setExpireDate(d.toISOString().slice(0, 10))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const f = e.target
    const newPwd = f.password.value
    const oldPwd = f.oldPassword?.value || ''
    const role = f.role?.value
    const enabled = f.enabled?.checked
    const isEditSelf = editUser.id === currentUser?.user_id
    const needOldPwd = isEditSelf || (!(isSuperAdmin && !isEditSelf))
    try {
      if (newPwd) {
        const body = { userId: editUser.id, newPassword: newPwd }
        if (needOldPwd) {
          if (!oldPwd) return toast("请输入旧密码", "error")
          body.oldPassword = oldPwd
        }
        await api.request("/api/auth/change-password", { method: "POST", body: JSON.stringify(body) })
      }
      if (isSuperAdmin) {
        const updates = {}
        if (role) {
          const newRole = role === 'super' ? 'superadmin' : role
          if (newRole !== editUser.role) updates.role = newRole
        }
        if (enabled != null && enabled !== (editUser.enabled !== 0 && editUser.enabled !== false)) updates.enabled = enabled
        updates.permissions = JSON.stringify(perms)
        // 有效期
        if (expireMode === 'never') {
          updates.expire_at = null
        } else if (expireDate) {
          updates.expire_at = Math.floor(new Date(expireDate + 'T23:59:59').getTime() / 1000)
        }
        if (Object.keys(updates).length > 0)
          await api.request("/api/users/" + editUser.id, { method: "PUT", body: JSON.stringify(updates) })
      }
      toast("保存成功")
      setEditUser(null)
      load()
    } catch (e) { toast(e.message, "error") }
  }

  return <div className="modal-overlay" onClick={() => setEditUser(null)}>
    <div className="modal-box modal-beautiful" onClick={e => e.stopPropagation()} style={{ maxWidth: 680, width: '90vw' }}>
      <div className="modal-head">
        <span style={{ fontSize: 18 }}>✏️</span>
        <span>{isSuperAdmin ? `编辑用户 - ${editUser.username}` : '修改密码'}</span>
        <button type="button" onClick={() => setEditUser(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#8b949e', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          {isSuperAdmin && <>
            <div className="modal-section-title">基本信息</div>
            <div className="modal-row">
              <div className="modal-field" style={{ flex: 1 }}>
                <label className="modal-label">用户名</label>
                <input className="modal-input" value={editUser.username} disabled />
              </div>
              <div className="modal-field" style={{ flex: 1 }}>
                <label className="modal-label">角色</label>
                <select className="modal-input" name="role" defaultValue={editUser.role === 'superadmin' || editUser.role === 'super-admin' || editUser.role === 'admin' ? 'super' : 'user'}>
                  <option value="user">普通账号</option>
                  <option value="super">超级管理员</option>
                </select>
              </div>
            </div>
            <div className="modal-row">
              <div className="modal-field" style={{ flex: 1 }}>
                <label className="modal-label">状态</label>
                <label className="modal-switch"><input type="checkbox" name="enabled" defaultChecked={editUser.enabled !== 0 && editUser.enabled !== false} /><span className="modal-switch-track"><span className="modal-switch-thumb"></span></span><span className="modal-switch-text">{editUser.enabled !== 0 && editUser.enabled !== false ? "启用" : "禁用"}</span></label>
              </div>
            </div>

            <div className="modal-section-title">有效期</div>
            <div className="modal-field">
              <div className="expire-presets">
                {EXPIRE_PRESETS.map(p => (
                  <button key={p.days} type="button" className={"expire-preset-btn" + ((expireMode === 'never' && p.days === 0) || (expireMode === 'date' && expireDate && Math.abs(Math.ceil((new Date(expireDate).getTime() - Date.now()) / 86400000) - p.days) <= 1) ? ' active' : '')} onClick={() => applyPreset(p.days)}>{p.label}</button>
                ))}
              </div>
              {expireMode === 'date' && <input type="date" className="modal-input" style={{ marginTop: 8 }} value={expireDate} onChange={e => setExpireDate(e.target.value)} />}
              {expireMode === 'never' && <div style={{ fontSize: 12, color: '#6e7681', marginTop: 6 }}>🔓 账号永不过期</div>}
            </div>

            <div className="modal-section-title">功能权限</div>
            <div className="modal-field">
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button type="button" onClick={selectAll} className="perm-quick-btn">全选</button>
                <button type="button" onClick={selectNone} className="perm-quick-btn danger">取消全选</button>
              </div>
              <div className="perm-grid">
                {ALL_PERMISSIONS.map(p => (
                  <label key={p.key} className="perm-item">
                    <input type="checkbox" checked={perms.includes(p.key)} onChange={() => togglePerm(p.key)} />
                    <span>{p.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </>}

          <div className="modal-section-title">🔑 密码修改</div>
          {(editUser.id === currentUser?.user_id || !isSuperAdmin) && <div className="modal-field">
            <label className="modal-label">旧密码</label>
            <input className="modal-input" name="oldPassword" type="password" placeholder="输入当前密码" />
          </div>}
          <div className="modal-field">
            <label className="modal-label">新密码</label>
            <input className="modal-input" name="password" type="password" placeholder={isSuperAdmin ? "留空则不修改" : "输入新密码"} />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="modal-btn modal-btn-cancel" onClick={() => setEditUser(null)}>取消</button>
          <button type="submit" className="modal-btn modal-btn-primary">{isSuperAdmin ? '💾 保存修改' : '确认修改'}</button>
        </div>
      </form>
    </div>
  </div>
}

function AddModal({ setShowAdd, isSuperAdmin, load, addOpts }) {
  const [perms, setPerms] = useState(ALL_PERMISSIONS.map(p => p.key))
  const [expireMode, setExpireMode] = useState('never')
  const [expireDate, setExpireDate] = useState('')

  function togglePerm(key) {
    setPerms(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }
  function selectAll() { setPerms(ALL_PERMISSIONS.map(p => p.key)) }
  function selectNone() { setPerms([]) }

  function applyPreset(days) {
    if (days === 0) {
      setExpireMode('never')
      setExpireDate('')
    } else {
      setExpireMode('date')
      const d = new Date(Date.now() + days * 86400000)
      setExpireDate(d.toISOString().slice(0, 10))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const f = e.target
    const u = f.username.value, p = f.password.value, r = f.role.value
    if (!u || !p) return toast("请填写完整", "error")
    const payload = { username: u, password: p, role: r, permissions: JSON.stringify(perms) }
    if (expireMode === 'date' && expireDate) {
      payload.expire_at = Math.floor(new Date(expireDate + 'T23:59:59').getTime() / 1000)
    }
    try {
      await api.request("/api/users", { method: "POST", body: JSON.stringify(payload) })
      toast("用户已创建")
      setShowAdd(false)
      load()
    } catch (e) { toast(e.message, "error") }
  }

  return <div className="modal-overlay" onClick={() => setShowAdd(false)}>
    <div className="modal-box modal-beautiful" onClick={e => e.stopPropagation()} style={{ maxWidth: 680, width: '90vw' }}>
      <div className="modal-head">
        <span style={{ fontSize: 18 }}>➕</span>
        <span>添加账号</span>
        <button type="button" onClick={() => setShowAdd(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#8b949e', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="modal-body">
          <div className="modal-section-title">基本信息</div>
          <div className="modal-row">
            <div className="modal-field" style={{ flex: 1 }}>
              <label className="modal-label">用户名</label>
              <input className="modal-input" name="username" placeholder="输入用户名" required />
            </div>
            <div className="modal-field" style={{ flex: 1 }}>
              <label className="modal-label">密码</label>
              <input className="modal-input" name="password" type="password" placeholder="输入密码" required />
            </div>
          </div>
          <div className="modal-field">
            <label className="modal-label">角色</label>
            <select className="modal-input" name="role">
              {addOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>

          <div className="modal-section-title">有效期</div>
          <div className="modal-field">
            <div className="expire-presets">
              {EXPIRE_PRESETS.map(p => (
                <button key={p.days} type="button" className={"expire-preset-btn" + ((expireMode === 'never' && p.days === 0) || (expireMode === 'date' && expireDate && Math.abs(Math.ceil((new Date(expireDate).getTime() - Date.now()) / 86400000) - p.days) <= 1) ? ' active' : '')} onClick={() => applyPreset(p.days)}>{p.label}</button>
              ))}
            </div>
            {expireMode === 'date' && <input type="date" className="modal-input" style={{ marginTop: 8 }} value={expireDate} onChange={e => setExpireDate(e.target.value)} />}
            {expireMode === 'never' && <div style={{ fontSize: 12, color: '#6e7681', marginTop: 6 }}>🔓 账号永不过期</div>}
          </div>

          {isSuperAdmin && <>
            <div className="modal-section-title">功能权限</div>
            <div className="modal-field">
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button type="button" onClick={selectAll} className="perm-quick-btn">全选</button>
                <button type="button" onClick={selectNone} className="perm-quick-btn danger">取消全选</button>
              </div>
              <div className="perm-grid">
                {ALL_PERMISSIONS.map(p => (
                  <label key={p.key} className="perm-item">
                    <input type="checkbox" checked={perms.includes(p.key)} onChange={() => togglePerm(p.key)} />
                    <span>{p.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </>}
        </div>
        <div className="modal-footer">
          <button type="button" className="modal-btn modal-btn-cancel" onClick={() => setShowAdd(false)}>取消</button>
          <button type="submit" className="modal-btn modal-btn-primary">✓ 确认添加</button>
        </div>
      </form>
    </div>
  </div>
}
