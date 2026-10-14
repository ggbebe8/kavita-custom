import {identity,myStates,pending} from './store.js';
import {syncAll,chooseConflict} from './sync.js';
if(isSecureContext&&'serviceWorker' in navigator){
  const base='/kavita-pwa/offline/';let syncing=false;
  navigator.serviceWorker.register('/kavita-offline-sw.js',{scope:'/'}).catch(()=>{});
  const link=document.createElement('a');link.href=base+'index.html';link.textContent='오프라인 책장';link.style.cssText='position:fixed;left:8px;bottom:8px;z-index:1030;font:12px system-ui;padding:6px 9px;background:#202938;color:#fff;border-radius:7px;text-decoration:none';document.body.append(link);
  const notice=document.createElement('span');notice.setAttribute('role','status');notice.style.cssText='display:block;font-size:10px';link.append(notice);
  async function sync(){
    if(syncing||!identity()||!navigator.onLine)return;
    syncing=true;try{if((await myStates()).some(pending))await syncAll({ask:chooseConflict,status:text=>notice.textContent=text});}catch{notice.textContent='미동기화 변경 보관 중';}finally{syncing=false;}
  }
  function refresh(){
    const root=document.querySelector('app-book-reader');link.hidden=!!root;
    const shortcut=root?.querySelector('.reader-header .fa-clipboard-question')?.closest('button');
    if(shortcut?.parentElement&&!shortcut.parentElement.querySelector('[data-kavita-offline]')){
      const button=document.createElement('button');button.type='button';button.className='btn btn-icon me-1';button.setAttribute('data-kavita-offline','');button.title='오프라인 저장 / 열기';button.setAttribute('aria-label',button.title);
      const icon=document.createElement('i');icon.className='fa-solid fa-cloud-arrow-down';icon.setAttribute('aria-hidden','true');button.append(icon);
      button.onclick=()=>{
        const reader=window.__kavitaReaderSection?.();
        location.href=base+'index.html'+(reader?.id?'?download='+encodeURIComponent(reader.id):'');
      };shortcut.parentElement.insertBefore(button,shortcut.parentElement.querySelector('[data-kavita-tts]')||shortcut.parentElement.querySelector('[data-kavita-fullscreen]')||shortcut);
    }
  }
  let scheduled=false;new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;refresh();});}}).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('online',()=>void sync());window.addEventListener('storage',event=>{if(event.key==='kavita-user')void sync();});
  setInterval(()=>{if(!document.hidden)void sync();},30000);refresh();void sync();
}
