import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
lines = open(PATH, 'r', encoding='utf-8').read().split('\n')

# 在 2312 之后插入 </div>
# 行 2312: {readerActive && readerData && <button ... >🌐 翻译</button>}
# 行 2313: <div style={{ flex: 1, ...
# 找包含 "🌐 翻译</button>" 的行
for i, line in enumerate(lines):
    if '🌐 翻译</button>' in line and i+1 < len(lines):
        # 下一行是 <div flex:1
        next_line = lines[i+1]
        if 'flex: 1' in next_line and '<div' in next_line:
            indent = ' ' * (len(line) - len(line.lstrip()))
            lines.insert(i+1, f'{indent}</div>')
            print(f'OK: 在第 {i+2} 行插入 </div>（闭合第二行工具栏）')
            break

open(PATH, 'w', encoding='utf-8').write('\n'.join(lines))
print('DONE')

# 验证
opens, closes = 0, 0
for line in lines:
    o = line.count('<div')
    c = line.count('</div>')
    opens += o
    closes += c
print(f'全文件: opens={opens}, closes={closes}, diff={opens-closes}')