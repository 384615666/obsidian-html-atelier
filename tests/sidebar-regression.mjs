import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Current source + current CSS, independent of deployed vaults and old screenshots.
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/browser-entry.ts'],outfile:'test-results/sidebar-regression.js',bundle:true,platform:'browser',alias:{obsidian:resolve('tests/obsidian-mock.ts'),electron:resolve('tests/obsidian-mock.ts')}});
const css=await readFile('styles.css','utf8');
await writeFile('test-results/sidebar-regression.html',`<!doctype html><meta charset="utf-8"><style>
:root{--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e4e4e8;--text-muted:#73737b;--text-normal:#303036;--interactive-accent:#7756cd;--text-on-accent:#fff;--background-modifier-hover:#eae8ee;--font-ui-small:13px;--font-ui-smaller:12px;--font-ui-medium:14px;--text-warning:#9b6415;--text-error:#b33;--font-interface:system-ui;--font-monospace:monospace;--background-modifier-box-shadow:rgba(0,0,0,.1)}
body{margin:0;font:13px/1.5 system-ui}#shell{display:flex;height:760px}#preview{flex:1;min-width:0}#sidebar{width:285px;flex-shrink:0}
.status-bar{position:fixed;bottom:0;right:0;background:#eee;padding:5px;font-size:12px;height:18px;z-index:30}
${css}</style><div id="shell"><div id="preview"></div><div id="sidebar"></div></div><div class="status-bar">Obsidian status bar</div><script src="sidebar-regression.js"></script>`);
const browser=await chromium.launch({executablePath:process.env.HTML_ATELIER_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const page=await browser.newPage({viewport:{width:1200,height:760}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const fixture='<h1 id="main">Main</h1><h2 id="first">First</h2><h2>Duplicate</h2><h2>Duplicate</h2>'+Array.from({length:12},(_,i)=>`<p>Search item ${i}</p>`).join('');
async function load(path,source){await page.evaluate(async({path,source})=>{const h=window.harness,f=new window.TFileCtor(path);h.files.set(path,source);h.main.view.file=f;await h.main.view.onLoadFile(f);h.emit('active-leaf-change',h.main);},{path,source});}
async function settings(language,size){await page.evaluate(({language,size})=>{const p=window.harness.plugin;p.applySettings({...p.settings,ui:{...p.settings.ui,language}});for(const [name,delta] of [['small',0],['smaller',-1],['medium',1]])document.documentElement.style.setProperty('--font-ui-'+name,`${size+delta}px`);},{language,size});}
try{
 await page.goto(pathToFileURL(resolve('test-results/sidebar-regression.html')).href);await page.waitForFunction(()=>window.ready);
 await load('demo/sidebar-a.html',fixture);
 // D2/D3: two languages, both sides of the container breakpoint, larger UI text.
 let layouts=0;
 for(const language of ['zh-CN','en'])for(const size of [13,17]){
  await settings(language,size);
  for(const width of [220,250,260,280,285,290,300,310,360]){
   await page.locator('#sidebar').evaluate((el,w)=>el.style.width=w+'px',width);
   const result=await page.evaluate(()=>{
    const p=document.querySelector('.html-atelier-panel');
    const labels=[...p.querySelectorAll('.html-atelier-tablabel,.html-atelier-mode-label')];
    return {overflow:p.scrollWidth>p.clientWidth+1,labels:labels.map(el=>{const r=el.getBoundingClientRect(),b=el.closest('button'),br=b.getBoundingClientRect();return{contained:r.left>=br.left-1&&r.right<=br.right+1,ellipsis:getComputedStyle(el).textOverflow==='ellipsis',title:b.title,aria:b.getAttribute('aria-label')};}),font:parseFloat(getComputedStyle(p.querySelector('.html-atelier-tabs button')).fontSize)};
   });
   assert.equal(result.overflow,false,JSON.stringify({language,size,width,result}));
   assert.equal(result.font,size-1);
   for(const label of result.labels){assert.ok(label.contained&&label.ellipsis&&label.title&&label.aria,JSON.stringify({width,label}));}
   layouts++;
  }
 }
 // D1: actual wheel interaction reaches Save, without scrollIntoView/scrollTop rescue.
 await page.locator('.html-atelier-replacetoggle').click();
 await page.locator('input[type=search]').fill('Search');await page.waitForTimeout(250);
 let heights=0;
 for(const size of [13,17]){
  await settings('en',size);
  for(const width of [220,285,360])for(const height of [300,330,400,500,760]){
   await page.locator('#sidebar').evaluate((el,w)=>el.style.width=w+'px',width);
   await page.evaluate(h=>{document.querySelector('#shell').style.height=h+'px';document.querySelector('.html-atelier-panel').scrollTop=0;},height);
   const box=await page.locator('.html-atelier-panel').boundingBox();
   await page.mouse.move(box.x+18,box.y+20);
   for(let i=0;i<6;i++){await page.mouse.wheel(0,450);await page.waitForTimeout(35);}
   const visible=await page.evaluate(()=>{const p=document.querySelector('.html-atelier-panel'),b=p.querySelector('.html-atelier-savebtn'),r=b.getBoundingClientRect(),pr=p.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=pr.top&&r.bottom<=pr.bottom&&b.contains(hit);});
   assert.ok(visible,`Save unreachable at width=${width},height=${height},font=${size}`);heights++;
  }
 }
 await page.locator('.html-atelier-panel').screenshot({path:'test-results/sidebar-fixed-large-font.png'});
 // D4: refresh, tab switches, same-revision files, stable ID edits and ambiguity.
 await page.evaluate(()=>{document.querySelector('#shell').style.height='760px';document.querySelector('.html-atelier-panel').scrollTop=0;});
 await page.locator('input[type=search]').fill('');await page.waitForTimeout(200);
 await settings('zh-CN',13);
 await page.evaluate(()=>{const p=window.harness.plugin.app.workspace.getLeavesOfType('html-atelier-panel')[0].view;p.setTab('outline');});
 await page.locator('.html-atelier-outlinerow').nth(1).click();
 await page.evaluate(()=>{const p=window.harness.plugin.app.workspace.getLeavesOfType('html-atelier-panel')[0].view;p.contentEl.querySelector('details').open=true;p.refresh(true);p.setTab('edit');p.setTab('outline');});
 assert.equal(await page.locator('details').evaluate(el=>el.open),true);
 assert.match(await page.locator('[aria-current="location"]').innerText(),/First/);
 await load('demo/sidebar-b.html',fixture);assert.equal(await page.locator('details').evaluate(el=>el.open),false);assert.equal(await page.locator('[aria-current="location"]').count(),0);
 await load('demo/sidebar-a.html',fixture);assert.equal(await page.locator('details').evaluate(el=>el.open),true);assert.equal(await page.locator('[aria-current="location"]').count(),1);
 await page.evaluate(()=>{const h=window.harness;h.main.view.session.workingSource=h.main.view.session.workingSource.replace('First','Renamed');h.plugin.app.workspace.getLeavesOfType('html-atelier-panel')[0].view.refresh(true);});
 assert.match(await page.locator('[aria-current="location"]').innerText(),/Renamed/);
 await page.locator('.html-atelier-outlinerow').nth(2).click();
 await page.evaluate(()=>{const h=window.harness;h.main.view.session.workingSource+=' ';h.plugin.app.workspace.getLeavesOfType('html-atelier-panel')[0].view.refresh(true);});
 assert.equal(await page.locator('[aria-current="location"]').count(),0,'Ambiguous duplicate heading must not be guessed');
 // D5: visual and accessible static labels both hot-switch.
 await settings('en',13);
 for(const [i,name] of ['Undo','Redo'].entries()){
  const b=page.locator('.html-atelier-statusactions button').nth(i);assert.equal(await b.getAttribute('aria-label'),name);assert.equal(await b.getAttribute('title'),name);
 }
 assert.equal(await page.locator('input[type=search]').getAttribute('aria-label'),'Search text');
 assert.deepEqual(errors,[]);
 console.log(`Sidebar regressions passed: ${layouts} width/language/font layouts, ${heights} wheel-reachability cases, per-file outline state, ambiguous selection, hot relabel.`);
}finally{await browser.close();}
