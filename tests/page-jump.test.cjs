const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const sections=[12,20,10].map(n=>`<div>${Array.from({length:n},(_,i)=>`<p>Paragraph ${i}. ${'Screen pagination fixture text. '.repeat(16)}</p>`).join('')}</div>`);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:800,height:600},hasTouch:true});page.setDefaultTimeout(10000);
  const errors=[],requests=[],saves=[];let slow=false;page.on('pageerror',error=>errors.push(error.message));
  await page.route('http://fixture.test/**',async route=>{
   const request=route.request(),url=new URL(request.url());requests.push({path:url.pathname,method:request.method()});
   if(url.pathname==='/api/reader/progress'){saves.push(JSON.parse(request.postData()));return route.fulfill({json:true})}
   if(url.pathname==='/api/series/chapter')return route.fulfill({json:{id:1,pages:3,createdUtc:'2026-01-01',wordCount:1000,files:[{id:1,bytes:100,pages:3}]}});
   if(url.pathname.endsWith('/book-page')){if(slow)await new Promise(resolve=>setTimeout(resolve,250));return route.fulfill({contentType:'text/html',body:sections[Number(url.searchParams.get('page'))]})}
   return route.fulfill({contentType:'text/html',body:`<style>
    body{margin:0}.reader-container{width:100vw}.book-content{height:360px;column-count:1;column-gap:20px;overflow:hidden;font:16px/24px sans-serif}p{margin:0 0 12px}
    .bottom-bar{position:fixed;bottom:0;width:100%;height:40px}ngb-modal-window{position:fixed;inset:100px;background:white;z-index:1055}ngb-modal-window input{display:block}
   </style><app-book-reader><div class="reader-container"><div class="reading-section column-layout-1"><div class="book-container immersive"><div class="book-content column-layout-1" style="max-height:360px"></div></div></div></div></app-book-reader>`});
  });
  await page.goto('http://fixture.test/');await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
  await page.evaluate(()=>{
   const root=document.querySelector('app-book-reader'),content=root.querySelector('.book-content'),section=root.querySelector('.reading-section');window.index=0;window.nativeJumps=[];window.menuToggles=0;
   window.navigate=async index=>{
    section.classList.add('is-loading');const html=await fetch(`/api/book/1/book-page?page=${index}`,{headers:{Authorization:'Bearer fixture-only'}}).then(response=>response.text());
    window.index=index;content.innerHTML=html;content.scrollLeft=0;section.classList.remove('is-loading');setTimeout(()=>content.scrollLeft=0,100);
   };
   window.closeMenu=()=>{root.querySelector('.reader-header')?.remove();root.querySelector('.bottom-bar')?.remove()};
   window.openMenu=()=>{
    if(root.querySelector('.reader-header'))return;
    const header=document.createElement('div');header.className='reader-header';root.append(header);
    const bar=document.createElement('div');bar.className='bottom-bar';bar.innerHTML='<button><i class="fa-angle-left"></i></button><a class="btn-link" href="javascript:void(0)">Page</a><button><i class="next-page-highlight"></i></button>';root.append(bar);
    bar.querySelector('a').onclick=()=>{
     const modal=document.createElement('ngb-modal-window');modal.setAttribute('role','dialog');modal.innerHTML='<app-confirm-dialog class="confirm-prompt"><div class="modal-header"><h4 class="modal-title">Native page</h4><button type="button">Close</button></div><div class="modal-body"><form><div>Native section count: 3</div><input type="text" formcontrolname="prompt"></form></div><div class="modal-footer"><button type="button" class="btn-secondary">Cancel</button><button type="button" class="btn-primary">OK</button></div></app-confirm-dialog>';
     document.body.classList.add('modal-open');document.body.append(modal);let value='';modal.querySelector('input').addEventListener('input',event=>value=event.target.value);
     const close=()=>{modal.remove();document.body.classList.remove('modal-open')};
     modal.querySelector('.btn-primary').onclick=()=>{const target=parseInt(value,10)-1;nativeJumps.push(target);close();if(target!==window.index)void navigate(target)};
     modal.querySelector('.btn-secondary').onclick=close;modal.querySelector('.modal-header button').onclick=close;
     modal.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
    };
   };
   content.onclick=()=>{menuToggles++;if(root.querySelector('.reader-header'))closeMenu();else openMenu()};openMenu();
   let saveTimer;root.querySelector('.reader-container').addEventListener('scroll',()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>{if(section.classList.contains('is-loading'))return;fetch('/api/reader/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chapterId:1,pageNum:window.index,bookScrollId:'//div/p[1]'})})},200)},true);
  });
  let counts=await page.evaluate(sections=>{const content=document.querySelector('.book-content');return sections.map(html=>{content.innerHTML=html;return Math.ceil(content.scrollWidth/820)})},sections);
  let total=counts.reduce((a,b)=>a+b,0);const label=page.locator('#kavita-screen-page-indicator'),input=page.locator('ngb-modal-window input'),confirm=page.locator('ngb-modal-window .btn-primary');
  await page.evaluate(()=>navigate(0));await page.waitForFunction(total=>document.querySelector('#kavita-screen-page-indicator').textContent===`1 / ${total}`&&!document.querySelector('#kavita-screen-page-indicator').disabled,total);
  assert.ok(counts.every(count=>count>=3));
  async function open(touch=false){if(touch)await label.tap();else await label.click();await input.waitFor();assert.equal(await page.locator('.modal-title').textContent(),'전체 페이지로 이동');assert.equal(await input.getAttribute('max'),String(total))}
  async function jump(number,keyboard=false){await open();await input.fill(String(number));if(keyboard)await input.press('Enter');else await confirm.click();await page.waitForFunction(({number,total})=>document.querySelector('#kavita-screen-page-indicator').textContent===`${number} / ${total}`&&!document.querySelector('#kavita-screen-page-indicator').disabled,{number,total})}
  await open(true);assert.equal(await input.inputValue(),'1');
  for(const value of ['0',String(total+1),'1.5']){await input.fill(value);await confirm.click();assert.equal(await page.locator('ngb-modal-window').count(),1);assert.ok(await page.locator('#kavita-page-jump-validation').textContent());assert.deepEqual(await page.evaluate(()=>nativeJumps),[])}
  await page.locator('ngb-modal-window .btn-secondary').click();await page.waitForTimeout(150);assert.equal(await label.textContent(),`1 / ${total}`);
  await jump(3,true);assert.equal(await page.evaluate(()=>index),0,'same-section jump needs no section load');assert.equal(await page.locator('.book-content').evaluate(el=>Math.round(el.scrollLeft/820)),2);
  slow=true;const target=counts[0]+3;await jump(target);assert.equal(await page.evaluate(()=>index),1);assert.equal(await page.locator('.book-content').evaluate(el=>Math.round(el.scrollLeft/820)),2);
  await page.waitForTimeout(300);assert.ok(saves.some(save=>save.pageNum===1&&save.bookScrollId.includes(':2.000000')),'native progress receives exact selected screen');
  await jump(total);assert.equal(await page.evaluate(()=>index),2);await jump(1);assert.equal(await page.evaluate(()=>index),0);
  await page.evaluate(()=>closeMenu());await jump(target);assert.equal(await page.locator('.reader-header').count(),0,'immersive menu hidden after jump');
  await open();await page.locator('ngb-modal-window .modal-header button').click();await page.waitForTimeout(150);assert.equal(await page.locator('ngb-modal-window').count(),0);assert.equal(await page.locator('.reader-header').count(),0,'cancel restores immersive menu');
  await open();const jumpCount=await page.evaluate(()=>nativeJumps.length);await page.setViewportSize({width:900,height:600});await input.fill('1');await confirm.click();assert.equal(await page.locator('ngb-modal-window').count(),1);assert.equal(await page.evaluate(()=>nativeJumps.length),jumpCount);assert.match(await page.locator('#kavita-page-jump-validation').textContent(),/설정이 변경/);await input.press('Escape');
  await page.waitForTimeout(200);assert.equal(await page.locator('.swipe-restoring-menu').count(),0);
  await page.setViewportSize({width:800,height:600});
  await page.evaluate(()=>{document.querySelector('.reading-section').className='reading-section column-layout-2';document.querySelector('.book-content').style.columnCount='2'});
  counts=await page.evaluate(sections=>{const content=document.querySelector('.book-content'),html=content.innerHTML,offset=content.scrollLeft;const result=sections.map(html=>{content.innerHTML=html;return Math.ceil(content.scrollWidth/820)});content.innerHTML=html;content.scrollLeft=offset;return result},sections);
  total=counts.reduce((a,b)=>a+b,0);await page.waitForTimeout(350);
  await page.waitForFunction(total=>document.querySelector('#kavita-screen-page-indicator').textContent.endsWith(` / ${total}`)&&!document.querySelector('#kavita-screen-page-indicator').disabled,total);
  await jump(1);await jump(counts[0]+2);assert.equal(await page.evaluate(()=>index),1,'two-column whole-page mapping');assert.equal(await page.locator('.book-content').evaluate(el=>Math.round(el.scrollLeft/820)),1);
  const positionBeforeCancel=await label.textContent();await open();await input.fill(String(counts[0]+3));await confirm.click();
  await page.waitForFunction(()=>!document.querySelector('ngb-modal-window'));await page.mouse.click(400,100);await page.waitForTimeout(700);
  assert.equal(await label.textContent(),positionBeforeCancel,'new reader action cancels delayed screen movement');assert.equal(await page.locator('#kavita-page-jump-message').count(),0,'intentional cancellation is silent');
  assert.equal(requests.filter(request=>request.method!=='GET'&&request.path!=='/api/reader/progress').length,0,'only native progress writes');assert.deepEqual(errors,[]);
  console.log('Whole-book page jump Chromium tests passed:',JSON.stringify({counts,total}),'touch/click activation, bounds/validation, cancel, same section, async section, first/last, Enter, immersive restore, changed layout rejection, two-column mapping, explicit navigation cancellation, native exact progress.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
