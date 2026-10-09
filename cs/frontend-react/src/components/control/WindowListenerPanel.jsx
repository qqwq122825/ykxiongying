/**
 * 窗口防检测规则管理面板
 * 通过 local-service 的 windowListener API 管理自动规则
 * 当目标 APP 打开时自动执行隐藏动作
 */
import { useState, useEffect, useCallback } from 'react'

export default function WindowListenerPanel({ sendTunnelInput, addLog, centerToast }) {
  const [status, setStatus] = useState(null) // null=未查询, true=运行中, false=已停止
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editRule, setEditRule] = useState(null)

  // 查询状态和规则
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const statusRes = await sendTunnelInput('windowListener/status', {})
      const d = statusRes?.data || statusRes
      setStatus(d?.enabled === true)
    } catch { setStatus(false) }
    try {
      const rulesRes = await sendTunnelInput('windowListener/getRules', {})
      const d = rulesRes?.data || rulesRes
      const list = Array.isArray(d) ? d : (d?.rules || [])
      setRules(list)
    } catch { setRules([]) }
    setLoading(false)
  }, [sendTunnelInput])

  useEffect(() => { refresh() }, [refresh])

  // 启动/停止监听
  const toggleListener = async () => {
    const action = status ? 'windowListener/stop' : 'windowListener/start'
    const r = await sendTunnelInput(action, {})
    if (r?.success !== false) {
      setStatus(!status)
      centerToast(status ? '窗口监听已停止' : '窗口监听已启动')
      addLog(`窗口监听: ${status ? '停止' : '启动'}`)
    } else {
      centerToast(r.error || r.message || '操作失败', 'err')
    }
  }

  // 删除规则
  const removeRule = async (rule) => {
    if (!confirm(`确认删除规则: ${rule.condition?.packageName || rule.id}？`)) return
    const r = await sendTunnelInput('windowListener/removeRule', { id: rule.id })
    if (r?.success !== false) {
      centerToast('规则已删除')
      refresh()
    } else { centerToast(r.error || r.message || '删除失败', 'err') }
  }

  // 启用/禁用规则
  const toggleRule = async (rule) => {
    const action = rule.enabled ? 'windowListener/disableRule' : 'windowListener/enableRule'
    const r = await sendTunnelInput(action, { id: rule.id })
    if (r?.success !== false) {
      centerToast(rule.enabled ? '规则已禁用' : '规则已启用')
      refresh()
    } else { centerToast(r.error || r.message || '操作失败', 'err') }
  }

  // 保存规则到设备
  const saveRules = async () => {
    const r = await sendTunnelInput('windowListener/saveRules', {})
    centerToast(r?.success !== false ? '规则已保存到设备' : (r.error || r.message || '保存失败'))
  }

  // 清空所有规则
  const clearAllRules = async () => {
    if (!confirm('确认清空所有规则？不可恢复。')) return
    const r = await sendTunnelInput('windowListener/clearRules', {})
    if (r?.success !== false) { centerToast('已清空所有规则'); setRules([]) }
    else { centerToast(r.error || r.message || '清空失败', 'err') }
  }

  const panelStyle = { background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: 16 }
  const btnSm = (bg) => ({ padding: '4px 10px', fontSize: 11, border: 'none', borderRadius: 4, background: bg, color: '#fff', cursor: 'pointer', fontWeight: 500 })

  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        🛡️ 窗口防检测
        <span style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 10px', borderRadius: 4, background: status ? 'rgba(82,196,26,.15)' : 'rgba(255,77,79,.15)', color: status ? '#52c41a' : '#ff4d4f', border: `1px solid ${status ? 'rgba(82,196,26,.3)' : 'rgba(255,77,79,.3)'}` }}>
          {status === null ? '...' : status ? '● 运行中' : '○ 已停止'}
        </span>
      </div>

      {/* 控制按钮行 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={toggleListener} style={btnSm(status ? '#ff4d4f' : '#52c41a')}>{status ? '⏹ 停止' : '▶ 启动'}</button>
        <button onClick={refresh} disabled={loading} style={btnSm('#1890ff')}>{loading ? '...' : '🔄 刷新'}</button>
        <button onClick={() => setShowAddModal(true)} style={btnSm('#722ed1')}>+ 添加规则</button>
        <button onClick={saveRules} style={btnSm('#faad14')}>💾 保存</button>
        <button onClick={clearAllRules} style={btnSm('#434343')}>🗑️ 清空</button>
      </div>

      {/* 规则列表 */}
      <div style={{ maxHeight: 400, overflow: 'auto' }}>
        {rules.length === 0 ? (
          <div style={{ color: '#666', fontSize: 12, textAlign: 'center', padding: 20 }}>暂无规则，点击"添加规则"开始配置</div>
        ) : rules.map((rule, i) => (
          <div key={rule.id || i} style={{ padding: '8px 10px', marginBottom: 6, borderRadius: 6, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)', fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: rule.enabled !== false ? '#52c41a' : '#666' }} />
              <span style={{ color: '#e0e0e0', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {rule.condition?.packageName || rule.condition?.packageContains || rule.name || `规则${i+1}`}
              </span>
              <button onClick={() => toggleRule(rule)} style={btnSm(rule.enabled !== false ? '#ff4d4f' : '#52c41a')}>{rule.enabled !== false ? '禁用' : '启用'}</button>
              <button onClick={() => { setEditRule(rule); setShowAddModal(true) }} style={btnSm('#1890ff')}>编辑</button>
              <button onClick={() => removeRule(rule)} style={btnSm('#434343')}>删除</button>
            </div>
            <div style={{ color: '#888', marginTop: 4, fontSize: 11 }}>
              动作: {formatActions(rule.actions)}
              {rule.triggerCount > 0 && <span style={{ marginLeft: 8, color: '#faad14' }}>触发 {rule.triggerCount} 次</span>}
            </div>
          </div>
        ))}
      </div>

      {/* 添加/编辑规则弹窗 */}
      {showAddModal && (
        <AddRuleModal
          rule={editRule}
          onClose={() => { setShowAddModal(false); setEditRule(null) }}
          onSave={async (ruleData) => {
            const action = editRule ? 'windowListener/updateRule' : 'windowListener/addRule'
            const r = await sendTunnelInput(action, ruleData)
            if (r?.success !== false) {
              centerToast(editRule ? '规则已更新' : '规则已添加')
              setShowAddModal(false)
              setEditRule(null)
              refresh()
            } else {
              centerToast(r.error || r.message || '操作失败', 'err')
            }
          }}
          centerToast={centerToast}
        />
      )}
    </div>
  )
}

function formatActions(actions) {
  if (!actions || actions.length === 0) return '无'
  const labels = {
    pauseAccessibility: '⏸暂停无障碍',
    resumeAccessibility: '▶恢复无障碍',
    closeADBDebug: '🚫关ADB',
    openADBDebug: '✅开ADB',
    closeWifiDebug: '🚫关无线调试',
    openWifiDebug: '✅开无线调试',
    clearNotifications: '🔕清通知',
    shell: '⌨命令',
  }
  return actions.map(a => labels[a.type] || a.type || '未知').join(' → ')
}

function AddRuleModal({ rule, onClose, onSave, centerToast }) {
  const [packageName, setPackageName] = useState('')
  const [actions, setActions] = useState([])

  const ACTION_OPTIONS = [
    { type: 'pauseAccessibility', label: '⏸️ 暂停无障碍服务', category: 'enter' },
    { type: 'resumeAccessibility', label: '▶️ 恢复无障碍服务', category: 'leave' },
    { type: 'closeADBDebug', label: '🚫 关闭 ADB', category: 'enter' },
    { type: 'openADBDebug', label: '✅ 开启 ADB', category: 'leave' },
    { type: 'clearNotifications', label: '🔕 清除通知', category: 'enter' },
  ]

  // 初始化编辑数据
  useEffect(() => {
    if (rule) {
      setPackageName(rule.condition?.packageName || '')
      setActions(rule.actions || [])
    } else {
      setPackageName('')
      setActions([])
    }
  }, [rule])

  const toggleAction = (type) => {
    setActions(prev => {
      const exists = prev.find(a => a.type === type)
      if (exists) return prev.filter(a => a.type !== type)
      return [...prev, { type, delay: 0 }]
    })
  }

  const handleSave = () => {
    if (!packageName.trim()) { centerToast('请输入包名', 'err'); return }
    if (actions.length === 0) { centerToast('请至少选择一个动作', 'err'); return }
    // 警告：同时暂停无障碍+关ADB
    const hasPause = actions.some(a => a.type === 'pauseAccessibility')
    const hasCloseAdb = actions.some(a => a.type === 'closeADBDebug')
    if (hasPause && hasCloseAdb) {
      if (!confirm('⚠️ 警告：同时暂停无障碍并关闭ADB将导致双通道断开，设备可能完全失联！确认继续？')) return
    }

    onSave({
      ...(rule?.id ? { id: rule.id } : {}),
      condition: { packageName: packageName.trim() },
      actions: actions,
      enabled: true
    })
  }

  const overlayStyle = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const modalStyle = { background: '#1a1a2e', borderRadius: 12, padding: 24, width: 420, border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }
  const inputStyle = { width: '100%', height: 36, padding: '0 12px', border: '1px solid rgba(255,255,255,.15)', borderRadius: 6, background: 'rgba(255,255,255,.06)', color: '#e0e0e0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }
  const checkStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ccc', cursor: 'pointer', padding: '5px 0' }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#e0e0e0', marginBottom: 16 }}>
          {rule ? '✏️ 编辑规则' : '➕ 添加防检测规则'}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#aaa', marginBottom: 4, display: 'block' }}>目标应用包名</label>
          <input type="text" placeholder="com.example.bank" value={packageName} onChange={e => setPackageName(e.target.value)} style={inputStyle} autoFocus />
          <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>当此 APP 的窗口出现在前台时，自动执行下方选中的动作</div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: '#aaa', marginBottom: 6 }}>执行动作（多选）</div>
        {ACTION_OPTIONS.map(opt => (
          <label key={opt.type} style={checkStyle}>
            <input type="checkbox" checked={actions.some(a => a.type === opt.type)} onChange={() => toggleAction(opt.type)} />
            {opt.label}
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#666' }}>{opt.category === 'enter' ? '进入时' : '离开时'}</span>
          </label>
        ))}

        {/* 警告 */}
        {actions.some(a => a.type === 'pauseAccessibility') && actions.some(a => a.type === 'closeADBDebug') && (
          <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 4, background: 'rgba(255,77,79,.15)', border: '1px solid rgba(255,77,79,.3)', fontSize: 11, color: '#ff4d4f' }}>
            ⚠️ 同时暂停无障碍+关闭ADB将断开所有通道，设备可能失联！
          </div>
        )}

        <div style={{ fontSize: 10, color: '#666', marginTop: 8, lineHeight: 1.5 }}>
          提示：windowListener 在窗口匹配时执行动作。建议同一包名创建两条规则：<br/>
          规则1（进入）：匹配目标包名 → 暂停无障碍/关ADB<br/>
          规则2（离开）：匹配 launcher 包名 → 恢复无障碍/开ADB
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, borderRadius: 6, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: '#aaa', cursor: 'pointer' }}>取消</button>
          <button onClick={handleSave} style={{ padding: '8px 18px', fontSize: 13, borderRadius: 6, border: 'none', background: 'linear-gradient(135deg, #722ed1 0%, #9254de 100%)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>确认</button>
        </div>
      </div>
    </div>
  )
}
