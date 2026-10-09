import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
txt = open(PATH, 'r', encoding='utf-8').read()

# 在 "      ) : renderTabContent()}" 前插入 "      </>"
old = '      </div>{/* end ctrl-body */}\n      ) : renderTabContent()}'
new = '      </div>{/* end ctrl-body */}\n      </>\n      ) : renderTabContent()}'
n = txt.count(old)
print(f'找到 {n} 个匹配')
if n > 0:
    txt = txt.replace(old, new, 1)
    open(PATH, 'w', encoding='utf-8').write(txt)
    print('OK: 在 ctrl-body 后插入 </>')