import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
lines = open(PATH, 'r', encoding='utf-8').read().split('\n')

# 在行 2511 "</>" 之前插入 7 个 </div>
# 当前 2511 = "      </>"
new_lines = lines[:2510] + ['      </div>'] * 7 + lines[2510:]
open(PATH, 'w', encoding='utf-8').write('\n'.join(new_lines))
print(f'OK: 在行 2510 后插入了 7 个 </div>')

# 验证
import re
stack = []
opens = closes = 0
for line in new_lines:
    for m in re.finditer(r'<div(?:\s|>)', line):
        opens += 1
        stack.append(line[:50])
    for m in re.finditer(r'</div>', line):
        closes += 1
        if stack: stack.pop()
print(f'opens={opens}, closes={closes}, diff={opens-closes}')