import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PATH = r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx'
txt = open(PATH, 'r', encoding='utf-8').read()

# 删掉多余 fragment 闭合: "      </div></>}" (行 2198 和 2454)
# 用正则只匹配开 fragment 后到主 fragment 闭合之间的多余 </>（行 2198 那个）
# 实际上两个 </div></>} 都需要处理：第一个让 fragment 提前结束，第二个根本是无效
# 但仔细看：</> 在 JSX 里是 fragment 闭合，如果 fragment 已经闭合，再来一个 </> 就是错误
# 实际：行 2198 的 </> 应该是错误的（应该是只 </div> 才对）
# 行 2454 的 </> 也应该是错误的

# 修复 1: 删 2198 处的 </>，保留 </div>
old1 = '          </div></>}\n        </div>\n        {/* 中栏：双投屏'
new1 = '          </div>}\n        </div>\n        {/* 中栏：双投屏'
n1 = txt.count(old1)
print(f'fix1 matches: {n1}')

# 修复 2: 删 2454 处的 </>，保留 </div>
old2 = '            </div></>}\n\n      </div>{/* end ctrl-sidebar-panel */}'
new2 = '            </div>}\n\n      </div>{/* end ctrl-sidebar-panel */}'
n2 = txt.count(old2)
print(f'fix2 matches: {n2}')

txt = txt.replace(old1, new1)
txt = txt.replace(old2, new2)
open(PATH, 'w', encoding='utf-8').write(txt)
print(f'DONE: fix1={n1}, fix2={n2}')