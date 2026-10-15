import {identity,accountKey,get,change,myBooks,myStates,removeBook,pending,json,samePosition,noteDocument,noteHtml} from './store.js';
import {downloadBook,materialize,rewriteAssets} from './download.js';
import {syncAll,chooseConflict} from './sync.js';
import {prepareNative,nativeURL} from './native.js';
const $=id=>document.getElementById(id),status=message=>{$('status').textContent=message;};
let active=null,state=null,resources=null,section=0,screen=0,renderToken=0,editing=null,saving=Promise.resolve(),busy=false,lastSelection=null;
const marker=/\[boolean\('(?:kvoffline1:([0-9]+)|kvscreen1:[0-9a-f-]+:[0-9.]+)'\)\](?:\[boolean\('kvscreen1:[0-9a-f-]+:[0-9.]+'\)\])?$/;
const account=identity()?.key;
function checkAccount(){if(!account||identity()?.key!==account)throw new Error('계정이 바뀌었습니다. 이 화면을 새로고침하세요.');}
const error=e=>status(e.name==='AbortError'?'연결되지 않았습니다. 기기의 변경은 유지됩니다.':e.message);
function font(){return Number($('font').value);}
async function refreshLibrary(){
  checkAccount();const books=await myBooks();$('books').replaceChildren();
  for(const book of books){
    const item=document.createElement('article'),title=document.createElement('strong');title.textContent=book.title;item.append(title);
    const current=await get('states',book.key),description=document.createElement('p');description.textContent=`${(book.bytes/1024/1024).toFixed(1)} MB · ${pending(current)?'미동기화 변경 있음':'기기에 저장됨'}${book.warnings?.length?' · 일부 글꼴은 기본 글꼴로 표시':''}`;item.append(description);
    for(const [label,action] of [['읽기',()=>openBook(book.key)],['기기에서 삭제',async()=>{if(!confirm('기기에 저장한 이 책을 삭제할까요? 서버의 책은 유지됩니다.'))return;await removeBook(book.key);await refreshLibrary();}]]){
      const button=document.createElement('button');button.textContent=label;button.onclick=()=>Promise.resolve(action()).catch(error);item.append(button);
    }$('books').append(item);
  }
  if(!books.length)$('books').textContent='아직 저장한 책이 없습니다. 온라인 리더에서 책을 열어 오프라인 저장을 누르세요.';
  try{const info=await navigator.storage.estimate();$('storage').textContent=`브라우저 저장 공간: ${(info.usage/1024/1024).toFixed(1)} MB 사용 / 약 ${(info.quota/1024/1024).toFixed(0)} MB`;}catch{}
}
async function sync(manual=false){
  if(busy)return;busy=true;$('sync').disabled=true;
  try{
    await saving;await syncAll({ask:chooseConflict,status,manual});
    if(active){
      const current=await get('states',active.key);
      const moved=!samePosition(current.progress,state.progress);state=current;
      if(moved)await render(Math.min(active.sections.length-1,Math.max(0,current.progress.pageNum||0)),null,current.progress.bookScrollId);
      else paintNotes();
    }else await refreshLibrary();
  }catch(e){error(e);}finally{busy=false;$('sync').disabled=false;}
}
async function openBook(key){
  checkAccount();await saving;
  active=await get('books',key);if(!active||active.account!==account)throw new Error('저장된 책을 찾지 못했습니다.');
  state=await get('states',key);
  if(navigator.onLine&&!pending(state)){
    try{
      const remote=await json(`/api/reader/get-progress?chapterId=${active.chapterId}`,{account});
      const annotations=await json(`/api/annotation/all?chapterId=${active.chapterId}`,{account});
      state=await change(key,current=>pending(current)?current:{...current,progress:remote,baseProgress:remote,annotations,view:samePosition(current.progress,remote)?current.view:null});
    }catch(e){status('서버에 연결하지 못해 기기의 저장 위치로 엽니다.');}
  }
  if(await prepareNative(active,status)){location.href=nativeURL(active);return;}
  status('기존 리더가 아직 준비되지 않아 보관된 기본 뷰어로 엽니다. 온라인에서 다시 열면 기존 리더를 준비합니다.');
  resources?.dispose();resources=await materialize(active);
  $('heading').textContent=active.title;$('library').hidden=true;$('reader').hidden=false;
  $('sections').replaceChildren(...active.sections.map((html,index)=>{
    const doc=new DOMParser().parseFromString(html,'text/html'),heading=doc.querySelector('h1,h2,h3');return new Option(`${index+1}. ${heading?.textContent.trim().slice(0,45)||'목차 구간'}`,index);
  }));
  if(state.view?.font)$('font').value=state.view.font;
  const index=Math.min(active.sections.length-1,Math.max(0,state.progress.pageNum||0));
  await render(index,state.view?.section===index&&state.view?.width===innerWidth?state.view.screen:null,state.progress.bookScrollId);
  if(pending(state)&&navigator.onLine)void sync();
}
const frame=()=>$('frame'),doc=()=>frame().contentDocument,content=()=>doc()?.getElementById('content');
const pitch=()=>content()?.clientWidth+32;
const pages=()=>Math.max(1,Math.ceil((content()?.scrollWidth||1)/(pitch()||1)));
async function render(index,target=null,path=null){
  const version=++renderToken;section=index;$('sections').value=index;
  const html=rewriteAssets(active.sections[index],resources.urls);
  const csp="default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";
  const shell=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#fff;color:#222}#content{box-sizing:content-box!important;margin:16px!important;padding:0!important;width:calc(100vw - 32px)!important;height:calc(100vh - 32px)!important;max-height:calc(100vh - 32px)!important;overflow:hidden!important;column-count:1!important;column-gap:32px!important;font:${font()}px/1.65 sans-serif;overflow-wrap:break-word}#content img,#content svg{max-width:100%!important;max-height:calc(100vh - 36px)!important;object-fit:contain}#content .bookmark-overlay{display:none!important}::highlight(kavita-offline-notes){background:#ffe066;color:#111}</style></head><body><div id="content" class="book-content column-layout-1">${html}</div></body></html>`;
  await new Promise(resolve=>{frame().onload=resolve;frame().srcdoc=shell;});
  await Promise.race([Promise.all([doc().fonts.ready,...[...doc().images].map(image=>image.complete?null:new Promise(resolve=>{image.onload=resolve;image.onerror=resolve;}))]),new Promise(resolve=>setTimeout(resolve,5000))]);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(version!==renderToken||!active)return;
  if(target!==null)screen=Math.min(pages()-1,Math.max(0,target));else screen=screenForPath(path);
  content().scrollLeft=screen*pitch();updatePage();paintNotes();installEvents();
}
function updatePage(){screen=Math.min(pages()-1,Math.max(0,Math.round(content().scrollLeft/pitch())));$('page').textContent=`구간 ${section+1}/${active.sections.length} · 화면 ${screen+1}/${pages()}`;$('prev').disabled=section===0&&screen===0;$('next').disabled=section===active.sections.length-1&&screen===pages()-1;}
function xpath(element){
  const root=content().firstElementChild,parts=[];
  for(let node=element;node&&node!==root;node=node.parentElement){const tag=node.localName;let index=1;for(let sibling=node.previousElementSibling;sibling;sibling=sibling.previousElementSibling)if(sibling.localName===tag)index++;parts.unshift(`${tag}[${index}]`);}
  return '//body'+(parts.length?'/'+parts.join('/'):'');
}
function elementAt(path){
  try{
    path=(path||'').replace(marker,'');
    if(path.startsWith('//body'))return doc().evaluate('.'+path.slice(6),content().firstElementChild,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;
    if(path.startsWith('id('))return doc().evaluate(path,doc(),null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue;
  }catch{}return null;
}
function textNodes(root){const walker=doc().createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())if(walker.currentNode.textContent.trim()&&!walker.currentNode.parentElement.closest('style,script,button,[aria-hidden="true"]'))nodes.push(walker.currentNode);return nodes;}
function charRange(element,offset=0){
  for(const node of textNodes(element)){if(offset<node.length){const range=doc().createRange();range.setStart(node,offset);range.setEnd(node,offset+1);return range;}offset-=node.length;}return null;
}
function screenForPath(path){
  const node=elementAt(path);if(!node)return 0;
  const match=path?.match(marker),range=charRange(node,Number(match?.[1]||0));
  const rect=range?.getClientRects()[0]||node.getBoundingClientRect();
  return Math.min(pages()-1,Math.max(0,Math.floor((content().scrollLeft+rect.left-content().getBoundingClientRect().left+2)/pitch())));
}
function visibleAnchor(){
  const view=content().getBoundingClientRect(),visible=rect=>rect.width>0&&rect.height>0&&rect.right>view.left+1&&rect.left<view.right-1&&rect.bottom>view.top&&rect.top<view.bottom;
  for(const node of textNodes(content())){
    const range=doc().createRange();range.selectNodeContents(node);if(![...range.getClientRects()].some(visible))continue;
    for(let k=0;k<node.length;k+=64){range.setStart(node,k);range.setEnd(node,Math.min(node.length,k+64));if(![...range.getClientRects()].some(visible))continue;
      for(let index=k;index<Math.min(node.length,k+64);index++){
        range.setStart(node,index);range.setEnd(node,index+1);if(!visible(range.getBoundingClientRect()))continue;
        let offset=index;for(const previous of textNodes(node.parentElement)){if(previous===node)break;offset+=previous.length;}
        return {path:xpath(node.parentElement)+`[boolean('kvoffline1:${offset}')]`,element:node.parentElement};
      }
    }
  }
  const image=[...content().querySelectorAll('img,svg')].find(node=>visible(node.getBoundingClientRect()));
  return {path:xpath(image||content().firstElementChild),element:image||content().firstElementChild};
}
async function savePosition(){
  if(!active)return;checkAccount();const key=active.key,path=visibleAnchor().path;
  const progress={...active.metadata,pageNum:section,bookScrollId:path},view={section,screen,font:font(),width:innerWidth};
  saving=saving.catch(()=>{}).then(()=>change(key,current=>({...current,progress,view,dirty:!samePosition(current.baseProgress,progress),revision:current.revision+1}))).then(current=>{if(active?.key===key)state=current;status('기기에 저장됨 · 연결되면 동기화합니다.');});
  await saving;return state;
}
async function move(direction){
  if(!active||frame().dataset.moving)return;frame().dataset.moving='1';
  try{
    if(direction>0&&screen===pages()-1){if(section+1>=active.sections.length)return;await render(section+1,0);}
    else if(direction<0&&screen===0){if(section===0)return;await render(section-1,Number.MAX_SAFE_INTEGER);}
    else {screen=Math.min(pages()-1,Math.max(0,screen+direction));content().scrollLeft=screen*pitch();updatePage();}
    await savePosition();if(navigator.onLine)void sync();
  }catch(e){error(e);}finally{delete frame().dataset.moving;}
}
function installEvents(){
  let touch=null;lastSelection=null;
  doc().addEventListener('selectionchange',()=>{const selected=doc().getSelection();if(selected?.rangeCount&&selected.toString().trim()&&content().contains(selected.anchorNode))lastSelection={text:selected.toString(),range:selected.getRangeAt(0).cloneRange(),version:renderToken};});
  doc().addEventListener('touchstart',event=>{const t=event.touches[0];touch=event.touches.length===1&&t.clientX>=28&&t.clientX<=frame().clientWidth-28?{x:t.clientX,y:t.clientY,time:performance.now()}:null;},{passive:true});
  doc().addEventListener('touchmove',event=>{if(!touch||event.touches.length!==1){touch=null;return;}const t=event.touches[0],dx=t.clientX-touch.x,dy=t.clientY-touch.y;if(Math.abs(dy)>35){touch=null;return;}if(Math.abs(dx)>20&&Math.abs(dx)>=Math.abs(dy)*2&&!doc().getSelection()?.toString())event.preventDefault();},{passive:false});
  doc().addEventListener('touchend',event=>{const start=touch;touch=null;if(!start||event.touches.length||performance.now()-start.time>1200||doc().getSelection()?.toString())return;const t=event.changedTouches[0],dx=t.clientX-start.x,dy=t.clientY-start.y;if(Math.abs(dx)>=70&&Math.abs(dx)>=2*Math.abs(dy)&&Math.abs(dy)<=35){event.preventDefault();void move(dx<0?1:-1);}},{passive:false});
  doc().addEventListener('touchcancel',()=>touch=null,{passive:true});
  doc().addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();void move(event.key==='ArrowRight'?1:-1);}});
  doc().addEventListener('click',event=>{
    const link=event.target.closest('a');if(!link)return;event.preventDefault();
    const href=link.getAttribute('href');if(href?.startsWith('#')){const target=doc().getElementById(href.slice(1));if(target){const rect=target.getBoundingClientRect();screen=Math.max(0,Math.floor((content().scrollLeft+rect.left-content().getBoundingClientRect().left+2)/pitch()));content().scrollLeft=screen*pitch();updatePage();void savePosition().catch(error);}}
  });
}
function shownNotes(){
  const notes=new Map(state.annotations.map(note=>[String(note.id),note]));
  for(const [id,draft] of Object.entries(state.drafts)){if(draft.op==='delete')notes.delete(String(draft.local.id));else notes.set(String(draft.local.id||id),draft.local);}
  return [...notes.values()];
}
function selectionRange(note){
  const start=elementAt(note.xPath),end=elementAt(note.endingXPath||note.xPath);if(!start||!end)return null;
  const bound=doc().createRange();bound.setStartBefore(start);bound.setEndAfter(end);
  const nodes=textNodes(content()).filter(node=>bound.intersectsNode(node));const text=nodes.map(node=>node.textContent).join('');
  const offset=text.indexOf(note.selectedText);if(offset<0||!note.selectedText)return null;
  let cursor=0,first,last;
  for(const node of nodes){if(!first&&offset<cursor+node.length)first={node,offset:offset-cursor};if(offset+note.selectedText.length<=cursor+node.length){last={node,offset:offset+note.selectedText.length-cursor};break;}cursor+=node.length;}
  if(!first||!last)return null;const range=doc().createRange();range.setStart(first.node,first.offset);range.setEnd(last.node,last.offset);return range;
}
function paintNotes(){
  if(!active||!doc()?.defaultView?.CSS?.highlights)return;
  const ranges=shownNotes().filter(note=>note.pageNumber===section).map(selectionRange).filter(Boolean);
  doc().defaultView.CSS.highlights.set('kavita-offline-notes',new (doc().defaultView.Highlight)(...ranges));
}
function editNote(note=null){
  checkAccount();let data=note;
  if(!data){
    const selected=doc().getSelection(),cached=lastSelection?.version===renderToken?lastSelection:null;
    if((!selected?.rangeCount||!selected.toString().trim())&&!cached){status('본문을 길게 눌러 글을 선택한 뒤 메모 버튼을 누르세요.');return;}
    const range=selected?.toString().trim()?selected.getRangeAt(0):cached.range,element=node=>node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;
    if(!content().contains(range.startContainer)||!content().contains(range.endContainer))return;
    const selectedText=selected?.toString().trim()?selected.toString():cached.text;data={...active.metadata,id:0,xPath:xpath(element(range.startContainer)),endingXPath:xpath(element(range.endContainer)),selectedText,highlightCount:selectedText.length,pageNumber:section,selectedSlotIndex:0,containsSpoiler:false,comment:'',commentHtml:'',commentPlainText:'',context:element(range.startContainer).textContent,ownerUserId:identity().id,ownerUsername:identity().username,chapterTitle:'',likes:[]};
  }
  if(data.ownerUserId&&data.ownerUserId!==identity().id){status('다른 사용자의 메모는 수정하지 않습니다.');return;}
  editing=data;$('quote').textContent=data.selectedText;$('comment').value=data.commentPlainText||'';$('color').value=data.selectedSlotIndex||0;$('edit-dialog').showModal();
}
async function saveNote(event){
  event.preventDefault();checkAccount();if(!editing)return;const note=editing,id=note.clientId||(note.id>0?String(note.id):crypto.randomUUID()),text=$('comment').value;
  const local={...note,id:note.id||-Date.now(),clientId:note.id>0?undefined:id,comment:noteDocument(text,note.clientId||(note.id>0?null:id)),commentHtml:noteHtml(text),commentPlainText:text,selectedSlotIndex:Number($('color').value)};
  state=await change(active.key,current=>{const previous=current.drafts[id],base=previous?.base||current.annotations.find(item=>item.id===note.id)||null;return {...current,drafts:{...current.drafts,[id]:{...previous,op:note.id>0?'update':'create',local,base,rev:(previous?.rev||0)+1}}};});
  editing=null;$('edit-dialog').close();paintNotes();status('메모를 기기에 저장했습니다.');await showNotes(false);if(navigator.onLine)void sync();
}
async function deleteNote(note){
  if(!confirm('이 메모를 삭제할까요? 연결되면 서버에도 반영됩니다.'))return;
  const id=note.clientId||String(note.id);
  state=await change(active.key,current=>{
    const drafts={...current.drafts},previous=drafts[id];
    if(previous?.op==='create'&&!previous.attempt)delete drafts[id];
    else drafts[id]={...previous,op:'delete',local:note,base:previous?.base||current.annotations.find(item=>item.id===note.id)||null,rev:(previous?.rev||0)+1};
    return {...current,drafts};
  });paintNotes();await showNotes(false);if(navigator.onLine)void sync();
}
async function showNotes(open=true){
  state=await get('states',active.key);$('notes-list').replaceChildren();
  for(const note of shownNotes()){
    const item=document.createElement('article'),quote=document.createElement('strong'),comment=document.createElement('p');quote.textContent=note.selectedText||'하이라이트';comment.textContent=note.commentPlainText||'';item.append(quote,comment);
    for(const [label,action] of [['위치로 이동',async()=>{await render(note.pageNumber,null,note.xPath);$('notes-dialog').close();await savePosition();}],['수정',()=>{ $('notes-dialog').close();editNote(note);}],['삭제',()=>deleteNote(note)]]){
      const button=document.createElement('button');button.textContent=label;button.onclick=()=>Promise.resolve(action()).catch(error);item.append(button);
    }$('notes-list').append(item);
  }
  if(!$('notes-list').children.length)$('notes-list').textContent='저장된 메모가 없습니다.';
  if(open)$('notes-dialog').showModal();
}
$('sync').onclick=()=>sync(true);$('prev').onclick=()=>move(-1);$('next').onclick=()=>move(1);
$('sections').onchange=async()=>{try{await render(Number($('sections').value),0);await savePosition();if(navigator.onLine)void sync();}catch(e){error(e);}};
$('notes').onclick=()=>showNotes().catch(error);$('add-note').onclick=()=>editNote();$('edit-form').onsubmit=event=>void saveNote(event).catch(error);
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
$('close').onclick=async()=>{try{await saving;renderToken++;active=null;state=null;resources?.dispose();resources=null;$('reader').hidden=true;$('library').hidden=false;$('heading').textContent='오프라인 책장';await refreshLibrary();history.replaceState(null,'','./index.html');}catch(e){error(e);}};
let resizeTimer;
$('font').onchange=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(async()=>{if(!active)return;try{const path=visibleAnchor().path;await render(section,null,path);await savePosition();}catch(e){error(e);}},150);};
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(async()=>{if(!active)return;try{await saving;await render(section,null,state.progress.bookScrollId);}catch(e){error(e);}},250);});
$('export').onclick=async()=>{
  try{const states=(await myStates()).filter(pending),data={format:'kavita-offline-pending-v1',exportedAt:new Date().toISOString(),account:identity()?.username,states:states.map(({nativeResponses,...state})=>state)};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='kavita-offline-pending.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){error(e);}
};
window.addEventListener('online',()=>void sync());
window.addEventListener('storage',event=>{if(event.key==='kavita-user'&&identity()?.key!==account)location.reload();});
setInterval(()=>{if(!document.hidden&&navigator.onLine)void myStates().then(states=>{if(states.some(pending))void sync();}).catch(error);},30000);
try{
  if(!isSecureContext||!('serviceWorker' in navigator))throw new Error('오프라인 기능은 HTTPS 주소에서 사용하세요.');
  const registration=await navigator.serviceWorker.getRegistration('/');
  if(!registration)await navigator.serviceWorker.register('/kavita-offline-sw.js',{scope:'/'});
  else if(navigator.onLine)void registration.update().catch(()=>{});
  await navigator.serviceWorker.ready;
  if(!identity())throw new Error('먼저 인터넷에 연결하여 Kavita에 로그인하세요. 저장한 책은 로그인한 계정별로 표시됩니다.');
  await refreshLibrary();status(navigator.onLine?'저장한 책은 인터넷 없이 읽을 수 있습니다.':'오프라인 · 읽기 위치와 메모는 기기에 저장됩니다.');
  const params=new URLSearchParams(location.search),download=params.get('download'),read=params.get('book');
  if(download&&/^\d+$/.test(download)){
    const button=document.createElement('button');button.textContent='이 책을 오프라인으로 저장';$('library').prepend(button);
    button.onclick=async()=>{button.disabled=true;try{const book=await downloadBook(Number(download),{status});await refreshLibrary();button.remove();await openBook(book.key);}catch(e){error(e);button.disabled=false;}};
  }else if(read&&/^\d+$/.test(read))await openBook(accountKey(read));
  if(params.has('native-error')){const reason=sessionStorage.getItem('kavita-native-error');sessionStorage.removeItem('kavita-native-error');const warning=document.createElement('p');warning.setAttribute('role','alert');warning.textContent='기존 리더를 준비하지 못했습니다. '+(reason||'인터넷 연결 후 읽기를 다시 눌러주세요.')+' 저장한 책과 변경은 유지됩니다.';warning.style.cssText='padding:12px;border:1px solid #d66;border-radius:6px';$('library').prepend(warning);status('저장한 책을 다시 열어 시도할 수 있습니다.');}
  if(navigator.onLine)void sync();
}catch(e){error(e);}
