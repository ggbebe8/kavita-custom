// Deliberate edge dwell for an actively dragged native selection. No input
// interception: devices that don't expose handle input retain normal selection.
export function install() {
  if (window.__kavitaSelectionPagingInstalled) return;
  window.__kavitaSelectionPagingInstalled = true;
  const WAIT = 800, EDGE = 24, RESET = 48;
  let drag = null, pending = null, timer = 0, token = 0, frame = 0, hint = null;
  const interactive = 'button,a,input,textarea,select,[contenteditable]:not([contenteditable="false"]),app-book-line-overlay';
  const style = document.createElement('style');
  style.textContent = `
    #kv-selection-edge-dwell{position:fixed;left:50%;transform:translateX(-50%);z-index:1100;pointer-events:none;background:#222e;color:#fff;padding:5px 10px;border-radius:6px;font:12px/1.4 system-ui,sans-serif;white-space:nowrap}
    #kv-selection-edge-dwell span{display:block;height:2px;margin-top:4px;background:#fff;transform-origin:left;animation:kv-selection-edge-fill .8s linear both}
    @keyframes kv-selection-edge-fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  `;
  document.head.append(style);
  const contentAt = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('app-book-reader .book-content');
  function range() {
    const selection = getSelection(), content = contentAt(selection?.anchorNode);
    if (!selection || selection.isCollapsed || !selection.toString().trim() || !content || content !== contentAt(selection.focusNode)) return null;
    return {selection, content, anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
      focus: selection.focusNode, focusOffset: selection.focusOffset};
  }
  function geometry(content) {
    const root = content.closest('app-book-reader');
    if (!root?.isConnected || !root.querySelector('.reading-section:is(.column-layout-1,.column-layout-2)') ||
        root.querySelector('.is-loading') || content.classList.contains('writing-style-vertical') ||
        getComputedStyle(content).direction === 'rtl' || document.querySelector('ngb-modal-window,ngb-offcanvas,[role="dialog"],app-book-line-overlay form')) return null;
    const css = getComputedStyle(content), reader = root.querySelector('.reader-container');
    // Same screen step used by Kavita's horizontal column reader and TTS.
    const size = (reader?.offsetWidth || content.clientWidth) - 2 * (parseFloat(css.marginLeft) || 0) + 20;
    const view = content.getBoundingClientRect();
    const header = root.querySelector('.reader-header')?.getBoundingClientRect();
    const footer = root.querySelector('.bottom-bar')?.getBoundingClientRect();
    return {root, content, size, offset: content.scrollLeft, max: Math.max(0, content.scrollWidth-content.clientWidth),
      left: Math.max(0,view.left), right: Math.min(innerWidth,view.right),
      top: Math.max(0,view.top,header?.bottom || 0), bottom: Math.min(innerHeight,view.bottom,footer?.height ? footer.top : innerHeight)};
  }
  function zone(g, inset = EDGE) {
    if (!drag || drag.x < g.left+8 || drag.x > g.right-8 || drag.y < g.top-32 || drag.y > g.bottom+32) return 0;
    if (drag.y <= g.top+inset) return -1;
    if (drag.y >= g.bottom-inset) return 1;
    return 0;
  }
  function cancel() {
    clearTimeout(timer);timer=0;pending=null;token++;hint?.remove();hint=null;
  }
  function end() {cancel();drag=null;}
  function schedule() {if (!frame) frame=requestAnimationFrame(()=>{frame=0;update();});}
  function update() {
    const selected=range(), g=selected && geometry(selected.content);
    if (!drag || !drag.moved || !g || drag.content!==selected.content || document.visibilityState==='hidden') {cancel();return;}
    if (drag.awaitExit) {if (!zone(g,RESET)) drag.awaitExit=false;cancel();return;}
    const direction=zone(g);
    if (!direction || (direction<0 ? g.offset<=1 : g.offset>=g.max-1)) {cancel();return;}
    if (pending?.direction===direction && pending.content===g.content && Math.abs(pending.offset-g.offset)<2) return;
    cancel();
    pending={...g,direction,url:location.href};
    const own=token;
    hint=document.createElement('div');hint.id='kv-selection-edge-dwell';hint.setAttribute('role','status');
    hint.textContent=direction<0?'이전 페이지로 선택 이어가기':'다음 페이지로 선택 이어가기';hint.append(document.createElement('span'));
    hint.style[direction<0?'top':'bottom']=(direction<0?g.top+4:innerHeight-g.bottom+4)+'px';
    (document.fullscreenElement||document.body).append(hint);
    timer=setTimeout(()=>{void advance(own).catch(()=>{if(own===token)end();});},WAIT);
  }
  function caret(content,g,direction,x) {
    const px=Math.max(g.left+10,Math.min(g.right-10,x));
    for (let step=0;step<100;step+=5) {
      const y=direction>0?g.top+20+step:g.bottom-20-step;
      if(y<=g.top||y>=g.bottom)break;
      const point=document.caretPositionFromPoint?.(px,y);
      const native=point?null:document.caretRangeFromPoint?.(px,y);
      const node=point?.offsetNode||native?.startContainer,offset=point?.offset??native?.startOffset;
      if(node?.nodeType===3 && content.contains(node))return {node,offset};
    }
    return null;
  }
  async function advance(own) {
    const request=pending, selected=range();
    if (!request || !drag || own!==token || !selected || selected.content!==request.content || zone(request)!==request.direction) return cancel();
    if (window.__kavitaBeforeNavigation && !await window.__kavitaBeforeNavigation()) {if(own===token)end();return;}
    const current=range(), g=current && geometry(current.content);
    if (own!==token || !drag || !g || request.url!==location.href || current.content!==request.content ||
        current.anchor!==selected.anchor || current.anchorOffset!==selected.anchorOffset || current.focus!==selected.focus ||
        current.focusOffset!==selected.focusOffset || Math.abs(g.offset-request.offset)>1 || zone(g)!==request.direction) {
      if(own===token)cancel();return;
    }
    const target=Math.max(0,Math.min(g.max,g.offset+g.size*request.direction));
    if (Math.abs(target-g.offset)<2) return cancel();
    cancel();drag.awaitExit=true;
    document.dispatchEvent(new Event('kavita-page-navigation'));
    g.content.scrollTo({left:target,behavior:'instant'});
    // Rebase the existing selection scroll guard before the browser delivers
    // its scroll event. All subsequent accidental scrolling is still blocked.
    document.dispatchEvent(new CustomEvent('kavita-selection-page-moved',{detail:{content:g.content}}));
    const point=caret(g.content,g,request.direction,drag.x);
    if (point) current.selection.setBaseAndExtent(current.anchor,current.anchorOffset,point.node,point.offset);
    else {
      g.content.scrollTo({left:g.offset,behavior:'instant'});
      document.dispatchEvent(new CustomEvent('kavita-selection-page-moved',{detail:{content:g.content}}));
    }
    g.content.dispatchEvent(new Event('scroll',{bubbles:true}));
  }
  function start(event,x,y,id) {
    if(event.target.closest?.(interactive))return end();
    const selected=range(), content=contentAt(event.target)||selected?.content, g=content&&geometry(content);
    if(!g||x<g.left||x>g.right||y<g.top-16||y>g.bottom+16)return end();
    cancel();drag={content,x,y,startX:x,startY:y,id,moved:false,awaitExit:false};
  }
  function move(x,y) {
    if(!drag)return;
    drag.x=x;drag.y=y;
    if(Math.hypot(x-drag.startX,y-drag.startY)>8)drag.moved=true;
    schedule();
  }
  document.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0)return end();start(event,event.clientX,event.clientY,event.pointerId);
  },{capture:true,passive:true});
  document.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    if(event.pointerType==='mouse'&&!(event.buttons&1))return end();move(event.clientX,event.clientY);
  },{capture:true,passive:true});
  for(const type of ['pointerup','pointercancel','touchend','touchcancel'])document.addEventListener(type,end,{capture:true,passive:true});
  document.addEventListener('touchstart',event=>{
    if(event.touches.length!==1)return end();
    if(!drag){const p=event.touches[0];start(event,p.clientX,p.clientY,'touch');}
  },{capture:true,passive:true});
  document.addEventListener('touchmove',event=>{
    if(event.touches.length!==1)return end();const p=event.touches[0];move(p.clientX,p.clientY);
  },{capture:true,passive:true});
  document.addEventListener('selectionchange',schedule);
  document.addEventListener('kavita-reading-conflict',end);
  document.addEventListener('keydown',end,{capture:true,passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)end();});
  window.addEventListener('blur',end);window.addEventListener('resize',end);window.addEventListener('pagehide',end);
}
