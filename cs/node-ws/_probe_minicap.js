const WebSocket = require('ws');
const paths = ['/minicap','/minicap/stream','/minicap/socket','/screen','/stream','/minicap/ws'];
let done = 0;
for (const p of paths) {
  const ws = new WebSocket('ws://127.0.0.1:17912' + p);
  let n = 0, bytes = 0, first = null;
  const t = setTimeout(() => { console.log(p, 'TIMEOUT msgs=' + n + ' bytes=' + bytes); try{ws.terminate();}catch{}; if(++done===paths.length)process.exit(0); }, 5000);
  ws.on('open', () => console.log(p, 'OPEN'));
  ws.on('message', (d, isBin) => {
    n++; bytes += d.length;
    if (!first) first = Buffer.from(d).slice(0,8).toString('hex');
    if (n <= 3) console.log(p, 'msg#'+n, 'len='+d.length, 'bin='+isBin, 'head='+first, JSON.stringify(Buffer.from(d).slice(0,80).toString('utf8')));
  });
  ws.on('error', (e) => { console.log(p, 'ERROR', e.message); clearTimeout(t); if(++done===paths.length)process.exit(0); });
  ws.on('close', (c) => { console.log(p, 'CLOSE', c, 'msgs='+n, 'bytes='+bytes); clearTimeout(t); if(++done===paths.length)process.exit(0); });
}