<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class ShizukuController extends BaseController
{
    private const REMOTE_BASE = '/data/local/tmp';
    private const RECOVERY_PORT_OFFSET = 30000;

    private const ARTIFACTS = [
        'companion' => [
            'file' => 'shizuku-companion.apk',
            'remote' => self::REMOTE_BASE . '/shizuku-companion.apk',
        ],
        'readerAgent' => [
            'file' => 'adb-reader-agent.apk',
            'remote' => self::REMOTE_BASE . '/adb-reader-agent.apk',
        ],
        'supervisor' => [
            'file' => 'shizuku-supervisor.sh',
            'remote' => self::REMOTE_BASE . '/shizuku-supervisor.sh',
        ],
        'deployer' => [
            'file' => 'shizuku-deploy.sh',
            'remote' => self::REMOTE_BASE . '/shizuku-deploy.sh',
        ],
        'recoveryArm64' => [
            'file' => 'shizuku-recovery-agent-arm64',
            'remote' => self::REMOTE_BASE . '/shizuku-recovery-agent-arm64',
        ],
        'recoveryX8664' => [
            'file' => 'shizuku-recovery-agent-x86_64',
            'remote' => self::REMOTE_BASE . '/shizuku-recovery-agent-x86_64',
        ],
    ];

    public function artifacts()
    {
        try {
            $artifacts = $this->artifactMetadata(true);
            foreach ($artifacts as &$artifact) {
                unset($artifact['path']);
            }
            unset($artifact);

            return json([
                'success' => true,
                'version' => '13.7.0-thedjchi-companion',
                'artifacts' => $artifacts,
            ]);
        } catch (\Throwable $e) {
            return json(['success' => false, 'error' => $e->getMessage()], 500);
        }
    }

    public function deploy()
    {
        return $this->runAction('install', true);
    }

    public function repair()
    {
        return $this->runAction('repair', true);
    }

    public function status()
    {
        return $this->runAction('status', false);
    }

    public function stop()
    {
        return $this->runAction('stop', false);
    }

    public function ensureReaderAgent()
    {
        $deviceId = trim((string)Request::param('deviceId', ''));
        if ($deviceId === '' || strlen($deviceId) > 128) {
            return json(['success' => false, 'error' => 'deviceId required'], 400);
        }

        $primaryPort = $this->getDeviceTunnelPort($deviceId);
        if ($primaryPort === null) {
            return json(['success' => false, 'error' => 'Device tunnel is unavailable'], 404);
        }
        $recoveryPort = $this->recoveryPort($primaryPort);
        $port = $this->selectReachablePort($primaryPort, $recoveryPort);
        $lock = $this->acquireDeviceLock($deviceId);
        if ($lock === false) {
            return json(['success' => false, 'error' => 'A device service operation is already running'], 409);
        }

        try {
            [$status, $port] = $this->executeShellWithFallback(
                [$port, $primaryPort, $recoveryPort],
                $this->buildReaderAgentStatusCommand()
            );
            if (!empty($status['success']) && !empty($status['ready'])) {
                return json(array_merge([
                    'deviceId' => $deviceId,
                    'action' => 'ensure-reader-agent',
                    'port' => $port,
                ], $status));
            }

            $metadata = $this->artifactMetadata(false);
            $reader = $metadata['readerAgent'] ?? [];
            if (empty($reader['path']) || !is_file($reader['path']) || !is_readable($reader['path'])) {
                throw new \RuntimeException('Missing Shizuku artifact: adb-reader-agent.apk');
            }

            $port = $this->uploadArtifactWithFallback(
                [$port, $primaryPort, $recoveryPort],
                $reader['path'],
                self::ARTIFACTS['readerAgent']['remote']
            );
            [$result, $port] = $this->executeShellWithFallback(
                [$port, $primaryPort, $recoveryPort],
                $this->buildReaderAgentInstallCommand($reader)
            );

            return json(array_merge([
                'deviceId' => $deviceId,
                'action' => 'ensure-reader-agent',
                'port' => $port,
            ], $result), !empty($result['success']) ? 200 : 502);
        } catch (\Throwable $e) {
            return json([
                'success' => false,
                'deviceId' => $deviceId,
                'action' => 'ensure-reader-agent',
                'error' => $e->getMessage(),
            ], 502);
        } finally {
            $this->releaseDeviceLock($lock);
        }
    }

    public function setReaderMode()
    {
        $deviceId = trim((string)Request::param('deviceId', ''));
        $mode = trim((string)Request::param('mode', ''));
        if ($deviceId === '' || strlen($deviceId) > 128) {
            return json(['success' => false, 'error' => 'deviceId required'], 400);
        }
        if (!in_array($mode, ['legacy', 'agent'], true)) {
            return json(['success' => false, 'error' => 'mode must be legacy or agent'], 400);
        }

        $primaryPort = $this->getDeviceTunnelPort($deviceId);
        if ($primaryPort === null) {
            return json(['success' => false, 'error' => 'Device tunnel is unavailable'], 404);
        }
        $recoveryPort = $this->recoveryPort($primaryPort);
        $port = $this->selectReachablePort($primaryPort, $recoveryPort);
        $lock = $this->acquireDeviceLock($deviceId);
        if ($lock === false) {
            return json(['success' => false, 'error' => 'A device service operation is already running'], 409);
        }

        try {
            [$result, $port] = $this->executeShellWithFallback(
                [$port, $primaryPort, $recoveryPort],
                $this->buildReaderModeCommand($mode)
            );
            return json(array_merge([
                'deviceId' => $deviceId,
                'action' => 'set-reader-mode',
                'port' => $port,
            ], $result), !empty($result['success']) ? 200 : 502);
        } catch (\Throwable $e) {
            return json([
                'success' => false,
                'deviceId' => $deviceId,
                'action' => 'set-reader-mode',
                'error' => $e->getMessage(),
            ], 502);
        } finally {
            $this->releaseDeviceLock($lock);
        }
    }

    private function runAction($action, $upload)
    {
        $deviceId = trim((string)Request::param('deviceId', ''));
        if ($deviceId === '' || strlen($deviceId) > 128) {
            return json(['success' => false, 'error' => 'deviceId required'], 400);
        }

        $primaryPort = $this->getDeviceTunnelPort($deviceId);
        if ($primaryPort === null) {
            return json(['success' => false, 'error' => 'Device tunnel is unavailable'], 404);
        }
        $recoveryPort = $this->recoveryPort($primaryPort);
        $port = $this->selectReachablePort($primaryPort, $recoveryPort);

        $lock = null;
        if ($action !== 'status') {
            $lock = $this->acquireDeviceLock($deviceId);
            if ($lock === false) {
                return json(['success' => false, 'error' => 'A Shizuku operation is already running'], 409);
            }
        }

        try {
            $metadata = $upload ? $this->artifactMetadata(true) : [];
            if ($upload) {
                foreach (self::ARTIFACTS as $name => $artifact) {
                    $port = $this->uploadArtifactWithFallback(
                        [$port, $primaryPort, $recoveryPort],
                        $metadata[$name]['path'],
                        $artifact['remote']
                    );
                }
            }

            $command = $this->buildCommand($action, $metadata);
            [$result, $port] = $this->executeShellWithFallback([$port, $primaryPort, $recoveryPort], $command);
            $payload = array_merge([
                'deviceId' => $deviceId,
                'action' => $action,
                'port' => $port,
            ], $result);

            return json($payload, !empty($result['success']) ? 200 : 502);
        } catch (\Throwable $e) {
            return json([
                'success' => false,
                'deviceId' => $deviceId,
                'action' => $action,
                'error' => $e->getMessage(),
            ], 502);
        } finally {
            $this->releaseDeviceLock($lock);
        }
    }

    private function artifactMetadata($requireAll)
    {
        $base = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'shizuku-artifacts';
        $result = [];

        foreach (self::ARTIFACTS as $name => $artifact) {
            $path = $base . DIRECTORY_SEPARATOR . $artifact['file'];
            $exists = is_file($path) && is_readable($path);
            if ($requireAll && !$exists) {
                throw new \RuntimeException('Missing Shizuku artifact: ' . $artifact['file']);
            }

            $result[$name] = [
                'file' => $artifact['file'],
                'path' => $path,
                'remotePath' => $artifact['remote'],
                'size' => $exists ? filesize($path) : 0,
                'sha256' => $exists ? strtoupper(hash_file('sha256', $path)) : '',
            ];
        }

        return $result;
    }

    private function getDeviceTunnelPort($deviceId)
    {
        $device = Db::table('fisher_devices')
            ->where('device_id', $deviceId)
            ->field('remote_port')
            ->find();

        $port = (int)($device['remote_port'] ?? 0);
        return $port >= 1 && $port <= 65535 ? $port : null;
    }

    private function uploadArtifact($port, $localPath, $remotePath)
    {
        $ch = curl_init("http://127.0.0.1:{$port}/filePush");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 240,
            CURLOPT_TCP_NODELAY => 1,
            CURLOPT_TCP_KEEPALIVE => 1,
            CURLOPT_TCP_KEEPIDLE => 60,
            CURLOPT_TCP_KEEPINTVL => 10,
            CURLOPT_POSTFIELDS => [
                'file' => new \CURLFile($localPath, 'application/octet-stream', basename($localPath)),
                'path' => $remotePath,
            ],
        ]);

        $body = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($body === false || $httpCode < 200 || $httpCode >= 300) {
            throw new \RuntimeException('Artifact upload failed: ' . ($error ?: "HTTP {$httpCode}"));
        }

        $decoded = json_decode($body, true);
        $uploadedPath = $decoded['data']['path'] ?? '';
        if (empty($decoded['success']) || $uploadedPath !== $remotePath) {
            throw new \RuntimeException('Artifact upload returned an invalid response');
        }
    }

    private function uploadArtifactWithFallback(array $ports, $localPath, $remotePath)
    {
        $lastError = null;
        foreach (array_values(array_unique(array_filter($ports))) as $port) {
            try {
                $this->uploadArtifact($port, $localPath, $remotePath);
                return (int)$port;
            } catch (\Throwable $e) {
                $lastError = $e;
            }
        }
        throw $lastError ?: new \RuntimeException('No reachable artifact upload route');
    }

    private function executeShell($port, $command)
    {
        $body = json_encode(['command' => $command], JSON_UNESCAPED_SLASHES);
        $ch = curl_init("http://127.0.0.1:{$port}/execShell");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 240,
            CURLOPT_TCP_NODELAY => 1,
            CURLOPT_TCP_KEEPALIVE => 1,
            CURLOPT_TCP_KEEPIDLE => 60,
            CURLOPT_TCP_KEEPINTVL => 10,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => $body,
        ]);

        $response = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($response === false || $httpCode < 200 || $httpCode >= 300) {
            throw new \RuntimeException('Device shell request failed: ' . ($error ?: "HTTP {$httpCode}"));
        }

        $wrapper = json_decode($response, true);
        if (!is_array($wrapper)) {
            throw new \RuntimeException('Device shell returned invalid JSON');
        }

        // 1) 外层隧道响应本身是 success:false → 当作明确失败返回，不抛异常避免前端 catch 显示乱码
        if (isset($wrapper['success']) && $wrapper['success'] === false) {
            $msg = $wrapper['error'] ?? $wrapper['message'] ?? $wrapper['data']['error'] ?? 'Shell 执行失败';
            return ['success' => false, 'error' => is_string($msg) ? $msg : 'Shell 执行失败'];
        }

        $output = trim((string)($wrapper['data']['output'] ?? ''));
        $result = $this->decodeLastJsonLine($output);
        if ($result !== null) {
            return $result;
        }

        // 2) 没有 status JSON，但 data.output 有内容就原样返回，不再 throw
        if ($output !== '') {
            // 常见可静默情况：文件不存在/命令不存在 → 前端归一显示"未运行"，不显示红色错误
            if (preg_match('/No such file|not found|Permission denied|cannot stat|does not exist/i', $output)) {
                return ['success' => true, 'ready' => false, 'output' => $output];
            }
            return ['success' => true, 'ready' => false, 'output' => $output];
        }

        $message = $wrapper['error'] ?? $wrapper['message'] ?? 'Device shell returned no status';
        return ['success' => false, 'ready' => false, 'error' => is_string($message) ? $message : 'Device shell returned no status'];
    }

    private function executeShellWithFallback(array $ports, $command)
    {
        $lastError = null;
        foreach (array_values(array_unique(array_filter($ports))) as $port) {
            try {
                return [$this->executeShell($port, $command), (int)$port];
            } catch (\Throwable $e) {
                $lastError = $e;
            }
        }
        throw $lastError ?: new \RuntimeException('No reachable shell route');
    }

    private function recoveryPort($primaryPort)
    {
        $port = (int)$primaryPort + self::RECOVERY_PORT_OFFSET;
        return $port >= 1 && $port <= 65535 ? $port : 0;
    }

    private function selectReachablePort($primaryPort, $recoveryPort)
    {
        if ($this->portResponds($primaryPort)) {
            return (int)$primaryPort;
        }
        if ($recoveryPort && $this->portResponds($recoveryPort)) {
            return (int)$recoveryPort;
        }
        return (int)$primaryPort;
    }

    private function portResponds($port)
    {
        if (!$port) {
            return false;
        }
        $ch = curl_init("http://127.0.0.1:{$port}/health");
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT => 3,
        ]);
        curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return $httpCode > 0;
    }

    private function decodeLastJsonLine($output)
    {
        $lines = preg_split('/\r?\n/', trim($output));
        for ($i = count($lines) - 1; $i >= 0; $i--) {
            $decoded = json_decode(trim($lines[$i]), true);
            if (is_array($decoded) && array_key_exists('success', $decoded)) {
                return $decoded;
            }
        }
        return null;
    }

    private function buildCommand($action, $metadata)
    {
        $deployer = self::ARTIFACTS['deployer']['remote'];
        if ($action === 'status' || $action === 'stop') {
            return 'sh ' . escapeshellarg($deployer) . ' ' . $action;
        }

        $supervisor = self::ARTIFACTS['supervisor']['remote'];
        return 'chmod 755 ' . escapeshellarg($supervisor) . ' ' . escapeshellarg($deployer)
            . ' && COMPANION_SHA256=' . escapeshellarg($metadata['companion']['sha256'])
            . ' READER_AGENT_SHA256=' . escapeshellarg($metadata['readerAgent']['sha256'])
            . ' SUPERVISOR_SHA256=' . escapeshellarg($metadata['supervisor']['sha256'])
            . ' DEPLOYER_SHA256=' . escapeshellarg($metadata['deployer']['sha256'])
            . ' RECOVERY_ARM64_SHA256=' . escapeshellarg($metadata['recoveryArm64']['sha256'])
            . ' RECOVERY_X8664_SHA256=' . escapeshellarg($metadata['recoveryX8664']['sha256'])
            . ' TCP_PORT=5555 sh ' . escapeshellarg($deployer) . ' ' . $action;
    }

    private function buildReaderAgentStatusCommand()
    {
        $modeFile = self::REMOTE_BASE . '/adb-reader-mode';
        return 'printf ' . $this->quoteDeviceShell('agent') . ' >' . $this->quoteDeviceShell($modeFile) . '; '
            . 'killall uiautomator >/dev/null 2>&1 || true; '
            . 'pid=$(pidof com.fisher.readeragent 2>/dev/null); '
            . 'if [ -n "$pid" ] && ss -ltn 2>/dev/null | grep -q ' . $this->quoteDeviceShell(':7923') . '; then '
            . 'printf ' . $this->quoteDeviceShell('{"success":true,"ready":true,"readerAgent":"running:%s"}\n') . ' "$pid"; '
            . 'else printf ' . $this->quoteDeviceShell('{"success":true,"ready":false,"readerAgent":"stopped"}\n') . '; fi';
    }

    private function buildReaderModeCommand($mode)
    {
        $modeFile = self::REMOTE_BASE . '/adb-reader-mode';
        if ($mode === 'agent') {
            return 'printf ' . $this->quoteDeviceShell('agent') . ' >' . $this->quoteDeviceShell($modeFile) . '; '
                . 'killall uiautomator >/dev/null 2>&1 || true; '
                . 'printf ' . $this->quoteDeviceShell('{"success":true,"mode":"agent"}\n');
        }

        return 'printf ' . $this->quoteDeviceShell('legacy') . ' >' . $this->quoteDeviceShell($modeFile) . '; '
            . 'am force-stop ' . $this->quoteDeviceShell('com.fisher.readeragent') . ' >/dev/null 2>&1 || true; '
            . 'i=0; while [ "$i" -lt 10 ]; do '
            . 'pid=$(pidof ' . $this->quoteDeviceShell('com.fisher.readeragent') . ' 2>/dev/null); '
            . 'if [ -z "$pid" ] && ! ss -ltn 2>/dev/null | grep -q ' . $this->quoteDeviceShell(':7923') . '; then '
            . 'printf ' . $this->quoteDeviceShell('{"success":true,"mode":"legacy","readerAgent":"stopped"}\n') . '; exit 0; fi; '
            . 'sleep 1; i=$((i + 1)); done; '
            . 'printf ' . $this->quoteDeviceShell('{"success":false,"mode":"legacy","error":"Reader agent did not stop"}\n');
    }

    private function buildReaderAgentInstallCommand(array $metadata)
    {
        $remote = self::ARTIFACTS['readerAgent']['remote'];
        $expectedHash = strtoupper((string)($metadata['sha256'] ?? ''));
        $package = 'com.fisher.readeragent';
        $instrumentation = 'com.fisher.readeragent/com.fisher.readeragent.ReaderInstrumentation';
        $installLog = self::REMOTE_BASE . '/adb-reader-agent-install.log';
        $runtimeLog = self::REMOTE_BASE . '/adb-reader-agent.log';

        return 'actual=$(sha256sum ' . $this->quoteDeviceShell($remote) . ' 2>/dev/null | cut -c 1-64 | tr ' . $this->quoteDeviceShell('[:lower:]') . ' ' . $this->quoteDeviceShell('[:upper:]') . '); '
            . 'if [ "$actual" != ' . $this->quoteDeviceShell($expectedHash) . ' ]; then '
            . 'printf ' . $this->quoteDeviceShell('{"success":false,"ready":false,"error":"Reader agent artifact hash mismatch"}\n') . '; exit 0; fi; '
            . 'if ! pm install -r -t ' . $this->quoteDeviceShell($remote) . ' >' . $this->quoteDeviceShell($installLog) . ' 2>&1; then '
            . 'printf ' . $this->quoteDeviceShell('{"success":false,"ready":false,"error":"Reader agent install failed"}\n') . '; exit 0; fi; '
            . 'am force-stop ' . $this->quoteDeviceShell($package) . ' >/dev/null 2>&1 || true; '
            . 'nohup am instrument -w -r ' . $this->quoteDeviceShell($instrumentation) . ' >' . $this->quoteDeviceShell($runtimeLog) . ' 2>&1 </dev/null & '
            . 'i=0; while [ "$i" -lt 10 ]; do '
            . 'pid=$(pidof ' . $this->quoteDeviceShell($package) . ' 2>/dev/null); '
            . 'if [ -n "$pid" ] && ss -ltn 2>/dev/null | grep -q ' . $this->quoteDeviceShell(':7923') . '; then '
            . 'printf ' . $this->quoteDeviceShell('{"success":true,"ready":true,"installed":true,"readerAgent":"running:%s"}\n') . ' "$pid"; exit 0; fi; '
            . 'sleep 1; i=$((i + 1)); done; '
            . 'printf ' . $this->quoteDeviceShell('{"success":false,"ready":false,"error":"Reader agent did not start"}\n');
    }

    private function quoteDeviceShell($value)
    {
        return "'" . str_replace("'", "'\"'\"'", (string)$value) . "'";
    }

    private function acquireDeviceLock($deviceId)
    {
        $path = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'shizuku-' . sha1($deviceId) . '.lock';
        $handle = fopen($path, 'c');
        if ($handle === false || !flock($handle, LOCK_EX | LOCK_NB)) {
            if (is_resource($handle)) {
                fclose($handle);
            }
            return false;
        }
        return $handle;
    }

    private function releaseDeviceLock($handle)
    {
        if (is_resource($handle)) {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}
