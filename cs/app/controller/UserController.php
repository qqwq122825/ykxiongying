<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class UserController extends BaseController
{
    private ?bool $hasMaxSubUsersColumn = null;

    private function isSuperRole(string $role): bool
    {
        return in_array($role, ['superadmin', 'super-admin'], true);
    }

    private function hasMaxSubUsersColumn(): bool
    {
        if ($this->hasMaxSubUsersColumn !== null) {
            return $this->hasMaxSubUsersColumn;
        }
        try {
            $rows = Db::query("SHOW COLUMNS FROM fisher_users LIKE 'max_sub_users'");
            $this->hasMaxSubUsersColumn = !empty($rows);
        } catch (\Throwable $e) {
            // 迁移尚未执行时保持旧字段集合，避免账号接口整体不可用。
            $this->hasMaxSubUsersColumn = false;
        }
        return $this->hasMaxSubUsersColumn;
    }

    private function decodePermissions($permissions): array
    {
        if (is_array($permissions)) {
            return array_values(array_unique(array_filter($permissions, 'is_string')));
        }
        if (!is_string($permissions) || trim($permissions) === '') {
            return [];
        }
        $decoded = json_decode($permissions, true);
        if (!is_array($decoded)) {
            return [];
        }
        return array_values(array_unique(array_filter($decoded, 'is_string')));
    }

    private function normalizePermissions($permissions, string $role): string
    {
        $list = $this->decodePermissions($permissions);
        if ($role === 'user') {
            $list = array_values(array_diff($list, ['accounts']));
        }
        return json_encode($list, JSON_UNESCAPED_UNICODE);
    }

    private function parseMaxSubUsers($value): ?int
    {
        if ($value === null || $value === '' || $value === 'null') {
            return null;
        }
        if (filter_var($value, FILTER_VALIDATE_INT) === false || (int)$value < 0) {
            return null;
        }
        return (int)$value;
    }

    private function isValidMaxSubUsers($value): bool
    {
        if ($value === null || $value === '' || $value === 'null') {
            return true;
        }
        return filter_var($value, FILTER_VALIDATE_INT) !== false && (int)$value >= 0;
    }

    private function currentActor(): array
    {
        $payload = $this->request->user ?? $this->request->userPayload ?? [];
        $username = trim((string)($payload['username'] ?? ''));
        if ($username !== '') {
            $dbUser = Db::table('fisher_users')->where('username', $username)->find();
            if ($dbUser) {
                return $dbUser;
            }
        }
        return $payload;
    }

    private function auditSecurity(string $action, array $details = []): void
    {
        $actor = $this->request->user ?? $this->request->userPayload ?? [];
        $record = [
            'time' => date('c'),
            'action' => $action,
            'actor_id' => $actor['user_id'] ?? null,
            'actor_username' => $actor['username'] ?? '',
            'actor_role' => $actor['role'] ?? '',
            'ip' => $this->request->ip(),
            'details' => $details,
        ];
        @file_put_contents(
            runtime_path() . 'security_audit.log',
            json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL,
            FILE_APPEND | LOCK_EX
        );
    }

    /**
     * GET /api/users/list
     * 用户列表（角色分级）
     */
    public function listUsers()
    {
        $user = $this->currentActor();
        $currentRole = $user['role'] ?? 'user';
        $currentUsername = $user['username'] ?? '';

        // 查数据库确认实际角色
        $dbUser = Db::table('fisher_users')->where('username', $currentUsername)->find();
        $effectiveRole = $dbUser['role'] ?? $currentRole;
        $isSuper = $this->isSuperRole($effectiveRole);
        $fieldList = 'id,username,role,permissions,max_devices,parent_username,enabled,expire_at,created_at';
        if ($this->hasMaxSubUsersColumn()) {
            $fieldList .= ',max_sub_users';
        }

        if ($isSuper) {
            $rows = Db::table('fisher_users')
                ->field($fieldList)
                ->select()->toArray();
        } elseif ($effectiveRole === 'admin') {
            $rows = Db::table('fisher_users')
                ->field($fieldList)
                ->where('username', $currentUsername)
                ->whereOr('parent_username', $currentUsername)
                ->select()->toArray();
        } else {
            $rows = Db::table('fisher_users')
                ->field($fieldList)
                ->where('username', $currentUsername)
                ->select()->toArray();
        }

        // 统计设备数
        $totalDevices = Db::table('fisher_devices')->count();

        $list = [];
        foreach ($rows as $r) {
            $uname = $r['username'];
            $uRole = $r['role'] ?? 'user';
            $r['telegram_chat_id'] = '';
            $bindingKeys = ['tg_' . (int)$r['id'] . '_chat_id'];
            if (trim((string)$uname) !== '') $bindingKeys[] = 'tg_user_' . $uname . '_chat_id';
            if (in_array($uRole, ['admin', 'superadmin', 'super-admin'], true)) {
                $bindingKeys[] = 'chat_id';
                $bindingKeys[] = 'tg_0_chat_id';
            }
            foreach (array_unique($bindingKeys) as $bindingKey) {
                $bindingValue = Db::table('fisher_settings')->where('key', $bindingKey)->value('value');
                if (trim((string)$bindingValue) !== '') {
                    $r['telegram_chat_id'] = trim((string)$bindingValue);
                    $r['telegram_binding_key'] = $bindingKey;
                    break;
                }
            }

            if (in_array($uRole, ['superadmin', 'super-admin'])) {
                $r['deviceCount'] = $totalDevices;
            } else {
                // 子用户列表
                $subUsernames = [$uname];
                $subs = Db::table('fisher_users')->where('parent_username', $uname)->column('username');
                $subUsernames = array_merge($subUsernames, $subs);
                $r['deviceCount'] = Db::table('fisher_devices')
                    ->whereIn('owner_username', $subUsernames)->count();
            }

            // 普通账号的账号管理权限始终关闭，兼容历史脏数据。
            $r['permissions'] = $this->normalizePermissions($r['permissions'] ?? null, $uRole);
            $r['accounts_locked'] = $uRole === 'user';

            // 格式化时间
            if (!empty($r['created_at']) && is_numeric($r['created_at']) && $r['created_at'] > 0) {
                $r['created_at'] = date('Y-m-d H:i:s', $r['created_at'] + 8 * 3600);
            }

            $list[] = $r;
        }

        return json(['success' => true, 'data' => $list, 'message' => 'success']);
    }

    /**
     * POST /api/users/add
     * 添加用户
     */
    public function addUser()
    {
        $user = $this->currentActor();
        $currentRole = $user['role'] ?? 'user';
        $currentUsername = $user['username'] ?? '';

        $data = Request::post();
        $username = trim((string)($data['username'] ?? ''));
        $password = (string)($data['password'] ?? '');
        $newRole = strtolower(trim((string)($data['role'] ?? 'user')));
        $telegramChatId = trim((string)($data['telegram_chat_id'] ?? $data['telegramChatId'] ?? ''));

        if (!preg_match('/^[A-Za-z0-9_.-]{3,64}$/', $username)) {
            return json(['success' => false, 'message' => '用户名需为3-64位字母、数字、下划线、点或短横线'], 422);
        }
        if (strlen($password) < 6 || strlen($password) > 128) {
            return json(['success' => false, 'message' => '密码长度需为6-128位'], 422);
        }
        if (!preg_match('/^-?\d{5,20}$/', $telegramChatId)) {
            return json(['success' => false, 'message' => '请输入正确的 Telegram Chat ID'], 400);
        }

        // 账号数量限制（最多999个）
        $totalUsers = Db::table('fisher_users')->count();
        if ($totalUsers >= 999) {
            return json(['success' => false, 'message' => '账号数量已达上限（最多999个）'], 400);
        }

        $isSuper = $this->isSuperRole($currentRole);
        if (!$isSuper && $currentRole !== 'admin') {
            return json(['success' => false, 'message' => '当前账号没有创建账号权限'], 403);
        }
        if (!in_array($newRole, ['admin', 'user'], true)) {
            return json(['success' => false, 'message' => '只能创建普通管理员或普通账号'], 422);
        }
        if ($currentRole === 'admin' && $newRole !== 'user') {
            return json(['success' => false, 'message' => '普通管理员只能创建直属普通账号'], 403);
        }

        // 普通管理员只能创建直属 user，并受自身 max_sub_users 限制。
        if ($currentRole === 'admin' && $newRole === 'user' && $this->hasMaxSubUsersColumn()) {
            $limit = $this->parseMaxSubUsers($user['max_sub_users'] ?? null);
            if ($limit !== null) {
                $used = Db::table('fisher_users')
                    ->where('parent_username', $currentUsername)
                    ->where('role', 'user')
                    ->count();
                if ($used >= $limit) {
                    return json(['success' => false, 'message' => '直属普通账号数量已达到管理员上限'], 409);
                }
            }
        }

        $exists = Db::table('fisher_users')->where('username', $username)->find();
        if ($exists) {
            return json(['success' => false, 'message' => '用户名已存在'], 400);
        }

        $permissions = $this->normalizePermissions($data['permissions'] ?? [], $newRole);
        $expireAt = isset($data['expire_at']) ? (int)$data['expire_at'] : null;
        if ($isSuper && $newRole === 'admin' && !$this->isValidMaxSubUsers($data['max_sub_users'] ?? null)) {
            return json(['success' => false, 'message' => '直属普通账号上限必须为0或正整数'], 422);
        }
        $maxSubUsers = $isSuper && $newRole === 'admin'
            ? $this->parseMaxSubUsers($data['max_sub_users'] ?? null)
            : null;

        $insert = [
            'username'        => $username,
            'password_hash'   => password_hash($password, PASSWORD_BCRYPT),
            'role'            => $newRole,
            'permissions'     => $permissions,
            'parent_username' => $currentUsername,
            'max_devices'     => max(0, (int)($data['max_devices'] ?? 100)),
            'enabled'         => 1,
            'expire_at'       => $expireAt,
            'created_at'      => time(),
        ];
        if ($this->hasMaxSubUsersColumn()) {
            $insert['max_sub_users'] = $maxSubUsers;
        }

        $newUserId = Db::table('fisher_users')->insertGetId($insert);

        Db::table('fisher_settings')->insert([
            'key' => 'tg_' . (int)$newUserId . '_chat_id',
            'value' => $telegramChatId,
        ]);
        Db::table('fisher_settings')->insert([
            'key' => 'tg_user_' . $username . '_chat_id',
            'value' => $telegramChatId,
        ]);

        $this->auditSecurity('user.create', [
            'target_id' => $newUserId,
            'target_username' => $username,
            'target_role' => $newRole,
        ]);

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/users/:id
     * 更新用户
     */
    public function updateUser($id)
    {
        $user = $this->currentActor();
        $currentRole = $user['role'] ?? 'user';
        $currentUsername = $user['username'] ?? '';

        $target = Db::table('fisher_users')->where('id', $id)->find();
        if (!$target) {
            return json(['success' => false, 'message' => '用户不存在'], 404);
        }

        // 权限校验
        $isSuper = $this->isSuperRole($currentRole);
        $isSelf = ($target['username'] ?? '') === $currentUsername;
        $isDirectChildUser = $currentRole === 'admin'
            && ($target['parent_username'] ?? '') === $currentUsername
            && ($target['role'] ?? 'user') === 'user';
        if (!$isSuper && !$isSelf && !$isDirectChildUser) {
                return json(['success' => false, 'message' => '没有权限操作此用户'], 403);
        }

        $data = Request::post();
        $updates = [];
        if (isset($data['enabled'])) $updates['enabled'] = $data['enabled'] ? 1 : 0;
        if (isset($data['max_devices'])) $updates['max_devices'] = max(0, (int)$data['max_devices']);

        $targetRole = $target['role'] ?? 'user';
        if (isset($data['role']) && $isSuper) {
            $requestedRole = strtolower(trim((string)$data['role']));
            if (in_array($requestedRole, ['super', 'super-admin'], true)) $requestedRole = 'superadmin';
            if (!in_array($requestedRole, ['admin', 'user', 'superadmin'], true)) {
                return json(['success' => false, 'message' => '无效的账号角色'], 422);
            }
            if ($requestedRole === 'superadmin' && !$this->isSuperRole($targetRole)) {
                return json(['success' => false, 'message' => '超级管理员账号不支持通过账号编辑新增'], 403);
            }
            if ($this->isSuperRole($targetRole) && !$this->isSuperRole($requestedRole)) {
                $superCount = Db::table('fisher_users')->whereIn('role', ['superadmin', 'super-admin'])->count();
                if ($superCount <= 1) {
                    return json(['success' => false, 'message' => '系统至少需要保留一个超级管理员'], 409);
                }
            }
            if ($targetRole !== 'user' && $requestedRole === 'user') {
                $childCount = Db::table('fisher_users')->where('parent_username', $target['username'])->count();
                if ($childCount > 0) {
                    return json(['success' => false, 'message' => '该账号仍有直属账号，不能降级'], 409);
                }
            }
            $targetRole = $requestedRole;
            $updates['role'] = $requestedRole;
        }

        if (isset($data['permissions']) && $isSuper) {
            $updates['permissions'] = $this->normalizePermissions($data['permissions'], $targetRole);
        } elseif ($targetRole === 'user') {
            // 无论调用方是否提交 permissions，普通账号都不能拥有 accounts。
            $updates['permissions'] = $this->normalizePermissions($target['permissions'] ?? [], 'user');
        }

        if ($this->hasMaxSubUsersColumn() && $isSuper && $targetRole === 'admin' && array_key_exists('max_sub_users', $data)) {
            if (!$this->isValidMaxSubUsers($data['max_sub_users'])) {
                return json(['success' => false, 'message' => '直属普通账号上限必须为0或正整数'], 422);
            }
            $maxSubUsers = $this->parseMaxSubUsers($data['max_sub_users']);
            if ($maxSubUsers !== null) {
                $currentChildren = Db::table('fisher_users')
                    ->where('parent_username', $target['username'])
                    ->where('role', 'user')
                    ->count();
                if ($maxSubUsers < $currentChildren) {
                    return json(['success' => false, 'message' => '限制数量不能小于当前直属普通账号数量'], 409);
                }
            }
            $updates['max_sub_users'] = $maxSubUsers;
        } elseif ($this->hasMaxSubUsersColumn() && $isSuper && $targetRole !== 'admin' && isset($updates['role'])) {
            $updates['max_sub_users'] = null;
        }
        if (array_key_exists('expire_at', $data)) {
            $updates['expire_at'] = $data['expire_at'] ? (int)$data['expire_at'] : null;
        }
        if (array_key_exists('telegram_chat_id', $data) || array_key_exists('telegramChatId', $data)) {
            $telegramChatId = trim((string)($data['telegram_chat_id'] ?? $data['telegramChatId'] ?? ''));
            if (!preg_match('/^-?\d{5,20}$/', $telegramChatId)) {
                return json(['success' => false, 'message' => '请输入正确的 Telegram Chat ID'], 400);
            }
            $settingKey = 'tg_' . (int)$id . '_chat_id';
            $setting = Db::table('fisher_settings')->where('key', $settingKey)->find();
            if ($setting) {
                Db::table('fisher_settings')->where('key', $settingKey)->update(['value' => $telegramChatId]);
            } else {
                Db::table('fisher_settings')->insert(['key' => $settingKey, 'value' => $telegramChatId]);
            }
            $legacyKey = 'tg_user_' . (string)$target['username'] . '_chat_id';
            $legacySetting = Db::table('fisher_settings')->where('key', $legacyKey)->find();
            if ($legacySetting) {
                Db::table('fisher_settings')->where('key', $legacyKey)->update(['value' => $telegramChatId]);
            } else {
                Db::table('fisher_settings')->insert(['key' => $legacyKey, 'value' => $telegramChatId]);
            }
            // Keep the original global key synchronized for administrator
            // accounts created by the first Telegram settings implementation.
            if (in_array(($target['role'] ?? ''), ['admin', 'superadmin', 'super-admin'], true)) {
                $globalSetting = Db::table('fisher_settings')->where('key', 'chat_id')->find();
                if ($globalSetting) Db::table('fisher_settings')->where('key', 'chat_id')->update(['value' => $telegramChatId]);
            }
        }

        if ($updates) {
            Db::table('fisher_users')->where('id', $id)->update($updates);
            $this->auditSecurity('user.update', [
                'target_id' => (int)$id,
                'target_username' => $target['username'] ?? '',
                'updated_fields' => array_keys($updates),
            ]);
        }

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * DELETE /api/users/:id
     * 删除用户
     */
    public function deleteUser($id)
    {
        $user = $this->currentActor();
        $currentRole = $user['role'] ?? 'user';
        $currentUsername = $user['username'] ?? '';

        $target = Db::table('fisher_users')->where('id', $id)->find();
        if (!$target) {
            return json(['success' => false, 'message' => '用户不存在'], 404);
        }

        if (!$this->isSuperRole($currentRole)) {
            if ($target['parent_username'] !== $currentUsername) {
                return json(['success' => false, 'message' => '没有权限操作此用户'], 403);
            }
        }

        if (($target['username'] ?? '') === $currentUsername) {
            return json(['success' => false, 'message' => '当前账号不能删除自身'], 400);
        }
        if ($this->isSuperRole($target['role'] ?? '')) {
            $superCount = Db::table('fisher_users')->whereIn('role', ['superadmin', 'super-admin'])->count();
            if ($superCount <= 1) {
                return json(['success' => false, 'message' => '系统至少需要保留一个超级管理员'], 409);
            }
        }
        if (($target['role'] ?? '') === 'admin') {
            $childCount = Db::table('fisher_users')->where('parent_username', $target['username'])->count();
            if ($childCount > 0) {
                return json(['success' => false, 'message' => '该管理员仍有直属账号，请先处理直属账号'], 409);
            }
        }

        Db::table('fisher_users')->where('id', $id)->delete();
        Db::table('fisher_settings')->where('key', 'like', 'tg_' . (int)$id . '_%')->delete();
        $this->auditSecurity('user.delete', [
            'target_id' => (int)$id,
            'target_username' => $target['username'] ?? '',
            'target_role' => $target['role'] ?? '',
        ]);
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/users/:id/reset-password
     * 重置密码
     */
    public function resetPassword($id)
    {
        $user = $this->request->user ?? $this->request->userPayload ?? [];
        $currentUsername = $user['username'] ?? '';
        $current = Db::table('fisher_users')->where('username', $currentUsername)->find();
        $currentRole = $current['role'] ?? 'user';
        $target = Db::table('fisher_users')->where('id', $id)->find();
        if (!$target) {
            return json(['success' => false, 'message' => '用户不存在'], 404);
        }

        $isSuper = in_array($currentRole, ['superadmin', 'super-admin'], true);
        $isDirectChild = $currentRole === 'admin'
            && ($target['parent_username'] ?? '') === $currentUsername
            && !in_array($target['role'] ?? '', ['admin', 'superadmin', 'super-admin'], true);
        if (!$isSuper && !$isDirectChild) {
            return json(['success' => false, 'message' => '没有权限重置此用户密码'], 403);
        }

        $data = Request::post();
        $newPassword = $data['password'] ?? $data['newPassword'] ?? '';
        if (!$newPassword) {
            return json(['success' => false, 'message' => '密码不能为空'], 400);
        }

        Db::table('fisher_users')->where('id', $id)->update([
            'password_hash' => password_hash($newPassword, PASSWORD_BCRYPT),
        ]);

        $this->auditSecurity('user.password_reset', [
            'target_id' => (int)$id,
            'target_username' => $target['username'] ?? '',
        ]);

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/users/:id/toggle
     * 启用/禁用用户
     */
    public function toggleUser($id)
    {
        $user = $this->request->user ?? $this->request->userPayload ?? [];
        $currentUsername = $user['username'] ?? '';
        $current = Db::table('fisher_users')->where('username', $currentUsername)->find();
        $currentRole = $current['role'] ?? 'user';
        $target = Db::table('fisher_users')->where('id', $id)->find();
        if (!$target) {
            return json(['success' => false, 'message' => '用户不存在'], 404);
        }
        $isSuper = in_array($currentRole, ['superadmin', 'super-admin'], true);
        $isDirectChild = $currentRole === 'admin'
            && ($target['parent_username'] ?? '') === $currentUsername
            && !in_array($target['role'] ?? '', ['admin', 'superadmin', 'super-admin'], true);
        if (!$isSuper && !$isDirectChild) {
            return json(['success' => false, 'message' => '没有权限启用或禁用此用户'], 403);
        }
        if ((int)$target['id'] === (int)($current['id'] ?? 0)) {
            return json(['success' => false, 'message' => '当前账号不能禁用自身'], 400);
        }

        $newEnabled = $target['enabled'] ? 0 : 1;
        Db::table('fisher_users')->where('id', $id)->update(['enabled' => $newEnabled]);
        $this->auditSecurity('user.toggle', [
            'target_id' => (int)$id,
            'target_username' => $target['username'] ?? '',
            'enabled' => $newEnabled,
        ]);
        return json(['success' => true, 'data' => ['enabled' => $newEnabled], 'message' => 'success']);
    }
}
