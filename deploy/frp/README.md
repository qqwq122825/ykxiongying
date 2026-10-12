# 项目内置 frps

本目录包含官方 `fatedier/frp v0.61.1` 的 Linux `frps` 服务端二进制：

- `linux_amd64`：Intel/AMD 64 位服务器
- `linux_arm64`：ARM 64 位服务器

安装器会自动识别 CPU 架构、校验 `SHA256SUMS`，然后在项目根目录生成
`frps/frps`、`frps/frps.ini` 和 `frps/package.json`。整个过程不需要再从 GitHub 下载 frps。

服务端只安装 `frps`。设备/local-service 使用的 `frpc` 不应运行在服务器上。

安装：

```bash
sudo bash deploy/install-frps.sh
```

配置来自项目根目录 `.env` 中的 `[FRPS]` 段。
宝塔 Node 项目使用项目根目录下的 `frps/` 作为项目目录，启动选项选 `start`即可。
安装器会在 UFW/firewalld 已启用时自动放行 FRPS 端口和设备隐道端口段；
云厂商安全组仍需要放行 `7000/tcp` 和 `19902-29999/tcp`。Dashboard 默认只绑定
`127.0.0.1:7500`，不需要对公网开放。

来源：<https://github.com/fatedier/frp/releases/tag/v0.61.1>

许可证见 `LICENSE.frp` (Apache-2.0)。
