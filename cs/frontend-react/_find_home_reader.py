import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

txt = open(r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx', 'r', encoding='utf-8').read()
# 找首页 tab 的范围
lines = txt.split('\n')
home_start = None
for i, line in enumerate(lines, 1):
    if 'activeTab === \'🏠 首页\'' in line:
        home_start = i
        break
print(f'Home tab 起始行: {home_start}')

# 找无障碍/Reader 关键字
keywords = ['Reader', 'reader', '无障碍', 'accessibility', 'a11y', '读屏', 'screenReader', 'nodeTree']
for i, line in enumerate(lines, 1):
    for kw in keywords:
        if kw in line:
            # 显示前 60 行到下一行范围
            print(f'{i:5d}|{kw:14s}|{line.strip()[:120]}')
            break

# 找首页 tab 的结束（下一个 activeTab === ...）
if home_start:
    for i, line in enumerate(lines[home_start:], home_start):
        if i > home_start and 'activeTab ===' in line and '🏠 首页' not in line:
            print(f'\n--- 首页 tab 范围: 行 {home_start} ~ 行 {i-1} ({i-home_start} 行) ---')
            break