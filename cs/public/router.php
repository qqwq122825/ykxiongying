<?php
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$file = $_SERVER['DOCUMENT_ROOT'] . $path;

if ($path === '/install' || $path === '/install/') {
    require __DIR__ . '/install.php';
    return true;
}

if ($path !== '/' && is_file($file)) {
    return false;
}

if (!str_starts_with($path, '/api/') && !str_starts_with($path, '/m/')) {
    readfile(__DIR__ . '/index.html');
    return true;
}

$_SERVER['SCRIPT_FILENAME'] = __DIR__ . '/index.php';
require __DIR__ . '/index.php';
