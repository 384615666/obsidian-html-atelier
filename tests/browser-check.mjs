import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/browser-entry.ts'],outfile:'test-results/harness.js',bundle:true,platform:'browser',alias:{obsidian:resolve('tests/obsidian-mock.ts')}});
const css=await readFile('styles.css','utf8');
await writeFile('test-results/harness.html',`<!doctype html><html><head><meta charset="utf-8"><style>:root{--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e4e4e8;--text-muted:#73737b;--text-normal:#303036;--interactive-accent:#7756cd;--interactive-accent-hover:#6849bd;--text-on-accent:#fff;--background-modifier-hover:#eae8ee;--font-ui-small:13px;--font-ui-smaller:12px;--text-warning:#9b6415}body{margin:0;background:#eee;font:13px/1.5 system-ui}#shell{display:flex;height:780px;max-width:1120px;margin:20px auto;border:1px solid #ddd;border-radius:8px;overflow:hidden;background:#fff}#preview{flex:1;min-width:0}#sidebar{width:285px;flex-shrink:0;border-left:1px solid #ddd}${css}</style></head><body><div id="shell"><div id="preview"></div><div id="sidebar"></div></div><script src="harness.js"></script></body></html>`);
const browser=await chromium.launch({executablePath:process.env.HTML_ATELIER_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1200,height:840}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file:///'+resolve('test-results/harness.html').replaceAll('\\','/'));await page.waitForFunction(()=>window.ready);
 const frame=page.frameLocator('iframe');await frame.locator('h1').waitFor();
 assert.ok(await page.evaluate(()=>window.sidebarReveals>0));assert.equal(await page.evaluate(()=>window.unwantedScriptRan),undefined);
 assert.equal(await page.locator('#preview button').count(),0);await page.getByRole('button',{name:'编辑文案',exact:true}).click();
 const title=frame.locator('h1');await title.click({position:{x:30,y:25}});const input=page.getByRole('textbox',{name:'文字内容'});await input.fill('给每一个好想法，');await title.filter({hasText:'给每一个好想法，'}).waitFor();
 await page.getByRole('button',{name:'恢复当前文案到最近一次保存',exact:true}).click();assert.equal(await input.inputValue(),'给好想法，');
 await page.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await input.inputValue(),'给每一个好想法，');
 await page.screenshot({path:'test-results/editor.png',fullPage:true});
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByText('无未保存更改',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>window.harness.files.get('demo/studio.html').includes('给每一个好想法，')));
 await frame.locator('p').click();await input.fill('修改后的段落');await page.evaluate(()=>{const {files,file,emit}=window.harness;files.set(file.path,files.get(file.path).replace('STUDIO / 26','STUDIO / 27'));emit('modify',file);});
 await page.getByText('原文件变化 · 草稿保留',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'保存',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'另存草稿',exact:true}).click();assert.equal(await page.evaluate(()=>window.harness.files.size),2);
 const draft=await page.evaluate(()=>window.savedPluginData.drafts['demo/studio.html']);assert.ok(draft.changes.some(([,text])=>text==='修改后的段落'));
 // Closing and reopening recovers the pending draft rather than overwriting it.
 await page.evaluate(async()=>{const h=window.harness;await h.main.view.onUnloadFile(h.file);h.plugin.sessions.clear();await h.main.view.onLoadFile(h.file);});
 assert.equal(await page.evaluate(()=>window.harness.main.view.session.conflict),true);
 assert.ok(await page.evaluate(()=>[...window.harness.main.view.session.changes.values()].includes('修改后的段落')));
 await page.getByRole('button',{name:'重新载入原文件',exact:true}).click();await page.getByRole('button',{name:'放弃修改并载入',exact:true}).click();await page.getByText('无未保存更改',{exact:true}).waitFor();
 // A file-open event on the same leaf reopens the sidebar; ordinary refresh does not.
 const before=await page.evaluate(()=>window.sidebarReveals);await page.evaluate(()=>window.harness.plugin.refresh());assert.equal(await page.evaluate(()=>window.sidebarReveals),before);
 await page.evaluate(()=>window.harness.emit('file-open',window.harness.file));await page.waitForFunction(b=>window.sidebarReveals>b,before);
 const shared=await page.evaluate(async()=>{const h=window.harness;h.plugin.sessions.clear();const [a,b]=await Promise.all([h.plugin.getSession(h.file),h.plugin.getSession(h.file)]);return a===b;});assert.equal(shared,true);
 await page.locator('#sidebar').evaluate(el=>el.style.width='220px');assert.equal(await page.locator('#sidebar').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 assert.deepEqual(errors,[]);console.log('Browser checks passed: sidebar opening, isolated preview, selection, live editing, restore, undo, save, external conflict, draft export/recovery, reload, shared sessions, narrow sidebar.');
} finally {await browser.close();}
