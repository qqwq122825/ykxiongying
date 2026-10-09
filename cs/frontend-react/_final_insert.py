import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
lines = open(PATH, 'r', encoding='utf-8').read().split('\n')

# 找 "    </div>" 单独行（control-page 闭合）
for i, line in enumerate(lines):
    if line == '    </div>' and i > 2400:
        # 在它前面插入 6 个 </div>
        new_blocks = ['      </div>'] * 6
        lines = lines[:i] + new_blocks + lines[i:]
        print(f'OK: 在行 {i+1} 之前插入 6 个 </div>（control-page 闭合前）')
        break

open(PATH, 'w', encoding='utf-8').write('\n'.join(lines))
print('DONE')