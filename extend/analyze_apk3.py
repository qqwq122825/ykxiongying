#!/usr/bin/env python3
import zipfile, sys, io, base64, struct
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

APK_PATH = r"C:\wwwroot\802apk\inner.apk"

# 用 zipfile 列出条目信息但不解压那些不支持的
with zipfile.ZipFile(APK_PATH, 'r') as z:
    print("=" * 60)
    print("压缩方式统计:")
    print("=" * 60)
    counts = {}
    for info in z.infolist():
        # 0=STORED, 8=DEFLATE, 12=DEFLATE64, 14=LZMA, 93=BZIP2, 95=XZ, 98=WinZip AES
        c = info.compress_type
        counts[c] = counts.get(c, 0) + 1
    print(counts)

    # 只读取 assets 下的 .bt
    print()
    print("=" * 60)
    print("尝试解压 assets/0.bt (绕过假加密标志):")
    print("=" * 60)
    for info in z.infolist():
        if info.flag_bits & 0x01:
            info.flag_bits &= ~0x01

    bt0 = z.read('assets/0.bt')
    print("前 32 字节 hex:", bt0[:32].hex())
    print("前 32 字节:", bt0[:32])
    print("尝试 base64 解码 (b64 of raw bytes):")
    try:
        decoded = base64.b64decode(bt0, validate=False)
        print("b64 解码成功, 长度:", len(decoded))
        print("前 50 字节:", decoded[:50])
    except Exception as e:
        print("b64 失败:", e)

    print()
    print("尝试 ENC: 前缀:")
    if bt0.startswith(b'ENC:'):
        print("是的, ENC: 前缀")
        enc = bt0[4:].strip()
        data = bytearray(base64.b64decode(enc))
        KEY1 = bytes([0x4a,0x7f,0x2b,0x5e,0x1c,0x8d,0x3a,0x6f,0x9e,0x0d,0x4c,0x7b,0x2a,0x5f,0x1e,0x8c])
        KEY2 = bytes([0x3b,0x6e,0x1a,0x4d,0x0c,0x7c,0x2b,0x5e,0x8f,0x0e,0x3d,0x6c,0x1b,0x4e,0x0f,0x7d])
        # swap
        for i in range(0, len(data) - 1, 2):
            data[i], data[i+1] = data[i+1], data[i]
        step1 = bytes([data[i] ^ KEY2[i%16] for i in range(len(data))])
        step2 = bytes([step1[i] ^ KEY1[i%16] for i in range(len(step1))])
        print("解密结果 (前 1000):")
        print(step2[:1000].decode('utf-8', errors='replace'))
    else:
        print("不是 ENC: 前缀")

    # 再看 1.bt
    print()
    print("=" * 60)
    print("assets/1.bt:")
    print("=" * 60)
    bt1 = z.read('assets/1.bt')
    print("前 32 字节 hex:", bt1[:32].hex())
    print("前 32 字节:", bt1[:32])