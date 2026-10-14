(() => {
  'use strict';
  if (window.__kavitaSwipeInstalled) return;
  window.__kavitaSwipeInstalled = true;
  const interactive = 'a,button,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="button"]';
  const overlays = 'ngb-modal-window,ngb-offcanvas,[role="dialog"],.modal.show,.offcanvas.show,.drawer,.drawer-backdrop,app-highlight-bar,.popover,.dropdown-menu.show';
  let gesture = null, lastTurn = -Infinity, suppressUntil = 0, turning = false;
  const style = document.createElement('style');
  style.textContent = `
    app-book-reader.swipe-restoring-menu .reader-header, app-book-reader.swipe-restoring-menu .bottom-bar { visibility: hidden !important; }
    app-book-reader .reading-section:is(.column-layout-1,.column-layout-2) .book-content {
      touch-action: pan-y pinch-zoom;
    }
    app-book-reader .reading-section:is(.column-layout-1,.column-layout-2) .book-content svg {
      max-width: var(--book-reader-content-max-width, 100%) !important;
      max-height: calc(var(--book-reader-content-max-height, 100vh) - 38px) !important;
    }
    app-book-reader .reading-section:is(.column-layout-1,.column-layout-2) .book-content img {
      max-width: min(100%, var(--book-reader-content-max-width, 100%)) !important;
    }
    /* Even a hidden bookmark glyph contributes to scrollWidth. Keep its
       right edge inside the image so it cannot create an unreachable page. */
    app-book-reader .reading-section:is(.column-layout-1,.column-layout-2) .book-content .kavita-scale-width-container > .bookmark-overlay {
      transform: translateX(-100%) !important;
    }
    app-book-reader.kv-height-tap-zones .tap-to-paginate,
    app-book-reader.kv-height-tap-zones .tap-to-paginate > div {
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const selected = () => !!window.getSelection()?.toString();
  const blocked = (root, allowLoading = false) => selected() || !root.isConnected ||
    (!allowLoading && root.querySelector('.reading-section.is-loading')) ||
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
    if (window.__kavitaBeforeNavigation && !await window.__kavitaBeforeNavigation()) return;
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
        // Allow the native scroll/Angular loading state to settle before a
        // queued input can invoke another native page button.
        await frame(); await frame();
      }
    } finally {
      // At a section boundary Angular replaces the content asynchronously.
      // Do not toggle the old content while the next section is still loading.
      await frame();
      // Loading can exceed five seconds (especially image sections). Keep
      // the temporary menu masked until loading actually finishes or exits.
      while (root.isConnected && root.querySelector('.reading-section.is-loading')) await new Promise(resolve => setTimeout(resolve, 50));
      if (restore && root.isConnected && !root.querySelector('.reading-section.is-loading') && root.querySelector('.reader-header') && !selected() && ![...document.querySelectorAll(overlays)].some(visible)) {
        toggleMenu(root);
        await frame(); await frame();
      }
      root.classList.remove('swipe-restoring-menu');
      turning = false;
      lastTurn = performance.now();
      suppressUntil = lastTurn + 650;
    }
  }
  document.addEventListener('touchstart', e => {
    gesture = null;
    if (e.touches.length !== 1) return;
    const root = e.target.closest('app-book-reader');
    if (!root || !e.target.closest('.book-content,.tap-to-paginate') || e.target.closest(interactive) || blocked(root,true)) return;
    if (!root.querySelector('.reading-section.column-layout-1,.reading-section.column-layout-2')) return;
    const t = e.touches[0];
    if (t.clientX < 32 || t.clientX > innerWidth - 32) {pendingTurns.length=0;return;}
    const {next, prev} = buttons(root);
    if ((!next || !prev || !visible(next) || !visible(prev)) && !hiddenMenu(root) && !root.classList.contains('swipe-restoring-menu')) return;
    gesture = {root, id: t.identifier, x: t.clientX, y: t.clientY, time: performance.now()};
  }, {passive: true, capture: true});
  document.addEventListener('touchmove', e => {
    if (!gesture) return;
    if (e.touches.length !== 1 || blocked(gesture.root,true)) { gesture = null; return; }
    const t = e.touches[0];
    const dx=Math.abs(t.clientX-gesture.x),dy=Math.abs(t.clientY-gesture.y);
    if (dy > 35 || performance.now() - gesture.time > 1200) { gesture = null;pendingTurns.length=0; return; }
    if (dx >= 20 && dx >= dy * 2 && e.cancelable) e.preventDefault();
  }, {passive: false, capture: true});
  document.addEventListener('selectionchange', () => { if (selected()) {gesture = null; pendingTurns.length = 0;} });
  document.addEventListener('touchcancel', () => { gesture = null; }, {passive: true});
  document.addEventListener('touchend', e => {
    const g = gesture; gesture = null;
    if (!g || e.touches.length || e.changedTouches.length !== 1 || blocked(g.root,true)) return;
    const t = e.changedTouches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
    if (t.identifier !== g.id || performance.now() - g.time > 1200 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Math.abs(dy) > 35) return;
    const b = buttons(g.root)[dx < 0 ? 'next' : 'prev'];
    if ((!b || b.disabled || !visible(b)) && !hiddenMenu(g.root) && !g.root.classList.contains('swipe-restoring-menu')) return;
    lastTurn = performance.now(); suppressUntil = lastTurn + 650;
    e.preventDefault(); e.stopImmediatePropagation();
    queueTurn(g.root, dx < 0 ? 'next' : 'prev','swipe');
  }, {passive: false, capture: true});
  document.addEventListener('click', e => {
    if ((turning || performance.now() < suppressUntil) && e.isTrusted &&
        e.target.closest('app-book-reader .book-content,app-book-reader .tap-to-paginate') && !e.target.closest(interactive)) {
      // A fresh, stationary pointer press is a new tap, not the click that
      // some browsers generate after a swipe. Do not discard it on a timer.
      if (validTapClick(e,tap,false)) {
        if (!tapEnabled() || !sideTap(e.clientX)) pendingTurns.length=0;
        if (!turning || (tapEnabled() && sideTap(e.clientX))) return;
      }
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);

  // Optional height-based paging. Keep the native middle/menu behavior and
  // route both mouse clicks and touch-generated clicks through native buttons.
  const tapPreferences = new Map();
  const tapInteractive = interactive + ',.bookmark-overlay,app-epub-highlight,[kavita-part],[onclick]';
  const pendingTurns = [];
  document.addEventListener('kavita-reading-conflict',()=>{pendingTurns.length=0;gesture=null;tap=null;});
  let drainingTurns = false;
  let tap = null, settingsScheduled = false;
  const sideTap = x => x < innerWidth * .2 || x > innerWidth * .8;
  function validTapClick(event, start = tap, requireOption = true) {
    return !!(start && (!requireOption || tapEnabled()) && event.isTrusted && event.detail !== 0 &&
      performance.now()-start.time <= 1200 && Math.hypot(event.clientX-start.x,event.clientY-start.y) <= 10 &&
      !blocked(start.root,true) && !event.target.closest(tapInteractive) &&
      event.target.closest('app-book-reader')===start.root && event.target.closest('.reading-section,.tap-to-paginate') &&
      start.root.querySelector('.reading-section.column-layout-1,.reading-section.column-layout-2'));
  }
  async function drainTurns() {
    if (drainingTurns) return;
    drainingTurns = true;
    try {
      while (pendingTurns.length) {
        if (turning) {await new Promise(resolve=>setTimeout(resolve,25));continue;}
        const next = pendingTurns.shift();
        if ((next.kind==='tap' && !tapEnabled()) || blocked(next.root,true) || !next.root.querySelector('.reading-section.column-layout-1,.reading-section.column-layout-2') ||
            location.href!==next.url || performance.now()-next.time>10000) {pendingTurns.length=0;break;}
        if (next.root.querySelector('.reading-section.is-loading')) {
          pendingTurns.unshift(next);await new Promise(resolve=>setTimeout(resolve,50));continue;
        }
        await turnPage(next.root,next.direction);
      }
    } finally {drainingTurns=false;}
  }
  function queueTurn(root,direction,kind='tap') {
    if (pendingTurns.length<3) pendingTurns.push({root,direction,kind,url:location.href,time:performance.now()});
    void drainTurns();
  }
  function preferenceKey() {
    try {
      const user = JSON.parse(localStorage.getItem('kavita-user') || 'null');
      return 'kavita-height-tap-zones-v1:' + encodeURIComponent(user?.username || 'guest');
    } catch { return 'kavita-height-tap-zones-v1:guest'; }
  }
  function tapEnabled() {
    const key = preferenceKey();
    if (tapPreferences.has(key)) return tapPreferences.get(key);
    try { return localStorage.getItem(key) === 'true'; } catch { return false; }
  }
  function refreshTapSettings() {
    settingsScheduled = false;
    const enabled = tapEnabled();
    for (const root of document.querySelectorAll('app-book-reader')) {
      // Only disable the native side overlays in paginated EPUB mode.
      root.classList.toggle('kv-height-tap-zones', enabled && !!root.querySelector('.reading-section.column-layout-1,.reading-section.column-layout-2'));
    }
    for (const settings of document.querySelectorAll('app-epub-setting-drawer app-reader-settings')) {
      const fontRow = settings.querySelector('#fontsize')?.closest('.controls');
      if (!fontRow) continue;
      let control = settings.querySelector('[data-kavita-height-tap-zones]');
      if (!control) {
        const row = document.createElement('div');
        row.className = 'controls my-3';
        row.innerHTML = '<label class="form-check"><input type="checkbox" class="form-check-input" data-kavita-height-tap-zones><span class="form-check-label">높이에 따라 페이지 넘기기</span></label><small class="d-block text-muted">좌우 각 20% 영역: 위쪽 1/3은 이전, 아래쪽 2/3은 다음 페이지. 가운데는 기존 메뉴 동작을 유지합니다. 설정은 이 브라우저에 저장됩니다.</small>';
        fontRow.after(row);
        control = row.querySelector('input');
        control.addEventListener('change', () => {
          const key = preferenceKey();
          tapPreferences.set(key, control.checked);
          try { localStorage.setItem(key, String(control.checked)); } catch {}
          tap = null;
          pendingTurns.length = 0;
          refreshTapSettings();
        });
      }
      control.checked = enabled;
    }
  }
  function scheduleTapSettings() {
    if (!settingsScheduled) { settingsScheduled = true; requestAnimationFrame(refreshTapSettings); }
  }
  new MutationObserver(scheduleTapSettings).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === preferenceKey() || event.key === 'kavita-user') {
      tapPreferences.clear(); tap = null; pendingTurns.length = 0; scheduleTapSettings();
    }
  });
  refreshTapSettings();
  document.addEventListener('pointerdown', event => {
    tap = null;
    if (!event.isPrimary || event.button !== 0) {pendingTurns.length=0;return;}
    const root = event.target.closest('app-book-reader');
    if (!root || !event.target.closest('.reading-section,.tap-to-paginate') || event.target.closest(tapInteractive) || blocked(root,true) ||
        !root.querySelector('.reading-section.column-layout-1,.reading-section.column-layout-2')) {pendingTurns.length=0;return;}
    // Defer middle-tap cancellation until click: a touch starting in the
    // middle may instead become another horizontal swipe.
    if (!tapEnabled() && event.pointerType!=='touch') pendingTurns.length=0;
    tap = {root, id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now()};
  }, {capture: true, passive: true});
  document.addEventListener('pointermove', event => {
    if (tap && (event.pointerId !== tap.id || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10)) {
      const dx=gesture&&Math.abs(event.clientX-gesture.x),dy=gesture&&Math.abs(event.clientY-gesture.y);
      if (!gesture || dy>35 || dx<dy*2 || performance.now()-gesture.time>1200) pendingTurns.length=0;
      tap=null;
    }
  }, {capture: true, passive: true});
  for (const type of ['pointercancel', 'touchcancel']) document.addEventListener(type, () => { tap = null; pendingTurns.length=0; }, {capture: true, passive: true});
  document.addEventListener('touchstart', event => { if (event.touches.length !== 1) {tap = null;pendingTurns.length=0;} }, {capture: true, passive: true});
  document.addEventListener('keydown',event=>{if(event.isTrusted)pendingTurns.length=0;},true);
  document.addEventListener('click', event => {
    if (!event.isTrusted || event.detail === 0) return;
    const start = tap; tap = null;
    if (!validTapClick(event,start)) return;
    if (event.clientX >= innerWidth * .2 && event.clientX <= innerWidth * .8) {pendingTurns.length=0;return;}
    const direction = event.clientY < innerHeight / 3 ? 'prev' : 'next';
    event.preventDefault(); event.stopImmediatePropagation();
    suppressUntil = performance.now() + 650;
    queueTurn(start.root, direction);
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
  // Keep the server snapshot in memory only. Serialize this browser's own saves
  // so a preflight cannot mistake an earlier in-flight save for another reader.
  const readingSnapshots = new Map();
  let syncTail = Promise.resolve(), leavingForSync = false;
  const positionKey = data => JSON.stringify([Number(data.pageNum),data.bookScrollId || '']);
  function syncSerial(task) {
    const result=syncTail.then(task);syncTail=result.catch(()=>{});return result;
  }
  function syncPrompt(remote, unavailable=false) {
    document.dispatchEvent(new Event('kavita-reading-conflict'));
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.id='kavita-reading-sync-dialog';
      dialog.style.cssText='max-width:min(420px,90vw);border:0;border-radius:12px;padding:24px;color:#222;background:white;box-shadow:0 8px 40px #0008;';
      const text=document.createElement('p');
      let pageText='';
      const root=document.querySelector('app-book-reader'),g=root&&geometry(root);
      const marker=remote?.bookScrollId?.match(resumePattern);
      if(g&&marker&&marker[1]===layoutKey(g)&&counts.length&&counts.every(n=>Number.isInteger(n)&&n>0)&&Number(remote.pageNum)<counts.length)
        pageText=` (현재 화면 기준 ${counts.slice(0,Number(remote.pageNum)).reduce((a,b)=>a+b,0)+Math.floor(Number(marker[2]))+1}페이지)`;
      text.textContent=unavailable?'최신 읽기 위치를 확인하지 못했습니다. 연결을 확인한 후 다시 시도하세요. 오래된 위치는 저장하지 않습니다.':
        `다른 브라우저에서 읽기 위치가 변경되었습니다${pageText}. 저장된 최신 위치로 이동하시겠습니까?`;
      dialog.append(text);
      const finish=value=>{dialog.remove();resolve(value);};
      for(const [label,value] of unavailable?[['다시 확인','retry'],['취소','cancel']]:[['최신 위치로 이동','move'],['여기서 계속 읽기','stay']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;button.style.cssText='margin:6px;padding:8px 12px';
        button.addEventListener('click',()=>finish(value));dialog.append(button);
      }
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish('cancel');});
      dialog.setAttribute('role','dialog');
      (document.fullscreenElement||document.body).append(dialog);dialog.showModal();
    });
  }
  async function checkReadingPosition(id, headers, cancelled=()=>false) {
    const state=readingSnapshots.get(String(id));
    if(!state)return true; // Only protect EPUBs whose native initial snapshot was observed.
    while(!leavingForSync&&!cancelled()) {
      let remote;
      try {
        const response=await nativeFetch(`/api/reader/get-progress?chapterId=${encodeURIComponent(id)}`,{
          headers:headers?.has('authorization')?headers:state.headers,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});
        if(!response.ok)throw new Error('progress unavailable');
        remote=await response.json();
        if(!Number.isInteger(remote.pageNum)||(remote.bookScrollId!=null&&typeof remote.bookScrollId!=='string'))throw new Error('invalid progress');
      } catch {
        if(cancelled())return false;
        if(await syncPrompt(null,true)==='retry')continue;
        return false;
      }
      if(cancelled())return false;
      state.checked=performance.now();
      if(positionKey(remote)===positionKey(state.position))return true;
      const choice=await syncPrompt(remote);
      if(cancelled())return false;
      if(choice==='cancel')return false;
      if(choice==='move') {
        leavingForSync=true;resume=null;
        // Native reload obtains the latest server XPath and uses the existing
        // precise-screen restoration. Never submit the stale pending body.
        location.reload();return false;
      }
      state.position=remote;
      // Recheck after the user chooses: another device may have moved while
      // the dialog was open. Only an unchanged snapshot permits the local save.
    }
    return false;
  }
  window.__kavitaBeforeNavigation=()=>syncSerial(async()=>{
    if(leavingForSync)return false;
    const state=book&&readingSnapshots.get(book.id);
    if(!state||performance.now()-state.checked<250)return true;
    return checkReadingPosition(book.id,book.headers);
  });
  // Native tap overlays and arrow buttons bypass the custom turn queue.
  // Check them before Angular changes the visible page, not only on its
  // eventual (sometimes debounced) progress POST.
  document.addEventListener('click',event=>{
    if(!event.isTrusted || event.defaultPrevented)return;
    const target=event.target instanceof Element?event.target:null;
    const root=target?.closest('app-book-reader');
    if(!root||!book||!readingSnapshots.has(book.id))return;
    const overlay=target.closest('.tap-to-paginate > .left,.tap-to-paginate > .right,.tap-to-paginate > .right-with-scrollbar');
    const button=target.closest('.bottom-bar button');
    const arrow=button?.querySelector('.fa-angle-left,.fa-angle-right,.fa-angle-double-left,.fa-angle-double-right');
    if(!overlay&&!arrow)return;
    event.preventDefault();event.stopImmediatePropagation();
    const owner=book,url=location.href,node=overlay||button;
    const replay={bubbles:true,cancelable:true,clientX:event.clientX,clientY:event.clientY,detail:event.detail};
    void window.__kavitaBeforeNavigation().then(allowed=>{
      if(allowed&&book===owner&&location.href===url&&node.isConnected&&!node.disabled)
        node.dispatchEvent(new MouseEvent('click',replay));
    }).catch(()=>{});
  },true);
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
    return JSON.stringify(['media-fit-v2',book.id,revisions.get(book.id),innerWidth,innerHeight,devicePixelRatio,navigator.userAgent,
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
  const label = document.createElement('button');
  label.id = 'kavita-screen-page-indicator'; label.hidden = true;
  label.type = 'button'; label.disabled = true;
  label.setAttribute('aria-haspopup', 'dialog'); label.setAttribute('aria-live', 'off');
  const style = document.createElement('style');
  style.textContent = '#kavita-screen-page-indicator { position: fixed; right: calc(12px + env(safe-area-inset-right, 0px)); bottom: calc(5px + env(safe-area-inset-bottom, 0px)); z-index: 1031; padding: 1px 7px; border: 0; border-radius: 8px; font: 11px/1.4 system-ui,sans-serif; color: #fff; background: rgba(0,0,0,.55); cursor: pointer; user-select: none; white-space: nowrap; } #kavita-screen-page-indicator:disabled { cursor: default; } #kavita-screen-page-indicator:focus-visible { outline: 2px solid #fff; outline-offset: 2px; } #kavita-screen-page-indicator[hidden] { display: none !important; } #kavita-page-jump-message { position: fixed; bottom: 70px; right: 12px; max-width: 85vw; z-index: 1100; padding: 8px 12px; border-radius: 6px; color: #fff; background: #8b2525; font: 13px/1.5 system-ui,sans-serif; }';
  document.head.appendChild(style); document.body.appendChild(label);
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  let pageJump = null;
  const jumpDelay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const jumpFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  function jumpMenu(root) {
    const content = root.querySelector('.book-content');
    if (!content) return;
    content.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,clientX:0,clientY:0}));
    content.dispatchEvent(new MouseEvent('click', {bubbles:true,clientX:0,clientY:0}));
  }
  function jumpError(message) {
    document.getElementById('kavita-page-jump-message')?.remove();
    const notice = document.createElement('div'); notice.id = 'kavita-page-jump-message';
    notice.setAttribute('role','alert'); notice.textContent = message;
    document.body.appendChild(notice); setTimeout(() => notice.remove(), 8000);
  }
  async function jumpWait(context, check, timeout = 20000) {
    const deadline = performance.now() + timeout;
    while (!check()) {
      if (!context.root.isConnected || book !== context.owner || performance.now() > deadline ||
          (context.moving && navigationEpoch !== context.epoch)) throw new Error('페이지 이동을 완료하지 못했습니다. 페이지 계산 후 다시 시도하세요.');
      await jumpDelay(50);
    }
  }
  function setJumpInput(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', {bubbles:true}));
  }
  async function openPageJump() {
    update();
    const root = document.querySelector('app-book-reader'), g = root && geometry(root);
    if (pageJump || label.disabled || !book || !g || root.querySelector('.is-loading')) return;
    const context = {root,owner:book,key:signature,counts:counts.slice(),restore:!!root.querySelector('.book-container.immersive')&&!root.querySelector('.reader-header'),moving:false};
    pageJump = context; label.disabled = true;
    let modal;
    try {
      if (context.restore) {
        root.classList.add('swipe-restoring-menu'); jumpMenu(root);
        await jumpFrame(); await jumpFrame();
      }
      const link = root.querySelector('.bottom-bar a.btn-link');
      if (!link) throw new Error('현재 리더의 페이지 이동 기능을 찾을 수 없습니다.');
      link.click();
      await jumpWait(context, () => !!document.querySelector('ngb-modal-window app-confirm-dialog.confirm-prompt'), 3000);
      modal = document.querySelector('ngb-modal-window app-confirm-dialog.confirm-prompt');
      const input = modal.querySelector('input'), confirm = modal.querySelector('.modal-footer .btn-primary');
      if (!input || !confirm) throw new Error('페이지 이동 팝업을 사용할 수 없습니다.');
      const total = context.counts.reduce((sum,n) => sum+n,0);
      const current = context.counts.slice(0,book.index).reduce((sum,n) => sum+n,0)+g.current;
      modal.querySelector('.modal-title').textContent = '전체 페이지로 이동';
      const description = modal.querySelector('.modal-body form > div');
      if (description) description.textContent = `현재 ${current} / ${total} 페이지. 이동할 페이지 번호를 입력하세요 (1–${total}).`;
      input.type = 'number'; input.inputMode = 'numeric'; input.min = '1'; input.max = String(total); input.step = '1';
      input.setAttribute('aria-label','이동할 전체 페이지 번호');
      const error = document.createElement('div'); error.id = 'kavita-page-jump-validation';
      error.className = 'text-danger mt-2'; error.setAttribute('role','alert');
      input.after(error); input.setAttribute('aria-describedby',error.id);
      setJumpInput(input,current); input.focus({preventScroll:true});
      modal.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (button === modal.querySelector('.modal-header button')) {
          event.preventDefault(); event.stopImmediatePropagation(); modal.querySelector('.modal-footer .btn-secondary')?.click(); return;
        }
        if (button !== confirm) return;
        const number = Number(input.value), live = geometry(root);
        let message = '';
        if (context.moving) message = '페이지로 이동 중입니다.';
        else if (!/^\d+$/.test(input.value) || !Number.isInteger(number) || number<1 || number>total) message = `1부터 ${total}까지의 정수 페이지 번호를 입력하세요.`;
        else if (!root.isConnected || book!==context.owner || !live || calculationKey(root,live)!==context.key) message = '화면 설정이 변경됐습니다. 팝업을 닫고 페이지 계산 후 다시 시도하세요.';
        if (message) {event.preventDefault();event.stopImmediatePropagation();error.textContent=message;input.setAttribute('aria-invalid','true');return;}
        let remaining = number, index = 0;
        while (remaining>context.counts[index]) remaining -= context.counts[index++];
        context.index = index; context.screen = remaining; context.moving = true;
        document.dispatchEvent(new Event('kavita-page-navigation')); context.epoch = navigationEpoch;
        // Angular's existing text value accessor receives the EPUB file number.
        // The original confirmation handler performs the actual file navigation.
        setJumpInput(input,index+1); confirm.disabled = true;
      }, true);
      modal.addEventListener('keydown', event => {
        if (event.key==='Enter' && event.target===input) {event.preventDefault();event.stopImmediatePropagation();confirm.click();}
      }, true);
      modal.querySelector('form')?.addEventListener('submit', event => {event.preventDefault();confirm.click();});
      while (modal.isConnected && root.isConnected && book===context.owner) await jumpDelay(100);
      if (!context.moving) return;
      await jumpWait(context, () => book===context.owner && book.index===context.index && !root.querySelector('.is-loading') &&
        document.fonts.status==='loaded' && [...root.querySelectorAll('.book-content img')].every(img=>img.complete));
      // Native section setup schedules its own initial scroll. Let it finish
      // before applying the selected screen, just as exact resume does.
      await jumpDelay(450); await jumpFrame();
      const live = geometry(root);
      if (!root.isConnected || book!==context.owner || book.index!==context.index || navigationEpoch!==context.epoch ||
          !live || calculationKey(root,live)!==context.key || context.screen>live.total) throw new Error('페이지 배치가 변경됐습니다. 다시 계산된 번호로 시도하세요.');
      const offset = (context.screen-1)*live.size;
      live.content.scrollTo(live.vertical?{top:offset,behavior:'instant'}:{left:offset,behavior:'instant'});
      live.content.dispatchEvent(new Event('scroll',{bubbles:true}));
      await jumpFrame();
      if (geometry(root)?.current!==context.screen) throw new Error('선택한 화면으로 이동하지 못했습니다. 페이지 배치를 확인해 주세요.');
    } catch (error) {
      modal?.querySelector('.modal-footer .btn-secondary')?.click();
      // An explicit new action or leaving the reader cancels the pending jump.
      if (root.isConnected && book===context.owner && (!context.moving || navigationEpoch===context.epoch)) jumpError(error.message);
    } finally {
      if (context.restore && root.isConnected && root.querySelector('.reader-header') && !root.querySelector('.is-loading') &&
          (!context.moving || navigationEpoch===context.epoch) && !document.querySelector('ngb-modal-window') && !window.getSelection()?.toString()) jumpMenu(root);
      root.classList.remove('swipe-restoring-menu');
      if (pageJump===context) pageJump=null;
      update();
    }
  }
  label.addEventListener('click', () => {void openPageJump();});
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
      try {
        const data=JSON.parse(text);
        // Native get-progress is a fresh reader initialization (including SPA
        // re-entry). Its result becomes the position Kavita actually opens.
        // Preflight checks use nativeFetch and never reach this observer.
        if(Number.isInteger(data.pageNum)&&(data.bookScrollId==null||typeof data.bookScrollId==='string'))
          readingSnapshots.set(info.id,{position:data,headers:new Headers(headers),checked:-Infinity});
        if(info.epoch!==navigationEpoch)return;
        const match=typeof data.bookScrollId==='string'&&data.bookScrollId.match(resumePattern);
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
  const open = XMLHttpRequest.prototype.open, setHeader = XMLHttpRequest.prototype.setRequestHeader, send = XMLHttpRequest.prototype.send, abort = XMLHttpRequest.prototype.abort;
  XMLHttpRequest.prototype.abort=function(){const r=requests.get(this);if(r)r.cancelled=true;return abort.call(this);};
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
    if(r?.progress&&typeof args[0]==='string') {
      args[0]=enrichProgress(args[0]);
      let data;try{data=JSON.parse(args[0]);}catch{return send.apply(this,args);}
      if(readingSnapshots.has(String(data.chapterId))) {
        const cancelled=()=>r.cancelled||requests.get(this)!==r;
        void syncSerial(async()=>{
          if(!await checkReadingPosition(data.chapterId,r.headers,cancelled)) {
            if(!cancelled()){abort.call(this);this.dispatchEvent(new ProgressEvent('abort'));this.dispatchEvent(new ProgressEvent('loadend'));}return;
          }
          if(cancelled())return;
          await new Promise(resolve=>{
            this.addEventListener('loadend',()=>{
              if(this.status>=200&&this.status<300)readingSnapshots.get(String(data.chapterId)).position=data;
              resolve();
            },{once:true});
            try{send.apply(this,args);}catch{resolve();}
          });
        });return;
      }
    }
    if (r?.info) {
      let observed=false;
      const observeResponse=()=>{
        if(observed||this.readyState!==4||this.status!==200)return;
        try {
          observe(r.info,this.responseType==='json'?JSON.stringify(this.response):this.responseText,r.headers);
          observed=true;
        } catch {}
      };
      // XHR EventTarget does not prioritize capture listeners over an earlier
      // onload handler. DONE precedes load, so install the baseline here.
      this.addEventListener('readystatechange',observeResponse);
      this.addEventListener('load',observeResponse,{once:true});
      this.addEventListener('loadend',()=>this.removeEventListener('readystatechange',observeResponse),{once:true});
    }
    return send.apply(this,args);
  };
  window.fetch = async function(input, init) {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if(method.toUpperCase()==='POST'&&progressURL(url)) {
      if(typeof init?.body==='string')init={...init,body:enrichProgress(init.body)};
      else if(input instanceof Request&&!init?.body)input=new Request(input,{body:enrichProgress(await input.clone().text())});
    }
    if(method.toUpperCase()==='POST'&&progressURL(url)) {
      const body=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():null;
      let data;try{data=JSON.parse(body);}catch{}
      if(data&&readingSnapshots.has(String(data.chapterId)))return syncSerial(async()=>{
        const signal=init?.signal??(input instanceof Request?input.signal:null);
        const cancelled=()=>!!signal?.aborted;
        const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
        if(!await checkReadingPosition(data.chapterId,headers,cancelled))throw new DOMException('Reading position save cancelled','AbortError');
        const response=await nativeFetch(input,init);
        if(response.ok)readingSnapshots.get(String(data.chapterId)).position=data;
        return response;
      });
    }
    const info = method.toUpperCase() === 'GET' ? requestInfo(url) : null;
    const response = await nativeFetch(input,init);
    if (info && response.ok) {
      const all = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const headers = new Headers(); if (all.has('authorization')) headers.set('authorization',all.get('authorization'));
      try {observe(info,await response.clone().text(),headers);} catch {}
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
    label.disabled = true;
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
    const key=calculationKey(root,g);
    const length=sections.get(book.id);
    if(key!==signature){
      cancelCalculation();signature=key;counts=revisions.has(book.id)?loadCounts(key,length):[];
      failed=false;generation++;
    }
    // A section-specific measurement difference must not discard every other section.
    counts[book.index]=g.total;
    const complete=length&&counts.slice(0,length).filter(n=>Number.isInteger(n)&&n>0).length===length;
    if(complete) {
      const before=counts.slice(0,book.index).reduce((sum,n)=>sum+n,0),total=counts.slice(0,length).reduce((sum,n)=>sum+n,0);
      label.textContent=`${before+g.current} / ${total}`;
      label.title='현재 화면 설정으로 계산한 책 전체 페이지. 눌러서 원하는 페이지로 이동';
      label.setAttribute('aria-label',`${label.textContent} 페이지. 원하는 페이지로 이동`);
      label.disabled = !!pageJump;
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

// Device/browser speech synthesis. No Kavita-side TTS server or audio cache.
(() => {
  'use strict';
  if(window.__kavitaTtsInstalled)return;
  window.__kavitaTtsInstalled=true;
  const synth=window.speechSynthesis;
  if(!synth||typeof window.SpeechSynthesisUtterance!=='function')return;
  let session=null,token=0,utterance=null,panel=null,status=null,voiceSelect=null,rateInput=null;
  const pref='kavita-browser-tts-v1';
  const highlightName='kavita-tts-current';
  const style=document.createElement('style');
  style.textContent='::highlight(kavita-tts-current){background:#ffe066;color:#111}';document.head.append(style);
  let expectedScroll=null,following=false;
  function clearHighlight(){window.CSS?.highlights?.delete(highlightName);document.getElementById('kavita-tts-highlight-fallback')?.remove();}
  function textRange(start,end) {
    if(!session)return null;
    const first=session.entries.find(e=>e.end>start),last=[...session.entries].reverse().find(e=>e.start<end);
    if(!first||!last||!first.node.isConnected||!last.node.isConnected)return null;
    const range=document.createRange();
    range.setStart(first.node,first.offset+Math.max(0,start-first.start));
    range.setEnd(last.node,last.offset+Math.min(last.end-last.start,Math.max(0,end-last.start)));
    return range;
  }
  async function follow(range,id,highlightRange=range) {
    if(!range||id!==token||!session)return false;
    const owner=session,content=owner.content,rect=range.getClientRects()[0];if(!rect)return true;
    const view=content.getBoundingClientRect(),vertical=content.classList.contains('writing-style-vertical');
    const column=owner.root.querySelector('.reading-section.column-layout-1,.reading-section.column-layout-2');
    const css=getComputedStyle(content),reader=owner.root.querySelector('.reader-container');
    const size=vertical?parseFloat(content.style.maxHeight)-20:(reader?.offsetWidth||content.clientWidth)-2*(parseFloat(css.marginLeft)||0)+20;
    let left=content.scrollLeft,top=content.scrollTop;
    if(column&&size>0){
      if(vertical&&(rect.top<view.top||rect.top>=view.bottom))top=Math.max(0,Math.floor((top+rect.top-view.top+2)/size)*size);
      else if(!vertical&&(rect.left<view.left-1||rect.left>=view.right-1))left=Math.max(0,Math.floor((left+rect.left-view.left+2)/size)*size);
    } else if(rect.top<view.top||rect.top>=view.bottom)top=Math.max(0,top+rect.top-view.top);
    if(Math.abs(left-content.scrollLeft)>1||Math.abs(top-content.scrollTop)>1){
      if(following)return true;following=true;
      try {
        if(window.__kavitaBeforeNavigation&&!await window.__kavitaBeforeNavigation())return false;
        if(id!==token||session!==owner)return false;
        expectedScroll={content,left,top};content.scrollTo({left,top,behavior:'instant'});
        content.dispatchEvent(new Event('scroll',{bubbles:true}));
      }finally{following=false;}
    }
    if(id!==token||session!==owner)return false;
    clearHighlight();
    if(window.Highlight&&window.CSS?.highlights)CSS.highlights.set(highlightName,new Highlight(highlightRange));
    else {
      const box=highlightRange.getClientRects()[0];
      if(box){const overlay=document.createElement('div');overlay.id='kavita-tts-highlight-fallback';overlay.setAttribute('aria-hidden','true');overlay.style.cssText=`position:fixed;pointer-events:none;z-index:1000;background:#ffe06666;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;document.body.append(overlay);}
    }
    return true;
  }

  let settings={rate:1,voice:''};
  try{const saved=JSON.parse(localStorage.getItem(pref));if(saved&&saved.rate>=.5&&saved.rate<=2)settings={rate:Number(saved.rate),voice:String(saved.voice||'')};}catch{}
  const announce=text=>{if(status)status.textContent=text;};
  function stop(message='읽기를 정지했습니다.') {
    token++;session=null;utterance=null;expectedScroll=null;clearHighlight();synth.cancel();announce(message);
    document.querySelectorAll('[data-kavita-tts]').forEach(button=>button.setAttribute('aria-label','본문 읽어주기'));
  }
  function voices() {
    if(!voiceSelect)return;
    voiceSelect.replaceChildren(new Option('자동 선택',''));
    for(const voice of synth.getVoices())voiceSelect.add(new Option(`${voice.name} (${voice.lang})${voice.localService?' · 기기 음성':''}`,voice.voiceURI));
    voiceSelect.value=settings.voice;
    if(voiceSelect.selectedIndex<0)voiceSelect.value='';
  }
  async function speakNext(id) {
    if(id!==token||!session)return;
    if(!session.root.isConnected||session.content!==session.root.querySelector('.book-content')){stop();return;}
    if(!session.chunks.length){stop('현재 장의 읽기가 끝났습니다. 다음 장에서 다시 재생하세요.');return;}
    const chunk=session.chunks.shift();
    while(chunk.start<chunk.end&&/\s/.test(session.text[chunk.start]))chunk.start++;
    if(chunk.start>=chunk.end){void speakNext(id);return;}
    // Never rely on boundary events to cross a screen. Some Android voices
    // provide none. Split each sentence at its actual rendered page boundary.
    const pageAt=offset=>{
      const range=textRange(offset,offset+1),rect=range?.getClientRects()[0];if(!rect)return 0;
      const content=session.content,view=content.getBoundingClientRect(),css=getComputedStyle(content);
      const vertical=content.classList.contains('writing-style-vertical');
      const column=session.root.querySelector('.reading-section.column-layout-1,.reading-section.column-layout-2');
      const size=column?(vertical?parseFloat(content.style.maxHeight)-20:(session.root.querySelector('.reader-container')?.offsetWidth||content.clientWidth)-2*(parseFloat(css.marginLeft)||0)+20):content.clientHeight;
      return size>0?Math.floor(((vertical||!column?content.scrollTop+rect.top-view.top:content.scrollLeft+rect.left-view.left)+2)/size):0;
    };
    let end=Math.min(chunk.end,chunk.start+220);
    const startPage=pageAt(chunk.start);
    if(pageAt(end-1)>startPage){
      let lo=chunk.start+1,hi=end;
      while(lo<hi){const mid=Math.floor((lo+hi)/2);if(pageAt(mid)>startPage)hi=mid;else lo=mid+1;}
      end=lo;
    }
    if(end<chunk.end)session.chunks.unshift({...chunk,start:end});
    const text=session.text.slice(chunk.start,end);
    const sentenceRange=textRange(chunk.sentenceStart,chunk.sentenceEnd);
    if(!await follow(textRange(chunk.start,chunk.start+1),id,sentenceRange)||id!==token||!session)return;
    const item=new SpeechSynthesisUtterance(text);utterance=item;
    item.onboundary=event=>{
      if(id!==token||!Number.isInteger(event.charIndex)||event.charIndex>=text.length)return;
      const position=chunk.start+event.charIndex;
      void follow(textRange(position,position+1),id,textRange(chunk.sentenceStart,chunk.sentenceEnd)).catch(()=>{if(id===token)stop('읽기 위치를 표시하지 못해 정지했습니다.');});
    };
    const available=synth.getVoices();
    item.voice=available.find(v=>v.voiceURI===settings.voice)||available.find(v=>v.lang.toLowerCase().startsWith(session.lang.toLowerCase()))||null;
    item.lang=item.voice?.lang||session.lang;item.rate=settings.rate;
    item.onend=()=>{if(id===token){utterance=null;setTimeout(()=>{if(id===token)void speakNext(id);},0);}};
    item.onerror=event=>{if(id===token)stop(`음성 재생 실패 (${event.error||'알 수 없는 오류'}). 음성 설정을 확인하세요.`);};
    announce('읽는 중 · 현재 장 끝에서 종료됩니다.');
    synth.speak(item);
  }
  function readingText(content) {
    const nodes=[],walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {
      const node=walker.currentNode;
      if(!node.textContent.trim()||node.parentElement.closest('script,style,noscript,button,input,textarea,select,[aria-hidden="true"],.bookmark-overlay,app-book-line-overlay'))continue;
      const css=getComputedStyle(node.parentElement);if(css.display==='none'||css.visibility==='hidden')continue;
      nodes.push(node);
    }
    const viewport=content.getBoundingClientRect();
    const visible=rect=>rect.width>0&&rect.height>0&&rect.right>viewport.left+1&&rect.left<viewport.right-1&&rect.bottom>viewport.top+1&&rect.top<viewport.bottom-1;
    let first=0,offset=0,found=false;
    // Long paragraphs can span many columns: locate a visible character rather
    // than reading the entire paragraph from its beginning on every restart.
    for(let n=0;n<nodes.length&&!found;n++) {
      const node=nodes[n],range=document.createRange();range.selectNodeContents(node);
      if(![...range.getClientRects()].some(visible))continue;
      for(let k=0;k<node.length;k+=64){
        range.setStart(node,k);range.setEnd(node,Math.min(k+64,node.length));
        if(![...range.getClientRects()].some(visible))continue;
        for(let j=k;j<Math.min(k+64,node.length);j++){
          range.setStart(node,j);range.setEnd(node,j+1);
          if(visible(range.getBoundingClientRect())){first=n;offset=j;found=true;break;}
        }
        if(found)break;
      }
    }
    const entries=[];let text='';
    for(const [index,node] of nodes.slice(first).entries()){
      const from=index===0?offset:0,start=text.length,value=node.textContent.slice(from);
      entries.push({node,offset:from,start,end:start+value.length});text+=value+' ';
    }
    return {text,entries};
  }
  function start(root) {
    const content=root.querySelector('.book-content');
    if(!content||root.querySelector('.is-loading')){announce('본문을 불러온 후 다시 재생하세요.');return;}
    const {text,entries}=readingText(content);if(!text.trim()){announce('읽을 수 있는 본문 텍스트가 없습니다.');return;}
    stop();
    const lang=content.querySelector('[lang]')?.lang||content.lang||(/\p{Script=Hangul}/u.test(text)?'ko-KR':document.documentElement.lang||'en-US');
    let sentences;
    try{sentences=[...new Intl.Segmenter(lang,{granularity:'sentence'}).segment(text)].map(s=>({start:s.index,end:s.index+s.segment.length}));}
    catch{sentences=[...text.matchAll(/[^.!?。！？\n]+[.!?。！？]*[\s]*/g)].map(m=>({start:m.index,end:m.index+m[0].length}));}
    const chunks=sentences.map(s=>{
      const body=text.slice(s.start,s.end),start=s.start+(body.length-body.trimStart().length),end=s.end-(body.length-body.trimEnd().length);
      return {start,end,sentenceStart:start,sentenceEnd:end};
    }).filter(s=>s.end>s.start);
    session={root,content,chunks,entries,text,lang};
    speakNext(token);
    document.querySelectorAll('[data-kavita-tts]').forEach(button=>button.setAttribute('aria-label','본문 읽어주기 · 재생 중'));
  }
  function openPanel(root) {
    if(panel?.isConnected){panel.close();panel.remove();}
    panel=document.createElement('dialog');panel.id='kavita-tts-panel';panel.setAttribute('role','dialog');
    panel.style.cssText='max-width:min(430px,90vw);border:0;border-radius:12px;padding:20px;color:#222;background:#fff;box-shadow:0 8px 40px #0008';
    const title=document.createElement('h3');title.textContent='본문 읽어주기';panel.append(title);
    const explanation=document.createElement('p');explanation.textContent='현재 장 끝까지 읽으며 읽는 위치에 맞춰 페이지를 넘깁니다. 화면을 끄면 중단될 수 있으며, 선택한 음성에 따라 인터넷 연결이 필요할 수 있습니다.';panel.append(explanation);
    voiceSelect=document.createElement('select');voiceSelect.setAttribute('aria-label','읽기 음성');panel.append(voiceSelect);voices();
    rateInput=document.createElement('input');rateInput.type='range';rateInput.min='.5';rateInput.max='2';rateInput.step='.1';rateInput.value=settings.rate;rateInput.setAttribute('aria-label','읽기 속도');
    const rateLabel=document.createElement('label');rateLabel.textContent=`속도 ${settings.rate}배 `;rateLabel.append(rateInput);panel.append(rateLabel);
    const save=()=>{settings={rate:Number(rateInput.value),voice:voiceSelect.value};rateLabel.firstChild.textContent=`속도 ${settings.rate}배 `;try{localStorage.setItem(pref,JSON.stringify(settings));}catch{}};
    rateInput.addEventListener('input',save);voiceSelect.addEventListener('change',save);
    status=document.createElement('p');status.setAttribute('aria-live','polite');status.textContent=session?(synth.paused?'일시정지 중':'읽는 중'):'음성·속도 변경은 다음 읽기 구간부터 적용됩니다.';panel.append(status);
    for(const [label,action] of [['재생',()=>{if(session){synth.resume();announce('읽는 중');}else start(root);}],['일시정지',()=>{if(session){synth.pause();announce('일시정지 중');}}],['정지',()=>stop()],['닫기',()=>panel.close()]]){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.style.cssText='margin:6px;padding:8px';button.addEventListener('click',action);panel.append(button);
    }
    (document.fullscreenElement||document.body).append(panel);panel.showModal();
  }
  function refresh() {
    if(session&&(!session.root.isConnected||session.content!==session.root.querySelector('.book-content')||session.root.querySelector('.is-loading')))stop();
    for(const shortcut of document.querySelectorAll('app-book-reader .reader-header .fa-clipboard-question')){
      const anchor=shortcut.closest('button'),root=shortcut.closest('app-book-reader');
      if(!anchor?.parentElement||anchor.parentElement.querySelector('[data-kavita-tts]'))continue;
      const button=document.createElement('button');button.type='button';button.className='btn btn-icon me-1';button.setAttribute('data-kavita-tts','');button.setAttribute('aria-label','본문 읽어주기');button.title='본문 읽어주기';
      const icon=document.createElement('i');icon.className='fa-solid fa-volume-high';icon.setAttribute('aria-hidden','true');button.append(icon);
      button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openPanel(root);});anchor.parentElement.insertBefore(button,anchor.parentElement.querySelector('[data-kavita-fullscreen]')||anchor);
    }
  }
  document.addEventListener('kavita-page-navigation',()=>{if(session)stop('페이지를 이동하여 읽기를 정지했습니다.');});
  document.addEventListener('kavita-reading-conflict',()=>{if(session)stop('다른 브라우저의 읽기 위치를 확인하기 위해 정지했습니다.');});
  document.addEventListener('scroll',event=>{
    if(!session||event.target!==session.content)return;
    if(expectedScroll?.content===event.target&&Math.abs(event.target.scrollLeft-expectedScroll.left)<2&&Math.abs(event.target.scrollTop-expectedScroll.top)<2)return;
    stop('페이지를 이동하여 읽기를 정지했습니다.');
  },true);
  window.addEventListener('pagehide',()=>stop());
  synth.addEventListener('voiceschanged',voices);
  let scheduled=false;
  new MutationObserver(records=>{
    if(session&&records.some(r=>session.content.contains(r.target)))stop('본문이 변경되어 읽기를 정지했습니다.');
    if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;refresh();});}
  }).observe(document.body,{childList:true,subtree:true});
  refresh();
})();
