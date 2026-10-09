import io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
lines = open(PATH, 'r', encoding='utf-8').read().split('\n')

# 跟踪 JSX 平衡（只看 JSX 内的 div，忽略代码块/字符串）
# 用 stack: 推入 (line_no, opening_snippet)
# 找 </> 时的处理：fragment 内的 div 必须先全部闭合
stack = []  # entries: ('div', line_no, indent, snippet) 或 ('fragment', line_no)

# 简单策略：逐行看，找出 <div ... > 开 和 </div> 关
# 跳过：注释、字符串（粗略）
opens_in_outer_fragment = 0
closes_in_outer_fragment = 0
last_key_line = None

for i, line in enumerate(lines, 1):
    code = line
    # 移除行尾注释和块注释（粗略）
    code = re.sub(r'\{/\*.*?\*/\}', '', code)
    # 简化：记录开/关 div
    for m in re.finditer(r'<div\b', code):
        opens_in_outer_fragment += 1
        stack.append(('div', i, code[max(0,m.start()-5):m.start()+30]))
    for m in re.finditer(r'</div>', code):
        closes_in_outer_fragment += 1
        if stack and stack[-1][0] == 'div':
            stack.pop()
        else:
            print(f'行 {i}: 多余 </div> | {line.strip()[:80]}')

# 最后剩余 stack 是真正未闭合的
print(f'\nopens={opens_in_outer_fragment}, closes={closes_in_outer_fragment}, diff={opens_in_outer_fragment-closes_in_outer_fragment}')
print(f'剩余未闭合 stack ({len(stack)} 个):')
for kind, ln, snip in stack:
    print(f'  [{kind}] 行 {ln}: {snip}')