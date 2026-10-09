import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
lines = open(r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx.bak', 'r', encoding='utf-8').read().split('\n')
print(f'bak 共 {len(lines)} 行')
for i, line in enumerate(lines, 1):
    if '无障碍阅读器' in line or 'ReaderView data={readerData}' in line:
        print(f'{i}: {line[:130]}')
print('---')
# 看现在文件
cur_lines = open(r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx', 'r', encoding='utf-8').read().split('\n')
print(f'当前 {len(cur_lines)} 行')
for i, line in enumerate(cur_lines, 1):
    if 'ReaderView data={readerData}' in line:
        print(f'{i}: {line[:200]}')