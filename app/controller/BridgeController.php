<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class BridgeController extends BaseController
{
    /**
     * POST /api/bridge/command
     * POST /api/bridge/command/:deviceId
     * 向设备发送命令（通过命令队列）
     */
    public function sendCommand($deviceId = '')
    {
        $data = Request::post();
        if (!$deviceId) {
            $deviceId = $data['deviceId'] ?? '';
        }
        $cmd = $data['command'] ?? $data['cmd'] ?? '';
        $params = $data['params'] ?? [];

        if (!$deviceId) {
            return json(['success' => false, 'message' => 'deviceId required'], 400);
        }

        $commandId = $data['commandId'] ?? uniqid('cmd-');

        // rightAdb 模式：放入队列，前端轮询结果
        if (!empty($params['rightAdb'])) {
            $requestId = 'cmd-' . intval(microtime(true) * 1000) . '-' . substr(md5(uniqid()), 0, 6);
            $cleanParams = $params;
            unset($cleanParams['rightAdb']);

            $cmdEntry = [
                'id'      => $requestId,
                'method'  => $cmd,
                'command' => $cmd,
                'params'  => $cleanParams ?: (object)[],
            ];

            $this->enqueueCommand($deviceId, $cmdEntry);

            return json([
                'success' => true,
                'data' => [
                    'status'    => 'queued',
                    'commandId' => $requestId,
                    'deviceId'  => $deviceId,
                    'method'    => $cmd,
                    'msgType'   => 'command',
                ],
                'message' => 'success',
            ]);
        }

        // 常规模式：fire-and-forget 放入命令队列
        // 转换特殊命令为 bridge 格式
        $method = $cmd;
        $actualParams = $params ?: [];
        
        // home/back/recents 按键转换为 keyevent
        if (in_array($cmd, ['home', 'back', 'recents', 'menu', 'power'])) {
            $method = 'keyevent';
            $keycodeMap = [
                'home' => 'KEYCODE_HOME',
                'back' => 'KEYCODE_BACK',
                'recents' => 'KEYCODE_APP_SWITCH',
                'menu' => 'KEYCODE_MENU',
                'power' => 'KEYCODE_POWER',
            ];
            $actualParams = ['keycode' => $keycodeMap[$cmd] ?? 'KEYCODE_HOME'];
        }
        
        $goMsg = [
            'method' => $method,
            'command' => $method,
            'commandId' => $commandId,
            'id' => $commandId,
            'params' => $actualParams ?: (object)[],
        ];

        $this->enqueueCommand($deviceId, $goMsg);

        return json([
            'success' => true,
            'data' => [
                'status'    => 'sent',
                'method'    => $cmd,
                'commandId' => $commandId,
                'deviceId'  => $deviceId,
            ],
            'message' => 'success',
        ]);
    }

    /**
     * POST /api/bridge/commands
     * 批量发送命令
     */
    public function sendCommands()
    {
        $data = Request::post();
        $commands = $data['commands'] ?? [];
        $deviceId = $data['deviceId'] ?? '';

        if (!$deviceId || !is_array($commands)) {
            return json(['success' => false, 'message' => 'deviceId and commands required'], 400);
        }

        $results = [];
        foreach ($commands as $cmd) {
            $commandId = $cmd['commandId'] ?? uniqid('cmd-');
            $entry = [
                'id'      => $commandId,
                'method'  => $cmd['command'] ?? $cmd['method'] ?? '',
                'command' => $cmd['command'] ?? $cmd['method'] ?? '',
                'params'  => $cmd['params'] ?? (object)[],
            ];
            $this->enqueueCommand($deviceId, $entry);
            $results[] = ['commandId' => $commandId, 'status' => 'queued'];
        }

        return json(['success' => true, 'data' => $results, 'message' => 'success']);
    }

    /**
     * POST /api/bridge/screenshot
     * 截图命令
     */
    public function screenshot()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $commandId = uniqid('ss-');

        $this->enqueueCommand($deviceId, [
            'id'      => $commandId,
            'method'  => 'screenshot',
            'command' => 'screenshot',
            'params'  => (object)[],
        ]);

        return json(['success' => true, 'data' => ['commandId' => $commandId, 'status' => 'queued'], 'message' => 'success']);
    }

    /**
     * POST /api/bridge/screen-record
     */
    public function screenRecord()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $commandId = uniqid('sr-');

        $this->enqueueCommand($deviceId, [
            'id'      => $commandId,
            'method'  => 'screenRecord',
            'command' => 'screenRecord',
            'params'  => $data['params'] ?? (object)[],
        ]);

        return json(['success' => true, 'data' => ['commandId' => $commandId, 'status' => 'queued'], 'message' => 'success']);
    }

    /**
     * POST /api/bridge/shell
     * Shell 命令
     */
    public function shell()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $command = $data['command'] ?? '';
        $commandId = uniqid('sh-');

        $this->enqueueCommand($deviceId, [
            'id'      => $commandId,
            'method'  => 'shell',
            'command' => 'shell',
            'params'  => ['command' => $command],
        ]);

        return json(['success' => true, 'data' => ['commandId' => $commandId, 'status' => 'queued'], 'message' => 'success']);
    }

    /**
     * GET /api/bridge/status
     * 获取桥接状态
     */
    public function status()
    {
        // 实际状态由 Node.js WS 服务管理，这里返回基础信息
        return json(['success' => true, 'data' => ['wsConnected' => true, 'bridges' => []], 'message' => 'success']);
    }

    /**
     * GET /api/bridge/result/:commandId
     * 获取命令执行结果
     */
    public function getResult($commandId = '')
    {
        if (!$commandId) {
            $commandId = Request::get('commandId', '');
        }
        $key = "cmd_result_{$commandId}";
        $result = Db::table('fisher_settings')->where('key', $key)->value('value');

        if ($result) {
            // 取出后删除
            Db::table('fisher_settings')->where('key', $key)->delete();
            $data = json_decode($result, true);
            return json(['success' => true, 'data' => $data, 'message' => 'success']);
        }

        return json(['success' => true, 'data' => null, 'pending' => true]);
    }

    /**
     * 入队命令
     */
    private function enqueueCommand(string $deviceId, array $command): void
    {
        if (!$deviceId) return;
        Db::table('fisher_pending_commands')->insert([
            'device_id'    => $deviceId,
            'command_json' => json_encode($command, JSON_UNESCAPED_UNICODE),
            'created_at'   => time(),
        ]);
    }
}
