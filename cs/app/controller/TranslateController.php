<?php
namespace app\controller;

use app\BaseController;
use think\facade\Request;

class TranslateController extends BaseController
{
    private const DEFAULT_TARGET = 'ZH-HANS';
    private const CACHE_TTL = 2592000;
    private bool $tlsVerificationUnavailable = false;

    /** POST /api/translate */
    public function translate()
    {
        $data = $this->inputData();
        $texts = $data['texts'] ?? [];
        $target = $this->normalizeTarget((string)($data['targetLang'] ?? $data['targetLanguage'] ?? $data['target_language'] ?? $data['target'] ?? self::DEFAULT_TARGET));

        if (!is_array($texts)) $texts = [$texts];
        if (!$texts) {
            $text = trim((string)($data['text'] ?? ''));
            if ($text !== '') $texts = [$text];
        }
        if (!$texts) {
            return json(['success' => true, 'translated' => [], 'data' => ['translations' => []], 'message' => 'success']);
        }

        $config = $this->loadConfig();
        if (empty($config['endpoint'])) {
            return json(['success' => false, 'translated' => [], 'message' => '请先在系统设置中配置 DeepLX 接口'], 503);
        }

        $result = array_fill(0, count($texts), '');
        $pending = [];
        foreach ($texts as $index => $value) {
            $text = trim((string)$value);
            $result[$index] = $text;
            if ($text === '' || $this->shouldKeepOriginal($text)) continue;
            $key = hash('sha256', $target . "\n" . $text);
            $cached = $this->readCache($key);
            if ($cached !== null) {
                $result[$index] = $cached;
                continue;
            }
            $pending[$key]['text'] = $text;
            $pending[$key]['indexes'][] = $index;
        }

        $failed = 0;
        $failedGroups = 0;
        foreach ($pending as $key => $item) {
            [$translated, $ok] = $this->deepLxTranslate($config['endpoint'], $item['text'], $target);
            if ($ok) {
                $this->writeCache($key, $translated);
                foreach ($item['indexes'] as $index) $result[$index] = $translated;
            } else {
                $failed += count($item['indexes']);
                $failedGroups++;
            }
        }

        $total = count($texts);
        if ($failedGroups === count($pending) && count($pending) > 0) {
            return json([
                'success' => false,
                'translated' => $result,
                'data' => ['translations' => $result],
                'failed' => $failed,
                'message' => 'DeepLX 翻译服务不可用，请检查接口地址或额度',
            ], 502);
        }
        return json([
            'success' => true,
            'translated' => $result,
            'data' => ['translations' => $result],
            'failed' => $failed,
            'message' => $failed ? "部分文本翻译失败（{$failed}/{$total}）" : 'success',
        ]);
    }

    /** GET /api/translate/config */
    public function getConfig()
    {
        if (!$this->isAdminAccount()) return $this->adminOnly();
        $config = $this->loadConfig();
        return json([
            'success' => true,
            'data' => [
                'configured' => !empty($config['endpoint']),
                'endpoint_masked' => $this->maskEndpoint((string)($config['endpoint'] ?? '')),
                'status' => !empty($config['endpoint']) ? '已配置' : '未配置',
            ],
        ]);
    }

    /** PUT /api/translate/config */
    public function saveConfig()
    {
        if (!$this->isAdminAccount()) return $this->adminOnly();
        $data = $this->inputData();
        $endpoint = $this->normalizeEndpoint((string)($data['endpoint'] ?? ''));
        if ($endpoint === '') return json(['success' => false, 'message' => 'DeepLX 接口地址格式错误'], 400);

        [, $ok, $message] = $this->deepLxTranslate($endpoint, 'Hello', self::DEFAULT_TARGET);
        if (!$ok) return json(['success' => false, 'message' => '接口测试失败，未保存：' . $message], 502);

        if (!$this->saveConfigFile(['provider' => 'deeplx', 'endpoint' => $endpoint, 'updated_at' => date('Y-m-d H:i:s')])) {
            return json(['success' => false, 'message' => '配置文件写入失败，请检查 runtime 目录权限'], 500);
        }
        return json([
            'success' => true,
            'message' => 'DeepLX 配置已保存',
            'data' => ['endpoint_masked' => $this->maskEndpoint($endpoint)],
        ]);
    }

    /** POST /api/translate/config/test */
    public function testConfig()
    {
        if (!$this->isAdminAccount()) return $this->adminOnly();
        $data = $this->inputData();
        $endpoint = $this->normalizeEndpoint((string)($data['endpoint'] ?? ''));
        if ($endpoint === '') $endpoint = (string)($this->loadConfig()['endpoint'] ?? '');
        if ($endpoint === '') return json(['success' => false, 'message' => '请先输入 DeepLX 完整接口地址'], 400);

        [$translated, $ok, $message] = $this->deepLxTranslate($endpoint, 'Hello, this is a DeepLX connection test.', self::DEFAULT_TARGET);
        if (!$ok) return json(['success' => false, 'message' => 'DeepLX 接口测试失败：' . $message], 502);
        return json(['success' => true, 'message' => '接口正常，测试结果：' . $translated]);
    }

    private function deepLxTranslate(string $endpoint, string $text, string $target): array
    {
        $lastMessage = '未知错误';
        for ($attempt = 0; $attempt < 3; $attempt++) {
            $payload = json_encode([
                'text' => $text,
                'source_lang' => 'auto',
                'target_lang' => $target,
            ], JSON_UNESCAPED_UNICODE);
            $verifyTls = !$this->tlsVerificationUnavailable;
            [$response, $httpCode, $curlError, $curlErrno] = $this->requestDeepLx($endpoint, $payload, $verifyTls);

            // Windows PHP installations without curl.cainfo cannot verify any HTTPS host.
            // Retry only this configured endpoint when cURL reports the missing CA bundle error.
            if ($verifyTls && $curlErrno === 60) {
                $this->tlsVerificationUnavailable = true;
                [$response, $httpCode, $curlError] = $this->requestDeepLx($endpoint, $payload, false);
            }

            if ($curlError !== '') {
                $lastMessage = $curlError;
            } else {
                $body = json_decode((string)$response, true);
                $translated = is_array($body) ? trim((string)($body['data'] ?? '')) : '';
                $apiCode = is_array($body) ? (int)($body['code'] ?? 0) : 0;
                if ($httpCode >= 200 && $httpCode < 300 && $apiCode === 200 && $translated !== '') return [$translated, true, ''];
                $lastMessage = is_array($body) ? (string)($body['message'] ?? $body['error'] ?? ('HTTP ' . $httpCode)) : ('HTTP ' . $httpCode);
                if ($httpCode !== 429 && $httpCode < 500) break;
            }
            if ($attempt < 2) usleep((int)(500000 * (2 ** $attempt)));
        }
        return [$text, false, $lastMessage];
    }

    private function requestDeepLx(string $endpoint, string $payload, bool $verifyTls): array
    {
        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_SSL_VERIFYPEER => $verifyTls,
            CURLOPT_SSL_VERIFYHOST => $verifyTls ? 2 : 0,
        ]);
        $response = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        $curlErrno = curl_errno($ch);
        curl_close($ch);
        return [$response, $httpCode, $curlError, $curlErrno];
    }

    private function loadConfig(): array
    {
        $path = $this->configPath();
        if (is_file($path)) {
            $data = json_decode((string)@file_get_contents($path), true);
            if (is_array($data) && !empty($data['endpoint'])) return $data;
        }
        $envEndpoint = trim((string)env('external.deeplx_translate_url', ''));
        return $envEndpoint !== '' ? ['provider' => 'deeplx', 'endpoint' => $envEndpoint] : [];
    }

    private function inputData(): array
    {
        $raw = file_get_contents('php://input');
        $data = $raw ? json_decode($raw, true) : null;
        if (is_array($data)) return $data;
        $data = Request::post();
        return is_array($data) ? $data : [];
    }

    private function saveConfigFile(array $config): bool
    {
        $dir = dirname($this->configPath());
        if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) return false;
        return @file_put_contents(
            $this->configPath(),
            json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT),
            LOCK_EX
        ) !== false;
    }

    private function configPath(): string
    {
        return runtime_path() . 'translate_config.json';
    }

    private function cachePath(string $key): string
    {
        $dir = runtime_path() . 'translate_cache' . DIRECTORY_SEPARATOR;
        if (!is_dir($dir)) @mkdir($dir, 0750, true);
        return $dir . $key . '.json';
    }

    private function readCache(string $key): ?string
    {
        $path = $this->cachePath($key);
        if (!is_file($path) || (filemtime($path) ?: 0) + self::CACHE_TTL < time()) return null;
        $data = json_decode((string)@file_get_contents($path), true);
        return is_array($data) && isset($data['text']) ? (string)$data['text'] : null;
    }

    private function writeCache(string $key, string $text): void
    {
        @file_put_contents($this->cachePath($key), json_encode(['text' => $text, 'created_at' => date('c')], JSON_UNESCAPED_UNICODE), LOCK_EX);
    }

    private function normalizeEndpoint(string $endpoint): string
    {
        $endpoint = trim($endpoint);
        if ($endpoint === '' || !preg_match('#^https://#i', $endpoint)) return '';
        $parts = parse_url($endpoint);
        if (!$parts || empty($parts['host']) || stripos((string)($parts['path'] ?? ''), '/translate/') === false) return '';
        return rtrim($endpoint, '/');
    }

    private function normalizeTarget(string $target): string
    {
        $target = strtoupper(trim($target));
        return in_array($target, ['ZH', 'ZH-CN', 'ZH-HANS'], true) ? self::DEFAULT_TARGET : ($target ?: self::DEFAULT_TARGET);
    }

    private function shouldKeepOriginal(string $text): bool
    {
        return preg_match('/^(https?:\/\/|www\.|[a-zA-Z0-9_.-]+\.[a-zA-Z]{2,}\/|[0-9\s._:+()\-\/]+$)/', $text) === 1;
    }

    private function maskEndpoint(string $endpoint): string
    {
        if ($endpoint === '') return '';
        $pos = stripos($endpoint, '/translate/');
        if ($pos === false) return '已配置';
        $prefix = substr($endpoint, 0, $pos + 11);
        $key = substr($endpoint, $pos + 11);
        if (strlen($key) <= 8) return $prefix . str_repeat('*', strlen($key));
        return $prefix . substr($key, 0, 3) . '***' . substr($key, -4);
    }

    private function isAdminAccount(): bool
    {
        $user = $this->request->user ?? null;
        return is_array($user) && ($user['username'] ?? '') === 'admin';
    }

    private function adminOnly()
    {
        return json(['success' => false, 'message' => '仅 admin 账号可修改 DeepLX 配置'], 403);
    }
}
