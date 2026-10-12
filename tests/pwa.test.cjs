const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const {createServer}=require('node:http');
const assert=require('node:assert/strict');
(async()=>{
 const manifest=JSON.parse(readFileSync('proxy/pwa/manifest.webmanifest','utf8'));
 const server=createServer((request,response)=>{
  if(request.url==='/site.webmanifest'){response.setHeader('Content-Type','application/manifest+json');return response.end(JSON.stringify(manifest))}
  const icon=request.url.match(/^\/kavita-pwa\/(icon-(192|512)\.png)$/);
  if(icon){response.setHeader('Content-Type','image/png');return response.end(readFileSync('proxy/pwa/'+icon[1]))}
  response.setHeader('Content-Type','text/html');response.end('<link rel="manifest" href="/site.webmanifest"><title>Kavita PWA fixture</title><p>Reader fixture</p>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/library/1/series/1/book/1`);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Page.enable');
  const parsed=await cdp.send('Page.getAppManifest');assert.deepEqual(parsed.errors,[]);assert.equal(JSON.parse(parsed.data).display,'standalone');
  assert.equal(parsed.manifest.id,new URL('/',page.url()).href);assert.equal(parsed.manifest.scope,new URL('/',page.url()).href);
  for(const icon of manifest.icons){
   const size=Number(icon.sizes.split('x')[0]);const dimensions=await page.evaluate(src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve([image.naturalWidth,image.naturalHeight]);image.onerror=reject;image.src=src}),icon.src);
   assert.deepEqual(dimensions,[size,size]);
  }
  assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors,[]);
  assert.equal(await page.evaluate(()=>window.isSecureContext),true);
  assert.equal(await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(list=>list.length)),0,'installability does not require intercepting API requests');
  await page.route('http://insecure.fixture/**',route=>route.fulfill({contentType:'text/html',body:'<p>Insecure HTTP origin</p>'}));await page.goto('http://insecure.fixture/');assert.equal(await page.evaluate(()=>window.isSecureContext),false,'public HTTP needs HTTPS');
  console.log('PWA Chromium checks passed: valid manifest, real 192/512 PNG icons, root identity/scope on deep route, standalone, zero installability errors on loopback, no service-worker/API caching, insecure HTTP distinction.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
