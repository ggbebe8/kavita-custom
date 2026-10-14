import {identity,myStates,pending,json} from './store.js';
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
    // Download belongs beside the native Read/Continue button on the detail
    // page. Resolve the same continue-point as Kavita without opening a reader.
    for(const old of document.querySelectorAll('app-book-reader [data-kavita-offline]'))old.remove();
    const detail=document.querySelector('app-chapter-detail,app-series-detail');
    const read=detail?.querySelector('.read-btn--text')?.closest('button');
    const route=location.pathname.match(/^\/library\/(\d+)\/series\/(\d+)(?:\/chapter\/(\d+))?\/?$/);
    if(root||!read||!route){document.querySelectorAll('[data-kavita-offline-detail]').forEach(node=>node.remove());return;}
    if(detail.querySelector('[data-kavita-offline-detail]'))return;
    const group=document.createElement('div');group.className='col-auto ms-2';group.setAttribute('data-kavita-offline-detail','');
    const button=document.createElement('button');button.type='button';button.className='btn btn-outline-primary';button.setAttribute('data-kavita-offline','');button.title='이 책을 기기에 저장하여 오프라인으로 읽기';
    const icon=document.createElement('i');icon.className='fa-solid fa-cloud-arrow-down';icon.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.className='ms-1';label.textContent='오프라인 저장';button.append(icon,label);group.append(button);
    const message=document.createElement('span');message.setAttribute('role','status');message.style.cssText='display:block;max-width:250px;font-size:12px';group.append(message);
    button.onclick=async()=>{
      const current=location.pathname,match=current.match(/^\/library\/(\d+)\/series\/(\d+)(?:\/chapter\/(\d+))?\/?$/);
      if(!match)return;button.disabled=true;label.textContent='책 확인 중…';message.textContent='';
      try{
        const chapterId=match[3]?Number(match[3]):(await json('/api/reader/continue-point?seriesId='+match[2])).id;
        if(!Number.isInteger(chapterId)||chapterId<=0)throw new Error('저장할 책을 찾지 못했습니다.');
        const info=await json(`/api/book/${chapterId}/book-info`);
        if(info.seriesFormat!==3)throw new Error('현재 EPUB 책만 오프라인 저장을 지원합니다.');
        if(button.isConnected&&location.pathname===current)location.href=base+'index.html?download='+chapterId;
      }catch(error){message.textContent=error.name==='AbortError'?'연결을 확인한 후 다시 시도하세요.':error.message;}
      finally{button.disabled=false;label.textContent='오프라인 저장';}
    };
    const column=read.closest('.col-auto');
    if(column)column.insertAdjacentElement('afterend',group);else read.parentElement.append(group);

  }
  let scheduled=false;new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;refresh();});}}).observe(document.body,{childList:true,subtree:true,characterData:true});
  window.addEventListener('online',()=>void sync());window.addEventListener('storage',event=>{if(event.key==='kavita-user')void sync();});
  setInterval(()=>{if(!document.hidden)void sync();},30000);refresh();void sync();
}
