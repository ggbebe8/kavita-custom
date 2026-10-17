const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage({viewport:{width:800,height:600},hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent(`<style>
   body{margin:0}.fixed-top{position:fixed;top:0;width:100%;z-index:100}
   .reader-header{height:40px}.overlay{position:relative;height:60px;width:100vw;background:#333}
   .book-content{position:absolute;top:40px;left:20px;width:760px;height:500px;font:18px/24px sans-serif}
   p{margin:0;height:24px}.bottom-bar{position:fixed;bottom:0;height:40px;width:100%}
  </style><app-book-reader><div class="fixed-top"><div class="reader-header"></div><app-book-line-overlay></app-book-line-overlay></div>
   <div class="reading-section column-layout-1"><div class="book-content">${Array.from({length:18},(_,i)=>`<p>Selectable line ${i}: native text range.</p>`).join('')}</div></div><div class="bottom-bar"></div></app-book-reader>`);
  await page.evaluate(()=>{
   window.__kavitaPageIndicatorInstalled=true;window.__kavitaFullscreenButtonInstalled=true;window.__kavitaBookmarkAffordanceInstalled=true;
   window.selectLines=(anchor,focus)=>{const nodes=[...document.querySelectorAll('p')].map(p=>p.firstChild);getSelection().setBaseAndExtent(nodes[anchor],10,nodes[focus],1);};
   window.openTools=()=>{document.querySelector('app-book-line-overlay').innerHTML='<div class="overlay"><button id="annotate">Annotate</button></div>';document.querySelector('#annotate').onclick=()=>window.annotated=getSelection().toString();};
  });
  await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
  await page.evaluate(()=>{selectLines(9,8);openTools();});
  await page.waitForTimeout(80);
  assert.equal(await page.locator('.overlay').evaluate(n=>Math.round(n.getBoundingClientRect().top)),40,'middle selection leaves toolbar in its native position');
  await page.evaluate(()=>selectLines(9,0));
  await page.waitForFunction(()=>document.querySelector('app-book-reader').classList.contains('kv-selection-tools-bottom'));
  const bounds=await page.locator('.overlay').evaluate(n=>({top:n.getBoundingClientRect().top,bottom:n.getBoundingClientRect().bottom}));
  assert.ok(bounds.top>400,'growing an existing selection upwards relocates the toolbar');
  assert.ok(bounds.bottom<560,'toolbar clears the native bottom bar');
  assert.equal(await page.evaluate(()=>getSelection().focusNode===document.querySelector('p').firstChild),true,'moving toolbar preserves the selected endpoint');
  assert.equal(await page.evaluate(()=>document.elementFromPoint(400,85).closest('app-book-line-overlay')),null,'top text is no longer covered by Kavita actions');
  await page.evaluate(()=>selectLines(9,8));await page.waitForTimeout(50);
  assert.ok(await page.locator('.overlay').evaluate(n=>n.getBoundingClientRect().top)>400,'toolbar stays put throughout handle adjustment');
  const selected=await page.evaluate(()=>getSelection().toString());await page.locator('#annotate').click();
  assert.equal(await page.evaluate(()=>annotated),selected,'original toolbar button still receives selected text');
  await page.evaluate(()=>getSelection().removeAllRanges());
  await page.waitForFunction(()=>!document.querySelector('app-book-reader').classList.contains('kv-selection-tools-bottom'));
  assert.equal(await page.locator('.overlay').evaluate(n=>Math.round(n.getBoundingClientRect().top)),40,'closing selection restores native placement');
  await page.evaluate(()=>{document.querySelector('app-book-line-overlay').replaceChildren();selectLines(1,0);});
  await page.waitForTimeout(50);await page.evaluate(()=>openTools());
  await page.waitForFunction(()=>document.querySelector('app-book-reader').classList.contains('kv-selection-tools-bottom'));
  await page.evaluate(()=>document.querySelector('.overlay').innerHTML='<form><input id="bookmark-name"></form>');
  await page.waitForFunction(()=>!document.querySelector('app-book-reader').classList.contains('kv-selection-tools-bottom'));
  assert.equal(await page.locator('.overlay').evaluate(n=>Math.round(n.getBoundingClientRect().top)),40,'bookmark editor keeps native placement');
  assert.deepEqual(errors,[]);
  console.log('Selection toolbar passed: middle-to-top extension, unobstructed top text, stable placement, native annotation, reset, late toolbar and bookmark editor. Android handles need device testing.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
