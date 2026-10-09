import { useEffect, useState, useCallback } from "react"
import { api } from "../api/client"

function bs(s){if(!s)return"0 秒";const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);const se=Math.floor(s%60);let r="";if(d)r+=d+"天";if(h)r+=h+"小时";if(m)r+=m+"分";r+=se+"秒";return r}
function vs(b){if(!b||b===0)return"0 B";const u=["B","KB","MB","GB","TB"],i=Math.floor(Math.log(b)/Math.log(1024));return(b/Math.pow(1024,i)).toFixed(1)+" "+u[i]}
function ks(p){if(p<50)return"#52c41a";if(p<80)return"#faad14";return"#ff4d4f"}
function sp(p){return Math.min(100,Math.max(0,Math.round(p||0)))}

function Donut({pct,size=100,stroke=8}){
  const r=36,nr=15.9155,circ=nr*2*Math.PI,offset=circ-(circ*sp(pct)/100)
  return<svg viewBox="0 0 36 36" style={{width:size,height:size}}><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(168,85,247,.1)" strokeWidth="3"/><path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={ks(pct)} strokeWidth="3" strokeDasharray={sp(pct)+", 100"} strokeLinecap="round" style={{transition:"stroke-dasharray .5s"}}/></svg>
}

function MeterCard({title,pct,icon,items}){
  return<div className="panel" style={{padding:16,display:"flex",flexDirection:"column"}}>
    <h4 style={{margin:"0 0 12px",fontSize:15,fontWeight:600,color:"#ddd",display:"flex",alignItems:"center",gap:6}}><span>{icon}</span>{title}</h4>
    <div style={{textAlign:"center",padding:"8px 0"}}>
      <div style={{position:"relative",width:100,height:100,margin:"0 auto 10px",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <Donut pct={pct}/>
        <div style={{position:"absolute",fontSize:22,fontWeight:700,color:ks(pct)}}>{sp(pct)}%</div>
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 12px",fontSize:13,color:"#8870a0",marginTop:"auto"}}>
      {items.map((x,i)=><div key={i} style={{display:"flex",justifyContent:"space-between"}}><span>{x.l}</span><b style={{color:"#b8a0c8"}}>{x.v}</b></div>)}
    </div>
  </div>
}

function SC({title,value,suffix,color,icon}){
  return<div className="s-card" style={{textAlign:"center",padding:"18px 14px"}}>
    <div className="s-title" style={{justifyContent:"center",fontSize:13}}><span>{icon}</span>{title}</div>
    <div className="s-val" style={{color:color||"#c084fc",fontSize:28}}>{value??"-"}{suffix?<span style={{fontSize:13,color:"#8870a0",marginLeft:4}}>{suffix}</span>:null}</div>
  </div>
}

function InfoItem({label,value}){return<><span style={{color:"#8870a0",fontSize:13}}>{label}</span><span style={{color:"#b8a0c8",fontSize:13}}>{value||"-"}</span></>}

export default function NodePage(){
  const[loading,setLoading]=useState(true),[data,setData]=useState(null),[error,setError]=useState(null),[refresh,setRefresh]=useState(new Date())
  const[wsStatus,setWsStatus]=useState('检测中')
  const load=useCallback(async()=>{setLoading(true);setError(null);try{const r=await api.systemInfo();const d=r.data||r;if(d)setData(d);setRefresh(new Date())}catch(e){setError(e.message||"获取系统信息失败")}finally{setLoading(false)}},[])
  useEffect(()=>{load();const t=setInterval(load,30000);return()=>clearInterval(t)},[load])
  useEffect(()=>{
    let ws,closed=false,timer
    function check(){
      if(closed)return
      const token=localStorage.getItem('fc_token')||''
      const base=(localStorage.getItem('fc_server_url')||location.origin).replace(/^http/,'ws').replace(/\/$/,'')
      try{ws=new WebSocket(`${base}/ws/panel?token=${encodeURIComponent(token)}`);ws.onopen=()=>{setWsStatus('已连接');ws.send(JSON.stringify({type:'ping'}));setTimeout(()=>{try{ws.close()}catch{}},1000)};ws.onerror=()=>setWsStatus('连接失败');ws.onclose=()=>{if(!closed)timer=setTimeout(check,15000)}}catch{setWsStatus('连接失败')}
    }
    check()
    return()=>{closed=true;clearTimeout(timer);try{ws?.close()}catch{}}
  },[])

  if(error)return<section className="panel" style={{padding:24,textAlign:"center"}}><div className="toast err">{error}</div><button className="rc-btn" style={{marginTop:16}} onClick={load}>重试</button></section>

  return<section className="panel node-panel" style={{padding:24}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <h2 style={{margin:0,fontSize:22,fontWeight:600,color:"#ddd"}}>🌐 服务器状态</h2>
        <span className="pill on" style={{fontSize:12}}>运行中</span>
        <span className={`pill ${wsStatus==='已连接'?'on':'off'}`} style={{fontSize:12}}>WS: {wsStatus}</span>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:13,color:"#8870a0"}}>上次刷新: {refresh.toLocaleTimeString()}</span>
        <button className="rc-btn" onClick={load} style={{fontSize:13}}>{loading?"⟳ 刷新中...":"⟳ 刷新"}</button>
      </div>
    </div>

    {loading&&!data?<div style={{padding:60,textAlign:"center",color:"#8b949e",fontSize:15}}>加载中...</div>:!data?<div style={{padding:60,textAlign:"center",color:"#8b949e",fontSize:15}}>暂无数据</div>:<>
      <div className="rc-stats node-stats-4" style={{gridTemplateColumns:"repeat(3,1fr)",marginBottom:24}}>
        <SC title="在线设备" value={data.onlineDevices??0} suffix={"/ "+(data.totalDevices??"-")} color="#52c41a" icon="📶"/>
        <SC title="已构建APK" value={data.totalApks??0} color="#1890ff" icon="📦"/>
        <SC title="服务运行时间" value={bs(data.uptime)} color="#c084fc" icon="⏱️"/>
      </div>

      <div className="rc-stats node-stats-4" style={{gridTemplateColumns:"repeat(4,1fr)",marginBottom:24}}>
        <MeterCard title="CPU 使用率" pct={data.cpuUsage} icon="⚡" items={[{l:"核心数",v:data.cpuCores+" 核"},{l:"型号",v:data.cpuModel||"未知"}]}/>
        <MeterCard title="内存使用" pct={data.memUsage} icon="🧠" items={[{l:"总内存",v:vs(data.memTotal)},{l:"已使用",v:vs(data.memUsed)},{l:"可用",v:vs(data.memFree)}]}/>
        <MeterCard title="硬盘使用" pct={data.diskUsage} icon="💾" items={[{l:"总容量",v:vs(data.diskTotal)},{l:"已使用",v:vs(data.diskUsed)},{l:"可用",v:vs(data.diskFree)}]}/>
        <MeterCard title="网络流量" pct={0} icon="🌐" items={[{l:"上传速度",v:vs(data.netSendSpeed||0)+"/s"},{l:"下载速度",v:vs(data.netRecvSpeed||0)+"/s"},{l:"总上传",v:vs(data.netBytesSent||0)},{l:"总下载",v:vs(data.netBytesRecv||0)}]}/>
      </div>

      <div className="rc-stats node-stats-2" style={{gridTemplateColumns:"repeat(2,1fr)"}}>
        <div className="panel" style={{padding:18}}>
          <h4 style={{margin:"0 0 14px",fontSize:15,fontWeight:600,color:"#ddd",display:"flex",alignItems:"center",gap:6}}><span>🖥️</span>系统信息</h4>
          <div style={{display:"grid",gridTemplateColumns:"100px 1fr",gap:"8px 14px"}}>
            <InfoItem label="主机名" value={data.hostname||"未知"}/>
            <InfoItem label="操作系统" value={data.os||"-"}/>
            <InfoItem label="系统版本" value={data.platform||"未知"}/>
            <InfoItem label="系统运行时间" value={bs(data.hostUptime)}/>
          </div>
        </div>
        <div className="panel" style={{padding:18}}>
          <h4 style={{margin:"0 0 14px",fontSize:15,fontWeight:600,color:"#ddd",display:"flex",alignItems:"center",gap:6}}><span>💾</span>存储详情</h4>
          <div style={{display:"grid",gridTemplateColumns:"100px 1fr",gap:"8px 14px"}}>
            <InfoItem label="APK输出目录" value={vs(data.apkOutputSize)}/>
            <InfoItem label="APK文件数量" value={(data.totalApks||0)+" 个"}/>
          </div>
          <div style={{marginTop:12,fontSize:12,color:"#6e7681"}}>💡 定期清理不需要的APK文件可以释放磁盘空间</div>
        </div>
      </div>
    </>}
  </section>
}
