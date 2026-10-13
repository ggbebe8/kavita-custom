const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:900,height:600},hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('http://fixture.test/**',route=>route.fulfill({contentType:'text/html',body:`<style>
   body{margin:0}.book-content{position:absolute;inset:40px 0;height:520px;touch-action:pan-y pinch-zoom}
   .tap-to-paginate>div{position:absolute;top:40px;width:20vw;height:520px;z-index:3}.left{left:0}.right{right:0}
   .reader-header{position:absolute;top:0}.bottom-bar{position:absolute;bottom:0}
  </style><app-book-reader><div class="reading-section column-layout-1"><div class="book-container immersive"><div class="book-content"><p>Selectable text</p><a style="position:absolute;left:70px;top:100px" href="#link">Link</a></div></div></div><div class="tap-to-paginate"><div class="left"></div><div class="right"></div></div></app-book-reader>`}));
  await page.addInitScript(()=>{
   window.__kavitaPageIndicatorInstalled=true;window.__kavitaFullscreenButtonInstalled=true;window.__kavitaBookmarkAffordanceInstalled=true;
   localStorage.setItem('kavita-user',JSON.stringify({username:'fixture'}));
  });
  await page.goto('http://fixture.test/');
  await page.evaluate(()=>{
   const root=document.querySelector('app-book-reader');window.moves=[];window.menuChanges=0;
   window.addMenu=()=>{
    if(root.querySelector('.reader-header'))return;
    const header=document.createElement('div');header.className='reader-header';root.append(header);
    const bar=document.createElement('div');bar.className='bottom-bar';bar.innerHTML='<button><i class="fa-angle-left"></i></button><button><i class="next-page-highlight fa-angle-right"></i></button>';
    bar.firstChild.onclick=()=>moves.push('prev');bar.lastChild.onclick=()=>moves.push('next');root.append(bar);
   };
   window.removeMenu=()=>{root.querySelector('.reader-header')?.remove();root.querySelector('.bottom-bar')?.remove()};
   root.querySelector('.book-content').onclick=()=>{menuChanges++;if(root.querySelector('.reader-header'))removeMenu();else addMenu()};
   root.querySelector('.tap-to-paginate .left').onclick=()=>moves.push('prev');
   root.querySelector('.tap-to-paginate .right').onclick=()=>moves.push('next');addMenu();
   window.addSettings=()=>{const drawer=document.createElement('app-epub-setting-drawer');drawer.innerHTML='<app-reader-settings><div class="controls"><input id="fontsize" type="range"></div></app-reader-settings>';document.body.append(drawer)};
  });
  await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
  async function settings(enabled){
   await page.evaluate(()=>addSettings());const control=page.locator('[data-kavita-height-tap-zones]');await control.waitFor();
   assert.equal(await control.count(),1);await control.setChecked(enabled);
   await page.locator('app-epub-setting-drawer').evaluate(el=>el.remove());await page.waitForTimeout(50);
  }
  async function click(x,y){await page.waitForTimeout(700);await page.mouse.click(x,y);await page.waitForTimeout(100)}
  const moves=()=>page.evaluate(()=>moves);
  // Off by default: original left=previous/right=next behavior.
  await click(70,400);await click(830,100);assert.deepEqual(await moves(),['prev','next']);
  await settings(true);await page.evaluate(()=>{moves=[];addMenu()});
  for(const [x,y] of [[70,100],[830,100],[70,400],[830,400]])await click(x,y);
  assert.deepEqual(await moves(),['prev','prev','next','next']);
  assert.equal(await page.evaluate(()=>localStorage.getItem('kavita-height-tap-zones-v1:fixture')),'true');
  await click(70,199);await click(830,200);assert.deepEqual((await moves()).slice(-2),['prev','next'],'one-third boundary');
  let count=(await moves()).length,menus=await page.evaluate(()=>menuChanges);
  await click(450,100);assert.equal((await moves()).length,count);assert.equal(await page.evaluate(()=>menuChanges),menus+1,'middle keeps native menu');
  await click(450,400);assert.equal((await moves()).length,count);
  // Hidden menu uses the same native-button bridge as swipe.
  await page.evaluate(()=>removeMenu());await click(830,100);
  assert.equal((await moves()).at(-1),'prev');assert.equal(await page.locator('.reader-header').count(),0);
  await page.evaluate(()=>addMenu());count=(await moves()).length;
  await click(85,145);assert.equal((await moves()).length,count,'links retain native behavior');
  await page.evaluate(()=>{const icon=document.createElement('div');icon.className='bookmark-overlay';icon.id='saved-marker';icon.style.cssText='position:absolute;left:820px;top:50px;width:30px;height:30px';icon.onclick=()=>{window.markerClicks=(window.markerClicks||0)+1};document.querySelector('.book-content').append(icon)});
  await click(830,100);assert.equal((await moves()).length,count,'bookmark control retains native action');assert.equal(await page.evaluate(()=>markerClicks),1);await page.locator('#saved-marker').evaluate(el=>el.remove());
  await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('p'));getSelection().removeAllRanges();getSelection().addRange(range)});
  await click(830,100);assert.equal((await moves()).length,count,'selected text does not page');
  await page.evaluate(()=>getSelection().removeAllRanges());
  await page.evaluate(()=>{const popup=document.createElement('div');popup.setAttribute('role','dialog');popup.id='popup';popup.style.cssText='position:absolute;left:400px;top:500px;width:20px;height:20px';document.body.append(popup)});
  await click(830,100);assert.equal((await moves()).length,count,'popup excludes paging');await page.locator('#popup').evaluate(el=>el.remove());
  await page.waitForTimeout(700);await page.mouse.move(830,400);await page.mouse.down();await page.mouse.move(790,400);await page.mouse.up();await page.waitForTimeout(100);
  assert.equal((await moves()).length,count,'drag does not become a tap');
  await page.evaluate(()=>addMenu());
  await page.waitForTimeout(700);await page.touchscreen.tap(830,400);await page.waitForTimeout(100);
  assert.equal((await moves()).at(-1),'next','real Chromium touch tap');
  count=(await moves()).length;await page.touchscreen.tap(830,400);await page.waitForFunction(count=>moves.length===count+1,count);assert.equal((await moves()).length,count+1,'fresh rapid tap accepted');
  await page.waitForTimeout(700);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:450,y:400}]});
  for(const x of [480,520,560,610]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:400}]});await page.waitForTimeout(20)}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);
  assert.equal((await moves()).at(-1),'prev','right swipe still means previous in the lower next-tap region');
  count=(await moves()).length;await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:450,y:400},{x:650,y:400}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:430,y:400},{x:670,y:400}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);
  assert.equal((await moves()).length,count,'two-finger touch does not page');
  // Same browser/account persists; another account starts disabled.
  await page.evaluate(()=>{localStorage.setItem('kavita-user',JSON.stringify({username:'other'}));document.querySelector('p').textContent+=' ';});
  await page.waitForTimeout(50);await click(70,400);assert.equal((await moves()).at(-1),'prev');
  await page.evaluate(()=>{localStorage.setItem('kavita-user',JSON.stringify({username:'fixture'}));document.querySelector('p').textContent+=' ';});
  await page.waitForTimeout(50);await click(70,400);assert.equal((await moves()).at(-1),'next');
  await page.locator('.reading-section').evaluate(el=>el.className='reading-section');await page.waitForTimeout(50);
  await click(70,400);assert.equal((await moves()).at(-1),'prev','scroll mode keeps native overlay');
  await page.locator('.reading-section').evaluate(el=>el.className='reading-section column-layout-2');await page.waitForTimeout(50);
  await click(70,400);assert.equal((await moves()).at(-1),'next','two-column mode');
  await settings(false);await click(70,400);assert.equal((await moves()).at(-1),'prev','disable restores original paging');
  assert.deepEqual(errors,[]);
  console.log('Height tap zone Chromium tests passed: default off, all four zones, 1/3 boundary, center/menu, immersive, mouse/touch, duplicate guard, selection/link/popup/drag exclusions, per-account persistence, scroll mode, two columns, disable.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
