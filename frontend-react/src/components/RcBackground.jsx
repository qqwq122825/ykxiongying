import { useEffect, useRef } from 'react'

export default function RcBackground() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    let w, h, raf, last = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const particles = []
    const symbols = ['$','€','₿','₮','◆','♦','●','¥']
    const colors = ['#a855f7','#c084fc','#e74c3c','#d4af37','#9333ea','#fbbf24']
    function resize(){ w=innerWidth; h=innerHeight; canvas.width=w*dpr; canvas.height=h*dpr; canvas.style.width=w+'px'; canvas.style.height=h+'px'; ctx.setTransform(dpr,0,0,dpr,0,0) }
    function spawn(x=Math.random()*w,y=h+20,n=1){ while(n-- && particles.length<80){ const a=Math.random()*Math.PI*2, s=.5+Math.random(); particles.push({x,y,vx:Math.cos(a)*s*.35,vy:-.6-Math.random(),life:.6+Math.random()*.4,d:.003+Math.random()*.003,size:10+Math.random()*10,rot:Math.random()*6,rs:(Math.random()-.5)*.015,s:symbols[Math.random()*symbols.length|0],c:colors[Math.random()*colors.length|0]}) } }
    function draw(t){ ctx.clearRect(0,0,w,h); if(t-last>700){spawn(); last=t} particles.forEach((p,i)=>{p.x+=p.vx;p.y+=p.vy;p.vy+=.006;p.life-=p.d;p.rot+=p.rs;if(p.life<=0)particles.splice(i,1);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.globalAlpha=Math.min(p.life,.42);ctx.font=p.size+'px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowBlur=12;ctx.shadowColor=p.c;ctx.fillStyle=p.c;ctx.fillText(p.s,0,0);ctx.restore()}); raf=requestAnimationFrame(draw)}
    resize(); addEventListener('resize', resize); raf=requestAnimationFrame(draw)
    return () => { removeEventListener('resize', resize); cancelAnimationFrame(raf) }
  }, [])
  return <><div className="orb orb-1"/><div className="orb orb-2"/><div className="orb orb-3"/><div className="grid-overlay"/><canvas ref={ref} id="particles-canvas"/></>
}
