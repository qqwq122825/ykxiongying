# Fisher 项目 - Windows 部署脚本

## 📁 文件清单

| 文件 | 作用 |
|------|------|
| `deploy.ps1` | **一键部署脚本**(主入口) |
| `fix.ps1` | **修复脚本**(出错时用) |
| `start.bat` | 启动所有服务(也可手动) |
| `README.md` | 本文档 |

## 🚀 使用方法

### 1. 一键部署(全新服务器)

```powershell
# 右键 PowerShell → "以管理员身份运行"
cd C:\wwwroot\cs\deploy
.\deploy.ps1
```

按提示完成安装:
- **手动部分**:下载并安装 BtSoft 到 `C:\BtSoft\`(选 Nginx + MySQL + PHP 7.4 + Redis)
- 自动完成:
  - 检查目录完整性
  - 初始化 MySQL 数据库(导入 .sql)
  - 配置 PHP 站点 (vhost)
  - 安装 Node.js(如缺失,自动下载 v20.18 LTS)
  - 安装 npm 依赖
  - 复制 .env.example → .env
  - 构建前端
  - 配置前端 vhost
  - 创建启动脚本

### 2. 出错时修复

如果 deploy.ps1 中途失败,或服务跑不起来:

```powershell
cd C:\wwwroot\cs\deploy
.\fix.ps1
```

按数字键选择要修复的阶段:
- **1** = 检查管理员权限
- **2** = 检查 BtSoft
- **3** = 测试 MySQL 连接
- **4** = 重新导入数据库
- **5** = 检查 PHP/服务状态
- **6** = 检查 Node.js 依赖
- **7** = 重新安装 npm 依赖
- **8** = 检查 .env
- **9** = 重启 Node.js
- **10** = 重启 frps
- **11** = 重启 nginx
- **12** = 检查端口监听
- **13** = 按顺序全部修复

### 3. 启动服务

```cmd
双击: C:\wwwroot\cs\deploy\start.bat
```

启动顺序:
1. frps (端口 7000/7500)
2. MySQL/Redis/Nginx/PHP (BtSoft 服务)
3. Node.js fisher-ws (端口 8889)
4. frpc 客户端(模拟器)

## 🌐 服务地址

| 服务 | 地址 | 用途 |
|------|------|------|
| 前端 | http://localhost:8888 | Web 界面 |
| PHP API | http://localhost | 后端业务 |
| Node.js WS | ws://localhost:8889 | 设备通信 |
| frp 控制台 | http://localhost:7500 | 隧道监控 |
| MySQL | 127.0.0.1:3306 | 数据库 |
| Redis | 127.0.0.1:6379 | 缓存 |

## 📋 系统要求

| 项目 | 最低 | 推荐 |
|------|------|------|
| 操作系统 | Win10/Win Server 2016+ | **Win Server 2019/2022** |
| 内存 | 4 GB | 8 GB+ |
| 硬盘 | 10 GB | 50 GB+ |
| 网络 | 公网 IP 或 frp 端口映射 | 稳定宽带 |
| .NET | 4.5+ | - |

## 🔧 故障排查流程

```
deploy.ps1 失败
    ↓
看错误信息
    ↓
  ① "BtSoft 未安装" → 手动下载安装
  ② "MySQL 连接失败" → fix.ps1 选项 3 重置密码
  ③ "npm install 失败" → fix.ps1 选项 7 切换镜像源
  ④ "Node.js 启动失败" → fix.ps1 选项 9 重启
  ⑤ "数据库导入失败" → fix.ps1 选项 4 DROP 重导
  ⑥ "服务起来了但访问不到" → fix.ps1 选项 12 检查端口
```

## 📁 项目结构(部署后)

```
C:\wwwroot\cs\
├── app\                          # PHP 后端(ThinkPHP)
├── node-ws\                       # Node.js WS 服务
│   ├── .env                       # 环境配置(DB/FRPS/...)
│   ├── node_modules\
│   └── src\index.js
├── frontend-react\
│   └── dist\                      # 构建后静态文件
├── BtSoft\                        # 宝塔集成环境
│   ├── nginx\
│   ├── MySQL\
│   ├── php\
│   └── Redis\
├── frp_0.61.1_windows_amd64\      # frp 服务端
│   ├── frps.exe
│   └── frps.toml
└── deploy\                        # 本目录(部署脚本)
    ├── deploy.ps1
    ├── fix.ps1
    ├── start.bat
    └── README.md
```

## 🐛 已知问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 前端 404 | `dist` 未构建 | `cd frontend-react && npm run build` |
| MySQL Access denied | 密码错 | `fix.ps1` 选项 3 重置 |
| Node.js 启动失败 | 端口占用 | `netstat -ano | findstr 8889` 找占用进程 |
| frp 连不上 | token/端口错 | 检查 frps.toml 和 .env |
| 设备 WS 不连 | serverAddr 错 | 调 `setServerAddr` API |

## 📝 配置项速查(.env)

```ini
# 数据库
DB_HOST=127.0.0.1
DB_USER=cs725
DB_PASS=cs725
DB_NAME=cs725

# frp
FRPS_ADDR=38.246.253.55
FRPS_PORT=7000
FRPS_TOKEN=<your-token>
FRPS_DASHBOARD_HOST=127.0.0.1
FRPS_DASHBOARD_PORT=7500
FRPS_DASHBOARD_USER=admin
FRPS_DASHBOARD_PASSWORD=<your-password>

# 服务
WS_PORT=8889
JWT_SECRET=<random-32-chars>
```

## 🎯 部署完成后必做

1. **修改默认密码** - `.env` 里的 `DB_PASS`, `JWT_SECRET`, `FRPS_DASHBOARD_PASSWORD`
2. **绑定域名** - 修改 `frps.toml` 里的 `vhost_https_port` 映射
3. **配置 HTTPS** - 用 BtSoft 申请 Let's Encrypt 证书
4. **配置防火墙** - 开放 80/443/8889/7000/7500
5. **定期备份** - mysqldump 整个 `cs725` 数据库

## 💡 Tips

- **状态文件**: `C:\wwwroot\cs\deploy\.install_state.json`
  - 记录已完成的步骤,重跑 deploy 不会重复
  - 删掉它可以完全重新安装
- **修脚本的 .state 字段** - 强制重做某步骤可手动改这文件
- **BtSoft 优势** - 一次性安装 MySQL+PHP+Nginx+Redis,避免手动配置
