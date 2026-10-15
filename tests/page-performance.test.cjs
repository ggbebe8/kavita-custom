const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const texts=Array.from({length:8},(_,i)=>'<div>'+('<p>Section '+i+' '+('Browser pagination text. '.repeat(20))+'</p>').repeat(8)+'</div>');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  async function run(file,cancel=false){
   const context=await browser.newContext({viewport:{width:800,height:600}}),page=await context.newPage();
   let css=0,active=0,maxActive=0,pageGets=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('http://performance.test/**',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/common.css'){css++;return route.fulfill({contentType:'text/css',body:'body{margin:0}'});}
    if(u.pathname==='/api/series/chapter')return route.fulfill({json:{id:1,pages:texts.length,files:[{id:1,bytes:1000}]}});
    if(u.pathname.endsWith('/book-page')){
     pageGets++;active++;maxActive=Math.max(maxActive,active);
     try {await new Promise(r=>setTimeout(r,cancel?250:80));await route.fulfill({contentType:'text/html',body:texts[Number(u.searchParams.get('page'))]});}
     catch {} finally {active--;}
     return;
    }
    return route.fulfill({contentType:'text/html',body:'<base href="/"><link rel="stylesheet" href="common.css"><style>.reader-container{width:100vw}.book-content{height:360px;column-count:1;column-gap:20px;overflow:hidden;font:16px/24px sans-serif}p{margin:0 0 8px}</style><app-book-reader><div class="reader-container"><div class="reading-section column-layout-1"><div class="book-container"><div class="book-content column-layout-1" style="max-height:360px"></div></div></div></div></app-book-reader>'});
   });
   await page.goto('http://performance.test/reader');await page.addScriptTag({content:readFileSync(file,'utf8')});
   const start=Date.now();
   await page.evaluate(async()=>{const html=await fetch('/api/book/1/book-page?page=0').then(r=>r.text());document.querySelector('.book-content').innerHTML=html;});
   if(cancel){
    await page.waitForRequest(req=>req.url().includes('book-page?page=1'));
    await page.setViewportSize({width:600,height:600});
    await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);
    await page.waitForFunction(()=>/^\d+ \/ \d+$/.test((document.querySelector('#kavita-screen-page-indicator').dataset.pages??document.querySelector('#kavita-screen-page-indicator').textContent)));
    assert.notEqual(await page.locator('#kavita-screen-page-indicator').evaluate(n=>n.dataset.pages??n.textContent),'—');
    // A fresh uncached setup starts again; leaving the reader cancels it too.
    await page.setViewportSize({width:650,height:600});
    await page.waitForFunction(()=>document.querySelectorAll('iframe').length===1);
    await page.evaluate(()=>document.querySelector('app-book-reader').remove());
    await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);
    await page.locator('#kavita-screen-page-indicator').waitFor({state:'hidden'});
    assert.equal(await page.locator('#kavita-screen-page-indicator').isVisible(),false);
    assert.deepEqual(errors,[]);await context.close();return;
   }
   await page.waitForFunction(()=>/^\d+ \/ \d+$/.test((document.querySelector('#kavita-screen-page-indicator').dataset.pages??document.querySelector('#kavita-screen-page-indicator').textContent)));
   const result={milliseconds:Date.now()-start,cssLoads:css,maxParallelPageGets:maxActive,pageGets,total:await page.locator('#kavita-screen-page-indicator').evaluate(n=>n.dataset.pages??n.textContent)};
   assert.equal(await page.locator('iframe').count(),0);assert.deepEqual(errors,[]);
   await context.close();return result;
  }
  const before=await run('backups/page-calculation-speed/swipe.js'),after=await run('proxy/swipe.js');
  assert.equal(after.total,before.total,'Reuse and prefetch must preserve the page total');
  assert.equal(after.cssLoads,2,'One main stylesheet load and one shared measuring frame');
  assert(after.cssLoads<before.cssLoads);assert.equal(after.maxParallelPageGets,2);assert.equal(after.pageGets,before.pageGets);
  console.log('Synthetic 8-section comparison:',JSON.stringify({before,after}));
  await run('proxy/swipe.js',true);
  console.log('Optimization tests passed: same totals, single measuring frame/CSS load, two GETs in flight, resize and reader-exit cancellation. Timing uses artificial 80ms network latency, not production Android.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
