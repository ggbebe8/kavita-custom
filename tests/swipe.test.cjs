const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const code = readFileSync('proxy/swipe.js', 'utf8');
function scenario(options = {}) {
  const handlers = {}, turns = []; let now = 1000, selection = '', menuOpen = !options.immersive; const toggles = [];
  const button = name => ({disabled: options.disabled, getClientRects: () => options.hidden ? [] : [1],
    querySelector: q => name === 'next' ? q === '.next-page-highlight' : q !== '.next-page-highlight', click: () => turns.push(name)});
  const next = button('next'), prev = button('prev');
  const content = {dispatchEvent: e => {if(e.type === 'click') {menuOpen = !menuOpen; toggles.push(menuOpen);}}};
  const root = {isConnected:true, classList:{add(){},remove(){}}, querySelector: q => {
    if(q === '.book-content') return content;
    if(q === '.book-container.immersive') return options.immersive;
    if(q === '.reader-header') return menuOpen;
    return q.includes('is-loading') ? options.loading : !options.scroll;
  }, querySelectorAll: () => menuOpen && !options.missingButtons ? [next,prev] : []};
  const target = {closest: q => q === 'app-book-reader' ? options.pdf ? null : root : q.includes('book-content') ? {} : options.input};
  const document = {dispatchEvent(){},querySelector:()=>null,createElement:()=>({setAttribute(){}}),head:{appendChild(){}},body:{appendChild(){}},activeElement: {matches: q => options.focus || (options.buttonFocus && q.includes('button'))}, querySelectorAll: q => q === 'app-book-reader' || q === 'app-epub-setting-drawer app-reader-settings' ? [] : options.popup || (options.savedHighlight && q.includes('app-epub-highlight')) ? [{getClientRects:()=>[1]}] : [],
    addEventListener: (type, fn) => (handlers[type] ??= []).push(fn)};
  const window = {addEventListener(){},__kavitaBookmarkAffordanceInstalled:true,__kavitaFullscreenButtonInstalled:true,__kavitaPageIndicatorInstalled:true,setInterval(){},getSelection: () => ({toString:()=>selection})};
  vm.runInNewContext(code, {MutationObserver:class{observe(){}},navigator:{userAgent:options.userAgent ?? 'Android'}, window,document, performance:{now:()=>now}, innerWidth:400,Event:class {constructor(type){this.type=type;}},MouseEvent:class {constructor(type){this.type=type;}},requestAnimationFrame: fn=>queueMicrotask(fn),getComputedStyle:()=>({visibility:'visible'})});
  const touch = (x,y=100,id=1) => ({clientX:x,clientY:y,identifier:id});
  const fire = (type,touches,changed=[]) => (handlers[type]??[]).forEach(f=>f({target,touches,changedTouches:changed,preventDefault(){},stopImmediatePropagation(){}}));
  const swipe = (x=280,end=150,y=100) => {fire('touchstart',[touch(x)]);now+=100;fire('touchmove',[touch(end,y)]);fire('touchend',[],[touch(end,y)]);};
  return {turns,toggles,swipe,fire,touch,select:()=>{selection='text';fire('selectionchange',[])},advance:()=>{now+=700}};
}
let s=scenario();s.swipe();assert.deepEqual(s.turns,['next']);s.swipe();assert.equal(s.turns.length,1);s.advance();s.swipe(120,260);assert.deepEqual(s.turns,['next','prev']);
for (const userAgent of ['Android', 'Windows', 'Ubuntu', '']) {s=scenario({userAgent});s.swipe();s.advance();s.swipe(120,260);assert.deepEqual(s.turns,['next','prev'],userAgent);}
s=scenario();s.fire('mousedown',[]);s.fire('mousemove',[]);s.fire('mouseup',[]);s.fire('keydown',[]);assert.equal(s.turns.length,0,'mouse and keyboard do not trigger swipe');
for (const option of ['buttonFocus','savedHighlight']) {s=scenario({[option]:true});s.swipe();assert.deepEqual(s.turns,['next'],option);}
for (const key of ['scroll','pdf','input','focus','popup','loading','disabled','hidden']) {s=scenario({[key]:true});s.swipe();assert.equal(s.turns.length,0,key);}
for (const args of [[20,150],[380,240],[200,150],[280,150,180]]) {s=scenario();s.swipe(...args);assert.equal(s.turns.length,0,JSON.stringify(args));}
s=scenario();s.fire('touchstart',[s.touch(280)]);s.fire('touchmove',[s.touch(250),s.touch(220,100,2)]);s.fire('touchend',[],[s.touch(150)]);assert.equal(s.turns.length,0);
s=scenario();s.fire('touchstart',[s.touch(280)]);s.select();s.fire('touchend',[],[s.touch(150)]);assert.equal(s.turns.length,0);
s=scenario();s.fire('touchstart',[s.touch(280)]);s.fire('touchcancel',[]);s.fire('touchend',[],[s.touch(150)]);assert.equal(s.turns.length,0);
(async () => {
  const settle = () => new Promise(resolve => setImmediate(resolve));
  for (const direction of ['next','prev']) {
    const immersive = scenario({immersive:true});
    immersive.swipe(...(direction === 'next' ? [280,150] : [120,260]));
    immersive.swipe(); // Cannot start another turn while waiting for menu rendering.
    await settle();
    assert.deepEqual(immersive.turns,[direction]);
    assert.deepEqual(immersive.toggles,[true,false]);
  }
  for (const option of ['disabled','missingButtons']) {
    const immersive = scenario({immersive:true,[option]:true});immersive.swipe();await settle();
    assert.deepEqual(immersive.turns,[]);assert.deepEqual(immersive.toggles,[true,false]);
  }
  const immersive = scenario({immersive:true});immersive.swipe();immersive.select();await settle();
  assert.deepEqual(immersive.turns,[]);
  console.log('Immersive menu restoration tests passed (mock DOM).');
})().catch(error => {console.error(error);process.exitCode=1;});
console.log('Swipe gesture and exclusion tests passed (mock DOM; no real device validation).');

s=scenario();s.fire('touchstart',[s.touch(280)]);s.advance();s.fire('touchmove',[s.touch(150)]);s.fire('touchend',[],[s.touch(150)]);assert.deepEqual(s.turns,['next'],'700ms swipe remains valid');
