<?php
// 本地/服务器首次部署安装页。删除 runtime/install.lock 后可重新安装。
declare(strict_types=1);

$root = dirname(__DIR__);
$lockFile = $root . '/runtime/install.lock';
$schemaFile = $root . '/install/schema.sql';
$envFile = $root . '/.env';
@mkdir($root . '/runtime', 0775, true);

function h($v): string { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }
function random_secret(): string { return bin2hex(random_bytes(48)); }
function env_text(array $cfg): string {
    return "APP_DEBUG = false\n\n" .
        "[DATABASE]\n" .
        "TYPE = mysql\n" .
        "HOSTNAME = {$cfg['db_host']}\n" .
        "DB_NAME = {$cfg['db_name']}\n" .
        "DATABASE = {$cfg['db_name']}\n" .
        "DB_USER = {$cfg['db_user']}\n" .
        "USERNAME = {$cfg['db_user']}\n" .
        "DB_PASS = {$cfg['db_pass']}\n" .
        "PASSWORD = {$cfg['db_pass']}\n" .
        "DB_PORT = {$cfg['db_port']}\n" .
        "HOSTPORT = {$cfg['db_port']}\n" .
        "DB_CHARSET = utf8mb4\n" .
        "CHARSET = utf8mb4\n" .
        "DB_PREFIX = fisher_\n" .
        "PREFIX = fisher_\n\n" .
        "[JWT]\n" .
        "JWT_SECRET = {$cfg['jwt_secret']}\n\n" .
        "[LANG]\n" .
        "default_lang = zh-cn\n\n" .
        "[WS_SERVER]\n" .
        "WS_HOST = 127.0.0.1\n" .
        "WS_PORT = 8889\n\n" .
        "[FRPS]\n" .
        "FRPS_ADDR = {$cfg['frps_addr']}\n" .
        "FRPS_PORT = {$cfg['frps_port']}\n" .
        "FRPS_TOKEN = {$cfg['frps_token']}\n" .
        "DEFAULT_REMOTE_PORT = 19901\n" .
        "LOCAL_SERVICE_PORT = 7912\n\n" .
        "[EXTERNAL]\n" .
        "EXTERNAL_HOST = {$cfg['external_host']}\n" .
        "EXTERNAL_PORT = 8889\n" .
        "C2_HOST = {$cfg['site_url']}\n" .
        "DEEPSEEK_API_URL = https://api.deepseek.com/v1\n" .
        "DEEPSEEK_MODEL = deepseek-v4-flash\n" .
        "GOOGLE_TRANSLATE_URL = https://translate.googleapis.com/translate_a/single\n" .
        "IP_API_URL = http://ip-api.com/json\n";
}
function split_sql(string $sql): array {
    $sql = preg_replace('/^--.*$/m', '', $sql);
    $parts = [];
    $buf = '';
    $in = null;
    $len = strlen($sql);
    for ($i = 0; $i < $len; $i++) {
        $ch = $sql[$i];
        if ($in) {
            $buf .= $ch;
            if ($ch === $in && ($i === 0 || $sql[$i - 1] !== '\\')) $in = null;
            continue;
        }
        if ($ch === "'" || $ch === '"' || $ch === '`') { $in = $ch; $buf .= $ch; continue; }
        if ($ch === ';') { $s = trim($buf); if ($s !== '') $parts[] = $s; $buf = ''; continue; }
        $buf .= $ch;
    }
    $s = trim($buf); if ($s !== '') $parts[] = $s;
    return $parts;
}

$checks = [
    ['PHP >= 8.1', version_compare(PHP_VERSION, '8.1.0', '>=')],
    ['PDO 扩展', extension_loaded('pdo')],
    ['pdo_mysql 扩展', extension_loaded('pdo_mysql')],
    ['runtime 可写', is_writable($root . '/runtime')],
    ['.env 可写或可创建', (is_file($envFile) && is_writable($envFile)) || is_writable($root)],
    ['schema.sql 存在', is_file($schemaFile)],
];
$allOk = !in_array(false, array_column($checks, 1), true);
$installed = is_file($lockFile);
$errors = [];
$success = false;

$defaults = [
    'db_host' => $_POST['db_host'] ?? '127.0.0.1',
    'db_port' => $_POST['db_port'] ?? '3306',
    'db_name' => $_POST['db_name'] ?? 'yuankong',
    'db_user' => $_POST['db_user'] ?? 'yuankong',
    'db_pass' => $_POST['db_pass'] ?? 'yuankong',
    'admin_user' => $_POST['admin_user'] ?? 'admin',
    'admin_pass' => $_POST['admin_pass'] ?? '',
    'site_url' => $_POST['site_url'] ?? ((isset($_SERVER['HTTP_HOST']) ? 'http://' . $_SERVER['HTTP_HOST'] : 'http://127.0.0.1:18081')),
    'frps_addr' => $_POST['frps_addr'] ?? '127.0.0.1',
    'frps_port' => $_POST['frps_port'] ?? '7000',
];

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$installed) {
    if (!$allOk) $errors[] = '环境检测未通过，请先修复红色项目。';
    $adminPass = (string)$defaults['admin_pass'];
    if (!preg_match('/^[A-Za-z0-9_.-]{3,64}$/', (string)$defaults['admin_user'])) $errors[] = '管理员账号需为 3-64 位字母/数字/下划线/点/短横线。';
    if (strlen($adminPass) < 6) $errors[] = '管理员密码至少 6 位。';
    if (!preg_match('/^\d+$/', (string)$defaults['db_port'])) $errors[] = '数据库端口必须是数字。';
    if (!$errors) {
        try {
            $dsnServer = "mysql:host={$defaults['db_host']};port={$defaults['db_port']};charset=utf8mb4";
            $pdo = new PDO($dsnServer, (string)$defaults['db_user'], (string)$defaults['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $dbName = preg_replace('/[^A-Za-z0-9_]/', '', (string)$defaults['db_name']);
            if ($dbName === '') throw new RuntimeException('数据库名无效');
            $pdo->exec("CREATE DATABASE IF NOT EXISTS `{$dbName}` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
            $pdo->exec("USE `{$dbName}`");
            foreach (split_sql(file_get_contents($schemaFile)) as $stmt) $pdo->exec($stmt);
            $hash = password_hash($adminPass, PASSWORD_BCRYPT);
            $stmt = $pdo->prepare("INSERT INTO fisher_users (username,password_hash,role,permissions,max_devices,max_sub_users,enabled,created_at) VALUES (:u,:p,'superadmin','[]',100,0,1,UNIX_TIMESTAMP()) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role='superadmin', permissions='[]', enabled=1");
            $stmt->execute([':u' => (string)$defaults['admin_user'], ':p' => $hash]);
            $cfg = $defaults;
            $cfg['db_name'] = $dbName;
            $cfg['jwt_secret'] = random_secret();
            $cfg['frps_token'] = bin2hex(random_bytes(32));
            $cfg['external_host'] = $cfg['frps_addr'];
            file_put_contents($envFile, env_text($cfg));
            file_put_contents($lockFile, json_encode([
                'installed_at' => date('c'),
                'db_name' => $dbName,
                'admin_user' => (string)$defaults['admin_user'],
                'site_url' => (string)$defaults['site_url'],
            ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
            $success = true;
            $installed = true;
        } catch (Throwable $e) {
            $errors[] = $e->getMessage();
        }
    }
}
?><!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>安装向导 · 本地面板</title>
<style>
body{margin:0;background:#07111f;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"Microsoft YaHei",sans-serif}.wrap{max-width:980px;margin:38px auto;padding:0 18px}.card{background:#111827;border:1px solid #273449;border-radius:18px;padding:24px;margin:16px 0;box-shadow:0 12px 40px #0006}h1{margin:0 0 8px;font-size:28px}.muted{color:#94a3b8}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}@media(max-width:760px){.grid{grid-template-columns:1fr}}label{display:block;color:#cbd5e1;font-size:13px}input{width:100%;box-sizing:border-box;margin-top:6px;height:42px;border-radius:10px;border:1px solid #334155;background:#020617;color:#e5e7eb;padding:0 12px}button{height:44px;border:0;border-radius:10px;padding:0 18px;background:#3b82f6;color:white;font-weight:700;cursor:pointer}.ok{color:#22c55e}.bad{color:#ef4444}.alert{padding:12px 14px;border-radius:12px;margin:12px 0}.alert.err{background:#7f1d1d66;border:1px solid #ef444466}.alert.okb{background:#064e3b66;border:1px solid #22c55e66}code{background:#020617;border:1px solid #334155;border-radius:6px;padding:2px 6px}.checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.check{background:#020617;border:1px solid #263244;border-radius:10px;padding:10px}</style></head>
<body><div class="wrap"><h1>安装向导</h1><div class="muted">首次部署时初始化数据库、管理员账号、环境配置，并生成安装锁。</div>
<?php if ($success): ?><div class="alert okb">安装完成。请访问 <a style="color:#93c5fd" href="/">后台首页</a> 登录。</div><?php endif; ?>
<?php foreach ($errors as $e): ?><div class="alert err"><?=h($e)?></div><?php endforeach; ?>
<div class="card"><h2>环境检测</h2><div class="checks"><?php foreach ($checks as [$name,$ok]): ?><div class="check"><span class="<?=$ok?'ok':'bad'?>"><?=$ok?'✓':'✗'?></span> <?=h($name)?></div><?php endforeach; ?></div></div>
<?php if ($installed): ?><div class="card"><h2>已安装</h2><p>检测到锁文件：<code><?=h($lockFile)?></code></p><p class="muted">如需重新部署/重装，请先删除该锁文件，再访问 <code>/install</code>。</p></div>
<?php else: ?><form method="post" class="card"><h2>基础配置</h2><div class="grid">
<label>数据库地址<input name="db_host" value="<?=h($defaults['db_host'])?>"></label><label>数据库端口<input name="db_port" value="<?=h($defaults['db_port'])?>"></label>
<label>数据库名<input name="db_name" value="<?=h($defaults['db_name'])?>"></label><label>数据库用户<input name="db_user" value="<?=h($defaults['db_user'])?>"></label>
<label>数据库密码<input name="db_pass" type="password" value="<?=h($defaults['db_pass'])?>"></label><label>后台访问地址<input name="site_url" value="<?=h($defaults['site_url'])?>"></label>
<label>管理员账号<input name="admin_user" value="<?=h($defaults['admin_user'])?>"></label><label>管理员密码<input name="admin_pass" type="password" placeholder="至少 6 位"></label>
<label>FRPS 地址<input name="frps_addr" value="<?=h($defaults['frps_addr'])?>"></label><label>FRPS 端口<input name="frps_port" value="<?=h($defaults['frps_port'])?>"></label>
</div><p class="muted">安装会执行 <code>cs/install/schema.sql</code>，写入 <code>cs/.env</code>，并创建 <code>cs/runtime/install.lock</code>。</p><button <?=$allOk?'':'disabled'?>>开始安装</button></form><?php endif; ?>
</div></body></html>
