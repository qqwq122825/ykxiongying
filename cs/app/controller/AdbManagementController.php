<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class AdbManagementController extends BaseController
{
    private const RECOVERY_PORT_OFFSET = 30000;

    public function apps()
    {
        $deviceId = trim((string)Request::get('deviceId', ''));
        if ($deviceId === '') {
            return json(['success' => false, 'message' => 'deviceId required'], 400);
        }

        $command = <<<'SH'
printf '__INSTALLED__\n'
pm list packages -f -U 2>/dev/null
printf '__ALL__\n'
pm list packages -f -U -u 2>/dev/null
printf '__SYSTEM__\n'
pm list packages -s -u 2>/dev/null
printf '__USER__\n'
pm list packages -3 -u 2>/dev/null
printf '__DISABLED__\n'
pm list packages -d -u 2>/dev/null
printf '__RUNNING__\n'
ps -A -o NAME= 2>/dev/null || ps -A 2>/dev/null
SH;

        $result = $this->executeShell($deviceId, $command, 35);
        if (!$result['success']) {
            return json(['success' => false, 'message' => $result['error'], 'route' => $result['route']], 502);
        }

        $apps = $this->mergeCachedAppMetadata(
            $this->parseApps($result['output']),
            $this->loadCachedAppMetadata($deviceId)
        );
        $filter = strtolower((string)Request::get('filter', 'all'));
        $search = strtolower(trim((string)Request::get('search', '')));
        $apps = array_values(array_filter($apps, function ($app) use ($filter, $search) {
            if ($filter === 'system' && !$app['system']) return false;
            if ($filter === 'user' && $app['system']) return false;
            if ($filter === 'disabled' && $app['enabled']) return false;
            if ($filter === 'running' && !$app['running']) return false;
            if ($filter === 'removed' && $app['installed']) return false;
            $searchText = strtolower(implode(' ', [
                (string)($app['appName'] ?? ''),
                (string)($app['packageName'] ?? ''),
                (string)($app['versionName'] ?? ''),
            ]));
            if ($search !== '' && strpos($searchText, $search) === false) return false;
            return true;
        }));

        usort($apps, function ($a, $b) {
            if ($a['system'] !== $b['system']) return $a['system'] ? 1 : -1;
            $nameCompare = strcasecmp((string)($a['appName'] ?? ''), (string)($b['appName'] ?? ''));
            return $nameCompare !== 0 ? $nameCompare : strcmp($a['packageName'], $b['packageName']);
        });

        return json([
            'success' => true,
            'data' => ['apps' => $apps, 'total' => count($apps), 'route' => $result['route']],
        ]);
    }

    public function appDetail()
    {
        $deviceId = trim((string)Request::get('deviceId', ''));
        $packageName = trim((string)Request::get('packageName', ''));
        if ($deviceId === '' || !$this->validPackage($packageName)) {
            return json(['success' => false, 'message' => 'valid deviceId and packageName required'], 400);
        }

        $pkg = $this->shellQuote($packageName);
        $command = "printf '__DUMP__\\n'; dumpsys package {$pkg} 2>/dev/null; "
            . "printf '__PATH__\\n'; pm path {$pkg} 2>/dev/null; "
            . "printf '__PACKAGE_ROW__\\n'; pm list packages -f -U -u 2>/dev/null | grep -E '={$packageName}( |$)' | head -n 1; "
            . "printf '__INSTALLED__\\n'; pm list packages --user 0 2>/dev/null | grep -Fx 'package:{$packageName}' || true; "
            . "printf '__DISABLED__\\n'; pm list packages -d -u 2>/dev/null | grep -Fx 'package:{$packageName}' || true; "
            . "printf '__APK_SIZE__\\n'; pm path {$pkg} 2>/dev/null | sed 's/^package://' | while IFS= read -r f; do stat -c %s \"\$f\" 2>/dev/null || toybox stat -c %s \"\$f\" 2>/dev/null; done | awk '{s+=\$1} END {if (s>0) print s}'; "
            . "printf '__LAUNCHER__\\n'; "
            . "cmd package resolve-activity --brief --user 0 -a android.intent.action.MAIN -c android.intent.category.LAUNCHER {$pkg} 2>/dev/null | tail -n 1; "
            . "printf '__PID__\\n'; pidof {$pkg} 2>/dev/null";

        $result = $this->executeShell($deviceId, $command, 30);
        if (!$result['success']) {
            return json(['success' => false, 'message' => $result['error'], 'route' => $result['route']], 502);
        }

        $cache = $this->loadCachedAppMetadata($deviceId);
        $detail = $this->mergeCachedAppDetail(
            $this->parseAppDetail($packageName, $result['output']),
            $cache[$packageName] ?? null
        );

        return json([
            'success' => true,
            'data' => $detail + ['route' => $result['route']],
        ]);
    }

    public function appAction()
    {
        $deviceId = trim((string)Request::post('deviceId', ''));
        $packageName = trim((string)Request::post('packageName', ''));
        $action = trim((string)Request::post('action', ''));
        if ($deviceId === '' || !$this->validPackage($packageName)) {
            return json(['success' => false, 'message' => 'valid deviceId and packageName required'], 400);
        }

        $pkg = $this->shellQuote($packageName);
        switch ($action) {
            case 'launch':
                $command = "component=\$(cmd package resolve-activity --brief --user 0 -a android.intent.action.MAIN -c android.intent.category.LAUNCHER {$pkg} 2>/dev/null | tail -n 1); "
                    . "case \"\$component\" in */*) am start --user 0 -n \"\$component\" ;; *) monkey -p {$pkg} -c android.intent.category.LAUNCHER 1 ;; esac";
                break;
            case 'forceStop':
                $command = "am force-stop --user 0 {$pkg}";
                break;
            case 'enable':
                $command = "pm enable --user 0 {$pkg}";
                break;
            case 'disable':
                $command = "pm disable-user --user 0 {$pkg}";
                break;
            case 'clearData':
                $command = "pm clear --user 0 {$pkg}";
                break;
            case 'uninstall':
                $command = "pm uninstall --user 0 {$pkg}";
                break;
            case 'restore':
                $command = "cmd package install-existing --user 0 {$pkg}";
                break;
            case 'grantPermission':
            case 'revokePermission':
                $permission = trim((string)Request::post('permission', ''));
                if (!preg_match('/^[A-Za-z0-9_.]+$/', $permission)) {
                    return json(['success' => false, 'message' => 'valid permission required'], 400);
                }
                $verb = $action === 'grantPermission' ? 'grant' : 'revoke';
                $command = "pm {$verb} --user 0 {$pkg} " . $this->shellQuote($permission);
                break;
            default:
                return json(['success' => false, 'message' => 'unsupported action'], 400);
        }

        $result = $this->executeChecked($deviceId, $command, 45);
        $state = $this->queryAppState($deviceId, $packageName);
        $verified = $this->appActionMatchesState($action, $state);
        if ($result['success'] && $verified === false) {
            $result['success'] = false;
            $result['error'] = '命令已返回成功，但设备状态复查未达到预期';
        }
        return json([
            'success' => $result['success'],
            'message' => $result['success'] ? '操作已执行并完成状态复查' : ($result['error'] ?: '操作失败'),
            'data' => [
                'action' => $action,
                'packageName' => $packageName,
                'output' => trim($result['output']),
                'exitCode' => $result['exitCode'],
                'route' => $result['route'],
                'state' => $state,
            ],
        ], $result['success'] ? 200 : 422);
    }

    public function installApk()
    {
        $deviceId = trim((string)Request::post('deviceId', ''));
        $file = Request::file('file');
        if ($deviceId === '' || !$file) {
            return json(['success' => false, 'message' => 'deviceId and APK file required'], 400);
        }

        $size = (int)$file->getSize();
        $extension = strtolower((string)$file->extension());
        $localPath = $file->getRealPath() ?: $file->getPathname();
        if ($extension !== 'apk' || $size <= 0 || $size > 256 * 1024 * 1024 || !$localPath || !is_file($localPath)) {
            return json(['success' => false, 'message' => 'APK文件无效或超过256MB'], 400);
        }

        $remotePath = '/data/local/tmp/adb-app-install-' . bin2hex(random_bytes(6)) . '.apk';
        try {
            $route = $this->uploadFile($deviceId, $localPath, $remotePath);
            $flags = Request::post('allowDowngrade', false) ? '-r -d' : '-r';
            $result = $this->executeChecked($deviceId, "pm install {$flags} " . $this->shellQuote($remotePath), 180);
            $this->executeShell($deviceId, 'rm -f ' . $this->shellQuote($remotePath), 15);
            return json([
                'success' => $result['success'],
                'message' => $result['success'] ? 'APK安装完成' : ($result['error'] ?: 'APK安装失败'),
                'data' => [
                    'output' => trim($result['output']),
                    'exitCode' => $result['exitCode'],
                    'uploadRoute' => $route,
                    'executeRoute' => $result['route'],
                ],
            ], $result['success'] ? 200 : 422);
        } catch (\Throwable $e) {
            $this->executeShell($deviceId, 'rm -f ' . $this->shellQuote($remotePath), 15);
            return json(['success' => false, 'message' => $e->getMessage()], 502);
        }
    }

    public function devicePolicyStatus()
    {
        $deviceId = trim((string)Request::get('deviceId', ''));
        if ($deviceId === '') {
            return json(['success' => false, 'message' => 'deviceId required'], 400);
        }
        $status = $this->loadDevicePolicyStatus($deviceId);
        return json($status, $status['success'] ? 200 : 502);
    }

    public function devicePolicyAction()
    {
        $deviceId = trim((string)Request::post('deviceId', ''));
        $action = trim((string)Request::post('action', ''));
        if ($deviceId === '') {
            return json(['success' => false, 'message' => 'deviceId required'], 400);
        }

        $before = $this->loadDevicePolicyStatus($deviceId);
        if (!$before['success']) return json($before, 502);
        $data = $before['data'];
        $component = trim((string)Request::post('component', ''));
        if ($component === '') {
            if ($action === 'removeAdmin') $component = $data['activeAdmins'][0] ?? '';
            elseif ($action === 'clearDeviceOwner') $component = $data['deviceOwners'][0] ?? '';
            else $component = $data['adminReceivers'][0] ?? '';
        }
        if (!$this->validComponent($component)) {
            return json(['success' => false, 'message' => '当前设备未发现可用的DeviceAdminReceiver组件'], 400);
        }

        $quoted = $this->shellQuote($component);
        switch ($action) {
            case 'activateAdmin':
                $command = "dpm set-active-admin --user 0 {$quoted}";
                break;
            case 'removeAdmin':
                $command = "dpm remove-active-admin --user 0 {$quoted}";
                break;
            case 'setDeviceOwner':
                $command = "dpm set-device-owner --user 0 {$quoted}";
                break;
            case 'clearDeviceOwner':
                $command = "dpm remove-active-admin --user 0 {$quoted}";
                break;
            default:
                return json(['success' => false, 'message' => 'unsupported action'], 400);
        }

        $result = $this->executeChecked($deviceId, $command, 45);
        $after = $this->loadDevicePolicyStatus($deviceId);
        $verified = $after['success'] ? $this->devicePolicyActionMatchesState($action, $component, $after['data']) : null;
        if ($result['success'] && $verified === false) {
            $result['success'] = false;
            $result['error'] = '命令已返回成功，但设备策略状态复查未达到预期';
        }
        return json([
            'success' => $result['success'],
            'message' => $result['success'] ? '设备策略操作已执行并复查' : ($result['error'] ?: '设备策略操作失败'),
            'data' => [
                'action' => $action,
                'component' => $component,
                'output' => trim($result['output']),
                'exitCode' => $result['exitCode'],
                'route' => $result['route'],
                'status' => $after['data'] ?? null,
            ],
        ], $result['success'] ? 200 : 422);
    }

    private function loadDevicePolicyStatus($deviceId)
    {
        $command = <<<'SH'
printf '__OWNERS__\n'
dpm list-owners 2>&1 || true
printf '__ADMINS__\n'
dumpsys device_policy 2>/dev/null || true
printf '__RECEIVERS__\n'
cmd package query-receivers --brief --components --user 0 -a android.app.action.DEVICE_ADMIN_ENABLED 2>/dev/null || pm query-receivers --brief -a android.app.action.DEVICE_ADMIN_ENABLED 2>/dev/null || true
printf '__PROVISIONED__\n'
settings get global device_provisioned 2>/dev/null
printf '__SETUP__\n'
settings get secure user_setup_complete 2>/dev/null
printf '__ACCOUNTS__\n'
cmd account list 2>/dev/null || dumpsys account 2>/dev/null || true
SH;
        $result = $this->executeShell($deviceId, $command, 35);
        if (!$result['success']) {
            return ['success' => false, 'message' => $result['error'], 'route' => $result['route']];
        }

        $ownersRaw = $this->section($result['output'], 'OWNERS');
        $adminsRaw = $this->section($result['output'], 'ADMINS');
        $receiversRaw = $this->section($result['output'], 'RECEIVERS');
        $accountsRaw = $this->section($result['output'], 'ACCOUNTS');
        $owners = $this->extractComponents($ownersRaw);
        $admins = $this->extractActiveAdmins($adminsRaw);
        $receivers = array_values(array_unique(array_merge($this->extractComponents($receiversRaw), $admins, $owners)));
        $accounts = [];
        if (preg_match_all('/Account\s*\{name=([^,}]+),\s*type=([^}]+)\}/', $accountsRaw, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) $accounts[] = ['name' => trim($match[1]), 'type' => trim($match[2])];
        }
        $accountCount = count($accounts);
        if (preg_match_all('/^\s*Accounts:\s*(\d+)\s*$/mi', $accountsRaw, $matches)) {
            $accountCount = max($accountCount, array_sum(array_map('intval', $matches[1])));
        }
        $provisioned = trim($this->section($result['output'], 'PROVISIONED')) === '1';
        $setupComplete = trim($this->section($result['output'], 'SETUP')) === '1';

        return [
            'success' => true,
            'data' => [
                'route' => $result['route'],
                'activeAdmins' => $admins,
                'deviceOwners' => $owners,
                'adminReceivers' => $receivers,
                'deviceProvisioned' => $provisioned,
                'userSetupComplete' => $setupComplete,
                'accounts' => $accounts,
                'accountCount' => $accountCount,
                'capabilities' => [
                    'activateAdmin' => count($receivers) > 0,
                    'removeAdmin' => count($admins) > 0,
                    'setDeviceOwner' => count($receivers) > 0 && count($owners) === 0 && !$provisioned && !$setupComplete && $accountCount === 0,
                    'clearDeviceOwner' => count($owners) > 0,
                ],
                'raw' => ['owners' => trim($ownersRaw), 'admins' => trim($adminsRaw), 'receivers' => trim($receiversRaw), 'accounts' => trim($accountsRaw)],
            ],
        ];
    }

    private function parseApps($output)
    {
        $installed = $this->parsePackageSection($this->section($output, 'INSTALLED'));
        $all = $this->parsePackageSection($this->section($output, 'ALL'));
        if (!$all) $all = $installed;
        $system = array_fill_keys(array_keys($this->parsePackageSection($this->section($output, 'SYSTEM'))), true);
        $user = array_fill_keys(array_keys($this->parsePackageSection($this->section($output, 'USER'))), true);
        $disabled = array_fill_keys(array_keys($this->parsePackageSection($this->section($output, 'DISABLED'))), true);
        $installedSet = array_fill_keys(array_keys($installed), true);
        $processes = array_filter(array_map('trim', preg_split('/\r?\n/', $this->section($output, 'RUNNING'))));

        $apps = [];
        foreach ($all as $packageName => $meta) {
            $running = false;
            foreach ($processes as $process) {
                if ($process === $packageName || strpos($process, $packageName . ':') === 0) {
                    $running = true;
                    break;
                }
            }
            $path = $meta['path'];
            $isSystem = isset($system[$packageName]) || (!isset($user[$packageName]) && preg_match('#^/(system|product|vendor|odm|apex|system_ext)/#', $path));
            $apps[] = [
                'appName' => $packageName,
                'packageName' => $packageName,
                'icon' => '',
                'versionName' => '',
                'versionCode' => null,
                'path' => $path,
                'uid' => $meta['uid'],
                'system' => (bool)$isSystem,
                'installed' => isset($installedSet[$packageName]),
                'enabled' => !isset($disabled[$packageName]),
                'running' => $running,
            ];
        }
        return $apps;
    }

    private function parsePackageSection($text)
    {
        $packages = [];
        foreach (preg_split('/\r?\n/', $text) as $line) {
            $line = trim($line);
            if (preg_match('/^package:(.+)=([A-Za-z0-9_][A-Za-z0-9._]*)(?:\s+uid:(\d+))?$/', $line, $match)) {
                $packages[$match[2]] = ['path' => $match[1], 'uid' => isset($match[3]) ? (int)$match[3] : null];
            } elseif (preg_match('/^package:([A-Za-z0-9_][A-Za-z0-9._]*)$/', $line, $match)) {
                $packages[$match[1]] = ['path' => '', 'uid' => null];
            }
        }
        return $packages;
    }

    private function parseAppDetail($packageName, $output)
    {
        $dump = $this->section($output, 'DUMP');
        $pathRaw = $this->section($output, 'PATH');
        $packageRowRaw = $this->section($output, 'PACKAGE_ROW');
        $installedRaw = trim($this->section($output, 'INSTALLED'));
        $disabledRaw = trim($this->section($output, 'DISABLED'));
        $apkSizeRaw = trim($this->section($output, 'APK_SIZE'));
        $launcherRaw = trim($this->section($output, 'LAUNCHER'));
        $pidRaw = trim($this->section($output, 'PID'));
        preg_match('/\bversionName=([^\s]+)/', $dump, $versionName);
        preg_match('/\bversionCode=(\d+)/', $dump, $versionCode);
        preg_match('/\btargetSdk=(\d+)/', $dump, $targetSdk);
        preg_match('/\bminSdk=(\d+)/', $dump, $minSdk);
        preg_match('/\bfirstInstallTime=([^\r\n]+)/', $dump, $firstInstallTime);
        preg_match('/\blastUpdateTime=([^\r\n]+)/', $dump, $lastUpdateTime);
        preg_match('/\b(?:userId|appId)=(\d+)/', $dump, $userId);
        preg_match('/\bdataDir=([^\s]+)/', $dump, $dataDir);
        preg_match('/\bcodePath=([^\s]+)/', $dump, $codePath);
        preg_match('/package:([^\r\n]+)/', $pathRaw, $apkPath);
        $packageRow = $this->parsePackageSection($packageRowRaw);
        $rowMeta = $packageRow[$packageName] ?? null;
        if (empty($apkPath[1]) && !empty($rowMeta['path'])) $apkPath[1] = $rowMeta['path'];
        if (empty($userId[1]) && isset($rowMeta['uid'])) $userId[1] = $rowMeta['uid'];
        $permissions = [];
        if (preg_match('/requested permissions:\s*\r?\n((?:\s+[A-Za-z0-9_.]+\s*\r?\n)+)/', $dump, $permissionBlock)) {
            foreach (preg_split('/\r?\n/', $permissionBlock[1]) as $permission) {
                $permission = trim($permission);
                if ($permission !== '') $permissions[] = $permission;
            }
        }
        $launcher = preg_match('/^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/', $launcherRaw) ? $launcherRaw : '';
        return [
            'appName' => $packageName,
            'icon' => '',
            'packageName' => $packageName,
            'versionName' => trim($versionName[1] ?? ''),
            'versionCode' => isset($versionCode[1]) ? (int)$versionCode[1] : null,
            'targetSdk' => isset($targetSdk[1]) ? (int)$targetSdk[1] : null,
            'minSdk' => isset($minSdk[1]) ? (int)$minSdk[1] : null,
            'firstInstallTime' => trim($firstInstallTime[1] ?? ''),
            'lastUpdateTime' => trim($lastUpdateTime[1] ?? ''),
            'uid' => isset($userId[1]) ? (int)$userId[1] : null,
            'dataDir' => $dataDir[1] ?? '',
            'apkPath' => trim($apkPath[1] ?? ''),
            'codePath' => trim($codePath[1] ?? ''),
            'apkSize' => ctype_digit($apkSizeRaw) ? (int)$apkSizeRaw : null,
            'system' => preg_match('/\b(?:SYSTEM|UPDATED_SYSTEM_APP)\b/', $dump) === 1
                || preg_match('#^/(system|product|vendor|odm|apex|system_ext)/#', trim($apkPath[1] ?? '')) === 1,
            'installed' => $installedRaw !== '',
            'enabled' => $disabledRaw === '',
            'launcher' => $launcher,
            'running' => $pidRaw !== '',
            'pids' => $pidRaw,
            'permissions' => array_values(array_unique($permissions)),
            'raw' => trim($dump),
        ];
    }

    private function loadCachedAppMetadata($deviceId)
    {
        $json = Db::table('fisher_device_apps')->where('device_id', $deviceId)->value('installed_apps');
        if (!is_string($json) || trim($json) === '') return [];
        $decoded = json_decode($json, true);
        if (!is_array($decoded)) return [];
        if (isset($decoded['apps']) && is_array($decoded['apps'])) $decoded = $decoded['apps'];

        $apps = [];
        foreach ($decoded as $row) {
            if (!is_array($row)) continue;
            $packageName = trim((string)$this->pickCachedValue($row, ['packageName', 'package', 'package_name'], ''));
            if (!$this->validPackage($packageName)) continue;
            $appName = trim((string)$this->pickCachedValue($row, ['appName', 'name', 'label', 'app_name'], ''));
            $apps[$packageName] = [
                'appName' => $appName !== '' ? $appName : $packageName,
                'packageName' => $packageName,
                'icon' => (string)$this->pickCachedValue($row, ['icon', 'appIcon', 'iconBase64', 'app_icon'], ''),
                'versionName' => (string)$this->pickCachedValue($row, ['versionName', 'version', 'version_name'], ''),
                'versionCode' => $this->nullableInteger($this->pickCachedValue($row, ['versionCode', 'version_code'], null)),
                'firstInstallTime' => $this->pickCachedValue($row, ['firstInstallTime', 'installTime', 'first_install_time'], ''),
                'lastUpdateTime' => $this->pickCachedValue($row, ['lastUpdateTime', 'updateTime', 'last_update_time'], ''),
                'apkSize' => $this->nullableInteger($this->pickCachedValue($row, ['apkSize', 'size', 'apk_size'], null)),
                'system' => $this->nullableBoolean($this->pickCachedValue($row, ['isSystemApp', 'isSystem', 'system'], null)),
                'rawCache' => $row,
            ];
        }
        return $apps;
    }

    private function mergeCachedAppMetadata(array $apps, array $cache)
    {
        foreach ($apps as &$app) {
            $cached = $cache[$app['packageName']] ?? null;
            if (!$cached) continue;
            foreach (['appName', 'icon', 'versionName', 'versionCode', 'firstInstallTime', 'lastUpdateTime', 'apkSize'] as $field) {
                if ($this->hasValue($cached[$field] ?? null)) $app[$field] = $cached[$field];
            }
            if (($app['path'] ?? '') === '' && !empty($cached['rawCache']['apkPath'])) $app['path'] = $cached['rawCache']['apkPath'];
            $app['metadataSource'] = 'device-cache';
        }
        unset($app);
        return $apps;
    }

    private function mergeCachedAppDetail(array $detail, $cached)
    {
        if (!is_array($cached)) return $detail;
        foreach (['appName', 'icon'] as $field) {
            if ($this->hasValue($cached[$field] ?? null)) $detail[$field] = $cached[$field];
        }
        foreach (['versionName', 'versionCode', 'firstInstallTime', 'lastUpdateTime', 'apkSize'] as $field) {
            if (!$this->hasValue($detail[$field] ?? null) && $this->hasValue($cached[$field] ?? null)) {
                $detail[$field] = $cached[$field];
            }
        }
        if (!isset($detail['system']) && $cached['system'] !== null) $detail['system'] = $cached['system'];
        $detail['metadataSource'] = 'adb+device-cache';
        return $detail;
    }

    private function pickCachedValue(array $row, array $keys, $default)
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $row) && $this->hasValue($row[$key])) return $row[$key];
        }
        return $default;
    }

    private function hasValue($value)
    {
        return $value !== null && $value !== '';
    }

    private function nullableInteger($value)
    {
        return is_numeric($value) ? (int)$value : null;
    }

    private function nullableBoolean($value)
    {
        if (is_bool($value)) return $value;
        if ($value === 1 || $value === '1') return true;
        if ($value === 0 || $value === '0') return false;
        if (is_string($value)) {
            $normalized = strtolower(trim($value));
            if (in_array($normalized, ['true', 'yes'], true)) return true;
            if (in_array($normalized, ['false', 'no'], true)) return false;
        }
        return null;
    }

    private function queryAppState($deviceId, $packageName)
    {
        $pkg = $this->shellQuote($packageName);
        $command = "printf '__INSTALLED__\\n'; pm list packages --user 0 2>/dev/null | grep -Fx 'package:{$packageName}' || true; "
            . "printf '__KNOWN__\\n'; pm list packages -u --user 0 2>/dev/null | grep -Fx 'package:{$packageName}' || true; "
            . "printf '__DISABLED__\\n'; pm list packages -d -u --user 0 2>/dev/null | grep -Fx 'package:{$packageName}' || true; "
            . "printf '__PID__\\n'; pidof {$pkg} 2>/dev/null || true";
        $result = $this->executeShell($deviceId, $command, 20);
        if (!$result['success']) return null;
        return [
            'installed' => trim($this->section($result['output'], 'INSTALLED')) !== '',
            'known' => trim($this->section($result['output'], 'KNOWN')) !== '',
            'enabled' => trim($this->section($result['output'], 'DISABLED')) === '',
            'running' => trim($this->section($result['output'], 'PID')) !== '',
        ];
    }

    private function appActionMatchesState($action, $state)
    {
        if (!is_array($state)) return null;
        switch ($action) {
            case 'launch':
                return $state['installed'] && $state['enabled'];
            case 'forceStop':
                return !$state['running'];
            case 'enable':
                return $state['installed'] && $state['enabled'];
            case 'disable':
                return $state['installed'] && !$state['enabled'];
            case 'uninstall':
                return !$state['installed'];
            case 'restore':
                return $state['installed'];
            default:
                return null;
        }
    }

    private function devicePolicyActionMatchesState($action, $component, array $status)
    {
        switch ($action) {
            case 'activateAdmin':
                return $this->componentInList($component, $status['activeAdmins'] ?? []);
            case 'removeAdmin':
                return !$this->componentInList($component, $status['activeAdmins'] ?? []);
            case 'setDeviceOwner':
                return $this->componentInList($component, $status['deviceOwners'] ?? []);
            case 'clearDeviceOwner':
                return !$this->componentInList($component, $status['deviceOwners'] ?? []);
            default:
                return null;
        }
    }

    private function executeChecked($deviceId, $command, $timeout)
    {
        $marker = '__ADB_MANAGEMENT_RC__=';
        $wrapped = '{ ' . $command . '; }; __rc=$?; printf "\\n' . $marker . '%s\\n" "$__rc"; exit 0';
        $result = $this->executeShell($deviceId, $wrapped, $timeout);
        $exitCode = null;
        if (preg_match('/\n' . preg_quote($marker, '/') . '(\d+)\s*$/', $result['output'], $match)) {
            $exitCode = (int)$match[1];
            $result['output'] = preg_replace('/\n' . preg_quote($marker, '/') . '\d+\s*$/', '', $result['output']);
        }
        $result['exitCode'] = $exitCode;
        $result['success'] = $result['success'] && $exitCode === 0;
        if (!$result['success'] && $result['error'] === '') $result['error'] = trim($result['output']) ?: 'command failed';
        return $result;
    }

    private function executeShell($deviceId, $command, $timeout)
    {
        $port = $this->getDeviceTunnelPort($deviceId);
        if (!$port) return ['success' => false, 'output' => '', 'error' => '设备未分配隧道端口', 'route' => 'offline'];
        $ports = [['port' => $port, 'route' => 'primary']];
        $recovery = $port + self::RECOVERY_PORT_OFFSET;
        if ($recovery <= 65535) $ports[] = ['port' => $recovery, 'route' => 'recovery'];

        $lastError = '主线路和恢复线路均不可用';
        foreach ($ports as $candidate) {
            $response = $this->postJson($candidate['port'], '/execShell', ['command' => $command], $timeout);
            if (!$response['reachable']) {
                $lastError = $response['error'];
                continue;
            }
            $decoded = json_decode($response['body'], true);
            if (!is_array($decoded)) {
                $lastError = '设备返回了无效响应';
                continue;
            }
            $output = $decoded['data']['output'] ?? $decoded['output'] ?? '';
            return [
                'success' => ($decoded['success'] ?? true) !== false,
                'output' => is_string($output) ? $output : json_encode($output, JSON_UNESCAPED_UNICODE),
                'error' => (string)($decoded['error'] ?? $decoded['message'] ?? ''),
                'route' => $candidate['route'],
            ];
        }
        return ['success' => false, 'output' => '', 'error' => $lastError, 'route' => 'offline'];
    }

    private function postJson($port, $path, array $payload, $timeout)
    {
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $ch = curl_init("http://127.0.0.1:{$port}{$path}");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => $timeout,
        ]);
        $response = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        return [
            'reachable' => $response !== false && $httpCode >= 200 && $httpCode < 500,
            'body' => $response === false ? '' : $response,
            'error' => $error ?: "HTTP {$httpCode}",
        ];
    }

    private function uploadFile($deviceId, $localPath, $remotePath)
    {
        $port = $this->getDeviceTunnelPort($deviceId);
        if (!$port) throw new \RuntimeException('设备未分配隧道端口');
        $ports = [['port' => $port, 'route' => 'primary']];
        if ($port + self::RECOVERY_PORT_OFFSET <= 65535) $ports[] = ['port' => $port + self::RECOVERY_PORT_OFFSET, 'route' => 'recovery'];
        $lastError = 'APK上传失败';
        foreach ($ports as $candidate) {
            $ch = curl_init("http://127.0.0.1:{$candidate['port']}/filePush");
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST => true,
                CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_TIMEOUT => 300,
                CURLOPT_POSTFIELDS => [
                    'file' => new \CURLFile($localPath, 'application/vnd.android.package-archive', basename($localPath)),
                    'path' => $remotePath,
                ],
            ]);
            $body = curl_exec($ch);
            $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $error = curl_error($ch);
            curl_close($ch);
            $decoded = is_string($body) ? json_decode($body, true) : null;
            if ($httpCode >= 200 && $httpCode < 300 && is_array($decoded) && !empty($decoded['success'])) return $candidate['route'];
            $lastError = $error ?: "HTTP {$httpCode}";
        }
        throw new \RuntimeException($lastError);
    }

    private function getDeviceTunnelPort($deviceId)
    {
        $port = (int)(Db::table('fisher_devices')->where('device_id', $deviceId)->value('remote_port') ?? 0);
        return $port >= 1 && $port <= 65535 ? $port : null;
    }

    private function section($output, $name)
    {
        $pattern = '/__' . preg_quote($name, '/') . '__\r?\n(.*?)(?=__[A-Z0-9_]+__\r?\n|\z)/s';
        return preg_match($pattern, $output, $match) ? $match[1] : '';
    }

    private function extractComponents($text)
    {
        preg_match_all('/[A-Za-z0-9_][A-Za-z0-9._]*\/[A-Za-z0-9_.$]+/', $text, $matches);
        return array_values(array_unique($matches[0] ?? []));
    }

    private function extractActiveAdmins($text)
    {
        $sections = [];
        if (preg_match_all('/^\s*Enabled Device Admins \(User \d+[^\n]*\):\s*$(.*?)(?=^\s*mPasswordOwner=|^\s*Enabled Device Admins \(User |\z)/ms', $text, $matches)) {
            $sections = $matches[1];
        }
        if (!$sections) return [];
        return $this->extractComponents(implode("\n", $sections));
    }

    private function componentInList($component, array $items)
    {
        $needle = $this->normalizeComponent($component);
        foreach ($items as $item) {
            if ($this->normalizeComponent($item) === $needle) return true;
        }
        return false;
    }

    private function normalizeComponent($component)
    {
        $parts = explode('/', (string)$component, 2);
        if (count($parts) !== 2) return (string)$component;
        if (strpos($parts[1], '.') === 0) $parts[1] = $parts[0] . $parts[1];
        return $parts[0] . '/' . $parts[1];
    }

    private function validPackage($packageName)
    {
        return preg_match('/^[A-Za-z0-9_][A-Za-z0-9._]*$/', $packageName) === 1;
    }

    private function validComponent($component)
    {
        return preg_match('/^[A-Za-z0-9_][A-Za-z0-9._]*\/[A-Za-z0-9_.$]+$/', $component) === 1;
    }

    private function shellQuote($value)
    {
        return "'" . str_replace("'", "'\"'\"'", (string)$value) . "'";
    }
}
