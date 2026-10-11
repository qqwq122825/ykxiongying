import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

txt = open(r'C:\wwwroot\cs\frontend-react\src\components\control\TrojanControlTab.jsx', 'r', encoding='utf-8').read()
keywords = ['readerBgColor', 'readerTextColor', 'readerFontSize', 'type="color"', 'input type=', '字号', '背景', '文字色', '文字颜色']
for i, line in enumerate(txt.split('\n'), 1):
    for kw in keywords:
        if kw in line:
            print(f'{i:5d}|{kw:18s}|{line.strip()[:140]}')
            break