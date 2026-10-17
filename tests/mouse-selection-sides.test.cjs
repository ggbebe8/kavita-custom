const {firefox,chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const browser=await (process.env.KAVITA_SELECTION_BROWSER==='chromium'?chromium:firefox).launch();try{
 const page=await browser.newPage({viewport:{width:900,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://mouse.test/**',route=>route.fulfill(new URL(route.request().url()).pathname==='/kavita-pwa/selection-paging.js'?{contentType:'application/javascript',body:fs.readFileSync('proxy/pwa/selection-paging.js','utf8')}:{contentType:'text/html',body:`<style>body{margin:0}.book-content{position:absolute;top:40px;width:900px;height:480px;overflow:hidden;font:20px/26px sans-serif}p{margin:0}.tap-to-paginate>div{position:fixed;top:40px;width:20vw;height:480px;z-index:3}.left{left:0}.right{right:0}.bottom-bar{position:fixed;bottom:0}</style><app-book-reader><app-book-line-overlay></app-book-line-overlay><div class="reader-header"></div><div class="reading-section column-layout-1"><div class="book-content"><p>${'Mouse text selection across transparent side paging areas. '.repeat(250)}</p></div></div><div class="tap-to-paginate"><div class="left"></div><div class="right"></div></div><div class="bottom-bar"><button><i class="fa-angle-left"></i></button><button><i class="next-page-highlight"></i></button></div></app-book-reader>`}));
 await page.goto('http://mouse.test');await page.evaluate(()=>{
  window.__kavitaPageIndicatorInstalled=true;window.__kavitaFullscreenButtonInstalled=true;window.__kavitaBookmarkAffordanceInstalled=true;window.moves=[];
  document.querySelector('.left').onclick=()=>moves.push('prev');document.querySelector('.right').onclick=()=>moves.push('next');
 });await page.addScriptTag({content:fs.readFileSync('proxy/swipe.js','utf8')});
 assert.equal(await page.locator('.left').evaluate(n=>getComputedStyle(n).pointerEvents),'none','fine pointers reach text under native paging area');
 for(const [from,to] of [[{x:25,y:130},{x:160,y:180}],[{x:780,y:260},{x:870,y:300}]]){
  await page.evaluate(()=>getSelection().removeAllRanges());await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});await page.mouse.up();
  assert.ok(await page.evaluate(()=>getSelection().toString().length)>0,'native text drag works inside each side area');assert.deepEqual(await page.evaluate(()=>moves),[],'selection drag never pages');
 }
 await page.evaluate(()=>getSelection().removeAllRanges());await page.mouse.click(60,200);await page.waitForFunction(()=>moves.length===1);assert.deepEqual(await page.evaluate(()=>moves),['prev']);
 await page.mouse.click(840,200);await page.waitForFunction(()=>moves.length===2);assert.deepEqual(await page.evaluate(()=>moves),['prev','next'],'stationary side clicks retain native page direction');
 await page.evaluate(()=>document.querySelector('.tap-to-paginate').remove());await page.mouse.click(60,200);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>moves.length),2,'disabled native click paging remains disabled');
 assert.deepEqual(errors,[]);console.log('Mouse side selection passed: real left/right text dragging, no page changes while selecting, stationary native side clicks and disabled native paging.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
