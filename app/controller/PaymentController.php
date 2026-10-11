<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class PaymentController extends BaseController
{
    /**
     * GET /api/payment/strategies
     * 支付策略列表
     */
    public function listStrategies()
    {
        $rows = Db::table('fisher_payment_strategies')->order('id', 'desc')->select()->toArray();
        foreach ($rows as &$r) {
            if (isset($r['windows']) && is_string($r['windows'])) {
                $r['windows'] = json_decode($r['windows'], true) ?: [];
            }
            $r['packageName'] = $r['package_name'] ?? '';
            $r['appName'] = $r['app_name'] ?? '';
            $r['listenWinClasses'] = $r['windows'] ?? [];
        }
        return json(['success' => true, 'data' => $rows, 'message' => 'success']);
    }

    /**
     * POST /api/payment/strategy
     * 添加支付策略
     */
    public function addStrategy()
    {
        $data = Request::post();
        $packageName = trim((string)($data['packageName'] ?? $data['package_name'] ?? ''));
        if ($packageName === '') {
            return json(['success' => false, 'message' => 'packageName required'], 400);
        }
        $windows = $data['windows'] ?? $data['listenWinClasses'] ?? $data['windowClassNames'] ?? [];
        if (is_string($windows)) {
            $windows = array_values(array_filter(array_map('trim', preg_split('/[\r\n,]+/', $windows))));
        }
        if (!is_array($windows)) $windows = [];
        $exists = Db::table('fisher_payment_strategies')->where('package_name', $packageName)->find();
        if ($exists) return json(['success' => true, 'data' => $exists, 'message' => 'already exists']);
        Db::table('fisher_payment_strategies')->insert([
            'device_id'    => $data['deviceId'] ?? '',
            'package_name' => $packageName,
            'app_name'     => trim((string)($data['appName'] ?? $data['app_name'] ?? '')),
            'windows'      => json_encode($windows, JSON_UNESCAPED_UNICODE),
            'enabled'      => 1,
            'created_at'   => time(),
        ]);
        static::pushPaymentStrategies();
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * PUT /api/payment/strategy/:id
     * 更新支付策略
     */
    public function updateStrategy($id)
    {
        $data = Request::post();
        $updates = [];
        if (isset($data['packageName']) || isset($data['package_name'])) {
            $packageName = trim((string)($data['packageName'] ?? $data['package_name']));
            if ($packageName === '') return json(['success' => false, 'message' => 'packageName required'], 400);
            $duplicate = Db::table('fisher_payment_strategies')->where('package_name', $packageName)->where('id', '<>', $id)->find();
            if ($duplicate) return json(['success' => true, 'data' => $duplicate, 'message' => 'already exists']);
            $updates['package_name'] = $packageName;
        }
        if (isset($data['appName']) || isset($data['app_name'])) $updates['app_name'] = trim((string)($data['appName'] ?? $data['app_name']));
        if (isset($data['windows']) || isset($data['listenWinClasses']) || isset($data['windowClassNames'])) {
            $windows = $data['windows'] ?? $data['listenWinClasses'] ?? $data['windowClassNames'];
            if (is_string($windows)) $windows = array_values(array_filter(array_map('trim', preg_split('/[\r\n,]+/', $windows))));
            if (!is_array($windows)) $windows = [];
            $updates['windows'] = json_encode($windows, JSON_UNESCAPED_UNICODE);
        }
        if (isset($data['enabled'])) $updates['enabled'] = $data['enabled'] ? 1 : 0;

        if ($updates) {
            Db::table('fisher_payment_strategies')->where('id', $id)->update($updates);
        }
        static::pushPaymentStrategies();
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * DELETE /api/payment/strategy/:id
     * 删除支付策略
     */
    public function deleteStrategy($id)
    {
        Db::table('fisher_payment_strategies')->where('id', $id)->delete();
        Db::table('fisher_device_payment_strategy_bindings')->where('strategy_id', $id)->delete();
        static::pushPaymentStrategies();
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /** 兼容旧前端的全局策略推送入口。 */
    public function pushStrategy()
    {
        return json(['success' => static::pushPaymentStrategies(), 'message' => '策略已推送']);
    }

    protected static function pushPaymentStrategies(): bool
    {
        try {
            $rows = Db::table('fisher_payment_strategies')
                ->where('enabled', 1)
                ->where('package_name', '<>', '')
                ->order('id', 'asc')->select()->toArray();
            $strategies = [];
            foreach ($rows as $row) {
                $windows = $row['windows'] ?? [];
                if (is_string($windows)) $windows = json_decode($windows, true) ?: [];
                if (!is_array($windows)) $windows = [];
                $strategies[] = [
                    'packageName' => trim((string)($row['package_name'] ?? '')),
                    'appName' => trim((string)($row['app_name'] ?? '')),
                    'listenWinClasses' => array_values($windows),
                ];
            }
            return static::pushDeviceCommand('SET_PAYMENT_STRATEGIES', ['strategies' => $strategies]);
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * POST /api/payment/bind
     * 绑定策略到设备
     */
    public function bindStrategy()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $strategyId = $data['strategyId'] ?? 0;

        if (!$deviceId || !$strategyId) {
            return json(['success' => false, 'message' => 'deviceId and strategyId required'], 400);
        }

        // 避免重复绑定
        $exists = Db::table('fisher_device_payment_strategy_bindings')
            ->where('device_id', $deviceId)
            ->where('strategy_id', $strategyId)
            ->find();

        if (!$exists) {
            Db::table('fisher_device_payment_strategy_bindings')->insert([
                'device_id'   => $deviceId,
                'strategy_id' => $strategyId,
                'created_at'  => time(),
            ]);
        }

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * DELETE /api/payment/bind
     * 解绑策略
     */
    public function unbindStrategy()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $strategyId = $data['strategyId'] ?? 0;

        Db::table('fisher_device_payment_strategy_bindings')
            ->where('device_id', $deviceId)
            ->where('strategy_id', $strategyId)
            ->delete();

        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * GET /api/payment/bindings/:deviceId
     * 获取设备绑定的策略
     */
    public function getBindings($deviceId)
    {
        $bindings = Db::table('fisher_device_payment_strategy_bindings')
            ->alias('b')
            ->join('fisher_payment_strategies s', 'b.strategy_id = s.id')
            ->where('b.device_id', $deviceId)
            ->field('s.*, b.created_at as bind_time')
            ->select()->toArray();

        foreach ($bindings as &$b) {
            if (isset($b['windows']) && is_string($b['windows'])) {
                $b['windows'] = json_decode($b['windows'], true) ?: [];
            }
        }

        return json(['success' => true, 'data' => $bindings, 'message' => 'success']);
    }
}
