// Optional integration check: requires a mode-0600 temporary login DTO file.
// The proxy rejects every non-GET API request before reaching the real server.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require('playwright');
const auth=process.env.KAVITA_OFFLINE_TEST_USER_FILE;if(!auth){console.log('Skipped live read-only test: set KAVITA_OFFLINE_TEST_USER_FILE.');process.exit(0);}
const user=JSON.parse(fs.readFileSync(auth,'utf8')),chapter=Number(process.env.KAVITA_OFFLINE_TEST_CHAPTER||2),root=path.resolve('proxy/pwa/offline');let blockedWrites=0;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  if(req.method!=='GET'){blockedWrites++;console.log('Blocked production write:',url.pathname);res.writeHead(405);res.end();return;}
  const upstream=http.request({hostname:'127.0.0.1',port:5000,path:req.url,method:'GET',headers:{authorization:req.headers.authorization||'',host:req.headers.host}},response=>{if(response.statusCode>=400)console.log('Read-only GET failed:',url.pathname,'status',response.statusCode,'resource type',path.extname(url.searchParams.get('file')||''));res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type']||'application/octet-stream'});response.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});upstream.end();return;
 }
 let file;if(url.pathname==='/kavita-offline-sw.js'){res.setHeader('Service-Worker-Allowed','/');file=path.join(root,'worker.js');}
 else if(url.pathname.startsWith('/kavita-pwa/offline/'))file=path.join(root,url.pathname.slice('/kavita-pwa/offline/'.length));
 else if(url.pathname==='/kavita-swipe.js')file=path.resolve('proxy/swipe.js');
 else {
 const upstream=http.request({hostname:'127.0.0.1',port:5000,path:req.url,method:'GET',headers:{...req.headers,'accept-encoding':'identity'}},response=>{if(response.statusCode>=400)console.log('Native static failure:',url.pathname,response.statusCode);res.writeHead(response.statusCode,Object.fromEntries(Object.entries(response.headers).filter(([k])=>!['content-encoding','content-length','transfer-encoding'].includes(k))));if((response.headers['content-type']||'').toLowerCase().includes('text/html')){let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);response.on('end',()=>res.end(body.includes('/kavita-pwa/offline/native-bootstrap.js')?body:body.replace('<script defer src="/kavita-swipe.js">','<script src="/kavita-pwa/offline/native-bootstrap.js"></script><script defer src="/kavita-swipe.js">')));}else response.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});upstream.end();return;
 }
 if((!file.startsWith(root+path.sep)&&file!==path.resolve('proxy/swipe.js'))||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(fs.readFileSync(file));
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true});await context.addInitScript(u=>localStorage.setItem('kavita-user',JSON.stringify(u)),user);
  // Capture transient Angular errors as well as fatal JS errors, including
  // warm-up and re-entry. A working book body does not prove error-free startup.
  await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
    const seen=new WeakSet();
    new MutationObserver(()=>{for(const node of document.querySelectorAll('.toast-error .toast-message'))if(!seen.has(node)){seen.add(node);console.info('KAVITA_TEST_ERROR_TOAST:'+node.textContent.trim());}}).observe(document.body,{childList:true,subtree:true});
  }));
  const page=await context.newPage(),errors=[],errorToasts=[];
  page.on('console',message=>{if(message.text().startsWith('KAVITA_TEST_ERROR_TOAST:'))errorToasts.push(message.text().slice('KAVITA_TEST_ERROR_TOAST:'.length));});page.on('framenavigated',f=>{if(f.url().includes('kv-prepare'))console.log('Native warm-up started')});page.on('response',r=>{if(r.status()>=400&&!new URL(r.url()).pathname.startsWith('/api/'))console.log('Static failed:',new URL(r.url()).pathname,r.status())});page.on('pageerror',e=>{errors.push(e.message);console.log('JSERROR',e.message)});
  await page.goto(origin+`/kavita-pwa/offline/index.html?download=${chapter}`);await page.getByRole('button',{name:'이 책을 오프라인으로 저장',exact:true}).click();
  await page.waitForFunction(()=>location.search==='?kv-offline=1'||(document.getElementById('status')?.textContent.includes('못했')||document.getElementById('status')?.textContent.includes('실패')),{},{timeout:180000});
  if(!page.url().includes('kv-offline=1'))throw new Error(await page.locator('#status').textContent());
  await context.setOffline(true);
  await page.waitForSelector('app-book-reader .book-content',{timeout:45000});
  await page.waitForTimeout(1800);
  const info=await page.evaluate(async chapter=>{const s=await import('/kavita-pwa/offline/store.js');const b=await s.get('books',s.accountKey(chapter));return {sections:b.sections.length,ready:b.native?.ready,responses:Object.keys((await s.get('states',s.accountKey(chapter))).nativeResponses||b.native?.responses||{}).length};},chapter);
  assert.ok(info.ready);assert.ok(info.responses>5);
  await context.setOffline(true);const offlineResponse=await page.reload();assert.match(offlineResponse.headers()['content-security-policy']||'',/frame-ancestors 'none'/);await page.waitForSelector('app-book-reader .book-content',{timeout:45000});
  await page.waitForTimeout(2000);
  const saved=await page.evaluate(async chapter=>{const s=await import('/kavita-pwa/offline/store.js');return s.get('states',s.accountKey(chapter));},chapter);
  assert.ok(saved.dirty,'Original Angular reader saves progress offline');
  // Empty measurement frames must not depend on a second network stylesheet
  // request; routing also disables Chromium's incidental HTTP resource cache.
  await page.route('**/styles-*.css',route=>route.abort());
  await page.locator('.reader-header button').filter({has:page.locator('.fa-bars')}).click();
  await page.waitForSelector('app-reader-settings,app-book-reader-settings,app-epub-reader-settings,.offcanvas.show,.drawer',{timeout:15000});
  const fontValue=await page.locator('#fontsize').evaluate(input=>{const value=Number(input.value)>=290?Number(input.value)-10:Number(input.value)+10;input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return value;});
  await page.waitForFunction(async({value,chapter})=>{const s=await import('/kavita-pwa/offline/store.js'),state=await s.get('states',s.accountKey(chapter));return Object.entries(state.nativeResponses||{}).some(([key,r])=>key.startsWith('/api/reading-profile/')&&JSON.parse(r.body).bookReaderFontSize===value);},{value:fontValue,chapter},{timeout:10000});
  await page.locator('.offcanvas-header button').last().click();
  await page.waitForSelector('app-reader-settings',{state:'hidden'});
  await page.evaluate(()=>{if(!document.querySelector('.reader-header')){const content=document.querySelector('.book-content');content.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:0,clientY:0}));content.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:0,clientY:0}));}});
  await page.locator('.reader-header button').filter({has:page.locator('.fa-highlighter')}).click();

  await page.waitForSelector('app-view-annotations-drawer',{timeout:15000});
  await page.locator('.offcanvas-header button').last().click();await page.waitForSelector('app-view-annotations-drawer',{state:'hidden'});
  try{await page.waitForFunction(()=>/^\d+ \/ \d+$/.test(document.getElementById('kavita-screen-page-indicator')?.textContent||'')||document.getElementById('kavita-screen-page-indicator')?.textContent==='—',{},{timeout:45000});if(await page.locator('#kavita-screen-page-indicator').textContent()==='—')throw new Error('Page calculation failed');}catch(error){console.log('Counter state:',await page.evaluate(()=>({text:document.getElementById('kavita-screen-page-indicator')?.textContent,title:document.getElementById('kavita-screen-page-indicator')?.title,section:document.querySelector('.reading-section')?.className,pending:window.__kavitaNativePending,error:window.__kavitaPageCalculationError})));throw error;}
  assert.equal(await page.locator('#kavita-screen-page-indicator').evaluate(n=>!!n.closest('.bottom-bar')),true,'computed pages replace native footer');
  assert.equal(await page.locator('.bottom-bar a.btn-link').isVisible(),false,'native section count is hidden');
  assert.match(await page.locator('#kavita-reading-summary').textContent(),/ · \d+%$/,'TOC title and computed progress are shown offline');
  const original=await page.locator('.book-content').innerText();
  await page.evaluate(()=>window.__kavitaTurnPage(document.querySelector('app-book-reader'),1,'test'));
  await page.waitForTimeout(1200);
  assert.ok(await page.locator('app-book-reader').count());
  const imageCheck=await page.evaluate(async chapter=>{
    const s=await import('/kavita-pwa/offline/store.js'),b=await s.get('books',s.accountKey(chapter)),asset=b.assets.find(a=>a.blob.type.startsWith('image/'));
    const html=await(await fetch(`/api/book/${chapter}/book-page?page=0`)).text();
    const imageURL=new DOMParser().parseFromString(html,'text/html').querySelector('img').src;
    const img=new Image();img.src=imageURL;await new Promise(r=>{img.onload=r;img.onerror=r;});return {local:imageURL.startsWith('blob:'),width:img.naturalWidth};
  },chapter);assert.ok(imageCheck.local);assert.ok(imageCheck.width>0,JSON.stringify(imageCheck));
  // Repeat the user's exact entry path with an already saved book, offline.
  await page.goto(origin+'/kavita-pwa/offline/index.html');
  await page.getByRole('button',{name:'읽기',exact:true}).click();
  await page.waitForSelector('app-book-reader .book-content',{timeout:45000});
  await page.waitForTimeout(2000);
  assert.deepEqual(errorToasts,[],'Reader startup, offline reload and saved-book re-entry must not show red error toasts');
  await page.screenshot({path:'/tmp/kavita-native-offline.png'});
  assert.equal(blockedWrites,0);assert.deepEqual(errors,[]);console.log('Real Kavita EPUB download/offline render passed:',JSON.stringify(info),'Original reader, settings/notes drawers, full-book page count, images, offline reload and original CSP passed. No API writes were sent; actual Android touch was not tested.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;server.close();});
