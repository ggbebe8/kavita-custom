const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {chromium}=require('playwright');
const root=path.resolve('proxy/pwa/offline');
let progress={libraryId:1,seriesId:1,volumeId:1,chapterId:1,pageNum:0,bookScrollId:'//body/p[1]',lastModifiedUtc:'initial'};
let annotations=[],nextId=1,writes=[],lostCreate=false,deny=false,revision=100,progressGate=null;
const bookInfo={pages:3,seriesFormat:3,bookTitle:'오프라인 테스트 책',libraryId:1,seriesId:1,volumeId:1};
const section=index=>`<div><style>.book-content p{font-size:18px;line-height:1.7}.illustration{background-image:url('/api/book/1/book-resources?file=cover.svg&apiKey=must-not-persist')}</style><p id="para${index}">${'테스트 본문을 읽습니다. '.repeat(800)}</p><img src="/api/book/1/book-resources?file=cover.svg&apiKey=must-not-persist"><link rel="stylesheet" href="/api/book/1/book-resources?file=style.css"></div>`;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const send=(type,body,status=200)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);};
 if(url.pathname.startsWith('/api/')){
  if(deny)return send('application/json','{}',401);
  if(req.headers.authorization!=='Bearer fixture-token')return send('application/json','{}',401);
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;
  if(url.pathname==='/api/book/1/book-info')return send('application/json',JSON.stringify(bookInfo));
  if(url.pathname==='/api/series/chapter')return send('application/json',JSON.stringify({files:[{id:1,bytes:revision,pages:3,createdUtc:'fixed'}]}));
  if(url.pathname==='/api/book/1/book-page')return send('text/html; charset=utf-8',section(Number(url.searchParams.get('page'))));
  if(url.pathname==='/api/book/1/book-resources'){
   if(url.searchParams.get('file')==='style.css')return send('text/css','p{color:#222} .figure{background:url("/api/book/1/book-resources?file=tile.svg")}');
   return send('image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="red"/></svg>');
  }
  if(url.pathname==='/api/reader/get-progress')return send('application/json',JSON.stringify(progress));
  if(url.pathname==='/api/reader/progress'){progress={...body,lastModifiedUtc:String(Date.now())};writes.push({type:'progress',body});if(progressGate)await progressGate;return send('text/plain','');}
  if(url.pathname==='/api/annotation/all')return send('application/json',JSON.stringify(annotations));
  if(url.pathname==='/api/annotation/create'){
   if(!Number.isInteger(body.id)||body.id<0||body.id>2147483647)return send('application/json','{}',400);
   const note={...body,id:nextId++,lastModifiedUtc:String(Date.now())};annotations.push(note);writes.push({type:'create',body});
   if(lostCreate){lostCreate=false;return send('application/json','{}',503);}
   return send('application/json',JSON.stringify(note));
  }
  if(url.pathname==='/api/annotation/update'){
   const note={...body,lastModifiedUtc:String(Date.now())};annotations=annotations.map(a=>a.id===body.id?note:a);writes.push({type:'update',body});return send('application/json',JSON.stringify(note));
  }
  if(url.pathname==='/api/annotation'&&req.method==='DELETE'){annotations=annotations.filter(a=>a.id!==Number(url.searchParams.get('annotationId')));writes.push({type:'delete'});return send('text/plain','');}
  if(/^\/api\/annotation\/\d+$/.test(url.pathname)){const note=annotations.find(a=>a.id===Number(url.pathname.split('/').at(-1)));return send('application/json',JSON.stringify(note||{}),note?200:404);}
  return send('application/json','{}',404);
 }
 let file;
 if(url.pathname==='/kavita-offline-sw.js'){res.setHeader('Service-Worker-Allowed','/');file=path.join(root,'worker.js');}
 else if(url.pathname.startsWith('/kavita-pwa/offline/'))file=path.join(root,url.pathname.slice('/kavita-pwa/offline/'.length));
 else if(url.pathname==='/site.webmanifest')return send('application/manifest+json','{}');
 else return send('text/html; charset=utf-8','<!doctype html><meta charset="utf-8"><title>Online fixture</title>Online');
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return send('text/plain','missing',404);
 return send(file.endsWith('.js')?'application/javascript; charset=utf-8':file.endsWith('.css')?'text/css':'text/html; charset=utf-8',fs.readFileSync(file));
});
async function until(check){const deadline=Date.now()+15000;while(!await check()){if(Date.now()>deadline)throw new Error('State did not settle');await new Promise(r=>setTimeout(r,50));}}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true});
  await context.addInitScript(()=>{if(!localStorage.getItem('kavita-user'))localStorage.setItem('kavita-user',JSON.stringify({id:101,username:'reader',token:'fixture-token'}));});
  // A pending Firefox storage permission must not block a committed book.
  await context.addInitScript(()=>Object.defineProperty(navigator.storage,'persist',{value:()=>new Promise(()=>{})}));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/kavita-pwa/offline/index.html?download=1');
  await page.getByRole('button',{name:'이 책을 오프라인으로 저장',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('reader').hidden);
  await page.waitForFunction(()=>document.getElementById('page').textContent.includes('화면'));
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const snapshot=await page.evaluate(async()=>{const store=await import('/kavita-pwa/offline/store.js');const book=await store.get('books','101:1');return {sections:book.sections.length,assets:book.assets.length,raw:JSON.stringify(book)};});
  assert.equal(snapshot.sections,3);assert.ok(snapshot.assets>=3,'nested CSS dependencies and image resources saved');assert.ok(!snapshot.raw.includes('must-not-persist'),'API query secrets never enter saved content');assert.ok(!snapshot.raw.includes('fixture-token'),'JWT never enters offline storage');
  assert.equal(writes.length,0,'downloading and opening does not write reading progress');
  await context.setOffline(true);
  await page.goto(origin+'/'); // Real service-worker navigation fallback, not a routed fake.
  await page.getByRole('button',{name:'읽기',exact:true}).click();await page.waitForFunction(()=>document.getElementById('page').textContent.includes('화면'));
  await page.getByRole('button',{name:'다음 페이지',exact:true}).click();await page.waitForFunction(()=>document.getElementById('page').textContent.includes('화면 2/'));
  await page.waitForFunction(async()=>{const s=await import('/kavita-pwa/offline/store.js');return (await s.get('states','101:1')).dirty;});
  assert.equal(writes.length,0);
  const selected=await page.evaluate(()=>{
   const doc=document.getElementById('frame').contentDocument,node=doc.querySelector('p').firstChild,range=doc.createRange();range.setStart(node,4);range.setEnd(node,12);const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString();
  });
  await page.getByRole('button',{name:'선택한 글에 메모'}).click();await page.locator('#comment').fill('오프라인 메모입니다.');await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForFunction(async()=>{const s=await import('/kavita-pwa/offline/store.js');return Object.keys((await s.get('states','101:1')).drafts).length===1;});
  const local=await page.evaluate(async()=>{const s=await import('/kavita-pwa/offline/store.js');return s.get('states','101:1');});
  assert.ok(local.progress.bookScrollId.includes('kvoffline1:'),'semantic character anchor saved for native reader restoration');assert.equal(Object.values(local.drafts)[0].local.selectedText,selected);
  await page.reload();await page.getByRole('button',{name:'읽기',exact:true}).click();await page.waitForFunction(()=>document.getElementById('page').textContent.includes('화면 2/'));
  await page.getByRole('button',{name:'메모',exact:true}).click();assert.equal(await page.locator('#notes-list').getByText('오프라인 메모입니다.',{exact:true}).count(),1);await page.getByRole('button',{name:'닫기',exact:true}).click();
  progress={...progress,pageNum:1,bookScrollId:'//body/p[1]'}; // Another device advanced while offline.
  await context.setOffline(false);await page.locator('.kv-offline-conflict').waitFor();assert.equal(writes.length,0,'conflict is checked before any stale progress write');
  await page.getByRole('button',{name:'기기 내용 사용',exact:true}).click();
  await until(async()=>page.evaluate(async()=>{const s=await import('/kavita-pwa/offline/store.js');const current=await s.get('states','101:1');return !!current&&!current.dirty&&Object.keys(current.drafts).length===0;}));
  assert.equal(writes.filter(w=>w.type==='progress').length,1);assert.equal(annotations.length,1);assert.equal(annotations[0].selectedText,selected);assert.ok(annotations[0].comment.includes('kavitaOfflineId'));
  // Core retry/conflict tests run without app background timers or automatic sync.
  const core=await context.newPage();await core.goto(origin+'/');await core.evaluate(async()=>{window.__kavitaPageIndicatorInstalled=true;window.__kavitaOfflineFetch=window.fetch.bind(window);window.readerHookCalls=0;window.fetch=async()=>{window.readerHookCalls++;throw new Error('Background sync must bypass native reader hooks');};window.store=await import('/kavita-pwa/offline/store.js');window.syncer=await import('/kavita-pwa/offline/sync.js');});
  await page.close();
  await core.evaluate(async()=>{const key='101:1';await store.change(key,s=>({...s,drafts:{newnote:{op:'create',rev:1,base:null,local:{...s.annotations[0],id:0,selectedText:'추가 메모',comment:store.noteDocument('중복 방지','newnote'),commentHtml:'<p>중복 방지</p>',commentPlainText:'중복 방지'}}}}));});
  lostCreate=true;await core.evaluate(()=>syncer.syncAll({status:()=>{}}));assert.equal(annotations.length,2);
  assert.equal(await core.evaluate(async()=>store.pending(await store.get('states','101:1'))),true,'lost POST acknowledgement retains intent');
  await core.evaluate(()=>store.change('101:1',s=>({...s,drafts:{...s.drafts,newnote:{...s.drafts.newnote,rev:2,local:{...s.drafts.newnote.local,comment:store.noteDocument('미확인 응답 후 수정','newnote'),commentHtml:'<p>미확인 응답 후 수정</p>',commentPlainText:'미확인 응답 후 수정'}}}})));
  await core.evaluate(()=>syncer.syncAll({status:()=>{}}));assert.equal(annotations.length,2,'retry finds same client operation marker, never duplicates');
  assert.equal(annotations.find(a=>a.selectedText==='추가 메모').commentPlainText,'미확인 응답 후 수정','edits after a lost create response must survive retry');
  assert.equal(await core.evaluate(async()=>store.pending(await store.get('states','101:1'))),false);
  // Same note edited in both places: keep the server copy without another POST.
  await core.evaluate(async()=>{await store.change('101:1',s=>{const base=s.annotations[0];return {...s,drafts:{[base.id]:{op:'update',rev:1,base,local:{...base,comment:store.noteDocument('기기 수정'),commentHtml:'<p>기기 수정</p>',commentPlainText:'기기 수정'}}}};});});
  annotations[0]={...annotations[0],comment:'server-edited',commentHtml:'<p>서버 수정</p>',commentPlainText:'서버 수정'};
  const before=writes.length;const conflicts=await core.evaluate(async()=>{const types=[];await syncer.syncAll({ask:async c=>{types.push(c.kind);return 'remote';}});return types;});assert.deepEqual(conflicts,['note']);assert.equal(writes.length,before);
  // Local deletion is replayed once and disappears from the local snapshot.
  await core.evaluate(()=>store.change('101:1',s=>{const note=s.annotations[0];return {...s,drafts:{[note.id]:{op:'delete',rev:1,base:note,local:note}}};}));
  await core.evaluate(()=>syncer.syncAll());assert.equal(annotations.length,1);
  // Progress edited while its earlier POST is in flight stays dirty and is
  // replayed later rather than being cleared by the old acknowledgement.
  await core.evaluate(()=>store.change('101:1',s=>({...s,progress:{...s.progress,pageNum:1,bookScrollId:'//body/p[2]'},dirty:true,revision:s.revision+1})));
  let release;progressGate=new Promise(r=>release=r);const sentCount=writes.filter(w=>w.type==='progress').length;
  const inFlight=core.evaluate(()=>syncer.syncAll());await until(()=>writes.filter(w=>w.type==='progress').length>sentCount);
  await core.evaluate(()=>store.change('101:1',s=>({...s,progress:{...s.progress,pageNum:2,bookScrollId:'//body/p[3]'},dirty:true,revision:s.revision+1})));
  release();progressGate=null;await inFlight;
  assert.equal(await core.evaluate(async()=>(await store.get('states','101:1')).dirty),true);
  await core.evaluate(()=>syncer.syncAll());assert.equal(progress.pageNum,2);
  // Choosing the remote position never submits the stale local page.
  await core.evaluate(()=>store.change('101:1',s=>({...s,progress:{...s.progress,pageNum:0},dirty:true,revision:s.revision+1})));
  progress={...progress,pageNum:1,bookScrollId:'//body/p[4]'};const keepRemoteCount=writes.length;
  await core.evaluate(()=>syncer.syncAll({ask:async()=> 'remote'}));assert.equal(writes.length,keepRemoteCount);
  assert.equal(await core.evaluate(async()=>(await store.get('states','101:1')).progress.bookScrollId),'//body/p[4]');
  // Multiple app windows cannot duplicate one queued annotation.
  await core.evaluate(async()=>{await store.change('101:1',s=>({...s,drafts:{parallel:{op:'create',rev:1,base:null,local:{...s.annotations[0],id:0,selectedText:'병렬 메모',comment:store.noteDocument('한 번만','parallel'),commentHtml:'<p>한 번만</p>'}}}}));});
  const other=await context.newPage();await other.goto(origin+'/');await other.evaluate(async()=>{window.syncer=await import('/kavita-pwa/offline/sync.js');});
  await Promise.all([core.evaluate(()=>syncer.syncAll()),other.evaluate(()=>syncer.syncAll())]);assert.equal(annotations.filter(a=>a.selectedText==='병렬 메모').length,1);
  assert.equal(await core.evaluate(()=>readerHookCalls),0,'background API requests bypass native reader progress and resume hooks');
  assert.equal(await core.evaluate(async()=>{const transport=window.__kavitaOfflineFetch;delete window.__kavitaOfflineFetch;try{await store.json('/api/reader/get-progress?chapterId=1');return false;}catch(error){return error.message.includes('새로고침');}finally{window.__kavitaOfflineFetch=transport;}}),true,'old native tabs must retain drafts and request refresh rather than rewrite a sync payload');
  // Authentication failure and changed editions retain all local progress.
  await core.evaluate(()=>store.change('101:1',s=>({...s,progress:{...s.progress,pageNum:2},dirty:true,revision:s.revision+1})));
  deny=true;await core.evaluate(()=>syncer.syncAll());assert.equal(await core.evaluate(async()=>(await store.get('states','101:1')).dirty),true);deny=false;
  revision=999;await core.evaluate(()=>syncer.syncAll());assert.equal(await core.evaluate(async()=>(await store.get('states','101:1')).dirty),true);revision=100;
  assert.equal(await core.evaluate(async()=>{try{await store.removeBook('101:1');return false;}catch{return true;}}),true,'pending data prevents deletion');
  await core.evaluate(()=>localStorage.setItem('kavita-user',JSON.stringify({id:202,username:'other',token:'fixture-token'})));
  assert.equal(await core.evaluate(async()=>(await store.myBooks()).length),0,'different accounts cannot see another account bookshelf');
  assert.deepEqual(errors,[]);
  console.log('Offline Chromium passed: full save with nested resources, credential stripping, actual SW offline cold navigation, persisted reading/notes across reload, conflict-safe reconnect, lost create acknowledgement deduplication, note conflict, cross-tab lock, auth/edition failures retain drafts, deletion protection and account isolation. No real server data was modified.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
