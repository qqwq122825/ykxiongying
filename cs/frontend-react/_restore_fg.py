import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
txt = open(PATH, 'r', encoding='utf-8').read()

# 恢复 fragment 开: "      {/* 主体三栏 */}\n        <div className="ctrl-body">" → "      <>\n      {/* 主体三栏 */}\n        <div className=\"ctrl-body\">"
old1 = '      {/* 主体三栏 */}\n        <div className="ctrl-body">'
new1 = '      <>\n      {/* 主体三栏 */}\n        <div className="ctrl-body">'
n1 = txt.count(old1)
if n1 > 0:
    txt = txt.replace(old1, new1, 1)

# 恢复 fragment 闭: "      </div>{/* end ctrl-body */}\n      ) : renderTabContent()}" → "      </div>{/* end ctrl-body */}\n      </>\n      ) : renderTabContent()}"
old2 = '      </div>{/* end ctrl-body */}\n      ) : renderTabContent()}'
new2 = '      </div>{/* end ctrl-body */}\n      </>\n      ) : renderTabContent()}'
n2 = txt.count(old2)
if n2 > 0:
    txt = txt.replace(old2, new2, 1)

open(PATH, 'w', encoding='utf-8').write(txt)
print(f'DONE: 恢复 fragment 开={n1}, 闭={n2}')