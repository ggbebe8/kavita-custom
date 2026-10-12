const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
// Synthetic artwork and the native image-wrapper/bookmark geometry; no book
// content, credentials or live progress writes are needed by this regression.
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:360,height:800}});
  await page.setContent(`<style>
   *{box-sizing:border-box}body{margin:0}
   :root{--book-reader-content-max-width:324px;--book-reader-content-max-height:724px}
   .book-content{position:relative;width:324px;height:724px;margin:0 18px;column-count:1;column-gap:20px;overflow:hidden}
   .kavita-scale-width-container{position:absolute!important;left:50%;top:50%;transform:translate(-50%,-50%);width:95%;margin:0;line-height:0}
   img{max-width:var(--book-reader-content-max-width)!important;max-height:686px!important}
   .bookmark-overlay{position:absolute;left:307.8px;top:520px;width:42px;height:42px;visibility:hidden}
  </style><app-book-reader><div class="reading-section column-layout-1"><div class="book-content"><h1 class="kavita-scale-width-container"><img src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="324" height="552"/>'><div class="bookmark-overlay fa-regular fa-bookmark"></div></h1></div></div></app-book-reader>`);
  await page.locator('img').evaluate(img=>img.decode());
  const geometry=()=>page.locator('.book-content').evaluate(el=>{
   const size=el.clientWidth+20,total=Math.ceil(el.scrollWidth/size);
   el.scrollLeft=size;const current=Math.round((el.scrollLeft+size)/size);el.scrollLeft=0;
   return {total,current,extent:el.scrollWidth};
  });
  const before=await geometry();assert.equal(before.total,2);assert.equal(before.current,1,'native next target is clamped before reaching the extra page');
  await page.evaluate(()=>{window.__kavitaPageIndicatorInstalled=true;window.__kavitaFullscreenButtonInstalled=true;window.__kavitaBookmarkAffordanceInstalled=true});
  await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
  const after=await geometry();assert.equal(after.total,1);
  assert.ok(await page.locator('img').evaluate(img=>img.getBoundingClientRect().width<=img.parentElement.getBoundingClientRect().width+.1));
  await page.locator('.bookmark-overlay').evaluate(el=>el.style.visibility='visible');
  assert.equal((await geometry()).total,1,'revealed or saved image marker cannot add a page');
  for(const layout of ['column-layout-2','column-layout-1']){
   await page.locator('.reading-section').evaluate((el,layout)=>el.className='reading-section '+layout,layout);
   assert.equal((await geometry()).total,1);
  }
  await page.locator('.reading-section').evaluate(el=>el.className='reading-section');
  assert.equal((await geometry()).total,2,'scroll mode retains native styling');
  assert.equal(await page.locator('.bookmark-overlay').evaluate(el=>getComputedStyle(el).transform),'none');
  console.log('Image pagination Chromium regression passed:',JSON.stringify({before,after}),'hidden/visible glyph, narrow image wrapper, both column layouts, scroll mode exclusion.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
