# -*- coding: utf-8 -*-
"""
修首页 tab 工具栏两行布局（基于行内容匹配，忽略缩进差异）
"""
import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
lines = open(PATH, 'r', encoding='utf-8').read().split('\n')

# 找到工具栏区段：从 "<span style={{ width: 6, height: 6, borderRadius: '50%', background: readerActive"
# 这一行开始，到对应的 "</div>" 结束
start_idx = None
for i, line in enumerate(lines):
    if 'background: readerActive ? \'#52c41a\'' in line and 'borderRadius: \'50%\'' in line and '无障碍阅读器' not in line:
        # 这一行就是工具栏的第一个 span
        # 还要看后面几行：是不是紧接着就是 "无障碍阅读器"
        if i + 1 < len(lines) and '无障碍阅读器' in lines[i+1]:
            start_idx = i
            break

if start_idx is None:
    print('FAIL: 没找到工具栏起始行（"无障碍阅读器" 标题前一行的圆点）')
    sys.exit(1)

print(f'工具栏起始行: {start_idx + 1}')

# 找到工具栏区段结束：从 start_idx 开始往后找，找到第一个 "</div>" 单独成行
end_idx = None
for j in range(start_idx, min(start_idx + 50, len(lines))):
    if lines[j].strip() == '</div>':
        end_idx = j
        break

if end_idx is None:
    print('FAIL: 没找到工具栏结束 </div>')
    sys.exit(1)

print(f'工具栏结束行: {end_idx + 1}')
print(f'共 {end_idx - start_idx + 1} 行')

# 取 start_idx 前面的缩进（用第一个 span 行的缩进）
import re as _re
m = _re.match(r'^(\s*)', lines[start_idx])
indent = m.group(1) if m else ''
sub_indent = indent + '  '
print(f'缩进: {len(indent)} 空格')

# 构造新的三段
new_block = [
    f'{indent}{{/* ★ 2026-08-06 v4：阅读器工具栏改成两行布局（与木马控制tab一致） */}}',
    f'{indent}<div style={{{{ display: \'flex\', alignItems: \'center\', gap: 6, padding: \'4px 8px\', background: \'#1f1f1f\', borderRadius: 6, border: \'1px solid #303030\' }}}}>',
    f'{sub_indent}<span style={{{{ width: 6, height: 6, borderRadius: \'50%\', background: readerActive ? \'#52c41a\' : \'#555\' }}}} />',
    f'{sub_indent}<span style={{{{ fontSize: 12, color: \'rgba(255,255,255,0.65)\', fontWeight: 500 }}}}>无障碍阅读器</span>',
    f'{sub_indent}<span style={{{{ color: readerActive ? \'#52c41a\' : \'rgba(255,255,255,0.35)\', fontSize: 10, marginLeft: \'auto\' }}}}>{{readerActive ? \'● 已连接\' : \'— 未开启\'}}</span>',
    f'{sub_indent}<button type="button" onClick={{toggleReader}} style={{{{ padding: \'3px 10px\', border: \'1px solid #303030\', borderRadius: 4, fontSize: 10, cursor: \'pointer\', fontWeight: 500, background: \'#141414\', color: readerActive ? \'#ff4d4f\' : \'#1677ff\' }}}}>{{readerActive ? \'✕ 关闭\' : \'▶ 开启\'}}</button>',
    f'{indent}</div>',
    f'{indent}{{/* ★ 第一行：背景 + 字色 + 重置 */}}',
    f'{indent}<div style={{{{ display: \'flex\', alignItems: \'center\', gap: 6, padding: \'4px 8px\', background: \'#1f1f1f\', borderRadius: 6, border: \'1px solid #303030\' }}}}>',
    f'{sub_indent}<span style={{{{ fontSize: 11, color: \'#aaa\' }}}}>背景</span>',
    f'{sub_indent}<input type="color" value={{readerBgColor}} onChange={{e => setReaderBgColor(e.target.value)}} title="阅读器背景色" style={{{{ width: 22, height: 22, border: \'none\', cursor: \'pointer\', borderRadius: 3, padding: 0, background: \'transparent\' }}}} />',
    f'{sub_indent}<span style={{{{ fontSize: 11, color: \'#aaa\' }}}}>字色</span>',
    f'{sub_indent}<input type="color" value={{readerTextColor}} onChange={{e => setReaderTextColor(e.target.value)}} title="阅读器文字颜色" style={{{{ width: 22, height: 22, border: \'none\', cursor: \'pointer\', borderRadius: 3, padding: 0, background: \'transparent\' }}}} />',
    f'{sub_indent}<button type="button" onClick={{() => {{ setReaderBgColor(\'#000000\'); setReaderTextColor(\'#e1ff00\'); setReaderFontSize(12) }}}} title="重置阅读器样式为默认" style={{{{ padding: \'2px 8px\', fontSize: 10, border: \'1px solid #ff4d4f\', borderRadius: 3, background: \'rgba(255,77,79,.15)\', color: \'#ff7875\', cursor: \'pointer\', fontWeight: 500 }}}}>重置</button>',
    f'{indent}</div>',
    f'{indent}{{/* ★ 第二行：字号 + 翻译（最右） */}}',
    f'{indent}<div style={{{{ display: \'flex\', alignItems: \'center\', gap: 6, padding: \'4px 8px\', background: \'#1f1f1f\', borderRadius: 6, border: \'1px solid #303030\' }}}}>',
    f'{sub_indent}<span style={{{{ fontSize: 11, color: \'#aaa\' }}}}>字号</span>',
    f'{sub_indent}<input type="range" min="5" max="20" value={{readerFontSize}} onChange={{e => setReaderFontSize(parseInt(e.target.value))}} title="阅读器字号" style={{{{ width: 60, cursor: \'pointer\' }}}} />',
    f'{sub_indent}<span style={{{{ fontSize: 11, color: \'#aaa\', minWidth: 18, textAlign: \'center\' }}}}>{{readerFontSize}}</span>',
    f'{sub_indent}{{readerActive && readerData && <button type="button" onClick={{translateReaderData}} disabled={{readerTranslating}} style={{{{ marginLeft: \'auto\', padding: \'3px 10px\', border: \'1px solid #303030\', borderRadius: 4, fontSize: 10, cursor: readerTranslating ? \'wait\' : \'pointer\', fontWeight: 500, background: \'#141414\', color: \'#1677ff\' }}}}>{{readerTranslating ? \'翻译中...\' : \'🌐 翻译\'}}</button>}}',
]

# 替换 lines[start_idx : end_idx+1] 为 new_block
new_lines = lines[:start_idx] + new_block + lines[end_idx+1:]
open(PATH, 'w', encoding='utf-8').write('\n'.join(new_lines))
print(f'OK: 工具栏重排成两行（{len(new_block)} 行替换原 {end_idx - start_idx + 1} 行）')
print('DONE')