const fs=require('fs');
const WS=require('ws');
const TOKEN=fs.readFileSync('C:/Users/Administrator/Desktop/stST/local/_token.txt','utf8').trim();
const DI='e649f264420436a5';
const ws=new WS('ws://192.168.1.3:8080/e?token='+TOKEN);
const seen={};
ws.on('open',()=>{
  console.log('OPEN');
  ws.send(JSON.stringify({type:'subscribe',data:{device_ids:[DI]}}));
  setTimeout(()=>{ console.log('>> ALBUM_READ_THUMBNAILS'); ws.send(JSON.stringify({type:'command',device_id:DI,data:{command:'ALBUM_READ_THUMBNAILS',payload:{thumbnailSize:500}}})); },500);
  setTimeout(()=>{ console.log('>> FILE_LIST'); ws.send(JSON.stringify({type:'command',device_id:DI,data:{command:'FILE_LIST',payload:{path:'/sdcard/DCIM'}}})); },6000);
  setTimeout(()=>{ console.log('>> GET_GALLERY'); ws.send(JSON.stringify({type:'command',device_id:DI,data:{command:'GET_GALLERY',payload:{}}})); },12000);
});
ws.on('message',(m)=>{
  let t='';
  const s=Buffer.isBuffer(m)?m.toString():String(m);
  if(s.length>0 && s.charCodeAt(0)>0 && /^[\x00-\x1f]/.test(s)) t='BIN len='+s.length;
  else if(s.length>=400) t='BIG len='+s.length+' '+s.slice(0,90);
  else { try{const j=JSON.parse(s); t='JSON type='+(j.type||j.event||'?')+' '+s.slice(0,200);}catch(e){ t='RAW '+s.slice(0,150);} }
  const key=t.slice(0,70); seen[key]=(seen[key]||0)+1;
  if(!t.startsWith('BIN')) console.log('   << '+t);
});
ws.on('error',e=>console.log('ERR '+e.message));
setTimeout(()=>{ console.log('\n=== summary ==='); for(const k of Object.keys(seen)) console.log(seen[k]+'x  '+k); ws.close(); process.exit(0); },20000);