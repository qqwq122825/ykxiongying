<?php
declare(strict_types=1);

/**
 * Telegram Bot long-polling worker.
 *
 * Run this process on the server after configuring Bot Token and proxy in the
 * panel. It replies to /start and /id with the sender's Telegram Chat ID.
 */

const ROOT_PATH = __DIR__ . DIRECTORY_SEPARATOR . '..';
const OFFSET_PREFIX = 'tg_bot_offset_';

function loadEnvironment(): array
{
    $envFile = ROOT_PATH . DIRECTORY_SEPARATOR . '.env';
    $parsed = is_file($envFile) ? parse_ini_file($envFile, true, INI_SCANNER_RAW) : [];
    $database = $parsed['DATABASE'] ?? [];

    return [
        'host' => $database['HOSTNAME'] ?? $database['HOST'] ?? $parsed['DB_HOST'] ?? '127.0.0.1',
        'port' => $database['HOSTPORT'] ?? $database['PORT'] ?? $parsed['DB_PORT'] ?? '3306',
        'name' => $database['DB_NAME'] ?? $parsed['DB_NAME'] ?? '',
        'user' => $database['USERNAME'] ?? $database['USER'] ?? $parsed['DB_USER'] ?? 'root',
        'password' => $database['PASSWORD'] ?? $database['PASS'] ?? $parsed['DB_PASS'] ?? '',
        'charset' => $database['CHARSET'] ?? $parsed['DB_CHARSET'] ?? 'utf8mb4',
    ];
}

function database(): PDO
{
    $db = loadEnvironment();
    $dsn = "mysql:host={$db['host']};port={$db['port']};dbname={$db['name']};charset={$db['charset']}";
    return new PDO($dsn, $db['user'], $db['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function logLine(string $message): void
{
    echo '[' . date('Y-m-d H:i:s') . "] {$message}" . PHP_EOL;
}

function setting(PDO $pdo, string $key, string $default = ''): string
{
    $stmt = $pdo->prepare('SELECT `value` FROM fisher_settings WHERE `key` = ? LIMIT 1');
    $stmt->execute([$key]);
    $value = $stmt->fetchColumn();
    return $value === false ? $default : (string)$value;
}

function saveSetting(PDO $pdo, string $key, string $value): void
{
    $exists = $pdo->prepare('SELECT 1 FROM fisher_settings WHERE `key` = ? LIMIT 1');
    $exists->execute([$key]);
    if ($exists->fetchColumn()) {
        $stmt = $pdo->prepare('UPDATE fisher_settings SET `value` = ? WHERE `key` = ?');
        $stmt->execute([$value, $key]);
        return;
    }
    $stmt = $pdo->prepare('INSERT INTO fisher_settings (`key`, `value`) VALUES (?, ?)');
    $stmt->execute([$key, $value]);
}

function botConfigs(PDO $pdo): array
{
    $rows = $pdo->query("SELECT `key`, `value` FROM fisher_settings WHERE `key` LIKE 'tg_%_bot_token' AND `value` <> ''")->fetchAll();
    $bots = [];
    foreach ($rows as $row) {
        if (!preg_match('/^tg_(\d+)_bot_token$/', (string)$row['key'], $match)) continue;
        $token = trim((string)$row['value']);
        if (!$token || isset($bots[$token])) continue;

        $userId = $match[1];
        $bots[$token] = [
            'token' => $token,
            'proxy' => trim(setting($pdo, "tg_{$userId}_api_proxy")),
        ];
    }
    return array_values($bots);
}

function configureProxy($handle, string $proxy): void
{
    $proxy = trim($proxy);
    if ($proxy === '') return;

    if (str_starts_with($proxy, 'socks5h://')) {
        curl_setopt($handle, CURLOPT_PROXY, substr($proxy, 10));
        curl_setopt($handle, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5_HOSTNAME);
        return;
    }
    if (str_starts_with($proxy, 'socks5://')) {
        curl_setopt($handle, CURLOPT_PROXY, substr($proxy, 9));
        curl_setopt($handle, CURLOPT_PROXYTYPE, CURLPROXY_SOCKS5);
        return;
    }
    curl_setopt($handle, CURLOPT_PROXY, $proxy);
}

function telegramRequest(string $token, string $method, array $payload, string $proxy): array
{
    $url = 'https://api.telegram.org/bot' . $token . '/' . $method;
    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 40,
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
        CURLOPT_NOSIGNAL => true,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    configureProxy($handle, $proxy);
    $body = curl_exec($handle);
    $error = curl_error($handle);
    $status = curl_getinfo($handle, CURLINFO_HTTP_CODE);
    curl_close($handle);

    if ($error !== '') return [false, [], $error];
    $result = json_decode((string)$body, true);
    if ($status !== 200 || empty($result['ok'])) return [false, [], (string)($result['description'] ?? 'Telegram API request failed')];
    return [true, $result['result'] ?? [], ''];
}

function replyChatId(string $token, string $proxy, array $message): bool
{
    $chatId = (string)($message['chat']['id'] ?? '');
    if ($chatId === '') return false;
    $name = trim((string)($message['from']['first_name'] ?? $message['from']['username'] ?? ''));
    $hello = $name ? '你好，' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '！' : '你好！';
    $text = $hello . "\n\n<b>你的 Telegram Chat ID</b>\n<code>{$chatId}</code>\n\n请将此 ID 提交给管理员绑定账号。";
    [$ok, , $error] = telegramRequest($token, 'sendMessage', [
        'chat_id' => $chatId,
        'text' => $text,
        'parse_mode' => 'HTML',
    ], $proxy);
    if (!$ok) logLine("Reply failed for Chat ID {$chatId}: {$error}");
    if ($ok) logLine("Replied Chat ID {$chatId}");
    return $ok;
}

$lockFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cs_telegram_bot_worker.lock';
$lockHandle = fopen($lockFile, 'c+');
if (!$lockHandle || !flock($lockHandle, LOCK_EX | LOCK_NB)) {
    fwrite(STDERR, "Telegram bot worker is already running." . PHP_EOL);
    exit(1);
}

logLine('Telegram bot worker started.');
while (true) {
    try {
        $pdo = database();
        $bots = botConfigs($pdo);
        if (!$bots) {
            logLine('No Telegram Bot Token found. Waiting for configuration.');
            sleep(20);
            continue;
        }

        foreach ($bots as $bot) {
            $offsetKey = OFFSET_PREFIX . substr(hash('sha256', $bot['token']), 0, 16);
            $offset = (int)setting($pdo, $offsetKey, '0');
            [$ok, $updates, $error] = telegramRequest($bot['token'], 'getUpdates', [
                'offset' => $offset,
                'timeout' => 25,
                'allowed_updates' => ['message'],
            ], $bot['proxy']);
            if (!$ok) {
                logLine("getUpdates failed: {$error}");
                continue;
            }

            foreach ($updates as $update) {
                $nextOffset = (int)($update['update_id'] ?? -1) + 1;
                $message = $update['message'] ?? [];
                $text = trim((string)($message['text'] ?? ''));
                if (preg_match('/^\/(start|id)(?:@\w+)?(?:\s.*)?$/i', $text)) {
                    replyChatId($bot['token'], $bot['proxy'], $message);
                }
                if ($nextOffset > 0) saveSetting($pdo, $offsetKey, (string)$nextOffset);
            }
        }
    } catch (Throwable $e) {
        logLine('Worker error: ' . $e->getMessage());
        sleep(5);
    }
}
