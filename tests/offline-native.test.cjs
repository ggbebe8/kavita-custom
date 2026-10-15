// Exercises the real worker bridge and durable native-reader writes without a server account.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve('proxy/pwa/offline');let apiNetwork=0,workerGeneration=0;
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');let file;
 if(u.pathname==='/main-fixture.js'||u.pathname==='/chunk-lazy-fixture.js'){res.writeHead(200,{'Content-Type':'application/javascript','Vary':'Accept'});res.end(u.pathname==='/main-fixture.js'?"window.nativeLazy=()=>import(`./chunk-lazy-fixture.js`);":"export const saved=true;");return;}
 if(u.pathname.startsWith('/api/')){apiNetwork++;res.writeHead(503);res.end();return;}
 if(u.pathname==='/kavita-offline-sw.js'){res.setHeader('Service-Worker-Allowed','/');file=path.join(root,'worker.js');}
 else if(u.pathname==='/kavita-swipe.js')file=path.resolve('proxy/swipe.js');
 else if(u.pathname.startsWith('/kavita-pwa/offline/'))file=path.join(root,u.pathname.slice('/kavita-pwa/offline/'.length));
 else{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><head><script src="/kavita-pwa/offline/native-bootstrap.js"></script><script defer src="/kavita-swipe.js"></script><script type="module" src="/main-fixture.js"></script></head><body><app-root>Reader fixture</app-root></body></html>');return;}
 if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(file.endsWith('/worker.js')?fs.readFileSync(file,'utf8').replace(/const VERSION='[^']+';/,`const VERSION='kavita-offline-shell-test-${workerGeneration}';`):fs.readFileSync(file));
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();try{
 const context=await browser.newContext();await context.addInitScript(()=>{if(!localStorage.getItem('kavita-user'))localStorage.setItem('kavita-user',JSON.stringify({id:101,username:'reader',token:'existing-token'}));});const page=await context.newPage();await page.goto(origin+'/library/1/series/1/book/1?kv-offline=1');
 await page.evaluate(async()=>{
  const s=await import('/kavita-pwa/offline/store.js');
  const progress={chapterId:1,libraryId:1,seriesId:1,volumeId:1,pageNum:0,bookScrollId:'//body/p[1]'};
  await s.commitBook({key:'101:1',account:'101',chapterId:1,metadata:progress,title:'Test',sections:['<div><p>Saved text</p><a href="javascript:alert(1)">unsafe</a><svg><animate attributeName="href" values="javascript:alert(1)"></animate></svg><img src="'+location.origin+'/api/book/1/book-resources?file=cover.svg"></div>'],assets:[{url:location.origin+'/api/book/1/book-resources?file=cover.svg',blob:new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"></svg>'],{type:'image/svg+xml'})}],native:{ready:true,responses:{}},revision:'[]'}, {key:'101:1',account:'101',progress,baseProgress:progress,annotations:[],drafts:{},dirty:false,revision:0});
  await navigator.serviceWorker.register('/kavita-offline-sw.js',{scope:'/'});await navigator.serviceWorker.ready;
 });await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await page.evaluate(()=>new Promise((resolve,reject)=>{const c=new MessageChannel();c.port1.onmessage=e=>e.data.ok?resolve():reject(new Error(e.data.error));navigator.serviceWorker.controller.postMessage({type:'KAVITA_NATIVE_PRECACHE'},[c.port2]);}));
 await context.setOffline(true);
 assert.equal(await page.evaluate(async()=>(await window.nativeLazy()).saved),true,'unvisited lazy chunks with Vary headers are available offline');
 const result=await page.evaluate(async()=>{
  const s=await import('/kavita-pwa/offline/store.js');
  const call=async(path,body,method='POST')=>{const r=await fetch('/api/'+path,{method,body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});return {status:r.status,text:await r.text()};};
  const progress=await call('reader/progress',{chapterId:1,pageNum:0,bookScrollId:'//body/p[1]'});
  const data={id:0,chapterId:1,libraryId:1,seriesId:1,volumeId:1,ownerUserId:101,xPath:'//body/p[1]',endingXPath:'//body/p[1]',selectedText:'Saved',comment:'{"type":"doc","content":[]}',commentHtml:'',commentPlainText:'',selectedSlotIndex:0};
  const created=JSON.parse((await call('annotation/create',data)).text);const first=await s.get('states','101:1');
  // Simulate successful reconnect acknowledgement while Angular retains the
  // earlier temporary ID, then edit through the original native API.
  await s.change('101:1',state=>({...state,annotations:[{...created,id:77}],drafts:{}}));
  const edited=await call('annotation/update',{...created,commentPlainText:'after sync'});
  const after=await s.get('states','101:1');
  const forbidden=await call('account/logout',{});
  const html=await(await fetch('/api/book/1/book-page?page=0')).text();
  if(html.includes('javascript:')||html.includes('<animate'))throw new Error('Unsafe EPUB markup survived');
  const imageURL=new DOMParser().parseFromString(html,'text/html').querySelector('img').src;
  const frame=document.createElement('iframe');document.body.append(frame);await new Promise(resolve=>{frame.onload=resolve;frame.srcdoc='<img src="'+imageURL+'">';});
  const img=frame.contentDocument.querySelector('img');if(!img.complete)await new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;});
  const cachesContainAPI=(await Promise.all((await caches.keys()).map(async key=>(await(await caches.open(key)).keys()).some(r=>new URL(r.url).pathname.startsWith('/api/'))))).some(Boolean);
  const imageWidth=img.naturalWidth;frame.remove();
  return {progress,created,first,edited,after,forbidden,imageWidth,cachesContainAPI};
 });
 assert.equal(result.progress.status,200);assert.ok(result.first.dirty);assert.ok(result.created.id<0);assert.equal(result.edited.status,200);assert.equal(Object.values(result.after.drafts)[0].local.id,77);assert.equal(Object.values(result.after.drafts)[0].op,'update');assert.equal(result.forbidden.status,503);assert.equal(result.imageWidth,40);assert.equal(result.cachesContainAPI,false);assert.equal(apiNetwork,0);
 await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);assert.equal(await page.evaluate(async()=>{const s=await import('/kavita-pwa/offline/store.js');return (await s.get('states','101:1')).dirty;}),true);
 // A worker update retains the native shell and existing device data.
 await page.evaluate(async()=>{const s=await import('/kavita-pwa/offline/store.js');await s.change('101:1',v=>({...v,dirty:false,drafts:{}}));});
 await context.setOffline(false);workerGeneration=1;
 await page.evaluate(()=>new Promise(async(resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Worker update timeout')),15000);navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timeout);resolve();},{once:true});await(await navigator.serviceWorker.getRegistration('/')).update();}));
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await page.waitForFunction(()=>!!window.__kavitaOfflineFetch);
 assert.ok(await page.locator('app-root').count(),'native application survives worker cache migration');
 assert.ok(await page.evaluate(async()=>{const s=await import('/kavita-pwa/offline/store.js');return !!await s.get('books','101:1');}));
 await page.evaluate(()=>localStorage.setItem('kavita-user',JSON.stringify({id:202,username:'other',token:'other-token'})));
 assert.equal(await page.evaluate(async()=> (await fetch('/api/reader/get-progress?chapterId=1')).status),404);
 console.log('Native offline passed: original API bridge, offline reload, durable progress/notes, post-sync temporary ID resolution, iframe images, denied unsupported writes, account isolation and no API HTTP cache/network writes.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
