import io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

lines = open(r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx', 'r', encoding='utf-8').read().split('\n')

# 用栈跟踪 <div ... > 开和 </div> 关（忽略 <div/> 自闭合）
stack = []  # (line, indent, snippet)
opens, closes = 0, 0
for i, line in enumerate(lines, 1):
    if i < 1952 or i > 2510:
        continue
    # 跳过注释里的内容（粗略）
    code = re.sub(r'\{/\*.*?\*/\}', '', line)
    code = re.sub(r'/\*.*?\*/', '', code)
    # 找出所有 <div 开头（非 <div/>）
    for m in re.finditer(r'<div(?:\s|>)', code):
        # 排除 <div/> 或 <div.../> 自闭合（用上下文检查）
        # 简化：找到 <div 后看后面是不是 /> 立刻结束
        start = m.start()
        # 检查 m.end() 之后是不是 /> 紧跟（自闭合）或 > 开标签
        if m.group() == '<div>' or '<div ' in m.group():
            # 看整体是否自闭合（行内 </div> 立刻）
            # 找出这个 div 对应的结束
            opens += 1
            stack.append((i, code[m.start():m.start()+50]))
    for m in re.finditer(r'</div>', code):
        closes += 1
        if stack:
            stack.pop()
        else:
            print(f'!!! 行 {i}: 多余 </div> | {line.strip()[:80]}')

print(f'\nopens={opens}, closes={closes}, diff={opens-closes}')
print(f'剩余未闭合: {len(stack)}')
for ln, sn in stack:
    print(f'  行 {ln}: {sn}')