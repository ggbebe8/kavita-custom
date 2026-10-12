const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  async function run(script){
   const page=await browser.newPage({viewport:{width:400,height:600},isMobile:true,hasTouch:true});
   await page.setContent(`<meta name="viewport" content="width=device-width"><style>:root{--book-reader-content-max-width:380px;--book-reader-content-max-height:400px}.book-content{width:380px;height:400px;column-count:1;column-gap:20px;overflow:hidden}</style><app-book-reader><div class="reading-section column-layout-1"><div class="book-content"><svg width="1600" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="1600" height="300" fill="gray"/></svg><p>Following text</p></div></div><div class="bottom-bar"><button><i class="fa-angle-left"></i></button><button><i class="next-page-highlight"></i></button></div></app-book-reader>`);
   await page.evaluate(()=>{window.moves=0;document.querySelector('.bottom-bar').lastChild.onclick=()=>moves++;window.__kavitaPageIndicatorInstalled=true;window.__kavitaFullscreenButtonInstalled=true;window.__kavitaBookmarkAffordanceInstalled=true});
   await page.addScriptTag({content:script});
   const width=await page.locator('svg').evaluate(el=>el.getBoundingClientRect().width);
   const cdp=await page.context().newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y:150}]});
   for(const x of [280,250,220,180,150]){await page.waitForTimeout(140);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:150}]});}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);
   const moves=await page.evaluate(()=>window.moves);await page.close();return {width,moves};
  }
  const before=await run(readFileSync('backups/image-swipe-20261013/swipe.js','utf8'));
  const after=await run(readFileSync('proxy/swipe.js','utf8'));
  assert.ok(before.width>380);assert.equal(before.moves,0);
  assert.ok(after.width<=380);assert.equal(after.moves,1);
  console.log('Chromium native touch regression passed:',JSON.stringify({before,after}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
