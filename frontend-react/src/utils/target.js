/**
 * 目标选择器（Target Selector）工具
 * 用于在设备屏幕上选择点击目标
 */

/**
 * 根据屏幕分辨率计算点击坐标
 */
export function calculateCoordinates(clientX, clientY, element, deviceWidth = 1080, deviceHeight = 2400) {
  const rect = element.getBoundingClientRect()
  const scale = Math.min(rect.width / deviceWidth, rect.height / deviceHeight)
  const viewW = deviceWidth * scale
  const viewH = deviceHeight * scale
  const offX = (rect.width - viewW) / 2
  const offY = (rect.height - viewH) / 2

  return {
    x: Math.max(0, Math.min(deviceWidth, Math.round((clientX - rect.left - offX) / scale))),
    y: Math.max(0, Math.min(deviceHeight, Math.round((clientY - rect.top - offY) / scale))),
  }
}

/**
 * 判断是否为滑动操作（距离大于阈值）
 */
export function isSwipe(startX, startY, endX, endY, threshold = 8) {
  const dist = Math.hypot(endX - startX, endY - startY)
  return dist > threshold
}

/**
 * 生成滑动路径（贝塞尔曲线）
 */
export function generateSwipePath(startX, startY, endX, endY, steps = 5) {
  const path = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = Math.round(startX + (endX - startX) * t)
    const y = Math.round(startY + (endY - startY) * t)
    path.push({ x, y })
  }
  return path
}

/**
 * 坐标格式化
 */
export function formatCoordinates(x, y) {
  return `(${x}, ${y})`
}
