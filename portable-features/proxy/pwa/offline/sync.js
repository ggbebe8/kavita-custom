import {identity,myStates,get,change,pending,samePosition,editFields,revision,json,api,createId} from './store.js';
// Serialize tabs and PWA windows. No background task ever assumes a POST was
// acknowledged merely because its request was sent.
const deferred=new Set();
export async function syncAll({ask=async()=> 'cancel',status=()=>{},manual=false}={}){
  const user=identity();if(!user||!navigator.onLine)return;
  if(!navigator.locks){status('이 브라우저에서는 안전한 동기화를 지원하지 않습니다. Chrome/Edge를 사용하세요.');return;}
  return navigator.locks.request('kavita-offline-sync:'+user.key,{ifAvailable:true},async lock=>{
    if(!lock)return;
    const account=user.key;if(manual)deferred.clear();
    for(const initial of await myStates()){
      if(!pending(initial)||deferred.has(initial.key))continue;
      if(identity()?.key!==account)return;
      try{
        status('오프라인 변경을 동기화하는 중…');
        const book=await get('books',initial.key);if(!book)continue;
        const chapter=await json(`/api/series/chapter?chapterId=${book.chapterId}`,{account});
        if(revision(chapter)!==book.revision){status(`${book.title}: 서버의 책 파일이 변경되어 동기화를 보류했습니다. 변경을 내보낸 뒤 책을 다시 저장하세요.`);continue;}
        await syncProgress(initial.key,book,account,ask);
        await syncNotes(initial.key,book,account,ask);
      }catch(error){status(error.name==='AbortError'?'연결되지 않았습니다. 변경을 기기에 보관하고 다시 시도합니다.':error.message);return;}
    }
    const left=(await myStates()).filter(pending).length;
    status(left?`미동기화 책 ${left}권 · 동기화 버튼으로 다시 시도할 수 있습니다.`:'동기화 완료');
  });
}
async function syncProgress(key,book,account,ask){
  // Fetch again after a conflict choice: a third device may move during it.
  for(let tries=0;tries<4;tries++){
    const state=await get('states',key);if(!state?.dirty)return;
    const remote=await json(`/api/reader/get-progress?chapterId=${book.chapterId}`,{account});
    let allow=samePosition(remote,state.baseProgress)||samePosition(remote,state.progress);
    if(!allow){
      const choice=await ask({kind:'progress',title:book.title,local:state.progress,remote});
      if(choice==='remote'){
        await change(key,current=>{if(current.revision!==state.revision)return current;return {...current,progress:remote,baseProgress:remote,dirty:false,revision:current.revision+1,view:null};});return;
      }
      if(choice!=='local'){deferred.add(key);return;}
      await change(key,current=>({...current,baseProgress:remote}));continue;
    }
    if(!samePosition(remote,state.progress))await api('/api/reader/progress',{method:'POST',body:state.progress,account});
    // Use the submitted position as our acknowledgement; a subsequent remote
    // read might already belong to another device.
    await change(key,current=>({...current,baseProgress:state.progress,dirty:current.revision!==state.revision,view:current.view}));return;
  }
}
async function syncNotes(key,book,account,ask){
  let remote=await json(`/api/annotation/all?chapterId=${book.chapterId}`,{account});
  const ids=Object.keys((await get('states',key))?.drafts||{});
  for(const id of ids){
    if(identity()?.key!==account)return;
    const state=await get('states',key),draft=state.drafts[id];if(!draft)continue;
    let current=draft.op==='create'||draft.local.id<=0?remote.find(note=>createId(note)===id):remote.find(note=>note.id===draft.local.id);
    let outcome=current;
    if(draft.op==='create'){
      // The server persisted our opaque document marker even if a prior
      // create response was lost. Retry resolves to that same annotation.
      if(!current){
        const ready=await change(key,value=>{
          const latest=value.drafts[id];if(!latest||latest.rev!==draft.rev||latest.op!=='create')return value;
          return {...value,drafts:{...value.drafts,[id]:{...latest,attempt:latest.attempt||draft.local}}};
        });
        if(ready.drafts[id]?.rev!==draft.rev||ready.drafts[id]?.op!=='create')continue;
        outcome=await json('/api/annotation/create',{method:'POST',body:{...draft.local,id:0},account});
      }else if(editFields(current)!==editFields(draft.local)){
        if(!draft.attempt||editFields(current)!==editFields(draft.attempt)){
          const choice=await ask({kind:'note',title:book.title,local:draft.local,remote:current});
          if(choice==='remote'){await finishDraft(key,id,draft,current);continue;}
          if(choice!=='local'){deferred.add(key);continue;}
          const fresh=await json(`/api/annotation/${current.id}`,{account});if(editFields(fresh)!==editFields(current))continue;
        }
        outcome=await json('/api/annotation/update',{method:'POST',body:{...draft.local,id:current.id},account});
      }
    }else{
      if(draft.op==='delete'&&draft.local.id<=0&&!current)continue; // Unacknowledged create: retain its tombstone until confirmed.
      const identical=draft.op==='delete'?!current:current&&editFields(current)===editFields(draft.local);
      if(!identical){
        if(!current||editFields(current)!==editFields(draft.base)){
          const choice=await ask({kind:'note',title:book.title,local:draft.local,remote:current});
          if(choice==='remote'){await finishDraft(key,id,draft,current);continue;}
          if(choice!=='local'){deferred.add(key);continue;}
          // Never silently resurrect a deleted server annotation as an update.
          if(!current){continue;}
          const fresh=await json(`/api/annotation/${current.id}`,{account});
          if(editFields(fresh)!==editFields(current))continue;
        }
        if(draft.op==='delete'){await api(`/api/annotation?annotationId=${current.id}`,{method:'DELETE',account});outcome=null;}
        else outcome=await json('/api/annotation/update',{method:'POST',body:{...current,...draft.local},account});
      }else outcome=draft.op==='delete'?null:current;
    }
    if(draft.op==='create'&&outcome){
      // A browser/proxy can retry a POST internally after a connection reset.
      // Remove only identical copies carrying this operation's UUID; preserve
      // any copy somebody has subsequently edited.
      const copies=await json(`/api/annotation/all?chapterId=${book.chapterId}`,{account});
      for(const copy of copies)if(copy.id!==outcome.id&&createId(copy)===id&&copy.xPath===outcome.xPath&&copy.endingXPath===outcome.endingXPath&&copy.selectedText===outcome.selectedText&&editFields(copy)===editFields(outcome))
        await api(`/api/annotation?annotationId=${copy.id}`,{method:'DELETE',account});
    }
    await finishDraft(key,id,draft,outcome);
    if(outcome)remote=[...remote.filter(note=>note.id!==outcome.id),outcome];else remote=remote.filter(note=>note.id!==draft.local.id);
  }
  // Pull other devices' notes, retaining every locally edited draft.
  remote=await json(`/api/annotation/all?chapterId=${book.chapterId}`,{account});
  await change(key,current=>({...current,annotations:remote}));
}
async function finishDraft(key,id,sent,outcome){
  await change(key,current=>{
    const drafts={...current.drafts},latest=drafts[id];if(!latest)return current;
    let annotations=current.annotations.filter(note=>note.id!==(outcome?.id||sent.local.id));if(outcome)annotations.push(outcome);
    if(latest.rev===sent.rev)delete drafts[id];
    else if(outcome)drafts[id]={...latest,op:latest.op==='delete'?'delete':'update',base:outcome,local:{...latest.local,id:outcome.id}};
    return {...current,annotations,drafts};
  });
}
export async function chooseConflict(conflict){
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='kv-offline-conflict';dialog.setAttribute('role','dialog');
    dialog.style.cssText='max-width:min(460px,90vw);padding:24px;border:1px solid #888;border-radius:12px;background:#fff;color:#222';
    const message=document.createElement('p');message.textContent=conflict.kind==='progress'?`${conflict.title}: 서버와 기기에서 읽은 위치가 모두 변경되었습니다. 어느 위치를 사용할까요?`:`${conflict.title}: 서버에서도 이 메모가 변경되거나 삭제되었습니다. 어느 내용을 사용할까요?`;dialog.append(message);
    if(conflict.kind==='note'){
      for(const [name,note] of [['기기',conflict.local],['서버',conflict.remote]]){const p=document.createElement('p');p.textContent=`${name}: ${note?(note.commentPlainText||note.selectedText||'하이라이트'):'삭제됨'}`;dialog.append(p);}
    }
    const finish=choice=>{dialog.close();dialog.remove();resolve(choice);};
    const choices=[['서버 내용 사용','remote'],...(conflict.kind==='note'&&!conflict.remote?[]:[['기기 내용 사용','local']]),['나중에','cancel']];
    for(const [label,value] of choices){const button=document.createElement('button');button.type='button';button.textContent=label;button.style.cssText='margin:5px;padding:8px';button.onclick=()=>finish(value);dialog.append(button);}
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish('cancel');});
    (document.fullscreenElement||document.body).append(dialog);dialog.showModal();
  });
}
