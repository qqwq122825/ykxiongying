# 星辰安装向导

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

生产环境建议安装完成后删除或限制访问 `public/install.php`。

## 子账号 Telegram 逻辑

- 每个账号必须有自己的 Telegram Chat ID，登录验证码会发到这个账号自己的 Chat ID。
- Bot Token 不需要每个子账号重复配置：子账号会沿 `parent_username` 向上查找父账号/管理员的 `tg_<ID>_bot_token`。
- 管理员账号可以使用安装时配置的全局兼容键 `bot_token` / `chat_id`。
- 如果子账号没有配置 Chat ID，会在登录时提示未绑定 Telegram Chat ID。
