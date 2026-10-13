# 星辰安装向导

APK 构建服务器需要 Java 11。宝塔用户可在“软件商店 → Java环境管理器”安装 JDK 11；构建脚本会自动识别 `/www/server/java/*/bin/java`。
安装页会在提交前校验 Java/JDK 11+、`keytool`、Python 3、`unzip`、`apksigner.jar` 和签名脚本；任一必需项缺失时会显示具体路径并拦截安装。

完整新服务器推荐只执行一个入口：

```bash
cd /项目目录
sudo bash install.sh
```

这里的 `/项目目录` 是项目根目录的占位写法，请替换为实际部署路径。例如项目位于
`/www/wwwroot/yk` 时，可以直接执行：

```bash
sudo bash /www/wwwroot/yk/install.sh
```

它会询问当前服务器公网 IP 或域名，生成共享 `.env`，安装并启动 FRPS、Node WS、
PHP/Nginx/MySQL/Redis，注册 systemd 开机自启，并在结束前验证 FRPS Dashboard 鉴权。

## 命令行安装与网页安装的区别

- **首次部署或全新服务器**：必须先以 root 权限执行项目根目录的 `install.sh`。脚本负责安装
  系统软件、注册并启动 systemd 服务、配置 Nginx、处理目录权限和检查监听端口；这些操作不能
  由普通 PHP-FPM 用户直接完成。
- **网页初始化**：访问 `https://你的域名/install.php`，用于填写数据库、管理员、服务器地址、
  FRPS Token 和 Dashboard 密码等应用配置。页面会生成共享 `.env`、Node 配置链接和内置
  `frps/` 配置并执行静态校验。
- **已有完整运行环境**：可以直接使用网页安装；但如果服务器尚未安装或启动 FRPS、Node、
  systemd/Nginx 等组件，仍需执行一次 `sudo bash /实际项目目录/install.sh`。

推荐的新服务器顺序是：上传项目 → 执行一次 `sudo bash /实际项目目录/install.sh` → 根据页面
提示完成或确认网页初始化。以后重新填写应用配置时，不需要重复执行系统安装。

安装项：

- MySQL 连接信息
- 管理员账号/密码
- Telegram Bot Token
- 管理员 Telegram Chat ID
- 前端、后端、Node WebSocket 地址
- 当前服务器公网 IP 或域名（同时写入 APK/FRPC 下发配置）
- FRPS Token、Dashboard 账号密码及隧道端口范围

安装完成后会生成：

- `.env`
- `node-ws/.env` → 根目录 `.env`
- `frps/frps` 与 `frps/frps.ini`
- `runtime/install.lock`
- `fisher_users` 管理员账号
- `fisher_settings` 中的 `tg_<管理员ID>_bot_token`、`tg_<管理员ID>_chat_id`、`bot_token`、`chat_id` 等兼容配置

## 数据库内容

- `install/schema.sql` 只创建运行所需的表结构，不包含任何历史记录。
- `install/seed.sql` 只保留内置注入模板库和权限菜单/角色权限。
- 安装页默认勾选“清空旧 fisher_ 表”，因此换服务器安装后不会带入旧设备、旧账号、APK 构建记录、表单数据、密码、日志或运行任务。
- 安装完成后只会创建表单中填写的管理员账号；设备表初始为空。
- 不需要手工导入仓库根目录的历史 SQL 备份；安装程序只读取上述两个 `install/` 文件。

生产环境建议安装完成后删除或限制访问 `public/install.php`。

一键安装结束时会强制检查：PHP 控制器语法、Node 共享配置、FRPS Token/面板密码一致性、
7000/8889 监听状态以及 `127.0.0.1:7500` Dashboard 登录。任一关键检查失败，安装脚本会
以非零状态退出，不会再把半完成部署报告为成功。

## 子账号 Telegram 逻辑

- 每个账号必须有自己的 Telegram Chat ID，登录验证码会发到这个账号自己的 Chat ID。
- Bot Token 不需要每个子账号重复配置：子账号会沿 `parent_username` 向上查找父账号/管理员的 `tg_<ID>_bot_token`。
- 管理员账号可以使用安装时配置的全局兼容键 `bot_token` / `chat_id`。
- 如果子账号没有配置 Chat ID，会在登录时提示未绑定 Telegram Chat ID。
