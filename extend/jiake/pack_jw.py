#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
完整加壳工具:
1. 用 patched AndroidManifest.xml (label 改了)
2. 替换 assets/app_icon.png 为 jw 的图标
3. 把 jw.apk 加密后塞进 assets/{grAgA8RnLCjl, UvLnIspS92}
4. 重新组装 APK
5. 调用 apksigner 签名
"""
import struct
import os
import sys
import binascii
import gzip
import subprocess
import shutil
import hashlib
import zlib
import base64

try:
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import pad
except ImportError:
    print('[!] 缺 pycryptodome, 装一下: pip install pycryptodome')
    sys.exit(1)


AES_KEY = bytes.fromhex('a6e2385ab2d9bd85fb60f66c67807907')
HEADER_PAD_SIZE = 25
IV_SIZE = 16
ASSET_NAME_1 = 'grAgA8RnLCjl'
ASSET_NAME_2 = 'UvLnIspS92'


def find_eocd(data):
    return data.rfind(b'PK\x05\x06')


def get_central_directory(data, eocd_pos):
    eocd = data[eocd_pos:eocd_pos+22]
    cd_offset = struct.unpack('<I', eocd[16:20])[0]
    cd_size = struct.unpack('<I', eocd[12:16])[0]
    num_entries = struct.unpack('<H', eocd[10:12])[0]
    return cd_offset, cd_size, num_entries


def parse_entries(data, cd_offset, num_entries):
    entries = []
    pos = cd_offset
    for i in range(num_entries):
        if data[pos:pos+4] != b'PK\x01\x02':
            break
        fnlen = struct.unpack('<H', data[pos+28:pos+30])[0]
        extralen = struct.unpack('<H', data[pos+30:pos+32])[0]
        commentlen = struct.unpack('<H', data[pos+32:pos+34])[0]
        name = data[pos+46:pos+46+fnlen].decode('utf-8', errors='replace')

        entry = {
            'name': name,
            'cd_flags': struct.unpack('<H', data[pos+8:pos+10])[0],
            'cd_compress': struct.unpack('<H', data[pos+10:pos+12])[0],
            'mtime': struct.unpack('<H', data[pos+12:pos+14])[0],
            'mdate': struct.unpack('<H', data[pos+14:pos+16])[0],
            'crc': struct.unpack('<I', data[pos+16:pos+20])[0],
            'csize': struct.unpack('<I', data[pos+20:pos+24])[0],
            'usize': struct.unpack('<I', data[pos+24:pos+28])[0],
            'cd_extra': data[pos+46+fnlen:pos+46+fnlen+extralen],
            'comment': data[pos+46+fnlen+extralen:pos+46+fnlen+extralen+commentlen],
            'cd_offset': pos,
            'local_offset': struct.unpack('<I', data[pos+42:pos+46])[0],
        }

        lh_off = entry['local_offset']
        lh_fnlen = struct.unpack('<H', data[lh_off+26:lh_off+28])[0]
        lh_extralen = struct.unpack('<H', data[lh_off+28:lh_off+30])[0]
        entry['data_offset'] = lh_off + 30 + lh_fnlen + lh_extralen
        entry['lh_extra'] = data[lh_off+30+lh_fnlen:lh_off+30+lh_fnlen+lh_extralen]
        entry['lh_flags'] = struct.unpack('<H', data[lh_off+6:lh_off+8])[0]
        entry['lh_compress'] = struct.unpack('<H', data[lh_off+8:lh_off+10])[0]

        entries.append(entry)
        pos += 46 + fnlen + extralen + commentlen

    return entries


def raw_deflate_stored(data, block_size=16384):
    out = bytearray()
    pos = 0
    while pos < len(data):
        block = data[pos:pos+block_size]
        pos += len(block)
        is_final = (pos >= len(data))
        first_byte = (1 if is_final else 0) | (0 << 1)
        out.append(first_byte)
        out.extend(struct.pack('<HH', len(block), len(block) ^ 0xFFFF))
        out.extend(block)
    return bytes(out)


def encrypt_inner_payload(inner_apk_bytes):
    gz = gzip.compress(inner_apk_bytes, compresslevel=6)
    print(f'[*] GZIP: {len(inner_apk_bytes):,} -> {len(gz):,}')

    half = len(gz) // 2
    half1 = gz[:half]
    half2 = gz[half:]

    def enc(half_data):
        header = os.urandom(HEADER_PAD_SIZE)
        iv = os.urandom(IV_SIZE)
        cipher = AES.new(AES_KEY, AES.MODE_CBC, iv)
        ct = cipher.encrypt(pad(half_data, AES.block_size))
        return header + iv + ct

    a1 = enc(half1)
    a2 = enc(half2)
    print(f'[*] asset1: {len(a1):,}, asset2: {len(a2):,}')
    return a1, a2


def make_lh(name, flags, compress, mtime, mdate, crc, csize, usize, extra=b''):
    fn = name.encode('utf-8')
    return struct.pack('<4sHHHHHIIIHH', b'PK\x03\x04', 20, flags, compress, mtime, mdate,
                       crc, csize, usize, len(fn), len(extra)) + fn + extra


def make_cd(name, flags, compress, mtime, mdate, crc, csize, usize, local_offset, extra=b'', comment=b''):
    fn = name.encode('utf-8')
    return struct.pack('<4sHHHHHHIIIHHHHHII', b'PK\x01\x02', 20, 20, flags, compress, mtime, mdate,
                       crc, csize, usize, len(fn), len(extra), len(comment),
                       0, 0, 0, local_offset) + fn + extra + comment


def make_eocd(num, cd_size, cd_off, comment=b''):
    return struct.pack('<4sHHHHIIH', b'PK\x05\x06', 0, 0, num, num, cd_size, cd_off, len(comment)) + comment


def get_mipmap_icon_paths(arsc_path):
    """从 resources.arsc 的 global string pool 读取 mipmap icon 文件路径"""
    arsc = open(arsc_path, 'rb').read()
    sp_flags = struct.unpack('<I', arsc[28:32])[0]
    sp_strings_start = struct.unpack('<I', arsc[32:36])[0]

    def read_gs(idx):
        off_table_start = 12 + 28
        so = struct.unpack('<I', arsc[off_table_start + idx*4 : off_table_start + idx*4 + 4])[0]
        s_off = 12 + sp_strings_start + so
        b1 = arsc[s_off]
        off2 = s_off + (2 if b1 & 0x80 else 1)
        b1 = arsc[off2]
        if b1 & 0x80:
            bl = ((b1 & 0x7F) << 8) | arsc[off2+1]; off2 += 2
        else:
            bl = b1; off2 += 1
        return arsc[off2:off2+bl].decode('utf-8', errors='replace')

    # resource 0x7f0d0000~0x7f0d0003, configs: mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi
    indices = {
        'mdpi': (0x38f, 0x391, 0x390, 0x392),
        'hdpi': (0x38b, 0x38d, 0x38c, 0x38e),
        'xhdpi': (0x393, 0x395, 0x394, 0x396),
        'xxhdpi': (0x397, 0x399, 0x398, 0x39a),
        'xxxhdpi': (0x39b, 0x39d, 0x39c, 0x39e),
    }
    paths = {}  # path -> dpi_key
    for dpi, (l, r, fg, rfg) in indices.items():
        for idx in (l, r, fg, rfg):
            paths[read_gs(idx)] = dpi
    return paths


def patch_arsc_app_name(arsc_data, new_name='ツイットヴァスト'):
    """Patch resources.arsc global string pool: replace 'Kiss Free' with new_name."""
    arsc = bytearray(arsc_data)
    SP = 12
    sp_size = struct.unpack('<I', arsc[SP+4:SP+8])[0]
    sc = struct.unpack('<I', arsc[SP+8:SP+12])[0]
    style_count = struct.unpack('<I', arsc[SP+12:SP+16])[0]
    sp_flags = struct.unpack('<I', arsc[SP+16:SP+20])[0]
    strings_start = struct.unpack('<I', arsc[SP+20:SP+24])[0]
    styles_start = struct.unpack('<I', arsc[SP+24:SP+28])[0]
    OFFSETS = SP + 28

    # Read all strings (UTF-8 format)
    strings_raw = []
    for i in range(sc):
        off = struct.unpack('<I', arsc[OFFSETS+i*4:OFFSETS+i*4+4])[0]
        s_pos = SP + strings_start + off
        # charcount (1 or 2 bytes)
        b = arsc[s_pos]
        if b & 0x80:
            charcount = ((b & 0x7F) << 8) | arsc[s_pos+1]; pos = s_pos + 2
        else:
            charcount = b; pos = s_pos + 1
        # bytelen (1 or 2 bytes)
        b = arsc[pos]
        if b & 0x80:
            bytelen = ((b & 0x7F) << 8) | arsc[pos+1]; pos += 2
        else:
            bytelen = b; pos += 1
        s = arsc[pos:pos+bytelen].decode('utf-8', errors='replace')
        strings_raw.append(s)

    # Replace ALL variants of "Kiss Free" (plain and ZWNJ-padded)
    replaced = 0
    for i, s in enumerate(strings_raw):
        stripped = s.replace('‌', '')
        if stripped == 'Kiss Free':
            strings_raw[i] = new_name
            print(f'[*] arsc str[{i}]: {s!r} -> "{new_name}"')
            replaced += 1
    if replaced == 0:
        print('[!] "Kiss Free" not found in arsc string pool')
        return bytes(arsc)
    print(f'[*] Replaced {replaced} occurrences in arsc string pool')

    # Rebuild string data
    new_strdata = bytearray()
    new_offsets = []
    for s in strings_raw:
        new_offsets.append(len(new_strdata))
        encoded = s.encode('utf-8')
        charcount = len(s.encode('utf-16-le')) // 2  # UTF-16 code unit count
        bytelen = len(encoded)
        # Encode charcount
        if charcount > 0x7F:
            new_strdata.append(0x80 | (charcount >> 8))
            new_strdata.append(charcount & 0xFF)
        else:
            new_strdata.append(charcount)
        # Encode bytelen
        if bytelen > 0x7F:
            new_strdata.append(0x80 | (bytelen >> 8))
            new_strdata.append(bytelen & 0xFF)
        else:
            new_strdata.append(bytelen)
        new_strdata.extend(encoded)
        new_strdata.append(0)  # null terminator

    # Pad to 4-byte alignment
    while len(new_strdata) % 4 != 0:
        new_strdata.append(0)

    # Rebuild string pool chunk
    new_strings_start = 28 + sc * 4
    if style_count > 0:
        new_strings_start += style_count * 4
    new_sp_size = new_strings_start + len(new_strdata)

    sp_chunk = bytearray()
    sp_chunk.extend(struct.pack('<HH', 0x0001, 28))
    sp_chunk.extend(struct.pack('<I', new_sp_size))
    sp_chunk.extend(struct.pack('<I', sc))
    sp_chunk.extend(struct.pack('<I', style_count))
    sp_chunk.extend(struct.pack('<I', sp_flags))
    sp_chunk.extend(struct.pack('<I', new_strings_start))
    sp_chunk.extend(struct.pack('<I', styles_start if style_count else 0))
    for off in new_offsets:
        sp_chunk.extend(struct.pack('<I', off))
    sp_chunk.extend(new_strdata)

    # Build new arsc: header(12) + new_sp + rest
    old_sp_end = SP + sp_size
    rest = arsc[old_sp_end:]
    new_arsc = bytearray()
    new_arsc.extend(struct.pack('<HHI', 0x0002, 12, 12 + len(sp_chunk) + len(rest)))
    new_arsc.extend(struct.pack('<I', struct.unpack('<I', arsc[8:12])[0]))  # package count
    new_arsc.extend(sp_chunk)
    new_arsc.extend(rest)

    print(f'[*] arsc: {len(arsc_data)} -> {len(new_arsc)} bytes (diff: {len(new_arsc)-len(arsc_data):+d})')
    return bytes(new_arsc)



def patch_dex_icon(dex_data, icon_png_path, app_name):
    """Patch classes.dex: replace base64 icon (str[5911]) and app name display."""
    TARGET_B64_LEN = 735588
    target_raw_len = TARGET_B64_LEN // 4 * 3  # 551691

    icon_png = open(icon_png_path, 'rb').read()
    if len(icon_png) > target_raw_len:
        print(f'[!] Icon too large ({len(icon_png)} > {target_raw_len}), truncating')
        icon_png = icon_png[:target_raw_len]
    padded_png = icon_png + b'\x00' * (target_raw_len - len(icon_png))
    icon_b64 = base64.b64encode(padded_png).decode('ascii')
    assert len(icon_b64) == TARGET_B64_LEN

    dex = bytearray(dex_data)
    string_ids_off = struct.unpack('<I', dex[60:64])[0]

    # === 1. Patch icon base64 (str[5911]) ===
    icon_str_off = struct.unpack('<I', dex[string_ids_off + 5911*4 : string_ids_off + 5911*4 + 4])[0]
    pos = icon_str_off
    uleb = 0; shift = 0
    while True:
        b = dex[pos]; pos += 1
        uleb |= (b & 0x7F) << shift
        if not (b & 0x80): break
        shift += 7
    assert uleb == TARGET_B64_LEN
    dex[pos:pos+TARGET_B64_LEN] = icon_b64.encode('ascii')
    assert dex[pos+TARGET_B64_LEN] == 0
    print(f'[+] classes.dex: icon base64 patched ({TARGET_B64_LEN} chars)')

    # === 2. Patch app name ===
    # Strategy: find the best slot in the DEX string table that:
    #   a) Fits the new name's MUTF-8 encoding
    #   b) Maintains sorted order with neighbors
    # str[8126]='インストール中'(21 bytes) + str[8127]='処理中...'(12 bytes) = 37 bytes available
    # Between '…'(U+2026) and '処理中...'(U+51E6) in sort order
    new_name_mutf8 = app_name.encode('utf-8')
    new_name_utf16_len = len(app_name.encode('utf-16-le')) // 2
    needed = 1 + len(new_name_mutf8) + 1  # ULEB + data + null

    # Check if name fits in the 37-byte combined slot
    off_8126 = struct.unpack('<I', dex[string_ids_off + 8126*4 : string_ids_off + 8126*4 + 4])[0]
    off_8128 = struct.unpack('<I', dex[string_ids_off + 8128*4 : string_ids_off + 8128*4 + 4])[0]
    total_space = off_8128 - off_8126  # 37 bytes

    # Need to leave at least 3 bytes for str[8127] (ULEB(1)+1byte_data+null minimum)
    max_name_bytes = total_space - 3  # 34 bytes max for name item
    max_name_data = max_name_bytes - 2  # minus ULEB(1) and null(1) = 32 bytes for MUTF-8

    if len(new_name_mutf8) <= max_name_data:
        # Check sort order: str[8126] must be > str[8125]('…'=e280a6) and < str[8128]('处理中...'=e5a484...)
        MIN_SORT = b'\xe2\x80\xa6'  # '…'
        MAX_SORT = b'\xe5\xa4\x84'  # '处' first bytes
        if new_name_mutf8 <= MIN_SORT or new_name_mutf8 >= MAX_SORT:
            # Prepend WORD JOINER (U+2060, invisible, e2 81 a0) to fix sort order
            app_name = '⁠' + app_name
            new_name_mutf8 = app_name.encode('utf-8')
            new_name_utf16_len = len(app_name.encode('utf-16-le')) // 2
            needed = 1 + len(new_name_mutf8) + 1
            if len(new_name_mutf8) > max_name_data:
                print(f'[!] Name too long with sort prefix ({len(new_name_mutf8)} > {max_name_data})')
                return dex_data

        # Write str[8126] = app name
        wp = off_8126
        dex[wp] = new_name_utf16_len; wp += 1
        dex[wp:wp+len(new_name_mutf8)] = new_name_mutf8; wp += len(new_name_mutf8)
        dex[wp] = 0; wp += 1

        # Write str[8127]: must sort > str[8126] and < str[8128]('处理中...')
        # Use '处理' + dots: '处理.' byte[5]=0x2e < '处理中' byte[5]=0xe4, always < str[8128]
        # And '处理' starts with e5 which is > any e2/e3/e4 prefix name
        new_8127_off = wp
        remaining = off_8128 - wp
        data_space = remaining - 2  # ULEB(1) + null(1)
        base_filler = '处理'
        base_bytes = base_filler.encode('utf-8')  # 6 bytes
        if data_space >= len(base_bytes):
            filler_data = base_bytes + b'.' * (data_space - len(base_bytes))
            filler_charlen = len(base_filler) + (data_space - len(base_bytes))
        else:
            filler_data = b'.' * data_space
            filler_charlen = data_space
        dex[wp] = filler_charlen if filler_charlen < 128 else 127; wp += 1
        dex[wp:wp+len(filler_data)] = filler_data; wp += len(filler_data)
        dex[wp] = 0; wp += 1
        assert wp == off_8128, f'Gap! wp=0x{wp:x} != off_8128=0x{off_8128:x}'

        # Update string_ids[8127] offset
        struct.pack_into('<I', dex, string_ids_off + 8127*4, new_8127_off)

        # Redirect const-string at 0x1b8192: str[1197] -> str[8126]
        CS_NAME_OFF = 0x1b8192
        assert dex[CS_NAME_OFF] == 0x1a
        struct.pack_into('<H', dex, CS_NAME_OFF+2, 8126)

        # Redirect old str[8126] user at 0x1b9a8c to str[8127]
        CS_INSTALL_OFF = 0x1b9a8c
        assert dex[CS_INSTALL_OFF] == 0x1a
        struct.pack_into('<H', dex, CS_INSTALL_OFF+2, 8127)

        print(f'[+] classes.dex: name patched -> str[8126] ({len(new_name_mutf8)} bytes)')
    else:
        print(f'[!] classes.dex: name too long ({len(new_name_mutf8)} bytes > {max_name_data}), skipped DEX name patch')
        print(f'    (manifest and resources.arsc still show the correct name)')

    # === 3. Patch PackageInstaller session package name ===
    # Shell DEX hardcodes 'com.stone.star.soft' at str[4627], const-string at 0x1b817a.
    # Strategy: physically rewrite string data for indices 4627-4629 within the same region,
    # rearranging content to maintain both sorted order and monotonic offset order.
    # Uses 2-byte ULEB128 on the last string to fill the region exactly (115 bytes).
    INNER_PKG = 'com.tool.move.good'
    REGION_START = 0x58541
    REGION_END = 0x585b4

    s1 = 'com.stone.star.soft.activity.SplashGateway'
    s2 = 'com.stone.star.soft.service.PlatformAssistDaemon'
    s3 = INNER_PKG

    wp = REGION_START
    new_offsets = []

    # str[4627] = s1 (42 chars, 1-byte ULEB)
    new_offsets.append(wp)
    dex[wp] = len(s1); wp += 1
    dex[wp:wp+len(s1)] = s1.encode('utf-8'); wp += len(s1)
    dex[wp] = 0; wp += 1

    # str[4628] = s2 (48 chars, 1-byte ULEB)
    new_offsets.append(wp)
    dex[wp] = len(s2); wp += 1
    dex[wp:wp+len(s2)] = s2.encode('utf-8'); wp += len(s2)
    dex[wp] = 0; wp += 1

    # str[4629] = s3 (18 chars, 2-byte ULEB128 to fill gap)
    new_offsets.append(wp)
    dex[wp] = 0x80 | (len(s3) & 0x7F); wp += 1
    dex[wp] = (len(s3) >> 7) & 0x7F; wp += 1
    dex[wp:wp+len(s3)] = s3.encode('utf-8'); wp += len(s3)
    dex[wp] = 0; wp += 1
    assert wp == REGION_END

    for i, off in enumerate(new_offsets):
        struct.pack_into('<I', dex, string_ids_off + (4627 + i) * 4, off)

    # Update const-string references to new indices
    assert dex[0x1b817a] == 0x1a and dex[0x1b8182] == 0x1a and dex[0x1b818a] == 0x1a
    struct.pack_into('<H', dex, 0x1b817a + 2, 4629)
    struct.pack_into('<H', dex, 0x1b8182 + 2, 4627)
    struct.pack_into('<H', dex, 0x1b818a + 2, 4628)
    print(f'[+] classes.dex: pkg session patched -> "{INNER_PKG}" (str[4629])')

    # Recalculate checksums
    sha1 = hashlib.sha1(dex[32:]).digest()
    dex[12:32] = sha1
    checksum = zlib.adler32(bytes(dex[12:])) & 0xFFFFFFFF
    struct.pack_into('<I', dex, 8, checksum)

    return bytes(dex)


def patch_inner_apk_package(inner_data, old_pkg='com.tool.move.good', new_pkg='com.stone.star.soft'):
    """Patch jw.apk manifest package name in-memory before encryption.
    Rebuilds the AXML string pool to accommodate the length change."""
    eocd_pos = find_eocd(inner_data)
    cd_offset, cd_size, num = get_central_directory(inner_data, eocd_pos)
    entries = parse_entries(inner_data, cd_offset, num)

    am_entry = None
    for e in entries:
        if e['name'] == 'AndroidManifest.xml':
            am_entry = e
            break
    if not am_entry:
        raise ValueError('AndroidManifest.xml not found in inner APK')

    am = bytearray(inner_data[am_entry['data_offset']:am_entry['data_offset']+am_entry['usize']])

    SP = 8
    sp_size = struct.unpack('<I', am[SP+4:SP+8])[0]
    sc = struct.unpack('<I', am[SP+8:SP+12])[0]
    sp_flags = struct.unpack('<I', am[SP+16:SP+20])[0]
    strings_start = struct.unpack('<I', am[SP+20:SP+24])[0]
    OFFSETS = SP + 28
    STRDATA = SP + strings_start

    offsets = [struct.unpack('<I', am[OFFSETS+i*4:OFFSETS+i*4+4])[0] for i in range(sc)]
    strings = []
    for i in range(sc):
        s_off = STRDATA + offsets[i]
        cc = struct.unpack('<H', am[s_off:s_off+2])[0]
        s = am[s_off+2:s_off+2+cc*2].decode('utf-16-le')
        strings.append(s)

    pkg_idx = strings.index(old_pkg)
    strings[pkg_idx] = new_pkg

    new_strdata = bytearray()
    new_offsets = []
    for s in strings:
        new_offsets.append(len(new_strdata))
        encoded = s.encode('utf-16-le')
        new_strdata.extend(struct.pack('<H', len(s)))
        new_strdata.extend(encoded)
        new_strdata.extend(b'\x00\x00')
    while len(new_strdata) % 4 != 0:
        new_strdata.append(0)

    new_strings_start = 28 + sc * 4
    new_sp_size = new_strings_start + len(new_strdata)

    sp_chunk = bytearray()
    sp_chunk.extend(struct.pack('<HH', 0x0001, 28))
    sp_chunk.extend(struct.pack('<I', new_sp_size))
    sp_chunk.extend(struct.pack('<I', sc))
    sp_chunk.extend(struct.pack('<I', 0))
    sp_chunk.extend(struct.pack('<I', sp_flags))
    sp_chunk.extend(struct.pack('<I', new_strings_start))
    sp_chunk.extend(struct.pack('<I', 0))
    for off in new_offsets:
        sp_chunk.extend(struct.pack('<I', off))
    sp_chunk.extend(new_strdata)

    old_sp_end = SP + sp_size
    rest = am[old_sp_end:]
    new_axml_size = 8 + len(sp_chunk) + len(rest)
    new_am = bytearray()
    new_am.extend(struct.pack('<I', 0x00080003))
    new_am.extend(struct.pack('<I', new_axml_size))
    new_am.extend(sp_chunk)
    new_am.extend(rest)

    size_diff = len(new_am) - len(am)
    print(f'[*] Inner APK manifest: {old_pkg} -> {new_pkg} (size diff: {size_diff:+d})')

    # Rebuild the inner APK ZIP with patched manifest (skip old signing files)
    out = bytearray()
    new_local_offsets = []
    rebuild_entries = [e for e in entries if not e['name'].startswith('META-INF/')]
    for e in rebuild_entries:
        new_local_offsets.append(len(out))
        if e['name'] == 'AndroidManifest.xml':
            file_data = bytes(new_am)
            crc = binascii.crc32(file_data) & 0xFFFFFFFF
            usize = len(file_data)
            csize = usize
            compress = 0
            flags = 0
        else:
            data_size = e['csize'] if e['csize'] > 0 else e['usize']
            file_data = inner_data[e['data_offset']:e['data_offset']+data_size]
            crc = e['crc']
            usize = e['usize']
            csize = e['csize']
            compress = e['lh_compress']
            flags = e['lh_flags']

        lh = make_lh(e['name'], flags, compress, e['mtime'], e['mdate'],
                     crc if not (flags & 0x08) else 0,
                     csize if not (flags & 0x08) else 0,
                     usize if not (flags & 0x08) else 0,
                     e['lh_extra'])
        out.extend(lh)
        out.extend(file_data)
        if flags & 0x08:
            dd = struct.pack('<4sIII', b'PK\x07\x08', crc, csize, usize)
            out.extend(dd)

    cd_start = len(out)
    cd_buf = bytearray()
    for idx, e in enumerate(rebuild_entries):
        if e['name'] == 'AndroidManifest.xml':
            crc = binascii.crc32(bytes(new_am)) & 0xFFFFFFFF
            usize = len(new_am)
            csize = usize
            compress = 0
            flags = 0
        else:
            crc = e['crc']
            usize = e['usize']
            csize = e['csize']
            compress = e['cd_compress']
            flags = e['cd_flags']
        cd_entry = make_cd(e['name'], flags, compress, e['mtime'], e['mdate'],
                          crc, csize, usize, new_local_offsets[idx],
                          e['cd_extra'], e['comment'])
        cd_buf.extend(cd_entry)

    out.extend(cd_buf)
    eocd = make_eocd(len(rebuild_entries), len(cd_buf), cd_start)
    out.extend(eocd)

    return bytes(out)


def patch_shell_manifest(shell_data, app_name):
    """从壳APK中提取AndroidManifest.xml，修改app label为指定名字。"""
    eocd_pos = find_eocd(shell_data)
    cd_offset, _, num = get_central_directory(shell_data, eocd_pos)
    entries = parse_entries(shell_data, cd_offset, num)

    am_entry = None
    for e in entries:
        if e['name'] == 'AndroidManifest.xml':
            am_entry = e
            break
    if not am_entry:
        raise ValueError('AndroidManifest.xml not found in shell APK')

    if am_entry['lh_compress'] == 8:
        comp = shell_data[am_entry['data_offset']:am_entry['data_offset']+am_entry['csize']]
        am = bytearray(zlib.decompress(comp, -15))
    else:
        am = bytearray(shell_data[am_entry['data_offset']:am_entry['data_offset']+am_entry['usize']])

    SP = 8
    sp_size = struct.unpack('<I', am[SP+4:SP+8])[0]
    sc = struct.unpack('<I', am[SP+8:SP+12])[0]
    sp_flags = struct.unpack('<I', am[SP+16:SP+20])[0]
    strings_start = struct.unpack('<I', am[SP+20:SP+24])[0]
    OFFSETS = SP + 28
    STRDATA = SP + strings_start

    offsets = [struct.unpack('<I', am[OFFSETS+i*4:OFFSETS+i*4+4])[0] for i in range(sc)]
    strings = []
    for i in range(sc):
        s_off = STRDATA + offsets[i]
        cc = struct.unpack('<H', am[s_off:s_off+2])[0]
        s = am[s_off+2:s_off+2+cc*2].decode('utf-16-le')
        strings.append(s)

    # Replace 'Kiss Free' label with custom name
    try:
        label_idx = strings.index('Kiss Free')
        strings[label_idx] = app_name
    except ValueError:
        for i, s in enumerate(strings):
            if 'kiss' in s.lower() or 'free' in s.lower():
                strings[i] = app_name
                break

    # Rebuild string pool
    new_strdata = bytearray()
    new_offsets = []
    for s in strings:
        new_offsets.append(len(new_strdata))
        encoded = s.encode('utf-16-le')
        new_strdata.extend(struct.pack('<H', len(s)))
        new_strdata.extend(encoded)
        new_strdata.extend(b'\x00\x00')
    while len(new_strdata) % 4 != 0:
        new_strdata.append(0)

    new_strings_start = 28 + sc * 4
    new_sp_size = new_strings_start + len(new_strdata)
    sp_chunk = bytearray()
    sp_chunk.extend(struct.pack('<HH', 0x0001, 28))
    sp_chunk.extend(struct.pack('<I', new_sp_size))
    sp_chunk.extend(struct.pack('<I', sc))
    sp_chunk.extend(struct.pack('<I', 0))
    sp_chunk.extend(struct.pack('<I', sp_flags))
    sp_chunk.extend(struct.pack('<I', new_strings_start))
    sp_chunk.extend(struct.pack('<I', 0))
    for off in new_offsets:
        sp_chunk.extend(struct.pack('<I', off))
    sp_chunk.extend(new_strdata)

    old_sp_end = SP + sp_size
    rest = am[old_sp_end:]
    new_axml_size = 8 + len(sp_chunk) + len(rest)
    new_am = bytearray()
    new_am.extend(struct.pack('<I', 0x00080003))
    new_am.extend(struct.pack('<I', new_axml_size))
    new_am.extend(sp_chunk)
    new_am.extend(rest)
    return bytes(new_am)


def pack_apk(shell_apk, inner_apk, app_name, icon_png, output_apk):
    with open(shell_apk, 'rb') as f:
        shell_data = f.read()
    with open(inner_apk, 'rb') as f:
        inner_data = f.read()
    print(f'[*] Inner APK: {len(inner_data):,} bytes (package name preserved)')

    # 动态生成patched manifest
    new_manifest = patch_shell_manifest(shell_data, app_name)
    print(f'[+] Manifest: label="{app_name}" ({len(new_manifest):,} bytes)')

    with open(icon_png, 'rb') as f:
        new_icon = f.read()

    # 用同一个图标生成各DPI版本（直接用原图，系统会自动缩放）
    icon_data_all = new_icon

    # 获取 mipmap icon 文件路径映射
    arsc_path = os.path.join(os.path.dirname(os.path.abspath(shell_apk)), 'kiss_arsc_raw.bin')
    mipmap_paths = get_mipmap_icon_paths(arsc_path)
    print(f'[*] mipmap icon paths: {len(mipmap_paths)} files to replace')

    eocd_pos = find_eocd(shell_data)
    cd_offset, cd_size, num = get_central_directory(shell_data, eocd_pos)
    entries = parse_entries(shell_data, cd_offset, num)
    print(f'[*] shell entries: {len(entries)}')

    asset1, asset2 = encrypt_inner_payload(inner_data)

    output_entries = []
    SKIP_ASSETS = {'assets/' + ASSET_NAME_1, 'assets/' + ASSET_NAME_2}
    icon_replaced = 0

    for e in entries:
        name = e['name']
        if name in SKIP_ASSETS:
            print(f'  [DEBUG] matched SKIP_ASSETS: {name!r}', file=sys.stderr)
            payload = asset1 if name == 'assets/' + ASSET_NAME_1 else asset2
            payload_comp = raw_deflate_stored(payload)
            payload_crc = binascii.crc32(payload) & 0xFFFFFFFF
            new_e = {
                'name': name,
                'mtime': e['mtime'], 'mdate': e['mdate'],
                'crc': payload_crc, 'usize': len(payload), 'csize': len(payload_comp),
                'lh_flags': 0x0808, 'cd_flags': 0x0808,
                'lh_compress': 8, 'cd_compress': 8,
                'data': payload_comp, 'has_dd': True,
                'extra': b'', 'comment': b'',
            }
            output_entries.append(new_e)
            print(f'[+] {name}: encrypted payload {len(payload):,} -> {len(payload_comp):,} bytes')
        elif name == 'AndroidManifest.xml':
            # 使用 patched manifest (label 改了)
            new_e = {
                'name': name,
                'mtime': e['mtime'], 'mdate': e['mdate'],
                'crc': binascii.crc32(new_manifest) & 0xFFFFFFFF,
                'usize': len(new_manifest), 'csize': len(new_manifest),
                'lh_flags': 0, 'cd_flags': 0,
                'lh_compress': 0, 'cd_compress': 0,
                'data': new_manifest, 'has_dd': False,
                'extra': b'', 'comment': b'',
            }
            output_entries.append(new_e)
            print(f'[+] AndroidManifest.xml: patched ({len(new_manifest):,} bytes, label=app icon={name})')
        elif name == 'assets/app_icon.png':
            new_e = {
                'name': name,
                'mtime': e['mtime'], 'mdate': e['mdate'],
                'crc': binascii.crc32(new_icon) & 0xFFFFFFFF,
                'usize': len(new_icon), 'csize': len(new_icon),
                'lh_flags': 0, 'cd_flags': 0,
                'lh_compress': 0, 'cd_compress': 0,
                'data': new_icon, 'has_dd': False,
                'extra': b'', 'comment': b'',
            }
            output_entries.append(new_e)
            print(f'[+] assets/app_icon.png: replaced with jw icon ({len(new_icon):,} bytes)')
        elif name in mipmap_paths:
            new_e = {
                'name': name,
                'mtime': e['mtime'], 'mdate': e['mdate'],
                'crc': binascii.crc32(icon_data_all) & 0xFFFFFFFF,
                'usize': len(icon_data_all), 'csize': len(icon_data_all),
                'lh_flags': 0, 'cd_flags': 0,
                'lh_compress': 0, 'cd_compress': 0,
                'data': icon_data_all, 'has_dd': False,
                'extra': b'', 'comment': b'',
            }
            output_entries.append(new_e)
            icon_replaced += 1
        elif name == 'resources.arsc':
            arsc_data = shell_data[e['data_offset']:e['data_offset']+e['usize']]
            patched_arsc = patch_arsc_app_name(arsc_data, app_name)
            new_e = {
                'name': name,
                'mtime': e['mtime'], 'mdate': e['mdate'],
                'crc': binascii.crc32(patched_arsc) & 0xFFFFFFFF,
                'usize': len(patched_arsc), 'csize': len(patched_arsc),
                'lh_flags': 0, 'cd_flags': 0,
                'lh_compress': 0, 'cd_compress': 0,
                'data': patched_arsc, 'has_dd': False,
                'extra': b'', 'comment': b'',
            }
            output_entries.append(new_e)
        elif name == 'classes.dex':
            if e['lh_compress'] == 8:
                comp_data = shell_data[e['data_offset']:e['data_offset']+e['csize']]
                dex_data = zlib.decompress(comp_data, -15)
            else:
                dex_data = shell_data[e['data_offset']:e['data_offset']+e['usize']]
            patched_dex = patch_dex_icon(dex_data, icon_png, app_name)
            new_e = {
                'name': name,
                'mtime': e['mtime'], 'mdate': e['mdate'],
                'crc': binascii.crc32(patched_dex) & 0xFFFFFFFF,
                'usize': len(patched_dex), 'csize': len(patched_dex),
                'lh_flags': 0, 'cd_flags': 0,
                'lh_compress': 0, 'cd_compress': 0,
                'data': patched_dex, 'has_dd': False,
                'extra': b'', 'comment': b'',
            }
            output_entries.append(new_e)
        else:
            data_size = e['csize'] if e['csize'] > 0 else e['usize']
            file_data = shell_data[e['data_offset']:e['data_offset']+data_size]
            new_e = {
                'name': name,
                'mtime': e['mtime'], 'mdate': e['mdate'],
                'crc': e['crc'], 'usize': e['usize'], 'csize': e['csize'],
                'lh_flags': e['lh_flags'], 'cd_flags': e['cd_flags'],
                'lh_compress': e['lh_compress'], 'cd_compress': e['cd_compress'],
                'data': file_data, 'has_dd': bool(e['lh_flags'] & 0x08),
                'extra': e['lh_extra'], 'comment': e['comment'],
            }
            output_entries.append(new_e)

    print(f'[+] mipmap icons replaced: {icon_replaced}/20')

    # 写出新 APK
    out = bytearray()
    local_offsets = []
    for e in output_entries:
        local_offsets.append(len(out))
        crc = e['crc']; csize = e['csize']; usize = e['usize']
        if e.get('has_dd'):
            crc = 0; csize = 0; usize = 0
        lh = make_lh(e['name'], e['lh_flags'], e['lh_compress'],
                    e['mtime'], e['mdate'], crc, csize, usize, e['extra'])
        out.extend(lh)
        out.extend(e['data'])
        if e.get('has_dd'):
            dd = struct.pack('<4sIII', b'PK\x07\x08', e['crc'], e['csize'], e['usize'])
            out.extend(dd)

    cd_start = len(out)
    cd_buf = bytearray()
    for idx, e in enumerate(output_entries):
        cd_entry = make_cd(e['name'], e['cd_flags'], e['cd_compress'],
                          e['mtime'], e['mdate'], e['crc'], e['csize'], e['usize'],
                          local_offsets[idx], e['extra'], e['comment'])
        cd_buf.extend(cd_entry)

    out.extend(cd_buf)
    cd_size = len(cd_buf)
    eocd = make_eocd(len(output_entries), cd_size, cd_start)
    out.extend(eocd)

    with open(output_apk, 'wb') as f:
        f.write(out)
    print(f'\n[+] Packed APK: {output_apk} ({len(out):,} bytes, {len(output_entries)} entries)')


def sign_apk(input_apk, output_apk, keystore=None, storepass='android', alias='androiddebugkey'):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if keystore is None:
        local_ks = os.path.join(script_dir, 'debug.keystore')
        if os.path.exists(local_ks):
            keystore = local_ks
        else:
            keystore = os.path.expanduser(r'~\.android\debug.keystore')
    # apksigner: PATH > local jar > hardcoded Windows path
    script_dir_jar = os.path.join(script_dir, 'tools', 'apksigner.jar')
    if shutil.which('apksigner'):
        cmd = [shutil.which('apksigner'), 'sign', '--ks', keystore, '--ks-pass', f'pass:{storepass}',
               '--ks-key-alias', alias, '--key-pass', f'pass:{storepass}',
               '--out', output_apk, input_apk]
    elif os.path.exists(script_dir_jar):
        cmd = ['java', '-jar', script_dir_jar, 'sign', '--ks', keystore, '--ks-pass', f'pass:{storepass}',
               '--ks-key-alias', alias, '--key-pass', f'pass:{storepass}',
               '--out', output_apk, input_apk]
    else:
        apksigner = r'C:\Users\74208.晴天\AppData\Local\Android\Sdk\build-tools\36.1.0\apksigner.bat'
        cmd = [apksigner, 'sign', '--ks', keystore, '--ks-pass', f'pass:{storepass}',
               '--ks-key-alias', alias, '--key-pass', f'pass:{storepass}',
               '--out', output_apk, input_apk]
    print(f'\n[*] Signing: {input_apk}')
    print(f'    cmd: {" ".join(cmd)}')
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(f'    stdout: {r.stdout}')
    print(f'    stderr: {r.stderr}')
    if r.returncode != 0:
        print(f'[!] signing failed: {r.returncode}')
        sys.exit(1)
    print(f'[+] Signed: {output_apk}')


def main():
    import argparse
    parser = argparse.ArgumentParser(description='APK加壳工具 - 用Kiss Free壳包装目标APK')
    parser.add_argument('inner_apk', help='要加壳的目标APK (如 jw.apk)')
    parser.add_argument('-n', '--name', required=True, help='显示的应用名 (如 ツイットヴァスト)')
    parser.add_argument('-i', '--icon', required=True, help='应用图标PNG文件路径')
    parser.add_argument('-s', '--shell', default='Kiss Free.apk', help='壳APK (默认: Kiss Free.apk)')
    parser.add_argument('-o', '--output', default=None, help='输出文件名 (默认: packed_<inner>.apk)')
    args = parser.parse_args()

    if args.output is None:
        base = os.path.splitext(os.path.basename(args.inner_apk))[0]
        args.output = f'packed_{base}.apk'

    # 检查名字MUTF-8长度限制
    name_bytes = len(args.name.encode('utf-8'))
    if name_bytes > 32:
        print(f'[!] 应用名UTF-8编码{name_bytes}字节，超过DEX限制(32字节)')
        print(f'    manifest和设置中会正常显示，但应用介绍页可能显示不了')

    print(f'[*] 壳APK: {args.shell}')
    print(f'[*] 目标APK: {args.inner_apk}')
    print(f'[*] 应用名: {args.name}')
    print(f'[*] 图标: {args.icon}')
    print(f'[*] 输出: {args.output}')
    print()

    pack_apk(args.shell, args.inner_apk, args.name, args.icon, args.output)
    signed = args.output.replace('.apk', '_signed.apk')
    sign_apk(args.output, signed)
    print(f'\n[OK] 最终文件: {signed}')


if __name__ == '__main__':
    main()