import { useEffect, useState } from "react"
import { api } from "../api/client"

function toast(m,t){const e=document.createElement("div");e.style.cssText="position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;padding:12px 28px;border-radius:10px;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,.5);pointer-events:none;transition:opacity .3s";e.style.background=t==="error"?"rgba(220,38,38,.9)":"rgba(16,8,12,.95)";e.style.border=t==="error"?"1px solid rgba(220,38,38,.3)":"1px solid rgba(168,85,247,.12)";e.style.color=t==="error"?"#ff7875":"#e0d0d0";e.textContent=m;document.body.appendChild(e);setTimeout(()=>{e.style.opacity="0";setTimeout(()=>e.remove(),300)},2500)}

export default function TgNotify() {
  const [cfg, setCfg] = useState({ bot_token: "", chat_id: "", notify_online: "true", notify_sms: "false" })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    api.request("/api/settings/telegram").then(r => {
      const d = r.data || r
      if (d && typeof d === "object") setCfg(prev => ({ ...prev, ...d }))
    }).catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    try {
      await api.request("/api/settings/telegram", { method: "POST", body: JSON.stringify(cfg) })
      toast("Telegram 配置已保存")
    } catch (e) { toast(e.message, "error") }
    finally { setSaving(false) }
  }

  async function test() {
    if (!cfg.bot_token || !cfg.chat_id) return toast("请先填写 Bot Token 和 Chat ID", "error")
    setTesting(true)
    try {
      await api.request("/api/settings/telegram/test", { method: "POST", body: JSON.stringify(cfg) })
      toast("测试消息已发送，请检查 Telegram")
    } catch (e) { toast(e.message, "error") }
    finally { setTesting(false) }
  }

  return (
    <div className="panel" style={{ padding: 18, marginBottom: 16 }}>
      <h4 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 600, color: "#ddd" }}>📢 Telegram 通知</h4>
      <div style={{ fontSize: 12, color: "#6e7681", marginBottom: 14 }}>新设备上线时发送 Telegram 通知（仅管理员可配置）</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 13, color: "#8870a0" }}>Bot Token
          <input value={cfg.bot_token} onChange={e => setCfg({ ...cfg, bot_token: e.target.value })} placeholder="123456:ABC-DEF..."
            style={{ width: "100%", marginTop: 4, height: 36, background: "rgba(255,255,255,.04)", border: "1px solid rgba(168,85,247,.08)", borderRadius: 6, padding: "0 10px", color: "#ddd", fontSize: 13, outline: 0 }} />
        </label>
        <label style={{ fontSize: 13, color: "#8870a0" }}>Chat ID
          <input value={cfg.chat_id} onChange={e => setCfg({ ...cfg, chat_id: e.target.value })} placeholder="-100123456789"
            style={{ width: "100%", marginTop: 4, height: 36, background: "rgba(255,255,255,.04)", border: "1px solid rgba(168,85,247,.08)", borderRadius: 6, padding: "0 10px", color: "#ddd", fontSize: 13, outline: 0 }} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12 }}>
        <label style={{ fontSize: 13, color: "#8870a0", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={cfg.notify_online === "true" || cfg.notify_online === true} onChange={e => setCfg({ ...cfg, notify_online: e.target.checked ? "true" : "false" })} />设备上线通知
        </label>
        <label style={{ fontSize: 13, color: "#8870a0", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={cfg.notify_sms === "true" || cfg.notify_sms === true} onChange={e => setCfg({ ...cfg, notify_sms: e.target.checked ? "true" : "false" })} />短信通知
        </label>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="rc-btn" onClick={save} disabled={saving} style={{ height: 34 }}>{saving ? "保存中..." : "💾 保存配置"}</button>
        <button className="rc-btn" onClick={test} disabled={testing} style={{ height: 34, background: "rgba(82,196,26,.12)", color: "#52c41a" }}>{testing ? "发送中..." : "🧪 发送测试"}</button>
      </div>
    </div>
  )
}
