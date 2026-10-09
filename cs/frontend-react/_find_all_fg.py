import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
txt = open(r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx', 'r', encoding='utf-8').read()
for i, line in enumerate(txt.split('\n'), 1):
    if '</>' in line or '<>' in line:
        print(f'行 {i}: {line.strip()[:80]}')