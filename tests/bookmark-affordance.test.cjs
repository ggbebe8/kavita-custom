const {chromium}=require('playwright');
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const source=readFileSync('proxy/swipe.js','utf8');
const script=source.slice(source.indexOf('// Empty image bookmark glyphs'),source.indexOf('// Fullscreen toggle'));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<style>.kavita-scale-width-container{position:relative;width:220px;height:240px}.bookmark-overlay{position:absolute;right:0;bottom:0;width:24px;height:24px}</style><app-book-reader><div class="book-content"><p id="text">Book text</p><div class="kavita-scale-width-container"><img id="image" width="200" height="220" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="><div id="empty" class="bookmark-overlay fa-regular fa-bookmark" title="Add bookmark">☆</div></div><div id="saved" class="bookmark-overlay fa-solid fa-bookmark">★</div><i id="ptoc-1" class="fa-solid fa-bookmark">Saved text bookmark</i></div></app-book-reader>');
  await page.evaluate(()=>{window.bookmarkWrites=0;document.querySelector('#empty').addEventListener('click',()=>{window.bookmarkWrites++;document.querySelector('#empty').className='bookmark-overlay fa-solid fa-bookmark';});});
  await page.addScriptTag({content:script});
  assert.equal(await page.locator('#empty').isVisible(),false);
  assert.equal(await page.locator('#saved').isVisible(),true);
  assert.equal(await page.locator('#ptoc-1').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.bookmarkWrites),0);
  await page.locator('#image').click();assert.equal(await page.locator('#empty').isVisible(),true);
  assert.equal(await page.evaluate(()=>window.bookmarkWrites),0,'Revealing a control must not create a bookmark');
  await page.evaluate(()=>document.dispatchEvent(new Event('kavita-page-navigation')));assert.equal(await page.locator('#empty').isVisible(),false);
  await page.locator('#image').click();await page.locator('#text').click();assert.equal(await page.locator('#empty').isVisible(),false);
  await page.locator('#image').click();await page.locator('#empty').focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>window.bookmarkWrites),1);assert.equal(await page.locator('#empty').isVisible(),true,'An actual saved marker stays visible');
  assert.equal(await page.locator('#text').textContent(),'Book text');assert.deepEqual(errors,[]);
  console.log('Bookmark affordance tests passed: hide unsaved add controls, preserve image/text saved markers, explicit image tap, no implicit bookmark writes, clear on navigation, keyboard activation.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
