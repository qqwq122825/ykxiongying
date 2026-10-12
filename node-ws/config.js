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

// ★ 所有服务共用项目根目录 .env；仅在独立运行 node-ws 且根 .env 不存在时兼容旧文件。
const sharedEnvPath = path.resolve(__dirname, '..', '.env');
const legacyEnvPath = path.join(__dirname, '.env');
const envFile = fs.existsSync(sharedEnvPath) ? loadEnv(sharedEnvPath) : loadEnv(legacyEnvPath);
Object.keys(envFile).forEach(k => {
  if (!process.env[k]) process.env[k] = envFile[k];
});

const externalHost = process.env.EXTERNAL_HOST || process.env.FRPS_ADDR || '';
const externalPort = parseInt(process.env.EXTERNAL_PORT || process.env.WS_PORT || '8889', 10);

function normalizeBaseUrl(raw, protocol, host, port) {
  let value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) value = `${protocol}://${host}:${port}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `${protocol}://${value}`;
  if (protocol === 'http') value = value.replace(/^ws(s?):\/\//i, 'http$1://');
  if (protocol === 'ws') value = value.replace(/^http(s?):\/\//i, 'ws$1://');
  return value.replace(/\/+$/, '');
}

const c2HttpBase = normalizeBaseUrl(process.env.C2_HOST, 'http', externalHost || '127.0.0.1', externalPort);
const c2WsBase = normalizeBaseUrl(process.env.C2_WS_HOST || c2HttpBase, 'ws', externalHost || '127.0.0.1', externalPort);
const c2Authority = (() => {
  try { return new URL(c2HttpBase).host; } catch { return `${externalHost}:${externalPort}`; }
})();

module.exports = {
  port: parseInt(process.env.WS_PORT || '8889', 10),

  // ★ JWT 密钥：必须从 env 读，不允许硬编码
  jwtSecret: process.env.JWT_SECRET || '',

  mysql: {
    host: process.env.DB_HOST || envFile.HOSTNAME || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || envFile.HOSTPORT || '3306', 10),
    user: process.env.DB_USER || envFile.USERNAME || '',
    password: process.env.DB_PASS || envFile.PASSWORD || '',
    database: process.env.DB_NAME || envFile.DATABASE || '',
    timezone: process.env.DB_TIMEZONE || '+08:00',
  },

  // ★ 全链路时区统一：与 PHP config/app.php Asia/Shanghai 对齐
  //   海外服务器 UTC 环境不影响入库/展示时间
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Shanghai',

  // ★ frps 服务器配置（从 env 读，避免硬编码泄露）
  frps: {
    addr: process.env.FRPS_ADDR || '',
    port: parseInt(process.env.FRPS_PORT || '7000', 10),
    token: process.env.FRPS_TOKEN || '',
    dashboardPort: parseInt(process.env.FRPS_DASHBOARD_PORT || '7500', 10),
    dashboardUser: process.env.FRPS_DASHBOARD_USER || '',
    dashboardPassword: process.env.FRPS_DASHBOARD_PASSWORD || '',
  },

  // 对外服务地址统一来自项目根 .env：EXTERNAL_HOST/EXTERNAL_PORT/C2_HOST。
  c2: {
    host: externalHost,
    port: externalPort,
    authority: c2Authority,
    httpBase: c2HttpBase,
    wsBase: c2WsBase,
  },

  envPath: fs.existsSync(sharedEnvPath) ? sharedEnvPath : legacyEnvPath,

  // ★ 设备上 local-service 监听的本地端口（frpc 把这个端口映射出去）
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

// ★ 启动时强制校验：数据库连接信息必须配置
(function () {
  const m = module.exports.mysql;
  const missing = [];
  if (!m.user) missing.push('DB_USER');
  if (!m.password) missing.push('DB_PASS');
  if (!m.database) missing.push('DB_NAME');
  if (missing.length) {
    console.error('\n[FATAL] 数据库配置缺失: ' + missing.join(', '));
    console.error('请在项目根目录 .env 中正确配置以上变量\n');
    process.exit(1);
  }
})();

// ★ 启动时强制校验：frps 地址必须配置（隧道功能依赖）
(function () {
  if (!module.exports.frps.addr) {
    console.warn('\n[WARN] FRPS_ADDR 未配置；隧道/ADB/Shizuku 功能将不可用\n');
  }
})();
