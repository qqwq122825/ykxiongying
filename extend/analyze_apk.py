#!/usr/bin/env python3
import zipfile, json, sys, os, base64, io

APK_PATH = r"C:\wwwroot\802apk\inner.apk"
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

class ZM26Crypto:
    MAGIC = b'ZM26'
    def __init__(self, xor_key_hex, salt_hex):
        self.key = bytes.fromhex(xor_key_hex)
        self.salt = bytes.fromhex(salt_hex)
        self.combined = self.salt + self.key
    def decrypt(self, data):
        assert data[:4] == self.MAGIC
        payload = data[12:]
        return bytes([b ^ self.combined[i % len(self.combined)] for i, b in enumerate(payload)]).rstrip(b'\x00')

def clear_fake_encryption(z):
    for info in z.infolist():
        if info.flag_bits & 0x01:
            info.flag_bits &= ~0x01

with zipfile.ZipFile(APK_PATH, 'r') as z:
    clear_fake_encryption(z)
    names = z.namelist()
    print("=" * 60)
    print("APK 关键文件检查:")
    print("=" * 60)
    for n in names:
        if 'zm26' in n.lower() or 'server_config' in n.lower() or 'manifest' in n.lower():
            print(" ", n, z.getinfo(n).file_size, "bytes")
    print()

    if 'assets/zm26_meta.json' in names:
        meta = json.loads(z.read('assets/zm26_meta.json'))
        print("=" * 60)
        print("ZM26 Meta:")
        print("=" * 60)
        print(json.dumps(meta, indent=2, ensure_ascii=False))

        zm26 = ZM26Crypto(meta['xor_key'], meta['salt'])
        bt_name = meta['mapping']['server_config.json']
        encrypted = z.read(f'assets/{bt_name}')
        decrypted = zm26.decrypt(encrypted)
        json_start = decrypted.find(b'{')
        cfg = json.loads(decrypted[json_start:].decode('utf-8'))
        print()
        print("=" * 60)
        print("Server Config (解密后):")
        print("=" * 60)
        print(json.dumps(cfg, indent=2, ensure_ascii=False))
    else:
        print("无 zm26_meta.json, 列出全部 assets/ 目录:")
        for n in names:
            if n.startswith('assets/'):
                print(" ", n, z.getinfo(n).file_size)