'use strict';

// ★ 安全修复：极简 .env 解析器（不依赖 dotenv，避免引入新依赖）
const fs = require('fs');
const path = require('path');

function loadEnv(envPath) {
  try {
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split(/\r?\n/).forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (m) {
        let val = m[2].trim();
        // 去掉引号
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[m[1]] = val;
      }
    });
    return env;
  } catch (e) {
    return {};
  }
}

// ★ 从 .env 加载。
// 先读 node-ws/.env 作为兼容默认值，再读上级 cs/.env 覆盖。
// 宝塔多站点部署时，站点安装器只会生成 cs/.env；仓库里的 node-ws/.env
// 可能仍是模板旧库名，若不让 cs/.env 覆盖，设备 WS 上线只会停留在内存，
// 无法写入当前站点数据库，后台设备列表就一直为空。
const envFiles = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
];
for (const file of envFiles) {
  const envFile = loadEnv(file);
  Object.keys(envFile).forEach(k => {
    process.env[k] = envFile[k];
  });
}

module.exports = {
  port: parseInt(process.env.WS_PORT || '8889', 10),

  // ★ JWT 密钥：必须从 env 读，不允许硬编码
  jwtSecret: process.env.JWT_SECRET || '',

  mysql: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'cs725',
    password: process.env.DB_PASS || 'cs725',
    database: process.env.DB_NAME || 'cs725',
  },

  // ★ frps 服务器配置（从 env 读，避免硬编码泄露）
  frps: {
    addr: process.env.FRPS_ADDR || '147.90.182.35',
    port: parseInt(process.env.FRPS_PORT || '7000', 10),
    token: process.env.FRPS_TOKEN || '',
    dashboardPort: parseInt(process.env.FRPS_DASHBOARD_PORT || '7500', 10),
    dashboardUser: process.env.FRPS_DASHBOARD_USER || '',
    dashboardPassword: process.env.FRPS_DASHBOARD_PASSWORD || '',
  },

  external: {
    host: process.env.EXTERNAL_HOST || process.env.FRPS_ADDR || '147.90.182.35',
    port: parseInt(process.env.EXTERNAL_PORT || process.env.WS_PORT || '8889', 10),
  },

  // ★ 设备上 DXS local-service/tpx 监听的本地端口。
  // libdxs.so v3.1.0 的 server 默认端口是 7912；7910 是 APK 外层轻量服务，
  // 只提供少量状态接口，不能承接 /deviceInfo、/screenshot、/getConfig 等 DXS 路由。
  localServicePort: parseInt(process.env.LOCAL_SERVICE_PORT || '7912', 10),


  // ★ CORS 白名单（逗号分隔）
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),

  // 帧节流上限；设备端 SCREEN_QUALITY 允许的最大值为 30fps
  maxFps: Math.max(1, Math.min(30, parseInt(process.env.MAX_FPS || '30', 10))),
  // 命令轮询间隔 (ms)
  commandPollInterval: 2000,
  // 设备离线判定阈值 (秒)
  offlineThreshold: 120,
};

// ★ 启动时强制校验：JWT_SECRET 必须配置
if (!module.exports.jwtSecret || module.exports.jwtSecret.length < 32) {
  console.error('\n[FATAL] JWT_SECRET 未配置或太短（必须 ≥32 字符）');
  console.error('请在 .env 中设置: JWT_SECRET=你的强随机密钥');
  console.error('生成方法: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
  process.exit(1);
}

// ★ 启动时校验：避免使用已知弱密钥
const WEAK_SECRETS = ['fisher_secret_2026', 'secret', 'changeme', '123456', 'password'];
if (WEAK_SECRETS.includes(module.exports.jwtSecret)) {
  console.error('\n[FATAL] 检测到弱 JWT 密钥！请立即更换为强随机字符串\n');
  process.exit(1);
}
