// The original Angular reader is used unchanged. This adapter supplies only the
// selected account's saved book when the user explicitly opens offline mode.
import {identity,accountKey,get,change,createId,revision} from './store.js';
import {cleanURL,materialize,rewriteAssets} from './download.js';
const network=window.fetch.bind(window);
const bookCache=new Map(),resourceCache=new Map();
export const nativeURL=book=>`/library/${book.metadata.libraryId}/series/${book.metadata.seriesId}/book/${book.chapterId}?kv-offline=1`;
function safeSection(html){
  const doc=new DOMParser().parseFromString(html,'text/html');
  doc.querySelectorAll('script,iframe,object,embed,form,base,meta,foreignObject,animate,animateMotion,animateTransform,set').forEach(n=>n.remove());
  for(const node of doc.querySelectorAll('*'))for(const attribute of [...node.attributes]){
    if(/^on/i.test(attribute.name)||['srcdoc','action','formaction'].includes(attribute.name))node.removeAttribute(attribute.name);
    if(['href','xlink:href'].includes(attribute.name)&&!attribute.value.startsWith('#')){
      try{if(!['http:','https:','mailto:'].includes(new URL(attribute.value,location.href).protocol))node.removeAttribute(attribute.name);}catch{node.removeAttribute(attribute.name);}
    }
  }
  return doc.body.innerHTML;
}
const requestKey=value=>{const u=new URL(value,location.origin);u.searchParams.delete('includeWordCounts');u.searchParams.sort();return u.pathname+(u.search?'?'+u.searchParams.toString():'');};
const allowed=/^\/api\/(?:library(?:\/libraries)?|users\/has-library-access|reading-profile(?:\/.*)?|font(?:\/.*)?|reader\/(?:chapter-bookmarks|time-left-for-chapter|next-chapter|prev-chapter)|book\/\d+\/(?:book-info|chapters)|series\/chapter|locale|plugin\/version|theme|device|stream\/sidenav|license\/valid-license)$/;
// Do not persist tokens/auth keys from account endpoints or resource URLs.
function scrub(value){
  if(Array.isArray(value))return value.map(scrub);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['token','refreshToken','apiKey','authKeys','password'].includes(key)).map(([key,v])=>[key,scrub(v)]));
  if(typeof value==='string')return value.replace(/([?&])(?:apiKey|access_token|token|refreshToken)=[^&\s"'<>)]*/gi,'$1').replace(/\?&/g,'?');
  return value;
}
export async function updateBook(key,fn){
  bookCache.delete(key);
  const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('kavita-offline-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise((resolve,reject)=>{const tx=database.transaction('books','readwrite'),s=tx.objectStore('books'),r=s.get(key);let result;r.onsuccess=()=>{try{result=fn(r.result);if(result)s.put(result);}catch(e){tx.abort();reject(e);}};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('리더 정보를 저장하지 못했습니다.'));});}finally{database.close();}
}
function notes(state){const all=new Map((state.annotations||[]).map(n=>[String(n.id),n]));for(const d of Object.values(state.drafts||{})){if(d.op==='delete')all.delete(String(d.local.id));else all.set(String(d.local.id),d.local);}return [...all.values()];}
async function localResources(book){if(!resourceCache.has(book.key))resourceCache.set(book.key,materialize(book));return resourceCache.get(book.key);}
window.addEventListener('pagehide',event=>{if(!event.persisted)for(const value of resourceCache.values())void value.then(r=>r.dispose());});
const response=(value,status=200,type='application/json')=>({status,type,body:type==='application/json'?JSON.stringify(value):value});
export async function nativeRequest(request){
  const user=identity(),route=location.pathname.match(/^\/library\/\d+\/series\/\d+\/book\/(\d+)/);
  if(!user||!route)return response({error:'오프라인 계정을 확인하세요.'},403);
  const key=accountKey(Number(route[1])),prepare=new URLSearchParams(location.search).has('kv-prepare');
  if(prepare||!bookCache.has(key))bookCache.set(key,get('books',key));
  const book=await bookCache.get(key),state=await get('states',key);
  if(!book||book.account!==user.key||!state)return response({error:'이 계정에 저장한 책이 없습니다.'},404);
  const url=new URL(cleanURL(request.url)),path=url.pathname;url.searchParams.delete('kv-native-client');
  const linkResources=text=>{for(const asset of book.assets){const u=new URL(asset.url);u.searchParams.set('kv-native-client',request.client);text=text.split(asset.url).join(u.href);}return text;};
  const chapter=Number(url.searchParams.get('chapterId')||url.searchParams.get('currentChapterId')||path.match(/\/book\/(\d+)/)?.[1]||book.chapterId);
  if(chapter!==book.chapterId)return response({error:'다른 책은 오프라인 책장에서 열어주세요.'},404);
  if(request.method==='GET'){
    if(path==='/api/account/refresh-account')return response(JSON.parse(localStorage.getItem('kavita-user'))); // already existing local login, never stored again here
    if(path==='/api/account/oidc-authenticated')return response('false',200,'text/plain');
    if(path==='/api/reader/get-progress')return response(state.progress);
    if(path==='/api/annotation/all')return response(notes(state));
    if(/^\/api\/annotation\/-?\d+$/.test(path)){const id=Number(path.split('/').at(-1)),op=state.nativeIds?.[id];return response(notes(state).find(n=>n.id===(state.nativeServerIds?.[id]||id))||(op?state.annotations.find(n=>createId(n)===op):null)||null);}
    if(path===`/api/book/${book.chapterId}/book-page`){const index=Number(url.searchParams.get('page'));return Number.isInteger(index)&&book.sections[index]!==undefined?response(rewriteAssets(safeSection(book.sections[index]),(await localResources(book)).urls),200,'text/plain'):response({},404);}
    if(path===`/api/book/${book.chapterId}/book-resources`){const asset=book.assets.find(a=>a.url===cleanURL(url.href));return asset?{status:200,type:asset.blob.type,body:asset.blob.type.includes('text/css')?linkResources(await asset.blob.text()):asset.blob}:response({},404);}
    if(/\/reader\/(next|prev)-chapter$/.test(path))return response(-1); // no network-dependent book transitions
    const snapshot=state.nativeResponses?.[requestKey(url)]||book.native?.responses?.[requestKey(url)];if(snapshot)return snapshot;
    if(prepare&&allowed.test(path)){
      const r=await network(url,{headers:{Authorization:`Bearer ${user.token}`,'X-Kavita-Offline-Network':'1'},cache:'no-store'});
      if(!r.ok)return response({},r.status);
      const type=r.headers.get('content-type')||'application/json';
      if(!type.includes('json')&&path!=='/api/font')return response({},503);
      const saved=type.includes('json')?response(scrub(await r.json())):{status:200,type,body:await r.blob()};
      if(identity()?.key!==user.key)return response({},403);
      await change(key,current=>({...current,nativeResponses:{...current.nativeResponses,[requestKey(url)]:saved}}));return saved;
    }
    return response({error:'오프라인에서 사용할 수 없는 기능입니다.'},503);
  }
  let data;try{data=JSON.parse(request.body||'{}');}catch{return response({},400);}
  // Keep Kavita's normal login renewal when connectivity returns. Tokens are
  // returned only to AccountService's existing login storage, never IndexedDB.
  if(path==='/api/account/refresh-token'&&request.method==='POST'&&!prepare&&navigator.onLine){
    const r=await network(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${user.token}`,'X-Kavita-Offline-Network':'1'},body:JSON.stringify(data)});
    if(identity()?.key!==user.key)return response({},403);
    return response(await r.json(),r.status);
  }
  // Warm-up renders the real book without changing even the local read position.
  if(path==='/api/reader/progress'&&request.method==='POST'){
    if(Number(data.chapterId)!==book.chapterId)return response({},403);
    if(!prepare)await change(key,current=>({...current,progress:{...current.progress,...data},dirty:true,revision:(current.revision||0)+1,view:null}));
    return response('',200,'text/plain');
  }
  if(prepare)return response({error:'준비 중에는 저장하지 않습니다.'},503);
  if(['/api/reading-profile','/api/reading-profile/series'].includes(path)&&request.method==='POST'){
    await change(key,current=>{const responses={...book.native?.responses,...current.nativeResponses};for(const k of Object.keys(responses))if(k.startsWith('/api/reading-profile/')&&new URL(k,location.origin).searchParams.get('skipImplicit')!=='true'){const previous=JSON.parse(responses[k].body);if(!Array.isArray(previous))responses[k]=response({...previous,...scrub(data)});}return {...current,nativeResponses:responses};});return response(data);
  }
  // Angular may still hold a temporary ID after a reconnect sync assigned its
  // server ID. Resolve that ID through the existing idempotency marker.
  function resolveNote(id){
    const operation=state.nativeIds?.[id];
    return notes(state).find(n=>n.id===(state.nativeServerIds?.[id]||id))||(operation?state.annotations.find(n=>createId(n)===operation):null);
  }
  if(path==='/api/annotation/update'&&data.id<0){const resolved=resolveNote(data.id);if(resolved?.id>0)data={...data,id:resolved.id};}
  if((path==='/api/annotation/create'||path==='/api/annotation/update')&&request.method==='POST'){
    if(Number(data.chapterId)!==book.chapterId||data.ownerUserId&&data.ownerUserId!==user.id)return response({},403);
    let result;
    await change(key,current=>{
      const previous=Object.entries(current.drafts).find(([,d])=>d.local.id===data.id),create=path.endsWith('/create'),id=previous?.[0]||(create?crypto.randomUUID():String(data.id)),old=previous?.[1];
      if(!create&&!old&&!current.annotations.some(n=>n.id===data.id))throw new Error('원본 메모를 찾지 못했습니다.');
      let comment=data.comment;try{const doc=JSON.parse(comment||'{"type":"doc","content":[]}');if(create||old?.op==='create')doc.kavitaOfflineId=id;comment=JSON.stringify(doc);}catch{}
      result={...data,id:create?Math.min(0,...notes(current).map(n=>n.id))-1:data.id,clientId:old?.local.clientId||(create?id:undefined),ownerUserId:user.id,ownerUsername:user.username,comment};
      return {...current,nativeIds:create?{...current.nativeIds,[result.id]:id}:current.nativeIds,drafts:{...current.drafts,[id]:{...old,op:create||old?.op==='create'?'create':'update',local:result,base:old?.base||current.annotations.find(n=>n.id===data.id)||null,rev:(old?.rev||0)+1}}};
    });return response(result);
  }
  if(path==='/api/annotation'&&request.method==='DELETE'){
    const requested=Number(url.searchParams.get('annotationId')),note=resolveNote(requested),id=note?.id;if(!note||note.ownerUserId&&note.ownerUserId!==user.id)return response({},403);
    await change(key,current=>{const drafts={...current.drafts},entry=Object.entries(drafts).find(([,d])=>d.local.id===id),op=entry?.[0]||String(id),old=entry?.[1];if(old?.op==='create'&&!old.attempt)delete drafts[op];else drafts[op]={...old,op:'delete',local:note,base:old?.base||current.annotations.find(n=>n.id===id),rev:(old?.rev||0)+1};return {...current,drafts};});return response('',200,'text/plain');
  }
  return response({error:'이 설정은 온라인에서 변경하세요. 읽기 위치와 메모는 기기에 보관됩니다.'},503);
}
function workerMessage(worker,message,timeout){
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('오프라인 리더 응답 시간이 초과되었습니다.'));},timeout);
    channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
    try{worker.postMessage(message,[channel.port2]);}catch(error){clearTimeout(timer);channel.port1.close();reject(error);}
  });
}
export async function nativeWorker(status=()=>{}){
  const registration=await navigator.serviceWorker.ready;
  async function inspect(){const controller=navigator.serviceWorker.controller;if(!controller)return null;try{const info=await workerMessage(controller,{type:'KAVITA_NATIVE_STATUS'},1500);if(info.nativeProtocol===1)return {controller,...info};}catch{}return null;}
  let current=await inspect();if(current)return current;
  if(!navigator.onLine)return null;
  status('오프라인 리더 업데이트를 확인하는 중…');
  await registration.update();
  const deadline=Date.now()+25000;
  while(Date.now()<deadline){
    current=await inspect();if(current)return current;
    await new Promise(resolve=>{const timer=setTimeout(done,300);function done(){clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',done);resolve();}navigator.serviceWorker.addEventListener('controllerchange',done,{once:true});});
  }
  throw new Error('오프라인 리더 업데이트를 완료하지 못했습니다. 인터넷 연결 후 새로고침하여 다시 열어주세요. 저장한 책과 변경은 유지됩니다.');
}
export async function prepareNative(book,status=()=>{}){
  const active=await nativeWorker(status);
  if(book.native?.ready&&active?.shellReady)return true;
  if(!navigator.onLine)return false;
  if(!active)throw new Error('오프라인 리더를 업데이트한 뒤 다시 시도하세요.');
  // A fixture/older server without the Angular shell keeps the recoverable
  // legacy reader. Actual Kavita must successfully render before being marked.
  const shell=await network('/',{cache:'no-store'});const html=await shell.text();if(!html.includes('app-root'))return false;
  status('기존 Kavita 리더를 오프라인용으로 준비 중…');
  // A worker can change while files are being downloaded. Only navigate
  // after the worker that now controls this tab has finished its own cache.
  for(let attempt=0;attempt<3;attempt++){
    const current=await nativeWorker(status),result=await workerMessage(current.controller,{type:'KAVITA_NATIVE_PRECACHE'},90000);
    if(!result.ok)throw new Error(result.error||'리더 파일 저장 실패');
    if(current.controller===navigator.serviceWorker.controller)break;
    if(attempt===2)throw new Error('리더 업데이트 중입니다. 저장한 책을 다시 열어주세요.');
  }
  // Kavita's frame-ancestors 'none' is kept intact. Warm the original
  // application as a top-level page instead of weakening its framing policy.
  location.assign(nativeURL(book)+'&kv-prepare=1');
  return new Promise(()=>{});
}
export async function finishNativePreparation(){
  const chapter=Number(location.pathname.split('/').at(-1)),key=accountKey(chapter),book=await get('books',key);
  if(!book||book.account!==identity()?.key)throw new Error('저장한 책과 계정을 확인하세요.');
  const state=await get('states',key),snapshot=state.nativeResponses?.[requestKey('/api/series/chapter?chapterId='+chapter)]||book.native?.responses?.[requestKey('/api/series/chapter?chapterId='+chapter)];
  if(!snapshot||revision(JSON.parse(snapshot.body))!==book.revision)throw new Error('저장한 책과 서버의 책 버전이 다릅니다. 변경을 보관한 뒤 다시 저장하세요.');
  await updateBook(key,b=>({...b,native:{...b.native,ready:true}}));
  location.replace(nativeURL(book));
}
