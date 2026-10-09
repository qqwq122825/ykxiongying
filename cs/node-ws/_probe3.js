const WebSocket = require('ws');
const fs = require('fs');
const out=[];
function probe(p, ms=6000){return new Promise(res=>{
  let n=0,bytes=0,first=null,opened=false,closed=null,err=null;
  const ws=new WebSocket('ws://127.0.0.1:17912'+p);
  ws.on('open',()=>{opened=true;});
  ws.on('message',(d)=>{n++;bytes+=d.length; if(!first) first=Buffer.from(d).slice(0,10).toString('hex');});
  ws.on('error',(e)=>{err=e.message;});
  ws.on('close',(c)=>{closed=c;});
  setTimeout(()=>{try{ws.terminate();}catch{}; out.push(`${p} | open=${opened} msgs=${n} bytes=${bytes} head=${first} close=${closed} err=${err}`); res();}, ms);
});}
(async()=>{
  for (const p of ['/minicap/stream','/minicap','/minicap/socket','/minicap/ws']) await probe(p);
  fs.writeFileSync(process.argv[2], out.join('\n'),'utf8');
  console.log(out.join('\n'));
  process.exit(0);
})();