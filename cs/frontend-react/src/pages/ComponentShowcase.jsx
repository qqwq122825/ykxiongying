import { useState, useEffect } from 'react'

/**
 * 组件示例页 · 黑洞科技设计系统 v2.0
 * 用于验证 design-tokens.css + components.css 的视觉效果
 * 访问路径：?page=showcase
 *
 * 此页面不参与业务逻辑，仅作为"活文档"
 */

// 模拟数据
const fakeDevices = [
  { id: 1, name: 'Pixel-7-001', status: 'online',  battery: 87, owner: 'admin',    group: '主力' },
  { id: 2, name: 'Galaxy-S23',  status: 'online',  battery: 42, owner: 'admin',    group: '备用' },
  { id: 3, name: 'Mi-13-Pro',   status: 'offline', battery:  0, owner: 'user1',    group: '测试' },
  { id: 4, name: 'OnePlus-11',  status: 'warn',    battery: 15, owner: 'admin',    group: '主力' },
  { id: 5, name: 'iPhone-15',   status: 'online',  battery: 99, owner: 'user2',    group: '苹果' },
]

const fakeUsers = [
  { name: '管理员', initials: 'AD', color: 'primary' },
  { name: '张三',   initials: 'ZS', color: 'success' },
  { name: '李四',   initials: 'LS', color: 'warn' },
  { name: '王五',   initials: 'WW', color: 'danger' },
]

export default function ComponentShowcase() {
  const [tab, setTab] = useState('overview')
  const [theme, setTheme] = useState(() => localStorage.getItem('fc_theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('fc_theme', theme)
  }, [theme])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--fc-bg)', color: 'var(--fc-text)' }}>
      {/* ========================= 顶部栏 ========================= */}
      <header className="fc-flex fc-items-center fc-justify-between" style={{
        height: 56,
        padding: '0 var(--fc-space-6)',
        background: 'var(--fc-surface)',
        borderBottom: '1px solid var(--fc-border)',
        position: 'sticky',
        top: 0,
        zIndex: 'var(--fc-z-sticky)',
      }}>
        <div className="fc-flex fc-items-center fc-gap-3">
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'var(--fc-grad-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: 13,
          }}>黑</div>
          <strong style={{ color: 'var(--fc-text-hi)', fontSize: 15 }}>设计系统 v2.0</strong>
          <span className="fc-tag fc-tag--neutral">深石板 · 钢蓝</span>
        </div>

        <div className="fc-flex fc-items-center fc-gap-3">
          <span className="fc-text-mute fc-text-sm">主题</span>
          <button
            className={`fc-btn fc-btn--sm ${theme === 'dark' ? 'fc-btn--primary' : 'fc-btn--secondary'}`}
            onClick={() => setTheme('dark')}
          >暗色</button>
          <button
            className={`fc-btn fc-btn--sm ${theme === 'light' ? 'fc-btn--primary' : 'fc-btn--secondary'}`}
            onClick={() => setTheme('light')}
          >亮色</button>
        </div>
      </header>

      {/* ========================= 主体 ========================= */}
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: 'var(--fc-space-7) var(--fc-space-6)' }}>

        {/* 标题区 */}
        <div style={{ marginBottom: 'var(--fc-space-7)' }}>
          <h1 style={{
            fontSize: 'var(--fc-text-3xl)',
            fontWeight: 700,
            color: 'var(--fc-text-hi)',
            margin: '0 0 var(--fc-space-2)',
            letterSpacing: '-0.01em',
          }}>组件示例</h1>
          <p className="fc-text-lo" style={{ margin: 0 }}>
            design-tokens.css + components.css 的视觉验证。点击切换主题，观察令牌联动效果。
          </p>
        </div>

        {/* Tabs */}
        <div className="fc-tabs">
          <div className="fc-tabs-list" role="tablist">
            <button className={`fc-tab ${tab==='overview' ? 'is-active' : ''}`} onClick={() => setTab('overview')}>总览</button>
            <button className={`fc-tab ${tab==='form' ? 'is-active' : ''}`} onClick={() => setTab('form')}>表单</button>
            <button className={`fc-tab ${tab==='data' ? 'is-active' : ''}`} onClick={() => setTab('data')}>数据</button>
            <button className={`fc-tab ${tab==='feedback' ? 'is-active' : ''}`} onClick={() => setTab('feedback')}>反馈</button>
            <button className={`fc-tab ${tab==='colors' ? 'is-active' : ''}`} onClick={() => setTab('colors')}>色板</button>
          </div>

          {/* ===== TAB 1: 总览 ===== */}
          {tab === 'overview' && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--fc-space-6)' }}>

              {/* 统计卡片 */}
              <div>
                <h2 className="fc-text-hi" style={{ fontSize: 'var(--fc-text-lg)', margin: '0 0 var(--fc-space-4)' }}>统计卡片</h2>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 'var(--fc-space-4)',
                }}>
                  <div className="fc-stat">
                    <div className="fc-stat-label">
                      <span className="fc-dot is-online" />在线设备
                    </div>
                    <div className="fc-stat-value">128</div>
                    <div className="fc-stat-delta fc-stat-delta--up">↑ 12 较昨日</div>
                  </div>
                  <div className="fc-stat">
                    <div className="fc-stat-label">
                      <span className="fc-dot is-offline" />离线设备
                    </div>
                    <div className="fc-stat-value">23</div>
                    <div className="fc-stat-delta fc-stat-delta--down">↓ 3 较昨日</div>
                  </div>
                  <div className="fc-stat">
                    <div className="fc-stat-label">
                      <span className="fc-dot is-warn" />低电量
                    </div>
                    <div className="fc-stat-value">7</div>
                    <div className="fc-stat-delta fc-stat-delta--flat">— 持平</div>
                  </div>
                  <div className="fc-stat">
                    <div className="fc-stat-label">
                      <span className="fc-dot is-danger" />异常
                    </div>
                    <div className="fc-stat-value">2</div>
                    <div className="fc-stat-delta fc-stat-delta--down">↑ 1 需关注</div>
                  </div>
                </div>
              </div>

              {/* 按钮 */}
              <div>
                <h2 className="fc-text-hi" style={{ fontSize: 'var(--fc-text-lg)', margin: '0 0 var(--fc-space-4)' }}>按钮</h2>
                <div className="fc-card">
                  <div className="fc-card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fc-space-3)' }}>
                    <button className="fc-btn fc-btn--primary">主要按钮</button>
                    <button className="fc-btn fc-btn--secondary">次要按钮</button>
                    <button className="fc-btn fc-btn--ghost">幽灵按钮</button>
                    <button className="fc-btn fc-btn--accent">强调按钮</button>
                    <button className="fc-btn fc-btn--danger">危险操作</button>
                    <button className="fc-btn fc-btn--link">链接按钮</button>
                    <button className="fc-btn fc-btn--primary" disabled>禁用</button>
                  </div>
                  <div className="fc-card-footer">
                    <span className="fc-text-mute fc-text-sm">尺寸</span>
                    <div className="fc-flex fc-gap-3">
                      <button className="fc-btn fc-btn--primary fc-btn--sm">小</button>
                      <button className="fc-btn fc-btn--primary">默认</button>
                      <button className="fc-btn fc-btn--primary fc-btn--lg">大</button>
                      <button className="fc-btn fc-btn--primary fc-btn--icon fc-btn--sm" data-tip="刷新"><span>↻</span></button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 标签 + 徽章 + 头像 */}
              <div>
                <h2 className="fc-text-hi" style={{ fontSize: 'var(--fc-text-lg)', margin: '0 0 var(--fc-space-4)' }}>标签 / 徽章 / 头像</h2>
                <div className="fc-card">
                  <div className="fc-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--fc-space-4)' }}>
                    <div className="fc-flex fc-gap-2" style={{ flexWrap: 'wrap' }}>
                      <span className="fc-tag fc-tag--primary">主要</span>
                      <span className="fc-tag fc-tag--success">成功</span>
                      <span className="fc-tag fc-tag--warn">警告</span>
                      <span className="fc-tag fc-tag--danger">危险</span>
                      <span className="fc-tag fc-tag--neutral">中性</span>
                    </div>
                    <div className="fc-flex fc-gap-3 fc-items-center">
                      <span>通知</span>
                      <span className="fc-badge fc-badge--primary">12</span>
                      <span className="fc-badge fc-badge--danger">99+</span>
                      <span className="fc-badge fc-badge--success">新</span>
                    </div>
                    <div className="fc-flex fc-gap-3 fc-items-center">
                      <div className="fc-avatar-group">
                        {fakeUsers.map((u, i) => (
                          <div key={i} className="fc-avatar fc-avatar--lg" title={u.name}>{u.initials}</div>
                        ))}
                      </div>
                      <span className="fc-text-mute fc-text-sm">头像组（自动堆叠）</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ===== TAB 2: 表单 ===== */}
          {tab === 'form' && (
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--fc-space-5)' }}>

              <div className="fc-card">
                <div className="fc-card-header">
                  <div>
                    <h3 className="fc-card-title">基础输入</h3>
                    <p className="fc-card-subtitle">文本框 / 选择器 / 文���域</p>
                  </div>
                </div>
                <div className="fc-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--fc-space-4)' }}>
                  <div className="fc-field">
                    <label className="fc-field-label">设备名称</label>
                    <input className="fc-input" placeholder="如：Pixel-7-001" />
                    <span className="fc-field-hint">支持中英文、数字、连字符</span>
                  </div>
                  <div className="fc-field">
                    <label className="fc-field-label">分组</label>
                    <select className="fc-select">
                      <option>主力</option>
                      <option>备用</option>
                      <option>测试</option>
                    </select>
                  </div>
                  <div className="fc-field">
                    <label className="fc-field-label">备注</label>
                    <textarea className="fc-textarea" placeholder="可选" />
                  </div>
                  <div className="fc-field">
                    <label className="fc-field-label">邮箱（无效示例）</label>
                    <input className="fc-input is-invalid" defaultValue="not-an-email" />
                    <span className="fc-field-error">⚠ 邮箱格式不正确</span>
                  </div>
                </div>
              </div>

              <div className="fc-card">
                <div className="fc-card-header">
                  <div>
                    <h3 className="fc-card-title">选择控件</h3>
                    <p className="fc-card-subtitle">复选框 / 开关</p>
                  </div>
                </div>
                <div className="fc-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--fc-space-4)' }}>
                  <label className="fc-check">
                    <input type="checkbox" defaultChecked />
                    <span className="fc-check-box" />
                    <span>启用自动注入</span>
                  </label>
                  <label className="fc-check">
                    <input type="checkbox" />
                    <span className="fc-check-box" />
                    <span>接收实时通知</span>
                  </label>
                  <label className="fc-check">
                    <input type="checkbox" disabled />
                    <span className="fc-check-box" />
                    <span className="fc-text-mute">禁用项</span>
                  </label>

                  <hr className="fc-divider" />

                  <label className="fc-switch">
                    <input type="checkbox" defaultChecked />
                    <span className="fc-switch-track" />
                    <span>截屏保护</span>
                  </label>
                  <label className="fc-switch">
                    <input type="checkbox" />
                    <span className="fc-switch-track" />
                    <span>调试模式</span>
                  </label>

                  <hr className="fc-divider" />

                  <div className="fc-flex fc-gap-2 fc-items-center" style={{ flexWrap: 'wrap' }}>
                    <span className="fc-text-mute fc-text-sm">快捷键</span>
                    <span className="fc-kbd">⌘</span>
                    <span className="fc-kbd">K</span>
                  </div>
                </div>
              </div>

            </section>
          )}

          {/* ===== TAB 3: 数据 ===== */}
          {tab === 'data' && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--fc-space-5)' }}>

              <div className="fc-card">
                <div className="fc-card-header">
                  <div>
                    <h3 className="fc-card-title">设备列表</h3>
                    <p className="fc-card-subtitle">表格组件</p>
                  </div>
                  <div className="fc-flex fc-gap-2">
                    <button className="fc-btn fc-btn--sm fc-btn--secondary">导出</button>
                    <button className="fc-btn fc-btn--sm fc-btn--primary">+ 新增</button>
                  </div>
                </div>
                <div className="fc-table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                  <table className="fc-table">
                    <thead>
                      <tr>
                        <th>名称</th>
                        <th>状态</th>
                        <th>电量</th>
                        <th>归属</th>
                        <th>分组</th>
                        <th style={{ textAlign: 'right' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fakeDevices.map(d => (
                        <tr key={d.id}>
                          <td>
                            <div className="fc-flex fc-items-center fc-gap-3">
                              <div className="fc-avatar fc-avatar--sm">{d.name[0]}</div>
                              <span className="fc-text-hi fc-font-mono">{d.name}</span>
                            </div>
                          </td>
                          <td>
                            {d.status === 'online' && <span className="fc-tag fc-tag--success"><span className="fc-dot is-online" />在线</span>}
                            {d.status === 'offline' && <span className="fc-tag fc-tag--neutral"><span className="fc-dot is-offline" />离线</span>}
                            {d.status === 'warn' && <span className="fc-tag fc-tag--warn"><span className="fc-dot is-warn" />低电</span>}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
                              <div className={`fc-progress ${d.battery < 20 ? 'fc-progress--warn' : ''}`} style={{ flex: 1 }}>
                                <div className="fc-progress-bar" style={{ width: `${d.battery}%` }} />
                              </div>
                              <span className="fc-font-mono fc-text-sm" style={{ minWidth: 32, textAlign: 'right' }}>{d.battery}%</span>
                            </div>
                          </td>
                          <td><span className="fc-tag fc-tag--neutral">{d.owner}</span></td>
                          <td>{d.group}</td>
                          <td style={{ textAlign: 'right' }}>
                            <div className="fc-flex fc-gap-2" style={{ justifyContent: 'flex-end' }}>
                              <button className="fc-btn fc-btn--sm fc-btn--ghost" data-tip="编辑">✎</button>
                              <button className="fc-btn fc-btn--sm fc-btn--ghost" data-tip="删除">🗑</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 进度条 + 骨架 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--fc-space-5)' }}>
                <div className="fc-card">
                  <div className="fc-card-header"><h3 className="fc-card-title">进度条</h3></div>
                  <div className="fc-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--fc-space-3)' }}>
                    <div><div className="fc-text-mute fc-text-sm" style={{ marginBottom: 4 }}>默认 45%</div><div className="fc-progress"><div className="fc-progress-bar" style={{ width: '45%' }} /></div></div>
                    <div><div className="fc-text-mute fc-text-sm" style={{ marginBottom: 4 }}>成功 78%</div><div className="fc-progress fc-progress--success"><div className="fc-progress-bar" style={{ width: '78%' }} /></div></div>
                    <div><div className="fc-text-mute fc-text-sm" style={{ marginBottom: 4 }}>警告 92%</div><div className="fc-progress fc-progress--warn"><div className="fc-progress-bar" style={{ width: '92%' }} /></div></div>
                  </div>
                </div>
                <div className="fc-card">
                  <div className="fc-card-header"><h3 className="fc-card-title">骨架屏</h3></div>
                  <div className="fc-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--fc-space-3)' }}>
                    <div className="fc-skeleton" style={{ width: '40%', height: 18 }} />
                    <div className="fc-skeleton" style={{ width: '90%' }} />
                    <div className="fc-skeleton" style={{ width: '75%' }} />
                    <div className="fc-skeleton" style={{ width: '85%' }} />
                  </div>
                </div>
              </div>

              {/* 空状态 */}
              <div className="fc-card">
                <div className="fc-empty">
                  <svg className="fc-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="4" width="18" height="14" rx="2" />
                    <path d="M3 10h18" />
                    <circle cx="8" cy="15" r="1" />
                  </svg>
                  <h3 className="fc-empty-title">暂无设备</h3>
                  <p className="fc-empty-desc">当前分组下还没有绑定设备，请先添加或切换分组</p>
                  <button className="fc-btn fc-btn--primary">+ 添加设备</button>
                </div>
              </div>

            </section>
          )}

          {/* ===== TAB 4: 反馈 ===== */}
          {tab === 'feedback' && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--fc-space-4)' }}>
              <div className="fc-alert fc-alert--info">
                <span className="fc-alert-icon">ℹ</span>
                <div>
                  <div className="fc-alert-title">提示</div>
                  <div>所有组件样式都引用 design-tokens.css 中的 CSS 变量。</div>
                </div>
              </div>
              <div className="fc-alert fc-alert--success">
                <span className="fc-alert-icon">✓</span>
                <div>
                  <div className="fc-alert-title">操作成功</div>
                  <div>设备已成功绑定到「主力」分组。</div>
                </div>
              </div>
              <div className="fc-alert fc-alert--warn">
                <span className="fc-alert-icon">⚠</span>
                <div>
                  <div className="fc-alert-title">注意</div>
                  <div>当前设备电量低于 20%，建议尽快充电。</div>
                </div>
              </div>
              <div className="fc-alert fc-alert--danger">
                <span className="fc-alert-icon">✕</span>
                <div>
                  <div className="fc-alert-title">错误</div>
                  <div>连接超时，请检查网络后重试。</div>
                </div>
              </div>

              <div className="fc-card">
                <div className="fc-card-header"><h3 className="fc-card-title">加载状态</h3></div>
                <div className="fc-card-body fc-flex fc-items-center fc-gap-4">
                  <span className="fc-spinner" />
                  <span className="fc-spinner fc-spinner--lg" />
                  <span className="fc-text-lo fc-text-sm">数据加载中…</span>
                </div>
              </div>
            </section>
          )}

          {/* ===== TAB 5: 色板 ===== */}
          {tab === 'colors' && (
            <section>
              <h2 className="fc-text-hi" style={{ fontSize: 'var(--fc-text-lg)', margin: '0 0 var(--fc-space-4)' }}>设计令牌色板</h2>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 'var(--fc-space-3)',
              }}>
                <ColorChip name="bg"          var="--fc-bg"          text="页面底" />
                <ColorChip name="surface"     var="--fc-surface"     text="卡片" />
                <ColorChip name="surface-hi"  var="--fc-surface-hi"  text="悬浮" />
                <ColorChip name="elevated"    var="--fc-elevated"    text="弹层" />
                <ColorChip name="border"      var="--fc-border"      text="边框" />
                <ColorChip name="border-hi"   var="--fc-border-hi"   text="强调边" />
                <ColorChip name="primary"     var="--fc-primary"     text="主色" />
                <ColorChip name="primary-hi"  var="--fc-primary-hi"  text="主色+1" />
                <ColorChip name="accent"      var="--fc-accent"      text="强调金" />
                <ColorChip name="success"     var="--fc-success"     text="成功" />
                <ColorChip name="danger"      var="--fc-danger"      text="危险" />
                <ColorChip name="warn"        var="--fc-warn"        text="警告" />
                <ColorChip name="text-hi"     var="--fc-text-hi"     text="主文字" />
                <ColorChip name="text"        var="--fc-text"        text="正文" />
                <ColorChip name="text-lo"     var="--fc-text-lo"     text="辅助" />
                <ColorChip name="text-mute"   var="--fc-text-mute"   text="弱化" />
              </div>

              <h2 className="fc-text-hi" style={{ fontSize: 'var(--fc-text-lg)', margin: 'var(--fc-space-7) 0 var(--fc-space-4)' }}>阴影层级</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--fc-space-4)' }}>
                {['xs','sm','default','lg','xl'].map(s => (
                  <div key={s} style={{
                    background: 'var(--fc-surface)',
                    border: '1px solid var(--fc-border)',
                    borderRadius: 'var(--fc-radius-lg)',
                    padding: 'var(--fc-space-5)',
                    boxShadow: `var(--fc-shadow${s === 'default' ? '' : '-' + s})`,
                    textAlign: 'center',
                  }}>
                    <div className="fc-font-mono fc-text-sm" style={{ color: 'var(--fc-text-hi)' }}>shadow{s === 'default' ? '' : '-' + s}</div>
                    <div className="fc-text-mute fc-text-xs" style={{ marginTop: 4 }}>var(--fc-shadow{s === 'default' ? '' : '-' + s})</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      {/* 底部 */}
      <footer style={{
        padding: 'var(--fc-space-6)',
        textAlign: 'center',
        color: 'var(--fc-text-mute)',
        fontSize: 'var(--fc-text-xs)',
        borderTop: '1px solid var(--fc-border-soft)',
        marginTop: 'var(--fc-space-9)',
      }}>
        黑洞科技 · 设备管理后台 · 设计系统 v2.0
      </footer>
    </div>
  )
}

/* —— 色板小卡 —— */
function ColorChip({ name, var: cssVar, text }) {
  return (
    <div style={{
      background: 'var(--fc-surface)',
      border: '1px solid var(--fc-border)',
      borderRadius: 'var(--fc-radius-md)',
      overflow: 'hidden',
    }}>
      <div style={{
        background: `var(${cssVar})`,
        height: 64,
        borderBottom: '1px solid var(--fc-border)',
      }} />
      <div style={{ padding: 'var(--fc-space-3)' }}>
        <div className="fc-font-mono fc-text-sm" style={{ color: 'var(--fc-text-hi)', fontWeight: 600 }}>{name}</div>
        <div className="fc-text-mute fc-text-xs" style={{ marginTop: 2 }}>{text}</div>
        <div className="fc-font-mono fc-text-xs" style={{ marginTop: 6, color: 'var(--fc-text-lo)', wordBreak: 'break-all' }}>{cssVar}</div>
      </div>
    </div>
  )
}