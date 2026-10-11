<?php
// 全局中间件定义文件
return [
    // 跨域
    \think\middleware\AllowCrossDomain::class,
    // JWT 认证
    \app\middleware\Auth::class,
];
