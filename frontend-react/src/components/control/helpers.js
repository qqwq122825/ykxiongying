/**
 * ControlPage 功能拆分 — 纯函数工具
 */
export function imageSrc(v) { if (!v) return ''; if (typeof v === 'string') return v.startsWith('data:') || v.startsWith('blob:') ? v : `data:image/jpeg;base64,${v}`; if (typeof v === 'object') return imageSrc(v.base64 || v.image || v.data || v.payload || v.frame || v.jpeg || v.jpg || v.png || v.content); return '' }
export function controlType(command) { return ({ TAP: 'tap', tap: 'tap', CLICK: 'tap', SWIPE: 'swipe_path', SWIPE_PATH: 'swipe_path' }[command] || command) }
export function normalizeControlData(type, params = {}) { const p = params && typeof params === 'object' && !Array.isArray(params) ? params : { value: params }; if (type === 'swipe_path') { const startX = Math.round(p.startX ?? p.x1 ?? p.sx ?? 0), startY = Math.round(p.startY ?? p.y1 ?? p.sy ?? 0), endX = Math.round(p.endX ?? p.x2 ?? p.ex ?? 0), endY = Math.round(p.endY ?? p.y2 ?? p.ey ?? 0); return { path: [{ x: startX, y: startY }, { x: Math.round((startX + endX) / 2), y: Math.round((startY + endY) / 2) }, { x: endX, y: endY }], startX, startY, endX, endY, duration: p.duration ?? 300 } } return type === 'tap' ? { x: Math.round(p.x ?? 0), y: Math.round(p.y ?? 0) } : p }
export function getReaderRoot(data) { if (!data || typeof data === 'string') return null; if (Array.isArray(data)) return { id: 'root', children: data }; if (data.root && typeof data.root === 'object') return data.root; if (data.nodes && Array.isArray(data.nodes)) return { id: 'root', children: data.nodes }; if (data.children && Array.isArray(data.children)) return data; return data }
export function collectReaderNodes(node, out = []) { if (!node || typeof node !== 'object') return out; const b = node.bounds; if (b && typeof b.left === 'number' && typeof b.top === 'number' && typeof b.right === 'number' && typeof b.bottom === 'number') out.push(node); (Array.isArray(node.children) ? node.children : []).forEach(ch => collectReaderNodes(ch, out)); return out }
export function parseBounds(bounds = '') { const m = String(bounds).match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); return m ? { left: +m[1], top: +m[2], right: +m[3], bottom: +m[4] } : null }
export function parseHierarchyXml(xml) { const doc = new DOMParser().parseFromString(xml, 'text/xml'); const hierarchy = doc.querySelector('hierarchy'); if (!hierarchy) return null; let id = 0; const walk = (el) => { const bounds = parseBounds(el.getAttribute('bounds') || ''); if (!bounds) return null; const node = { id: `ls_${id++}`, type: el.getAttribute('class') || '', text: el.getAttribute('text') || undefined, description: el.getAttribute('content-desc') || undefined, bounds, clickable: el.getAttribute('clickable') === 'true', focusable: el.getAttribute('focusable') === 'true', children: [] }; for (const child of el.children) { const n = walk(child); if (n) node.children.push(n) } if (!node.children.length) delete node.children; return node }; const root = walk(hierarchy.querySelector('node') || hierarchy); return root ? { root, timestamp: Date.now() } : null }
export function hasMeaningfulReaderData(data) { if (!data) return false; if (typeof data === 'string') return data.trim().length > 0; if (Array.isArray(data)) return data.length > 0; if (typeof data === 'object') return Boolean(data.root || data.nodes || data.children || data.xml || data.hierarchy || data.dump || data.payload || data.result || data.data); return false }
export function normalizeReaderPayload(r) { const data = typeof r === 'string' ? parseHierarchyXml(r) || r : r?.xml ? parseHierarchyXml(r.xml) || r : r?.data ?? r; return hasMeaningfulReaderData(data) ? data : null }
export function formatFileSize(bytes) { if (!bytes || bytes === 0) return '-'; if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'; if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB'; return (bytes / 1073741824).toFixed(2) + ' GB' }
export function formatTs(e) { if (!e) return '--'; return new Date(e).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) }

/**
 * 从阅读器 UI 树中查找图案锁屏区域的 bounds
 * 策略1: 匹配 LockPatternView / KeyguardPatternView 等特征类名或资源ID
 * 策略2: 找到近似正方形的大面积可交互节点（启发式检测）
 * 返回 { left, top, right, bottom } 或 null
 */
export function findPatternViewBounds(readerData) {
  const patternKeywords = [
    'LockPatternView',
    'KeyguardPatternView',
    'PatternLockView',
    'lock_pattern',
    'lockPattern',
    'patternView',
    'pattern_lock',
  ]

  const root = getReaderRoot(readerData)
  if (!root) return null

  let exactMatch = null
  let bestInteractiveSquare = null // 阅读器中实际画出绿色边框的可交互正方形
  let bestSquare = null

  function walk(node) {
    if (!node || typeof node !== 'object') return null
    const type = node.type || node.className || ''
    const resId = node.resourceId || node.resource || node.id || ''
    const desc = node.description || node.contentDescription || ''
    const text = node.text || ''

    // 策略1: 记录精确类名匹配，但继续遍历子节点。
    // 某些系统的 LockPatternView bounds 会连同提示文字/紧急呼叫一起包住，不能直接用于点位。
    const isExactPatternNode = patternKeywords.some(kw =>
      type.includes(kw) || String(resId).includes(kw) || String(desc).includes(kw)
    )
    if (isExactPatternNode && !exactMatch && node.bounds && typeof node.bounds.left === 'number') {
      exactMatch = node.bounds
    }

    // 策略2: 收集近似正方形的大面积节点（可能是图案区域）
    if (node.bounds && typeof node.bounds.left === 'number') {
      const b = node.bounds
      const w = b.right - b.left
      const h = b.bottom - b.top
      const ratio = w / (h || 1)
      // 近似正方形（宽高比 0.8~1.2）且面积较大（宽度>200px）
      if (ratio >= 0.8 && ratio <= 1.2 && w > 200 && h > 200) {
        // 优先使用阅读器中显示绿色边框的可交互子节点，并排除可能过大的精确包装节点。
        if (!isExactPatternNode && (node.clickable || node.focusable) && (!bestInteractiveSquare || w > (bestInteractiveSquare.right - bestInteractiveSquare.left))) {
          bestInteractiveSquare = b
        }
        if (!isExactPatternNode && (!bestSquare || w > (bestSquare.right - bestSquare.left))) {
          bestSquare = b
        }
      }
    }

    // 递归子节点
    const children = node.children || node.nodes || []
    if (Array.isArray(children)) {
      for (const child of children) {
        walk(child)
      }
    }
    return null
  }

  walk(root)

  // 优先绿色可交互正方形，其次普通正方形，最后才使用可能偏大的精确包装节点。
  return bestInteractiveSquare || bestSquare || exactMatch
}

/**
 * 检测阅读器 UI 树是否处于图案锁屏界面
 * 检测特征文字："图案"、"pattern"、"绘制"、"解锁"
 */
export function isPatternLockScreen(readerData) {
  if (!readerData) return false
  const json = JSON.stringify(readerData)
  return json.includes('图案') || json.includes('Pattern') || json.includes('pattern') ||
    json.includes('绘制') || json.includes('Keyguard') || json.includes('LockScreen')
}
