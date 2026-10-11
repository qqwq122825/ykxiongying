<?php
// Import/update Peru injection templates from deploy/peru_templates into fisher_injection_templates.
// Run from project root: php deploy/import_peru_templates.php

require __DIR__ . '/../vendor/autoload.php';

use think\App;
use think\facade\Db;

$app = new App();
$app->initialize();

$dir = __DIR__ . '/peru_templates';
$files = glob($dir . '/*.txt') ?: [];
$now = date('Y-m-d H:i:s');
$country = '秘鲁';
$seen = [];
$updated = 0;
$inserted = 0;
$skipped = 0;
$results = [];

foreach ($files as $file) {
    $base = basename($file);
    if (!preg_match('/^(.*?)《([^》]+)》\.txt$/u', $base, $m)) {
        $skipped++;
        $results[] = ['file' => $base, 'status' => 'skip_name'];
        continue;
    }

    $name = trim($m[1]);
    $pkg = trim($m[2]);
    if ($pkg === '' || isset($seen[$pkg])) {
        $skipped++;
        $results[] = ['file' => $base, 'package_name' => $pkg, 'status' => 'skip_duplicate'];
        continue;
    }
    $seen[$pkg] = true;

    $html = file_get_contents($file);
    if ($html === false || $html === '') {
        $skipped++;
        $results[] = ['file' => $base, 'package_name' => $pkg, 'status' => 'skip_empty'];
        continue;
    }

    $templateId = $name . '_' . $pkg;
    $row = Db::name('injection_templates')->where('package_name', $pkg)->find();
    if (!$row) {
        $row = Db::name('injection_templates')->where('template_id', $templateId)->find();
    }

    $data = [
        'template_id'  => $row['template_id'] ?? $templateId,
        'name'         => $name,
        'package_name' => $pkg,
        'country'      => $country,
        'html_content' => $html,
        'enabled'      => 1,
        'visible'      => 1,
        'updated_at'   => $now,
    ];

    if ($row) {
        Db::name('injection_templates')->where('id', (int)$row['id'])->update($data);
        $updated++;
        $results[] = ['id' => (int)$row['id'], 'name' => $name, 'package_name' => $pkg, 'country' => $country, 'status' => 'updated', 'bytes' => strlen($html)];
    } else {
        $data += [
            'icon'       => '',
            'color'      => '#6366F1',
            'file'       => '',
            'type'       => 'overlay',
            'created_at' => $now,
        ];
        $id = Db::name('injection_templates')->insertGetId($data);
        $inserted++;
        $results[] = ['id' => (int)$id, 'name' => $name, 'package_name' => $pkg, 'country' => $country, 'status' => 'inserted', 'bytes' => strlen($html)];
    }
}

$verify = Db::name('injection_templates')
    ->field('id,template_id,name,package_name,country,LENGTH(html_content) AS bytes')
    ->whereIn('package_name', array_keys($seen))
    ->order('id', 'asc')
    ->select()
    ->toArray();

$out = [
    'success' => true,
    'country' => $country,
    'files' => count($files),
    'unique_packages' => count($seen),
    'updated' => $updated,
    'inserted' => $inserted,
    'skipped' => $skipped,
    'results' => $results,
    'verify' => $verify,
];

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), PHP_EOL;
