import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
lines = open(r'C:\wwwroot\cs\frontend-react\src\pages\ControlPage.jsx', 'r', encoding='utf-8').read().split('\n')
depth = 0
for i, line in enumerate(lines, 1):
    if i < 2085 or i > 2460:
        continue
    opens = len(re.findall(r'<div\b', line))
    closes = line.count('</div>')
    if opens or closes:
        marker = '!'
        if depth != 0: marker = f'!!DEPTH={depth}!!'
        print(f'{marker}{i}: d={depth} +{opens} -{closes} | {line.strip()[:60]}')
    depth += opens - closes
print(f'final depth={depth}')