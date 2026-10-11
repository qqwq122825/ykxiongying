import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
txt = open(PATH, 'r', encoding='utf-8').read()

# 在行 2509 ( </div>{/* end ctrl-sidebar-panel */} ) 和 行 2510 ( ) : renderTabContent()}) 之间
# 补回被删的 </div>{/* end ctrl-body */}  和 <></> fragment
old = '      </div>{/* end ctrl-sidebar-panel */}\n      ) : renderTabContent()}'
new = '      </div>{/* end ctrl-sidebar-panel */}\n      </div>{/* end ctrl-body */}\n      <>\n      ) : renderTabContent()}'
if old not in txt:
    print('FAIL: 找不到 anchor')
    sys.exit(1)
txt = txt.replace(old, new, 1)
open(PATH, 'w', encoding='utf-8').write(txt)
print('OK: 补回 ctrl-body + fragment')