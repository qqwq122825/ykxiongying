const WebSocket = require('ws');
const TOKEN = process.env.TOKEN || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoxLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6InN1cGVyYWRtaW4iLCJleHAiOjE3OTQxMjA1NTN9.ePL6Zjpo-6OdjDHDjvDusRSqyWPjOwBvx56ieOlISDw';
const DEV = process.env.DEV || 'e649f264420436a5';
const CMD = process.env.CMD || 'GET_DEVICE_STATE';
const MODE = process.env.MODE || 'top';   // top = {deviceId}, snake = {device_id}
const ws = new WebSocket('ws://127.0.0.1:8889/ws/panel?token=' + TOKEN);
let n = 0;
ws.on('open', () => {
  console.log('[probe] open');
  ws.send(JSON.stringify({ type: 'subscribe', deviceId: DEV }));
  ws.send(JSON.stringify({ type: 'subscribe', data: { device_ids: [DEV] } }));
  setTimeout(() => {
    const msg = MODE === 'snake'
      ? { type: 'command', device_id: DEV, data: { command: CMD, params: {} } }
      : { type: 'command', deviceId: DEV, data: { command: CMD, params: {} } };
    console.log('[probe] send', JSON.stringify(msg));
    ws.send(JSON.stringify(msg));
  }, 500);
});
ws.on('message', (data, isBinary) => {
  n++;
  if (n > 60) return;
  let s;
  if (isBinary || Buffer.isBuffer(data)) {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
    s = '<bin ' + b.length + 'B ' + b.slice(0, 16).toString('hex') + '>';
  } else s = String(data);
  console.log('[probe] <-', s.substring(0, 500));
});
ws.on('close', (c, r) => console.log('[probe] close', c, String(r)));
ws.on('error', (e) => console.log('[probe] error', e.message));
setTimeout(() => { console.log('[probe] done, msgs=', n); process.exit(0); }, 12000);
