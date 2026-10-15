const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve('proxy/pwa/offline');let legacy=true,writes=0;
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="blue"/></svg>');
const html=`<!doctype html><html><head><script src="/kavita-pwa/offline/native-bootstrap.js"></script></head><body><app-root><app-book-reader><div class="reading-section"><div class="book-content"><img src="${image}"></div></div></app-book-reader></app-root></body></html>`;
const oldWorker=`self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil((async()=>{const c=await caches.open('kavita-offline-shell-legacy-test');await c.put('/__kavita_native_shell__',new Response('<app-root>Old shell without an offline bootstrap</app-root>',{headers:{'Content-Type':'text/html'}}));await self.clients.claim();})()));`;
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/')){if(req.method!=='GET')writes++;res.writeHead(503);res.end();return;}
 let file;
 if(u.pathname==='/kavita-offline-sw.js'){res.setHeader('Service-Worker-Allowed','/');res.setHeader('Cache-Control','no-store');if(legacy){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(oldWorker);return;}file=path.join(root,'worker.js');}
 else if(u.pathname.startsWith('/kavita-pwa/offline/'))file=path.join(root,u.pathname.slice('/kavita-pwa/offline/'.length));
 else if(u.pathname==='/kavita-swipe.js')file=path.resolve('proxy/swipe.js');
 else{res.writeHead(200,{'Content-Type':'text/html'});res.end(html);return;}
 if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(fs.readFileSync(file));
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();try{
 const context=await browser.newContext();await context.addInitScript(()=>{if(!localStorage.getItem('kavita-user'))localStorage.setItem('kavita-user',JSON.stringify({id:101,username:'reader',token:'fixture'}));});const page=await context.newPage();
 await page.goto(origin+'/fixture');await page.evaluate(async image=>{
  const s=await import('/kavita-pwa/offline/store.js'),chapter={id:1,pages:1,files:[{id:1,bytes:50,pages:1}]},metadata={chapterId:1,libraryId:1,seriesId:1,volumeId:1};
  await s.commitBook({key:'101:1',account:'101',chapterId:1,metadata,title:'Image-only cover',sections:['<div><img src="'+image+'"></div>'],assets:[],revision:s.revision(chapter),native:{ready:true}}, {key:'101:1',account:'101',progress:{...metadata,pageNum:0},baseProgress:{...metadata,pageNum:0},dirty:true,revision:7,annotations:[],drafts:{keep:{op:'create',local:{id:-1,comment:'preserve me'},rev:1}},nativeResponses:{'/api/series/chapter?chapterId=1':{status:200,type:'application/json',body:JSON.stringify(chapter)}}});
  await navigator.serviceWorker.register('/kavita-offline-sw.js',{scope:'/'});await navigator.serviceWorker.ready;
 },image);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 legacy=false;
 await page.evaluate(async()=>{const s=await import('/kavita-pwa/offline/store.js'),n=await import('/kavita-pwa/offline/native.js');void n.prepareNative(await s.get('books','101:1')).then(value=>window.returnedEarly=value).catch(e=>window.upgradeError=e.message);});
 await page.waitForURL('**/library/1/series/1/book/1?kv-offline=1',{timeout:35000});
 assert.equal(await page.locator('.book-content').innerText(),'','cover has no text or style sentinel');
 assert.equal(await page.locator('.book-content img').evaluate(img=>img.naturalWidth),40);
 const data=await page.evaluate(async()=>{const s=await import('/kavita-pwa/offline/store.js'),state=await s.get('states','101:1'),book=await s.get('books','101:1');return {dirty:state.dirty,revision:state.revision,note:state.drafts.keep.local.comment,ready:book.native.ready};});
 assert.deepEqual(data,{dirty:true,revision:7,note:'preserve me',ready:true});assert.equal(writes,0);
 console.log('Native upgrade passed: legacy worker updated, obsolete native shell rebuilt, image-only cover prepared, unsynced reading and notes retained, no server writes.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
