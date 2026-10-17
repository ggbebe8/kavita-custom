const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:800,height:600}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<style>.book-content{width:800px;height:360px;column-count:1;overflow:hidden}</style><app-book-reader><div class="reader-container"><div class="reading-section column-layout-1"><div class="book-container immersive"><div class="book-content column-layout-1"><p>Old section</p></div></div></div></div></app-book-reader>');
  await page.evaluate(()=>{
   const root=document.querySelector('app-book-reader'),content=root.querySelector('.book-content'),section=root.querySelector('.reading-section');
   window.moves=[];window.menuChanges=[];
   content.addEventListener('click',()=>{
    const existing=root.querySelector('.reader-header');
    window.menuChanges.push({opening:!existing,loading:section.classList.contains('is-loading'),text:content.textContent});
    if(existing){existing.remove();root.querySelector('.bottom-bar').remove();return;}
    const header=document.createElement('div');header.className='reader-header';root.appendChild(header);
    const bar=document.createElement('div');bar.className='bottom-bar';bar.innerHTML='<button><i class="fa-angle-left"></i></button><button><i class="fa-angle-right next-page-highlight"></i></button>';
    const go=direction=>{window.moves.push(direction);section.classList.add('is-loading');setTimeout(()=>{content.innerHTML='<p>New section '+direction+'</p>';section.classList.remove('is-loading');},180);};
    bar.firstChild.addEventListener('click',()=>go('prev'));bar.lastChild.addEventListener('click',()=>go('next'));root.appendChild(bar);
   });
   window.swipe=direction=>{const touch=x=>new Touch({identifier:1,target:content,clientX:x,clientY:100});const start=direction==='next'?450:250,end=direction==='next'?250:450;
    content.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[touch(start)]}));
    content.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,cancelable:true,touches:[touch(end)]}));
    content.dispatchEvent(new TouchEvent('touchend',{bubbles:true,cancelable:true,touches:[],changedTouches:[touch(end)]}));};
  });
  await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
  await page.evaluate(()=>window.swipe('next'));
  await page.waitForFunction(()=>document.querySelector('.reading-section').classList.contains('is-loading'));
  await page.evaluate(()=>window.swipe('next'));
  await page.waitForFunction(()=>window.moves.length===2&&!document.querySelector('.reading-section').classList.contains('is-loading')&&!document.querySelector('.reader-header')&&!document.querySelector('.swipe-restoring-menu'));
  assert.deepEqual(await page.evaluate(()=>window.moves),['next','next']);
  let changes=await page.evaluate(()=>window.menuChanges);assert.equal(changes[1].loading,false);assert.equal(changes[1].text,'New section next');
  await page.waitForTimeout(700);await page.evaluate(()=>window.swipe('prev'));
  await page.waitForFunction(()=>window.moves.length===3&&!document.querySelector('.reading-section').classList.contains('is-loading')&&!document.querySelector('.reader-header'));
  changes=await page.evaluate(()=>window.menuChanges);assert.equal(changes[5].loading,false);assert.equal(changes[5].text,'New section prev');
  assert.deepEqual(await page.evaluate(()=>window.moves),['next','next','prev']);assert.deepEqual(errors,[]);

  // Backward section transition test: turning backward past screen 1 lands on previous section's last screen
  const page2=await browser.newPage({viewport:{width:800,height:600}});
  const errors2=[];page2.on('pageerror',e=>errors2.push(e.message));
  const ch8Text='<div><p>Chapter 8 short text</p></div>';
  const ch7Text='<div><p>'+('Chapter 7 long text paragraph spanning multiple columns. '.repeat(100))+'</p></div>';
  await page2.route('http://transition.test/**',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/api/series/chapter')return route.fulfill({json:{id:1,pages:10,files:[{id:1,bytes:123}]}});
    if(u.pathname==='/api/reader/get-progress')return route.fulfill({json:{pageNum:8,bookScrollId:'//body/p[1]'}});
    if(u.pathname.endsWith('/book-page')){
      const p=u.searchParams.get('page');
      if(p==='8')return route.fulfill({contentType:'text/html',body:ch8Text});
      if(p==='7')return route.fulfill({contentType:'text/html',body:ch7Text});
    }
    return route.fulfill({
      contentType:'text/html',
      body:'<style>body{margin:0}.reader-container{width:800px}.reading-section{width:800px;height:400px}.reading-section.is-loading{opacity:0}.book-container{width:800px;height:400px}.book-content{width:800px;height:400px;column-count:1;column-gap:20px;overflow:hidden;font:16px/24px sans-serif}.bottom-bar{position:fixed;bottom:0;width:800px;display:flex}</style><app-book-reader><div class="reader-container"><div class="reading-section column-layout-1"><div class="book-container"><div class="book-content column-layout-1"></div></div></div><div class="bottom-bar"><button id="prev-btn"><i class="fa-angle-left"></i></button><button id="next-btn"><i class="fa-angle-right next-page-highlight"></i></button></div></div></app-book-reader>'
    });
  });
  await page2.goto('http://transition.test/reader');
  await page2.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
  await page2.evaluate(async()=>{
    const text=await fetch('/api/book/1/book-page?page=8').then(r=>r.text());
    document.querySelector('.book-content').innerHTML=text;
  });
  await page2.waitForFunction(()=>document.querySelector('#kavita-screen-page-indicator').dataset.pages.includes(' / '));
  assert.equal(await page2.evaluate(()=>document.querySelector('.book-content').scrollLeft),0);

  // Backward turn past screen 1 to Chapter 7
  await page2.evaluate(async()=>{
    const root=document.querySelector('app-book-reader'),section=root.querySelector('.reading-section'),content=root.querySelector('.book-content'),prevBtn=document.querySelector('#prev-btn');
    prevBtn.onclick=async()=>{
      if(content.scrollLeft>0){content.scrollLeft=Math.max(0,content.scrollLeft-820);content.dispatchEvent(new Event('scroll',{bubbles:true}));return;}
      section.classList.add('is-loading');
      const text=await fetch('/api/book/1/book-page?page=7').then(r=>r.text());
      content.innerHTML=text;
      section.classList.remove('is-loading');
      const firstEl=content.querySelector('p');
      if(firstEl)firstEl.scrollIntoView({inline:'start'});
      window.__kavitaAlignBackward?.(root);
    };
    prevBtn.click();
  });
  await page2.waitForTimeout(600);
  const ch7Info=await page2.evaluate(()=>{
    const c=document.querySelector('.book-content');
    return {scrollLeft:c.scrollLeft,scrollWidth:c.scrollWidth};
  });
  assert.ok(ch7Info.scrollWidth>820);
  assert.equal(ch7Info.scrollLeft,2460,'Backward turn to multi-page section lands on the last screen');

  // Next backward turn moves within Chapter 7 to screen 3
  await page2.click('#prev-btn');
  await page2.waitForTimeout(400);
  assert.equal(await page2.evaluate(()=>document.querySelector('.book-content').scrollLeft),1640);
  assert.deepEqual(errors2,[]);

  console.log('Section transition Chromium tests passed: next/previous async section loading, no double turn, menu restored, backward section lands on last screen.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
