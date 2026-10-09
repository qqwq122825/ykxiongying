import { chromium } from 'playwright';
const OUT='C:\\Users\\Administrator\\Desktop\\stST\\local\\shots\\1to1';
const b=await chromium.launch({channel:'chrome',headless:true});
const c=await b.newContext({viewport:{width:1600,height:1000}});
const p=await c.newPage();
for (const [url,tag] of [['http://192.168.1.3:8080/#/login','lan'],['http://127.0.0.1:8080/#/login','local']]) {
  await p.goto(url,{waitUntil:'networkidle'});
  await p.waitForTimeout(2200);
  await p.screenshot({path:OUT+'\\login_'+tag+'_fresh.png'});
  const info=await p.evaluate(()=>{const d=document.querySelector('.login-split > div');return d?{bg:getComputedStyle(d).backgroundImage.slice(0,90),w:Math.round(d.getBoundingClientRect().width),h:Math.round(d.getBoundingClientRect().height)}:{bg:'none'}});
  console.log(tag+' -> '+JSON.stringify(info));
}
await b.close();
