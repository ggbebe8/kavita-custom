const {chromium}=require('playwright'),{readFileSync}=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:800,height:600},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://selection.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<style>
 body{margin:0}.fixed-top{position:fixed;top:0;left:0;right:0;z-index:100}.overlay{width:100vw;height:65px;background:#333;color:white}
 .reading-section{position:absolute;top:0;width:800px;height:500px;overflow:auto}.reader-container{width:820px}
 .book-content{width:800px;height:180px;column-width:800px;column-gap:20px;overflow:auto;font:18px/24px sans-serif}
 p{margin:0}.bottom-bar{position:fixed;bottom:0}.tap-to-paginate>div{position:fixed;top:0;width:20%;height:500px}.left{left:0}.right{right:0}
 </style><app-book-reader><div class="fixed-top"><app-book-line-overlay></app-book-line-overlay></div><div class="reading-section column-layout-1"><div class="reader-container"><div class="book-container"><div class="book-content"><p>${'상단에서 텍스트 범위를 조절합니다. '.repeat(120)}</p></div></div></div></div><div class="tap-to-paginate"><div class="left"></div><div class="right"></div></div><div class="reader-header"></div><div class="bottom-bar"><button><i class="fa-angle-left"></i></button><button><i class="next-page-highlight"></i></button></div></app-book-reader>`}));
 await page.goto('http://selection.test');await page.evaluate(()=>{
  window.__kavitaPageIndicatorInstalled=true;window.__kavitaFullscreenButtonInstalled=true;window.__kavitaBookmarkAffordanceInstalled=true;
  localStorage.setItem('kavita-height-tap-zones-v1:guest','true');window.moves=0;window.nativeText='';window.nativeEnds=0;
  document.querySelectorAll('.bottom-bar button').forEach(button=>button.onclick=()=>moves++);
  const root=document.querySelector('app-book-reader'),host=root.querySelector('app-book-line-overlay');let timer;
  const end=()=>{clearTimeout(timer);timer=setTimeout(()=>{nativeEnds++;const text=getSelection().toString();if(!text||text===nativeText){nativeText='';getSelection().removeAllRanges();host.replaceChildren();return;}nativeText=text;host.innerHTML='<div class="overlay"><button id="annotation">주석</button><button id="close-selection">닫기</button></div>';host.querySelector('#annotation').onclick=()=>window.annotationText=getSelection().toString();host.querySelector('#close-selection').onclick=()=>{nativeText='';getSelection().removeAllRanges();host.replaceChildren();};},20);};
  for(const type of ['pointerup','mouseup','touchend'])root.querySelector('.book-container').addEventListener(type,end);
  window.selectText=(start=0,end=12)=>{const node=root.querySelector('p').firstChild,range=document.createRange();range.setStart(node,start);range.setEnd(node,end);getSelection().removeAllRanges();getSelection().addRange(range);};
 });
 await page.addScriptTag({content:readFileSync(process.env.KAVITA_SELECTION_TEST_JS||'proxy/swipe.js','utf8')});
 await page.evaluate(()=>{selectText();document.querySelector('p').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
 await page.waitForSelector('#annotation');await page.waitForTimeout(80);
 assert.equal(await page.locator('app-book-reader').evaluate(n=>n.classList.contains('kv-selection-menu-bottom')),true,'top text moves native annotation toolbar away from selection');
 assert.ok(await page.locator('.overlay').evaluate(n=>n.getBoundingClientRect().top>400));
 assert.equal(await page.locator('.tap-to-paginate .right').evaluate(n=>getComputedStyle(n).pointerEvents),'none','native tap overlays cannot catch selection handles');
 await page.evaluate(()=>document.querySelector('p').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true,button:0})));
 assert.equal(await page.locator('.overlay').evaluate(n=>getComputedStyle(n).visibility),'hidden','toolbar is hidden while a selection handle is being adjusted');
 await page.evaluate(()=>{getSelection().removeAllRanges();document.dispatchEvent(new Event('selectionchange'));const c=document.querySelector('.book-content');c.scrollLeft=820;c.dispatchEvent(new Event('scroll'));const r=document.querySelector('.reading-section');r.scrollLeft=10;r.dispatchEvent(new Event('scroll'));});
 assert.equal(await page.locator('.book-content').evaluate(n=>n.scrollLeft),0,'temporary collapsed selection does not unlock column auto-scroll');
 assert.equal(await page.locator('.reading-section').evaluate(n=>n.scrollLeft),0,'outer reader auto-scroll is also restored');
 await page.touchscreen.tap(700,100);assert.equal(await page.evaluate(()=>moves),0,'collapsed handle range cannot turn a page');
 await page.evaluate(()=>{selectText(0,24);const p=document.querySelector('p');p.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
 await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>getSelection().toString().length),24,'duplicate end events cannot reset the adjusted selection');
 await page.evaluate(()=>{const p=document.querySelector('p');p.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:true,button:0}));p.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
 await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>getSelection().toString().length),24,'tapping an unchanged handle preserves the selection');
 await page.waitForTimeout(400);
 await page.evaluate(()=>{getSelection().removeAllRanges();document.dispatchEvent(new Event('selectionchange'));const c=document.querySelector('.book-content');c.scrollLeft=820;c.dispatchEvent(new Event('scroll'));});
 assert.equal(await page.locator('.book-content').evaluate(n=>n.scrollLeft),0,'native handle changes without DOM pointer events also retain the scroll lock');
 await page.evaluate(()=>{selectText(0,24);document.dispatchEvent(new Event('selectionchange'));});
 await page.locator('#annotation').click();assert.equal(await page.evaluate(()=>annotationText.length),24,'native annotation button receives the expanded selection');
 await page.evaluate(()=>{const tick=document.createElement('span');tick.id='tick';document.body.append(tick);window.tickTimer=setInterval(()=>tick.textContent=String(Date.now()),50);});
 await page.locator('#close-selection').click();await page.waitForTimeout(500);
 assert.equal(await page.locator('app-book-reader').evaluate(n=>n.classList.contains('kv-text-selecting')),false,'background UI updates cannot keep selection protection stuck');
 await page.evaluate(()=>{clearInterval(tickTimer);document.getElementById('tick').remove();});
 await page.touchscreen.tap(700,400);await page.waitForFunction(()=>moves===1);
 await page.waitForTimeout(700);const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:450,y:100}]});
 for(const x of [400,350,300,250])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:100}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>moves===2);
 await page.mouse.move(35,12);await page.mouse.down();await page.mouse.move(300,12,{steps:10});await page.mouse.up();
 await page.waitForSelector('#annotation');assert.ok(await page.evaluate(()=>getSelection().toString().length>0),'real mouse drag creates a native text selection');assert.equal(await page.evaluate(()=>moves),2,'real text drag never turns a page');
 await page.evaluate(()=>document.querySelector('p').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:true,button:0})));
 await page.waitForTimeout(950);
 assert.equal(await page.locator('.overlay').evaluate(n=>getComputedStyle(n).visibility),'visible','missing handle end event cannot hide annotation controls forever');
 await page.evaluate(()=>{const p=document.querySelector('p');p.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:true,button:0}));getSelection().removeAllRanges();document.querySelector('app-book-line-overlay').replaceChildren();document.dispatchEvent(new Event('selectionchange'));const b=document.createElement('button');document.querySelector('.reader-header').append(b);b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
 await page.waitForTimeout(600);
 assert.equal(await page.locator('app-book-reader').evaluate(n=>n.classList.contains('kv-selection-adjusting')||n.classList.contains('kv-text-selecting')),false,'release over a toolbar button cannot leave all reader input disabled');
 await page.touchscreen.tap(700,400);await page.waitForFunction(()=>moves===3);
 assert.deepEqual(errors,[]);console.log('Selection drag regression passed: top toolbar placement, drag hit testing, collapsed-range scroll lock, duplicate end suppression, annotation action, and paging/swipe recovery. Native Android selection handles require manual verification.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
