import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
lines = open(r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx', 'r', encoding='utf-8').read().split('\n')
# 从 1952 到 2545 数
opens, closes = 0, 0
diff_stack = []
for i, line in enumerate(lines, 1):
    if i < 1952 or i > 2545:
        continue
    # 简化解析：每行中找出 <div 和 </div>
    o = line.count('<div')
    c = line.count('</div>')
    opens += o
    closes += c
    if i in (2280, 2290, 2308, 2313, 2495, 2505, 2509, 2510, 2545):
        print(f'{i}: +{o} -{c} | {line.strip()[:90]}')
print(f'\n1952-2545: opens={opens}, closes={closes}, diff={opens-closes}')