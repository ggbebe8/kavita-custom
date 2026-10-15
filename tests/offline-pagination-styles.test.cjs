// A sandboxed measurement frame cannot rely on another network CSS fetch.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.env.KAVITA_INDICATOR_SCRIPT||'proxy/swipe.js','utf8');
const sections=[8,13,10].map(n=>`<div>${Array.from({length:n},()=>'<p>'+('Saved book text. '.repeat(35))+'</p>').join('')}</div>`);
(async()=>{const browser=await chromium.launch();try{const page=await browser.newPage({viewport:{width:800,height:600}});let blockCSS=false,rejected=0;
 await page.route('http://fixture.test/**',route=>{const u=new URL(route.request().url());
  if(u.pathname==='/reader.css'){if(blockCSS){rejected++;return route.abort();}return route.fulfill({contentType:'text/css',body:'body{margin:0}.reader-container{width:100vw}.book-content{height:360px;column-count:1;column-gap:20px;overflow:hidden;font:16px/24px sans-serif}p{margin:0 0 12px}'});}
  if(u.pathname==='/api/series/chapter')return route.fulfill({json:{pages:3,files:[{id:1,bytes:100,pages:3}]}});
  if(u.pathname.endsWith('/book-info'))return route.fulfill({json:{pages:3}});
  if(u.pathname.endsWith('/book-page'))return route.fulfill({contentType:'text/plain',body:sections[Number(u.searchParams.get('page'))]});
  return route.fulfill({contentType:'text/html',body:'<html><head><base href="/"><link rel="stylesheet" href="reader.css"></head><body><app-book-reader><div class="reader-container"><div class="reading-section column-layout-1"><div class="book-content"></div></div><div class="bottom-bar">Page</div></div></app-book-reader></body></html>'});
 });
 await page.goto('http://fixture.test/library/1/series/1/book/1?kv-offline=1');blockCSS=true;
 await page.addScriptTag({content:source});
 await page.evaluate(async()=>{const html=await(await fetch('/api/book/1/book-page?page=0',{headers:{Authorization:'Bearer fixture'}})).text();document.querySelector('.book-content').innerHTML=html;});
 await page.waitForFunction(()=>/^(?:\d+ \/ \d+|—)$/.test(document.querySelector('#kavita-screen-page-indicator').textContent),{},{timeout:10000});
 const label=await page.locator('#kavita-screen-page-indicator').textContent();
 if(process.env.KAVITA_EXPECT_STYLES_FAILURE){assert.equal(label,'—');assert.ok(rejected);console.log('Reproduced previous offline measurement failure when a frame refetched CSS.');return;}
 assert.match(label,/^\d+ \/ \d+$/);assert.equal(rejected,0,'measurement uses the loaded stylesheet instead of refetching it');
 await page.evaluate(()=>document.querySelector('.book-content').style.fontSize='20px');
 await page.waitForTimeout(1000);assert.match(await page.locator('#kavita-screen-page-indicator').textContent(),/^\d+ \/ \d+$/);assert.equal(rejected,0);
 console.log('Offline pagination styles passed: loaded CSS retained with network CSS blocked, including font-size recalculation.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
