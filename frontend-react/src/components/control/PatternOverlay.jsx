/**
 * PatternOverlay — 图案密码九宫格覆盖层
 * 
 * 在阅读器画面上叠加显示九宫格点位和连线路径，
 * 根据 UI 树中 PatternView 的实际 bounds 精确定位。
 */
import { useMemo, useState } from 'react'

/**
 * 计算九宫格 9 个点的设备坐标
 * @param {Object} bounds - PatternView 的 bounds {left, top, right, bottom}
 * @returns {Array} 9 个点的坐标数组，索引 0~8 对应位置 1~9
 */
function calcPatternPoints(bounds) {
  const w = bounds.right - bounds.left
  const h = bounds.bottom - bounds.top
  // 九宫格均匀分布在 bounds 内，边距约 1/8
  const padX = w / 8
  const padY = h / 8
  const stepX = (w - 2 * padX) / 2
  const stepY = (h - 2 * padY) / 2

  const points = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      points.push({
        x: bounds.left + padX + col * stepX,
        y: bounds.top + padY + row * stepY,
      })
    }
  }
  return points
}

/**
 * @param {Object} props
 * @param {Object} props.patternBounds - UI 树中 PatternView 的 bounds {left,top,right,bottom}
 * @param {string} props.pattern - 图案密码字符串（+1后的值，1-9）
 * @param {Object} props.screenBounds - 阅读器 root 的 bounds（整个屏幕范围）
 */
export default function PatternOverlay({ patternBounds, pattern, screenBounds }) {
  const [hidden, setHidden] = useState(false)

  // 计算九宫格点位和路径
  const { points, path, sw, sh } = useMemo(() => {
    if (!patternBounds || !screenBounds) return { points: [], path: [], sw: 1, sh: 1 }
    const pts = calcPatternPoints(patternBounds)
    // 解析密码路径：每个字符是 1-9，转为 0-8 索引
    const pathIndices = pattern ? pattern.split('').map(c => parseInt(c, 10) - 1).filter(i => i >= 0 && i < 9) : []
    return {
      points: pts,
      path: pathIndices,
      sw: Math.max(1, screenBounds.right - screenBounds.left),
      sh: Math.max(1, screenBounds.bottom - screenBounds.top),
    }
  }, [patternBounds, pattern, screenBounds])

  if (hidden || !points.length) return null

  // 坐标转换：设备坐标 → 百分比（相对于阅读器容器）
  const toPercent = (x, y) => ({
    px: ((x - screenBounds.left) / sw) * 100,
    py: ((y - screenBounds.top) / sh) * 100,
  })

  // 点的半径（相对于容器宽度的百分比）
  const dotRadius = Math.min((patternBounds.right - patternBounds.left) / sw * 100 / 12, 2)

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
        overflow: 'hidden',
      }}
    >
      {/* 隐藏按钮 */}
      <button
        onClick={() => setHidden(true)}
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          zIndex: 20,
          pointerEvents: 'auto',
          background: 'rgba(0,0,0,.6)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,.3)',
          borderRadius: 4,
          padding: '2px 6px',
          fontSize: 10,
          cursor: 'pointer',
        }}
        title="隐藏图案覆盖层"
      >
        ✕ 隐藏图案
      </button>

      {/* SVG 覆盖层 */}
      <svg
        viewBox={`0 0 100 100`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        {/* 连线 */}
        {path.map((ptIdx, i) => {
          if (i === 0) return null
          const prevIdx = path[i - 1]
          const from = toPercent(points[prevIdx].x, points[prevIdx].y)
          const to = toPercent(points[ptIdx].x, points[ptIdx].y)
          return (
            <line
              key={`line-${i}`}
              x1={from.px}
              y1={from.py}
              x2={to.px}
              y2={to.py}
              stroke="rgba(0, 200, 255, 0.8)"
              strokeWidth="0.4"
              strokeLinecap="round"
            />
          )
        })}

        {/* 所有 9 个点 */}
        {points.map((pt, i) => {
          const { px, py } = toPercent(pt.x, pt.y)
          const isInPath = path.includes(i)
          const isStart = path[0] === i
          const isEnd = path[path.length - 1] === i
          const orderInPath = path.indexOf(i)

          let fill = 'rgba(255,255,255,0.3)' // 未经过的点
          if (isStart) fill = 'rgba(0, 255, 100, 0.9)' // 起点绿色
          else if (isEnd) fill = 'rgba(255, 80, 80, 0.9)' // 终点红色
          else if (isInPath) fill = 'rgba(0, 200, 255, 0.9)' // 路径中的点蓝色

          return (
            <g key={`dot-${i}`}>
              {/* 外圈 */}
              <circle
                cx={px}
                cy={py}
                r={dotRadius}
                fill="none"
                stroke={isInPath ? fill : 'rgba(255,255,255,0.2)'}
                strokeWidth="0.2"
              />
              {/* 内圆 */}
              <circle
                cx={px}
                cy={py}
                r={dotRadius * 0.5}
                fill={fill}
              />
              {/* 序号标签 */}
              {isInPath && (
                <text
                  x={px + dotRadius * 1.3}
                  y={py - dotRadius * 0.8}
                  fontSize={dotRadius * 1.2}
                  fill="rgba(255,255,0,0.9)"
                  fontWeight="bold"
                >
                  {orderInPath + 1}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* 底部路径文字提示 */}
      <div
        style={{
          position: 'absolute',
          bottom: 4,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,.7)',
          color: pattern ? '#0cf' : '#fbbf24',
          padding: '3px 10px',
          borderRadius: 4,
          fontSize: 11,
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
        }}
      >
        {pattern ? `🔳 图案: ${pattern.split('').join('→')}` : '🔳 图案锁屏（密码未获取）'}
      </div>
    </div>
  )
}
