const {chromium}=require('playwright');const {readFileSync}=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch();try{
 async function fixture(delay){
  const page=await browser.newPage({viewport:{width:800,height:600},hasTouch:true});
  await page.route('http://fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0}.book-content{position:absolute;inset:0}.reader-header{height:30px}.bottom-bar{position:absolute;bottom:0}</style><app-book-reader><div class="reading-section column-layout-1"><div class="book-container immersive"><div class="book-content">Text</div></div></div></app-book-reader>'}));
  await page.goto('http://fixture.test/');
  await page.evaluate(delay=>{
   localStorage.setItem('kavita-height-tap-zones-v1:guest','true');window.__kavitaPageIndicatorInstalled=true;window.__kavitaFullscreenButtonInstalled=true;window.__kavitaBookmarkAffordanceInstalled=true;
   window.moves=0;window.menuChanges=[];window.closedAt=0;
   const root=document.querySelector('app-book-reader'),section=root.querySelector('.reading-section'),content=root.querySelector('.book-content');
   content.onclick=()=>{
    const header=root.querySelector('.reader-header');menuChanges.push(!header);
    if(header){header.remove();root.querySelector('.bottom-bar').remove();closedAt=performance.now();return}
    const top=document.createElement('div');top.className='reader-header';root.append(top);
    const bar=document.createElement('div');bar.className='bottom-bar';bar.innerHTML='<button><i class="fa-angle-left"></i></button><button><i class="next-page-highlight"></i></button>';
    bar.lastChild.onclick=()=>{moves++;if(delay){section.classList.add('is-loading');setTimeout(()=>{content.textContent='Next section';section.classList.remove('is-loading')},delay)}};root.append(bar);
   };
  },delay);
  await page.addScriptTag({content:readFileSync(process.env.KAVITA_TEST_JS||'proxy/swipe.js','utf8')});return page;
 }
 let page=await fixture(0);await page.touchscreen.tap(700,400);
 await page.waitForFunction(()=>closedAt>0&&!document.querySelector('.swipe-restoring-menu'));
 await page.waitForFunction(()=>performance.now()-closedAt>=585);await page.touchscreen.tap(700,400);
 assert.equal(await page.locator('.reader-header').count(),0,'tap in the 500–650ms cooldown gap must not open the menu');assert.equal(await page.evaluate(()=>moves),1);
 await page.waitForTimeout(750);await page.touchscreen.tap(400,250);assert.equal(await page.locator('.reader-header').count(),1,'intentional middle tap still opens menu');await page.close();
 page=await fixture(5500);await page.touchscreen.tap(700,400);await page.waitForTimeout(5200);
 assert.equal(await page.locator('.swipe-restoring-menu').count(),1,'slow section load must keep temporary menu hidden beyond five seconds');
 assert.equal(await page.locator('.reader-header').evaluate(el=>getComputedStyle(el).visibility),'hidden');
 await page.waitForFunction(()=>!document.querySelector('.is-loading')&&!document.querySelector('.reader-header'));
 assert.deepEqual(await page.evaluate(()=>menuChanges),[true,false]);
 await page.waitForTimeout(750);await page.touchscreen.tap(400,250);assert.equal(await page.locator('.reader-header').count(),1);await page.close();
 page=await fixture(1200);await page.touchscreen.tap(700,400);await page.waitForTimeout(800);await page.touchscreen.tap(700,400);
 await page.waitForFunction(()=>!document.querySelector('.is-loading')&&!document.querySelector('.reader-header'));
 assert.deepEqual(await page.evaluate(()=>menuChanges),[true,false],'touch while loading cannot toggle the temporary menu');assert.equal(await page.evaluate(()=>moves),1);
 console.log('Immersive native touch regression passed: cooldown gap, slow >5s load, touches during load, intentional center menu.');
 }finally{await browser.close()}})().catch(error=>{console.error(error);process.exitCode=1});
