<?php
// 首次部署安装向导。安装成功后会生成 runtime/install.lock；删除该锁后才会显示安装表单。
declare(strict_types=1);

$root = dirname(__DIR__);
$runtimeDir = $root . '/runtime';
$lockFile = $runtimeDir . '/install.lock';
$schemaFile = $root . '/install/schema.sql';
$envFile = $root . '/.env';
$nodeEnvFile = $root . '/node-ws/.env';
@mkdir($runtimeDir, 0775, true);

function h($v): string { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }
function random_secret(int $bytes = 48): string { return bin2hex(random_bytes($bytes)); }
function posted(string $key, string $default = ''): string { return trim((string)($_POST[$key] ?? $default)); }
function bool_text(bool $ok): string { return $ok ? '通过' : '待处理'; }
function detect_site_url(): string {
    $proto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? null;
    if (!$proto) $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '127.0.0.1:18081';
    return $proto . '://' . $host;
}
function write_file_atomic(string $file, string $content): void {
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $tmp = $file . '.tmp.' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp, $content, LOCK_EX) === false) throw new RuntimeException("写入失败：{$file}");
    if (!@rename($tmp, $file)) { @unlink($tmp); throw new RuntimeException("替换失败：{$file}"); }
    @chmod($file, 0664);
}
function split_sql(string $sql): array {
    $sql = preg_replace('/^--.*$/m', '', $sql);
    $parts = []; $buf = ''; $in = null; $len = strlen($sql);
    for ($i = 0; $i < $len; $i++) {
        $ch = $sql[$i];
        if ($in) { $buf .= $ch; if ($ch === $in && ($i === 0 || $sql[$i - 1] !== '\\')) $in = null; continue; }
        if ($ch === "'" || $ch === '"' || $ch === '`') { $in = $ch; $buf .= $ch; continue; }
        if ($ch === ';') { $s = trim($buf); if ($s !== '') $parts[] = $s; $buf = ''; continue; }
        $buf .= $ch;
    }
    $s = trim($buf); if ($s !== '') $parts[] = $s;
    return $parts;
}
function split_defs(string $body): array {
    $out = []; $buf = ''; $depth = 0; $in = null; $len = strlen($body);
    for ($i = 0; $i < $len; $i++) {
        $ch = $body[$i];
        if ($in) { $buf .= $ch; if ($ch === $in && ($i === 0 || $body[$i - 1] !== '\\')) $in = null; continue; }
        if ($ch === "'" || $ch === '"' || $ch === '`') { $in = $ch; $buf .= $ch; continue; }
        if ($ch === '(') $depth++;
        if ($ch === ')') $depth--;
        if ($ch === ',' && $depth === 0) { $s = trim($buf); if ($s !== '') $out[] = $s; $buf = ''; continue; }
        $buf .= $ch;
    }
    $s = trim($buf); if ($s !== '') $out[] = $s;
    return $out;
}
function apply_schema(PDO $pdo, string $schemaFile): array {
    if (!is_file($schemaFile)) throw new RuntimeException('schema.sql 不存在');
    $created = 0; $added = 0; $skipped = 0; $executed = 0;
    foreach (split_sql((string)file_get_contents($schemaFile)) as $stmt) {
        if (!preg_match('/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?([a-zA-Z0-9_]+)`?\s*\((.*)\)\s*ENGINE/is', $stmt, $m)) {
            if (stripos($stmt, 'SET ') === 0) { $pdo->exec($stmt); $executed++; }
            continue;
        }
        $table = $m[1];
        $exists = $pdo->query('SHOW TABLES LIKE ' . $pdo->quote($table))->fetchColumn();
        if (!$exists) { $pdo->exec($stmt); $created++; $executed++; continue; }
        $cols = [];
        foreach ($pdo->query("SHOW COLUMNS FROM `{$table}`")->fetchAll(PDO::FETCH_ASSOC) as $r) $cols[$r['Field']] = true;
        foreach (split_defs($m[2]) as $def) {
            $trim = trim($def);
            if (preg_match('/^(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN)\b/i', $trim)) { $skipped++; continue; }
            if (preg_match('/^`?([a-zA-Z0-9_]+)`?\s+(.+)$/s', $trim, $cm)) {
                $col = $cm[1];
                if (isset($cols[$col])) { $skipped++; continue; }
                $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN {$trim}");
                $added++;
            }
        }
    }
    return ['created_tables' => $created, 'added_columns' => $added, 'skipped_defs' => $skipped, 'executed' => $executed];
}
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
        "WS_PORT = {$cfg['ws_port']}\n\n" .
        "[FRPS]\n" .
        "FRPS_ADDR = {$cfg['frps_addr']}\n" .
        "FRPS_PORT = {$cfg['frps_port']}\n" .
        "FRPS_TOKEN = {$cfg['frps_token']}\n" .
        "DEFAULT_REMOTE_PORT = 19901\n" .
        "LOCAL_SERVICE_PORT = 7912\n" .
        "FRPS_DASHBOARD_USER = {$cfg['frps_dashboard_user']}\n" .
        "FRPS_DASHBOARD_PASSWORD = {$cfg['frps_dashboard_pass']}\n" .
        "FRPS_DASHBOARD_PORT = {$cfg['frps_dashboard_port']}\n\n" .
        "[EXTERNAL]\n" .
        "EXTERNAL_HOST = {$cfg['external_host']}\n" .
        "EXTERNAL_PORT = {$cfg['ws_port']}\n" .
        "C2_HOST = {$cfg['site_url']}\n" .
        "DEEPSEEK_API_URL = https://api.deepseek.com/v1\n" .
        "DEEPSEEK_MODEL = deepseek-v4-flash\n" .
        "GOOGLE_TRANSLATE_URL = https://translate.googleapis.com/translate_a/single\n" .
        "IP_API_URL = http://ip-api.com/json\n";
}
function node_ws_env_text(array $cfg): string {
    return "WS_PORT={$cfg['ws_port']}\n" .
        "JWT_SECRET={$cfg['jwt_secret']}\n" .
        "DB_HOST={$cfg['db_host']}\n" .
        "DB_PORT={$cfg['db_port']}\n" .
        "DB_USER={$cfg['db_user']}\n" .
        "DB_PASS={$cfg['db_pass']}\n" .
        "DB_NAME={$cfg['db_name']}\n" .
        "FRPS_ADDR={$cfg['frps_addr']}\n" .
        "FRPS_PORT={$cfg['frps_port']}\n" .
        "FRPS_TOKEN={$cfg['frps_token']}\n" .
        "FRPS_DASHBOARD_HOST=127.0.0.1\n" .
        "FRPS_DASHBOARD_USER={$cfg['frps_dashboard_user']}\n" .
        "FRPS_DASHBOARD_PASSWORD={$cfg['frps_dashboard_pass']}\n" .
        "FRPS_DASHBOARD_PORT={$cfg['frps_dashboard_port']}\n" .
        "CORS_ORIGINS={$cfg['site_url']}\n";
}
function nginx_rewrite_text(array $cfg): string {
    $wsPort = preg_replace('/[^0-9]/', '', (string)($cfg['ws_port'] ?? '8889')) ?: '8889';
    return "# ykxiongying / 宝塔 Nginx rewrite include\n" .
        "# 复制到：/www/server/panel/vhost/rewrite/<域名>.conf，然后 nginx -t && nginx -s reload\n" .
        "location ^~ /ws {\n" .
        "    proxy_pass http://127.0.0.1:{$wsPort};\n" .
        "    proxy_http_version 1.1;\n" .
        "    proxy_set_header Upgrade \$http_upgrade;\n" .
        "    proxy_set_header Connection \"upgrade\";\n" .
        "    proxy_set_header Host \$host;\n" .
        "    proxy_set_header X-Real-IP \$remote_addr;\n" .
        "    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;\n" .
        "    proxy_set_header X-Forwarded-Proto \$scheme;\n" .
        "    proxy_read_timeout 3600s;\n" .
        "    proxy_send_timeout 3600s;\n" .
        "    proxy_buffering off;\n" .
        "}\n\n" .
        "location ^~ /w {\n" .
        "    proxy_pass http://127.0.0.1:{$wsPort};\n" .
        "    proxy_http_version 1.1;\n" .
        "    proxy_set_header Upgrade \$http_upgrade;\n" .
        "    proxy_set_header Connection \"upgrade\";\n" .
        "    proxy_set_header Host \$host;\n" .
        "    proxy_set_header X-Real-IP \$remote_addr;\n" .
        "    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;\n" .
        "    proxy_set_header X-Forwarded-Proto \$scheme;\n" .
        "    proxy_read_timeout 3600s;\n" .
        "    proxy_send_timeout 3600s;\n" .
        "    proxy_buffering off;\n" .
        "}\n\n" .
        "location ^~ /s/lk {\n" .
        "    proxy_pass http://127.0.0.1:{$wsPort};\n" .
        "    proxy_http_version 1.1;\n" .
        "    proxy_set_header Upgrade \$http_upgrade;\n" .
        "    proxy_set_header Connection \"upgrade\";\n" .
        "    proxy_set_header Host \$host;\n" .
        "    proxy_set_header X-Real-IP \$remote_addr;\n" .
        "    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;\n" .
        "    proxy_set_header X-Forwarded-Proto \$scheme;\n" .
        "    proxy_read_timeout 3600s;\n" .
        "    proxy_send_timeout 3600s;\n" .
        "    proxy_buffering off;\n" .
        "}\n\n" .
        "location = /s/bn/native {\n" .
        "    default_type application/octet-stream;\n" .
        "    return 204;\n" .
        "}\n\n" .
        "location /api/ {\n" .
        "    rewrite ^/(.*)$ /index.php?s=/\$1 last;\n" .
        "}\n\n" .
        "location /m/ {\n" .
        "    rewrite ^/(.*)$ /index.php?s=/\$1 last;\n" .
        "}\n\n" .
        "location /s/ {\n" .
        "    rewrite ^/(.*)$ /index.php?s=/\$1 last;\n" .
        "}\n\n" .
        "location / {\n" .
        "    try_files \$uri \$uri/ /index.html;\n" .
        "}\n";
}

function read_lock(string $lockFile): array {
    if (!is_file($lockFile)) return [];
    $data = json_decode((string)file_get_contents($lockFile), true);
    return is_array($data) ? $data : ['installed_at' => 'unknown'];
}

$checks = [
    ['PHP >= 8.1', version_compare(PHP_VERSION, '8.1.0', '>=')],
    ['PDO 扩展', extension_loaded('pdo')],
    ['pdo_mysql 扩展', extension_loaded('pdo_mysql')],
    ['OpenSSL/随机数支持', function_exists('random_bytes')],
    ['密码哈希支持', function_exists('password_hash')],
    ['runtime 可写', is_dir($runtimeDir) && is_writable($runtimeDir)],
    ['站点目录可写 .env', (is_file($envFile) && is_writable($envFile)) || is_writable($root)],
    ['node-ws 配置可写', !is_dir($root . '/node-ws') || ((is_file($nodeEnvFile) && is_writable($nodeEnvFile)) || is_writable($root . '/node-ws'))],
    ['schema.sql 存在', is_file($schemaFile)],
];
$allOk = !in_array(false, array_column($checks, 1), true);
$installed = is_file($lockFile);
$lockInfo = read_lock($lockFile);
$errors = [];
$success = false;
$schemaStats = null;
$nginxRewriteFile = $runtimeDir . '/nginx-rewrite.conf';

$defaults = [
    'db_host' => posted('db_host', '127.0.0.1'),
    'db_port' => posted('db_port', '3306'),
    'db_name' => posted('db_name', 'yuankong'),
    'db_user' => posted('db_user', 'yuankong'),
    'db_pass' => posted('db_pass', ''),
    'admin_user' => posted('admin_user', 'admin'),
    'admin_pass' => posted('admin_pass', ''),
    'site_url' => posted('site_url', detect_site_url()),
    'ws_port' => posted('ws_port', '8889'),
    'frps_addr' => posted('frps_addr', '127.0.0.1'),
    'frps_port' => posted('frps_port', '7000'),
    'frps_dashboard_port' => posted('frps_dashboard_port', '7500'),
    'frps_dashboard_user' => posted('frps_dashboard_user', 'admin'),
    'frps_dashboard_pass' => posted('frps_dashboard_pass', ''),
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($installed) {
        $errors[] = '检测到安装锁，安装入口已关闭。需要重新安装时请先删除 runtime/install.lock。';
    } else {
        if (!$allOk) $errors[] = '环境检测未全部通过，请先修复红色项目。';
        if (!preg_match('/^[A-Za-z0-9_.-]{3,64}$/', $defaults['admin_user'])) $errors[] = '管理员账号需为 3-64 位字母、数字、下划线、点或短横线。';
        if (strlen($defaults['admin_pass']) < 6) $errors[] = '管理员密码至少 6 位。';
        foreach (['db_port' => '数据库端口', 'ws_port' => 'WS 端口', 'frps_port' => 'FRPS 端口', 'frps_dashboard_port' => 'FRPS 面板端口'] as $key => $label) {
            if (!preg_match('/^\d{1,5}$/', $defaults[$key])) $errors[] = $label . '必须是数字。';
        }
        $dbName = preg_replace('/[^A-Za-z0-9_]/', '', $defaults['db_name']);
        if ($dbName === '') $errors[] = '数据库名无效，只能使用字母、数字、下划线。';
        if (!filter_var($defaults['site_url'], FILTER_VALIDATE_URL)) $errors[] = '后台访问地址格式不正确。';
        if (!$errors) {
            try {
                $dsnServer = "mysql:host={$defaults['db_host']};port={$defaults['db_port']};charset=utf8mb4";
                $pdo = new PDO($dsnServer, $defaults['db_user'], $defaults['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                $pdo->exec("CREATE DATABASE IF NOT EXISTS `{$dbName}` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
                $pdo->exec("USE `{$dbName}`");
                $schemaStats = apply_schema($pdo, $schemaFile);
                $hash = password_hash($defaults['admin_pass'], PASSWORD_BCRYPT);
                $stmt = $pdo->prepare("INSERT INTO fisher_users (username,password_hash,role,permissions,max_devices,max_sub_users,enabled,created_at,updated_at) VALUES (:u,:p,'superadmin','[]',100,0,1,UNIX_TIMESTAMP(),UNIX_TIMESTAMP()) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role='superadmin', permissions='[]', enabled=1, updated_at=UNIX_TIMESTAMP()");
                $stmt->execute([':u' => $defaults['admin_user'], ':p' => $hash]);
                $cfg = $defaults;
                $cfg['db_name'] = $dbName;
                $cfg['jwt_secret'] = random_secret();
                $cfg['frps_token'] = random_secret(32);
                $cfg['external_host'] = $cfg['frps_addr'];
                if ($cfg['frps_dashboard_pass'] === '') $cfg['frps_dashboard_pass'] = random_secret(16);
                write_file_atomic($envFile, env_text($cfg));
                if (is_dir($root . '/node-ws')) write_file_atomic($nodeEnvFile, node_ws_env_text($cfg));
                write_file_atomic($nginxRewriteFile, nginx_rewrite_text($cfg));
                write_file_atomic($lockFile, json_encode([
                    'installed_at' => date('c'),
                    'db_name' => $dbName,
                    'admin_user' => $defaults['admin_user'],
                    'site_url' => $defaults['site_url'],
                    'schema' => $schemaStats,
                    'php_version' => PHP_VERSION,
                    'nginx_rewrite_file' => $nginxRewriteFile,
                ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
                $success = true;
                $installed = true;
                $lockInfo = read_lock($lockFile);
            } catch (Throwable $e) {
                $errors[] = $e->getMessage();
            }
        }
    }
}
?><!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>部署安装向导</title>
<style>
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#13233d 0,#07111f 42%,#030712 100%);color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"Microsoft YaHei",sans-serif}.wrap{max-width:1060px;margin:34px auto;padding:0 18px}.hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-end}.card{background:rgba(17,24,39,.92);border:1px solid #273449;border-radius:18px;padding:24px;margin:16px 0;box-shadow:0 18px 50px #0008}h1{margin:0 0 8px;font-size:30px}h2{margin:0 0 16px;font-size:19px}.muted{color:#94a3b8}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}@media(max-width:760px){.grid{grid-template-columns:1fr}.hero{display:block}}label{display:block;color:#cbd5e1;font-size:13px}input{width:100%;margin-top:6px;height:43px;border-radius:10px;border:1px solid #334155;background:#020617;color:#e5e7eb;padding:0 12px;outline:none}input:focus{border-color:#60a5fa;box-shadow:0 0 0 3px #2563eb33}button{height:44px;border:0;border-radius:10px;padding:0 20px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:white;font-weight:800;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.ok{color:#22c55e}.bad{color:#ef4444}.alert{padding:12px 14px;border-radius:12px;margin:12px 0}.alert.err{background:#7f1d1d66;border:1px solid #ef444466}.alert.okb{background:#064e3b66;border:1px solid #22c55e66}code{background:#020617;border:1px solid #334155;border-radius:6px;padding:2px 6px}.checks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}@media(max-width:900px){.checks{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.checks{grid-template-columns:1fr}}.check{background:#020617;border:1px solid #263244;border-radius:10px;padding:10px}.pill{display:inline-block;border-radius:999px;padding:5px 10px;background:#0f172a;border:1px solid #334155;color:#cbd5e1;font-size:12px}.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:18px}.small{font-size:12px}.snippet{white-space:pre-wrap;overflow:auto;max-height:420px;font-size:12px;line-height:1.45}</style></head>
<body><div class="wrap"><div class="hero"><div><h1>部署安装向导</h1><div class="muted">初始化数据库、管理员账号、站点环境、Node WS 配置，并生成安装锁。</div></div><span class="pill">Lock: <?= $installed ? 'ON' : 'OFF' ?></span></div>
<?php if ($success): ?><div class="alert okb">安装完成，已写入配置、生成 Nginx rewrite 模板并生成锁文件。可以返回 <a style="color:#93c5fd" href="/">后台首页</a> 登录。</div><?php endif; ?>
<?php foreach ($errors as $e): ?><div class="alert err"><?=h($e)?></div><?php endforeach; ?>
<div class="card"><h2>环境检测</h2><div class="checks"><?php foreach ($checks as [$name,$ok]): ?><div class="check"><span class="<?=$ok?'ok':'bad'?>"><?=$ok?'✓':'✗'?></span> <?=h($name)?> <span class="muted small">/ <?=h(bool_text((bool)$ok))?></span></div><?php endforeach; ?></div></div>
<?php if ($installed): ?><div class="card"><h2>已安装</h2><p>检测到锁文件：<code><?=h($lockFile)?></code></p><?php if ($lockInfo): ?><pre class="check" style="white-space:pre-wrap"><?=h(json_encode($lockInfo, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT))?></pre><?php endif; ?><p class="muted">重新部署/重装时，先删除锁文件：<code>rm -f <?=h($lockFile)?></code>，再访问 <code>/install</code>。</p></div>
<div class="card"><h2>Nginx / 宝塔 rewrite 配置</h2><p class="muted">项目已生成模板：<code><?=h($nginxRewriteFile)?></code>。把下面内容复制到宝塔站点的“伪静态/重写规则”或 <code>/www/server/panel/vhost/rewrite/&lt;域名&gt;.conf</code>，然后执行 <code>nginx -t &amp;&amp; nginx -s reload</code>。</p><pre class="check snippet"><?=h(is_file($nginxRewriteFile) ? file_get_contents($nginxRewriteFile) : nginx_rewrite_text($defaults))?></pre></div>
<?php else: ?><form method="post" class="card"><h2>基础配置</h2><div class="grid">
<label>数据库地址<input name="db_host" value="<?=h($defaults['db_host'])?>" autocomplete="off"></label><label>数据库端口<input name="db_port" value="<?=h($defaults['db_port'])?>" inputmode="numeric"></label>
<label>数据库名<input name="db_name" value="<?=h($defaults['db_name'])?>" autocomplete="off"></label><label>数据库用户<input name="db_user" value="<?=h($defaults['db_user'])?>" autocomplete="off"></label>
<label>数据库密码<input name="db_pass" type="password" value="<?=h($defaults['db_pass'])?>" autocomplete="new-password"></label><label>后台访问地址<input name="site_url" value="<?=h($defaults['site_url'])?>" placeholder="https://example.com"></label>
<label>管理员账号<input name="admin_user" value="<?=h($defaults['admin_user'])?>" autocomplete="off"></label><label>管理员密码<input name="admin_pass" type="password" placeholder="至少 6 位" autocomplete="new-password"></label>
<label>Node WS 端口<input name="ws_port" value="<?=h($defaults['ws_port'])?>" inputmode="numeric"></label><label>FRPS 地址<input name="frps_addr" value="<?=h($defaults['frps_addr'])?>"></label>
<label>FRPS 端口<input name="frps_port" value="<?=h($defaults['frps_port'])?>" inputmode="numeric"></label><label>FRPS 面板端口<input name="frps_dashboard_port" value="<?=h($defaults['frps_dashboard_port'])?>" inputmode="numeric"></label>
<label>FRPS 面板用户<input name="frps_dashboard_user" value="<?=h($defaults['frps_dashboard_user'])?>"></label><label>FRPS 面板密码<input name="frps_dashboard_pass" type="password" value="<?=h($defaults['frps_dashboard_pass'])?>" placeholder="留空自动生成"></label>
</div><div class="actions"><button <?=$allOk?'':'disabled'?>>开始安装</button><span class="muted small">会执行/补齐 <code>cs/install/schema.sql</code>，写入 <code>cs/.env</code>、<code>cs/node-ws/.env</code>、<code>cs/runtime/nginx-rewrite.conf</code>，最后创建 <code>cs/runtime/install.lock</code>。</span></div></form><div class="card"><h2>Nginx / 宝塔 rewrite 预览</h2><p class="muted">安装后会按当前 WS 端口生成同款模板，部署时复制到宝塔站点“伪静态/重写规则”。</p><pre class="check snippet"><?=h(nginx_rewrite_text($defaults))?></pre></div><?php endif; ?>
</div></body></html>
