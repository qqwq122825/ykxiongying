import urllib.request, urllib.parse, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# 测试 1：直接访问首页（不走 PHP）
print('=== Test 1: GET / (静态首页) ===')
try:
    req = urllib.request.Request('http://127.0.0.1/')
    with urllib.request.urlopen(req, timeout=8) as r:
        print(f'STATUS: {r.status}')
        print(f'BODY[:300]: {r.read(300).decode("utf-8", errors="replace")}')
except Exception as e:
    print(f'ERROR: {type(e).__name__}: {e}')

# 测试 2：访问 PHP 接口（无 auth）
print('\n=== Test 2: GET /api/logs?deviceId=cfe498502e2b7210&page=1&pageSize=2 ===')
try:
    url = 'http://127.0.0.1/api/logs?deviceId=cfe498502e2b7210&page=1&pageSize=2'
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=8) as r:
        print(f'STATUS: {r.status}')
        print(f'BODY[:500]: {r.read(500).decode("utf-8", errors="replace")}')
except urllib.error.HTTPError as e:
    print(f'HTTPError: {e.code} {e.reason}')
    print(f'BODY[:500]: {e.read(500).decode("utf-8", errors="replace")}')
except Exception as e:
    print(f'ERROR: {type(e).__name__}: {e}')

# 测试 3：访问 PHP 接口（带 search）
print('\n=== Test 3: GET /api/logs?...&search=test ===')
try:
    url = 'http://127.0.0.1/api/logs?deviceId=cfe498502e2b7210&page=1&pageSize=2&search=test'
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=8) as r:
        print(f'STATUS: {r.status}')
        print(f'BODY[:500]: {r.read(500).decode("utf-8", errors="replace")}')
except urllib.error.HTTPError as e:
    print(f'HTTPError: {e.code} {e.reason}')
    print(f'BODY[:500]: {e.read(500).decode("utf-8", errors="replace")}')
except Exception as e:
    print(f'ERROR: {type(e).__name__}: {e}')