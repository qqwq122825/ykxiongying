import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
lines = open(PATH, 'r', encoding='utf-8').read().split('\n')

# 找到 2510 </div>{/* end ctrl-body */} 这一行
# 后面紧跟 "      </div></div></div></div></div></div></div>" (我刚加的 7 个)
# 删掉那 7 个纯 "      </div>" 行

new_lines = []
skip = 0
for line in lines:
    if skip > 0:
        skip -= 1
        continue
    if line.strip() == '</div>' and '</div>{/* end ctrl-body */}' in lines[len(new_lines)-1] if new_lines else False:
        # 跳过这一个
        skip = 7  # 跳过后续 7 个 </div>
        continue
    new_lines.append(line)

# 用更安全的算法：找到 2510 行（"end ctrl-body"），删掉它后面的连续 7 个 </div>
# 实际位置可能已经偏移
for i, line in enumerate(new_lines):
    if 'end ctrl-body' in line and i + 8 < len(new_lines):
        # 检查后面 7 行是否都是 "</div>"
        all_close = all(new_lines[i+1+j].strip() == '</div>' for j in range(7))
        if all_close:
            # 删除这 7 行
            print(f'删除行 {i+2} ~ {i+8}（7 个多余 </div>）')
            new_lines = new_lines[:i+1] + new_lines[i+8:]
            break

open(PATH, 'w', encoding='utf-8').write('\n'.join(new_lines))
print('DONE')