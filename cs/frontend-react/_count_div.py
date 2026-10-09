import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
txt = open(r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx', 'r', encoding='utf-8').read()
# 简化计数：行 2280 ~ 2330 范围的 div 计数
lines = txt.split('\n')
opens, closes = 0, 0
for i, line in enumerate(lines, 1):
    if i >= 2280 and i <= 2340:
        o = line.count('<div')
        c = line.count('</div>')
        opens += o
        closes += c
        if o or c:
            print(f'{i}: +{o} -{c} | {line.strip()[:80]}')
print(f'\n2280-2340 范围: opens={opens}, closes={closes}, diff={opens-closes}')