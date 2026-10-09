import io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
lines = open(PATH, 'r', encoding='utf-8').read().split('\n')

# 找三元表达式内顶层元素
# 三元开: '? (' 后立即是 <div ctrl-body> 或 <>
# 三元闭: ') : renderTabContent()'

# 找 fragment <>: 行 2084/2085
# 找 ?) : 行 2460/2461

# 在三元内部（2085-2460）找顶层 JSX 元素（不在嵌套 div 内的）
depth = 0
top_elements = []
for i, line in enumerate(lines, 1):
    if i < 2084 or i > 2460:
        continue
    # 跳过注释行
    if '/*' in line and '*/' in line and '<' not in line:
        continue
    # 数 div 深度
    opens = len(re.findall(r'<div\b', line))
    closes = line.count('</div>')
    # 如果深度变化，记下新元素
    if opens > 0 and depth == 0 and closes == 0:
        # 顶层元素开始
        top_elements.append((i, line.strip()[:60]))
    depth += opens
    depth -= closes

print(f'三元内顶层元素: {len(top_elements)} 个')
for ln, sn in top_elements:
    print(f'  行 {ln}: {sn}')