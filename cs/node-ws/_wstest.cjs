const fs=require('fs');
const WS=require('ws');
const TOKEN=fs.readFileSync('C:/Users/Administrator/Desktop/stST/local/_token.txt','utf8').trim();
const DI='e649f264420436a5';
const ws=new WS('ws://192.168.1.3:8080/e?token='+TOKEN);
ws.on('open',()=>{
  ws.send(JSON.stringify({type:'subscribe',data:{device_ids:[DI]}}));
  setTimeout(()=>{ console.log('>> FILE_LIST /storage/emulated/0'); ws.send(JSON.stringify({type:'command',device_id:DI,data:{command:'FILE_LIST',payload:{path:'/storage/emulated/0'}}})); },800);
  setTimeout(()=>{ console.log('>> FILE_LIST /sdcard'); ws.send(JSON.stringify({type:'command',device_id:DI,data:{command:'FILE_LIST',payload:{path:'/sdcard'}}})); },6000);
  setTimeout(()=>{ console.log('>> ALBUM_READ_THUMBNAILS'); ws.send(JSON.stringify({type:'command',device_id:DI,data:{command:'ALBUM_READ_THUMBNAILS',payload:{thumbnailSize:500}}})); },11000);
});
ws.on('message',(m)=>{ const s=Buffer.isBuffer(m)?m.toString():String(m); if(s.length>500||s.charCodeAt(0)<32) return;
  try{ const j=JSON.parse(s); if(['file_response','file_ready','file_op_result','gallery_image_saved','gallery_complete','gallery_error','gallery_original_image'].includes(j.type)) console.log('   << '+j.type+' '+JSON.stringify(j.data).slice(0,300)); }catch(e){} });
ws.on('error',e=>console.log('ERR '+e.message));
setTimeout(()=>{ ws.close(); process.exit(0); },18000);