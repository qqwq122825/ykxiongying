import { useState } from 'react'
import { api } from '../api/client'
import { pid } from '../utils/device'
import { toast } from '../utils/toast'
import AssignModal from './AssignModal'

export default function DeviceActions({ device, refresh, compact = false }) {
  const [assignOpen, setAssignOpen] = useState(false)
  const id = pid(device)

  async function remove() {
    if (!confirm(`确认删除设备 ${id}？`)) return
    try {
      await api.deleteDevice(id)
      toast('已删除')
      refresh?.()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  function control() {
    const url = new URL(window.location.origin + window.location.pathname)
    url.searchParams.set('controlDeviceId', id)
    window.open(url.toString(), '_blank', 'noopener,noreferrer')
  }

  const btnClass = compact ? 'act-btn-mini' : 'act-btn'

  return (
    <>
      <div className={compact ? 'act-btns-mini' : 'act-btns'}>
        <button type="button" className={`${btnClass} blue`} onClick={control}>
          {compact ? '控制' : '🏳️ 控制'}
        </button>
        <button type="button" className={`${btnClass} purple`} onClick={() => setAssignOpen(true)}>
          {compact ? '分配' : '👤 分配'}
        </button>
        <button type="button" className={`${btnClass} red`} onClick={remove}>
          {compact ? '删除' : '🗑 删除'}
        </button>
      </div>
      {assignOpen && (
        <AssignModal
          device={device}
          onClose={() => setAssignOpen(false)}
          onSuccess={refresh}
        />
      )}
    </>
  )
}
