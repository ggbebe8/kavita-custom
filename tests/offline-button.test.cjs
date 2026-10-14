const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require('playwright');
const root=path.resolve('proxy/pwa/offline');let continuationReads=0,infoReads=[],format=3,continuationId=20;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/')){
  assert.equal(req.method,'GET');assert.equal(req.headers.authorization,'Bearer fixture-token');res.setHeader('Content-Type','application/json');
  if(u.pathname==='/api/reader/continue-point'){continuationReads++;return res.end(JSON.stringify({id:continuationId}));}
  if(/\/book-info$/.test(u.pathname)){infoReads.push(Number(u.pathname.split('/')[3]));return res.end(JSON.stringify({seriesFormat:format}));}
  res.statusCode=404;return res.end('{}');
 }
 if(u.pathname.startsWith('/kavita-pwa/offline/')&&u.pathname.endsWith('.js')){res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(path.join(root,path.basename(u.pathname))));}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><main></main>');
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('kavita-user',JSON.stringify({id:1,username:'fixture',token:'fixture-token'})));
 const origin=`http://127.0.0.1:${server.address().port}`;
 async function setup(url,component){
  await page.goto(origin+url);await page.evaluate(component=>{document.querySelector('main').innerHTML=`<${component}><h1>책 제목</h1><p>작가와 설명</p><div class="row"><div class="col-auto"><div class="btn-group"><button id="read"><span class="read-btn--text">계속 읽기</span></button></div></div></div></${component}>`;window.readClicks=0;document.getElementById('read').onclick=()=>window.readClicks++;},component);
  await page.addScriptTag({type:'module',url:origin+'/kavita-pwa/offline/bridge.js'});await page.getByRole('button',{name:'오프라인 저장',exact:true}).waitFor();
 }
 await setup('/library/1/series/2','app-series-detail');
 assert.equal(await page.locator('.row > .col-auto + [data-kavita-offline-detail]').count(),1,'placed beside original read group');
 await page.evaluate(()=>document.querySelector('h1').textContent='제목 변경');await page.waitForTimeout(100);assert.equal(await page.locator('[data-kavita-offline]').count(),1,'no duplicate during SPA changes');
 assert.equal(continuationReads,0,'no extra API reads until explicitly clicked');
 await page.getByRole('button',{name:'오프라인 저장',exact:true}).click();await page.waitForURL('**/index.html?download=20');assert.equal(continuationReads,1);assert.deepEqual(infoReads,[20]);
 await setup('/library/1/series/2','app-series-detail');
 await page.evaluate(async()=>{const s=await import('/kavita-pwa/offline/store.js');await s.commitBook({key:'1:20',account:'1',chapterId:20,metadata:{seriesId:2,libraryId:1}},{key:'1:20',account:'1',dirty:false,drafts:{}});window.dispatchEvent(new Event('focus'));});
 await page.getByRole('button',{name:'오프라인 저장 완료',exact:true}).waitFor();
 assert.equal(await page.locator('[data-kavita-offline] .fa-circle-check').count(),1,'saved book gets a checkmark');
 assert.equal(await page.locator('[data-kavita-offline].btn-outline-success').count(),1,'saved book is visually distinguished');
 const readsBeforeSavedClick=infoReads.length;await page.getByRole('button',{name:'오프라인 저장 완료',exact:true}).click();await page.waitForURL('**/index.html?book=20');assert.equal(infoReads.length,readsBeforeSavedClick,'saved action opens local copy without re-downloading');
 continuationId=21;await setup('/library/1/series/2','app-series-detail');await page.waitForFunction(()=>document.querySelector('[data-kavita-offline]')?.dataset.saved==='false');assert.equal(await page.getByRole('button',{name:'오프라인 저장',exact:true}).count(),1,'a saved earlier volume does not mark an unsaved continue-point complete');
 continuationId=20;const seriesReads=continuationReads;
 await setup('/library/1/series/2/chapter/99','app-chapter-detail');await page.getByRole('button',{name:'오프라인 저장',exact:true}).click();await page.waitForURL('**/index.html?download=99');assert.equal(continuationReads,seriesReads,'chapter detail uses its exact chapter ID');assert.deepEqual(infoReads,[20,99]);
 format=1;await setup('/library/1/series/2/chapter/100','app-chapter-detail');await page.getByRole('button',{name:'오프라인 저장',exact:true}).click();await page.getByText('현재 EPUB 책만 오프라인 저장을 지원합니다.').waitFor();assert.equal(new URL(page.url()).pathname,'/library/1/series/2/chapter/100');
 await page.evaluate(()=>{history.pushState(null,'','/library/1/series/2/book/100');document.querySelector('main').innerHTML='<app-book-reader><div class="reader-header"><button><i class="fa-clipboard-question"></i></button></div></app-book-reader>';});
 await page.waitForTimeout(100);assert.equal(await page.locator('[data-kavita-offline]').count(),0,'download control removed from book reader');
 assert.deepEqual(errors,[]);console.log('Offline detail button passed: read-adjacent layout, no duplicates, series continue-point, exact chapter ID, EPUB validation, reader removal and authenticated GET only.');
}finally{await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
