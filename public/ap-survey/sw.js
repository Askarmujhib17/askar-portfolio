const CACHE='ap-survey-shell-v7';
const FILES=['/ap-survey/','/ap-survey/app.js','/ap-survey/schema.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('ap-survey-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith('/ap-survey/')||url.pathname.endsWith('/sw.js'))return;
 const key=event.request.mode==='navigate'?'/ap-survey/':url.pathname;
 if(!FILES.includes(key))return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(key,copy)));}
  return response;
 }).catch(async()=>{const cached=await caches.match(key);return cached||new Response('Open AP Survey online once before using it offline.',{status:503});}));
});
