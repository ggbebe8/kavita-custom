// Rollback worker: leave downloaded books and unsent edits in IndexedDB.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('kavita-offline-shell-'))await caches.delete(key);
  await self.clients.claim();await self.registration.unregister();
})()));
