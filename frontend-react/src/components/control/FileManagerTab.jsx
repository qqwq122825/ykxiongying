/**
 * 文件管理Tab - 文件浏览/操作
 * 从 ControlPage.jsx 提取 (lines 2236-2344)
 */
export default function FileManagerTab({
  deviceSleeping,
  deviceOnline,
  fmGetFilteredFiles,
  fmPath,
  fmGoRoot,
  fmGoUp,
  fmRefresh,
  fmNewFolder,
  fmSelected,
  fmCopy,
  fmCut,
  fmPaste,
  fmClipboard,
  fmSearch,
  setFmSearch,
  fmNavigate,
  fmFiles,
  fmLoading,
  fmSelectAll,
  fmToggleSelect,
  fmOpenItem,
  fmFormatSize,
  fmDownload,
  fmDelete,
}) {
  const filteredFiles = fmGetFilteredFiles()
  const pathParts = fmPath.split('/').filter(Boolean)

  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ width: 4, height: 18, background: '#1677ff', borderRadius: 2, marginRight: 8 }} />
            <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>文件管理</span>
            <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: deviceSleeping ? 'rgba(245,158,11,.15)' : (deviceOnline ? 'rgba(82,196,26,.15)' : 'rgba(239,68,68,.15)'), color: deviceSleeping ? '#f59e0b' : (deviceOnline ? '#52c41a' : '#f87171') }}>{deviceSleeping ? '休眠中' : (deviceOnline ? '已连接' : '未连接')}</span>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <button onClick={fmGoRoot} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)', color: '#fff', cursor: 'pointer' }}>🏠 根目录</button>
            <button onClick={fmGoUp} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)', color: '#fff', cursor: 'pointer' }}>⬆ 上级</button>
            <button onClick={fmRefresh} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)', color: '#fff', cursor: 'pointer' }}>🔄 刷新</button>
            <button onClick={fmNewFolder} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)', color: '#fff', cursor: 'pointer' }}>📁+ 新建文件夹</button>
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,.12)', margin: '0 4px' }} />
            <button onClick={fmCopy} disabled={fmSelected.size === 0} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)', color: fmSelected.size === 0 ? '#64748b' : '#fff', cursor: fmSelected.size === 0 ? 'not-allowed' : 'pointer' }}>📋 复制</button>
            <button onClick={fmCut} disabled={fmSelected.size === 0} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)', color: fmSelected.size === 0 ? '#64748b' : '#fff', cursor: fmSelected.size === 0 ? 'not-allowed' : 'pointer' }}>✂ 剪切</button>
            <button onClick={fmPaste} disabled={!fmClipboard} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)', color: !fmClipboard ? '#64748b' : '#fff', cursor: !fmClipboard ? 'not-allowed' : 'pointer' }}>📌 粘贴{fmClipboard ? ` (${fmClipboard.files.length})` : ''}</button>
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,.12)', margin: '0 4px' }} />
            <input
              type="text"
              placeholder="搜索文件"
              value={fmSearch}
              onChange={e => setFmSearch(e.target.value)}
              style={{ width: 150, padding: '4px 10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 11 }}
            />
          </div>

          <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#94a3b8' }}>
            <span onClick={() => fmNavigate('/')} style={{ cursor: 'pointer', color: '#38bdf8' }}>🏠</span>
            {pathParts.map((part, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#64748b' }}>/</span>
                <span
                  onClick={() => fmNavigate('/' + pathParts.slice(0, i + 1).join('/'))}
                  style={{ cursor: 'pointer', color: i === pathParts.length - 1 ? '#fff' : '#38bdf8' }}
                >{part}</span>
              </span>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,.05)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'center', width: 36 }}>
                    <input type="checkbox" checked={fmSelected.size > 0 && fmSelected.size === fmFiles.length} onChange={fmSelectAll} style={{ cursor: 'pointer' }} />
                  </th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600 }}>名称</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 100 }}>大小</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 160 }}>修改时间</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#94a3b8', fontSize: 11, fontWeight: 600, width: 120 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {fmLoading ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>加载中...</td></tr>
                ) : filteredFiles.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>📁</div>
                    <div style={{ fontSize: 13 }}>暂无文件</div>
                    <div style={{ fontSize: 11, marginTop: 4, color: '#64748b' }}>点击"刷新"按钮获取文件列表</div>
                  </td></tr>
                ) : (
                  filteredFiles.map((f, i) => {
                    const isDir = f.isDir || f.type === 'directory'
                    const icon = isDir ? '📁' : f.name?.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i) ? '🖼' : f.name?.match(/\.(mp4|avi|mov|mkv)$/i) ? '🎬' : f.name?.match(/\.(mp3|wav|ogg|flac)$/i) ? '🎵' : f.name?.match(/\.(apk)$/i) ? '📦' : f.name?.match(/\.(zip|rar|7z|tar|gz)$/i) ? '🗜' : f.name?.match(/\.(txt|log|json|xml|html|css|js)$/i) ? '📝' : '📄'
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                        <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                          <input type="checkbox" checked={fmSelected.has(i)} onChange={() => fmToggleSelect(i)} style={{ cursor: 'pointer' }} />
                        </td>
                        <td style={{ padding: '6px 12px', color: '#e2e8f0', fontSize: 12, cursor: isDir ? 'pointer' : 'default' }} onClick={() => isDir && fmOpenItem(f)}>
                          <span style={{ marginRight: 6 }}>{icon}</span>
                          <span style={{ color: isDir ? '#38bdf8' : '#e2e8f0' }}>{f.name || '--'}</span>
                        </td>
                        <td style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11 }}>{isDir ? '-' : fmFormatSize(f.size)}</td>
                        <td style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>{f.modified ? new Date(f.modified).toLocaleString('zh-CN') : f.lastModified ? new Date(f.lastModified).toLocaleString('zh-CN') : '--'}</td>
                        <td style={{ padding: '6px 12px', display: 'flex', gap: 4 }}>
                          {!isDir && <button onClick={() => fmDownload(f)} style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(24,144,255,.3)', background: 'rgba(24,144,255,.1)', color: '#38bdf8', cursor: 'pointer' }}>下载</button>}
                          <button onClick={() => fmDelete(f)} style={{ padding: '2px 6px', fontSize: 10, borderRadius: 4, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: '#f87171', cursor: 'pointer' }}>删除</button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>共 {fmFiles.length} 项</span>
          </div>
        </div>
      </div>
    </div>
  )
}
