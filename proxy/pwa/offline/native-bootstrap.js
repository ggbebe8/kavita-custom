// Installed before Angular starts so its original XHRs can use local book data.
(() => {
  if(window.__kavitaNativeBootstrapInstalled||!('serviceWorker' in navigator))return;
  window.__kavitaNativeBootstrapInstalled=true;
  const offline=new URLSearchParams(location.search).get('kv-offline')==='1';
  if(offline){
    const raw=window.fetch.bind(window);
    window.__kavitaOfflineFetch=(input,options={})=>{const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));headers.set('X-Kavita-Offline-Network','1');return raw(input,{...options,headers});};
    window.fetch=(input,options={})=>{const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));if(!headers.has('X-Kavita-Offline-Network'))headers.set('X-Kavita-Offline-Mode','1');return raw(input,{...options,headers});};
    const xhrOpen=XMLHttpRequest.prototype.open,xhrSend=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open=function(method,url,...args){try{const target=new URL(url,location.href);this.__kvLocalRequest=target.origin===location.origin&&target.pathname.startsWith('/api/');}catch{this.__kvLocalRequest=false;}return xhrOpen.call(this,method,url,...args);};
    XMLHttpRequest.prototype.send=function(body){if(this.__kvLocalRequest)this.setRequestHeader('X-Kavita-Offline-Mode','1');return xhrSend.call(this,body);};
  }
  navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type!=='KAVITA_NATIVE_API'||!event.ports[0]||!offline)return;
    window.__kavitaNativeClient=event.data.request.client;
    window.__kavitaNativePending=(window.__kavitaNativePending||0)+1;
    import('/kavita-pwa/offline/native.js').then(module=>module.nativeRequest(event.data.request)).then(result=>event.ports[0].postMessage(result),()=>event.ports[0].postMessage({status:503,type:'text/plain',body:'기기 저장에 실패했습니다. 변경을 다시 확인하세요.'})).finally(()=>window.__kavitaNativePending--);
  });
  if(!offline)return;
  const NativeFontFace=window.FontFace;
  if(NativeFontFace)window.FontFace=class extends NativeFontFace{
    constructor(family,source,descriptors){
      if(typeof source==='string'&&window.__kavitaNativeClient)source=source.replace(/url\((['"]?)(.*?)\1\)/g,(all,quote,value)=>{try{const url=new URL(value,location.href);if(url.origin===location.origin&&url.pathname==='/api/font'){url.searchParams.set('kv-native-client',window.__kavitaNativeClient);return `url("${url.href}")`;}}catch{}return all;});
      super(family,source,descriptors);
    }
  };
  const initialAccount=(()=>{try{return JSON.parse(localStorage.getItem('kavita-user'))?.id;}catch{return null;}})();
  window.addEventListener('storage',event=>{if(event.key==='kavita-user'){let id;try{id=JSON.parse(event.newValue)?.id;}catch{}if(id!==initialAccount)location.href='/kavita-pwa/offline/index.html';}});
  const prepare=new URLSearchParams(location.search).get('kv-prepare');
  if(prepare){
    document.addEventListener('DOMContentLoaded',()=>{
      const cover=document.createElement('div');cover.setAttribute('role','status');cover.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;background:var(--body-bg,#171b24);color:var(--body-text-color,#fff);font:16px system-ui';
      const text=document.createElement('span');text.textContent='오프라인 리더 준비 중…';const back=document.createElement('a');back.href='/kavita-pwa/offline/index.html';back.textContent='책장으로';back.style.color='inherit';cover.append(text,back);document.body.append(cover);
    },{once:true});
    function fail(error){try{sessionStorage.setItem('kavita-native-error',String(error?.message||'리더 준비 시간이 초과되었습니다. 인터넷 연결 후 다시 시도하세요.').slice(0,400));}catch{}location.replace('/kavita-pwa/offline/index.html?native-error=1');}
    let stable=0;const timer=setInterval(()=>{
      const root=document.querySelector('app-book-reader .book-content');
      const images=[...(root?.querySelectorAll('img')||[])];
      const loaded=!!root&&(root.childNodes.length>0||!!window.__kavitaReaderSection?.())&&images.every(img=>img.complete&&img.naturalWidth>0);
      if(loaded&&!window.__kavitaNativePending&&document.fonts.status==='loaded'&&!document.querySelector('app-book-reader .reading-section.is-loading'))stable++;else stable=0;
      if(stable>=6){clearInterval(timer);import('/kavita-pwa/offline/native.js').then(module=>module.finishNativePreparation()).catch(fail);}
    },300);setTimeout(()=>{clearInterval(timer);fail();},45000);return;
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('app-book-reader .reader-header button');
    if(button?.querySelector('.fa-times-circle')){event.preventDefault();event.stopImmediatePropagation();location.href='/kavita-pwa/offline/index.html';}
  },true);
})();
