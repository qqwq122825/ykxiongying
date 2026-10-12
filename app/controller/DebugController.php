<?php
namespace app\controller;

use app\BaseController;
use think\facade\Db;
use think\facade\Request;

class DebugController extends BaseController
{
    private const ENABLE_KEY = 'onboarding_debug_enabled';
    private const SESSION_KEY = 'onboarding_debug_session_id';
    private const STARTED_KEY = 'onboarding_debug_started_at';

    private function requireSuperAdmin()
    {
        $user = request()->user ?? [];
        if (!in_array($user['role'] ?? '', ['superadmin', 'super-admin'], true)) {
            return json(['success' => false, 'message' => '需要 superadmin 权限'], 403);
        }
        return null;
    }

    private static function ensureStorage(): void
    {
        Db::execute("CREATE TABLE IF NOT EXISTS `fisher_debug_events` (
          `id` bigint unsigned NOT NULL AUTO_INCREMENT,
          `session_id` varchar(64) NOT NULL DEFAULT '',
          `source` varchar(32) NOT NULL DEFAULT '',
          `stage` varchar(96) NOT NULL DEFAULT '',
          `level` varchar(16) NOT NULL DEFAULT 'info',
          `device_id` varchar(128) NOT NULL DEFAULT '',
          `event_time` bigint unsigned NOT NULL DEFAULT '0',
          `details_json` longtext,
          `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (`id`),
          KEY `idx_session_id` (`session_id`,`id`),
          KEY `idx_device_id` (`device_id`,`id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    }

    private static function setting(string $key, string $default = ''): string
    {
        try {
            $value = Db::table('fisher_settings')->where('key', $key)->value('value');
            return $value === null ? $default : (string)$value;
        } catch (\Throwable $e) {
            return $default;
        }
    }

    private static function setSetting(string $key, string $value): void
    {
        $now = time();
        Db::execute(
            "INSERT INTO fisher_settings (`key`,`value`,`created_at`,`updated_at`) VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE `value`=VALUES(`value`), `updated_at`=VALUES(`updated_at`)",
            [$key, $value, $now, $now]
        );
    }

    private static function scrub($value, int $depth = 0)
    {
        if ($depth > 5) return '[depth-limited]';
        if (!is_array($value)) {
            if (is_string($value) && strlen($value) > 1000) return substr($value, 0, 1000) . '…';
            return $value;
        }
        $out = [];
        foreach ($value as $key => $item) {
            if (preg_match('/password|passwd|pwd|token|secret|cookie|authorization|html/i', (string)$key)) {
                $out[$key] = '[redacted]';
            } else {
                $out[$key] = self::scrub($item, $depth + 1);
            }
        }
        return $out;
    }

    public static function recordEvent(string $source, string $stage, string $deviceId = '', array $details = [], string $level = 'info'): void
    {
        try {
            if (self::setting(self::ENABLE_KEY, '0') !== '1') return;
            self::ensureStorage();
            $sessionId = self::setting(self::SESSION_KEY, '');
            Db::table('fisher_debug_events')->insert([
                'session_id' => $sessionId,
                'source' => substr($source, 0, 32),
                'stage' => substr($stage, 0, 96),
                'level' => substr($level, 0, 16),
                'device_id' => substr($deviceId, 0, 128),
                'event_time' => (int)round(microtime(true) * 1000),
                'details_json' => json_encode(self::scrub($details), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'created_at' => date('Y-m-d H:i:s'),
            ]);
        } catch (\Throwable $e) {
            error_log('[OnboardingDebug] record failed: ' . $e->getMessage());
        }
    }

    public function onboarding()
    {
        if ($denied = $this->requireSuperAdmin()) return $denied;
        self::ensureStorage();

        if (Request::isPost()) {
            $data = Request::post();
            $enabled = !empty($data['enabled']);
            if ($enabled) {
                $sessionId = date('Ymd_His') . '_' . bin2hex(random_bytes(4));
                if (!empty($data['reset'])) Db::table('fisher_debug_events')->delete(true);
                self::setSetting(self::SESSION_KEY, $sessionId);
                self::setSetting(self::STARTED_KEY, (string)time());
                self::setSetting(self::ENABLE_KEY, '1');
                self::recordEvent('php', 'debug.session.started', '', ['actor' => (request()->user['username'] ?? '')]);
            } else {
                self::recordEvent('php', 'debug.session.stopped', '', ['actor' => (request()->user['username'] ?? '')]);
                self::setSetting(self::ENABLE_KEY, '0');
            }
        } elseif (Request::isDelete()) {
            Db::table('fisher_debug_events')->delete(true);
        }

        $enabled = self::setting(self::ENABLE_KEY, '0') === '1';
        $sessionId = self::setting(self::SESSION_KEY, '');
        $startedAt = (int)self::setting(self::STARTED_KEY, '0');
        $afterId = max(0, (int)Request::get('afterId', 0));
        $limit = min(5000, max(1, (int)Request::get('limit', 2000)));
        $query = Db::table('fisher_debug_events');
        if ($sessionId !== '') $query->where('session_id', $sessionId);
        if ($afterId > 0) $query->where('id', '>', $afterId);
        $rows = $query->order('event_time', 'asc')->order('id', 'asc')->limit($limit)->select()->toArray();
        $events = array_map(function ($row) {
            return [
                'id' => (int)$row['id'],
                'sessionId' => $row['session_id'],
                'source' => $row['source'],
                'stage' => $row['stage'],
                'level' => $row['level'],
                'deviceId' => $row['device_id'],
                'timestamp' => (int)$row['event_time'],
                'details' => json_decode($row['details_json'] ?: '{}', true) ?: [],
            ];
        }, $rows);

        return json(['success' => true, 'data' => [
            'enabled' => $enabled,
            'sessionId' => $sessionId,
            'startedAt' => $startedAt,
            'events' => $events,
            'count' => count($events),
        ]]);
    }
}
