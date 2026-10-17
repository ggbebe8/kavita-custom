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
 // Programmatic ranges (e.g. another reader feature) must not start a lock.
 await page.evaluate(()=>{selectText();const c=document.querySelector('.book-content');c.scrollLeft=100;c.dispatchEvent(new Event('scroll'));});
 assert.ok(await page.locator('.book-content').evaluate(n=>n.scrollLeft)>0,'programmatic range alone cannot lock scrolling');
 await page.evaluate(()=>{getSelection().removeAllRanges();document.querySelector('.book-content').scrollLeft=0;});
 await page.mouse.move(35,12);await page.mouse.down();await page.mouse.move(300,12,{steps:10});await page.mouse.up();
 await page.waitForTimeout(100);
 assert.ok(await page.evaluate(()=>getSelection().toString().length>0),'native mouse drag still selects text');
 assert.equal(await page.evaluate(()=>moves),0,'selecting text does not turn pages');
 await page.evaluate(()=>{selectText(0,24);const c=document.querySelector('.book-content');c.scrollLeft=820;c.dispatchEvent(new Event('scroll'));const r=document.querySelector('.reading-section');r.scrollLeft=10;r.dispatchEvent(new Event('scroll'));});
 assert.equal(await page.locator('.book-content').evaluate(n=>n.scrollLeft),0,'selection auto-scroll cannot move the content to a neighbouring column');
 assert.equal(await page.locator('.reading-section').evaluate(n=>n.scrollLeft),0,'outer reader cannot drift to a neighbouring page either');
 assert.equal(await page.evaluate(()=>getSelection().toString().length),24,'the native selected range is not rewritten');
 assert.equal(await page.evaluate(()=>typeof window.__kavitaSelectionBusy),'undefined','no custom input-lock state');
 assert.equal(await page.locator('app-book-reader').evaluate(n=>n.className.includes('kv-selection')),false,'no selection pointer-blocking classes');
 assert.equal(await page.locator('.overlay').evaluate(n=>getComputedStyle(n).visibility),'visible','native annotation toolbar remains visible');
 await page.locator('#annotation').click();assert.equal(await page.evaluate(()=>annotationText.length),24,'annotation receives the current selection');
 // A toolbar action releases position retention without requiring selectionchange.
 await page.evaluate(()=>{const c=document.querySelector('.book-content');c.scrollLeft=100;c.dispatchEvent(new Event('scroll'));});
 assert.ok(await page.locator('.book-content').evaluate(n=>n.scrollLeft)>0,'explicit controls remain free to navigate');
 // Arm another native selection at a non-zero page; only its paging axis is retained.
 await page.evaluate(()=>{const c=document.querySelector('.book-content');c.scrollLeft=820;c.querySelector('p').dispatchEvent(new Event('selectstart',{bubbles:true}));selectText(1400,1424);c.scrollLeft=0;c.dispatchEvent(new Event('scroll'));});
 assert.equal(await page.locator('.book-content').evaluate(n=>n.scrollLeft),820,'a later page is retained rather than reset to page one');
 await page.evaluate(()=>{getSelection().removeAllRanges();document.dispatchEvent(new Event('selectionchange'));document.querySelector('app-book-line-overlay').replaceChildren();const c=document.querySelector('.book-content');c.scrollLeft=100;c.dispatchEvent(new Event('scroll'));});
 assert.ok(await page.locator('.book-content').evaluate(n=>n.scrollLeft)>0,'clearing selection immediately releases position retention');
 await page.evaluate(()=>document.querySelector('.book-content').scrollLeft=0);
 await page.touchscreen.tap(700,400);await page.waitForFunction(()=>moves===1);
 await page.evaluate(()=>{const section=document.querySelector('.reading-section');section.classList.remove('column-layout-1');const p=section.querySelector('p');p.dispatchEvent(new Event('selectstart',{bubbles:true}));selectText();const c=section.querySelector('.book-content');c.scrollLeft=100;c.dispatchEvent(new Event('scroll'));});
 assert.ok(await page.locator('.book-content').evaluate(n=>n.scrollLeft)>0,'scroll mode is unaffected');
 await page.evaluate(()=>{getSelection().removeAllRanges();document.dispatchEvent(new Event('selectionchange'));const section=document.querySelector('.reading-section');section.classList.add('column-layout-1');const c=section.querySelector('.book-content');c.classList.add('writing-style-vertical');c.style.columnWidth='auto';c.querySelector('p').style.height='2000px';c.scrollTop=180;c.querySelector('p').dispatchEvent(new Event('selectstart',{bubbles:true}));selectText();c.scrollTop=0;c.dispatchEvent(new Event('scroll'));});
 assert.equal(await page.locator('.book-content').evaluate(n=>n.scrollTop),180,'vertical text retains its vertical paging axis');
 await page.evaluate(()=>{window.dispatchEvent(new Event('resize'));const c=document.querySelector('.book-content');c.scrollTop=0;c.dispatchEvent(new Event('scroll'));});
 assert.equal(await page.locator('.book-content').evaluate(n=>n.scrollTop),0,'layout changes release the stored position');
 assert.deepEqual(errors,[]);console.log('Native selection, paging-axis retention, explicit controls, programmatic ranges, scroll mode and touch recovery passed; Android handles require device testing');
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exit(1);});
