#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ZM27 启发式解密：尝试常见密钥 / 固定模式"""
import zipfile, sys, io, base64, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

APK = r"C:\wwwroot\802apk\inner.apk"

with zipfile.ZipFile(APK, 'r') as z:
    for info in z.infolist():
        if info.flag_bits & 0x01:
            info.flag_bits &= ~0x01
    bt0 = z.read('assets/0.bt')

print("=" * 60)
print("ZM27 启发式解密尝试")
print("=" * 60)
print(f"文件大小: {len(bt0)} 字节")
print(f"前 4 字节 (Magic): {bt0[:4]}")
print(f"前 32 字节 hex: {bt0[:32].hex()}")

# ZM26 格式: MAGIC(4) + salt(8) + payload
# ZM27 可能: MAGIC(4) + length?(4) + payload
# 尝试把 4..8 当 uint32 length
import struct
length_be = struct.unpack('>I', bt0[4:8])[0]
length_le = struct.unpack('<I', bt0[4:8])[0]
print(f"\n[BE] 4..8 当 uint32 length: {length_be}")
print(f"[LE] 4..8 当 uint32 length: {length_le}")
print(f"实际文件长度: {len(bt0)}")

# 尝试作为明文检测 (如果 payload 是 JSON)
try:
    head = bt0[4:].decode('utf-8')
    if head.startswith('{') or head.startswith('['):
        print(f"\n[可能是明文 JSON] 前 200: {head[:200]}")
except:
    pass

# 尝试 ZM26 同款格式 (salt=8)
salt = bt0[4:12]
payload = bt0[12:]
print(f"\n按 ZM26 格式 (salt=8): salt={salt.hex()}, payload 长度={len(payload)}")

# 尝试各种密钥 + 解密看是否能得到 JSON / URL
import itertools
candidates = [
    b'\x00' * 32,
    b'fisher',
    b'fisher_zh',
    b'zm26',
    b'zm27',
    b'bt-fisher',
    b'BT_FISHER',
    b'InnerAPK',
    bytes(range(32)),
    bytes([0x4a, 0x7f, 0x2b, 0x5e, 0x1c, 0x8d, 0x3a, 0x6f, 0x9e, 0x0d, 0x4c, 0x7b, 0x2a, 0x5f, 0x1e, 0x8c]) * 2,
]
for key in candidates:
    for offset in [0, 8]:
        combo = (bt0[4:4+offset] + key) if offset else key
        decrypted = bytes([b ^ combo[i % len(combo)] for i, b in enumerate(payload)]).rstrip(b'\x00')
        if not decrypted:
            continue
        head = decrypted[:50]
        if head.startswith(b'{') or head.startswith(b'[') or b'http' in head or b'api' in head.lower():
            print(f"\n[命中] key={key[:16].hex()}, offset={offset}")
            print(f"   前 300 字节: {decrypted[:300].decode('utf-8', errors='replace')}")
            if len(decrypted) > 300:
                print(f"   长度: {len(decrypted)}")
                # 保存完整
                with open(r'C:\wwwroot\cs\extend\decrypted_0bt.bin', 'wb') as f:
                    f.write(decrypted)
                try:
                    j = json.loads(decrypted.decode('utf-8'))
                    print("   ✅ JSON 解析成功!")
                    print(json.dumps(j, indent=2, ensure_ascii=False)[:2000])
                except:
                    pass
            break

# 还尝试把 4..12 当 salt, 12..20 当 key (16字节模式)
print("\n尝试各种 16 字节 salt/key 分割:")
for salt_len in [4, 8, 12, 16]:
    key_len = 16 - salt_len if salt_len < 16 else 0
    if salt_len + key_len > 32:
        continue
    salt2 = bt0[4:4+salt_len]
    key2 = bt0[4+salt_len:4+salt_len+key_len]
    combo = salt2 + key2
    if not combo:
        continue
    pl = bt0[12:]
    dec = bytes([b ^ combo[i % len(combo)] for i, b in enumerate(pl)]).rstrip(b'\x00')
    head = dec[:30]
    if head.startswith(b'{') or b'http' in head:
        print(f"  salt_len={salt_len} key_len={key_len}: 命中! 前100={dec[:100]}")

print("\n=== 结论 ===")
print("未能用启发式方法直接解密 ZM27。需要拿到对应版本的解密工具, 或者用 ZM27 native runtime hook 解密。")