import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
txt = open(PATH, 'r', encoding='utf-8').read()

old = "{activeTab === '🏠 首页' ? (\n      {/* 主体三栏 */}"
new = "{activeTab === '🏠 首页' ? (\n      <>\n      {/* 主体三栏 */}"
n = txt.count(old)
print(f'matches: {n}')
if n > 0:
    txt = txt.replace(old, new, 1)
    open(PATH, 'w', encoding='utf-8').write(txt)
    print('OK: added <> opening')