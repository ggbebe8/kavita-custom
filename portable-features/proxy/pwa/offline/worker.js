/* Only the public offline UI is cached here. Books/notes live in account-scoped
   IndexedDB; authenticated API traffic is never put in a shared HTTP cache. */
const VERSION='kavita-offline-shell-c5cc53a155ceda1f';
const ROOT='/kavita-pwa/offline/';
const FILES=['index.html','offline.css','app.js','store.js','download.js','sync.js','bridge.js'].map(name=>ROOT+name);
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(VERSION);
  for(const url of FILES){const response=await fetch(url,{cache:'reload'});if(!response.ok)throw new Error('Offline shell download failed');await cache.put(url,response);}
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('kavita-offline-shell-')&&key!==VERSION)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||event.request.method!=='GET'||url.pathname.startsWith('/api/'))return;
  if(FILES.includes(url.pathname)){
    event.respondWith((async()=>{const cache=await caches.open(VERSION);return await cache.match(url.pathname)||fetch(event.request);})());return;
  }
  if(event.request.mode==='navigate')event.respondWith((async()=>{
    try{const response=await fetch(event.request);if(response.status<500)return response;}catch{}
    const shell=await (await caches.open(VERSION)).match(ROOT+'index.html');
    return shell||new Response('오프라인 책장이 준비되지 않았습니다. 먼저 온라인에서 책을 저장하세요.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  })());
});
