import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
lines = open(PATH, 'r', encoding='utf-8').read().split('\n')
print(f'TOTAL: {len(lines)}')

# 检查 fragment 开闭
in_fragment = False
for i, line in enumerate(lines, 1):
    if '<>' in line and '</>' not in line:
        # 可能是 fragment 开
        # 检查前文：activeTab === '🏠 首页' ? ( 后面
        in_fragment = True
        print(f'行 {i}: fragment 可能开 | {line.strip()[:80]}')
    if '</>' in line:
        in_fragment = False
        print(f'行 {i}: fragment 闭 | {line.strip()[:80]}')

# 看具体的 fragment 位置
for i, line in enumerate(lines, 1):
    if i >= 2080 and i <= 2110:
        if '<' in line and 'div' in line.lower() or '?' in line or ')' in line:
            print(f'ACT 行 {i}: {line.strip()[:100]}')