const {chromium}=require('playwright');const {readFileSync}=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const calls=[];window.ttsCalls=calls;
  const mock=new EventTarget();mock.getVoices=()=>[{name:'Korean fixture',lang:'ko-KR',voiceURI:'ko',localService:true}];
  mock.cancel=()=>calls.push('cancel');mock.speak=item=>{calls.push({text:item.text,rate:item.rate,lang:item.lang});window.lastUtterance=item;};mock.pause=()=>{mock.paused=true;calls.push('pause');};mock.resume=()=>{mock.paused=false;calls.push('resume');};
  Object.defineProperty(window,'speechSynthesis',{value:mock});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 });
 await page.route('http://tts.test/**',route=>route.fulfill({contentType:'text/html',body:'<style>.book-content{height:300px;width:400px;overflow:hidden}</style><app-book-reader><div class="reader-header"><button><i class="fa-clipboard-question"></i></button></div><div class="book-content"><style>.test{color:red}</style><p>안녕하세요. 본문 읽기 테스트입니다. '+('다음 문장을 계속 읽습니다. '.repeat(50))+'</p><button>읽으면 안 되는 버튼</button></div></app-book-reader>'}));
 await page.goto('http://tts.test/');await page.addScriptTag({content:readFileSync('proxy/swipe.js','utf8')});
 await page.locator('[data-kavita-tts]').click();await page.getByRole('slider',{name:'읽기 속도'}).fill('1.4');await page.getByRole('combobox').selectOption('ko');
 await page.getByRole('button',{name:'재생',exact:true}).click();
 let calls=await page.evaluate(()=>ttsCalls.filter(c=>typeof c==='object'));assert.equal(calls.length,1);assert.equal(calls[0].rate,1.4);assert.equal(calls[0].lang,'ko-KR');assert.ok(!calls[0].text.includes('읽으면 안 되는 버튼'));
 await page.getByRole('button',{name:'일시정지',exact:true}).click();assert.equal(await page.evaluate(()=>speechSynthesis.paused),true);
 await page.getByRole('button',{name:'재생',exact:true}).click();assert.equal(await page.evaluate(()=>speechSynthesis.paused),false);
 await page.evaluate(()=>lastUtterance.onend());assert.equal(await page.evaluate(()=>ttsCalls.filter(c=>typeof c==='object').length),2,'chunks continue sequentially');
 await page.getByRole('button',{name:'닫기',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0,'panel closes without stopping audio');
 await page.evaluate(()=>document.dispatchEvent(new Event('kavita-page-navigation')));assert.equal(await page.evaluate(()=>ttsCalls.at(-1)),'cancel');
 await page.locator('[data-kavita-tts]').click();assert.equal(await page.getByRole('slider').inputValue(),'1.4');await page.getByRole('button',{name:'재생',exact:true}).click();
 await page.evaluate(()=>{window.oldUtterance=lastUtterance;document.querySelector('app-book-reader').remove();});await page.waitForTimeout(100);const count=await page.evaluate(()=>ttsCalls.length);await page.evaluate(()=>oldUtterance.onend());assert.equal(await page.evaluate(()=>ttsCalls.length),count,'stale callbacks cannot restart after reader exit');
 assert.deepEqual(errors,[]);console.log('Browser TTS UI passed with mocked speech engine: voices/rate, text filtering, chunk sequencing, pause/resume, close, navigation/exit cancellation. Real device audio was not tested.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
