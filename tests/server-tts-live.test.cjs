// Optional real EPUB/CPU audio integration. API writes are held in this test
// proxy and never sent to Kavita. TTS session creation/control is allowed.
const http=require('node:http'),fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const authFile=process.env.KAVITA_TTS_TEST_USER_FILE;
if(!authFile){console.log('Skipped live TTS test: set KAVITA_TTS_TEST_USER_FILE to a private temporary login DTO.');process.exit(0);}
const user=JSON.parse(fs.readFileSync(authFile)),chapter=Number(process.env.KAVITA_TTS_TEST_CHAPTER||6);
let progress=null,heldWrites=0,audioRequests=0;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let body='';for await(const part of req)body+=part;
 if(url.pathname==='/api/reader/progress'&&req.method==='POST'){progress=JSON.parse(body);heldWrites++;res.writeHead(200);res.end();return;}
 if(url.pathname==='/api/reader/get-progress'&&progress){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(progress));return;}
 if(url.pathname.startsWith('/api/')&&req.method!=='GET'){res.writeHead(405);res.end();return;}
 const file=url.pathname==='/kavita-swipe.js'?'proxy/swipe.js':url.pathname==='/kavita-pwa/server-tts.js'?'proxy/pwa/server-tts.js':null;
 if(file){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(fs.readFileSync(file));return;}
 if(url.pathname.endsWith('/audio.mp3'))audioRequests++;
 const upstream=http.request({hostname:'127.0.0.1',port:5000,path:req.url,method:req.method,headers:{...req.headers,'accept-encoding':'identity'}},response=>{
  res.writeHead(response.statusCode,Object.fromEntries(Object.entries(response.headers).filter(([k])=>!['content-encoding','transfer-encoding','content-length'].includes(k))));
  if(url.pathname==='/api/reader/get-progress'){
   let text='';response.setEncoding('utf8');response.on('data',s=>text+=s);response.on('end',()=>{try{progress=JSON.parse(text);}catch{}res.end(text);});
  }else response.pipe(res);
 });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});if(body)upstream.write(body);upstream.end();
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
 let page;
 try{
  const context=await browser.newContext();await context.addInitScript(u=>localStorage.setItem('kavita-user',JSON.stringify(u)),user);
  page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/library/1/series/6/book/${chapter}`);
  await page.waitForSelector('app-book-reader .book-content',{timeout:45000});
  await page.waitForFunction(()=>window.__kavitaReaderSection?.()?.length>1&&!document.querySelector('app-book-reader .is-loading'));
  const initial=await page.evaluate(()=>window.__kavitaReaderSection().index);
  await page.evaluate(async()=>{
   const module=await import('/kavita-pwa/server-tts.js'),root=document.querySelector('app-book-reader');
   const all=()=>{const nodes=[],walker=document.createTreeWalker(root.querySelector('.book-content'),NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode;if(n.textContent.trim()&&!n.parentElement.closest('script,style,noscript,button,input,textarea,select,svg,audio,video,[hidden],[aria-hidden="true"],.bookmark-overlay,app-book-line-overlay')){const css=getComputedStyle(n.parentElement);if(css.display!=='none'&&css.visibility!=='hidden')nodes.push(n.textContent.trim());}}return nodes.join(' ').replace(/\s+/g,' ').trim();};
   window.liveTtsStatus=[];window.liveServerTts=module.create({root,announce:s=>liveTtsStatus.push(s),stopBrowser:()=>{},startText:()=>all().slice(-100)});
   const button=document.createElement('button');button.id='start-live-tts';button.textContent='Start test';button.style.cssText='position:fixed;top:0;left:0;z-index:99999';button.onclick=()=>void liveServerTts.start({voice:10});document.body.append(button);
  });
  await page.locator('#start-live-tts').click();
  await page.waitForFunction(()=>document.querySelector('audio[data-kavita-server-tts]')?.currentTime>1,{},{timeout:120000});
  await page.waitForFunction(index=>window.__kavitaReaderSection?.()?.index>index,initial,{timeout:120000});
  await page.waitForFunction(()=>CSS.highlights.has('kavita-server-tts-current'),{},{timeout:15000});
  assert.equal(await page.evaluate(()=>liveServerTts.active),true);
  assert.equal(audioRequests,1,'real MP3 stream continues through a native EPUB chapter transition');
  await page.evaluate(()=>liveServerTts.pause());assert.equal(await page.evaluate(()=>liveServerTts.paused),true);
  await page.evaluate(()=>liveServerTts.stop());
  assert.deepEqual(errors,[]);
  console.log('Real EPUB/native reader/CPU MP3 passed: sentence display, next-chapter following, single continuous audio source and pause/stop. Kavita progress writes were held locally:',heldWrites,'. Actual Android screen-off was not tested.');
 }catch(error){if(page)console.log('Live reader diagnostic:',await page.evaluate(()=>({reader:!!document.querySelector('app-book-reader'),section:window.__kavitaReaderSection?.()?.index,active:window.liveServerTts?.active,audioTime:document.querySelector('audio[data-kavita-server-tts]')?.currentTime,paused:document.querySelector('audio[data-kavita-server-tts]')?.paused,status:window.liveTtsStatus?.slice(-3),modal:!!document.querySelector('ngb-modal-window'),sync:!!document.getElementById('kavita-reading-sync-dialog')})));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;server.close();});
