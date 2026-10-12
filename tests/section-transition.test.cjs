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
  await page.waitForFunction(()=>!document.querySelector('.reading-section').classList.contains('is-loading')&&!document.querySelector('.reader-header'));
  assert.deepEqual(await page.evaluate(()=>window.moves),['next']);
  let changes=await page.evaluate(()=>window.menuChanges);assert.equal(changes[1].loading,false);assert.equal(changes[1].text,'New section next');
  await page.waitForTimeout(700);await page.evaluate(()=>window.swipe('prev'));
  await page.waitForFunction(()=>window.moves.length===2&&!document.querySelector('.reading-section').classList.contains('is-loading')&&!document.querySelector('.reader-header'));
  changes=await page.evaluate(()=>window.menuChanges);assert.equal(changes[3].loading,false);assert.equal(changes[3].text,'New section prev');
  assert.deepEqual(await page.evaluate(()=>window.moves),['next','prev']);assert.deepEqual(errors,[]);
  console.log('Section transition Chromium tests passed: next/previous async section loading, no double turn, menu restored on new content after loading.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
