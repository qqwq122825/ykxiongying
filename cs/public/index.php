<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
// +----------------------------------------------------------------------
// | ThinkPHP [ WE CAN DO IT JUST THINK ]
// +----------------------------------------------------------------------

use think\App;

require __DIR__ . '/../vendor/autoload.php';

$http = (new App())->http;

$response = $http->run();

$response->send();

$http->end($response);
