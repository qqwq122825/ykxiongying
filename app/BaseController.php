<?php
declare (strict_types = 1);

namespace app;

use think\App;
use think\exception\ValidateException;
use think\Validate;

/**
 * 控制器基础类
 */
abstract class BaseController
{
    /**
     * Request实例
     * @var \think\Request
     */
    protected $request;

    /**
     * 应用实例
     * @var \think\App
     */
    protected $app;

    /**
     * 是否批量验证
     * @var bool
     */
    protected $batchValidate = false;

    /**
     * 控制器中间件
     * @var array
     */
    protected $middleware = [];

    /**
     * 构造方法
     * @access public
     * @param  App  $app  应用对象
     */
    public function __construct(App $app)
    {
        $this->app     = $app;
        $this->request = $this->app->request;

        // 控制器初始化
        $this->initialize();
    }

    // 初始化
    protected function initialize()
    {}

    /**
     * 验证数据
     * @access protected
     * @param  array        $data     数据
     * @param  string|array $validate 验证器名或者验证规则数组
     * @param  array        $message  提示信息
     * @param  bool         $batch    是否批量验证
     * @return array|string|true
     * @throws ValidateException
     */
    protected function validate(array $data, string|array $validate, array $message = [], bool $batch = false)
    {
        if (is_array($validate)) {
            $v = new Validate();
            $v->rule($validate);
        } else {
            if (strpos($validate, '.')) {
                // 支持场景
                [$validate, $scene] = explode('.', $validate);
            }
            $class = false !== strpos($validate, '\\') ? $validate : $this->app->parseClass('validate', $validate);
            $v     = new $class();
            if (!empty($scene)) {
                $v->scene($scene);
            }
        }

        $v->message($message);

        // 是否批量验证
        if ($batch || $this->batchValidate) {
            $v->batch(true);
        }

        return $v->failException(true)->check($data);
    }

    /**
     * 广播消息到 Node.js WS 服务（非阻塞）
     * 用于通知前端设备状态变化
     */
    protected static function broadcastToAdmins(array $msg): void
    {
        try {
            $ch = curl_init(self::wsBaseUrl() . '/internal/broadcast');
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => json_encode($msg, JSON_UNESCAPED_UNICODE),
                CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT_MS     => 200, // 200ms 超时，不阻塞主请求
                CURLOPT_NOSIGNAL       => 1,
            ]);
            curl_exec($ch);
            curl_close($ch);
        } catch (\Throwable $e) {
            // 静默失败，不影响主逻辑
        }
    }

    /**
     * 将全局设备策略发送给当前在线的 APK 设备连接。
     * Node WS 仅监听本机回环地址，失败时不阻塞当前 PHP 请求。
     */
    protected static function pushDeviceCommand(string $command, array $params = []): bool
    {
        try {
            $ch = curl_init(self::wsBaseUrl() . '/internal/device-command');
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => json_encode([
                    'broadcast' => true,
                    'command' => $command,
                    'params' => $params,
                ], JSON_UNESCAPED_UNICODE),
                CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT_MS     => 1200,
                CURLOPT_NOSIGNAL       => 1,
            ]);
            $body = curl_exec($ch);
            $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            return $body !== false && $status >= 200 && $status < 300;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * 获取 Node.js WS 服务的基础地址
     * 从 .env 中 [WS_SERVER] 节读取
     */
    protected static function wsBaseUrl(): string
    {
        $host = env('ws_server.ws_host', '127.0.0.1');
        $port = env('ws_server.ws_port', '8889');
        return "http://{$host}:{$port}";
    }
}
