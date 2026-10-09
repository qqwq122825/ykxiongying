#!/usr/bin/env node
/**
 * 直接用 WebSocket 发 GET_DEVICE_PASSWORD 给设备，抓原始响应。
 * 原版前端逻辑: sendCommand(deviceId, "GET_DEVICE_PASSWORD", params)
 */
const WebSocket = require('ws');
const http = require('http');

const DEVICE = process.argv[2] || '84012b2ae791b123';

// 先从数据库取设备信息（通过已有的 node 依赖）
const path = '/var/www/cs/node-ws';
let mysql;
try { mysql = require(path + '/node_modules/mysql2/promise'); } catch (e) {
  try { mysql = require('mysql2/promise'); } catch (e2) {
    console.error('mysql2 不可用:', e2.message); process.exit(1);
  }
}

(async () => {
  let port = 0, model = '?';
  try {
    const cfg = require(path + '/config');
    const pool = mysql.createPool({
      host: cfg.mysql.host, port: cfg.mysql.port,
      user: cfg.mysql.user, password: cfg.mysql.password,
      database: cfg.mysql.database,
    });
    const [rows] = await pool.execute(
      'SELECT device_id, model, remote_port FROM fisher_devices WHERE device_id=?', [DEVICE]);
    if (rows.length) { port = rows[0].remote_port; model = rows[0].model; }
    await pool.end();
  } catch (e) {
    console.error('查库失败:', e.message);
  }
  console.log(`[*] 设备 ${DEVICE}  model=${model}  tunnelPort=${port}`);

  const url = `ws://127.0.0.1:8889/ws/device?deviceId=${DEVICE}`;
  console.log(`[*] WebSocket 连接: ${url}`);
  const ws = new WebSocket(url);
  const got = [];

  ws.on('open', () => {
    const cmd = {
      type: 'command',
      sessionId: DEVICE,
      data: { command: 'GET_DEVICE_PASSWORD', params: {} },
    };
    console.log(`[>] 发送: ${JSON.stringify(cmd)}`);
    ws.send(JSON.stringify(cmd));
  });

  ws.on('message', (raw) => {
    const s = raw.toString();
    got.push(s);
    try {
      const j = JSON.parse(s);
      const t = j.type || '?';
      if (!['ping', 'pong', 'heartbeat'].includes(t)) {
        console.log(`[<] type=${t}`);
        console.log(`    ${s.substring(0, 700)}`);
      }
    } catch (_) {
      console.log(`[<] (raw) ${s.substring(0, 300)}`);
    }
  });

  ws.on('error', (e) => console.error(`[!] WS 错误: ${e.message}`));

  setTimeout(() => {
    console.log(`\n[*] 共收到 ${got.length} 条消息`);
    const hits = got.filter(m => /password|cipher|credential/i.test(m));
    if (hits.length) {
      console.log(`[★] 密码相关 ${hits.length} 条:`);
      hits.forEach(h => console.log('   ', h.substring(0, 900)));
    } else {
      console.log('[!] 没有收到任何密码相关消息');
    }
    try { ws.close(); } catch (_) {}
    process.exit(0);
  }, 15000);
})();
