import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import { pid, owner } from '../utils/device'
import { toast } from '../utils/toast'

export default function AssignModal({ device, onClose, onSuccess }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const id = pid(device)
  const currentOwner = owner(device)

  useEffect(() => {
    let cancelled = false
    api.users()
      .then((res) => {
        if (cancelled) return
        const list = res.data || res.result || res || []
        setUsers(list)
        setUsername(currentOwner || list[0]?.username || '')
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [currentOwner])

  async function confirm() {
    if (!username) return
    try {
      await api.assignDevice(id, username)
      toast('已分配')
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
                </span>
              </div>
              <label className="modal-field">
                <span className="modal-label">选择用户</span>
                <select value={username} onChange={(e) => setUsername(e.target.value)}>
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
