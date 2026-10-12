import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { toast } from '../utils/toast'

function exportText(state, events) {
  const header = {
    format: 'xingchen-onboarding-debug/v1',
    exportedAt: new Date().toISOString(),
    sessionId: state.sessionId || '',
    startedAt: state.startedAt || 0,
    eventCount: events.length,
  }
  return [header, ...events].map(item => JSON.stringify(item)).join('\n') + '\n'
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const el = document.createElement('textarea')
  el.value = text
  el.style.position = 'fixed'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  el.remove()
}

export default function DebugLogPage() {
  const [state, setState] = useState({ enabled: false, sessionId: '', startedAt: 0 })
  const [events, setEvents] = useState([])
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)

  async function load() {
    try {
      const res = await api.onboardingDebug()
      const data = res?.data || {}
      setState({ enabled: !!data.enabled, sessionId: data.sessionId || '', startedAt: data.startedAt || 0 })
      setEvents(Array.isArray(data.events) ? data.events : [])
    } catch (e) {
      toast('读取调试日志失败: ' + e.message, 'error')
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!state.enabled) return undefined
    const timer = setInterval(load, 1000)
    return () => clearInterval(timer)
  }, [state.enabled])
  useEffect(() => {
    if (autoScroll) document.getElementById('onboarding-debug-end')?.scrollIntoView({ behavior: 'smooth' })
  }, [events, autoScroll])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return events
    return events.filter(event => JSON.stringify(event).toLowerCase().includes(q))
  }, [events, query])

  async function toggle(enabled) {
    setBusy(true)
    try {
      const res = await api.setOnboardingDebug(enabled, enabled)
      const data = res?.data || {}
      setState({ enabled: !!data.enabled, sessionId: data.sessionId || '', startedAt: data.startedAt || 0 })
      setEvents(Array.isArray(data.events) ? data.events : [])
      toast(enabled ? '调试日志已启动，请让全新设备上线' : '调试日志已停止')
    } catch (e) {
      toast('操作失败: ' + e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function clearLogs() {
    setBusy(true)
    try {
      await api.clearOnboardingDebug()
      setEvents([])
      toast('日志已清空')
    } catch (e) {
      toast('清空失败: ' + e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function copyAll() {
    await copyText(exportText(state, events))
    toast(`已复制 ${events.length} 条 JSONL 日志`)
  }

  function download() {
    const blob = new Blob([exportText(state, events)], { type: 'application/x-ndjson;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `xingchen-onboarding-${state.sessionId || Date.now()}.jsonl`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sourceColor = source => source === 'node-ws' ? '#38bdf8' : '#c084fc'
  const stageColor = stage => stage.includes('error') ? '#f87171' : stage.includes('completed') || stage.includes('sent') ? '#4ade80' : '#fbbf24'

  return (
    <section className="panel" style={{ padding: 20, minHeight: 'calc(100vh - 110px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>🧾 新设备接入调试日志</div>
          <div style={{ marginTop: 5, fontSize: 12, color: '#94a3b8' }}>记录 HTTP 注册、WS 连接/心跳、应用列表，以及自动/手动注入的 STOP、SHOW、表单上报、入库和完成停止顺序。</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!state.enabled
            ? <button className="rc-btn" disabled={busy} onClick={() => toggle(true)} style={{ background: '#16a34a', color: '#fff' }}>▶ 启动并清空旧日志</button>
            : <button className="rc-btn danger" disabled={busy} onClick={() => toggle(false)}>■ 停止日志</button>}
          <button className="rc-btn" disabled={!events.length} onClick={copyAll}>📋 一键复制</button>
          <button className="rc-btn" disabled={!events.length} onClick={download}>⬇ 导出 JSONL</button>
          <button className="rc-btn danger" disabled={busy || !events.length} onClick={clearLogs}>🗑 清空</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 14 }}>
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}><span style={{ color: '#94a3b8' }}>状态：</span><b style={{ color: state.enabled ? '#4ade80' : '#f87171' }}>{state.enabled ? '● 记录中' : '○ 已停止'}</b></div>
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: '#94a3b8' }}>会话：</span><code>{state.sessionId || '-'}</code></div>
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}><span style={{ color: '#94a3b8' }}>事件：</span><b>{events.length}</b></div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索设备ID / 阶段 / 内容" style={{ flex: 1, minWidth: 260, padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(0,0,0,.25)', color: '#fff' }} />
        <label style={{ color: '#94a3b8', fontSize: 12 }}><input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} /> 自动滚动</label>
        <button className="rc-btn" onClick={load}>⟳ 刷新</button>
      </div>

      <div style={{ height: 'calc(100vh - 330px)', minHeight: 360, overflow: 'auto', background: '#090d14', border: '1px solid rgba(56,189,248,.18)', borderRadius: 10, padding: 10, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12 }}>
        {filtered.length === 0 ? <div style={{ padding: 40, color: '#64748b', textAlign: 'center' }}>{state.enabled ? '等待新设备事件…' : '点击“启动并清空旧日志”，然后让全新设备上线'}</div> : filtered.map(event => (
          <div key={event.id} style={{ padding: '7px 8px', borderBottom: '1px solid rgba(255,255,255,.05)', lineHeight: 1.55 }}>
            <span style={{ color: '#64748b' }}>{new Date(event.timestamp).toLocaleString('zh-CN', { hour12: false })}</span>{' '}
            <span style={{ color: sourceColor(event.source) }}>[{event.source}]</span>{' '}
            <span style={{ color: stageColor(event.stage), fontWeight: 700 }}>{event.stage}</span>{' '}
            {event.deviceId && <span style={{ color: '#e2e8f0' }}>device={event.deviceId}</span>}{' '}
            <span style={{ color: '#94a3b8', wordBreak: 'break-all' }}>{JSON.stringify(event.details || {})}</span>
          </div>
        ))}
        <div id="onboarding-debug-end" />
      </div>
    </section>
  )
}
