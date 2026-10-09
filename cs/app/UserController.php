<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class UserController extends BaseController
{
    /**
     * GET /api/users/list
     * 用户列表（角色分级）
     */
    public function listUsers()
    {
        $user = $this->request->user ?? $this->request->userPayload ?? [];
        $currentRole = $user['role'] ?? 'user';
        $currentUsername = $user['username'] ?? '';

        // 查数据库确认实际角色
        $dbUser = Db::table('fisher_users')->where('username', $currentUsername)->find();
        $effectiveRole = $dbUser['role'] ?? $currentRole;
        $isSuper = in_array($effectiveRole, ['superadmin', 'super-admin']);

        if ($isSuper) {
            $rows = Db::table('fisher_users')
                ->field('id,username,role,permissions,max_devices,parent_username,enabled,expire_at,created_at')
                ->select()->toArray();
        } elseif ($effectiveRole === 'admin') {
            $rows = Db::table('fisher_users')
                ->field('id,username,role,permissions,max_devices,parent_username,enabled,expire_at,created_at')
                ->where('username', $currentUsername)
                ->whereOr('parent_username', $currentUsername)
                ->select()->toArray();
        } else {
            $rows = Db::table('fisher_users')
                ->field('id,username,role,permissions,max_devices,parent_username,enabled,expire_at,created_at')
                ->where('username', $currentUsername)
                ->select()->toArray();
        }

        // 统计设备数
        $totalDevices = Db::table('fisher_devices')->count();

        $list = [];
        foreach ($rows as $r) {
            $uname = $r['username'];
            $uRole = $r['role'] ?? 'user';
            $r['telegram_chat_id'] = Db::table('fisher_settings')
                ->where('key', 'tg_' . (int)$r['id'] . '_chat_id')
                ->value('value') ?: '';

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
        $user = $this->request->user ?? $this->request->userPayload ?? [];
        $currentRole = $user['role'] ?? 'user';
        $currentUsername = $user['username'] ?? '';

        $data = Request::post();
        $username = $data['username'] ?? '';
        $password = $data['password'] ?? '';
        $newRole = $data['role'] ?? 'user';
        $telegramChatId = trim((string)($data['telegram_chat_id'] ?? $data['telegramChatId'] ?? ''));

        if (!$username || !$password) {
            return json(['success' => false, 'message' => 'Username and password required'], 400);
        }
        if (!preg_match('/^-?\d{5,20}$/', $telegramChatId)) {
            return json(['success' => false, 'message' => '请输入正确的 Telegram Chat ID'], 400);
        }

        // 账号数量限制（最多11个）
        $totalUsers = Db::table('fisher_users')->count();
        if ($totalUsers >= 11) {
            return json(['success' => false, 'message' => '账号数量已达上限（最多11个）'], 400);
        }

        // 权限检查
        if (in_array($newRole, ['superadmin', 'super-admin']) && !in_array($currentRole, ['superadmin', 'super-admin'])) {
            return json(['success' => false, 'message' => '只有超级管理员才能创建管理员账号'], 403);
        }
        if ($newRole === 'admin' && !in_array($currentRole, ['superadmin', 'super-admin'])) {
            return json(['success' => false, 'message' => '只有超级管理员才能创建普通管理员'], 403);
        }

        $exists = Db::table('fisher_users')->where('username', $username)->find();
        if ($exists) {
            return json(['success' => false, 'message' => '用户名已存在'], 400);
        }

        $permissions = isset($data['permissions']) ? (is_string($data['permissions']) ? $data['permissions'] : json_encode($data['permissions'])) : null;
        $expireAt = isset($data['expire_at']) ? (int)$data['expire_at'] : null;

        $newUserId = Db::table('fisher_users')->insertGetId([
            'username'        => $username,
            'password_hash'   => password_hash($password, PASSWORD_BCRYPT),
            'role'            => $newRole,
            'permissions'     => $permissions,
            'parent_username' => $currentUsername,
            'max_devices'     => $data['max_devices'] ?? 100,
            'enabled'         => 1,
            'expire_at'       => $expireAt,
            'created_at'      => time(),
        ]);

        Db::table('fisher_settings')->insert([
            'key' => 'tg_' . (int)$newUserId . '_chat_id',
            'value' => $telegramChatId,
        ]);
        Db::table('fisher_settings')->insert([
            'key' => 'tg_user_' . $username . '_chat_id',
            'value' => $telegramChatId,
        ]);

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/users/:id
     * 更新用户
     */
    public function updateUser($id)
    {
        $user = $this->request->user ?? $this->request->userPayload ?? [];
        $currentRole = $user['role'] ?? 'user';
        $currentUsername = $user['username'] ?? '';

        $target = Db::table('fisher_users')->where('id', $id)->find();
        if (!$target) {
            return json(['success' => false, 'message' => '用户不存在'], 404);
        }

        // 权限校验
        if (!in_array($currentRole, ['superadmin', 'super-admin'])) {
            if ($target['parent_username'] !== $currentUsername && $target['username'] !== $currentUsername) {
                return json(['success' => false, 'message' => '没有权限操作此用户'], 403);
            }
        }

        $data = Request::post();
        $updates = [];
        if (isset($data['enabled'])) $updates['enabled'] = $data['enabled'] ? 1 : 0;
        if (isset($data['role']) && in_array($currentRole, ['superadmin', 'super-admin'])) {
            $updates['role'] = $data['role'];
        }
        if (isset($data['max_devices'])) $updates['max_devices'] = (int)$data['max_devices'];
        if (isset($data['permissions']) && in_array($currentRole, ['superadmin', 'super-admin'])) {
            $updates['permissions'] = is_string($data['permissions']) ? $data['permissions'] : json_encode($data['permissions']);
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
        }

        if ($updates) {
            Db::table('fisher_users')->where('id', $id)->update($updates);
        }

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * DELETE /api/users/:id
     * 删除用户
     */
    public function deleteUser($id)
    {
        $user = $this->request->user ?? $this->request->userPayload ?? [];
        $currentRole = $user['role'] ?? 'user';
        $currentUsername = $user['username'] ?? '';

        $target = Db::table('fisher_users')->where('id', $id)->find();
        if (!$target) {
            return json(['success' => false, 'message' => '用户不存在'], 404);
        }

        if (!in_array($currentRole, ['superadmin', 'super-admin'])) {
            if ($target['parent_username'] !== $currentUsername) {
                return json(['success' => false, 'message' => '没有权限操作此用户'], 403);
            }
        }

        Db::table('fisher_users')->where('id', $id)->delete();
        Db::table('fisher_settings')->where('key', 'like', 'tg_' . (int)$id . '_%')->delete();
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/users/:id/reset-password
     * 重置密码
     */
    public function resetPassword($id)
    {
        $data = Request::post();
        $newPassword = $data['password'] ?? $data['newPassword'] ?? '';
        if (!$newPassword) {
            return json(['success' => false, 'message' => '密码不能为空'], 400);
        }

        Db::table('fisher_users')->where('id', $id)->update([
            'password_hash' => password_hash($newPassword, PASSWORD_BCRYPT),
        ]);

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/users/:id/toggle
     * 启用/禁用用户
     */
    public function toggleUser($id)
    {
        $target = Db::table('fisher_users')->where('id', $id)->find();
        if (!$target) {
            return json(['success' => false, 'message' => '用户不存在'], 404);
        }
        $newEnabled = $target['enabled'] ? 0 : 1;
        Db::table('fisher_users')->where('id', $id)->update(['enabled' => $newEnabled]);
        return json(['success' => true, 'data' => ['enabled' => $newEnabled], 'message' => 'success']);
    }
}
