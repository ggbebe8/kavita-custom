// Deliberate edge dwell for an actively dragged native selection. No input
// interception of book input. Explicit web handles also support touch devices.
export function install() {
  if (window.__kavitaSelectionPagingInstalled) return;
  window.__kavitaSelectionPagingInstalled = true;
  const WAIT = 800, EDGE = 24, EDGE_BOTTOM = 56, RESET = 48, RESET_BOTTOM = 76, HOLD = 700;
  let drag = null, pending = null, timer = 0, token = 0, frame = 0, hint = null;
  let touchUI=false, handleDrag=null, adjusting=false;
  const handles=new Map();
  const interactive = 'button,a,input,textarea,select,[contenteditable]:not([contenteditable="false"]),app-book-line-overlay';
  const style = document.createElement('style');
  style.textContent = `
    #kv-selection-edge-dwell{position:fixed;left:50%;transform:translateX(-50%);z-index:1100;pointer-events:none;background:#222e;color:#fff;padding:5px 10px;border-radius:6px;font:12px/1.4 system-ui,sans-serif;white-space:nowrap}
    #kv-selection-edge-dwell span{display:block;height:2px;margin-top:4px;background:#fff;transform-origin:left;animation:kv-selection-edge-fill .8s linear both}
    .kv-selection-web-handle{position:fixed;z-index:2147483647;box-sizing:border-box;min-width:36px;height:28px;padding:0 5px;border:2px solid #fff;border-radius:14px;background:#086ad8;color:#fff;box-shadow:0 1px 4px #0008;font:11px/24px system-ui,sans-serif;touch-action:none;user-select:none;-webkit-user-select:none;cursor:pointer}
    .kv-selection-web-handle::after{content:'';position:absolute;inset:-8px -6px}
    ::highlight(kv-selection-drag){background-color:#086ad8;color:#fff}
    @keyframes kv-selection-edge-fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    app-book-reader.kv-selection-active-drag .fixed-top,
    app-book-reader.kv-selection-active-drag .fixed-top *,
    app-book-reader.kv-selection-active-drag .reader-header,
    app-book-reader.kv-selection-active-drag app-book-line-overlay,
    app-book-reader.kv-selection-active-drag app-book-line-overlay * {
      pointer-events: none !important;
    }
    app-book-reader.kv-selection-active-drag app-book-line-overlay .overlay {
      visibility: hidden !important;
    }
  `;
  document.head.append(style);
  const contentAt = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('app-book-reader .book-content');
  function activeDragRange(own) {
    if (!own.fixed || !own.current || !own.fixed.isConnected || !own.current.isConnected) return null;
    const r = document.createRange();
    try {
      const comp = own.fixed.compareDocumentPosition(own.current);
      if (comp & Node.DOCUMENT_POSITION_PRECEDING || (own.fixed === own.current && own.fixedOffset > own.currentOffset)) {
        r.setStart(own.current, own.currentOffset);
        r.setEnd(own.fixed, own.fixedOffset);
      } else {
        r.setStart(own.fixed, own.fixedOffset);
        r.setEnd(own.current, own.currentOffset);
      }
      return r;
    } catch {
      return null;
    }
  }
  function updateDragHighlight(own) {
    if (!window.CSS || !CSS.highlights) {
      getSelection().setBaseAndExtent(own.fixed, own.fixedOffset, own.current, own.currentOffset);
      return;
    }
    const r = activeDragRange(own);
    if (r) {
      CSS.highlights.set('kv-selection-drag', new Highlight(r));
      document.dispatchEvent(new Event('selectionchange'));
    }
  }
  function range() {
    if (handleDrag && handleDrag.current && handleDrag.fixed) {
      const r = activeDragRange(handleDrag);
      if (r) {
        return {
          selection: getSelection(),
          dragRange: r,
          content: handleDrag.content,
          anchor: handleDrag.fixed,
          anchorOffset: handleDrag.fixedOffset,
          focus: handleDrag.current,
          focusOffset: handleDrag.currentOffset,
          toString: () => r.toString()
        };
      }
    }
    const selection = getSelection(), content = contentAt(selection?.anchorNode);
    if (!selection || selection.isCollapsed || !selection.toString().trim() || !content || content !== contentAt(selection.focusNode)) return null;
    return {selection, dragRange: null, content, anchor: selection.anchorNode, anchorOffset: selection.anchorOffset,
      focus: selection.focusNode, focusOffset: selection.focusOffset, toString: () => selection.toString()};
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
    if (!drag || drag.x < g.left-32 || drag.x > g.right+32 || drag.y < -100 || drag.y > innerHeight+60) return 0;
    const topInset = inset;
    const bottomInset = (inset === RESET) ? RESET_BOTTOM : (inset === EDGE ? EDGE_BOTTOM : Math.max(inset, EDGE_BOTTOM));
    if (drag.y <= g.top+topInset) return -1;
    if (drag.y >= g.bottom-bottomInset) return 1;
    return 0;
  }
  function cancel() {
    clearTimeout(timer);timer=0;pending=null;token++;hint?.remove();hint=null;
  }
  function end() {
    document.querySelector('app-book-reader.kv-selection-active-drag')?.classList.remove('kv-selection-active-drag');
    cancel();drag=null;
  }
  function schedule() {if (!frame) frame=requestAnimationFrame(()=>{frame=0;update();});}
  function update() {
    updateHandles();
    const selected=range(), g=selected && geometry(selected.content);
    if (!drag || !drag.moved || !g || drag.content!==selected.content || document.visibilityState==='hidden') {cancel();return;}
    if (drag.awaitExit) {if (!zone(g,RESET)) drag.awaitExit=false;cancel();return;}
    const direction=zone(g);
    if (!direction || (direction<0 ? g.offset<=1 : g.offset>=g.max-1)) {cancel();return;}

    // Do NOT trigger page turn dwell if active drag hasn't reached the boundary on current page!
    if (!drag.rebase) {
      if (direction < 0 && handleDrag?.kind === 'end') { cancel(); return; }
      if (direction > 0 && handleDrag?.kind === 'start') { cancel(); return; }
      const activeNode = handleDrag ? handleDrag.current : selected.focus;
      const activeOffset = handleDrag ? handleDrag.currentOffset : selected.focusOffset;
      const activeRect = endpoint(activeNode, activeOffset);
      if (direction < 0 && activeRect && activeRect.top > g.top + 35) { cancel(); return; }
      if (direction > 0 && activeRect && activeRect.bottom < g.bottom - 85) { cancel(); return; }
    }

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
    if (point) {
      const anchorNode=handleDrag?handleDrag.fixed:current.anchor;
      const anchorOff=handleDrag?handleDrag.fixedOffset:current.anchorOffset;
      if (handleDrag) {
        handleDrag.current = point.node;
        handleDrag.currentOffset = point.offset;
        updateDragHighlight(handleDrag);
      } else {
        current.selection.setBaseAndExtent(anchorNode,anchorOff,point.node,point.offset);
      }
      const rect=endpoint(point.node,point.offset);
      const px=Math.max(g.left+10,Math.min(g.right-10,drag.x));
      const targetX=rect?Math.max(g.left+10,Math.min(g.right-10,rect.left)):px;
      const targetY=rect?Math.max(g.top+2,Math.min(g.bottom-2,rect.top+rect.height/2)):(request.direction>0?g.top+20:g.bottom-20);
      const clientX=handleDrag?.lastClientX??drag.x, clientY=handleDrag?.lastClientY??drag.y;
      const holdUntil=performance.now()+HOLD;
      const rb={
        content:g.content,
        anchor:anchorNode,
        anchorOffset:anchorOff,
        pointNode:point.node,
        pointOffset:point.offset,
        targetX,
        targetY,
        direction:request.direction,
        holdUntil,
        baseClientX:clientX,
        baseClientY:clientY,
        lastClientX:clientX,
        lastClientY:clientY
      };
      if (handleDrag) {
        handleDrag.rebase=rb;
        drag.x=targetX;drag.y=targetY;drag.startX=targetX;drag.startY=targetY;
      } else {
        drag.rebase=rb;
      }
      updateHandles();
    } else {
      g.content.scrollTo({left:g.offset,behavior:'instant'});
      document.dispatchEvent(new CustomEvent('kavita-selection-page-moved',{detail:{content:g.content}}));
    }
    g.content.dispatchEvent(new Event('scroll',{bubbles:true}));
  }
  function endpoint(node,offset) {
    const r=document.createRange();
    try {r.setStart(node,offset);r.collapse(true);const rect=[...r.getClientRects()].find(rect=>rect.height>0);return rect||null;}catch{return null;}
  }
  function pointAt(content,x,y) {
    const g=geometry(content);if(!g)return null;
    // Hit test the book, rather than the small web handle under the finger.
    for(const button of handles.values())button.style.pointerEvents='none';
    const reader=content.closest('app-book-reader');
    const wasDragging=reader?.classList.contains('kv-selection-active-drag');
    if(!wasDragging)reader?.classList.add('kv-selection-active-drag');
    try {
      const px=Math.max(g.left+2,Math.min(g.right-2,x));
      const py=Math.max(g.top+2,Math.min(g.bottom-2,y));
      const isTop=y<=g.top+15,isBottom=y>=g.bottom-15;
      const startY=isTop?g.top+10:(isBottom?g.bottom-10:py);

      for(const dy of [0,8,16,24,-8,32]) {
        const tryY=Math.max(g.top+2,Math.min(g.bottom-2,startY+dy));
        for(const dx of [0,8,16,-8]) {
          const tryX=Math.max(g.left+2,Math.min(g.right-2,px+dx));
          const p=document.caretPositionFromPoint?.(tryX,tryY),r=p?null:document.caretRangeFromPoint?.(tryX,tryY);
          const node=p?.offsetNode||r?.startContainer,offset=p?.offset??r?.startOffset;
          if(node?.nodeType===3&&content.contains(node)) {
            return {node,offset};
          }
          if(node?.nodeType===1&&content.contains(node)) {
            const rootNode=node.childNodes[offset]||node.childNodes[offset-1]||node;
            const walker=document.createTreeWalker(rootNode,NodeFilter.SHOW_TEXT);
            let targetText=null,cur;
            if (isBottom) {
              while ((cur=walker.nextNode())) targetText=cur;
              if (targetText) return {node:targetText,offset:targetText.length};
            } else {
              targetText=walker.nextNode();
              if (targetText) return {node:targetText,offset:0};
            }
          }
        }
      }
      return null;
    } finally {
      for(const button of handles.values())button.style.pointerEvents='';
      if(!wasDragging)reader?.classList.remove('kv-selection-active-drag');
    }
  }
  function updateHandles() {
    const selected=range(),g=selected&&geometry(selected.content);
    if(!touchUI||!g) {for(const button of handles.values())button.hidden=true;return;}
    const r=selected.dragRange||(selected.selection.rangeCount?selected.selection.getRangeAt(0):null);
    if(!r) {for(const button of handles.values())button.hidden=true;return;}
    for(const kind of ['start','end']) {
      const node=kind==='start'?r.startContainer:r.endContainer,offset=kind==='start'?r.startOffset:r.endOffset;
      const rect=endpoint(node,offset);
      let button=handles.get(kind);
      if(!button) {
        button=document.createElement('button');button.type='button';button.className='kv-selection-web-handle';button.dataset.kvSelectionHandle=kind;
        button.textContent=kind==='start'?'시작':'끝';button.setAttribute('aria-label',kind==='start'?'선택 시작 범위 조절':'선택 끝 범위 조절');
        button.addEventListener('pointerdown',event=>beginHandle(event,kind,button));
        button.addEventListener('pointermove',moveHandle);
        for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,finishHandle);
        button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
        (document.fullscreenElement||document.body).append(button);handles.set(kind,button);
      }
      const visible=rect&&rect.right>=g.left-1&&rect.left<=g.right+1&&rect.bottom>g.top&&rect.top<g.bottom;
      button.hidden=!visible;
      if(visible) {
        const bw=button.offsetWidth||36,bh=button.offsetHeight||28;
        button.style.left=Math.max(g.left+2,Math.min(g.right-bw-2,kind==='start'?rect.left-bw-4:rect.right+4))+'px';
        button.style.top=Math.max(g.top+2,Math.min(g.bottom-bh-2,rect.top+(rect.height-bh)/2))+'px';
      }
    }
  }
  function beginHandle(event,kind,button) {
    if(event.button!==0||!event.isPrimary)return;
    const selected=range(),g=selected&&geometry(selected.content);if(!g)return;
    event.preventDefault(); // Only this explicit handle owns/captures its drag.
    event.stopPropagation();
    const r=selected.dragRange||(selected.selection.rangeCount?selected.selection.getRangeAt(0):null),start=kind==='start';
    if(!r)return;
    const node=start?r.startContainer:r.endContainer,offset=start?r.startOffset:r.endOffset,rect=endpoint(node,offset);
    if(!rect)return;
    const fixedNode=start?r.endContainer:r.startContainer,fixedOffset=start?r.endOffset:r.startOffset;
    selected.content.closest('app-book-reader')?.classList.add('kv-selection-active-drag');
    handleDrag={button,kind,id:event.pointerId,content:selected.content,fixed:fixedNode,
      fixedOffset,current:node,currentOffset:offset,dx:rect.left-event.clientX,dy:rect.top+rect.height/2-event.clientY,
      text:selected.toString(),lastClientX:event.clientX,lastClientY:event.clientY};
    if(window.CSS&&CSS.highlights) {
      updateDragHighlight(handleDrag);
      selected.selection.removeAllRanges();
    }
    startDragForHandle(event,rect,selected.content);
    button.setPointerCapture(event.pointerId);
  }
  function applyMouseRebase(clientX, clientY) {
    if (!drag?.rebase || adjusting) return;
    const own = drag.rebase, g = geometry(own.content);
    if (!g || !own.anchor.isConnected) { if (drag) drag.rebase = null; return; }
    const now = performance.now();
    adjusting = true;
    try {
      if (now < own.holdUntil) {
        own.baseClientX = clientX;
        own.baseClientY = clientY;
        getSelection().setBaseAndExtent(own.anchor, own.anchorOffset, own.pointNode, own.pointOffset);
        return;
      }
      const dir = own.direction;
      const deltaY = clientY - own.baseClientY;
      const deltaX = clientX - own.baseClientX;
      const activeDeltaY = dir > 0 ? Math.max(0, deltaY - 8) : Math.min(0, deltaY + 8);
      const vx = Math.max(g.left + 10, Math.min(g.right - 10, own.targetX + deltaX));
      const vy = Math.max(g.top + 2, Math.min(g.bottom - 2, own.targetY + activeDeltaY));
      const p = pointAt(own.content, vx, vy);
      if (p) {
        getSelection().setBaseAndExtent(own.anchor, own.anchorOffset, p.node, p.offset);
      }
    } finally {
      adjusting = false;
    }
  }
  function startDragForHandle(event,rect,content) {
    start({target:content},Math.max(geometry(content).left+10,Math.min(geometry(content).right-10,rect.left)),rect.top+rect.height/2,event.pointerId);
  }
  function moveHandle(event) {
    const own=handleDrag;if(!own||event.pointerId!==own.id)return;
    own.lastClientX=event.clientX;own.lastClientY=event.clientY;
    const g=geometry(own.content);if(!g||range()?.content!==own.content||!own.fixed.isConnected)return finishHandle(event);

    if (own.rebase) {
      const rb = own.rebase;
      const now = performance.now();
      if (now < rb.holdUntil) {
        rb.baseClientX = event.clientX;
        rb.baseClientY = event.clientY;
        own.current = rb.pointNode;
        own.currentOffset = rb.pointOffset;
        updateDragHighlight(own);
        move(rb.targetX, rb.targetY);
        return;
      }
      const dir = rb.direction;
      const deltaY = event.clientY - rb.baseClientY;
      const deltaX = event.clientX - rb.baseClientX;
      const activeDeltaY = dir > 0 ? Math.max(0, deltaY - 8) : Math.min(0, deltaY + 8);
      const vx = Math.max(g.left + 10, Math.min(g.right - 10, rb.targetX + deltaX));
      const vy = Math.max(g.top + 2, Math.min(g.bottom - 2, rb.targetY + activeDeltaY));
      const p = pointAt(own.content, vx, vy);
      if (p) {
        own.current = p.node;
        own.currentOffset = p.offset;
        updateDragHighlight(own);
      }
      move(vx, vy);
      return;
    }

    const isTopEdge = event.clientY <= g.top + 20;
    const isBottomEdge = event.clientY >= g.bottom - 48;
    const probeX = (own.kind === 'start' && (event.clientX <= g.left + 30 || isTopEdge)) ? g.left + 2 :
      (own.kind === 'end' && (event.clientX >= g.right - 30 || isBottomEdge)) ? g.right - 2 :
      event.clientX + own.dx;
    const probeY = isTopEdge ? g.top - 10 :
      isBottomEdge ? g.bottom + 10 :
      event.clientY + own.dy;
    const p = pointAt(own.content, probeX, probeY);
    if (p) {
      own.current = p.node;
      own.currentOffset = p.offset;
      updateDragHighlight(own);
    }
    move(event.clientX, event.clientY);
  }
  function finishHandle(event) {
    const own=handleDrag;if(!own||event.pointerId!==own.id)return;
    handleDrag=null;end();
    if(own.button.hasPointerCapture(own.id))own.button.releasePointerCapture(own.id);
    if(window.CSS&&CSS.highlights)CSS.highlights.delete('kv-selection-drag');
    getSelection().setBaseAndExtent(own.fixed,own.fixedOffset,own.current,own.currentOffset);
    const selected=range();
    if(selected?.content===own.content&&selected.toString()!==own.text) {
      // Handle buttons live outside the book. Commit one completed range change
      // to Kavita so its annotation XPaths match the final selection as well.
      const target=(selected.focus.nodeType===1?selected.focus:selected.focus.parentElement)||selected.content;
      target?.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch'}));
    }
    schedule();
  }
  function abortInput() {
    if(handleDrag)finishHandle({pointerId:handleDrag.id});
    end();
  }
  function start(event,x,y,id) {
    if(event.target.closest?.(interactive))return end();
    const selected=range(), content=contentAt(event.target)||selected?.content, g=content&&geometry(content);
    if(!g||x<g.left||x>g.right||y<g.top-16||y>g.bottom+16)return end();
    cancel();drag={content,x,y,startX:x,startY:y,id,moved:false,awaitExit:false};
    content.closest('app-book-reader')?.classList.add('kv-selection-active-drag');
  }
  function move(x,y) {
    if(!drag)return;
    drag.x=x;drag.y=y;
    if(Math.hypot(x-drag.startX,y-drag.startY)>8)drag.moved=true;
    schedule();
  }
  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest?.('[data-kv-selection-handle]')) {if(handleDrag)abortInput();touchUI=event.pointerType==='touch';schedule();}
    if(!event.isPrimary||event.button!==0)return end();start(event,event.clientX,event.clientY,event.pointerId);
  },{capture:true,passive:true});
  document.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    if(event.pointerType==='mouse'&&!(event.buttons&1))return end();
    if(drag.rebase){
      drag.rebase.lastX=event.clientX;drag.rebase.lastY=event.clientY;
      applyMouseRebase(event.clientX,event.clientY);
    } else if(!handleDrag && drag.content) {
      const g=geometry(drag.content);
      if(g) {
        const sel=getSelection();
        if(sel&&sel.rangeCount&&!sel.isCollapsed&&sel.anchorNode&&drag.content.contains(sel.anchorNode)) {
          if(event.clientY<=g.top+10) {
            const p=pointAt(drag.content,g.left+2,g.top-10);
            if(p) {
              const comp=sel.anchorNode.compareDocumentPosition(p.node);
              if((comp&Node.DOCUMENT_POSITION_PRECEDING)||(sel.anchorNode===p.node&&sel.anchorOffset>=p.offset)) {
                sel.setBaseAndExtent(sel.anchorNode,sel.anchorOffset,p.node,p.offset);
              }
            }
          } else if(event.clientY>=g.bottom-36) {
            const p=pointAt(drag.content,g.right-2,g.bottom+10);
            if(p) {
              const comp=sel.anchorNode.compareDocumentPosition(p.node);
              if((comp&Node.DOCUMENT_POSITION_FOLLOWING)||(sel.anchorNode===p.node&&sel.anchorOffset<=p.offset)) {
                sel.setBaseAndExtent(sel.anchorNode,sel.anchorOffset,p.node,p.offset);
              }
            }
          }
        }
      }
    }
    move(event.clientX,event.clientY);
  },{capture:true,passive:true});
  for(const type of ['pointerup','pointercancel','touchend','touchcancel'])document.addEventListener(type,end,{capture:true,passive:true});
  document.addEventListener('touchstart',event=>{
    touchUI=true;schedule();
    if(event.touches.length!==1){if(handleDrag)finishHandle({pointerId:handleDrag.id});return end();}
    if(!drag){const p=event.touches[0];start(event,p.clientX,p.clientY,'touch');}
  },{capture:true,passive:true});
  document.addEventListener('touchmove',event=>{
    if(event.touches.length!==1){if(handleDrag)finishHandle({pointerId:handleDrag.id});return end();}
    if(handleDrag)return; // Captured pointermove already maps handle to text.
    const p=event.touches[0];move(p.clientX,p.clientY);
  },{capture:true,passive:true});
  document.addEventListener('selectionchange',()=>{
    if(drag?.rebase&&!adjusting){
      applyMouseRebase(drag.rebase.lastX,drag.rebase.lastY);
    }
    schedule();
  });
  document.addEventListener('kavita-reading-conflict',abortInput);
  document.addEventListener('keydown',abortInput,{capture:true,passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)abortInput();});
  window.addEventListener('blur',abortInput);window.addEventListener('resize',abortInput);window.addEventListener('pagehide',abortInput);
  window.__kavitaSelectionActiveRange = () => {
    if (handleDrag) return activeDragRange(handleDrag);
    const s = getSelection();
    return s.rangeCount ? s.getRangeAt(0) : null;
  };
}
