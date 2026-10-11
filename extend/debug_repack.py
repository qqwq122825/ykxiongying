import sys, struct, os, zlib
sys.path.insert(0, '.')

# 手动运行 _repack_raw 步骤，看 resources.arsc 是否进入处理
src_path = 'source.apk'
src_data = open(src_path, 'rb').read()

# 解析 EOCD
eocd_sig = b'\x50\x4b\x05\x06'
eocd_pos = src_data.rfind(eocd_sig)
eocd = src_data[eocd_pos:]
cd_size = struct.unpack_from('<I', eocd, 12)[0]
cd_offset = struct.unpack_from('<I', eocd, 16)[0]
cd_data = src_data[cd_offset:cd_offset + cd_size]

# 找 resources.arsc 的 entry
pos = 0
ra_idx = None
all_idx = []
while pos < len(cd_data):
    if cd_data[pos:pos+4] != b'\x50\x4b\x01\x02':
        break
    fn_len = struct.unpack_from('<H', cd_data, pos + 28)[0]
    ex_len = struct.unpack_from('<H', cd_data, pos + 30)[0]
    cm_len = struct.unpack_from('<H', cd_data, pos + 32)[0]
    fn = cd_data[pos+46:pos+46+fn_len].decode('utf-8', errors='replace')
    local_off = struct.unpack_from('<I', cd_data, pos + 42)[0]
    all_idx.append((local_off, fn, pos))
    pos += 46 + fn_len + ex_len + cm_len

print(f'Total entries in CD: {len(all_idx)}')
all_idx.sort()
# 找 resources.arsc
for i, (off, fn, _) in enumerate(all_idx):
    if 'resources.arsc' in fn:
        print(f'resources.arsc at index {i} (sorted by local_offset): offset={off}')
        # 计算 total_local_size
        if i + 1 < len(all_idx):
            next_off = all_idx[i+1][0]
        else:
            next_off = cd_offset
        total = next_off - off
        print(f'  Next entry local_offset: {next_off}, total_local_size: {total}')
        break