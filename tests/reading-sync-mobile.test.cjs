const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  let progress={chapterId:1,pageNum:0,bookScrollId:'//body/p[1]'},writes=0;
  const pages=[];
  for(const mobile of [false,true]){
   const context=await browser.newContext(mobile?{viewport:{width:393,height:851},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:800}});
   const page=await context.newPage();pages.push(page);
   await page.route('http://mobile-sync.test/**',route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/api/reader/get-progress')return route.fulfill({json:progress});
    if(u.pathname==='/api/reader/progress'){progress=JSON.parse(route.request().postData());writes++;return route.fulfill({status:200,body:''});}
    if(u.pathname.endsWith('/book-page'))return route.fulfill({body:'<p>Reading fixture</p>'});
    return route.fulfill({contentType:'text/html',body:`<style>.tap-to-paginate .right{position:fixed;right:0;top:40%;width:60px;height:160px;background:#ddd}.reader-container{width:300px}.book-content{width:300px;height:300px;column-count:1;overflow:hidden}</style><app-book-reader><div class="reader-container"><div class="tap-to-paginate"><div class="right"></div></div><div class="reading-section column-layout-1"><div class="book-content" style="max-height:300px"></div></div><div class="bottom-bar"><button id="next"><i class="fa-angle-right"></i>Next</button></div></div></app-book-reader>`});
   });
   await page.goto('http://mobile-sync.test/reader');await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
   await page.evaluate(async()=>{
    await new Promise(resolve=>{const x=new XMLHttpRequest();x.open('GET','/api/reader/get-progress?chapterId=1');x.responseType='json';x.onload=resolve;x.send();});
    document.querySelector('.book-content').innerHTML=await fetch('/api/book/1/book-page?page=0').then(r=>r.text());
    window.turns=0;
    for(const selector of ['.right','#next'])document.querySelector(selector).addEventListener('click',()=>window.turns++);
   });
  }
  const [desktop,mobile]=pages;
  const save=(page,n)=>page.evaluate(n=>fetch('/api/reader/progress',{method:'POST',body:JSON.stringify({chapterId:1,pageNum:n,bookScrollId:`//body/p[${n+1}]`})}),n);
  await save(desktop,40);
  await mobile.locator('.right').tap();await mobile.locator('#kavita-reading-sync-dialog').waitFor();
  assert.equal(await mobile.evaluate(()=>turns),0,'mobile native tap must wait before navigating');assert.equal(writes,1);
  await mobile.getByRole('button',{name:'여기서 계속 읽기'}).tap();await mobile.waitForFunction(()=>turns===1);
  await save(mobile,41);
  await desktop.locator('#next').click();await desktop.locator('#kavita-reading-sync-dialog').waitFor();
  assert.equal(await desktop.evaluate(()=>turns),0,'desktop native arrow must wait before navigating');
  await desktop.evaluate(()=>document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true})));
  assert.equal(writes,2);
  // Reproduce the startup ordering race: Angular saves synchronously inside
  // its first progress GET callback, while another device has just advanced.
  const race=await (await browser.newContext({isMobile:true,hasTouch:true})).newPage();
  let initial=true,raceWrites=0;
  await race.route('http://race-sync.test/**',route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/api/reader/get-progress'){
    const value={chapterId:1,pageNum:initial?0:9,bookScrollId:initial?'//body/p[1]':'//body/p[10]'};initial=false;
    return route.fulfill({json:value});
   }
   if(u.pathname==='/api/reader/progress'){raceWrites++;return route.fulfill({status:200,body:''});}
   return route.fulfill({contentType:'text/html',body:'<main>Startup ordering fixture</main>'});
  });
  await race.goto('http://race-sync.test/');await race.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
  await race.evaluate(()=>{
   const x=new XMLHttpRequest();x.open('GET','/api/reader/get-progress?chapterId=1');x.responseType='json';
   x.onload=()=>{const save=new XMLHttpRequest();save.open('POST','/api/reader/progress');save.send(JSON.stringify({chapterId:1,pageNum:0,bookScrollId:'//body/p[1]'}));};x.send();
  });
  await race.locator('#kavita-reading-sync-dialog').waitFor();assert.equal(raceWrites,0,'initial synchronous save must be guarded');
  await race.evaluate(()=>document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true})));
  console.log('Bidirectional mobile/desktop sync passed: native touch overlay and arrow checked before movement, XHR initial progress, cancellation, stale-write protection.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
