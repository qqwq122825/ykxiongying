import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
lines = open(PATH, 'r', encoding='utf-8').read().split('\n')

# 找到行 2493 "    </div>" (control-page 闭合) — 在它前面插 6 个 </div>
for i, line in enumerate(lines):
    if i == 2492 and line.strip() == '</div>':
        # 插入 6 个 </div> 缩进对齐到 control-page 内层（6 空格）
        new_blocks = []
        for j in range(6):
            new_blocks.append('      </div>')
        lines = lines[:i] + new_blocks + lines[i:]
        print(f'OK: 在行 {i+1} 之前插入 6 个 </div>')
        break

open(PATH, 'w', encoding='utf-8').write('\n'.join(lines))
print('DONE')