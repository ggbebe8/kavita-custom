const http=require('node:http'),fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
// Native audio playback, server protocol mocked; private books are never used.
const samples=24000*4,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++)wav.writeInt16LE(Math.sin(i*.1)*1000,44+i*2);
let streams=0,created=0,stopped=0,pulses=[],createDelay=0;
const id='a'.repeat(43),server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let raw='';for await(const part of req)raw+=part;
 const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(url.pathname==='/kavita-pwa/server-tts.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(fs.readFileSync('proxy/pwa/server-tts.js'));return;}
 if(url.pathname==='/kavita-tts/v1/status')return json({available:true});
 if(url.pathname==='/kavita-tts/v1/sessions'&&req.method==='POST'){assert.equal(req.headers.authorization,'Bearer fixture');created++;await new Promise(r=>setTimeout(r,createDelay));return json({id,title:'Fixture',audio:`/kavita-tts/v1/sessions/${id}/audio.mp3`},201);}
 if(url.pathname.endsWith('/audio.mp3')){streams++;assert.ok(!url.search);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':wav.length});res.end(wav);return;}
 if(url.pathname===`/kavita-tts/v1/sessions/${id}`){
  if(req.method==='DELETE'){stopped++;return json({stopped:true});}
  if(req.method==='POST'){pulses.push(JSON.parse(raw));return json({ok:true});}
  return json({done:true,error:'',duration:4,chunks:Number(url.searchParams.get('after')||0)>0?[]:[{section:0,text:'첫 문장입니다.',offset:0,start:0,end:1.2},{section:1,text:'다음 장 문장입니다.',offset:0,start:1.2,end:4}]});
 }
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<style>.book-content{width:400px;height:250px}</style><app-book-reader><div class="reader-header"><button><i class="fa-clipboard-question"></i></button></div><div class="reader-container" style="width:400px"><div class="reading-section column-layout-1"><div class="book-content"><p>첫 문장입니다.</p></div></div></div><div class="bottom-bar"><a class="btn-link">Page</a></div></app-book-reader>`);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(()=>localStorage.setItem('kavita-user',JSON.stringify({id:1,token:'fixture'})));
  await page.addScriptTag({content:fs.readFileSync('proxy/swipe.js','utf8')});
  await page.evaluate(()=>{
   window.fixtureSection=0;window.__kavitaReaderSection=()=>({id:'1',index:fixtureSection,length:2});
   document.querySelector('.bottom-bar a').onclick=()=>{
    const modal=document.createElement('ngb-modal-window');modal.innerHTML='<app-confirm-dialog class="confirm-prompt"><input><div class="modal-footer"><button class="btn-primary">OK</button><button class="btn-secondary">Cancel</button></div></app-confirm-dialog>';
    modal.querySelector('.btn-primary').onclick=()=>{fixtureSection=Number(modal.querySelector('input').value)-1;document.querySelector('.book-content').innerHTML='<p>다음 장 문장입니다.</p>';modal.remove();};
    modal.querySelector('.btn-secondary').onclick=()=>modal.remove();document.body.append(modal);
   };
  });
  await page.locator('[data-kavita-tts]').click();await page.waitForFunction(()=>document.querySelector('[aria-label="읽기 방식"]').value==='server');
  await page.getByRole('button',{name:'재생',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('kavita-tts-panel')?.open);
  assert.equal(await page.locator('[data-kavita-tts-ctrl="pause"]').isVisible(),true,'top menu displays pause button');
  assert.equal(await page.locator('[data-kavita-tts-ctrl="stop"]').isVisible(),true,'top menu displays stop button');
  await page.waitForFunction(()=>CSS.highlights.has('kavita-server-tts-current'));
  assert.equal(await page.evaluate(()=>[...CSS.highlights.get('kavita-server-tts-current')][0].toString()),'첫 문장입니다.');
  await page.waitForFunction(()=>fixtureSection===1&&CSS.highlights.get('kavita-server-tts-current')&&[...CSS.highlights.get('kavita-server-tts-current')][0].toString()==='다음 장 문장입니다.');
  assert.equal(streams,1,'same native audio source continues across chapter changes');
  await page.locator('[data-kavita-tts-ctrl="pause"]').click();
  assert.equal(await page.locator('audio[data-kavita-server-tts]').evaluate(n=>n.paused),true,'header pause button pauses audio');
  await page.locator('[data-kavita-tts-ctrl="play"]').click();assert.equal(created,1,'resume does not create a new narration');
  await page.locator('[data-kavita-tts-ctrl="stop"]').click();await page.waitForTimeout(100);assert.ok(stopped,'header stop button stops playback');
  await page.waitForFunction(()=>!document.querySelector('app-book-reader')?.classList.contains('kavita-tts-active'));
  assert.equal(await page.locator('[data-kavita-tts-ctrl="stop"]').count(),0,'top menu controls removed on stop');
  assert.deepEqual(errors,[]);
  createDelay=1000;await page.locator('[data-kavita-tts]').click();await page.waitForFunction(()=>document.querySelector('[aria-label="읽기 방식"]')?.value==='server');
  await page.getByRole('button',{name:'재생',exact:true}).click();
  await page.locator('[data-kavita-tts-ctrl="pause"]').click();
  await page.waitForTimeout(1200);
  assert.equal(streams,1,'pausing while creation is pending prevents late playback');
  assert.equal(await page.locator('audio[data-kavita-server-tts]').evaluate(n=>n.paused&&!n.hasAttribute('src')),true);
  console.log('Server TTS native audio UI passed: sentence highlights, native chapter following, single audio stream, pause/resume, authenticated controls and stop. Android screen-off behavior requires device testing.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
