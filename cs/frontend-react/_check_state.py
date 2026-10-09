import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

txt = open(r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx', 'r', encoding='utf-8').read()
# 搜索旧的"塞在 style 里"的调用
old = 'style={{ background: readerBgColor, color: readerTextColor, fontSize: readerFontSize }}'
new = 'style={{ background: readerBgColor }} textColor={readerTextColor} fontSize={readerFontSize}'
print(f'改动 1 旧调用出现次数: {txt.count(old)}')
print(f'改动 1 新调用出现次数: {txt.count(new)}')
# 找出还在哪
if txt.count(old) > 0:
    for i, line in enumerate(txt.split('\n'), 1):
        if old in line:
            print(f'  -> 行 {i}')