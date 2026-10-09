<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class SettingsController extends BaseController
{
    /**
     * GET /api/settings
     * 获取所有设置
     */
    public function getSettings()
    {
        if (!$this->isSuperAdmin()) {
            return json(['success' => false, 'message' => '需要超级管理员权限'], 403);
        }

        $rows = Db::table('fisher_settings')
            ->whereIn('key', ['bot_token', 'chat_id', 'api_proxy', 'notify_online', 'notify_sms'])
            ->select()->toArray();

        $result = [];
        foreach ($rows as $r) {
            $result[$r['key']] = $r['value'];
        }
        if (!empty($result['bot_token'])) {
            $token = (string)$result['bot_token'];
            $result['bot_token'] = strlen($token) > 10
                ? substr($token, 0, 6) . '...' . substr($token, -4)
                : '********';
        }

        return json(['success' => true, 'data' => $result, 'message' => 'success']);
    }

    /**
     * PUT /api/settings
     * 更新设置
     */
    public function updateSettings()
    {
        if (!$this->isSuperAdmin()) {
            return json(['success' => false, 'message' => '需要超级管理员权限'], 403);
        }

        $data = Request::post();
        $keys = ['bot_token', 'chat_id', 'api_proxy', 'notify_online', 'notify_sms'];

        foreach ($keys as $k) {
            if (isset($data[$k])) {
                $exists = Db::table('fisher_settings')->where('key', $k)->find();
                if ($exists) {
                    Db::table('fisher_settings')->where('key', $k)->update(['value' => (string)$data[$k]]);
                } else {
                    Db::table('fisher_settings')->insert(['key' => $k, 'value' => (string)$data[$k]]);
                }
            }
        }

        return json(['success' => true, 'data' => null, 'message' => '保存成功']);
    }

    /**
     * GET|POST /api/settings/telegram
     * 获取/更新 Telegram 设置 — 按当前登录用户存储
     */
    public function telegram()
    {
        // Auth 中间件已将 JWT payload 注入 request->user
        $user = $this->request->user ?? request()->user ?? [];
        $userId = (int)($user['user_id'] ?? $user['id'] ?? 0);
        $prefix = 'tg_' . $userId . '_';
        $fields = ['bot_token', 'chat_id', 'api_proxy', 'notify_online', 'notify_sms'];

        if (Request::isPost()) {
            $data = Request::post();
            foreach ($fields as $k) {
                if (isset($data[$k])) {
                    $dbKey = $prefix . $k;
                    $exists = Db::table('fisher_settings')->where('key', $dbKey)->find();
                    if ($exists) {
                        Db::table('fisher_settings')->where('key', $dbKey)->update(['value' => (string)$data[$k]]);
                    } else {
                        Db::table('fisher_settings')->insert(['key' => $dbKey, 'value' => (string)$data[$k]]);
                    }
                }
            }
            return json(['success' => true, 'data' => null, 'message' => '保存成功']);
        }

        // GET
        $dbKeys = array_map(fn($k) => $prefix . $k, $fields);
        $rows = Db::table('fisher_settings')
            ->whereIn('key', $dbKeys)
            ->select()->toArray();
        $result = [];
        foreach ($rows as $r) {
            // 去掉前缀返回
            $shortKey = str_replace($prefix, '', $r['key']);
            $result[$shortKey] = $r['value'];
        }
        return json(['success' => true, 'data' => $result, 'message' => 'success']);
    }

    /**
     * POST /api/settings/telegram/test
     * 测试 Telegram 通知
     */
    public function testTelegram()
    {
        $data = Request::post();
        $botToken = $data['bot_token'] ?? '';
        $chatId = $data['chat_id'] ?? '';
        $apiProxy = $data['api_proxy'] ?? '';

        if (!$botToken || !$chatId) {
            return json(['success' => false, 'message' => 'Bot Token 和 Chat ID 不能为空'], 400);
        }

        $url = "https://api.telegram.org/bot{$botToken}/sendMessage";
        $msg = "🧪 <b>测试通知</b>\n\nTelegram 通知配置成功！\n新设备上线时将收到通知。";
        $payload = json_encode(['chat_id' => $chatId, 'text' => $msg, 'parse_mode' => 'HTML']);

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

        // 优先使用请求中传入的代理，否则从数据库读取（按用户）
        if (!$apiProxy) {
            $user = $this->request->user ?? request()->user ?? [];
            $userId = (int)($user['user_id'] ?? $user['id'] ?? 0);
            $apiProxy = Db::table('fisher_settings')->where('key', 'tg_' . $userId . '_api_proxy')->value('value') ?: '';
        }
        if ($apiProxy) {
            // Accept values copied with surrounding whitespace from the settings form.
            curl_setopt($ch, CURLOPT_PROXY, trim($apiProxy));
        }

        $response = curl_exec($ch);
        $err = curl_error($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($err) {
            return json(['success' => false, 'message' => "发送失败: {$err}"], 500);
        }

        // 检查 Telegram API 返回
        $result = json_decode($response, true);
        if ($httpCode !== 200 || (isset($result['ok']) && !$result['ok'])) {
            $desc = $result['description'] ?? '未知错误';
            return json(['success' => false, 'message' => "Telegram API 错误: {$desc}"], 500);
        }

        return json(['success' => true, 'data' => null, 'message' => '测试消息已发送']);
    }
    private function isSuperAdmin(): bool
    {
        $user = $this->request->user ?? $this->request->userPayload ?? [];
        $userId = (int)($user['user_id'] ?? 0);
        if ($userId <= 0) {
            return false;
        }

        $role = Db::table('fisher_users')->where('id', $userId)->value('role');
        return in_array($role, ['superadmin', 'super-admin'], true);
    }
}
