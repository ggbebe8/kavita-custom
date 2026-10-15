// Run with Playwright installed (see README.swipe.md).
const {chromium} = require('playwright');
const {readFileSync} = require('node:fs');
const assert = require('node:assert/strict');
const source = readFileSync(process.env.KAVITA_INDICATOR_SCRIPT || 'proxy/swipe.js','utf8');
const script = source; 
const texts = [12,20,10].map(n => `<style>.book-content p { text-indent: 4px; }</style><div>${Array.from({length:n},(_,i)=>`<p>Paragraph ${i}: ${'Pagination test text for browser layout. '.repeat(10)}</p>`).join('')}</div>`);
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:800,height:600}});
    page.setDefaultTimeout(8000);
    const errors=[], requests=[];let bookRevision=1;
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://fixture.test/**', async route => {
      const req=route.request(), u=new URL(req.url());requests.push({path:u.pathname,method:req.method()});
      if(u.pathname === '/reader.css')return route.fulfill({contentType:'text/css',body:'body {margin:0}'});
      if(u.pathname.endsWith('.css'))return route.fulfill({status:404});
      if(u.pathname.includes('/api/') && req.headers().authorization !== 'Bearer fixture-only')return route.fulfill({status:401});
      if(u.pathname==='/api/series/chapter')return route.fulfill({json:{id:1,pages:texts.length,createdUtc:'2026-01-01',wordCount:1000,files:[{id:1,bytes:bookRevision,created:'2026-01-01',pages:texts.length}]}});
      if(u.pathname.endsWith('/book-info'))return route.fulfill({json:{pages:texts.length}});
      if(u.pathname.endsWith('/book-page'))return route.fulfill({contentType:'text/html',body:texts[Number(u.searchParams.get('page'))]});
      return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"frame-ancestors 'none';"},body:`<html><head><base href="/"><link rel="stylesheet" href="reader.css"><style>
      body {margin:0} .reader-container {width:100vw} .book-content {height:360px;column-count:1;column-gap:20px;overflow:hidden;font:16px/24px sans-serif} p {margin:0 0 12px} .bottom-bar {position:fixed;bottom:0;left:0;width:100%;height:40px} 
      </style></head><body><app-book-reader><div class="reader-container"><div class="reading-section column-layout-1"><div class="book-container immersive"><div class="book-content column-layout-1" style="max-height:360px"></div></div></div><div class="bottom-bar"><span><a class="btn-link">Page 1</a> / 3</span><button style="float:right">Next</button></div></div></app-book-reader></body></html>`});
    });
    await page.goto('http://fixture.test/library/1/series/1/book/1');

    await page.addScriptTag({content:script});
    async function navigate(index, useFetch=false) {
      await page.evaluate(async ({index,useFetch}) => {
        const html=useFetch ? await fetch(`/api/book/1/book-page?page=${index}`,{headers:{Authorization:'Bearer fixture-only'}}).then(r=>r.text()) : await new Promise(resolve=>{
          const x=new XMLHttpRequest();x.open('GET',`/api/book/1/book-page?page=${index}`);x.setRequestHeader('Authorization','Bearer fixture-only');x.onload=()=>resolve(x.responseText);x.send();
        });const c=document.querySelector('.book-content');c.innerHTML=html;c.scrollLeft=0;
      },{index,useFetch});
    }
    // Independently measure each section in the visible reader before interception.
    async function expected() {
      return page.evaluate(texts=>{
        const c=document.querySelector('.book-content'),saved=c.innerHTML;
        const counts=texts.map(html=>{c.innerHTML=html;return Math.ceil(c.scrollWidth/(document.querySelector('.reader-container').offsetWidth+20));});c.innerHTML=saved;return counts;
      },texts);
    }
    let counts=await expected();
    await navigate(0);
    const label=page.locator('#kavita-screen-page-indicator');
    if(process.env.KAVITA_EXPECT_CSS_FAILURE) {
      await page.waitForFunction(()=>document.querySelector('#kavita-screen-page-indicator').dataset.pages==='—');
      assert(requests.some(r=>r.path==='/library/1/series/1/book/reader.css'));
      console.log('Reproduced CSS 404 and failed indicator on nested book URL.');return;
    }
    await page.waitForFunction(expected=>document.querySelector('#kavita-screen-page-indicator').dataset.pages===expected,`1 / ${counts.reduce((a,b)=>a+b,0)}`);
    assert.equal(await label.evaluate(n=>n.dataset.pages),`1 / ${counts.reduce((a,b)=>a+b,0)}`);
    const pageRequests=()=>requests.filter(r=>r.path.endsWith('/book-page')).length;
    const refresh=async()=>{await page.reload();await page.addScriptTag({content:script});await navigate(0);await page.waitForFunction(()=>/^\d+ \/ \d+$/.test(document.querySelector('#kavita-screen-page-indicator').dataset.pages));};
    await page.evaluate(()=>{for(const k of Object.keys(localStorage).filter(k=>k.startsWith('kavita-screen-pages-v2:'))){const v=JSON.parse(localStorage.getItem(k));v.saved=Date.now()-10*24*60*60*1000;localStorage.setItem(k,JSON.stringify(v));}});
    let beforeRequests=pageRequests();await refresh();
    assert.equal(pageRequests()-beforeRequests,1,'Reload reuses persisted totals without fetching other sections');
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('kavita-screen-pages-v2:')).length),1);
    await page.evaluate(()=>{for(const k of Object.keys(localStorage).filter(k=>k.startsWith('kavita-screen-pages-v2:'))){const v=JSON.parse(localStorage.getItem(k));v.saved=Date.now()-15*24*60*60*1000;localStorage.setItem(k,JSON.stringify(v));}});
    beforeRequests=pageRequests();await refresh();assert(pageRequests()-beforeRequests>=texts.length,'15-day cache expires');
    await page.evaluate(()=>{for(const k of Object.keys(localStorage).filter(k=>k.startsWith('kavita-screen-pages-v2:')))localStorage.setItem(k,'corrupt');});
    beforeRequests=pageRequests();await refresh();assert(pageRequests()-beforeRequests>=texts.length,'Corrupt cache recalculates');
    bookRevision++;beforeRequests=pageRequests();await refresh();assert(pageRequests()-beforeRequests>=texts.length,'Book metadata change invalidates cached totals');

    await page.reload();
    await page.evaluate(()=>{Storage.prototype.getItem=()=>{throw new Error('Storage blocked');};Storage.prototype.setItem=()=>{throw new Error('Storage blocked');};});
    await page.addScriptTag({content:script});beforeRequests=pageRequests();await navigate(0);
    await page.waitForFunction(()=>/^\d+ \/ \d+$/.test(document.querySelector('#kavita-screen-page-indicator').dataset.pages));
    assert(pageRequests()-beforeRequests>=texts.length,'Storage unavailable falls back to calculation');
    assert.equal(await page.evaluate(()=>document.querySelectorAll('iframe').length),0);
    const overlaps=await page.evaluate(()=>{const a=document.querySelector('#kavita-screen-page-indicator').getBoundingClientRect(),b=document.querySelector('.bottom-bar').getBoundingClientRect();return a.bottom>b.top&&a.top<b.bottom;});assert.equal(overlaps,false,'calculated pages do not cover the native footer');assert.equal(await page.locator('.bottom-bar a.btn-link').isVisible(),true,'native section count remains visible');
    // Chapter DOM decoration and attribute ordering are not layout settings.
    await page.evaluate(()=>{const c=document.querySelector('.book-content');c.classList.add('section-loaded');c.style.cssText='font-size:16px;max-height:360px';});
    beforeRequests=pageRequests();await navigate(1,true);
    await page.waitForFunction(expected=>document.querySelector('#kavita-screen-page-indicator').dataset.pages===expected,`${counts[0]+1} / ${counts.reduce((a,b)=>a+b,0)}`);
    assert.equal(pageRequests()-beforeRequests,1,'Section transition reuses totals despite DOM decoration');
    // An actual per-section mismatch corrects that section, without refetching the book.
    texts[1]+='<div>'+('<p>'+('Added section text. '.repeat(20))+'</p>').repeat(12)+'</div>';
    counts=await expected();beforeRequests=pageRequests();await navigate(1,true);
    await page.waitForFunction(expected=>document.querySelector('#kavita-screen-page-indicator').dataset.pages===expected,`${counts[0]+1} / ${counts.reduce((a,b)=>a+b,0)}`);
    assert.equal(pageRequests()-beforeRequests,1,'A section correction preserves every other section count');

    await page.waitForFunction(expected=>document.querySelector('#kavita-screen-page-indicator').dataset.pages===expected,`${counts[0]+1} / ${counts.reduce((a,b)=>a+b,0)}`);
    await page.evaluate(()=>{const c=document.querySelector('.book-content');c.scrollLeft=document.querySelector('.reader-container').offsetWidth+20;});
    await page.waitForFunction(expected=>document.querySelector('#kavita-screen-page-indicator').dataset.pages===expected,`${counts[0]+2} / ${counts.reduce((a,b)=>a+b,0)}`);
    await page.evaluate(()=>{document.querySelector('.bottom-bar').remove();});
    await page.waitForTimeout(350);assert.equal(await label.isVisible(),true);
    await page.setViewportSize({width:500,height:600});counts=await expected();await navigate(0);
    await page.waitForFunction(expected=>document.querySelector('#kavita-screen-page-indicator').dataset.pages===expected,`1 / ${counts.reduce((a,b)=>a+b,0)}`);
    await page.evaluate(()=>{const c=document.querySelector('.book-content');c.className='book-content column-layout-2';c.style.columnCount='2';document.querySelector('.reading-section').className='reading-section column-layout-2';});
    counts=await expected();await navigate(0);
    await page.waitForFunction(expected=>document.querySelector('#kavita-screen-page-indicator').dataset.pages===expected,`1 / ${counts.reduce((a,b)=>a+b,0)}`);
    assert.equal(await page.evaluate(()=>document.querySelector('#kavita-screen-page-indicator').getBoundingClientRect().right>innerWidth-20),true);
    await page.evaluate(async ()=>{
      const root=document.querySelector('app-book-reader'),c=root.querySelector('.book-content');
      root.querySelector('.book-container').classList.remove('immersive');
      const saved=document.createElement('app-epub-highlight');saved.textContent='Existing saved highlight';c.appendChild(saved);
      const bar=document.createElement('div');bar.className='bottom-bar';
      bar.innerHTML='<button><i class="fa-angle-left"></i></button><button><i class="fa-angle-right next-page-highlight"></i></button>';root.appendChild(bar);
      window.swipeTurns=0;bar.lastChild.addEventListener('click',()=>window.swipeTurns++);bar.lastChild.focus();
      const touch=x=>new Touch({identifier:1,target:c,clientX:x,clientY:100});
      c.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[touch(350)]}));
      c.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,cancelable:true,touches:[touch(220)]}));
      c.dispatchEvent(new TouchEvent('touchend',{bubbles:true,cancelable:true,touches:[],changedTouches:[touch(220)]}));
    });
    await page.waitForFunction(()=>window.swipeTurns===1);
    await page.evaluate(()=>{const d=document.createElement('div');d.setAttribute('role','dialog');d.textContent='settings';document.body.appendChild(d);});await page.waitForTimeout(350);assert.equal(await label.isVisible(),false);
    await page.evaluate(()=>{document.querySelector('[role="dialog"]').remove();document.querySelector('app-book-reader').remove();});await page.waitForTimeout(350);assert.equal(await label.isVisible(),false);
    assert.deepEqual(errors,[]);assert(requests.every(r=>r.method==='GET'),'Pagination must not write progress or annotations');
    assert(requests.some(r=>r.path==='/api/series/chapter'));
    assert(requests.some(r=>r.path==='/reader.css'));
    assert(!requests.some(r=>r.path==='/library/1/series/1/book/reader.css'));
    console.log('Chromium tests passed: persistent cache hit, corrupt/blocked cache fallback, book revision invalidation, whole-book totals, section transition, screen advance, resize, two-column layout, EPUB CSS, immersive right-aligned display, native footer preserved without overlap, popup/exit hiding, authenticated GET only.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
