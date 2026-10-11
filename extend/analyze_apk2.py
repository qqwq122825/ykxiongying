#!/usr/bin/env python3
import zipfile, sys, io, base64, struct
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

APK_PATH = r"C:\wwwroot\802apk\inner.apk"

def clear_fake_encryption(z):
    for info in z.infolist():
        if info.flag_bits & 0x01:
            info.flag_bits &= ~0x01

with zipfile.ZipFile(APK_PATH, 'r') as z:
    clear_fake_encryption(z)

    # 读取 AndroidManifest 看包名
    manifest = z.read('AndroidManifest.xml')
    print("=" * 60)
    print("AndroidManifest 头部二进制 (前 200 字节 hex):")
    print("=" * 60)
    print(manifest[:200].hex())
    # 尝试找出包名 (二进制 AXML)
    pkg_name = None
    # 用宽松匹配
    for marker in [b'com.fisher', b'com.gni', b'com.luan', b'package=', b'com.bt']:
        idx = manifest.find(marker)
        if idx >= 0:
            end = manifest.find(b'\x00', idx) if marker != b'package=' else idx + 60
            print(f"发现 marker {marker}: {manifest[idx:end][:80]}")
            pkg_name = marker.decode()
    print()

    print("=" * 60)
    print("0.bt 文件头 (前 64 字节 hex + 尝试解压):")
    print("=" * 60)
    bt0 = z.read('assets/0.bt')
    print("前 16 字节:", bt0[:16].hex())
    print("前 16 字节 ASCII:", bt0[:16])

    # 尝试用 ENCCrypto 解密 0.bt
    print()
    print("=" * 60)
    print("尝试 ENC: 加密格式解密 0.bt")
    print("=" * 60)
    KEY1 = bytes([0x4a, 0x7f, 0x2b, 0x5e, 0x1c, 0x8d, 0x3a, 0x6f, 0x9e, 0x0d, 0x4c, 0x7b, 0x2a, 0x5f, 0x1e, 0x8c])
    KEY2 = bytes([0x3b, 0x6e, 0x1a, 0x4d, 0x0c, 0x7c, 0x2b, 0x5e, 0x8f, 0x0e, 0x3d, 0x6c, 0x1b, 0x4e, 0x0f, 0x7d])
    # 0.bt 一般是 bt 文件 = 加密+base64
    if bt0.startswith(b'ENC:'):
        enc = bt0[4:]
        data = bytearray(base64.b64decode(enc))
        # swap
        for i in range(0, len(data) - 1, 2):
            data[i], data[i+1] = data[i+1], data[i]
        # xor
        step1 = bytes([data[i] ^ KEY2[i%16] for i in range(len(data))])
        step2 = bytes([step1[i] ^ KEY1[i%16] for i in range(len(step1))])
        print("ENCCrypto 解密结果 (前 500):")
        print(step2[:500].decode('utf-8', errors='replace'))

    # 列出 dex
    print()
    print("=" * 60)
    print("classes*.dex 文件:")
    print("=" * 60)
    for n in z.namelist():
        if n.endswith('.dex'):
            print(" ", n, z.getinfo(n).file_size)

    # 看 res/values/strings.xml (如果有)
    print()
    print("=" * 60)
    print("res/values 资源:")
    print("=" * 60)
    for n in z.namelist():
        if 'res/values' in n and n.endswith('.xml'):
            print(" ", n, z.getinfo(n).file_size)