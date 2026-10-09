import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
txt = open(PATH, 'r', encoding='utf-8').read()

# 删 fragment 开: "      <>\n      {/* 主体三栏 */}" → "      {/* 主体三栏 */}"
old1 = '      <>\n      {/* 主体三栏 */}'
new1 = '      {/* 主体三栏 */}'
n1 = txt.count(old1)
if n1 > 0:
    txt = txt.replace(old1, new1, 1)

# 删 fragment 闭: "      </>\n      ) : renderTabContent()}" → "      ) : renderTabContent()}"
old2 = '      </>\n      ) : renderTabContent()}'
new2 = '      ) : renderTabContent()}'
n2 = txt.count(old2)
if n2 > 0:
    txt = txt.replace(old2, new2, 1)

open(PATH, 'w', encoding='utf-8').write(txt)
print(f'DONE: 删 fragment 开={n1}, 闭={n2}')