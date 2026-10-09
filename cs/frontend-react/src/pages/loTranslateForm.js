if(typeof window.loTranslateForm!=="function"){
window.loTranslateForm = async function(lang){
  if(!lang)return;
  const inputs=Array.from(document.querySelectorAll('input[type="text"],textarea,input:not([type])'));
  const els=inputs.filter(el=>{const v=el.value.trim();return v&&!v.startsWith("http")&&!/^\d+$/.test(v)});
  const texts=els.map(el=>el.value);if(!texts.length)return;
  try{
    const token=localStorage.getItem("fc_token");
    const res=await fetch("/api/translate",{method:"POST",headers:{"Content-Type":"application/json",...token?{Authorization:"Bearer "+token}:{}},body:JSON.stringify({texts,targetLanguage:lang})});
    const data=await res.json();
    if(data.success&&data.translated){
      els.forEach((el,i)=>{if(el&&data.translated[i]){
        const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")?.set;
        const ts=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value")?.set;
        if(el.tagName==="TEXTAREA"&&ts)ts.call(el,data.translated[i]);
        else if(s)s.call(el,data.translated[i]);
        el.dispatchEvent(new Event("input",{bubbles:true}));
        el.dispatchEvent(new Event("change",{bubbles:true}))
      }});
      const msg=document.createElement("div");
      msg.style.cssText="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#52c41a;color:#fff;padding:10px 20px;border-radius:4px;z-index:9999;font-weight:bold;font-size:14px;";
      msg.textContent="\u{1f30d} \u9875\u9762\u6587\u672c\u5df2\u5b9e\u65f6\u7ffb\u8bd1\u5e76\u8986\u76d6\uff01";
      document.body.appendChild(msg);
      setTimeout(()=>msg.remove(),3000)
    }
  }catch(e){console.error(e)}
}
}
