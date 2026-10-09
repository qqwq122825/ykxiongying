import io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
txt = open(PATH, 'r', encoding='utf-8').read()

# 简单计数（包含字符串）
opens = len(re.findall(r'<div\b', txt))
closes = txt.count('</div>')
print(f'opens={opens}, closes={closes}, diff={opens-closes}')

# 跟踪（带行号）
lines = txt.split('\n')
stack = []
for i, line in enumerate(lines, 1):
    if i < 1950 or i > 2497:
        continue
    opens_in = len(re.findall(r'<div\b', line))
    closes_in = line.count('</div>')
    for _ in range(opens_in):
        stack.append((i, line.strip()[:60]))
    for _ in range(closes_in):
        if stack:
            stack.pop()
        else:
            print(f'!! 行 {i}: 多余 </div>')

print(f'\n剩余 {len(stack)} 个未闭合 div:')
for ln, sn in stack:
    print(f'  行 {ln}: {sn}')