// Account-scoped durable storage. No JWTs, API keys or cookies are stored here.
const dbName='kavita-offline-v1';
let connection;
export function identity(){
  let user;try{user=JSON.parse(localStorage.getItem('kavita-user')||'null');}catch{}
  if(!user||!Number.isInteger(user.id)||!user.username)return null;
  return {key:String(user.id),id:user.id,username:user.username,token:user.token||''};
}
export function accountKey(chapterId){const user=identity();if(!user)throw new Error('먼저 온라인 Kavita에 로그인하세요.');return `${user.key}:${Number(chapterId)}`;}
async function db(){
  if(!connection)connection=new Promise((resolve,reject)=>{
    const request=indexedDB.open(dbName,1);
    request.onupgradeneeded=()=>{for(const name of ['books','states'])request.result.createObjectStore(name,{keyPath:'key'});};
    request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();connection=null;};resolve(request.result);};
    request.onerror=()=>{connection=null;reject(request.error);};
    request.onblocked=()=>reject(new Error('다른 탭의 오프라인 화면을 닫고 다시 시도하세요.'));
  });return connection;
}
export async function get(store,key){return new Promise(async(resolve,reject)=>{try{const tx=(await db()).transaction(store),r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}catch(e){reject(e);}});}
export async function list(store){return new Promise(async(resolve,reject)=>{try{const r=(await db()).transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}catch(e){reject(e);}});}
export async function change(key,fn){
  const database=await db();return new Promise((resolve,reject)=>{
    const tx=database.transaction('states','readwrite'),store=tx.objectStore('states'),r=store.get(key);let result;
    r.onsuccess=()=>{try{result=fn(r.result);if(result)store.put(result);}catch(error){tx.abort();reject(error);}};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('기기에 저장하지 못했습니다. 저장 공간을 확인하세요.'));
  });
}
export async function commitBook(book,state){
  const database=await db();return new Promise((resolve,reject)=>{
    const tx=database.transaction(['books','states'],'readwrite'),r=tx.objectStore('states').get(book.key);
    r.onsuccess=()=>{
      if(r.result&&pending(r.result)){tx.abort();reject(new Error('미동기화 변경을 먼저 동기화하거나 내보내세요.'));return;}
      tx.objectStore('books').put(book);tx.objectStore('states').put(state);
    };
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('책 저장을 완료하지 못했습니다. 저장 공간을 확인하세요.'));
  });
}
export async function removeBook(key){
  const database=await db();return new Promise((resolve,reject)=>{
    const tx=database.transaction(['books','states'],'readwrite'),r=tx.objectStore('states').get(key);
    r.onsuccess=()=>{if(pending(r.result)){tx.abort();reject(new Error('미동기화 변경이 있어 삭제하지 않았습니다. 먼저 동기화하세요.'));return;}tx.objectStore('states').delete(key);tx.objectStore('books').delete(key);};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('삭제를 완료하지 못했습니다.'));
  });
}
export const pending=state=>!!(state&&(state.dirty||Object.keys(state.drafts||{}).length));
export async function myBooks(){const user=identity();return user?(await list('books')).filter(book=>book.account===user.key):[];}
export async function myStates(){const user=identity();return user?(await list('states')).filter(state=>state.account===user.key):[];}
export function samePosition(a,b){return Number(a?.pageNum||0)===Number(b?.pageNum||0)&&(a?.bookScrollId||'')===(b?.bookScrollId||'');}
export function editFields(a){return JSON.stringify([a?.comment||'',a?.commentHtml||'',!!a?.containsSpoiler,a?.selectedSlotIndex??0]);}
export function revision(chapter){return JSON.stringify((chapter.files||[]).map(file=>[file.id,file.bytes,file.pages,file.createdUtc||file.created||'']));}
export async function api(path,{method='GET',body,account,signal}={}){
  const user=identity();if(!user||account&&user.key!==account)throw new Error('계정이 바뀌었습니다. 해당 계정으로 로그인한 후 다시 시도하세요.');
  if(!user.token)throw new Error('온라인 로그인이 필요합니다. 기기의 변경은 보관됩니다.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  try{
    const response=await fetch(path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{Authorization:`Bearer ${user.token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},credentials:'same-origin',cache:'no-store',signal:controller.signal});
    if(response.status===401||response.status===403)throw new Error('온라인 로그인 또는 권한 확인이 필요합니다. 미동기화 변경은 기기에 보관됩니다.');
    if(!response.ok){const error=new Error(`서버 요청 실패 (${response.status}). 변경은 기기에 보관됩니다.`);error.status=response.status;throw error;}
    if(identity()?.key!==user.key)throw new Error('요청 중 계정이 바뀌어 처리를 중단했습니다.');
    return response;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export async function json(path,options){return (await api(path,options)).json();}
export function noteDocument(text,id){return JSON.stringify({type:'doc',...(id?{kavitaOfflineId:id}:{}),content:text.split('\n').map(line=>({type:'paragraph',...(line?{content:[{type:'text',text:line}]}:{})}))});}
export function noteHtml(text){const div=document.createElement('div');div.textContent=text;return '<p>'+div.innerHTML.replace(/\n/g,'<br>')+'</p>';}
export function createId(annotation){try{return JSON.parse(annotation.comment).kavitaOfflineId||null;}catch{return null;}}
