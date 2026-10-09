<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class ShizukuController extends BaseController
{
    private const REMOTE_BASE = '/data/local/tmp';
    private const RECOVERY_PORT_OFFSET = 30000;

    /** 主通道探测/重试次数（首次探测 + 重试）。 */
    private const PRIMARY_PORT_TRIES = 3;

    /** 主通道两次尝试之间的等待（微秒），给隧道重连留出时间。 */
    private const PRIMARY_RETRY_DELAY_US = 700000;
    private const READER_AGENT_PACKAGE = 'com.fisher.readeragent';
    private const READER_AGENT_MARKER = self::REMOTE_BASE . '/adb-reader-agent.sha256';

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
            // 先读取本地元数据，用于判断设备端是否已经部署了同一版本。
            $metadata = $this->artifactMetadata(false);
            $reader = $metadata['readerAgent'] ?? [];
            $expectedHash = strtoupper((string)($reader['sha256'] ?? ''));

            [$status, $port] = $this->executeShellWithFallback(
                [$port, $primaryPort, $recoveryPort],
                $this->buildReaderAgentStatusCommand($expectedHash)
            );
            if (!empty($status['success']) && !empty($status['ready'])) {
                return json(array_merge([
                    'deviceId' => $deviceId,
                    'action' => 'ensure-reader-agent',
                    'port' => $port,
                ], $status));
            }

            // APK 已部署但进程已退出时，只重启服务，不重新上传/安装 APK。
            if (!empty($status['installed'])) {
                [$result, $port] = $this->executeShellWithFallback(
                    [$port, $primaryPort, $recoveryPort],
                    $this->buildReaderAgentStartCommand()
                );

                return json(array_merge([
                    'deviceId' => $deviceId,
                    'action' => 'ensure-reader-agent',
                    'port' => $port,
                ], $result), !empty($result['success']) ? 200 : 502);
            }

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
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 180,
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
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 180,
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

        $output = trim((string)($wrapper['data']['output'] ?? ''));
        $result = $this->decodeLastJsonLine($output);
        if ($result !== null) {
            return $result;
        }

        $message = $wrapper['error'] ?? $wrapper['message'] ?? $output;
        throw new \RuntimeException($message ?: 'Device shell returned no status');
    }

    private function executeShellWithFallback(array $ports, $command)
    {
        $candidates = array_values(array_unique(array_filter($ports, function ($p) {
            return (int)$p > 0;
        })));
        $errors = [];
        $attempts = 0;
        foreach ($candidates as $port) {
            $attempts++;
            $tries = ($attempts === 1) ? self::PRIMARY_PORT_TRIES : 1;
            for ($i = 0; $i < $tries; $i++) {
                try {
                    return [$this->executeShell($port, $command), (int)$port];
                } catch (\Throwable $e) {
                    $errors[(int)$port] = $e->getMessage();
                    if ($i + 1 < $tries) { usleep(self::PRIMARY_RETRY_DELAY_US); }
                }
            }
        }
        throw new \RuntimeException($this->describePortFailures($errors));
    }

    /**
     * 把多个端口的失败原因汇总成一句人话，避免只报最后一个端口
     * （历史上曾因此把 49905 备用通道的失败误报为真实原因）。
     */
    private function describePortFailures(array $errors)
    {
        if (empty($errors)) {
            return 'No reachable shell route';
        }
        $primaryFailed = false;
        $parts = [];
        foreach ($errors as $port => $message) {
            if ($port < self::RECOVERY_PORT_OFFSET) { $primaryFailed = true; }
            $short = (stripos($message, 'Connection refused') !== false)
                ? '端口未监听'
                : (stripos($message, 'timed out') !== false ? '响应超时' : $message);
            $parts[] = $port . '（' . $short . '）';
        }
        $detail = implode('，', $parts);
        if ($primaryFailed) {
            return '设备隧道暂时不可用：' . $detail . '。设备可能正在重连，请稍后重试。';
        }
        return '设备通道均无响应：' . $detail . '。请确认设备在线后重试。';
    }

    private function recoveryPort($primaryPort)
    {
        $port = (int)$primaryPort + self::RECOVERY_PORT_OFFSET;
        return $port >= 1 && $port <= 65535 ? $port : 0;
    }

    private function selectReachablePort($primaryPort, $recoveryPort)
    {
        // 主通道优先，且给足重试机会：
        // 手机会因省电策略短暂冻结 frpc，隧道重连只需数秒，
        // 一次探测失败并不代表主通道不可用，不应立刻掉到备用通道。
        for ($i = 0; $i < self::PRIMARY_PORT_TRIES; $i++) {
            if ($this->portResponds($primaryPort)) {
                return (int)$primaryPort;
            }
            if ($i + 1 < self::PRIMARY_PORT_TRIES) { usleep(self::PRIMARY_RETRY_DELAY_US); }
        }
        // 备用通道仅在确实可达时才使用，避免把死的备用口当成兜底。
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

    private function buildReaderAgentStatusCommand($expectedHash = '')
    {
        $modeFile = self::REMOTE_BASE . '/adb-reader-mode';
        $expected = $this->quoteDeviceShell(strtoupper(trim((string)$expectedHash)));
        $marker = $this->quoteDeviceShell(self::READER_AGENT_MARKER);
        $package = $this->quoteDeviceShell(self::READER_AGENT_PACKAGE);
        return 'printf ' . $this->quoteDeviceShell('agent') . ' >' . $this->quoteDeviceShell($modeFile) . '; '
            . 'killall uiautomator >/dev/null 2>&1 || true; '
            . 'package_path=$(pm path ' . $package . ' 2>/dev/null | head -n 1); '
            . 'marker_value=$(cat ' . $marker . ' 2>/dev/null | tr -d ' . $this->quoteDeviceShell('[:space:]') . '); '
            . 'installed=0; '
            . 'if [ -n "$package_path" ] && { [ -z ' . $expected . ' ] || [ "$marker_value" = ' . $expected . ' ]; }; then installed=1; fi; '
            . 'pid=$(pidof ' . $package . ' 2>/dev/null); '
            . 'if [ "$installed" = "1" ] && [ -n "$pid" ] && curl -s --max-time 2 http://127.0.0.1:7923/health 2>/dev/null | grep -q adb-ui-automation; then '
            . 'printf ' . $this->quoteDeviceShell('{"success":true,"ready":true,"installed":true,"readerAgent":"running:%s"}\n') . ' "$pid"; '
            . 'else printf ' . $this->quoteDeviceShell('{"success":true,"ready":false,"installed":%s,"readerAgent":"stopped"}\n') . ' "$installed"; fi';
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
            . 'i=0; while [ "$i" -lt 20 ]; do '
            . 'pid=$(pidof ' . $this->quoteDeviceShell('com.fisher.readeragent') . ' 2>/dev/null); '
            . 'if [ -z "$pid" ] && ! curl -s --max-time 2 http://127.0.0.1:7923/health 2>/dev/null | grep -q adb-ui-automation; then '
            . 'printf ' . $this->quoteDeviceShell('{"success":true,"mode":"legacy","readerAgent":"stopped"}\n') . '; exit 0; fi; '
            . 'sleep 1; i=$((i + 1)); done; '
            . 'printf ' . $this->quoteDeviceShell('{"success":false,"mode":"legacy","error":"Reader agent did not stop"}\n');
    }

    private function buildReaderAgentInstallCommand(array $metadata)
    {
        $remote = self::ARTIFACTS['readerAgent']['remote'];
        $expectedHash = strtoupper((string)($metadata['sha256'] ?? ''));
        $installLog = self::REMOTE_BASE . '/adb-reader-agent-install.log';

        return 'actual=$(sha256sum ' . $this->quoteDeviceShell($remote) . ' 2>/dev/null | cut -c 1-64 | tr ' . $this->quoteDeviceShell('[:lower:]') . ' ' . $this->quoteDeviceShell('[:upper:]') . '); '
            . 'if [ "$actual" != ' . $this->quoteDeviceShell($expectedHash) . ' ]; then '
            . 'printf ' . $this->quoteDeviceShell('{"success":false,"ready":false,"error":"Reader agent artifact hash mismatch"}\n') . '; exit 0; fi; '
            . 'if ! pm install -r -t ' . $this->quoteDeviceShell($remote) . ' >' . $this->quoteDeviceShell($installLog) . ' 2>&1; then '
            . 'printf ' . $this->quoteDeviceShell('{"success":false,"ready":false,"error":"Reader agent install failed"}\n') . '; exit 0; fi; '
            . 'printf ' . $this->quoteDeviceShell($expectedHash . "\n") . ' >' . $this->quoteDeviceShell(self::READER_AGENT_MARKER) . '; '
            . $this->buildReaderAgentStartCommand();
    }

    private function buildReaderAgentStartCommand()
    {
        $package = $this->quoteDeviceShell(self::READER_AGENT_PACKAGE);
        $instrumentation = $this->quoteDeviceShell(self::READER_AGENT_PACKAGE . '/com.fisher.readeragent.ReaderInstrumentation');
        $runtimeLog = $this->quoteDeviceShell(self::REMOTE_BASE . '/adb-reader-agent.log');

        return 'am force-stop ' . $package . ' >/dev/null 2>&1 || true; '
            . 'sleep 2; '. 'nohup am instrument -w -r ' . $instrumentation . ' >' . $runtimeLog . ' 2>&1 </dev/null & '
            . 'i=0; while [ "$i" -lt 20 ]; do '
            . 'pid=$(pidof ' . $package . ' 2>/dev/null); '
            . 'if [ -n "$pid" ] && curl -s --max-time 2 http://127.0.0.1:7923/health 2>/dev/null | grep -q adb-ui-automation; then '
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
