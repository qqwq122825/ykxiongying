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
        $verifiedKey = $prefix . 'verified';

        if (Request::isPost()) {
            $data = Request::post();
            $telegramChanged = false;
            foreach ($fields as $k) {
                if (isset($data[$k])) {
                    $dbKey = $prefix . $k;
                    $exists = Db::table('fisher_settings')->where('key', $dbKey)->find();
                    if ($exists) {
                        Db::table('fisher_settings')->where('key', $dbKey)->update(['value' => (string)$data[$k]]);
                    } else {
                        Db::table('fisher_settings')->insert(['key' => $dbKey, 'value' => (string)$data[$k]]);
                    }
                    if (in_array($k, ['bot_token', 'chat_id', 'api_proxy'], true)) {
                        $telegramChanged = true;
                    }
                }
            }
            if ($telegramChanged) {
                $this->upsertSetting($verifiedKey, '0');
            }
            return json(['success' => true, 'data' => null, 'message' => '保存成功，请发送测试成功后再启用登录验证码']);
        }

        // GET
        $dbKeys = array_merge(array_map(fn($k) => $prefix . $k, $fields), [$verifiedKey]);
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

        $user = $this->request->user ?? request()->user ?? [];
        $userId = (int)($user['user_id'] ?? $user['id'] ?? 0);
        $this->upsertSetting('tg_' . $userId . '_verified', '1');
        $this->upsertSetting('tg_' . $userId . '_verified_at', (string)time());
        $webhook = $this->setTelegramWebhook($botToken, $userId);

        return json([
            'success' => true,
            'data' => ['webhook' => $webhook],
            'message' => $webhook['ok'] ? '测试消息已发送，登录验证码和自动回复已启用' : '测试消息已发送，登录验证码已启用；自动回复 Webhook 设置失败',
        ]);
    }

    /**
     * Telegram Webhook：用户给机器人发送任意消息，机器人自动返回 from.id 与 chat.id。
     * 支持 /id、/start、/查询自己的id，也支持普通消息触发，方便管理员复制绑定。
     */
    public function telegramWebhook()
    {
        $secret = trim((string)Request::get('secret', ''));
        $botToken = $this->findBotTokenByWebhookSecret($secret);
        if ($botToken === '') {
            return json(['success' => false, 'message' => 'invalid webhook secret']);
        }

        $update = json_decode((string)file_get_contents('php://input'), true);
        if (!is_array($update)) {
            return json(['success' => true, 'message' => 'ignored']);
        }

        $message = $update['message'] ?? $update['edited_message'] ?? null;
        if (!is_array($message)) {
            return json(['success' => true, 'message' => 'ignored']);
        }

        $chat = $message['chat'] ?? [];
        $from = $message['from'] ?? [];
        $chatId = (string)($chat['id'] ?? '');
        if ($chatId === '') {
            return json(['success' => true, 'message' => 'ignored']);
        }

        $fromId = (string)($from['id'] ?? '');
        $username = trim((string)($from['username'] ?? ''));
        $chatType = (string)($chat['type'] ?? 'private');
        $chatTitle = trim((string)($chat['title'] ?? (($chat['first_name'] ?? '') . ' ' . ($chat['last_name'] ?? ''))));

        $lines = [
            '🔎 <b>Telegram ID 查询结果</b>',
            '',
            'User ID: <code>' . htmlspecialchars($fromId, ENT_QUOTES, 'UTF-8') . '</code>',
            'Chat ID: <code>' . htmlspecialchars($chatId, ENT_QUOTES, 'UTF-8') . '</code>',
            'Chat Type: <code>' . htmlspecialchars($chatType, ENT_QUOTES, 'UTF-8') . '</code>',
        ];
        if ($username !== '') {
            $lines[] = 'Username: @' . htmlspecialchars($username, ENT_QUOTES, 'UTF-8');
        }
        if ($chatTitle !== '') {
            $lines[] = 'Chat Name: ' . htmlspecialchars($chatTitle, ENT_QUOTES, 'UTF-8');
        }
        $lines[] = '';
        $lines[] = $chatType === 'private'
            ? '后台个人通知请填写上面的 Chat ID。'
            : '群通知请填写上面的 Chat ID，群 ID 一般是 -100 开头。';

        $this->sendTelegramMessage($botToken, $chatId, implode("\n", $lines));
        return json(['success' => true, 'message' => 'ok']);
    }

    private function upsertSetting(string $key, string $value): void
    {
        $exists = Db::table('fisher_settings')->where('key', $key)->find();
        if ($exists) {
            Db::table('fisher_settings')->where('key', $key)->update(['value' => $value]);
        } else {
            Db::table('fisher_settings')->insert(['key' => $key, 'value' => $value]);
        }
    }

    private function sendTelegramMessage(string $botToken, string $chatId, string $message): array
    {
        $url = "https://api.telegram.org/bot{$botToken}/sendMessage";
        $payload = json_encode(['chat_id' => $chatId, 'text' => $message, 'parse_mode' => 'HTML'], JSON_UNESCAPED_UNICODE);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_IPRESOLVE      => CURL_IPRESOLVE_V4,
            CURLOPT_NOSIGNAL       => true,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        $response = curl_exec($ch);
        $err = curl_error($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $result = json_decode((string)$response, true);
        return ['ok' => !$err && $httpCode === 200 && !empty($result['ok']), 'error' => $err ?: ($result['description'] ?? '')];
    }

    private function setTelegramWebhook(string $botToken, int $userId): array
    {
        $secret = hash('sha256', $botToken);
        $domain = rtrim((string)Request::domain(), '/');
        if (strpos($domain, 'http://') === 0) {
            $domain = 'https://' . substr($domain, 7);
        }
        $webhookUrl = $domain . '/api/telegram/webhook?secret=' . $secret;

        $apiUrl = "https://api.telegram.org/bot{$botToken}/setWebhook";
        $payload = json_encode([
            'url' => $webhookUrl,
            'allowed_updates' => ['message', 'edited_message'],
            'drop_pending_updates' => false,
        ], JSON_UNESCAPED_UNICODE);
        $ch = curl_init($apiUrl);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_IPRESOLVE      => CURL_IPRESOLVE_V4,
            CURLOPT_NOSIGNAL       => true,
            CURLOPT_SSL_VERIFYPEER => false,
        ]);
        $response = curl_exec($ch);
        $err = curl_error($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $result = json_decode((string)$response, true);
        $ok = !$err && $httpCode === 200 && !empty($result['ok']);
        $this->upsertSetting('tg_' . $userId . '_webhook_secret', $secret);
        $this->upsertSetting('tg_' . $userId . '_webhook_url', $webhookUrl);
        $this->upsertSetting('tg_' . $userId . '_webhook_ok', $ok ? '1' : '0');
        return ['ok' => $ok, 'url' => $webhookUrl, 'error' => $err ?: ($result['description'] ?? '')];
    }

    private function findBotTokenByWebhookSecret(string $secret): string
    {
        if ($secret === '' || !preg_match('/^[a-f0-9]{64}$/', $secret)) {
            return '';
        }
        $rows = Db::table('fisher_settings')
            ->where('key', 'like', 'tg\_%\_bot_token')
            ->whereOr('key', 'bot_token')
            ->select()->toArray();
        foreach ($rows as $row) {
            $token = trim((string)($row['value'] ?? ''));
            if ($token !== '' && hash_equals(hash('sha256', $token), $secret)) {
                return $token;
            }
        }
        return '';
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
