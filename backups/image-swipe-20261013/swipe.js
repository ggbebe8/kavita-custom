(() => {
  'use strict';
  if (window.__kavitaSwipeInstalled) return;
  window.__kavitaSwipeInstalled = true;
  const interactive = 'a,button,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="button"]';
  const overlays = 'ngb-modal-window,ngb-offcanvas,[role="dialog"],.modal.show,.offcanvas.show,.drawer,.drawer-backdrop,app-highlight-bar,.popover,.dropdown-menu.show';
  let gesture = null, lastTurn = -Infinity, suppressUntil = 0, turning = false;
  const style = document.createElement('style');
  style.textContent = 'app-book-reader.swipe-restoring-menu .reader-header, app-book-reader.swipe-restoring-menu .bottom-bar { visibility: hidden !important; }';
  document.head.appendChild(style);
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const selected = () => !!window.getSelection()?.toString();
  const blocked = root => selected() || !root.isConnected ||
    root.querySelector('.reading-section.is-loading') ||
    document.activeElement?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])') ||
    [...document.querySelectorAll(overlays)].some(visible);
  function buttons(root) {
    const all = [...root.querySelectorAll('.bottom-bar button')];
    const next = all.find(b => b.querySelector('.next-page-highlight'));
    const prev = all.find(b => b !== next && b.querySelector('.fa-angle-left,.fa-angle-right,.fa-angle-double-left,.fa-angle-double-right'));
    return {next, prev};
  }
  function hiddenMenu(root) {
    return !!root.querySelector('.book-container.immersive') && !root.querySelector('.reader-header');
  }
  function toggleMenu(root) {
    const content = root.querySelector('.book-content');
    if (!content) return false;
    // Kavita requires matching mousedown/click coordinates to toggle its menu.
    content.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, clientX: 0, clientY: 0}));
    content.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: 0, clientY: 0}));
    return true;
  }
  async function turnPage(root, direction) {
    turning = true;
    const restore = hiddenMenu(root);
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    try {
      if (restore) {
        root.classList.add('swipe-restoring-menu');
        if (!toggleMenu(root)) return;
        await frame(); await frame();
      }
      if (blocked(root)) return;
      const b = buttons(root)[direction];
      if (b && !b.disabled && (restore || visible(b))) {
        document.dispatchEvent(new Event('kavita-page-navigation'));
        b.click();
      }
    } finally {
      // At a section boundary Angular replaces the content asynchronously.
      // Do not toggle the old content while the next section is still loading.
      if (restore) {
        await frame();
        const deadline = performance.now() + 5000;
        while (root.isConnected && root.querySelector('.reading-section.is-loading') && performance.now() < deadline) await frame();
      }
      if (restore && root.isConnected && !root.querySelector('.reading-section.is-loading') && root.querySelector('.reader-header') && !selected() && ![...document.querySelectorAll(overlays)].some(visible)) {
        toggleMenu(root);
        await frame(); await frame();
      }
      root.classList.remove('swipe-restoring-menu');
      turning = false;
      lastTurn = performance.now();
      suppressUntil = lastTurn + 500;
    }
  }
  document.addEventListener('touchstart', e => {
    gesture = null;
    if (turning || e.touches.length !== 1 || performance.now() - lastTurn < 650) return;
    const root = e.target.closest('app-book-reader');
    if (!root || !e.target.closest('.book-content,.tap-to-paginate') || e.target.closest(interactive) || blocked(root)) return;
    if (!root.querySelector('.reading-section.column-layout-1,.reading-section.column-layout-2')) return;
    const t = e.touches[0];
    if (t.clientX < 32 || t.clientX > innerWidth - 32) return;
    const {next, prev} = buttons(root);
    if ((!next || !prev || !visible(next) || !visible(prev)) && !hiddenMenu(root)) return;
    gesture = {root, id: t.identifier, x: t.clientX, y: t.clientY, time: performance.now()};
  }, {passive: true, capture: true});
  document.addEventListener('touchmove', e => {
    if (!gesture) return;
    if (e.touches.length !== 1 || blocked(gesture.root)) { gesture = null; return; }
    const t = e.touches[0];
    if (Math.abs(t.clientY - gesture.y) > 35 || performance.now() - gesture.time > 500) gesture = null;
  }, {passive: true, capture: true});
  document.addEventListener('selectionchange', () => { if (selected()) gesture = null; });
  document.addEventListener('touchcancel', () => { gesture = null; }, {passive: true});
  document.addEventListener('touchend', e => {
    const g = gesture; gesture = null;
    if (!g || e.touches.length || e.changedTouches.length !== 1 || blocked(g.root)) return;
    const t = e.changedTouches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (t.identifier !== g.id || performance.now() - g.time > 500 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Math.abs(dy) > 35) return;
    const b = buttons(g.root)[dx < 0 ? 'next' : 'prev'];
    if ((!b || b.disabled || !visible(b)) && !hiddenMenu(g.root)) return;
    lastTurn = performance.now(); suppressUntil = lastTurn + 500;
    e.preventDefault(); e.stopImmediatePropagation();
    void turnPage(g.root, dx < 0 ? 'next' : 'prev');
  }, {passive: false, capture: true});
  document.addEventListener('click', e => {
    if (performance.now() < suppressUntil && e.isTrusted && e.target.closest('app-book-reader .book-content,app-book-reader .tap-to-paginate')) {
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
})();

// Empty image bookmark glyphs are "add bookmark" controls, not saved bookmarks.
// Reveal these controls on explicit image interaction; preserve saved markers.
(() => {
  'use strict';
  if(window.__kavitaBookmarkAffordanceInstalled)return;
  window.__kavitaBookmarkAffordanceInstalled=true;
  const style=document.createElement('style');
  style.textContent=`
    app-book-reader .bookmark-overlay.fa-regular.fa-bookmark {
      visibility: hidden !important; pointer-events: none !important;
    }
    app-book-reader .bookmark-overlay.fa-regular.fa-bookmark.kv-bookmark-actions-visible {
      visibility: visible !important; pointer-events: auto !important;
    }
  `;
  document.head.appendChild(style);
  function clear() {
    for(const icon of document.querySelectorAll('app-book-reader .bookmark-overlay.kv-bookmark-actions-visible')) {
      icon.classList.remove('kv-bookmark-actions-visible');icon.removeAttribute('tabindex');
    }
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('app-book-reader .bookmark-overlay'))return;
    clear();
    const img=event.target.closest('app-book-reader .book-content img');
    if(!img?.parentElement)return;
    for(const icon of img.parentElement.querySelectorAll(':scope > .bookmark-overlay.fa-regular.fa-bookmark')) {
      icon.classList.add('kv-bookmark-actions-visible');icon.setAttribute('tabindex','0');
      icon.setAttribute('role','button');icon.setAttribute('aria-label',icon.title||'북마크 추가');
    }
  },true);
  document.addEventListener('kavita-page-navigation',clear);
  document.addEventListener('keydown',event=>{
    const icon=event.target.closest('app-book-reader .bookmark-overlay.kv-bookmark-actions-visible');
    if(icon&&(event.key==='Enter'||event.key===' ')){event.preventDefault();icon.click();}
    else clear();
  },true);
})();

// Fullscreen toggle beside the EPUB keyboard shortcuts button.
(() => {
  'use strict';
  if (window.__kavitaFullscreenButtonInstalled) return;
  window.__kavitaFullscreenButtonInstalled = true;
  let scheduled = false;
  function refresh() {
    scheduled = false;
    for (const shortcut of document.querySelectorAll('app-book-reader .reader-header .fa-clipboard-question')) {
      const anchor = shortcut.closest('button');
      if (!anchor?.parentElement) continue;
      let button = anchor.parentElement.querySelector('[data-kavita-fullscreen]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button'; button.className = 'btn btn-icon me-1';
        button.setAttribute('data-kavita-fullscreen', '');
        const icon = document.createElement('i'); icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);
        button.addEventListener('click', async event => {
          event.preventDefault(); event.stopPropagation();
          button.disabled = true;
          try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await document.documentElement.requestFullscreen();
          } catch {
            button.title = '전체화면을 시작할 수 없습니다. 브라우저 설정을 확인해 주세요.';
          } finally { button.disabled = false; }
        });
        anchor.parentElement.insertBefore(button, anchor);
      }
      const active = !!document.fullscreenElement;
      const enabled = !!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function';
      button.disabled = !enabled;
      button.setAttribute('aria-label', active ? '전체화면 종료' : '전체화면');
      button.setAttribute('aria-pressed', String(active));
      button.title = enabled ? (active ? '전체화면 종료' : '전체화면') : '이 브라우저에서는 전체화면을 지원하지 않습니다.';
      button.firstElementChild.className = `fa-solid ${active ? 'fa-compress' : 'fa-expand'}`;
    }
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(refresh); }
  }
  new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true});
  document.addEventListener('fullscreenchange', refresh);
  refresh();
})();

// Whole EPUB screen pagination. No progress/annotation writes are made here.
(() => {
  'use strict';
  if (window.__kavitaPageIndicatorInstalled) return;
  window.__kavitaPageIndicatorInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  const sections = new Map();
  const revisions = new Map();
  const memoryCache = new Map();
  const cachePrefix = 'kavita-screen-pages-v2:';
  const cacheAge = 14 * 24 * 60 * 60 * 1000;
  let book = null, generation = 0, running = false, signature = '', counts = [], failed = false;
  let activeCalculation = null;
  function cancelCalculation() {
    activeCalculation?.controller.abort();
    activeCalculation?.dispose?.();
  }
  window.addEventListener('resize', cancelCalculation, {passive:true});
  let resume = null, navigationEpoch = 0;
  const resumePattern = /\[boolean\('kvscreen1:([0-9a-f-]+):([0-9.]+)'\)\]$/;
  function layoutKey(g) {
    const css = getComputedStyle(g.content);
    return hash(JSON.stringify([innerWidth,innerHeight,g.size,g.content.clientHeight,g.content.className,
      css.fontFamily,css.fontSize,css.lineHeight,css.marginLeft,css.columnCount,css.writingMode]));
  }
  function sectionMatches(page) {
    return book && (page === book.index || (page === sections.get(book.id) && book.index === page - 1));
  }
  function progressURL(url) {
    try { const u=new URL(url,location.href);return u.origin===location.origin && u.pathname==='/api/reader/progress'; } catch {return false;}
  }
  function enrichProgress(body) {
    try {
      const data=JSON.parse(body),root=document.querySelector('app-book-reader');
      if (!book || String(data.chapterId)!==book.id || !sectionMatches(data.pageNum) || !root || root.querySelector('.is-loading') ||
          !root.querySelector('.reading-section.column-layout-1,.reading-section.column-layout-2')) return body;
      const g=geometry(root);if(!g)return body;
      if (resume && resume.id===book.id && resume.page===data.pageNum && resume.layout===layoutKey(g)) {
        // Do not let initial native anchor restoration overwrite the exact saved screen.
        data.bookScrollId=resume.path;
      } else {
        const path=typeof data.bookScrollId==='string'?data.bookScrollId.replace(resumePattern,''):'';
        if (!path || !(path.startsWith('//') || path.startsWith('id('))) return body;
        const offset=g.vertical?g.content.scrollTop:g.content.scrollLeft;
        const fraction=Math.max(0,offset/g.size).toFixed(6);
        data.bookScrollId=path+`[boolean('kvscreen1:${layoutKey(g)}:${fraction}')]`;
      }
      return JSON.stringify(data);
    } catch {return body;}
  }
  function restoreScreen(root,g) {
    if (!resume || !book || resume.id!==book.id || !sectionMatches(resume.page)) return;
    if (performance.now()-resume.time>10000 || resume.layout!==layoutKey(g)) {resume=null;return;}
    if (document.fonts.status!=='loaded' || [...g.content.querySelectorAll('img')].some(img=>!img.complete)) return;
    if (!resume.ready) {resume.ready=performance.now();return;}
    if (performance.now()-resume.ready<450) return; // Native XPath/image restoration finishes first.
    const target=resume.fraction*g.size;
    resume=null;
    g.content.scrollTo(g.vertical?{top:target,behavior:'instant'}:{left:target,behavior:'instant'});
    // Notify Kavita's existing scroll/progress handler; no additional POSTs are created.
    g.content.dispatchEvent(new Event('scroll',{bubbles:true}));
  }
  function noteNavigation() {resume=null;navigationEpoch++;}
  for(const type of ['touchstart','pointerdown','keydown'])document.addEventListener(type,event=>{if(event.isTrusted)noteNavigation();},{capture:true,passive:true});
  document.addEventListener('kavita-page-navigation',noteNavigation);
  function calculationKey(root, g) {
    const css=getComputedStyle(g.content);
    const child=[...g.content.children].find(el=>el.tagName!=='STYLE');
    // Native reader overrides live on the EPUB wrapper; arbitrary classes and
    // style-attribute ordering are not reader settings.
    return JSON.stringify([book.id,revisions.get(book.id),innerWidth,innerHeight,devicePixelRatio,navigator.userAgent,
      g.size,parseFloat(g.content.style.maxHeight)||g.content.clientHeight,g.vertical,
      root.querySelector('.reading-section').classList.contains('column-layout-2')?2:1,
      child?.style.fontFamily||css.fontFamily,css.fontSize,child?.style.lineHeight||css.lineHeight,
      css.marginLeft,css.marginRight,css.columnCount,css.columnGap,css.columnWidth,
      [...document.body.classList].filter(name=>name!=='modal-open').sort(),
      [...document.head.querySelectorAll('link[rel="stylesheet"]')].map(link=>link.href)]);
  }
  function hash(value) {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < value.length; i++) {
      a = Math.imul(a ^ value.charCodeAt(i), 16777619);
      b = Math.imul(b, 33) ^ value.charCodeAt(i);
    }
    return (a >>> 0).toString(16) + '-' + (b >>> 0).toString(16);
  }
  function loadCounts(key, length) {
    try {
      const value = memoryCache.get(key) || JSON.parse(localStorage.getItem(cachePrefix + hash(key)));
      if (value && Number.isFinite(value.saved) && Date.now() >= value.saved && Date.now() - value.saved < cacheAge && value.length === length &&
          Array.isArray(value.counts) && value.counts.length <= length &&
          value.counts.every(n => n === null || (Number.isInteger(n) && n > 0))) return value.counts.slice();
    } catch {}
    return [];
  }
  function saveCounts(key, owner) {
    const length = sections.get(owner.id);
    if (!length || !revisions.has(owner.id) || key !== signature || owner !== book) return;
    const value = {saved: Date.now(), length, counts: counts.slice(0, length)};
    memoryCache.set(key, value);
    if (memoryCache.size > 30) memoryCache.delete(memoryCache.keys().next().value);
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(cachePrefix));
      if (keys.length >= 30) {
        keys.sort((a, b) => (JSON.parse(localStorage.getItem(a))?.saved || 0) - (JSON.parse(localStorage.getItem(b))?.saved || 0));
        localStorage.removeItem(keys[0]);
      }
      localStorage.setItem(cachePrefix + hash(key), JSON.stringify(value));
    } catch {} // Storage denial/quota never prevents reading or calculation.
  }
  function recordRevision(id, text) {
    const chapter = JSON.parse(text);
    if (!Number.isInteger(chapter.pages) || chapter.pages < 1 || !Array.isArray(chapter.files)) throw new Error('Invalid book metadata');
    sections.set(id, chapter.pages);
    revisions.set(id, hash(JSON.stringify([chapter.id, chapter.createdUtc, chapter.wordCount,
      chapter.files.map(f => [f.id, f.filePath, f.bytes, f.created, f.koreaderHash, f.pages])])));
  }
  const label = document.createElement('div');
  label.id = 'kavita-screen-page-indicator'; label.hidden = true;
  label.setAttribute('role', 'status'); label.setAttribute('aria-live', 'off');
  const style = document.createElement('style');
  style.textContent = '#kavita-screen-page-indicator { position: fixed; right: calc(12px + env(safe-area-inset-right, 0px)); bottom: calc(5px + env(safe-area-inset-bottom, 0px)); z-index: 1031; padding: 1px 7px; border-radius: 8px; font: 11px/1.4 system-ui,sans-serif; color: #fff; background: rgba(0,0,0,.55); pointer-events: none; user-select: none; white-space: nowrap; } #kavita-screen-page-indicator[hidden] { display: none !important; }';
  document.head.appendChild(style); document.body.appendChild(label);
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  function requestInfo(url) {
    try {
      const u = new URL(url, location.href);
      if (u.origin !== location.origin) return null;
      if (u.pathname === '/api/series/chapter' && /^\d+$/.test(u.searchParams.get('chapterId') || ''))
        return {id: u.searchParams.get('chapterId'), type: 'chapter'};
      if (u.pathname === '/api/reader/get-progress' && /^\d+$/.test(u.searchParams.get('chapterId') || ''))
        return {id:u.searchParams.get('chapterId'),type:'progress',epoch:navigationEpoch};
      const m = u.pathname.match(/^\/api\/book\/(\d+)\/(book-page|book-info)$/);
      if (!m) return null;
      const index = Number(u.searchParams.get('page'));
      if (m[2] === 'book-page' && (!Number.isInteger(index) || index < 0)) return null;
      return {id:m[1], type:m[2], index};
    } catch { return null; }
  }
  function observe(info, text, headers) {
    if (!info) return;
    if (info.type==='progress') {
      if(info.epoch!==navigationEpoch)return;
      try {
        const data=JSON.parse(text),match=typeof data.bookScrollId==='string'&&data.bookScrollId.match(resumePattern);
        resume=match&&Number.isFinite(Number(match[2]))?{id:info.id,page:data.pageNum,layout:match[1],fraction:Number(match[2]),path:data.bookScrollId,time:performance.now()}:null;
      } catch {resume=null;} return;
    }
    if (info.type === 'chapter') { try { recordRevision(info.id, text); } catch {} return; }
    if (info.type === 'book-info') {
      try { const n = JSON.parse(text).pages; if (Number.isInteger(n) && n > 0) sections.set(info.id, n); } catch {}
      return;
    }
    if (!book || book.id !== info.id) {
      book = {id:info.id, index:info.index, html:new Map(), headers:new Headers(headers)};
      cancelCalculation(); signature = ''; counts = []; generation++; failed = false;
      label.textContent='…';
    }
    if(book.index!==info.index && resume?.id===book.id)resume=null;
    if(book.index!==info.index || !book.renderAfter)book.renderAfter=performance.now()+120;
    book.index = info.index; book.html.set(info.index, text);
    book.headers = new Headers(headers);
  }
  // Observe the reader's own authenticated GETs; never log or persist credentials.
  const requests = new WeakMap();
  const open = XMLHttpRequest.prototype.open, setHeader = XMLHttpRequest.prototype.setRequestHeader, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    requests.set(this, {info:method.toUpperCase() === 'GET' ? requestInfo(url) : null, progress:method.toUpperCase()==='POST'&&progressURL(url), headers:new Headers()});
    return open.call(this, method, url, ...args);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    const r = requests.get(this); if (r && name.toLowerCase() === 'authorization') r.headers.set(name,value);
    return setHeader.call(this,name,value);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    const r = requests.get(this);
    if(r?.progress&&typeof args[0]==='string')args[0]=enrichProgress(args[0]);
    if (r?.info) this.addEventListener('load', () => {
      if (this.status === 200) {
        try { observe(r.info, this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText, r.headers); } catch {}
      }
    }, {once:true});
    return send.apply(this,args);
  };
  window.fetch = async function(input, init) {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if(method.toUpperCase()==='POST'&&progressURL(url)) {
      if(typeof init?.body==='string')init={...init,body:enrichProgress(init.body)};
      else if(input instanceof Request&&!init?.body)input=new Request(input,{body:enrichProgress(await input.clone().text())});
    }
    const info = method.toUpperCase() === 'GET' ? requestInfo(url) : null;
    const response = await nativeFetch(input,init);
    if (info && response.ok) {
      const all = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const headers = new Headers(); if (all.has('authorization')) headers.set('authorization',all.get('authorization'));
      void response.clone().text().then(text => observe(info,text,headers)).catch(() => {});
    }
    return response;
  };
  function geometry(root) {
    const content = root.querySelector('.book-content'), reader = root.querySelector('.reader-container');
    if (!content || !reader) return null;
    const css = getComputedStyle(content), vertical = content.classList.contains('writing-style-vertical');
    const size = vertical ? parseFloat(content.style.maxHeight) - 20 : reader.offsetWidth - 2 * (parseFloat(css.marginLeft) || 0) + 20;
    const extent = vertical ? content.scrollHeight : content.scrollWidth, offset = vertical ? content.scrollTop : content.scrollLeft;
    if (!(size > 0 && extent > 0)) return null;
    const total = Math.max(1,Math.ceil(extent / size));
    return {content, size, vertical, total, current:Math.min(total,Math.max(1,Math.round((offset + size) / size)))};
  }
  function position(root) {
    label.style.bottom = 'calc(5px + env(safe-area-inset-bottom, 0px))';
    const bar = root.querySelector('.bottom-bar');
    if (bar && visible(bar)) {
      const rect = bar.getBoundingClientRect();
      // Above the whole action bar: cannot collide with Page~ text or arrows.
      if(rect.bottom>0&&rect.top<innerHeight)label.style.bottom = `${Math.max(5,innerHeight - rect.top + 5)}px`;
    }
  }
  async function read(path, owner, signal) {
    const controller=new AbortController();
    const abort=()=>controller.abort();
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,20000);
    try {
      const response = await nativeFetch(path, {method:'GET',headers:owner.headers,credentials:'same-origin',signal:controller.signal});
      if (!response.ok) throw new Error('EPUB pagination read failed');
      return await response.text();
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  function cancellable(promise, signal) {
    return new Promise((resolve,reject)=>{
      const abort=()=>{signal.removeEventListener('abort',abort);reject(new DOMException('Calculation cancelled','AbortError'));};
      if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
      Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
    });
  }
  const frame = () => new Promise(resolve => window.requestAnimationFrame(resolve));
  async function settleAssets(doc, signal) {
    const wait = Promise.all([
      doc.fonts.ready,
      ...[...doc.querySelectorAll('img')].filter(img => !img.complete).map(img => new Promise(resolve => { img.onload = img.onerror = resolve; }))
    ]);
    let timer;
    try { await cancellable(Promise.race([wait,new Promise((_,reject) => {timer=setTimeout(()=>reject(new Error('EPUB assets timed out')),15000);})]),signal); }
    finally {clearTimeout(timer);}
    if ([...doc.querySelectorAll('img')].some(img => !img.complete || !img.naturalWidth)) throw new Error('EPUB image failed');
  }
  async function createMeasurer(root, session) {
    const signal=session.controller.signal;
    const geometrySnapshot=geometry(root);
    if(!geometrySnapshot)throw new Error('Reader layout unavailable');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox','allow-same-origin'); iframe.setAttribute('aria-hidden','true'); iframe.tabIndex=-1;
    iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${innerWidth}px;height:${innerHeight}px;border:0;pointer-events:none;`;
    document.body.appendChild(iframe);
    session.dispose=()=>iframe.remove();
    try {
      const doc = iframe.contentDocument;
      doc.documentElement.className=document.documentElement.className;
      doc.documentElement.style.cssText=document.documentElement.style.cssText;
      const base=doc.createElement('base');base.href=document.baseURI;doc.head.appendChild(base);
      const loads=[];
      for (const original of document.head.querySelectorAll('link[rel="stylesheet"],style')) {
        const copy=original.cloneNode(true);
        if(copy.tagName==='LINK') {
          // original.href is resolved against Kavita's <base>, even on deep SPA routes.
          copy.href=original.href;
          loads.push(new Promise((resolve,reject)=>{copy.onload=resolve;copy.onerror=()=>reject(new Error('Stylesheet failed'));}));
        }
        doc.head.appendChild(copy);
      }
      let cssTimer;
      try {await cancellable(Promise.race([Promise.all(loads),new Promise((_,reject)=>{cssTimer=setTimeout(()=>reject(new Error('Stylesheet timed out')),15000);})]),signal);}
      finally {clearTimeout(cssTimer);}
      doc.body.className=document.body.className;
      const clone=root.cloneNode(true);
      clone.classList.remove('swipe-restoring-menu');
      for(const el of clone.querySelectorAll('.tap-to-paginate,app-book-line-overlay,[role="dialog"]')) el.remove();
      const content=clone.querySelector('.book-content');
      content.replaceChildren();
      doc.body.appendChild(clone);
      return async function measure(html) {
        if(signal.aborted)throw new DOMException('Calculation cancelled','AbortError');
        const parser=new DOMParser(), fragment=parser.parseFromString(html,'text/html');
        // DOMParser moves leading EPUB styles into head; preserve them in the measured content.
        for(const css of [...fragment.head.querySelectorAll('style')])fragment.body.prepend(css);
        for(const el of fragment.querySelectorAll('script,iframe,object,embed,form,meta,base'))el.remove();
        for(const el of fragment.querySelectorAll('*'))for(const attr of [...el.attributes])if(attr.name.startsWith('on'))el.removeAttribute(attr.name);
        content.innerHTML=fragment.body.innerHTML;
        content.scrollTop=content.scrollLeft=0;
        const original=root.querySelector('.book-content');
        const source=[...original.children].find(el=>el.tagName!=='STYLE');
        for(const el of content.children)if(el.tagName!=='STYLE')for(const prop of ['line-height','font-family']) {
          const value=source?.style.getPropertyValue(prop);
          if(value)el.style.setProperty(prop,value,'important');
        }
        const textCopy=fragment.body.cloneNode(true);for(const el of textCopy.querySelectorAll('style'))el.remove();
        const plain=textCopy.textContent.trim();
        const singleImage=!plain && fragment.querySelectorAll('img,svg,image').length===1;
        // Reader centers image-only sections and counts them as one screen.
        if(singleImage)return 1;
        for(const prop of ['position','top','left','transform'])doc.documentElement.style.removeProperty(`--book-reader-content-${prop}`);
        await cancellable(frame(),signal);await settleAssets(doc,signal);await cancellable(frame(),signal);await cancellable(frame(),signal);
        const extent=geometrySnapshot.vertical?content.scrollHeight:content.scrollWidth;
        if(!Number.isFinite(extent)||extent<=0)throw new Error('Empty measurement');
        return Math.max(1,Math.ceil(extent/geometrySnapshot.size));
      };
    } catch(error) {iframe.remove();throw error;}
  }
  async function calculate(root, owner, key, version) {
    running=true;
    const session={controller:new AbortController(),dispose:null};
    activeCalculation=session;
    const signal=session.controller.signal;
    try {
      if(!revisions.has(owner.id)) {
        recordRevision(owner.id, await read(`/api/series/chapter?chapterId=${owner.id}`,owner,signal));
        // Metadata participates in the cache key. Re-enter update with it before measuring.
        return;
      }
      const length=sections.get(owner.id);
      if(signal.aborted||generation!==version||book!==owner)return;
      const measure=await createMeasurer(root,session);
      const pending=new Map();
      function prefetch(start) {
        for(let i=start;i<length&&pending.size<2;i++) {
          if(counts[i]||owner.html.has(i)||pending.has(i))continue;
          // Keep failures handled even if cancellation means this promise is never consumed.
          pending.set(i,read(`/api/book/${owner.id}/book-page?page=${i}`,owner,signal)
            .then(html=>({html}),error=>({error})));
        }
      }
      for(let index=0;index<length;index++) {
        if(signal.aborted||generation!==version||book!==owner||!root.isConnected)return;
        if(counts[index]) {
          if(pending.has(index)){await pending.get(index);pending.delete(index);}
          continue;
        }
        prefetch(index);
        let html=owner.html.get(index);
        if(pending.has(index)){
          const result=await pending.get(index);pending.delete(index);
          if(html===undefined){if(result.error)throw result.error;html=result.html;owner.html.set(index,html);}
        }
        prefetch(index+1);
        const count=await measure(html);
        if(signal.aborted||generation!==version||signature!==key)return;
        counts[index]=count;
        saveCounts(key, owner);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    } catch {if(!signal.aborted&&generation===version)failed=true;}
    finally {session.controller.abort();session.dispose?.();if(activeCalculation===session)activeCalculation=null;running=false;}
  }
  function update() {
    const root=document.querySelector('app-book-reader');
    if(!root) {label.hidden=true;resume=null;cancelCalculation();if(book){book=null;signature='';counts=[];generation++;}return;}
    const popup=[...document.querySelectorAll('[role="dialog"],.offcanvas.show,.popover,app-highlight-bar')].some(visible);
    if(popup||!root.querySelector('.reading-section.column-layout-1,.reading-section.column-layout-2')) {label.hidden=true;return;}
    if(root.querySelector('.is-loading')||root.classList.contains('swipe-restoring-menu')||(book&&performance.now()<book.renderAfter)) {
      // Keep a known total steady while a section loads; don't flash a calculation placeholder.
      label.hidden=!/^\d+ \/ \d+$/.test(label.textContent);return;
    }
    const g=geometry(root);if(!g){label.hidden=true;return;}
    if(document.fonts.status!=='loaded'||[...g.content.querySelectorAll('img')].some(img=>!img.complete))return;
    restoreScreen(root,g);
    position(root);label.hidden=false;
    if(!book){label.textContent='…';label.title='책 전체 페이지 계산 준비 중';return;}
    const css=getComputedStyle(g.content);
    const legacyKey=JSON.stringify([book.id,revisions.get(book.id),innerWidth,innerHeight,devicePixelRatio,navigator.userAgent,g.size,g.content.clientHeight,g.content.style.cssText,g.content.className,css.fontFamily,css.fontSize,css.lineHeight,document.body.className,
      [...document.head.querySelectorAll('link[rel="stylesheet"]')].map(link => link.href)]);
    const key=calculationKey(root,g);
    const length=sections.get(book.id);
    if(key!==signature){
      cancelCalculation();signature=key;counts=revisions.has(book.id)?loadCounts(key,length):[];
      if(!counts.length&&revisions.has(book.id))counts=loadCounts(legacyKey,length);
      failed=false;generation++;
    }
    // A section-specific measurement difference must not discard every other section.
    counts[book.index]=g.total;
    const complete=length&&counts.slice(0,length).filter(n=>Number.isInteger(n)&&n>0).length===length;
    if(complete) {
      const before=counts.slice(0,book.index).reduce((sum,n)=>sum+n,0),total=counts.slice(0,length).reduce((sum,n)=>sum+n,0);
      label.textContent=`${before+g.current} / ${total}`;
      label.title='현재 화면 설정으로 계산한 책 전체 페이지';
      if (label.dataset.cacheSaved !== hash(key + JSON.stringify(counts))) {
        saveCounts(key, book); label.dataset.cacheSaved = hash(key + JSON.stringify(counts));
      }
    } else {
      label.textContent=failed?'—':'…';label.title=failed?'책 전체 페이지 계산 실패. 새로고침 후 다시 시도하세요.':'책 전체 페이지 계산 중';
    }
    if(!complete&&!failed&&!running)void calculate(root,book,key,generation);
  }
  window.setInterval(update,300);update();
})();
