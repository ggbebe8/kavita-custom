import {identity,myStates,myBooks,pending,json,get,accountKey,samePosition} from './store.js';
import {syncAll,chooseConflict} from './sync.js';
if(isSecureContext&&'serviceWorker' in navigator){
  const base='/kavita-pwa/offline/';let syncing=false;
  navigator.serviceWorker.register('/kavita-offline-sw.js',{scope:'/'}).catch(()=>{});
  const link=document.createElement('a');link.href=base+'index.html';link.textContent='오프라인 책장';link.style.cssText='position:fixed;left:8px;bottom:8px;z-index:1030;font:12px system-ui;padding:6px 9px;background:#202938;color:#fff;border-radius:7px;text-decoration:none';document.body.append(link);
  const notice=document.createElement('span');notice.setAttribute('role','status');notice.style.cssText='display:block;font-size:10px';link.append(notice);
  async function sync(){
    if(syncing||!identity()||!navigator.onLine||new URLSearchParams(location.search).has('kv-prepare'))return;
    syncing=true;try{
      const local=new URLSearchParams(location.search).get('kv-offline')==='1',chapter=local?Number(location.pathname.split('/').at(-1)):null;
      const before=chapter?await get('states',accountKey(chapter)):null;
      let movedToRemote=false;
      if((await myStates()).some(pending))await syncAll({ask:async conflict=>{const choice=await chooseConflict(conflict);if(conflict.kind==='progress'&&choice==='remote')movedToRemote=true;return choice;},status:text=>notice.textContent=text});
      const after=chapter?await get('states',accountKey(chapter)):null;
      if(movedToRemote&&before&&after&&!after.dirty&&!samePosition(before.progress,after.progress))location.reload();
    }catch{notice.textContent='미동기화 변경 보관 중';}finally{syncing=false;}
  }
  function refresh(){
    const root=document.querySelector('app-book-reader');link.hidden=!!root;
    if(root&&new URLSearchParams(location.search).get('kv-offline')==='1'&&!new URLSearchParams(location.search).has('kv-prepare')){
      const header=root.querySelector('.reader-header');
      if(header&&!header.querySelector('[data-kavita-offline-native]')){
        const badge=document.createElement('a');badge.dataset.kavitaOfflineNative='';badge.href=base+'index.html';badge.textContent='오프라인 저장본';badge.title='읽기 위치·메모는 기기에 먼저 저장합니다. 연결되면 자동 동기화합니다. 클릭하면 오프라인 책장으로 이동합니다.';
        badge.style.cssText='position:absolute;right:4px;top:100%;font:11px/1.5 system-ui,sans-serif;padding:1px 5px;background:#202938;color:#fff;white-space:nowrap;border-radius:0 0 3px 3px;text-decoration:none';header.append(badge);
      }
    }
    // Download belongs beside the native Read/Continue button on the detail
    // page. Resolve the same continue-point as Kavita without opening a reader.
    for(const old of document.querySelectorAll('app-book-reader [data-kavita-offline]'))old.remove();
    const detail=document.querySelector('app-chapter-detail,app-series-detail');
    const read=detail?.querySelector('.read-btn--text')?.closest('button');
    const route=location.pathname.match(/^\/library\/(\d+)\/series\/(\d+)(?:\/chapter\/(\d+))?\/?$/);
    if(root||!read||!route){document.querySelectorAll('[data-kavita-offline-detail]').forEach(node=>node.remove());return;}
    const existing=detail.querySelector('[data-kavita-offline-detail]');
    if(existing){if(existing.dataset.context!==location.pathname+'|'+identity()?.key)void existing.refreshSaved?.();return;}
    const group=document.createElement('div');group.className='col-auto ms-2';group.setAttribute('data-kavita-offline-detail','');
    const button=document.createElement('button');button.type='button';button.className='btn btn-outline-primary';button.setAttribute('data-kavita-offline','');button.title='이 책을 기기에 저장하여 오프라인으로 읽기';
    const icon=document.createElement('i');icon.className='fa-solid fa-cloud-arrow-down';icon.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.className='ms-1';label.textContent='오프라인 저장';button.append(icon,label);group.append(button);
    const message=document.createElement('span');message.setAttribute('role','status');message.style.cssText='display:block;max-width:250px;font-size:12px';group.append(message);
    let savedChapter=null,statusVersion=0;
    function savedAppearance(saved){
      const text=saved?'오프라인 저장 완료':'오프라인 저장';
      if(label.textContent!==text)label.textContent=text;
      button.className='btn '+(saved?'btn-outline-success':'btn-outline-primary');
      icon.className='fa-solid '+(saved?'fa-circle-check':'fa-cloud-arrow-down');
      button.title=saved?'이 기기에 저장됨 · 저장한 책 열기':'이 책을 기기에 저장하여 오프라인으로 읽기';
      button.dataset.saved=String(saved);
    }
    group.refreshSaved=async()=>{
      const version=++statusVersion,current=location.pathname,user=identity()?.key;
      group.dataset.context=current+'|'+user;
      const match=current.match(/^\/library\/(\d+)\/series\/(\d+)(?:\/chapter\/(\d+))?\/?$/);
      if(!match)return;
      try{
        const books=await myBooks(),candidates=books.filter(book=>book.metadata?.seriesId===Number(match[2])&&book.metadata?.libraryId===Number(match[1]));
        let id=match[3]?Number(match[3]):null;
        if(!id&&candidates.length)id=(await json('/api/reader/continue-point?seriesId='+match[2])).id;
        if(version!==statusVersion||!group.isConnected||current!==location.pathname||identity()?.key!==user)return;
        savedChapter=books.some(book=>book.chapterId===id)?id:null;savedAppearance(!!savedChapter);
      }catch{
        if(version===statusVersion&&group.isConnected){savedChapter=null;savedAppearance(false);}
      }
    };
    button.onclick=async()=>{
      if(savedChapter){
        try{const saved=await get('books',accountKey(savedChapter));
        if(saved){location.href=base+'index.html?book='+savedChapter;return;}}catch(error){message.textContent=error.message;return;}
        savedChapter=null;savedAppearance(false);
      }

      const current=location.pathname,match=current.match(/^\/library\/(\d+)\/series\/(\d+)(?:\/chapter\/(\d+))?\/?$/);
      if(!match)return;button.disabled=true;label.textContent='책 확인 중…';message.textContent='';
      try{
        const chapterId=match[3]?Number(match[3]):(await json('/api/reader/continue-point?seriesId='+match[2])).id;
        if(!Number.isInteger(chapterId)||chapterId<=0)throw new Error('저장할 책을 찾지 못했습니다.');
        const info=await json(`/api/book/${chapterId}/book-info`);
        if(info.seriesFormat!==3)throw new Error('현재 EPUB 책만 오프라인 저장을 지원합니다.');
        if(button.isConnected&&location.pathname===current)location.href=base+'index.html?download='+chapterId;
      }catch(error){message.textContent=error.name==='AbortError'?'연결을 확인한 후 다시 시도하세요.':error.message;}
      finally{button.disabled=false;savedAppearance(!!savedChapter);}
    };
    const column=read.closest('.col-auto');
    if(column)column.insertAdjacentElement('afterend',group);else read.parentElement.append(group);
    void group.refreshSaved();

  }
  let scheduled=false;new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;refresh();});}}).observe(document.body,{childList:true,subtree:true,characterData:true});
  const refreshSaved=()=>{document.querySelectorAll('[data-kavita-offline-detail]').forEach(group=>void group.refreshSaved?.());};
  window.addEventListener('focus',refreshSaved);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSaved();});
  window.addEventListener('online',()=>{refreshSaved();void sync();});window.addEventListener('storage',event=>{if(event.key==='kavita-user'){refreshSaved();void sync();}});
  setInterval(()=>{if(!document.hidden)void sync();},30000);refresh();void sync();
}
