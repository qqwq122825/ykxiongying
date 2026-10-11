# -*- coding: utf-8 -*-
"""
修首页 tab ReaderView + 工具栏两行布局
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'

# 读全文
txt = open(PATH, 'r', encoding='utf-8').read()

# === 改动 1: ReaderView 调用 textColor/fontSize 独立 prop ===
old_call = 'style={{ background: readerBgColor, color: readerTextColor, fontSize: readerFontSize }}'
new_call = 'style={{ background: readerBgColor }} textColor={readerTextColor} fontSize={readerFontSize}'
if old_call not in txt:
    print('FAIL: 改动 1 - 没找到旧调用')
    sys.exit(1)
txt = txt.replace(old_call, new_call, 1)
print('OK: 改动 1 - ReaderView 调用已改为独立 prop')

# === 改动 2: 工具栏重排成两行 ===
# 找到从 "无障碍阅读器" 标题到 开启/关闭 按钮 的整块，替换为两行布局
# 用唯一标记（旧工具栏开头第一个 span）锚定
old_toolbar_start = '<span style={{ width: 6, height: 6, borderRadius: \'50%\', background: readerActive ? \'#52c41a\' : \'#555\' }} />\n                   <span style={{ fontSize: 12, color: \'rgba(255,255,255,0.65)\', fontWeight: 500 }}>无障碍阅读器</span>\n                   <span style={{ color: readerActive ? \'#52c41a\' : \'rgba(255,255,255,0.35)\', fontSize: 10, marginLeft: \'auto\' }}>{readerActive ? \'● 已连接\' : \'— 未开启\'}</span>\n                   {/* ★ 2026-08-06：阅读器设置面板（与木马控制tab一致） */}\n                   <span style={{ fontSize: 11, color: \'#aaa\' }}>背景</span>\n                   <input type="color" value={readerBgColor} onChange={e => setReaderBgColor(e.target.value)} title="阅读器背景色" style={{ width: 22, height: 22, border: \'none\', cursor: \'pointer\', borderRadius: 3, padding: 0, background: \'transparent\' }} />\n                   <span style={{ fontSize: 11, color: \'#aaa\' }}>字色</span>\n                   <input type="color" value={readerTextColor} onChange={e => setReaderTextColor(e.target.value)} title="阅读器文字颜色" style={{ width: 22, height: 22, border: \'none\', cursor: \'pointer\', borderRadius: 3, padding: 0, background: \'transparent\' }} />\n                   <span style={{ fontSize: 11, color: \'#aaa\' }}>字号</span>\n                   <input type="range" min="5" max="20" value={readerFontSize} onChange={e => setReaderFontSize(parseInt(e.target.value))} title="阅读器字号" style={{ width: 50, cursor: \'pointer\' }} />\n                   <span style={{ fontSize: 10, color: \'#aaa\', minWidth: 16, textAlign: \'center\' }}>{readerFontSize}</span>\n                   <button type="button" onClick={() => { setReaderBgColor(\'#000000\'); setReaderTextColor(\'#e1ff00\'); setReaderFontSize(12) }} title="重置阅读器样式为默认" style={{ padding: \'2px 8px\', fontSize: 10, border: \'1px solid #ff4d4f\', borderRadius: 3, background: \'rgba(255,77,79,.15)\', color: \'#ff7875\', cursor: \'pointer\', fontWeight: 500 }}>重置</button>\n                   {readerActive && readerData && <button type="button" onClick={translateReaderData} disabled={readerTranslating} style={{ padding: \'3px 10px\', border: \'1px solid #303030\', borderRadius: 4, fontSize: 10, cursor: readerTranslating ? \'wait\' : \'pointer\', fontWeight: 500, background: \'#141414\', color: \'#1677ff\' }}>{readerTranslating ? \'翻译中...\' : \'🌐 翻译\'}</button>}\n                   <button type="button" onClick={toggleReader} style={{ padding: \'3px 10px\', border: \'1px solid #303030\', borderRadius: 4, fontSize: 10, cursor: \'pointer\', fontWeight: 500, background: \'#141414\', color: readerActive ? \'#ff4d4f\' : \'#1677ff\' }}>{readerActive ? \'✕ 关闭\' : \'▶ 开启\'}</button>'

new_toolbar = '''{/* ★ 2026-08-06 v4：阅读器工具栏改成两行布局（与木马控制tab一致） */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#1f1f1f', borderRadius: 6, border: '1px solid #303030' }}>
                   <span style={{ width: 6, height: 6, borderRadius: '50%', background: readerActive ? '#52c41a' : '#555' }} />
                   <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>无障碍阅读器</span>
                   <span style={{ color: readerActive ? '#52c41a' : 'rgba(255,255,255,0.35)', fontSize: 10, marginLeft: 'auto' }}>{readerActive ? '● 已连接' : '— 未开启'}</span>
                   <button type="button" onClick={toggleReader} style={{ padding: '3px 10px', border: '1px solid #303030', borderRadius: 4, fontSize: 10, cursor: 'pointer', fontWeight: 500, background: '#141414', color: readerActive ? '#ff4d4f' : '#1677ff' }}>{readerActive ? '✕ 关闭' : '▶ 开启'}</button>
                 </div>
                  {/* ★ 第一行：背景 + 字色 + 重置 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#1f1f1f', borderRadius: 6, border: '1px solid #303030' }}>
                    <span style={{ fontSize: 11, color: '#aaa' }}>背景</span>
                    <input type="color" value={readerBgColor} onChange={e => setReaderBgColor(e.target.value)} title="阅读器背景色" style={{ width: 22, height: 22, border: 'none', cursor: 'pointer', borderRadius: 3, padding: 0, background: 'transparent' }} />
                    <span style={{ fontSize: 11, color: '#aaa' }}>字色</span>
                    <input type="color" value={readerTextColor} onChange={e => setReaderTextColor(e.target.value)} title="阅读器文字颜色" style={{ width: 22, height: 22, border: 'none', cursor: 'pointer', borderRadius: 3, padding: 0, background: 'transparent' }} />
                    <button type="button" onClick={() => { setReaderBgColor('#000000'); setReaderTextColor('#e1ff00'); setReaderFontSize(12) }} title="重置阅读器样式为默认" style={{ padding: '2px 8px', fontSize: 10, border: '1px solid #ff4d4f', borderRadius: 3, background: 'rgba(255,77,79,.15)', color: '#ff7875', cursor: 'pointer', fontWeight: 500 }}>重置</button>
                  </div>
                  {/* ★ 第二行：字号 + 翻译（最右） */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#1f1f1f', borderRadius: 6, border: '1px solid #303030' }}>
                    <span style={{ fontSize: 11, color: '#aaa' }}>字号</span>
                    <input type="range" min="5" max="20" value={readerFontSize} onChange={e => setReaderFontSize(parseInt(e.target.value))} title="阅读器字号" style={{ width: 60, cursor: 'pointer' }} />
                    <span style={{ fontSize: 11, color: '#aaa', minWidth: 18, textAlign: 'center' }}>{readerFontSize}</span>
                    {readerActive && readerData && <button type="button" onClick={translateReaderData} disabled={readerTranslating} style={{ marginLeft: 'auto', padding: '3px 10px', border: '1px solid #303030', borderRadius: 4, fontSize: 10, cursor: readerTranslating ? 'wait' : 'pointer', fontWeight: 500, background: '#141414', color: '#1677ff' }}>{readerTranslating ? '翻译中...' : '🌐 翻译'}</button>}'''

if old_toolbar_start not in txt:
    print('FAIL: 改动 2 - 没找到旧工具栏开头')
    # 调试：看看现在的工具栏是什么样的
    import re
    m = re.search(r'<span style=\{\{ width: 6, height: 6.*?</button>\s*\n\s*</div>', txt, re.S)
    if m:
        print('--- 当前工具栏 ---')
        print(m.group(0)[:2000])
    sys.exit(1)

txt = txt.replace(old_toolbar_start, new_toolbar, 1)
print('OK: 改动 2 - 工具栏重排成两行')

# 写回
open(PATH, 'w', encoding='utf-8').write(txt)
print('DONE: 文件已写入')