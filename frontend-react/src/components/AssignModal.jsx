import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import { pid, owner, ownerValue, PUBLIC_OWNER } from '../utils/device'
import { toast } from '../utils/toast'

export default function AssignModal({ device, onClose, onSuccess }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const id = pid(device)
  const currentOwnerValue = ownerValue(device)
  const currentOwner = owner(device)

  useEffect(() => {
    let cancelled = false
    api.users()
      .then((res) => {
        if (cancelled) return
        const list = res.data || res.result || res || []
        const userList = Array.isArray(list) ? list : []
        setUsers(userList)
        const currentOwnerExists = userList.some((u) => u.username === currentOwnerValue)
        setUsername(currentOwnerValue === PUBLIC_OWNER || currentOwnerExists ? currentOwnerValue : (userList[0]?.username || PUBLIC_OWNER))
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [currentOwnerValue])

  async function confirm() {
    if (!username) return
    try {
      await api.assignDevice(id, username)
      toast(username === PUBLIC_OWNER ? '已移到公共，所有账号均可查看' : '已分配')
      onSuccess?.()
      onClose()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const modal = (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" role="dialog" aria-modal="true">
        <div className="modal-title">分配设备</div>
        {loading ? (
          <div className="modal-muted">加载中...</div>
        ) : error ? (
          <div className="modal-error">{error}</div>
        ) : (
          <>
            <div className="modal-grid">
              <div className="modal-row">
                <span className="modal-label">设备 ID</span>
                <code className="modal-code">{id}</code>
              </div>
              <div className="modal-row">
                <span className="modal-label">当前归属</span>
                <span className={currentOwner ? 'modal-owner' : 'modal-muted'}>
                  {currentOwner || '无'}
                  {currentOwnerValue !== PUBLIC_OWNER && currentOwner && users.length > 0 && !users.some((u) => u.username === currentOwnerValue) ? '（账号不存在）' : ''}
                </span>
              </div>
              <label className="modal-field">
                <span className="modal-label">选择归属</span>
                <select value={username} onChange={(e) => setUsername(e.target.value)}>
                  <option value={PUBLIC_OWNER}>🌐 公共（所有账号可见）</option>
                  {users.map((u) => (
                    <option key={u.username} value={u.username}>{u.username}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="modal-btn ghost" onClick={onClose}>取消</button>
              <button type="button" className="modal-btn primary" onClick={confirm}>确认分配</button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
