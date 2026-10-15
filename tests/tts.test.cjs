const {chromium}=require('playwright');const {readFileSync}=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const calls=[];window.ttsCalls=calls;
  const mock=new EventTarget();mock.getVoices=()=>[{name:'Korean fixture',lang:'ko-KR',voiceURI:'ko',localService:true}];
  mock.cancel=()=>calls.push('cancel');mock.speak=item=>{calls.push({text:item.text,rate:item.rate,lang:item.lang});window.lastUtterance=item;};mock.pause=()=>{mock.paused=true;calls.push('pause');};mock.resume=()=>{mock.paused=false;calls.push('resume');};
  Object.defineProperty(window,'speechSynthesis',{value:mock});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 });
 await page.route('http://tts.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<style>.book-content{height:300px;width:400px;overflow:hidden}</style><app-book-reader><div class="reader-header"><button><i class="fa-clipboard-question"></i></button></div><div class="book-content"><style>.test{color:red}</style><p>안녕하세요. 본문 읽기 테스트입니다. '+('다음 문장을 계속 읽습니다. '.repeat(50))+'</p><button>읽으면 안 되는 버튼</button></div></app-book-reader>'}));
 await page.goto('http://tts.test/');await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
 await page.locator('[data-kavita-tts]').click();await page.getByRole('slider',{name:'읽기 속도'}).fill('1.4');await page.getByRole('combobox',{name:'읽기 음성',exact:true}).selectOption('ko');
 await page.getByRole('button',{name:'재생',exact:true}).click();
 let calls=await page.evaluate(()=>ttsCalls.filter(c=>typeof c==='object'));assert.equal(calls.length,1);assert.equal(calls[0].rate,1.4);assert.equal(calls[0].lang,'ko-KR');assert.ok(!calls[0].text.includes('읽으면 안 되는 버튼'));
 await page.getByRole('button',{name:'일시정지',exact:true}).click();assert.equal(await page.evaluate(()=>speechSynthesis.paused),true);
 await page.getByRole('button',{name:'재생',exact:true}).click();assert.equal(await page.evaluate(()=>speechSynthesis.paused),false);
 await page.evaluate(()=>lastUtterance.onend());await page.waitForFunction(()=>ttsCalls.filter(c=>typeof c==='object').length===2);
 await page.getByRole('button',{name:'닫기',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0,'panel closes without stopping audio');
 await page.evaluate(()=>document.dispatchEvent(new Event('kavita-page-navigation')));assert.equal(await page.evaluate(()=>ttsCalls.at(-1)),'cancel');
 await page.locator('[data-kavita-tts]').click();assert.equal(await page.getByRole('slider').inputValue(),'1.4');await page.getByRole('button',{name:'재생',exact:true}).click();
 await page.evaluate(()=>{window.oldUtterance=lastUtterance;document.querySelector('app-book-reader').remove();});await page.waitForTimeout(100);const count=await page.evaluate(()=>ttsCalls.length);await page.evaluate(()=>oldUtterance.onend());assert.equal(await page.evaluate(()=>ttsCalls.length),count,'stale callbacks cannot restart after reader exit');
 await page.goto('http://tts.test/');await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
 await page.evaluate(()=>{
  const root=document.querySelector('app-book-reader'),content=root.querySelector('.book-content');
  const reader=document.createElement('div');reader.className='reader-container';reader.style.width='400px';
  const section=document.createElement('div');section.className='reading-section column-layout-1';root.append(reader);reader.append(section);section.append(content);
  content.style.cssText='width:400px;height:80px;max-height:80px;column-count:1;column-gap:20px;font:16px/20px sans-serif;overflow:hidden';
  content.innerHTML='<p>'+('자동 페이지와 하이라이트 테스트 문장입니다. '.repeat(300))+'</p>';
 });
 await page.locator('[data-kavita-tts]').click();await page.getByRole('button',{name:'재생',exact:true}).click();await page.getByRole('button',{name:'닫기',exact:true}).click();
 await page.waitForFunction(()=>!!CSS.highlights.get('kavita-tts-current'));
 const pausesBefore=await page.evaluate(()=>ttsCalls.filter(c=>c==='pause').length);
 for(let i=0;i<15&&(await page.evaluate(()=>document.querySelector('.book-content').scrollLeft))===0;i++){
  const previous=await page.evaluate(()=>ttsCalls.filter(c=>typeof c==='object').length);
  await page.evaluate(()=>lastUtterance.onend());await page.waitForFunction(n=>ttsCalls.filter(c=>typeof c==='object').length>n,previous);
 }
 assert.ok(await page.evaluate(()=>document.querySelector('.book-content').scrollLeft>0),'speech automatically follows into later screen pages');
 assert.equal(await page.evaluate(()=>ttsCalls.filter(c=>c==='pause').length),pausesBefore,'automatic page following must never pause the speech engine');
 const continued=await page.evaluate(()=>ttsCalls.filter(c=>typeof c==='object').length);
 await page.evaluate(()=>lastUtterance.onend());await page.waitForFunction(n=>ttsCalls.filter(c=>typeof c==='object').length>n,continued);
 await page.evaluate(()=>lastUtterance.onboundary({charIndex:5,charLength:3}));await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>[...CSS.highlights.get('kavita-tts-current')][0].toString().trim()),'자동 페이지와 하이라이트 테스트 문장입니다.','word boundaries keep only the current sentence highlighted');
 await page.evaluate(()=>{const content=document.querySelector('.book-content');content.scrollLeft=0;content.dispatchEvent(new Event('scroll',{bubbles:true}));});
 assert.equal(await page.evaluate(()=>CSS.highlights.has('kavita-tts-current')),false,'manual navigation clears speech highlight');
 await page.goto('http://tts.test/');await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
 await page.evaluate(()=>{
  const root=document.querySelector('app-book-reader'),content=root.querySelector('.book-content');
  const reader=document.createElement('div');reader.className='reader-container';reader.style.width='45px';
  const section=document.createElement('div');section.className='reading-section column-layout-1';root.append(reader);reader.append(section);section.append(content);
  content.style.cssText='width:45px;height:24px;max-height:24px;column-count:1;column-gap:20px;font:20px/24px sans-serif;word-break:break-all;overflow:hidden';
  content.textContent='안녕하세요.';
 });
 await page.locator('[data-kavita-tts]').click();await page.getByRole('button',{name:'재생',exact:true}).click();await page.getByRole('button',{name:'닫기',exact:true}).click();
 await page.waitForFunction(()=>ttsCalls.some(c=>typeof c==='object'));
 assert.equal(await page.evaluate(()=>lastUtterance.text),'안녕하세요.','a word crossing rendered pages remains a single utterance');
 const wholeSentenceCalls=await page.evaluate(()=>ttsCalls.filter(c=>typeof c==='object').length);
 await page.evaluate(()=>lastUtterance.onboundary({charIndex:3,charLength:1}));
 await page.waitForFunction(()=>document.querySelector('.book-content').scrollLeft>0);
 assert.equal(await page.evaluate(()=>ttsCalls.filter(c=>typeof c==='object').length),wholeSentenceCalls,'screen follows without restarting speech');
 assert.equal(await page.evaluate(()=>ttsCalls.includes('pause')),false,'page transition never pauses the engine');
 await page.evaluate(()=>lastUtterance.onend());await page.waitForFunction(()=>!CSS.highlights.has('kavita-tts-current'));
 await page.goto('http://tts.test/');await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
 await page.route('**/api/book/1/book-info',route=>route.fulfill({json:{pages:3}}));
 await page.route('**/api/book/1/book-page?*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:new URL(route.request().url()).searchParams.get('page')==='0'?'<p>첫 번째 장입니다.</p>':new URL(route.request().url()).searchParams.get('page')==='1'?'<div aria-hidden="true">이미지 구간</div>':'<p>두 번째 장을 이어 읽습니다.</p>'}));
 await page.evaluate(async()=>{
  const root=document.querySelector('app-book-reader'),content=root.querySelector('.book-content');
  const reader=document.createElement('div');reader.className='reader-container';reader.style.width='400px';
  const section=document.createElement('div');section.className='reading-section column-layout-1';root.append(reader);reader.append(section);section.append(content);
  content.style.cssText='width:400px;height:200px;max-height:200px;column-count:1;column-gap:20px;overflow:hidden';
  const bar=document.createElement('div');bar.className='bottom-bar';bar.innerHTML='<button><i class="next-page-highlight"></i></button>';root.append(bar);
  window.sectionTurns=0;bar.querySelector('button').addEventListener('click',async()=>{
   window.sectionTurns++;section.classList.add('is-loading');
   const html=await fetch('/api/book/1/book-page?page='+window.sectionTurns).then(r=>r.text());
   await new Promise(r=>setTimeout(r,100));content.innerHTML=html;content.scrollLeft=0;section.classList.remove('is-loading');
  });
  await fetch('/api/book/1/book-info').then(r=>r.json());content.innerHTML=await fetch('/api/book/1/book-page?page=0').then(r=>r.text());
 });
 await page.locator('[data-kavita-tts]').click();await page.getByRole('button',{name:'재생',exact:true}).click();
 await page.waitForFunction(()=>lastUtterance?.text==='첫 번째 장입니다.');await page.evaluate(()=>lastUtterance.onend());
 await page.waitForFunction(()=>lastUtterance?.text==='두 번째 장을 이어 읽습니다.');
 assert.equal(await page.evaluate(()=>sectionTurns),2,'native sections advance exactly once each and empty sections are skipped');
 assert.equal(await page.locator('dialog[open]').count(),0,'settings panel does not block automatic transition');
 await page.evaluate(()=>lastUtterance.onend());await page.waitForFunction(()=>!CSS.highlights.has('kavita-tts-current'));
 assert.equal(await page.evaluate(()=>sectionTurns),2,'book end does not wrap or open a different book');
 assert.deepEqual(errors,[]);console.log('Browser TTS UI passed with mocked speech engine: voices/rate, text filtering, chunk sequencing, pause/resume, close, navigation/exit cancellation, automatic screen following, current sentence highlight, next-section continuation, empty-section skipping and book-end cleanup. Real device audio was not tested.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
