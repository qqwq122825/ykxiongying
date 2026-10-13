# 星辰安装向导

APK 构建服务器需要 Java 11。宝塔用户可在“软件商店 → Java环境管理器”安装 JDK 11；构建脚本会自动识别 `/www/server/java/*/bin/java`。

访问 `https://你的域名/install.php` 可完成首次安装。

安装项：

- MySQL 连接信息
- 管理员账号/密码
- Telegram Bot Token
- 管理员 Telegram Chat ID
- 前端、后端、Node WebSocket 地址

安装完成后会生成：

- `.env`
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

## 子账号 Telegram 逻辑

- 每个账号必须有自己的 Telegram Chat ID，登录验证码会发到这个账号自己的 Chat ID。
- Bot Token 不需要每个子账号重复配置：子账号会沿 `parent_username` 向上查找父账号/管理员的 `tg_<ID>_bot_token`。
- 管理员账号可以使用安装时配置的全局兼容键 `bot_token` / `chat_id`。
- 如果子账号没有配置 Chat ID，会在登录时提示未绑定 Telegram Chat ID。
