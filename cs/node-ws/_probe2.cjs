const WebSocket = require('ws');
const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoxLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6InN1cGVyYWRtaW4iLCJleHAiOjE3OTQxMjA1NTN9.ePL6Zjpo-6OdjDHDjvDusRSqyWPjOwBvx56ieOlISDw';
const DEV = 'e649f264420436a5';
const ws = new WebSocket('ws://127.0.0.1:8889/ws/panel?token=' + TOKEN);
const variants = [
  ['A sessionId+data',   { type: 'command', sessionId: DEV, data:    { command: 'GET_APP_LIST', params: {} } }],
  ['B deviceId+payload', { type: 'command', deviceId:  DEV, payload: { command: 'GET_APP_LIST', params: {} } }],
  ['C flat type',        { type: 'GET_APP_LIST', sessionId: DEV, data: {} }],
  ['D flat command',     { command: 'GET_APP_LIST', sessionId: DEV, params: {} }],
  ['E payload cmd',      { type: 'command', deviceId: DEV, payload: { command: 'GET_PERMISSIONS', params: {} } }],
  ['F cmd/data nested',  { type: 'command', deviceId: DEV, data: { command: 'GET_PERMISSIONS', data: {} } }],
];
ws.on('open', () => {
  console.log('[p] open');
  let i = 0;
  const tick = () => {
    if (i >= variants.length) { setTimeout(() => process.exit(0), 4000); return; }
    const [name, msg] = variants[i++];
    console.log('[p] SEND ' + name + ' :: ' + JSON.stringify(msg));
    try { ws.send(JSON.stringify(msg)); } catch (e) { console.log('[p] err', e.message); }
    setTimeout(tick, 3000);
  };
  tick();
});
ws.on('message', (d, bin) => {
  const s = bin ? '<bin ' + d.length + 'B>' : String(d);
  if (/app_list|permission|device_state|response|pong/i.test(s)) console.log('[p] <- ' + s.substring(0, 300));
});
ws.on('error', e => console.log('[p] error', e.message));
