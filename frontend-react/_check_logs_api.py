import urllib.request, urllib.parse, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

cases = [
    # 1. 不带 search, page=1
    {'deviceId': 'cfe498502e2b7210', 'page': 1, 'pageSize': 2},
    # 2. 带 search='app', page=1
    {'deviceId': 'cfe498502e2b7210', 'page': 1, 'pageSize': 2, 'search': 'app'},
    # 3. 带 type='KSTR', page=1
    {'deviceId': 'cfe498502e2b7210', 'page': 1, 'pageSize': 2, 'type': 'KSTR'},
    # 4. page=2 翻页
    {'deviceId': 'cfe498502e2b7210', 'page': 2, 'pageSize': 2},
    # 5. 搜索无结果
    {'deviceId': 'cfe498502e2b7210', 'page': 1, 'pageSize': 5, 'search': '不存在的关键词xyz123'},
]

for i, params in enumerate(cases, 1):
    url = 'http://127.0.0.1/api/logs?' + urllib.parse.urlencode(params)
    print('=' * 60)
    print(f'[Case {i}] GET {url}')
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            body = r.read().decode('utf-8', errors='replace')
            print(f'STATUS: {r.status}')
            try:
                j = json.loads(body)
                if j.get('success') and j.get('data'):
                    logs = j['data'].get('logs', [])
                    total = j['data'].get('total', 0)
                    print(f'TOTAL: {total}, RETURNED: {len(logs)}')
                    for x in logs[:2]:
                        print(f'  - id={x.get("id")} type={x.get("logType")} content={x.get("content","")[:60]}')
                else:
                    print('BODY:', body[:300])
            except Exception:
                print('RAW:', body[:300])
    except Exception as e:
        print(f'ERROR: {e}')