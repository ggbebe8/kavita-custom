const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  let progress={pageNum:0,bookScrollId:'//body/p[1]'},writes=0,offline=false;
  const pages=[];
  for(let i=0;i<2;i++){
   const context=await browser.newContext();const page=await context.newPage();pages.push(page);
   await page.route('http://sync.test/**',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/api/reader/get-progress')return route.fulfill(offline?{status:503,body:''}:{json:progress});
    if(u.pathname==='/api/reader/progress'){progress=JSON.parse(route.request().postData());writes++;return route.fulfill({status:200,body:''});}
    return route.fulfill({contentType:'text/html',body:'<main>Fixture</main>'});
   });
   await page.goto('http://sync.test/reader');await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
   await page.evaluate(()=>fetch('/api/reader/get-progress?chapterId=1').then(r=>r.json()));
  }
  const [a,b]=pages;
  const save=(page,n)=>page.evaluate(n=>fetch('/api/reader/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chapterId:1,pageNum:n,bookScrollId:`//body/p[${n+1}]`})}).then(r=>r.status).catch(e=>e.name),n);
  assert.equal(await save(b,40),200);
  const pending=save(a,33);
  await a.locator('#kavita-reading-sync-dialog').waitFor();assert.equal(writes,1,'stale A save must be held');
  await a.getByRole('button',{name:'여기서 계속 읽기'}).click();assert.equal(await pending,200);assert.equal(progress.pageNum,33);
  assert.equal(await save(a,34),200,'own writes must not cause prompts');
  const next=save(b,41);await b.locator('#kavita-reading-sync-dialog').waitFor();
  // Another device moves while B is deciding; B must be asked about the new snapshot.
  assert.equal(await save(a,35),200);
  await b.getByRole('button',{name:'여기서 계속 읽기'}).click();await b.locator('#kavita-reading-sync-dialog').waitFor();
  await b.getByRole('button',{name:'취소'}).count().then(n=>assert.equal(n,0));
  await b.evaluate(()=>document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true})));
  assert.equal(await next,'AbortError');assert.equal(progress.pageNum,35);
  offline=true;const failed=save(a,36);await a.locator('#kavita-reading-sync-dialog').waitFor();
  const before=writes;await a.getByRole('button',{name:'취소'}).click();assert.equal(await failed,'AbortError');assert.equal(writes,before);
  offline=false;
  // A native XHR is also held and cancelled rather than fabricating a successful save.
  const xhr=b.evaluate(()=>new Promise(resolve=>{const x=new XMLHttpRequest();x.open('POST','/api/reader/progress');x.onabort=()=>resolve('abort');x.onload=()=>resolve('load');x.send(JSON.stringify({chapterId:1,pageNum:42,bookScrollId:'//body/p[43]'}));}));
  await b.locator('#kavita-reading-sync-dialog').waitFor();await b.evaluate(()=>document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true})));
  assert.equal(await xhr,'abort');assert.equal(progress.pageNum,35);
  // Choosing the latest position reloads through Kavita's native GET flow without writing A's stale body.
  const moving=save(b,43).catch(()=>{});await b.locator('#kavita-reading-sync-dialog').waitFor();
  await b.getByRole('button',{name:'최신 위치로 이동'}).click();await b.waitForLoadState();await moving;
  assert.equal(progress.pageNum,35);assert.equal(writes,before);
  console.log('Cross-browser sync passed: stale saves held, explicit continuation, repeat conflict, network failure, XHR cancellation, latest-position reload without stale writes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
