const {chromium} = require('playwright');
const {readFileSync} = require('node:fs');
const assert = require('node:assert/strict');
const source = readFileSync('proxy/swipe.js','utf8');
const script = source.slice(source.indexOf('// Fullscreen toggle'),source.indexOf('// Whole EPUB screen pagination.'));
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const header='<div class="reader-header"><div><button id="shortcuts"><i class="fa-clipboard-question"></i></button></div></div>';
    await page.setContent(`<app-book-reader>${header}</app-book-reader>`);
    await page.addScriptTag({content:script});
    const button=page.locator('[data-kavita-fullscreen]');
    assert.equal(await button.count(),1);
    assert.equal(await page.evaluate(()=>document.querySelector('#shortcuts').previousElementSibling.hasAttribute('data-kavita-fullscreen')),true);
    await button.click();await page.waitForFunction(()=>!!document.fullscreenElement);
    assert.equal(await button.getAttribute('aria-pressed'),'true');assert.equal(await button.getAttribute('aria-label'),'전체화면 종료');
    await button.click();await page.waitForFunction(()=>!document.fullscreenElement && document.querySelector('[data-kavita-fullscreen]').getAttribute('aria-pressed')==='false');
    assert.equal(await button.getAttribute('aria-pressed'),'false');
    await button.click();await page.waitForFunction(()=>!!document.fullscreenElement);
    await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>document.querySelector('[data-kavita-fullscreen]').getAttribute('aria-pressed')==='false');
    await page.evaluate(header=>{document.querySelector('app-book-reader').innerHTML=header;},header);
    await button.waitFor();assert.equal(await button.count(),1);
    await page.evaluate(()=>{document.documentElement.requestFullscreen=()=>Promise.reject(new Error('Denied'));});
    await button.click();await page.waitForFunction(()=>document.querySelector('[data-kavita-fullscreen]').title.includes('시작할 수 없습니다'));
    assert.equal(await button.isEnabled(),true);assert.deepEqual(errors,[]);
    console.log('Fullscreen Chromium tests passed: placement, native enter/exit, external exit state, SPA menu recreation, no duplicates, rejected request handling.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
