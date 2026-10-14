// Optional integration check: requires a mode-0600 temporary login DTO file.
// The proxy rejects every non-GET API request before reaching the real server.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require('playwright');
const auth=process.env.KAVITA_OFFLINE_TEST_USER_FILE;if(!auth){console.log('Skipped live read-only test: set KAVITA_OFFLINE_TEST_USER_FILE.');process.exit(0);}
const user=JSON.parse(fs.readFileSync(auth,'utf8')),chapter=Number(process.env.KAVITA_OFFLINE_TEST_CHAPTER||2),root=path.resolve('proxy/pwa/offline');let blockedWrites=0;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  if(req.method!=='GET'){blockedWrites++;res.writeHead(405);res.end();return;}
  const upstream=http.request({hostname:'127.0.0.1',port:5000,path:req.url,method:'GET',headers:{authorization:req.headers.authorization||'',host:req.headers.host}},response=>{if(response.statusCode>=400)console.log('Read-only GET failed:',url.pathname,'status',response.statusCode,'resource type',path.extname(url.searchParams.get('file')||''));res.writeHead(response.statusCode,{'Content-Type':response.headers['content-type']||'application/octet-stream'});response.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});upstream.end();return;
 }
 let file;if(url.pathname==='/kavita-offline-sw.js'){res.setHeader('Service-Worker-Allowed','/');file=path.join(root,'worker.js');}
 else if(url.pathname.startsWith('/kavita-pwa/offline/'))file=path.join(root,url.pathname.slice('/kavita-pwa/offline/'.length));
 else {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<meta charset="utf-8">Online fixture');return;}
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(fs.readFileSync(file));
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true});await context.addInitScript(u=>localStorage.setItem('kavita-user',JSON.stringify(u)),user);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+`/kavita-pwa/offline/index.html?download=${chapter}`);await page.getByRole('button',{name:'이 책을 오프라인으로 저장',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('reader').hidden||([...document.querySelectorAll('button')].some(b=>b.textContent==='이 책을 오프라인으로 저장'&&!b.disabled)),{},{timeout:180000});
  if(await page.locator('#reader').isHidden())throw new Error(await page.locator('#status').textContent());await page.waitForFunction(()=>document.getElementById('page').textContent.includes('화면'));
  const info=await page.evaluate(async chapter=>{const s=await import('/kavita-pwa/offline/store.js');const b=await s.get('books',s.accountKey(chapter));return {sections:b.sections.length,assets:b.assets.length,bytes:b.bytes};},chapter);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.goto(origin+'/');await page.getByRole('button',{name:'읽기',exact:true}).click();await page.waitForFunction(()=>document.getElementById('page').textContent.includes('화면'));
  assert.equal(blockedWrites,0);assert.deepEqual(errors,[]);console.log('Real Kavita EPUB download/offline render passed:',JSON.stringify(info),'No API writes were sent; actual Android audio/touch was not tested.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;server.close();});
