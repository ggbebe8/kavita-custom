import {identity,accountKey,get,commitBook,pending,json,api,revision} from './store.js';
const sensitive=['apiKey','apikey','access_token','token','refreshToken'];
export function cleanURL(value,base=location.href){
  const url=new URL(value,base);for(const name of sensitive)url.searchParams.delete(name);return url.href;
}
function cssURLs(css){return [...css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)|@import\s+(['"])(.*?)\3/g)].map(m=>m[2]||m[4]).filter(Boolean);}
export async function downloadBook(chapterId,{status=()=>{},signal}={}){
  const user=identity();if(!user)throw new Error('온라인 Kavita에서 먼저 로그인하세요.');
  const account=user.key,key=accountKey(chapterId);
  if(pending(await get('states',key)))throw new Error('이 책의 미동기화 변경을 먼저 동기화하세요.');
  const info=await json(`/api/book/${chapterId}/book-info`,{account,signal});
  if(info.seriesFormat!==3||!Number.isInteger(info.pages)||info.pages<1)throw new Error('현재 EPUB 책만 오프라인 저장을 지원합니다.');
  const chapter=await json(`/api/series/chapter?chapterId=${chapterId}`,{account,signal});
  const baseProgress=await json(`/api/reader/get-progress?chapterId=${chapterId}`,{account,signal});
  const annotations=await json(`/api/annotation/all?chapterId=${chapterId}`,{account,signal});
  if(!Array.isArray(annotations))throw new Error('메모 정보를 받지 못했습니다.');
  const resources=new Map(),sections=[],assets=[],warnings=[];
  function resource(raw,base){
    if(!raw||raw.startsWith('#')||/^(data:|blob:)/i.test(raw))return raw;
    const url=cleanURL(raw,base);
    if(new URL(url).origin!==location.origin)throw new Error('외부 이미지·글꼴이 포함되어 책 저장을 완료하지 못했습니다.');
    const key=new URL(url);key.hash='';if(!resources.has(key.href))resources.set(key.href,null);return url;
  }
  function rewriteCSS(css,base){
    return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g,(all,q,raw)=>`url("${resource(raw,base).replaceAll('"','%22')}")`).replace(/@import\s+(['"])(.*?)\1/g,(all,q,raw)=>`@import "${resource(raw,base).replaceAll('"','%22')}"`);
  }
  for(let index=0;index<info.pages;index++){
    status(`책 저장 중 ${index+1} / ${info.pages} 구간`);
    const response=await api(`/api/book/${chapterId}/book-page?page=${index}`,{account,signal});
    let html=await response.text();if(response.headers.get('content-type')?.includes('application/json'))html=JSON.parse(html);
    if(typeof html!=='string')throw new Error('본문을 받지 못했습니다.');
    const doc=new DOMParser().parseFromString('<!doctype html><html><head></head><body>'+html+'</body></html>','text/html');
    // Inert iframe rendering also has a CSP. Strip active content now so it is
    // never stored or capable of navigating back to the application's origin.
    doc.querySelectorAll('script,iframe,object,embed,form,base,meta,video,audio,source,track').forEach(node=>node.remove());
    for(const node of doc.querySelectorAll('*')){
      for(const attr of [...node.attributes]){
        if(/^on/i.test(attr.name)||['srcdoc','formaction','action'].includes(attr.name))node.removeAttribute(attr.name);
      }
      if(node.hasAttribute('src'))node.setAttribute('src',resource(node.getAttribute('src'),location.href));
      if(node.hasAttribute('srcset')){
        // Preserve the default src; fetch the selected alternatives rather than
        // accepting an apparently complete book with missing high-DPI images.
        const set=node.getAttribute('srcset');
        if(!set.trim().startsWith('data:'))node.setAttribute('srcset',set.split(',').map(item=>{const [url,...size]=item.trim().split(/\s+/);return [resource(url,location.href),...size].join(' ');}).join(', '));
      }
      for(const name of ['href','xlink:href'])if(node.hasAttribute(name)){
        const value=node.getAttribute(name);
        if(['image','use'].includes(node.tagName.toLowerCase())||node.tagName==='LINK')node.setAttribute(name,resource(value,location.href));
        else if(value&&!value.startsWith('#')){try{node.setAttribute(name,cleanURL(value));}catch{node.removeAttribute(name);}}
      }
      if(node.hasAttribute('style'))node.setAttribute('style',rewriteCSS(node.getAttribute('style'),location.href));
      if(node.tagName==='STYLE')node.textContent=rewriteCSS(node.textContent,location.href);
    }
    // Kavita page responses are fragments with the EPUB wrapper as first child.
    sections.push(doc.body.innerHTML);
  }
  for(const [url] of resources){
    status(`이미지·글꼴 저장 중 ${assets.length+1} / ${resources.size}`);
    let response;
    try{response=await api(url,{account,signal});}catch(error){
      const file=new URL(url).searchParams.get('file')||new URL(url).pathname;
      if([400,404].includes(error.status)&&/\.(ttf|otf|woff2?|eot)$/i.test(file)){
        const blob=new Blob([],{type:'font/ttf'});resources.set(url,blob);assets.push({url,blob});warnings.push('없는 글꼴 대신 기본 글꼴을 사용합니다.');continue;
      }throw error;
    }
    let blob=await response.blob();
    const type=response.headers.get('content-type')||blob.type;
    if(type.includes('text/html')||type.includes('application/json'))throw new Error('이미지·글꼴 리소스 대신 오류 응답을 받았습니다.');
    if(type.includes('text/css')||new URL(url).pathname.endsWith('.css')){
      const css=rewriteCSS(await blob.text(),url);blob=new Blob([css],{type:'text/css'});
    }
    resources.set(url,blob);assets.push({url,blob});
  }
  if(signal?.aborted)throw new DOMException('Download cancelled','AbortError');
  if(identity()?.key!==account)throw new Error('계정이 바뀌어 저장을 중단했습니다.');
  // Detect a library rescan/replacement while the content was being saved.
  const after=await json(`/api/series/chapter?chapterId=${chapterId}`,{account,signal});
  if(revision(after)!==revision(chapter))throw new Error('저장 중 책 파일이 변경되었습니다. 다시 저장하세요.');
  const metadata={chapterId:Number(chapterId),libraryId:info.libraryId,seriesId:info.seriesId,volumeId:info.volumeId};
  const book={key,account,chapterId:Number(chapterId),title:info.bookTitle||info.seriesName||'EPUB',metadata,sections,assets,warnings,revision:revision(chapter),savedAt:Date.now(),bytes:assets.reduce((n,item)=>n+item.blob.size,0)+sections.reduce((n,text)=>n+new Blob([text]).size,0)};
  const check=await materialize(book);check.dispose();
  await commitBook(book,{key,account,progress:{...metadata,...baseProgress},baseProgress,annotations,drafts:{},dirty:false,revision:0,view:null});
  // The browser may reject persistent storage; a saved book still works but is
  // subject to the browser's normal eviction policy.
  let persistent=false,timer;
  // Firefox can leave the permission prompt pending indefinitely. The book
  // transaction has already committed; optional eviction protection must not
  // prevent the reader from opening. Late rejection remains handled.
  try{persistent=await Promise.race([Promise.resolve(navigator.storage?.persist?.()).catch(()=>false),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1000);})])||false;}catch{}finally{clearTimeout(timer);}
  status((persistent?'책 저장 완료':'책 저장 완료 · 브라우저 저장 공간 정리 시 삭제될 수 있습니다.')+(warnings.length?' 일부 글꼴은 기본 글꼴로 표시합니다.':''));return book;
}
export function rewriteAssets(html,urls){
  // Stored URLs have no credentials. Resolve nested CSS dependencies before
  // using this replacement for the document itself.
  for(const [url,blobURL] of [...urls].sort((a,b)=>b[0].length-a[0].length))html=html.split(url).join(blobURL);
  return html;
}
export async function materialize(book){
  const urls=new Map(),pendingCSS=[];
  for(const item of book.assets){if(item.blob.type.includes('text/css'))pendingCSS.push(item);else urls.set(item.url,URL.createObjectURL(item.blob));}
  // CSS @imports are acyclic in normal EPUBs. Cyclic imports cannot be fully
  // embedded; fail rather than leave a hidden network dependency.
  for(let pass=0;pendingCSS.length&&pass<=book.assets.length;pass++)for(let index=pendingCSS.length-1;index>=0;index--){
    const item=pendingCSS[index],text=await item.blob.text();
    if(cssURLs(text).some(url=>pendingCSS.some(other=>other.url===url)&&!urls.has(url)))continue;
    urls.set(item.url,URL.createObjectURL(new Blob([rewriteAssets(text,urls)],{type:'text/css'})));pendingCSS.splice(index,1);
  }
  if(pendingCSS.length){for(const url of urls.values())URL.revokeObjectURL(url);throw new Error('순환 CSS 참조가 있어 오프라인으로 표시하지 못했습니다.');}
  return {urls,dispose:()=>{for(const url of urls.values())URL.revokeObjectURL(url);}};
}
