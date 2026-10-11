/**
 * 查看相册Tab - 图片浏览
 * 从 ControlPage.jsx 提取 (lines 2473-2602)
 */
export default function GalleryTab({
  galleryList,
  galleryCount,
  setGalleryCount,
  galleryLoading,
  galleryPage,
  setGalleryPage,
  gallerySize,
  setGallerySize,
  galleryPreview,
  setGalleryPreview,
  resolvedDeviceId,
  fetchGallery,
  setGalleryList,
  setGalleryTotal,
}) {
  const deviceImages = galleryList.filter(img => !img.deviceId || img.deviceId === resolvedDeviceId)
  const startIdx = (galleryPage - 1) * gallerySize
  const pageImages = deviceImages.slice(startIdx, startIdx + gallerySize)
  const totalPages = Math.max(1, Math.ceil(deviceImages.length / gallerySize))

  return (
    <div className="ctrl-tab-content">
      <div className="ctrl-tab-panel">
        <div style={{ padding: 16, background: 'rgba(255,255,255,.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ width: 4, height: 18, background: '#fa8c16', borderRadius: 2, marginRight: 8 }} />
            <span style={{ fontSize: 15, fontWeight: 500, color: '#fff' }}>相册管理</span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>获取数量:</span>
            <input
              type="number"
              placeholder="全部"
              value={galleryCount}
              onChange={e => setGalleryCount(e.target.value)}
              min={1}
              max={9999}
              style={{ width: 75, padding: '6px 10px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12 }}
            />
            <span style={{ color: '#94a3b8', fontSize: 12 }}>张</span>
            <button
              onClick={() => { setGalleryList([]); setGalleryTotal(0); fetchGallery() }}
              disabled={galleryLoading}
              style={{ padding: '6px 14px', background: 'linear-gradient(135deg, #fa8c16, #d46b08)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: galleryLoading ? 'wait' : 'pointer' }}
            >{galleryLoading ? '获取中...' : '🖼 获取相册'}</button>
            <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12 }}>已获取: <strong style={{ color: '#38bdf8' }}>{deviceImages.length}</strong> 张</span>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', maxHeight: 'calc(100vh - 320px)', padding: 4 }}>
            {deviceImages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>🖼</div>
                <div style={{ fontSize: 13 }}>点击"获取相册"开始获取设备相册</div>
                <div style={{ fontSize: 11, marginTop: 4, color: '#64748b' }}>缩略图模式，节省流量 | 点击图片查看大图</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                {pageImages.map((img, i) => {
                  const rawSrc = img.thumbnail || img.base64 || img.url || img.data || (typeof img === 'string' ? img : '')
                  const src = typeof rawSrc === 'string' && rawSrc.length > 100 ? rawSrc : (typeof rawSrc === 'string' && (rawSrc.startsWith('http') || rawSrc.startsWith('blob:') || rawSrc.startsWith('data:')) ? rawSrc : '')
                  const imgSrc = typeof src === 'string' && src.length > 0 ? (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:') ? src : `data:image/jpeg;base64,${src}`) : ''
                  const fileName = img.displayName || img.name || img.fileName || `图片 ${startIdx + i + 1}`
                  return (
                    <div
                      key={img.id || i}
                      onClick={() => imgSrc && setGalleryPreview(imgSrc)}
                      style={{ borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)', cursor: imgSrc ? 'pointer' : 'default', transition: 'all .15s', boxShadow: '0 2px 8px rgba(0,0,0,.2)' }}
                      onMouseEnter={e => { e.currentTarget.style.border = '1px solid rgba(250,140,22,.4)'; e.currentTarget.style.transform = 'scale(1.03)' }}
                      onMouseLeave={e => { e.currentTarget.style.border = '1px solid rgba(255,255,255,.08)'; e.currentTarget.style.transform = 'scale(1)' }}
                    >
                      <div style={{ aspectRatio: '1', overflow: 'hidden', background: 'rgba(0,0,0,.3)' }}>
                        {imgSrc ? (
                          <img src={imgSrc} alt={fileName} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 11, gap: 4 }}>
                            <span style={{ fontSize: 24, opacity: 0.5 }}>🖼</span>
                            <span style={{ fontSize: 10, padding: '0 4px', textAlign: 'center', wordBreak: 'break-all' }}>{fileName}</span>
                          </div>
                        )}
                      </div>
                      <div style={{ padding: '6px 8px', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                        <div style={{ fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fileName}>{fileName}</div>
                        {img.size && <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>{img.size > 1048576 ? (img.size / 1048576).toFixed(1) + ' MB' : (img.size / 1024).toFixed(0) + ' KB'}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {deviceImages.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>共 {deviceImages.length} 张</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => setGalleryPage(Math.max(1, galleryPage - 1))}
                  disabled={galleryPage <= 1}
                  style={{ padding: '4px 12px', background: galleryPage <= 1 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: galleryPage <= 1 ? '#64748b' : '#fff', fontSize: 12, cursor: galleryPage <= 1 ? 'not-allowed' : 'pointer' }}
                >上一页</button>
                <span style={{ color: '#fff', fontSize: 12 }}>第 {galleryPage} / {totalPages} 页</span>
                <button
                  onClick={() => setGalleryPage(Math.min(totalPages, galleryPage + 1))}
                  disabled={galleryPage >= totalPages}
                  style={{ padding: '4px 12px', background: galleryPage >= totalPages ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: galleryPage >= totalPages ? '#64748b' : '#fff', fontSize: 12, cursor: galleryPage >= totalPages ? 'not-allowed' : 'pointer' }}
                >下一页</button>
                <select
                  value={gallerySize}
                  onChange={e => { setGallerySize(Number(e.target.value)); setGalleryPage(1) }}
                  style={{ padding: '4px 8px', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#fff', fontSize: 12 }}
                >
                  <option value={20} style={{ background: '#1e293b' }}>20张/页</option>
                  <option value={40} style={{ background: '#1e293b' }}>40张/页</option>
                  <option value={80} style={{ background: '#1e293b' }}>80张/页</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {galleryPreview && (
        <div
          onClick={() => setGalleryPreview(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
        >
          <img src={galleryPreview} alt="preview" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,.5)' }} />
          <button
            onClick={e => { e.stopPropagation(); setGalleryPreview(null) }}
            style={{ position: 'absolute', top: 20, right: 20, width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >✕</button>
        </div>
      )}
    </div>
  )
}
