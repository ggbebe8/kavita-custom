const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const script=readFileSync('proxy/swipe.js','utf8');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:800,height:600}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let progress={pageNum:0,bookScrollId:'//body/p[1]'},writes=0,progressDelay=0;
  const text='<div><p>'+('A long paragraph spanning multiple screen pages. '.repeat(1200))+'</p></div>';
  await page.route('http://position.test/**',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/api/reader/progress'){progress=JSON.parse(route.request().postData());writes++;return route.fulfill({status:200,body:''});}
   if(u.pathname==='/api/reader/get-progress'){await new Promise(r=>setTimeout(r,progressDelay));return route.fulfill({json:progress});}
   if(u.pathname==='/api/series/chapter')return route.fulfill({json:{id:1,pages:2,files:[{id:1,bytes:123}],wordCount:1000}});
   if(u.pathname.endsWith('/book-page'))return route.fulfill({contentType:'text/html',body:text});
   return route.fulfill({contentType:'text/html',body:'<style>body{margin:0}.reader-container{width:800px}.book-content{width:800px;height:360px;column-count:1;column-gap:20px;overflow:hidden;font:16px/24px sans-serif}</style><app-book-reader><div class="reader-container"><div class="reading-section column-layout-1"><div class="book-container"><div class="book-content column-layout-1" style="max-height:360px"></div></div></div></div></app-book-reader>'});
  });
  async function start(){
   await page.goto('http://position.test/reader');await page.addScriptTag({content:script});
   await page.evaluate(async()=>{
    await fetch('/api/reader/get-progress?chapterId=1').then(r=>r.json());
    const text=await fetch('/api/book/1/book-page?page=0').then(r=>r.text());document.querySelector('.book-content').innerHTML=text;
   });
  }
  async function save(){await page.evaluate(()=>new Promise(resolve=>{const x=new XMLHttpRequest();x.open('POST','/api/reader/progress');x.setRequestHeader('Content-Type','application/json');x.onload=resolve;x.send(JSON.stringify({libraryId:1,seriesId:1,volumeId:1,chapterId:1,pageNum:0,bookScrollId:'//body/p[1]'}));}));}
  await start();await page.waitForFunction(()=>document.querySelector('#kavita-screen-page-indicator').dataset.pages.includes(' / '));
  await page.evaluate(()=>{document.querySelector('.book-content').scrollLeft=3*820;});await save();
  assert.match(progress.bookScrollId,/\[boolean\('kvscreen1:[0-9a-f-]+:3\.000000'\)\]$/);
  assert.equal(await page.evaluate(path=>{const d=new DOMParser().parseFromString('<p>paragraph</p>','text/html');return d.evaluate(path,d,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue.tagName;},progress.bookScrollId),'P');
  const original=progress.bookScrollId;await start();
  // Native restore of a long paragraph begins at screen 1. An early native save must not erase screen 4.
  await save();assert.equal(progress.bookScrollId,original);
  await page.waitForFunction(()=>Math.abs(document.querySelector('.book-content').scrollLeft-3*820)<1);
  assert.equal(writes,2,'Enhancement does not create extra progress writes');
  await save();assert.equal(progress.bookScrollId,original);
  // Fetch writes use the same enrichment, and unrelated API writes remain unchanged.
  await page.evaluate(()=>{document.querySelector('.book-content').scrollLeft=4*820;});
  await page.evaluate(()=>fetch('/api/reader/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chapterId:1,pageNum:0,bookScrollId:'//body/p[1]'})}));
  assert.match(progress.bookScrollId,/:4\.000000'\)\]$/);
  // Offline sync uses a semantic character offset, independent of viewport
  // dimensions. Native initial saves must retain it until exact restoration.
  progress={chapterId:1,pageNum:0,bookScrollId:"//body/p[1][boolean('kvoffline1:6000')]"};
  await start();await save();assert.equal(progress.bookScrollId,"//body/p[1][boolean('kvoffline1:6000')]");
  await page.waitForFunction(()=>{
    const content=document.querySelector('.book-content'),text=content.querySelector('p').firstChild,range=document.createRange();range.setStart(text,6000);range.setEnd(text,6001);
    const rect=range.getBoundingClientRect(),view=content.getBoundingClientRect();return content.scrollLeft>0&&rect.left>=view.left-2&&rect.left<view.right;
  });
  // A late initial-progress response must not undo an explicit chapter jump.
  progress={...progress,pageNum:1};progressDelay=300;
  await page.goto('http://position.test/reader');await page.addScriptTag({content:script});
  await page.evaluate(async()=>{
   const pending=fetch('/api/reader/get-progress?chapterId=1').then(r=>r.json());
   document.dispatchEvent(new Event('kavita-page-navigation'));
   const html=await fetch('/api/book/1/book-page?page=1').then(r=>r.text());document.querySelector('.book-content').innerHTML=html;
   document.querySelector('.book-content').scrollLeft=0;await pending;
  });
  await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>document.querySelector('.book-content').scrollLeft),0,'Late resume must not jump to saved screen after navigation');
  assert.deepEqual(errors,[]);
  console.log('Reading position Chromium tests passed: long paragraph screen offset, server-backed reload, valid XPath, early-save protection, XHR/fetch enrichment, no extra writes.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
