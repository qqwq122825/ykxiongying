const WebSocket = require('ws');
const fs = require('fs');
const out = [];
function probe(p, ms=5000) {
  return new Promise(res => {
    let n=0, bytes=0, first=null, opened=false, closed=null, err=null;
    let ws;
    try { ws = new WebSocket('ws://127.0.0.1:17912'+p); } catch(e){ return res(out.push(p+' CONSTRUCT-ERR '+e.message)); }
    const fin = (why) => { try{ws.terminate();}catch{}; res(out.push(`${p} | ${why} | open=${opened} msgs=${n} bytes=${bytes} head=${first} close=${closed} err=${err}`)); };
    ws.on('open', ()=>{opened=true;});
    ws.on('message',(d)=>{n++;bytes+=d.length; if(!first) first=Buffer.from(d).slice(0,10).toString('hex');});
    ws.on('error',(e)=>{err=e.message;});
    ws.on('close',(c)=>{closed=c;});
    setTimeout(()=>fin('timeout'), ms);
  });
}
(async()=>{
  for (const p of ['/minicap','/minicap/stream','/minicap/socket','/minicap/ws','/screen','/stream','/minicap/mjpeg','/']) {
    await probe(p);
  }
  fs.writeFileSync(process.argv[2], out.join('\n'), 'utf8');
  console.log(out.join('\n'));
  process.exit(0);
})();