<?php
namespace app\middleware;

use think\facade\Request;

class Auth
{
    private array $whitelist = [
        '/api/auth/login',
        '/api/auth/login-telegram-verify',
        '/api/auth/register',
        '/api/auth/check-initialization',
        '/api/telegram/webhook',
        // ★ 设备端公开回调（无 JWT）：仅保留真正由 APK/Go 端主动上报的接口
        '/api/tunnel/config',
        '/api/tunnel/frpc-config',
        '/api/tunnel/status',
        '/api/tunnel/deployed',
        '/api/tunnel/refresh-frps-env',
        // ★ 2026-09-18：minicap-stream 必须保留白名单
        //   原因：浏览器通过 <img src="/api/tunnel/minicap-stream?..."> 请求 MJPEG 视频流，
        //         <img> 标签无法设置自定义 Authorization: Bearer header，只能走 query 参数。
        //         extractToken() 已经支持从 GET token 参数取 JWT，即使在白名单也能自行校验，
        //         同时 TunnelController::minicapStream() 内部必须再做一次设备归属兜底。
        '/api/tunnel/minicap-stream',
        // ★ 2026-09-18 安全修复：shell/input/screenshot/bootstrap/setDeviceId 是
        //   管理面板主动调用接口，必须走 JWT 登录认证 + 设备归属兜底校验，不得加入公开白名单！
        //   之前误列入白名单导致：1)任何人可直接控制所有设备屏幕（严重安全漏洞）
        //                         2)$request->user 没注入 → checkDeviceScope 跳过 → 虽不直接造成502
        //                           但 proxyToLocalService 缺少必要 X-Device-ID header 反而可能被 Go local-service 丢弃
        // ★ /spi/* 是前端旧版硬编码别名，和 /api/* 1:1 等效
        '/spi/auth/login',
        '/spi/auth/login-telegram-verify',
        '/spi/auth/register',
        '/spi/auth/check-initialization',
        '/spi/telegram/webhook',
        '/spi/tunnel/config',
        '/spi/tunnel/frpc-config',
        '/spi/tunnel/status',
        '/spi/tunnel/deployed',
        '/spi/tunnel/refresh-frps-env',
        // ★ minicap-stream 对应 /spi/ 别名
        '/spi/tunnel/minicap-stream',
        // ★ 2026-08-06 安全修复：从 Node /internal/ 迁移时应保持鉴权。
        // Node 端该端点原本有 requireSuperAdmin（superadmin 专属），
        // 迁移后不应放入公开白名单，改为要求登录认证（与其它管理接口一致）。
        // '/api/tunnel/tunnel-status',  → 已移除：改为需登录访问
        '/api/apk/download',
        '/spi/apk/download',
        // ★ 2026-09-18 关键修复：/api/device/* 下的设备端公开回调接口（无 JWT）逐个加入精确白名单，
        //   禁止使用前缀白名单 /api/device/，否则管理接口 listDevices 会跳过 JWT user 注入
        //   → currentActor() 返回空 → managedUsernames 返回 [] → 前端总设备数 0
        '/api/device/serverHost',
        '/api/device/localServiceHeartbeat',
        '/api/device/tasks',
        '/api/device/pendingCommands',
        '/api/device/message',
        '/api/device/commandResult',
        '/api/device/task/responses',
        '/api/device/cacheTaskResult',
        '/api/device/installLog',
        '/api/device/install-log',
        '/api/device/adb-key',
        '/api/device/data/screen-monitord',
        '/api/device/upload/video',
        '/api/device/blacklist',
        '/api/device/rewriteDebugPort',
        '/api/device/rewriteRpcConfig',
        '/api/device/injection/global-configs',
        '/spi/device/serverHost',
        '/spi/device/localServiceHeartbeat',
        '/spi/device/tasks',
        '/spi/device/pendingCommands',
        '/spi/device/message',
        '/spi/device/commandResult',
        '/spi/device/task/responses',
        '/spi/device/cacheTaskResult',
        '/spi/device/installLog',
        '/spi/device/install-log',
        '/spi/device/adb-key',
        '/spi/device/data/screen-monitord',
        '/spi/device/upload/video',
        '/spi/device/blacklist',
        '/spi/device/rewriteDebugPort',
        '/spi/device/rewriteRpcConfig',
        '/spi/device/injection/global-configs',
        '/api/device-custom-info',
        '/spi/device-custom-info',
    ];

    // ★ 2026-09-18 关键修复：设备端公开回调使用【前缀通配】，仅支持设备端专用前缀，不要包含 /api/device/ 和 /spi/device/
    //   因为 /api/device/* 是管理面板接口（需要登录鉴权），不能在白名单；设备端接口只有 /api/sync/* /api/client/*
    //   卡壳根因：之前把 /api/device/* 加前缀白名单→ 管理接口 listDevices 跳过 JWT user 注入
    //           → currentActor() 返回空 → managedUsernames 返回 [] → 查不到设备 → 前端显示总设备数 0
    //   这些前缀的所有子接口原本在 Node-WS 都是设备端无 JWT 公开回调，鉴权通过请求体里的 deviceId/signature 做二次校验
    private array $whitelistPrefixes = [
        '/api/client/',
        '/api/sync/',
        '/spi/client/',
        '/spi/sync/',
    ];

    public function handle($request, \Closure $next)
    {
        $path = $request->pathinfo();
        $path = preg_replace('#^index\.php/?#', '', $path);
        // pathinfo() 不带前导 /，白名单统一用带 / 的格式
        $path = '/' . ltrim($path, '/');

        // 非 /api/ 且 非 /spi/ 路径不需要认证（前端 SPA 页面）
        // ★ 2026-09-18 关键修复：之前只判断 str_starts_with($path,'/api/')，
        //   导致访问 /spi/* 时走到 extractToken 拿不到合法 JWT → 直接回 400 → 控制中心投屏 502
        if (!str_starts_with($path, '/api/') && !str_starts_with($path, '/spi/')) {
            return $next($request);
        }

        // 精确白名单匹配
        if (in_array($path, $this->whitelist)) {
            return $next($request);
        }

        // 前缀通配白名单（设备端公开回调：/api/sync/* /api/client/* /api/device/*）
        foreach ($this->whitelistPrefixes as $prefix) {
            if (str_starts_with($path, $prefix)) {
                return $next($request);
            }
        }

        $token = $this->extractToken($request);
        if (!$token) {
            return json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        $user = $this->verifyToken($token);
        if (!$user) {
            return json(['success' => false, 'message' => 'Token验证失败'], 401);
        }

        // 查数据库检查用户是否被禁用（实时拦截已登录但被禁用的账号）
        $dbUser = \think\facade\Db::table('fisher_users')->where('id', $user['user_id'])->find();
        if (!$dbUser) {
            return json(['success' => false, 'message' => '用户不存在'], 401);
        }
        if (isset($dbUser['enabled']) && ($dbUser['enabled'] === 0 || $dbUser['enabled'] === '0' || $dbUser['enabled'] === false)) {
            return json(['success' => false, 'message' => '该账号已被禁用'], 403);
        }
        // 检查账号是否已过期
        if (!empty($dbUser['expire_at']) && (int)$dbUser['expire_at'] > 0 && (int)$dbUser['expire_at'] < time()) {
            return json(['success' => false, 'message' => '该账号已过期，请联系管理员续期'], 403);
        }
        // 允许同一账号多端/多标签同时在线。
        // 这里只保留 token 签名、用户存在、启用状态、过期时间校验，
        // 不再用 auth_session_{userId} 把其它浏览器标签判为失效。

        // 权限以数据库实时值为准，避免旧 JWT 在账号降权后继续保留管理员权限。
        $user['username'] = $dbUser['username'] ?? ($user['username'] ?? '');
        $user['role'] = $dbUser['role'] ?? 'user';
        $request->user = $user;
        $request->userPayload = $user;

        $deviceScopeError = $this->checkDeviceScope($request, $user, $path);
        if ($deviceScopeError) {
            return $deviceScopeError;
        }
        return $next($request);
    }

    /**
     * 为所有已认证控制器提供统一设备归属兜底，避免其它控制器仅凭 deviceId
     * 就跨账号查询数据或下发命令。设备端公开回调已在白名单分支提前返回，
     * 不会进入这里。
     */
    private function checkDeviceScope($request, array $user, string $path)
    {
        $deviceId = trim((string)$request->param('deviceId', ''));
        if ($deviceId === '') {
            $deviceId = trim((string)$request->param('device_id', ''));
        }

        // 这几个 /api/device/:id/* 路由使用通用参数名 id，需要从路径提取。
        if ($deviceId === '' && preg_match(
            '#^/(api|spi)/device/([^/]+)/(apps|auto-injection|global-injection-status|permissions)$#',
            $path,
            $matches
        )) {
            $deviceId = rawurldecode($matches[2]);
        }

        if ($deviceId === '') return null;
        if (in_array($user['role'] ?? '', ['superadmin', 'super-admin'], true)) return null;

        $username = trim((string)($user['username'] ?? ''));
        $scope = $username === '' ? [] : [$username];
        if (($user['role'] ?? 'user') === 'admin' && $username !== '') {
            $children = \think\facade\Db::table('fisher_users')
                ->where('parent_username', $username)
                ->column('username');
            $scope = array_values(array_unique(array_filter(array_merge($scope, $children), 'strlen')));
        }

        $authorized = $scope && \think\facade\Db::table('fisher_devices')
            ->where('device_id', $deviceId)
            ->whereIn('owner_username', $scope)
            ->find();
        if ($authorized) return null;

        $record = [
            'time' => date('c'),
            'action' => 'device.access_denied',
            'actor_id' => $user['user_id'] ?? null,
            'actor_username' => $username,
            'actor_role' => $user['role'] ?? '',
            'ip' => $request->ip(),
            'details' => ['device_id' => $deviceId, 'path' => $path],
        ];
        @file_put_contents(
            runtime_path() . 'security_audit.log',
            json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL,
            FILE_APPEND | LOCK_EX
        );
        return json(['success' => false, 'message' => 'Device not found'], 404);
    }

    private function extractToken($request): ?string
    {
        $auth = $request->header('Authorization', '');
        if (str_starts_with($auth, 'Bearer ')) {
            return substr($auth, 7);
        }
        $body = $request->post();
        if (!empty($body['token'])) {
            return $body['token'];
        }
        $qt = $request->get('token', '');
        return $qt ?: null;
    }

    private function verifyToken(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) return null;

        [$h, $p, $s] = $parts;
        $secret = (string)env('JWT.JWT_SECRET', '');
        $weakSecrets = ['fisher_secret_2026', 'secret', 'changeme', '123456', 'password'];
        if (strlen($secret) < 32 || in_array($secret, $weakSecrets, true)) {
            error_log('[Auth] JWT_SECRET missing, too short, or insecure');
            return null;
        }
        $expected = $this->b64(hash_hmac('sha256', "$h.$p", $secret, true));
        if (!hash_equals($expected, $s)) return null;

        $payload = json_decode(base64_decode(strtr($p, '-_', '+/')), true);
        if (!$payload || !isset($payload['user_id'])) return null;
        if (isset($payload['exp']) && $payload['exp'] < time()) return null;

        return $payload;
    }

    private function b64(string $d): string
    {
        return rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
    }
}
