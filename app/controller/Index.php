<?php

namespace app\controller;

use app\BaseController;

class Index extends BaseController
{
    public function index()
    {
        // 返回前端 SPA 的 index.html
        $indexFile = app()->getRootPath() . 'public/index.html';
        if (file_exists($indexFile)) {
            return response(file_get_contents($indexFile), 200, ['Content-Type' => 'text/html; charset=utf-8']);
        }
        return response('Fisher Panel', 200);
    }

    public function hello($name = 'ThinkPHP8')
    {
        return 'hello,' . $name;
    }
}
