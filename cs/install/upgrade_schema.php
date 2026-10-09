<?php
// CLI: php cs/install/upgrade_schema.php
// 对已有库补齐 install/schema.sql 中反推出的表和字段；不删除已有数据。
declare(strict_types=1);
$root = dirname(__DIR__);
$schemaFile = $root . '/install/schema.sql';
$envFile = $root . '/.env';
function read_env_ini(string $file): array {
    $out = [];
    $section = '';
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        if ($line[0] === '[' && str_ends_with($line, ']')) { $section = trim($line, '[]'); continue; }
        if (strpos($line, '=') !== false) {
            [$k,$v] = array_map('trim', explode('=', $line, 2));
            $out[$section ? "$section.$k" : $k] = trim($v, "\"'");
        }
    }
    return $out;
}
function split_sql(string $sql): array {
    $sql = preg_replace('/^--.*$/m', '', $sql);
    $parts=[]; $buf=''; $in=null; $len=strlen($sql);
    for($i=0;$i<$len;$i++){ $ch=$sql[$i]; if($in){$buf.=$ch; if($ch===$in && ($i===0||$sql[$i-1] !== '\\'))$in=null; continue;} if($ch==="'"||$ch==='"'||$ch==='`'){$in=$ch;$buf.=$ch;continue;} if($ch===';'){ $s=trim($buf); if($s!=='')$parts[]=$s; $buf=''; continue;} $buf.=$ch; }
    $s=trim($buf); if($s!=='')$parts[]=$s; return $parts;
}
function split_defs(string $body): array {
    $out=[]; $buf=''; $depth=0; $in=null; $len=strlen($body);
    for($i=0;$i<$len;$i++){ $ch=$body[$i]; if($in){$buf.=$ch; if($ch===$in && ($i===0||$body[$i-1] !== '\\'))$in=null; continue;} if($ch==="'"||$ch==='"'||$ch==='`'){$in=$ch;$buf.=$ch;continue;} if($ch==='(')$depth++; if($ch===')')$depth--; if($ch===',' && $depth===0){$s=trim($buf); if($s!=='')$out[]=$s; $buf=''; continue;} $buf.=$ch; }
    $s=trim($buf); if($s!=='')$out[]=$s; return $out;
}
$env = read_env_ini($envFile);
$host = $env['DATABASE.HOSTNAME'] ?? '127.0.0.1';
$port = $env['DATABASE.HOSTPORT'] ?? '3306';
$db = $env['DATABASE.DB_NAME'] ?? 'yuankong';
$user = $env['DATABASE.USERNAME'] ?? 'root';
$pass = $env['DATABASE.PASSWORD'] ?? '';
$pdo = new PDO("mysql:host=$host;port=$port;dbname=$db;charset=utf8mb4", $user, $pass, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$sql = file_get_contents($schemaFile);
$created=0; $added=0; $skipped=0;
foreach (split_sql($sql) as $stmt) {
    if (!preg_match('/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?([a-zA-Z0-9_]+)`?\s*\((.*)\)\s*ENGINE/is', $stmt, $m)) {
        if (stripos($stmt, 'SET ') === 0) { $pdo->exec($stmt); }
        continue;
    }
    $table = $m[1];
    $exists = $pdo->query("SHOW TABLES LIKE " . $pdo->quote($table))->fetchColumn();
    if (!$exists) { $pdo->exec($stmt); $created++; continue; }
    $cols = [];
    foreach ($pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_ASSOC) as $r) $cols[$r['Field']] = true;
    foreach (split_defs($m[2]) as $def) {
        $trim = trim($def);
        if (preg_match('/^(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN)\b/i', $trim)) { $skipped++; continue; }
        if (preg_match('/^`?([a-zA-Z0-9_]+)`?\s+(.+)$/s', $trim, $cm)) {
            $col = $cm[1];
            if (isset($cols[$col])) { $skipped++; continue; }
            $pdo->exec("ALTER TABLE `$table` ADD COLUMN $trim");
            $added++;
        }
    }
}
echo "created_tables=$created added_columns=$added skipped_defs=$skipped\n";
