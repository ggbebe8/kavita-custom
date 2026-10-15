/* Public application code only is HTTP-cached. Authenticated book data stays
   in account-scoped IndexedDB and is supplied by the requesting reader client. */
const VERSION='kavita-offline-shell-a399145828b316b1';
const ROOT='/kavita-pwa/offline/';
const FILES=['index.html','offline.css','app.js','store.js','download.js','sync.js','bridge.js','native.js','native-bootstrap.js'].map(name=>ROOT+name);
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(VERSION);
  for(const url of FILES){const response=await fetch(url,{cache:'reload'});if(!response.ok)throw new Error('Offline shell download failed');await cache.put(url,response);}
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const target=await caches.open(VERSION);
  for(const key of await caches.keys())if(key.startsWith('kavita-offline-shell-')&&key!==VERSION){
    const old=await caches.open(key);
    // Keep the already downloaded native application across feature updates.
    // Keep the previous injected script as a fallback if the connection drops
    // during activation; replace it below when a fresh download succeeds.
    for(const request of await old.keys()){const path=new URL(request.url).pathname;if((path==='/__kavita_native_shell__'||publicAsset(new URL(request.url)))&&!FILES.includes(path)&&!await target.match(request))await target.put(request,await old.match(request));}
    await caches.delete(key);
  }
  try{const script=await fetch('/kavita-swipe.js',{cache:'reload'});if(script.ok)await target.put('/kavita-swipe.js',script);}catch{}
  await self.clients.claim();
})()));
const nativeClients=new Set();
const publicAsset=url=>url.origin===self.location.origin&&!url.pathname.startsWith('/api/')&&![...url.searchParams.keys()].some(k=>/^(apiKey|token|access_token|refreshToken)$/i.test(k))&&(/\.(?:js|css|woff2?|ttf|otf|svg|png|webp|ico)$/.test(url.pathname)||url.pathname.startsWith('/assets/'));
async function nativeClient(event){
  const resource=new URL(event.request.url),owner=(/^\/api\/book\/\d+\/book-resources$/.test(resource.pathname)||resource.pathname==='/api/font')?resource.searchParams.get('kv-native-client'):null;
  const client=await self.clients.get(owner||event.clientId||'');if(!client)return null;
  const url=new URL(client.url);return nativeClients.has(client.id)||url.searchParams.get('kv-offline')==='1'||event.request.headers.get('X-Kavita-Offline-Mode')==='1'?client:null;
}
async function localAPI(event,client){
  return new Promise(resolve=>{
    const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(new Response('Offline reader unavailable',{status:503}));},15000);
    channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();const r=e.data;resolve(new Response(r.body,{status:r.status||503,headers:{'Content-Type':r.type||'application/json','Cache-Control':'no-store'}}));};
    event.request.clone().text().then(body=>client.postMessage({type:'KAVITA_NATIVE_API',request:{url:event.request.url,method:event.request.method,body,client:client.id}},[channel.port2])).catch(()=>{clearTimeout(timer);resolve(new Response('',{status:503}));});
  });
}
async function precacheNative(){
  const cache=await caches.open(VERSION),response=await fetch('/',{cache:'reload'});if(!response.ok)throw new Error('Native shell unavailable');
  const html=await response.text();if(!html.includes('app-root'))throw new Error('Native reader not found');
  const queue=[],seen=new Set();
  function discover(text,base){
    const paths=[...text.matchAll(/["'\x60]([^"'\x60\s<>]+\.(?:js|css|woff2?|ttf|otf)(?:\?[^"'\x60\s<>]*)?)["'\x60]/g)].map(m=>m[1]);
    if(new URL(base).pathname.endsWith('.css'))for(const m of text.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g))paths.push(m[1]);
    for(const path of paths){try{const url=new URL(path,base);if(publicAsset(url)&&(!url.pathname.endsWith('.js')||/\/(?:chunk|main|polyfills|scripts|worker)-[\w-]+\.js$/.test(url.pathname))&&!url.pathname.startsWith('/kavita-')&&!seen.has(url.href)){seen.add(url.href);queue.push(url.href);}}catch{}}
  }
  discover(html,self.location.origin+'/');
  // Shared static code is about 6 MiB for the pinned version. Fetch with a
  // bounded pool; no book or account responses are added to CacheStorage.
  while(queue.length){const batch=queue.splice(0,6);await Promise.all(batch.map(async url=>{let r=await cache.match(url,{ignoreVary:true});if(!r){r=await fetch(url,{cache:'reload'});if(!r.ok){if(!/\.(js|css)(\?|$)/.test(url))return;throw new Error('Native asset download failed: '+new URL(url).pathname);}await cache.put(url,r.clone());}if(/\.(js|css)(\?|$)/.test(url))discover(await r.text(),url);}));}
  const headers=new Headers(response.headers);headers.delete('Content-Encoding');headers.delete('Content-Length');headers.delete('Transfer-Encoding');
  await cache.put('/__kavita_native_shell__',new Response(html,{headers}));
}
self.addEventListener('message',event=>{
  if(event.data?.type==='KAVITA_NATIVE_STATUS'&&event.ports[0]){
    event.waitUntil((async()=>{const shell=await(await caches.open(VERSION)).match('/__kavita_native_shell__');event.ports[0].postMessage({nativeProtocol:1,version:VERSION,shellReady:!!shell&&(await shell.text()).includes('/kavita-pwa/offline/native-bootstrap.js')});})());return;
  }
  if(event.data?.type!=='KAVITA_NATIVE_PRECACHE'||!event.ports[0])return;
  event.waitUntil(precacheNative().then(()=>event.ports[0].postMessage({ok:true,version:VERSION}),error=>event.ports[0].postMessage({ok:false,error:'기존 리더 파일을 저장하지 못했습니다: '+error.message})));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith('/hubs/')){event.respondWith((async()=>await nativeClient(event)?new Response('',{status:503}):fetch(event.request))());return;}
  if(url.pathname.startsWith('/api/')){
    if(event.request.headers.get('X-Kavita-Offline-Network')==='1')return;
    if(event.request.headers.get('X-Kavita-Offline-Mode')!=='1'&&!url.searchParams.has('kv-native-client'))return;
    event.respondWith((async()=>{const client=await nativeClient(event);return client?localAPI(event,client):url.searchParams.has('kv-native-client')?new Response('',{status:404}):fetch(event.request);})());return;
  }
  if(event.request.method!=='GET')return;
  if(url.pathname==='/kavita-swipe.js'){
    event.respondWith((async()=>{const cache=await caches.open(VERSION);try{const r=await fetch(event.request);if(r.ok)await cache.put(url.pathname,r.clone());return r;}catch(error){const saved=await cache.match(url.pathname);if(saved)return saved;throw error;}})());return;
  }
  if(FILES.includes(url.pathname)){
    event.respondWith((async()=>{const cache=await caches.open(VERSION);return await cache.match(url.pathname)||fetch(event.request);})());return;
  }
  if(event.request.mode==='navigate')event.respondWith((async()=>{
    const cache=await caches.open(VERSION),native=url.searchParams.get('kv-offline')==='1';
    if(native){const shell=await cache.match('/__kavita_native_shell__');if(shell){nativeClients.add(event.resultingClientId);return shell;}}
    try{const response=await fetch(event.request);if(response.status<500)return response;}catch{}
    const shell=await cache.match(ROOT+'index.html');
    return shell||new Response('오프라인 책장이 준비되지 않았습니다. 먼저 온라인에서 책을 저장하세요.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  })());
  // Public file content is identical across compression/Accept negotiation.
  else if(publicAsset(url))event.respondWith((async()=>{
    const cache=await caches.open(VERSION),saved=await cache.match(event.request,{ignoreVary:true});if(saved)return saved;
    const r=await fetch(event.request);if(r.ok)await cache.put(event.request,r.clone());return r;
  })());
});
