import urllib.request
try:
    r = urllib.request.urlopen('http://127.0.0.1/', timeout=10)
    body = r.read(2000)
    out = 'HTTP %d\nbody_len: %d\nfirst 800 bytes:\n%s' % (r.status, len(body), body[:800].decode('utf-8', errors='replace'))
except Exception as e:
    out = 'ERR: %s: %s' % (type(e).__name__, e)
with open(r'C:\wwwroot\cs\node-ws\_test_home_result.txt', 'w', encoding='utf-8') as f:
    f.write(out)
print(out)