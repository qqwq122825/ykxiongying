import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
txt = open(PATH, 'r', encoding='utf-8').read()

# === 回滚 1: PC 端 ReaderView 改回 style 里塞所有 ===
old = 'style={{ background: readerBgColor }} textColor={readerTextColor} fontSize={readerFontSize}'
new = 'style={{ background: readerBgColor, color: readerTextColor, fontSize: readerFontSize }}'
if old in txt:
    txt = txt.replace(old, new, 1)
    print('OK 回滚 1: PC 端 ReaderView 调用改回原样')
else:
    print('FAIL 回滚 1')

# === 回滚 2: 删掉我刚加的移动端 props ===
# 移动端原本 ReaderView 是多行的，没有 textColor/fontSize
# 我加的行是: style={{ background: readerBgColor }} textColor={readerTextColor} fontSize={readerFontSize}
# 缩进 26 空格（与 /> 行同）
import re
pattern = r'\n {26}style=\{\{ background: readerBgColor \}\} textColor=\{readerTextColor\} fontSize=\{readerFontSize\}\n'
matches = re.findall(pattern, txt)
print(f'找到 {len(matches)} 个移动端 props 行')
if matches:
    txt = re.sub(pattern, '\n', txt)
    print('OK 回滚 2: 删掉移动端 props')

# === 回滚 3: 把"两行布局"工具栏恢复成一行 ===
# 旧工具栏（v3 状态）应该是一个 div 包含所有控件：标题、已连接、背景、字色、字号、重置、翻译、开启/关闭
# 我之前 _patch_reader.py 的"OK: 改动 1" + "OK: 改动 2"（错位版本）应该就是 v3 状态
# 我新加的"两行布局"是从 _patch_reader2.py 来的，从 </div> 后开始

# 找 v3 工具栏的起始特征（绿色圆点 span）和结束（开启/关闭 button + </div>）
# v3 工具栏 (大约 4 个控件在一行 + 翻译 + 开启):
# <span {background: readerActive ? '#52c41a' : '#555'} />
# ... "无障碍阅读器" ...
# ... "已连接/未开启" ...
# ... 背景 input ...
# ... 字色 input ...
# ... 字号 input ...
# ... 重置 button ...
# ... 翻译 button ...
# ... 开启/关闭 button ...
# </div>

# 但 v3 工具栏的精确代码我也记不清了。
# 简化方案：把"两行布局"恢复成"标题行 + 第二行合一行"。
# 看现状：行 2293 (v4 新行) + 2300 (第一行) + 2308 (第二行) — 把 2300 和 2308 合并成一行

# 找 "★ 第一行：背景 + 字色 + 重置" 注释 + 它的 div 开始
# 和 "★ 第二行：字号 + 翻译（最右）" 注释 + 它的 div 开始
# 删除第二行的整个 div（包括前面的 {/* */} 注释）
# 把第一行的内容合并到上一行（v4 新加的标题行）的 div 末尾

# 实际简单做法：把工具栏恢复成 _patch_reader.py 跑完后的状态（v3 build 成功）
# v3 状态工具栏是一个 div，里面所有控件在一行（flex-wrap）

# 但因为精确代码我难以记得，且需要破坏最小化，**最稳**：
# 直接撤掉 v4 工具栏的 {/* */} 注释 + 把第二行的 div 删除，让第一行的 div 自动 flex-wrap 显示

# 找 v4 工具栏的 3 个 div 起始
lines = txt.split('\n')
new_lines = []
i = 0
removed = 0
while i < len(lines):
    line = lines[i]
    # 检测：是不是 "★ 第二行：字号 + 翻译（最右）" 注释 + 它的 div 起始
    if '★ 第二行：字号' in line:
        # 找到这个注释 + 它的整个 div（从 <div 开始到对应 </div> 结束）
        # 因为 {marginLeft: 'auto'} 让翻译按钮在最右，把这个 div 整个去掉
        # 然后把第一行里的"字号 input"和"重置后的 value span"插入到第一行末尾
        # 简化：直接跳到当前 div 的 </div> 后
        depth = 0
        started = False
        j = i
        while j < len(lines):
            l = lines[j]
            depth += l.count('<div')
            depth -= l.count('</div>')
            if depth > 0: started = True
            if started and depth == 0:
                # j 是这个 div 的最后一行（</div>）
                break
            j += 1
        # 跳过这个 div（含它的注释 + </div>）
        i = j + 1
        removed += 1
        continue
    # 把第一行 div 标记合并到上一行
    new_lines.append(line)
    i += 1

print(f'移除"第二行"div 数: {removed}')
txt = '\n'.join(new_lines)

# === 修复: 把 v4 加的 {fontSize}{readerFontSize} 等字号控件合到第一行末尾 ===
# 但这又复杂了，干脆保留两行但删除第二行整体（包括关闭 2308 div 的问题）
# 实际上：之前 _patch_reader2.py 已经替换了"工具栏开头到第一个 </div>"为 3 段：
#   - 标题行（含开启按钮）
#   - 第一行（背景+字色+重置）
#   - 第二行（字号+翻译）<-- 没闭合
# 我们已经识别出问题：2308 的 div 没有 </div> 闭合
# 所以现在 remove "第二行" 后，2308 的 div 不会存在，但我们引入的"字号 input"也没了
# 这意味着：v3 状态恢复 + 第一行变体（包含背景/字色/重置）

# 先看现在的状态
open(PATH, 'w', encoding='utf-8').write(txt)
print('DONE 步骤1：移除第二行 div')