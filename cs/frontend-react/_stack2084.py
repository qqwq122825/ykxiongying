import io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
lines = open(PATH, 'r', encoding='utf-8').read().split('\n')

# 从 1952 开始跟踪
stack = []
opens = closes = 0
for i, line in enumerate(lines, 1):
    if i < 1952 or i > 2100:
        continue
    opens_in = len(re.findall(r'<div\b', line))
    closes_in = line.count('</div>')
    o = opens_in
    c = closes_in
    if o or c:
        new_stack = []
        for _ in range(o):
            stack.append(i)
        for _ in range(c):
            if stack:
                stack.pop()
        print(f'{i}: +{o} -{c} | {line.strip()[:80]} | stack_depth={len(stack)}')
print(f'\n1952-2100 后 stack: {len(stack)}')
if stack:
    for ln in stack:
        print(f'  未闭合: 行 {ln}')