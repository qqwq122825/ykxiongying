# -*- coding: utf-8 -*-
"""
修复 ReaderView props + 工具栏 div 闭合
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
lines = open(PATH, 'r', encoding='utf-8').read().split('\n')

# === 修复 1: PC 端 ReaderView (2314) style 改为独立 prop ===
# 当前：style={{ background: readerBgColor, color: readerTextColor, fontSize: readerFontSize }}
# 改为：style={{ background: readerBgColor }} textColor={readerTextColor} fontSize={readerFontSize}
for i, line in enumerate(lines):
    if 'style={{ background: readerBgColor, color: readerTextColor, fontSize: readerFontSize }}' in line:
        lines[i] = line.replace(
            'style={{ background: readerBgColor, color: readerTextColor, fontSize: readerFontSize }}',
            'style={{ background: readerBgColor }} textColor={readerTextColor} fontSize={readerFontSize}'
        )
        print(f'OK 修复 1: PC 端 ReaderView 调用 - 行 {i+1}')

# === 修复 2: 移动端 ReaderView (2272 行 /> 闭合前加 props) ===
# 在 "                          />" 这一行（行 2272）前插入一行 props
# 2272 行内容: "                          />"
# 插入位置: 2271 行后 (原 onGesture }} 后面)
for i, line in enumerate(lines):
    # 找到移动端 ReaderView 的 /> 闭合行
    # 特征：开头 26 个空格后是 />
    if line.rstrip() == '                          />':
        # 检查上一行是不是 "}}" 结尾
        prev = lines[i-1].rstrip() if i > 0 else ''
        if prev.endswith('}}'):
            # 还要确认这是 ReaderView 的闭合（附近有 onGesture）
            # 检查 i-1 ~ i-15 范围有没有 "onGesture"
            found_gesture = False
            for j in range(max(0, i-20), i):
                if 'onGesture' in lines[j]:
                    found_gesture = True
                    break
            if found_gesture:
                # 插入新行（缩进与 /> 一致：26 空格）
                indent = ' ' * 26
                new_line = f'{indent}style={{{{ background: readerBgColor }}}} textColor={{readerTextColor}} fontSize={{readerFontSize}}'
                lines.insert(i, new_line)
                print(f'OK 修复 2: 移动端 ReaderView 加 props - 插入到行 {i+1}')
                break

# === 修复 3: 工具栏 div 闭合 ===
# 在行 2311 后面补一个 </div>（闭合"第二行：字号+翻译"的 div）
# 当前 2311: <button ...>🌐 翻译</button>  (新内容)
# 后面 2312: <div style={{ flex: 1, minHeight: 0, ... }}>
# 需要在 2312 前补一个 </div>
# 重新找：因为插入了新行，行号变了 —— 用内容识别
for i, line in enumerate(lines):
    if '🌐 翻译</button>' in line and i+1 < len(lines):
        next_line = lines[i+1].lstrip()
        # 下一行是不是 flex: 1 的 div
        if next_line.startswith('<div') and 'flex: 1' in next_line and 'minHeight: 0' in next_line:
            indent = ' ' * (len(lines[i]) - len(lines[i].lstrip()))  # 与 button 行同缩进
            lines.insert(i+1, f'{indent}</div>')
            print(f'OK 修复 3: 补 </div> - 插入到行 {i+2}')
            break

# 写回
open(PATH, 'w', encoding='utf-8').write('\n'.join(lines))
print('DONE')