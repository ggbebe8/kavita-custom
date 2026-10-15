// Server owns narration sequencing; this module only controls one audio stream
// and follows its sentence timeline while the reader is visible.
const BASE='/kavita-tts/v1';
const HIGHLIGHT='kavita-server-tts-current';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function credentials(){try{return JSON.parse(localStorage.getItem('kavita-user')||'null');}catch{return null;}}
async function request(path,options={}){
  const token=credentials()?.token;if(!token)throw new Error('Kavita에 다시 로그인하세요.');
  const response=await fetch(BASE+path,{...options,cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers},signal:options.signal||AbortSignal.timeout(30000)});
  let body;try{body=await response.json();}catch{throw new Error('서버 읽기를 사용할 수 없습니다. 브라우저 음성을 선택하거나 서버 상태를 확인하세요.');}
  if(!response.ok)throw new Error(body.error||'서버 읽기 요청에 실패했습니다.');return body;
}
export async function available(){
  try{const r=await fetch(BASE+'/status',{cache:'no-store',signal:AbortSignal.timeout(3000)});return r.ok&&(await r.json()).available===true;}catch{return false;}
}
function mappedText(content){
  const nodes=[],walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
    const node=walker.currentNode;if(!node.textContent.trim()||node.parentElement.closest('script,style,noscript,button,input,textarea,select,svg,audio,video,[hidden],[aria-hidden="true"],.bookmark-overlay,app-book-line-overlay'))continue;
    const css=getComputedStyle(node.parentElement);if(css.display==='none'||css.visibility==='hidden')continue;nodes.push(node);
  }
  let text='',points=[];
  for(const node of nodes){
    const raw=node.textContent;let first=0,last=raw.length;while(first<last&&/\s/.test(raw[first]))first++;while(last>first&&/\s/.test(raw[last-1]))last--;
    if(text){text+=' ';points.push(null);}
    for(let offset=first;offset<last;offset++){
      const char=raw[offset];if(/\s/.test(char)){if(text.endsWith(' '))continue;text+=' ';}else text+=char;
      points.push({node,offset});
    }
  }
  return {text,points};
}
export function create({root,announce,startText,stopBrowser}){
  const events=new AbortController();
  let current=null,starting=false,epoch=0,polling=false,following=false,expected=null,timer=null,lastChunk=null,lastBucket=-1,mapCache=null;
  const audio=document.createElement('audio');audio.preload='auto';audio.setAttribute('playsinline','');audio.dataset.kavitaServerTts='';document.body.append(audio);
  const style=document.createElement('style');style.textContent='::highlight(kavita-server-tts-current){background:#ffe066;color:#111}';document.head.append(style);
  function clear(){window.CSS?.highlights?.delete(HIGHLIGHT);document.getElementById('kavita-server-tts-highlight')?.remove();}
  function mediaState(){if(navigator.mediaSession)navigator.mediaSession.playbackState=current?(audio.paused?'paused':'playing'):'none';}
  async function pulse(){const owner=current;if(!owner)return;try{await request('/sessions/'+owner.id,{method:'POST',body:JSON.stringify({position:audio.currentTime||0,playing:!audio.paused,rate:audio.playbackRate})});}catch(error){if(current===owner)announce(error.message);}}
  function stop(message='읽기를 정지했습니다.'){
    epoch++;const owner=current;current=null;starting=false;clearTimeout(timer);audio.pause();audio.removeAttribute('src');audio.load();clear();lastChunk=null;mapCache=null;expected=null;mediaState();
    if(owner)void request('/sessions/'+owner.id,{method:'DELETE',keepalive:true}).catch(()=>{});
    announce(message);document.querySelectorAll('[data-kavita-tts]').forEach(n=>n.setAttribute('aria-label','본문 읽어주기'));
  }
  async function wait(check,id,timeout=20000){const until=performance.now()+timeout;while(!check()){if(id!==epoch||!root.isConnected||performance.now()>until)throw new Error('듣는 위치로 화면을 이동하지 못했습니다.');await delay(50);}}
  function menu(){const content=root.querySelector('.book-content');for(const type of ['mousedown','click'])content?.dispatchEvent(new MouseEvent(type,{bubbles:true,clientX:0,clientY:0}));}
  async function section(index,id){
    if(window.__kavitaReaderSection?.()?.index===index)return;
    document.querySelector('#kavita-tts-panel[open]')?.close();
    const restore=!!root.querySelector('.book-container.immersive')&&!root.querySelector('.reader-header');let modal;
    try{
      if(restore){root.classList.add('swipe-restoring-menu');menu();await delay(60);}
      const link=root.querySelector('.bottom-bar a.btn-link');if(!link)throw new Error('리더 페이지 이동 기능을 찾지 못했습니다.');link.click();
      await wait(()=>document.querySelector('ngb-modal-window app-confirm-dialog.confirm-prompt'),id,3000);
      modal=document.querySelector('ngb-modal-window app-confirm-dialog.confirm-prompt');
      const input=modal.querySelector('input'),button=modal.querySelector('.modal-footer .btn-primary');if(!input||!button)throw new Error('페이지 이동 기능을 사용할 수 없습니다.');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(index+1));input.dispatchEvent(new Event('input',{bubbles:true}));button.click();
      await wait(()=>window.__kavitaReaderSection?.()?.index===index&&!root.querySelector('.is-loading'),id);await delay(450);
    }finally{
      modal?.querySelector('.modal-footer .btn-secondary')?.click();
      if(restore&&root.isConnected&&root.querySelector('.reader-header'))menu();root.classList.remove('swipe-restoring-menu');
    }
  }
  async function follow(){
    if(!current||following||document.hidden||!current.chunks?.length)return;
    const chunk=current.chunks.find(c=>audio.currentTime>=c.start&&audio.currentTime<c.end);if(!chunk)return;
    // The model exposes sentence timings, not word alignment. Estimate a
    // character within that sentence to follow long sentences across columns.
    const character=Math.min(chunk.text.length-1,Math.floor(Math.max(0,audio.currentTime-chunk.start)/(chunk.end-chunk.start)*chunk.text.length));
    const bucket=Math.floor(character/16);if(chunk===lastChunk&&bucket===lastBucket)return;
    const id=epoch;following=true;
    try{
      if(window.__kavitaReaderSection?.()?.index!==chunk.section&&window.__kavitaBeforeNavigation&&!await window.__kavitaBeforeNavigation())return;
      if(id!==epoch)return;
      await section(chunk.section,id);if(id!==epoch)return;
      const content=root.querySelector('.book-content');
      if(mapCache?.content!==content||mapCache.section!==chunk.section||!mapCache.map.points.find(Boolean)?.node.isConnected)mapCache={content,section:chunk.section,map:mappedText(content)};
      const map=mapCache.map;
      let at=Number.isInteger(chunk.offset)&&map.text.slice(chunk.offset,chunk.offset+chunk.text.length)===chunk.text?chunk.offset:map.text.indexOf(chunk.text);
      if(at<0){announce('읽는 중 · 현재 문장 표시를 찾지 못했습니다.');return;}
      const start=map.points.slice(at,at+chunk.text.length).find(Boolean),end=map.points.slice(at,at+chunk.text.length).findLast(Boolean);if(!start||!end)return;
      const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset+1);
      const point=map.points.slice(at+character,at+chunk.text.length).find(Boolean)||end;
      const first=document.createRange();first.setStart(point.node,point.offset);first.setEnd(point.node,point.offset+1);
      const rect=first.getBoundingClientRect(),view=content.getBoundingClientRect(),vertical=content.classList.contains('writing-style-vertical');
      const column=root.querySelector('.reading-section.column-layout-1,.reading-section.column-layout-2'),css=getComputedStyle(content);
      const size=vertical?parseFloat(content.style.maxHeight)-20:(root.querySelector('.reader-container')?.offsetWidth||content.clientWidth)-2*(parseFloat(css.marginLeft)||0)+20;
      let left=content.scrollLeft,top=content.scrollTop;
      if(column&&size>0){if(vertical&&(rect.top<view.top||rect.top>=view.bottom))top=Math.max(0,Math.floor((top+rect.top-view.top+2)/size)*size);else if(!vertical&&(rect.left<view.left-1||rect.left>=view.right-1))left=Math.max(0,Math.floor((left+rect.left-view.left+2)/size)*size);}
      else if(rect.top<view.top||rect.top>=view.bottom)top=Math.max(0,top+rect.top-view.top);
      if(Math.abs(left-content.scrollLeft)>1||Math.abs(top-content.scrollTop)>1){
        if(window.__kavitaBeforeNavigation&&!await window.__kavitaBeforeNavigation())return;if(id!==epoch)return;
        expected={content,left,top};content.scrollTo({left,top,behavior:'instant'});content.dispatchEvent(new Event('scroll',{bubbles:true}));
      }
      clear();if(window.Highlight&&window.CSS?.highlights)CSS.highlights.set(HIGHLIGHT,new Highlight(range));
      else{const box=range.getClientRects()[0];if(box){const overlay=document.createElement('div');overlay.id='kavita-server-tts-highlight';overlay.style.cssText=`position:fixed;pointer-events:none;z-index:1000;background:#ffe06666;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;document.body.append(overlay);}}
      lastChunk=chunk;lastBucket=bucket;
    }catch(error){if(id===epoch){pause();announce(error.message);}}
    finally{following=false;}
  }
  async function poll(){
    const owner=current;if(!owner||polling)return;polling=true;
    try{const state=await request('/sessions/'+owner.id+'?after='+owner.chunks.length);if(current!==owner)return;owner.chunks.push(...state.chunks);owner.done=state.done;if(state.error){announce(state.error);owner.error=state.error;}await follow();}
    catch(error){if(current===owner)announce(error.message);}
    finally{polling=false;if(current&&!document.hidden)timer=setTimeout(poll,3000);}
  }
  async function start({voice=0,rate=1,language='ko'}={}){
    stopBrowser();stop();const id=epoch,info=window.__kavitaReaderSection?.();
    if(!info||!root.querySelector('.book-content')||root.querySelector('.is-loading')){announce('본문을 불러온 후 다시 재생하세요.');return;}
    if(new URLSearchParams(location.search).get('kv-offline')==='1'){announce('오프라인 저장본에서는 브라우저 음성을 선택하세요. 서버 읽기는 온라인 리더에서 사용합니다.');return;}
    starting=true;
    announce('서버 음성을 준비하는 중');
    try{
      const anchor=startText().replace(/\s+/g,' ').trim().slice(0,160);if(!anchor)throw new Error('읽을 수 있는 본문 텍스트가 없습니다.');
      const result=await request('/sessions',{method:'POST',body:JSON.stringify({chapterId:Number(info.id),section:info.index,anchor,voice:Number(voice),language})});
      if(id!==epoch){void request('/sessions/'+result.id,{method:'DELETE'}).catch(()=>{});return;}
      current={...result,chunks:[]};starting=false;audio.src=result.audio;audio.playbackRate=rate;
      if(navigator.mediaSession){navigator.mediaSession.metadata=new MediaMetadata({title:result.title,artist:'Kavita · 서버 읽기'});}
      void poll();await audio.play();if(id!==epoch)return;
      announce('서버 음성 재생 중 · 화면을 꺼도 이어 읽습니다.');document.querySelectorAll('[data-kavita-tts]').forEach(n=>n.setAttribute('aria-label','본문 읽어주기 · 재생 중'));
    }catch(error){if(id===epoch)stop(error.name==='NotAllowedError'?'재생 버튼을 다시 눌러주세요.':error.message);}
  }
  function pause(){if(starting){stop('재생 준비를 취소했습니다.');return;}audio.pause();void pulse();mediaState();}
  async function resume(){if(starting){announce('서버 음성을 준비하는 중');return;}try{await audio.play();void pulse();mediaState();announce('서버 음성 재생 중');}catch(error){announce('재생을 다시 눌러주세요.');}}
  function seek(delta){if(!current)return;const target=Math.max(0,audio.currentTime+delta);for(let i=0;i<audio.buffered.length;i++)if(target>=audio.buffered.start(i)&&target<=audio.buffered.end(i)){audio.currentTime=target;lastChunk=null;void follow();void pulse();return;}announce('아직 준비되지 않은 구간입니다.');}
  for(const [event,handler] of Object.entries({play:()=>{mediaState();void pulse();},pause:()=>{mediaState();if(current){void pulse();announce('일시정지 중');}},timeupdate:()=>{void follow();},ended:()=>stop(current?.error||'책의 읽기가 끝났습니다.'),error:()=>{if(current)stop('오디오 연결이 끊겼습니다. 현재 화면에서 다시 재생하세요.');}}))audio.addEventListener(event,handler);
  if(navigator.mediaSession)for(const [action,handler] of Object.entries({play:resume,pause,stop:()=>stop(),seekbackward:()=>seek(-15),seekforward:()=>seek(15)})){try{navigator.mediaSession.setActionHandler(action,handler);}catch{}}
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&current){lastChunk=null;void pulse();void poll();}},{signal:events.signal});
  document.addEventListener('kavita-page-navigation',event=>{if(current&&!event.kavitaTts)stop('페이지를 이동하여 읽기를 정지했습니다.');},{signal:events.signal});
  document.addEventListener('kavita-reading-conflict',()=>{if(current)pause();},{signal:events.signal});
  document.addEventListener('scroll',event=>{if(!current||following||event.target!==root.querySelector('.book-content'))return;if(expected?.content===event.target&&Math.abs(event.target.scrollLeft-expected.left)<2&&Math.abs(event.target.scrollTop-expected.top)<2)return;stop('페이지를 이동하여 읽기를 정지했습니다.');},{capture:true,signal:events.signal});
  const observer=new MutationObserver(()=>{if(!root.isConnected){stop();events.abort();observer.disconnect();audio.remove();style.remove();}});observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>{if(current)stop();},{signal:events.signal});
  return {start,pause,resume,stop,get active(){return !!current||starting;},get paused(){return audio.paused;},setRate(rate){audio.playbackRate=rate;void pulse();},audio};
}
