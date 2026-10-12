/**
 * ReaderView — UI 层级阅读器组件
 * 从 ControlPage.jsx 提取
 */
import { getReaderRoot, collectReaderNodes, findPatternViewBounds, isPatternLockScreen } from './helpers'
import PatternOverlay from './PatternOverlay'

const gestureStates = new WeakMap()

export default function ReaderView({ data, onTap, onGesture, style, textColor, fontSize }) {
  if (!data) return <div className="ctrl-loading"><div>阅读器未开启</div></div>
  if (typeof data === 'string') return <div className="ctrl-reader-text">{data.substring(0, 4000)}</div>
  const root = getReaderRoot(data)
  if (!root?.bounds) return <div className="ctrl-loading"><div>阅读器未开启</div></div>
  const patternBounds = isPatternLockScreen(data) ? findPatternViewBounds(data) : null
  const nodes = collectReaderNodes(root).filter(n => {
    const b = n.bounds
    const w = b.right - b.left
    const h = b.bottom - b.top
    // ★ 2026-08-06 优化：只保留有真实文本/可交互/大面积 的节点
    //    去掉原 "className?.includes('View'|'Layout')" 条件 —— 会把 android.view.ViewGroup 等空壳节点拉进来导致显示包名/类名
    return w >= 1 && h >= 1 && (
      n.text                                  // 有可见文字
      || n.description                         // 有 content-desc（无障碍描述）
      || n.clickable                           // 可点击
      || n.focusable                           // 可聚焦
      || (w * h >= 40000 && (n.clickable || n.focusable))  // 大面积可交互区域
    )
  })
  // 兜底：如果过滤后 0 节点，去掉点击/文本限制，显示所有有 bounds 的节点
  const fallbackNodes = nodes.length === 0 ? collectReaderNodes(root).filter(n => {
    const b = n.bounds
    return b && (b.right - b.left) >= 1 && (b.bottom - b.top) >= 1
  }).slice(0, 100) : null
  const renderNodes = nodes.length > 0 ? nodes : fallbackNodes
  if (renderNodes && renderNodes.length === 0) {
    return <div className="ctrl-loading"><div>当前页面无节点（设备可能处于黑屏/全屏视频）</div></div>
  }
  const sw = Math.max(1, root.bounds.right - root.bounds.left)
  const sh = Math.max(1, root.bounds.bottom - root.bounds.top)
  const mapPoint = (clientX, clientY, el) => {
    const r = el.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * sw + root.bounds.left,
      y: Math.max(0, Math.min(1, (clientY - r.top) / r.height)) * sh + root.bounds.top,
    }
  }
  const appendPoint = (state, clientX, clientY, el, force = false) => {
    const delta = Math.hypot(clientX - state.lastClientX, clientY - state.lastClientY)
    if (!force && delta < 3) return
    state.travelled += delta
    state.lastClientX = clientX
    state.lastClientY = clientY
    const p = mapPoint(clientX, clientY, el)
    const point = { x: Math.round(p.x), y: Math.round(p.y) }
    const last = state.points[state.points.length - 1]
    if (!last || last.x !== point.x || last.y !== point.y) state.points.push(point)
    // 限制单次消息体积；超限时保留首尾和折线路径的大致形状。
    if (state.points.length > 240) state.points = state.points.filter((_, i) => i === 0 || i === state.points.length - 1 || i % 2 === 0)
  }
  const handlePointerDown = e => {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const start = mapPoint(e.clientX, e.clientY, e.currentTarget)
    gestureStates.set(e.currentTarget, {
      startedAt: Date.now(),
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      travelled: 0,
      points: [{ x: Math.round(start.x), y: Math.round(start.y) }],
    })
    e.currentTarget.style.cursor = 'crosshair'
  }
  const handlePointerMove = e => {
    const state = gestureStates.get(e.currentTarget)
    if (!state) return
    appendPoint(state, e.clientX, e.clientY, e.currentTarget)
    e.currentTarget.style.cursor = 'crosshair'
  }
  const handlePointerUp = e => {
    const state = gestureStates.get(e.currentTarget)
    if (!state) return
    appendPoint(state, e.clientX, e.clientY, e.currentTarget, true)
    gestureStates.delete(e.currentTarget)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    e.currentTarget.style.cursor = 'crosshair'
    const end = state.points[state.points.length - 1]
    if (state.travelled > 12 && state.points.length >= 2) {
      const path = state.points.map(p => ({ x: p.x, y: p.y }))
      onGesture?.({
        type: 'swipe',
        path,
        startX: path[0].x,
        startY: path[0].y,
        endX: path[path.length - 1].x,
        endY: path[path.length - 1].y,
        duration: Math.max(120, Math.min(3000, Date.now() - state.startedAt)),
      })
    } else {
      onGesture?.({ type: 'tap', x: end.x, y: end.y })
    }
  }
  const handlePointerCancel = e => {
    gestureStates.delete(e.currentTarget)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    e.currentTarget.style.cursor = 'crosshair'
  }
  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', background: '#0b0b0b', overflow: 'hidden', userSelect: 'none', touchAction: 'none', cursor: 'crosshair', ...style }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {(renderNodes || nodes).map((n, i) => {
        const b = n.bounds
        const l = (b.left - root.bounds.left) / sw * 100
        const t = (b.top - root.bounds.top) / sh * 100
        const w = (b.right - b.left) / sw * 100
        const h = (b.bottom - b.top) / sh * 100
        // ★ 2026-08-06 优化：去掉 className fallback —— 避免显示 android.view.ViewGroup 等包名/类名
        //    只取真实文本（text/description）。若无文本但可点击，title 里保留可点击标记。
        const text = n.text || n.description || ''
        const clickable = n.clickable || n.focusable
        return (
          <div
            key={n.id || i}
            style={{
              position: 'absolute',
              left: `${l}%`,
              top: `${t}%`,
              width: `${Math.max(w, .5)}%`,
              height: `${Math.max(h, .5)}%`,
              border: `1px solid ${clickable ? 'rgba(82,196,26,.8)' : 'rgba(235,235,235,.3)'}`,
              background: clickable ? 'rgba(82,196,26,.06)' : 'transparent',
              color: textColor || '#e8e8e8',
              padding: 0,
              margin: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
              zIndex: 2,
              fontSize: fontSize || 9,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={text}
          >
            {text || ''}
          </div>
        )
      })}
      {patternBounds && (
        <PatternOverlay
          patternBounds={patternBounds}
          pattern=""
          screenBounds={root.bounds}
          showControls={false}
        />
      )}
    </div>
  )
}
