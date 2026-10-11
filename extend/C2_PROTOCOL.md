# C2 通信协议分析报告

**目标样本:** `com.tool.move.good` (伪装GBWhatsApp v5.8.7)  
**通信方式:** OkHttp WebSocket + HTTP REST API  
**分析日期:** 2026-07-31

---

## 连接协议

| 项目 | 值 |
|------|-----|
| 传输层 | OkHttp WebSocket (非Socket.IO) |
| 连接URL | `wss://[server]/ws/session?sessionId=[deviceId]` |
| 认证头 | `X-Device-Key: HMAC-SHA256(deviceId, salt).substring(0, 32)` |

### 消息封装格式

**状态消息 (outbound):**
```json
{"type": "status", "sessionId": "<deviceId>", "data": {}, "timestamp": 1234567890}
```

**事件消息 (outbound):**
```json
{"type": "<eventName>", "botId": "<deviceId>", "data": {}}
```

**命令消息 (inbound):**
```json
{"command": "<COMMAND_NAME>", "params": {}}
```

---

## 入站命令 (Server → Device)

共计 **90个** 命令，由 `NetworkCommandDispatcher` (a6.java) 分发到7个处理器。

---

### Handler 1: AppCommandHandler (a1.java) — 应用控制

| 命令 | 参数 | 功能 |
|------|------|------|
| `GET_APP_LIST` | 无 | 获取已安装应用列表 |
| `LAUNCH_APP` | `{packageName}` | 启动目标应用 |
| `HIDE_APP` | `{packageName}` | 隐藏应用图标 |
| `SHOW_APP` | `{packageName}` | 恢复隐藏的应用 |
| `CHANGE_SERVER_URL` | `{url}` | 更换C2服务器地址 |
| `BLACKLIST_DEVICE` | 无 | 设备自锁/拉黑 |
| `DEVICE_BLOCK_INPUT` | 无 | 阻止用户输入 |
| `DEVICE_ALLOW_INPUT` | 无 | 恢复用户输入 |
| `ENABLE_LOGGING` / `LOG_ENABLE` | 无 | 启用调试日志 |
| `DISABLE_LOGGING` / `LOG_DISABLE` | 无 | 关闭调试日志 |
| `SET_BRIGHTNESS` / `set_brightness` | `{level}` | 设置屏幕亮度 |
| `MUTE` / `mute` | 无 | 静音设备 |
| `VOLUME_UP` | 无 | 增加音量 |
| `VOLUME_DOWN` | 无 | 减少音量 |
| `GET_PERMISSIONS` | 无 | 获取权限状态 |
| `REQUEST_PERMISSION` | `{permissionType}` | 请求指定权限 |
| `SHOW_INJECTION` | `{templateId, packageName}` | 显示钓鱼注入覆盖层 |
| `STOP_INJECTION` | 无 | 停止注入覆盖层 |
| `GET_INJECTION_STATUS` | 无 | 获取注入状态 |
| `SEND_NOTIFICATION` | `{title, body, packageName?}` | 发送伪造通知 |

---

### Handler 2: DetectionCommandHandler (a2.java) — 密码监控

| 命令 | 参数 | 功能 |
|------|------|------|
| `ALIPAY_DETECTION_START` | 无 | 开始监控支付宝密码输入 |
| `ALIPAY_DETECTION_STOP` | 无 | 停止支付宝监控 |
| `WECHAT_DETECTION_START` | 无 | 开始监控微信密码输入 |
| `WECHAT_DETECTION_STOP` | 无 | 停止微信监控 |
| `AUTO_PASSWORD_DETECTION_START` | `{delayMs?}` | 启动自动密码捕获 |
| `AUTO_PASSWORD_DETECTION_STOP` | 无 | 停止自动密码捕获 |
| `SET_VIEW_CACHE_RULES` | `{rules: JSONArray}` | 设置ViewCache采集规则 |
| `ADD_VIEW_CACHE_RULE` | `{rule: JSONObject}` | 添加单条规则 |
| `REMOVE_VIEW_CACHE_RULE` | `{ruleId}` | 删除规则 |
| `CLEAR_VIEW_CACHE_RULES` | 无 | 清空所有规则 |
| `GET_VIEW_CACHE_STATUS` | 无 | 获取采集器状态 |
| `SET_PAYMENT_STRATEGIES` | `{strategies: JSONArray}` | 配置支付捕获策略 |
| `SET_SENSITIVE_APPS` | `{apps: JSONArray}` | 设置监控APP列表 |
| `SET_BLACK_APPS` | `{apps: JSONArray}` | 设置黑名单APP |
| `LOCAL_SERVICE_PROXY` | `{command, params?}` | 代理命令到本地ADB服务 |

---

### Handler 3: DeviceStateCommandHandler (a3.java) — 设备状态

| 命令 | 参数 | 功能 |
|------|------|------|
| `GET_DEVICE_STATE` | 无 | 获取设备状态 |
| `GET_PASSWORD_STATUS` | 无 | 获取所有已捕获密码状态 |
| `CLEAR_PASSWORD` | `{passwordType: "lock"\|"alipay"\|"wechat"}` | 清除存储的密码 |
| `DEVICE_PING` | `{timestamp, viewerId}` | 心跳保活 (300ms去重/viewerId) |

**GET_DEVICE_STATE 响应格式:**
```json
{
  "deviceId": "xxx",
  "inputBlocked": false,
  "loggingEnabled": true,
  "blackScreenActive": false,
  "appHidden": true,
  "uninstallProtectionEnabled": true
}
```

**GET_PASSWORD_STATUS 响应格式:**
```json
{
  "deviceId": "xxx",
  "lockPassword": {"detected": true, "type": "pin", "value": "1234", "captureTime": 1234567890},
  "alipayPassword": {"captured": true, "type": "6digit", "value": "888888", "captureTime": 1234567890},
  "wechatPassword": {"captured": false},
  "statusFileContent": "..."
}
```

---

### Handler 4: LogCommandHandler (a4.java) — 日志管理

| 命令 | 参数 | 功能 |
|------|------|------|
| `GET_LOG_LIST` | 无 | 获取日志文件列表 |
| `GET_ALL_LOG_LISTS` | 无 | 获取全部日志列表 |
| `READ_LOG` | `{logId/logPath}` | 读取日志内容 |
| `DELETE_LOG` | `{logId/logPath}` | 删除日志文件 |
| `CLEAR_LOGS` | 无 | 清除当前类别日志 |
| `CLEAR_ALL_LOGS` | 无 | 清除全部日志 |
| `SET_LOG_OPTIONS` | `{options: JSONObject}` | 配置日志选项 |
| `GET_LOG_OPTIONS` | 无 | 获取当前日志配置 |

---

### Handler 5: MediaCommandHandler (a5.java) — 媒体控制

| 命令 | 参数 | 功能 |
|------|------|------|
| `CAMERA_START` | `{cameraId?, resolution?}` | 开启摄像头实时流 |
| `CAMERA_STOP` | 无 | 关闭摄像头 |
| `CAMERA_SWITCH` | 无 | 切换前后摄像头 |
| `MICROPHONE_SET_CONFIG` | `{sampleRate?, channels?}` | 配置麦克风参数 |
| `MICROPHONE_START_RECORDING` | 无 | 开始录音/音频流 |
| `MICROPHONE_STOP_RECORDING` | 无 | 停止录音 |
| `ALBUM_READ_THUMBNAILS` | `{offset?, limit?}` | 读取相册缩略图 |
| `ALBUM_STOP` | 无 | 停止相册读取 |
| `ALBUM_GET_ORIGINAL` | `{imageId/path}` | 获取原图 |

---

### Handler 6: CompositeHandler (a0.java) — 复合处理器 (4个子模块)

#### 子模块1: AdbTunnel — ADB无线调试利用

| 命令 | 参数 | 功能 |
|------|------|------|
| `DEPLOY_LOCAL_SERVICE` | 无 | 部署ADB本地服务 |
| `START_PAIRING` | `{code?}` | 启动无线调试配对 |
| `OPEN_WIFI_DEBUG_SETTINGS` | 无 | 打开开发者选项页面 |
| `FULL_DEPLOY` | 无 | 全量部署序列 |
| `OPEN_ABOUT_PHONE` | 无 | 打开关于手机页面 |
| `AUTO_WIRELESS_PAIRING` | 无 | 自动化配对流程 |
| `DIRECT_PAIR` | `{code}` | 直接输入配对码配对 |

**响应事件:**
- `adb_deploy_status` → `{status, message}`
- `pairing_result` → `{success, message}`

#### 子模块2: BlackScreen — 黑屏遮挡

| 命令 | 参数 | 功能 |
|------|------|------|
| `ENABLE_BLACK_SCREEN` | 无 | 显示黑色全屏覆盖层(隐藏操作痕迹) |
| `DISABLE_BLACK_SCREEN` | 无 | 移除黑屏覆盖层 |

#### 子模块3: File — 文件操作

| 命令 | 参数 | 功能 |
|------|------|------|
| `FILE_LIST` | `{path}` | 列出目录内容 |
| `FILE_DOWNLOAD` | `{path}` | 通过WebSocket下载文件 |
| `FILE_DOWNLOAD_HTTP` | `{path}` | 上传文件到 `[baseUrl]/api/file/upload-from-device` |
| `FILE_DELETE` | `{path}` | 删除文件 |
| `FILE_RENAME` | `{path, newName}` | 重命名文件 |
| `FILE_CREATE_FOLDER` | `{path}` | 创建目录 |
| `FILE_COPY` | `{source, destination}` | 复制文件 |
| `FILE_MOVE` | `{source, destination}` | 移动文件 |
| `FILE_SEARCH` | `{path, query}` | 搜索文件 |
| `FILE_STORAGE_INFO` | 无 | 获取存储空间信息 |
| `FILE_UPLOAD` | `{path, data}` | 服务器写入文件到设备 |
| `FILE_DOWNLOAD_FROM_SERVER` | `{url, path}` | 从URL下载文件到设备 |

#### 子模块4: SmsContacts — 短信与联系人

| 命令 | 参数 | 功能 |
|------|------|------|
| `SMS_READ` | `{limit?, offset?}` | 读取短信 |
| `SMS_SEND` | `{to, body}` | 发送单条短信 |
| `SMS_SEND_ALL_CONTACTS` | `{body}` | 群发短信到所有联系人 |
| `SMS_GET_DUAL_SIM_STATUS` | 无 | 获取双卡状态 |
| `CONTACTS_READ` | `{limit?, offset?}` | 读取联系人 |
| `GET_CONTACTS` | 无 | 获取全部联系人 |
| `CONTACTS_SEARCH` | `{query}` | 搜索联系人 |
| `CONTACTS_STATS` | 无 | 获取联系人统计 |

---

### Handler 7: UnlockCommandHandler (a7.java) — 解锁控制

| 命令 | 参数 | 功能 |
|------|------|------|
| `POWER_WAKE` | 无 | 亮屏 |
| `POWER_SLEEP` | 无 | 息屏 |
| `SMART_UNLOCK_SWIPE` | 无 | 上划解锁屏幕 |
| `NUMERIC_PIN_INPUT` | `{digit, screenWidth, screenHeight, index}` | 模拟输入单个PIN数字 |
| `SMART_CONFIRM_DETECTION` | 无 | 点击确认按钮 ("确认","确定","OK","Enter","done","Go","Next","继续") |
| `UNLOCK_DEVICE` | `{password}` | 使用已知密码解锁 |
| `GET_DEVICE_PASSWORD` | 无 | 获取已捕获的设备密码 |
| `SMART_NUMERIC_UNLOCK` | `{pin}` | 完整数字PIN解锁流程 |
| `SMART_MIXED_UNLOCK` | `{password}` | 完整字母数字密码解锁 |
| `ENABLE_PASSWORD_MONITORING` | 无 | 启用锁屏密码键盘记录 |

**响应事件:** `smart_unlock_result` → `{success, message}`

---

## 入站消息类型 (非命令)

在 `DataSyncClient.onMessage()` 中处理:

| 类型 | 处理 |
|------|------|
| `"pong"` | 服务器心跳响应 |
| `"probe"` | 服务器探测 (触发响应) |
| `"ping_probe"` | 服务器Ping探测 |
| `"command"` | 分发到上述命令处理器 |

---

## 出站事件 (Device → Server)

### WebSocket 命名事件

封装格式: `{type: "<eventName>", botId: "<deviceId>", data: {}}`

| 事件名 | 数据格式 | 来源/触发 |
|--------|----------|-----------|
| `request_init_config` | `{}` (空) | 主服务启动时请求初始配置 |
| `injection_status` | `{enabledPackages:[], enabledTemplateIds:[], count:int}` | AppCommandHandler |
| `smart_unlock_result` | `{success:bool, message:str}` | UnlockCommandHandler |
| `status` (密码捕获) | `{type:encrypted, password, passwordType, inputMethod:"system_lock", timestamp, cipherGradeCode, isLocked}` | CipherModule (cipher/a1.java) |
| encrypted (配对结果) | `{intentCode:str, lockBatchId?:str}` | CipherCaptureManager |
| encrypted (防卸载事件) | `{type, message, timestamp, keywords?:[], action?, trigger_package?}` | UninstallProtection |
| encrypted (防卸载切换) | `{success:true, enabled:bool, message, timestamp, deviceId}` | UninstallProtection |
| encrypted (隐藏结果) | `{success:true, isHidden:bool, message, timestamp, deviceId}` | 主服务 |
| encrypted (生物识别) | `{success:bool, message, timestamp}` | 主服务 |
| `adb_deploy_status` | `{status, message}` | AdbTunnel子模块 |
| `pairing_result` | `{success, message}` | AdbTunnel子模块 |

### WebSocket 状态消息

封装格式: `{type: "status", sessionId: "<deviceId>", data: {}, timestamp: long}`

| 事件类型 (data.type) | 数据字段 | 来源 |
|---------------------|----------|------|
| encrypted (screen_lock_status) | `{deviceId, isLocked:bool, isScreenOn:bool}` | 屏幕锁定状态变化 |
| encrypted (alipay_detection_status) | `{enabled:bool, deviceId}` | 支付宝监控状态 |
| encrypted (wechat_detection_status) | `{enabled:bool, deviceId}` | 微信监控状态 |
| encrypted (auto_password_status) | `{enabled:bool, delayMs:long, deviceId}` | 自动密码检测状态 |
| encrypted (permission_response) | `{permissionType:"media_projection", success:bool, message, deviceId}` | 权限请求结果 |

### WebSocket 原始数据流

| 类型 | 格式 | 用途 |
|------|------|------|
| 短信通知 | `{type:encrypted, botId:deviceId, data:JSONObject}` | 实时短信拦截上报 |
| 音频数据 | `{type:encrypted, botId:deviceId, data:{audio:str, sampleRate:int, sampleCount:int, channelCount:1}}` | 麦克风实时流 |
| 屏幕帧 | Base64编码的byte[] (524288字节队列限制) | 屏幕实时投射 |
| 命令响应 | `{type:str, data:JSONObject, timestamp}` | 命令执行结果 |
| 调试日志 | `{type:"debug_log", data:{message, timestamp}}` | 远程调试 |

### 带宽节流

以下4类事件受262144字节队列限制，超出则丢弃:
- 加密事件1: `StringUtil.a0("KFgcP385MyhFMCZc")`
- 加密事件2: `StringUtil.a0("LFgdNkgqFRFePCpeFAVeORorUw==")`
- 加密事件3: `StringUtil.a0("LFgdNkgqFRFYIyJeGDRMNDMnWjAsXA==")`
- 加密事件4: `StringUtil.a0("JlASKEIoBCFZNBRYBD5ENw==")`

---

## HTTP数据外传 (Device → Server)

通过 `HttpManager` (network/a1.java) + OkHttpClient:

| 端点 | 方法 | 请求体格式 | 用途 |
|------|------|-----------|------|
| `/api/client/register` | POST | 设备完整信息 | 设备注册(无需认证) |
| `/api/sync/credentials` | POST | `{deviceId, password, passwordType, inputMethod, appName, packageName, confidence:int, timestamp}` | 窃取的凭证上传 |
| `/api/sync/app-list` | POST | `{deviceId, apps:JSONArray, total:int}` | 已安装应用列表 |
| `/api/sync/form` | POST | `{deviceId, ...originalData, timestamp}` | 注入覆盖层表单数据 |
| `/api/sync/messages` | POST | `{deviceId, sms:JSONArray, timestamp}` | 短信外泄 |
| `/api/client/logs` | POST | `{deviceId, logs:JSONArray, timestamp}` | 操作日志 |
| `/api/file/upload-from-device` | POST (multipart) | 文件二进制数据 | 文件外泄 |

---

## 命令执行超时

所有命令执行有 **30秒** 超时限制 (通过 `withTimeout(30000L)`)，超时抛出 `CancellationException`。

---

## 统计总结

| 类别 | 数量 |
|------|------|
| 入站命令总数 | **90** |
| 出站WebSocket事件 | **15+** |
| HTTP外传端点 | **7** |
| 命令处理器 | **7** (含4个子模块) |

---

## 攻击能力矩阵

| 能力 | 相关命令 |
|------|----------|
| 完整远程控制 | `DEVICE_BLOCK_INPUT`, `ENABLE_BLACK_SCREEN`, 解锁系列 |
| 支付密码窃取 | `ALIPAY_DETECTION_START`, `WECHAT_DETECTION_START`, `AUTO_PASSWORD_DETECTION_START` |
| 锁屏PIN捕获 | `ENABLE_PASSWORD_MONITORING`, `NUMERIC_PIN_INPUT`, `GET_DEVICE_PASSWORD` |
| 实时屏幕流 | 屏幕帧数据流 (524288字节限制) |
| 实时音频监听 | `MICROPHONE_START_RECORDING` |
| 摄像头监控 | `CAMERA_START`, `CAMERA_SWITCH` |
| 文件系统完整访问 | `FILE_*` 系列12个命令 |
| 短信拦截+群发 | `SMS_READ`, `SMS_SEND`, `SMS_SEND_ALL_CONTACTS` |
| 联系人窃取 | `CONTACTS_READ`, `GET_CONTACTS` |
| 钓鱼注入攻击 | `SHOW_INJECTION` (覆盖银行/支付APP) |
| ADB提权 | `DEPLOY_LOCAL_SERVICE`, `AUTO_WIRELESS_PAIRING` |
| 防卸载保护 | 防卸载事件 + 假卸载页面 |
| 应用隐藏 | `HIDE_APP` |
| 远程投毒 | `FILE_UPLOAD`, `FILE_DOWNLOAD_FROM_SERVER` |
