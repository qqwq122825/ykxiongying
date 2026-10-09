const WebSocket = require('ws');
const fs = require('fs');
const token = (process.argv[2] || '').trim();
const di = 'e649f264420436a5';
const ws = new WebSocket('ws://127.0.0.1:8889/ws/panel?token=' + encodeURIComponent(token));
let frames = 0, bytes = 0, texts = [];
ws.binaryType = 'nodebuffer';
const t0 = Date.now();
ws.on('open', () => { console.log('OPEN'); ws.send(JSON.stringify({type:'subscribe', data:{device_ids:[di]}})); });
ws.on('message', (d, isBin) => {
  if (isBin) { frames++; bytes += d.length; if (frames<=3) console.log('FRAME', d.length, Buffer.from(d).slice(0,4).toString('hex')); }
  else { const s = d.toString(); if (texts.length < 6) { texts.push(s.slice(0,200)); console.log('TEXT', s.slice(0,200)); } }
});
ws.on('error', e => console.log('ERR', e.message));
ws.on('close', (c) => console.log('CLOSE', c));
setTimeout(() => {
  console.log(`RESULT frames=${frames} bytes=${bytes} elapsed=${Date.now()-t0}ms`);
  try{ws.close();}catch{}
  process.exit(0);
}, 12000);