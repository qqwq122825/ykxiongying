export function toast(message, type) {
  const el = document.createElement('div')
  el.className = 'fc-toast' + (type === 'error' ? ' err' : '')
  el.textContent = message
  document.body.appendChild(el)
  requestAnimationFrame(() => el.classList.add('show'))
  setTimeout(() => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 300)
  }, 2500)
}

/**
 * 屏幕中央短暂弹框（1 秒后自动关闭）
 * 用于快捷操作的即时反馈，例如 "屏幕已锁定"
 */
export function centerToast(message, type = 'info', duration = 1000) {
  // 同一时刻只保留一个中央提示
  document.querySelectorAll('.fc-center-toast').forEach((n) => n.remove())
  const el = document.createElement('div')
  el.className = 'fc-center-toast' + (type === 'error' ? ' err' : type === 'success' ? ' ok' : '')
  el.textContent = message
  document.body.appendChild(el)
  requestAnimationFrame(() => el.classList.add('show'))
  setTimeout(() => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 250)
  }, duration)
}


