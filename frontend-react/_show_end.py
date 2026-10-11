import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
lines = open(r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx', 'r', encoding='utf-8').read().split('\n')
print(f'TOTAL: {len(lines)}')
for i, line in enumerate(lines, 1):
    if i >= 2505 and i <= 2550:
        print(f'{i}|{line}')