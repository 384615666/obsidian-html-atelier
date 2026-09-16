import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
await mkdir('test-results',{recursive:true});
await build({entryPoints:['tests/browser-entry.ts'],outfile:'test-results/harness.js',bundle:true,platform:'browser',alias:{obsidian:resolve('tests/obsidian-mock.ts'),electron:resolve('tests/obsidian-mock.ts')}});
const css=await readFile('styles.css','utf8');
// 假状态栏:照抄宿主 .status-bar 的真实规则(position:fixed 贴窗口右下角、宽度只等于
// 自身内容、z-index 高于侧栏),否则"面板底部被压住"这类缺陷在门禁里根本看不见
await writeFile('test-results/harness.html',`<!doctype html><html><head><meta charset="utf-8"><style>:root{--background-primary:#fff;--background-secondary:#f6f6f6;--background-modifier-border:#e4e4e8;--text-muted:#73737b;--text-normal:#303036;--interactive-accent:#7756cd;--interactive-accent-hover:#6849bd;--text-on-accent:#fff;--background-modifier-hover:#eae8ee;--font-ui-small:13px;--font-ui-smaller:12px;--text-warning:#9b6415;--text-error:#b33;--font-interface:system-ui;--font-monospace:monospace;--background-modifier-box-shadow:rgba(0,0,0,.1);--size-4-1:4px;--size-4-2:8px;--size-2-2:4px;--radius-m:8px;--radius-s:4px;--divider-color:#e4e4e8;--layer-status-bar:30;--status-bar-font-size:var(--font-ui-smaller);--status-bar-position:fixed;--status-bar-radius:var(--radius-m) 0 0 0;--status-bar-border-width:1px 0 0 1px;--status-bar-background:var(--background-secondary);--status-bar-text-color:var(--text-muted)}body{margin:0;background:#eee;font:13px/1.5 system-ui}#shell{display:flex;height:780px;max-width:1120px;margin:20px auto;border:1px solid #ddd;border-radius:8px;overflow:hidden;background:#fff}#preview{flex:1;min-width:0}#sidebar{width:285px;flex-shrink:0;border-left:1px solid #ddd}.status-bar{position:var(--status-bar-position);width:auto;bottom:0;right:0;border-radius:var(--status-bar-radius);border-style:solid;border-width:var(--status-bar-border-width);border-color:var(--divider-color);background-color:var(--status-bar-background);color:var(--status-bar-text-color);display:flex;font-size:var(--status-bar-font-size);justify-content:flex-end;min-height:18px;padding:var(--size-4-1);gap:var(--size-4-1);z-index:var(--layer-status-bar)}.status-bar-item{border-radius:var(--radius-s);display:inline-flex;align-items:center;padding:3px var(--size-2-2);line-height:1}${css}</style></head><body><div id="shell"><div id="preview"></div><div id="sidebar"></div></div><div class="status-bar"><span class="status-bar-item">0 条反向链接</span><span class="status-bar-item">同步完成</span></div><script src="harness.js"></script></body></html>`);
const browser=await chromium.launch({executablePath:process.env.HTML_ATELIER_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:840}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR:',e.stack?e.stack.split(String.fromCharCode(10)).slice(0,4).join(' | '):e.message);});
 await page.goto('file:///'+resolve('test-results/harness.html').split('\\').join('/'));await page.waitForFunction(()=>window.ready);
 const frame=page.frameLocator('iframe');
 await frame.locator('h1').waitFor();
 // F01/F18:侧栏自动打开;预览隔离:页面脚本未执行
 assert.ok(await page.evaluate(()=>window.sidebarReveals>0));assert.equal(await page.evaluate(()=>window.unwantedScriptRan),undefined);
 // 新 UI 冒烟:工具栏模式按钮与侧栏标签存在
 assert.ok(await page.getByRole('button',{name:'编辑',exact:true}).count()>=1);
 assert.ok(await page.getByRole('button',{name:'源码',exact:true}).count()>=1);
 assert.ok(await page.getByText('大纲',{exact:true}).count()>0);
 // 工具栏承载位置(editor.toolbarPlacement,默认 sidebar):主视图只剩页面内容,
 // 导航/模式/视口控件落在右侧栏面板顶部
 const tbSidebar=await page.evaluate(()=>({
  inView:!!document.querySelector('.html-atelier-view .html-atelier-toolbar'),
  inPanel:!!document.querySelector('.html-atelier-panel .html-atelier-toolbar'),
  labels:[...document.querySelectorAll('.html-atelier-panel .html-atelier-toolbar button')].map(b=>b.getAttribute('aria-label')),
 }));
 assert.equal(tbSidebar.inView,false,'默认(侧栏)时主视图不应再有工具栏: '+JSON.stringify(tbSidebar));
 assert.equal(tbSidebar.inPanel,true,'默认(侧栏)时右侧栏面板应承载工具栏');
 assert.deepEqual(tbSidebar.labels,['后退','前进','预览','编辑','源码','分栏','刷新预览','宽度','缩放','更多'],'侧栏工具栏按钮不全: '+JSON.stringify(tbSidebar.labels));
 // 设置改回"视图内":工具栏回到文件视图,面板不再有(设置必须真的生效)
 const tbView=await page.evaluate(()=>{const p=window.harness.plugin;p.applySettings({...p.settings,editor:{...p.settings.editor,toolbarPlacement:'view'}});
  return {inView:!!document.querySelector('.html-atelier-view .html-atelier-toolbar'),inPanel:!!document.querySelector('.html-atelier-panel .html-atelier-toolbar')};});
 assert.deepEqual(tbView,{inView:true,inPanel:false},'切到 view 后工具栏位置不对: '+JSON.stringify(tbView));
 await page.evaluate(()=>{const p=window.harness.plugin;p.applySettings({...p.settings,editor:{...p.settings.editor,toolbarPlacement:'sidebar'}});});
 const tbBackSide=await page.evaluate(()=>({inView:!!document.querySelector('.html-atelier-view .html-atelier-toolbar'),inPanel:!!document.querySelector('.html-atelier-panel .html-atelier-toolbar')}));
 assert.deepEqual(tbBackSide,{inView:false,inPanel:true},'切回 sidebar 后工具栏位置不对: '+JSON.stringify(tbBackSide));

 // 侧栏内部换页签(其它侧栏叶子获得焦点)不得关掉我们的面板:用户仍开着 HTML 文件,
 // 此前会被当成"离开 HTML"而 detach 面板,页签凭空消失(用户反馈 2026-09-15)。
 // 桩按宿主真实形状建模:侧栏叶子的 view.containerEl 在 .mod-sidedock 内
 // (WorkspaceSidedock 构造函数加的类),且**没有** getRoot().getType() ——
 // 宿主根本没有这个 API,上一版就是因为桩里提供了臆想的 API 才"通过"了。
 const otherTab=await page.evaluate(async()=>{
  const h=window.harness;
  const el=document.createElement('div');el.className='workspace-split mod-sidedock mod-right-split';
  document.getElementById('sidebar').append(el);
  const leaf={app:h.plugin.app,el,parent:{parent:{collapsed:false}},
   view:{getViewType:()=>'outline',containerEl:el}};
  h.leaves.push(leaf);
  h.emit('active-leaf-change',leaf);
  await new Promise(r=>setTimeout(r,150));
  const out={panelLeaves:h.plugin.sidebar.panelLeaves().length,
   dom:!!document.querySelector('.html-atelier-panel')};
  h.emit('active-leaf-change',h.main);   // 还原桩状态,后面的检查继续针对 HTML 视图
  return out;
 });
 assert.equal(otherTab.panelLeaves,1,'切换其它侧栏页签后我们的面板叶子被关掉了: '+JSON.stringify(otherTab));
 assert.equal(otherTab.dom,true,'切换其它侧栏页签后面板 DOM 消失: '+JSON.stringify(otherTab));

 // 分栏:两栏都必须有实际宽度。预览容器带着 applyViewport 写的行内 width(auto 预设=100%),
 // 若它的 flex-basis 是 auto 就会吃满整行、源码栏被压成 0 —— 分栏看起来与预览无异
 // (实测 1080 的容器里预览 1079 / 源码 1px;用户反馈"点分栏没效果" 2026-09-15)
 const splitLayout=await page.evaluate(async()=>{
  const v=window.harness.main.view;
  v.setMode('split');
  await new Promise(r=>setTimeout(r,400));
  const w=(el)=>el?Math.round(el.getBoundingClientRect().width):-1;
  const out={preview:w(v.iframeWrap),source:w(v.sourceHost),
   main:w(v.contentEl.querySelector('.html-atelier-main')),
   cmWidth:v.sourceEditor?.view?Math.round(v.sourceEditor.view.dom.getBoundingClientRect().width):null};
  v.setMode('preview');
  await new Promise(r=>setTimeout(r,150));
  return out;
 });
 assert.ok(splitLayout.source>120&&splitLayout.preview>120,
  '分栏模式把某一栏压没了: '+JSON.stringify(splitLayout));
 assert.ok(splitLayout.cmWidth===null||splitLayout.cmWidth>100,
  '分栏模式下源码编辑器没有宽度: '+JSON.stringify(splitLayout));
 // 编辑模式:点击标题 → 文字内容表单 → 修改即时同步
 await page.getByRole('button',{name:'编辑',exact:true}).first().click();
 const title=frame.locator('h1');await title.click({position:{x:30,y:25}});
 const input=page.getByRole('textbox',{name:'文字内容'});await input.waitFor();
 await input.fill('给每一个好想法，');
 await title.filter({hasText:'给每一个好想法，'}).waitFor();
 // F26/F11:恢复此项(回到最近保存基准)
 await page.getByRole('button',{name:'恢复此项',exact:true}).click();assert.equal(await input.inputValue(),'给好想法，');
 // F12:撤销
 await page.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await input.inputValue(),'给每一个好想法，');
 // 逐字键入(不是 fill):表单不得被重建,否则焦点/插入点/输入法全被打断
 // —— 用户反馈"只输入了一个拼音就被定住,只进去一个字母"
 await page.evaluate(()=>{const ta=document.querySelector('.html-atelier-panel textarea');
  window.__ta=ta;ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);});
 await page.keyboard.type('ABC');
 await page.waitForTimeout(120);
 const typed=await page.evaluate(()=>({
  value:document.querySelector('.html-atelier-panel textarea')?.value,
  sameNode:document.querySelector('.html-atelier-panel textarea')===window.__ta,
  focused:document.activeElement===window.__ta,
  work:window.harness.plugin.sessions.get('demo/studio.html').workingSource,
 }));
 assert.equal(typed.sameNode,true,'逐字键入期间表单被重建(会打断输入法): '+JSON.stringify({sameNode:typed.sameNode}));
 assert.equal(typed.focused,true,'逐字键入后输入框失去焦点: '+JSON.stringify({focused:typed.focused}));
 assert.equal(typed.value,'给每一个好想法，ABC','键入内容不完整: '+JSON.stringify({value:typed.value}));
 assert.ok(typed.work.includes('给每一个好想法，ABC'),'键入内容未精确写入文档(可能复制/残留): '+(typed.work.match(/<h1>.{0,40}/)||[''])[0]);
 // 输入法组合期:拼音字母不得被当成正文提交(同一 bug 的另一半)
 const cdp=await page.context().newCDPSession(page);
 await page.bringToFront();
 await page.evaluate(()=>{const ta=document.querySelector('.html-atelier-panel textarea');
  window.__ta=ta;ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);});
 const beforeCompose=await page.evaluate(()=>window.harness.plugin.sessions.get('demo/studio.html').workingSource);
 await cdp.send('Input.imeSetComposition',{text:'wo',selectionStart:2,selectionEnd:2});
 await page.waitForTimeout(120);
 const composing=await page.evaluate(()=>({
  work:window.harness.plugin.sessions.get('demo/studio.html').workingSource,
  sameNode:document.querySelector('.html-atelier-panel textarea')===window.__ta,
  focused:document.activeElement===window.__ta,
 }));
 assert.equal(composing.work,beforeCompose,'输入法组合中的拼音被写进了文档');
 assert.ok(composing.sameNode&&composing.focused,'组合期间输入框被重建/失焦: '+JSON.stringify({sameNode:composing.sameNode,focused:composing.focused}));
 await cdp.send('Input.insertText',{text:'我'});
 await page.waitForTimeout(200);
 const ime=await page.evaluate(()=>window.harness.plugin.sessions.get('demo/studio.html').workingSource);
 assert.ok(ime.includes('我'),'确认后的中文没有写进文档');
 assert.ok(!ime.includes('wo'),'文档里残留了拼音字母: '+(ime.match(/.{0,24}wo.{0,8}/)||[''])[0]);
 await page.screenshot({path:'test-results/editor.png',fullPage:true});
 // 保存:F12 保留历史、草稿清理、基准前移
 await page.locator('.html-atelier-statusbar').getByRole('button',{name:'保存',exact:true}).click();
 await page.getByText('无未保存更改',{exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>window.harness.files.get('demo/studio.html').includes('给每一个好想法，')));
 assert.equal(await page.evaluate(()=>window.harness.plugin.sessions.get('demo/studio.html').controller.undoDepth>=1),true);
 // 保存后再编辑(产生草稿),随后外部变化 → 冲突
 await frame.locator('p').click();await input.fill('修改后的段落');
 // 外部变化 → 冲突;另存草稿(另存为模态);重开会话恢复冲突;使用磁盘版本解除
 await page.evaluate(()=>{const {files,file,emit}=window.harness;files.set(file.path,files.get(file.path).replace('STUDIO / 26','STUDIO / 27'));emit('modify',file);});
 await page.getByText('存在外部冲突',{exact:false}).first().waitFor();
 await page.evaluate(async()=>{const p=window.harness.plugin;const s=p.sessions.get('demo/studio.html');return p.drafts.flush(s);});
 await page.getByRole('button',{name:'另存草稿',exact:true}).click();
 await page.getByRole('button',{name:'保存副本',exact:true}).click();
 await page.waitForFunction(()=>window.harness.files.size===2);
 const draftFile=[...await page.evaluate(()=>[...window.savedDraftFiles.keys()])].find(k=>k.endsWith('.json')&&!k.endsWith('.tmp'));
 assert.ok(draftFile,'草稿 v2 记录应已落盘(DraftStore)');
 // 关闭并重开会话:草稿恢复 + 冲突标记
 await page.evaluate(async()=>{const {plugin,file}=window.harness;plugin.sessions.clear();const view=window.harness.main.view;await view.onLoadFile(file);});
 assert.equal(await page.evaluate(()=>window.harness.plugin.sessions.get('demo/studio.html').contentState),'conflict');
 await page.getByRole('button',{name:'使用磁盘版本(放弃草稿)',exact:true}).click();
 await page.getByText('无未保存更改',{exact:true}).waitFor();
 // file-open 事件重新打开侧栏;普通刷新不展开
 const before=await page.evaluate(()=>window.sidebarReveals);await page.evaluate(()=>window.harness.plugin.refreshPanels());assert.equal(await page.evaluate(()=>window.sidebarReveals),before);
 await page.evaluate(()=>window.harness.emit('file-open',window.harness.file));await page.waitForFunction(b=>window.sidebarReveals>b,before);
 // 多视图共享同一会话
 const shared=await page.evaluate(async()=>{const {plugin,file}=window.harness;plugin.sessions.clear();const [a,b]=await Promise.all([plugin.getSession(file),plugin.getSession(file)]);return a===b;});assert.equal(shared,true);
 // 220px 窄侧栏不横向溢出(§13.3)
 await page.locator('#sidebar').evaluate(el=>el.style.width='220px');await page.waitForTimeout(200);
 const overflow=await page.evaluate(()=>[...document.querySelectorAll('#sidebar, #sidebar *')].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>({cls:String(el.className).slice(0,40),sw:el.scrollWidth,cw:el.clientWidth})));
 assert.equal(await page.locator('#sidebar').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'220px 溢出: '+JSON.stringify(overflow));
 // 图片属性写入:缺 alt 时必须插入 alt,而不是写出第二个 src(round4 缺陷 18)
 await page.evaluate(async()=>{const h=window.harness;const f=new window.TFileCtor('demo/pic.html');
  h.files.set(f.path,'<html><head></head><body><p>图</p><img src="photo.png" width="80" height="40"></body></html>');
  h.main.view.file=f;await h.main.view.onLoadFile(f);});
 await page.getByRole('button',{name:'编辑',exact:true}).first().click();
 await frame.locator('img').click();
 const altBox=page.getByRole('textbox',{name:'替代文本(alt)'});await altBox.waitFor();await altBox.fill('described');await altBox.press('Tab'); // change 事件在失焦时触发
 await page.waitForFunction(()=>{const s=window.harness.plugin.sessions.get('demo/pic.html');return !!s&&s.workingSource.includes('alt="described"');});
 // 属性类改动(alt)落不到任何文字节点:编辑模式下点修改清单「定位」必须退到
 // 分栏滚源码,不能毫无反馈(2026-09-16 回归护栏)
 await page.locator('.html-atelier-panel .html-atelier-tabs button',{hasText:'修改'}).click();
 await page.getByRole('button',{name:'定位',exact:true}).first().click();
 await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>window.harness.main.view.mode),'split',
  '属性类改动的定位在编辑模式下应退到分栏让源码可见');
 await page.evaluate(async()=>{const v=window.harness.main.view;v.setMode('edit');await new Promise(r=>setTimeout(r,150));});
 const imgSrc2=await page.evaluate(()=>window.harness.plugin.sessions.get('demo/pic.html').workingSource);
 assert.equal(imgSrc2.split('src=').length-1,1,'alt 写入不应产生重复 src: '+imgSrc2);
 assert.ok(/<img[^>]*alt="described"[^>]*src="photo.png"/.test(imgSrc2),'alt 与 src 应各一份: '+imgSrc2);
 // 面板底部状态行不得被宿主的固定状态栏压住(宿主状态栏 position:fixed 贴窗口右下角、
 // 宽度只等于自身内容、层级高于侧栏,所以右侧栏视图最底下一条天生会被它盖住)
 const barOverlap=await page.evaluate(()=>{
  const bar=document.querySelector('.status-bar');
  const panelBar=document.querySelector('.html-atelier-panel .html-atelier-statusbar');
  const save=document.querySelector('.html-atelier-panel .html-atelier-savebtn');
  const rect=(el)=>el.getBoundingClientRect();
  return {overlap:Math.round(rect(panelBar).bottom-rect(bar).top),
   saveBottom:Math.round(rect(save).bottom),barTop:Math.round(rect(bar).top),
   pad:getComputedStyle(document.querySelector('.html-atelier-panel')).paddingBottom};
 });
 assert.ok(barOverlap.overlap<=0,'面板状态行被宿主状态栏压住: '+JSON.stringify(barOverlap));
 assert.ok(barOverlap.saveBottom<=barOverlap.barTop,'「保存」按钮被宿主状态栏压住: '+JSON.stringify(barOverlap));

 // F10 大纲点击必须把**预览**滚到目标:库里 HTML 的标题大多没有 id,此前无 id 的标题
 // 会落到 locateInSource(切到源码/分栏),预览一动不动 —— 用户看到的就是"点了没反应"
 // (用户反馈 2026-09-14)。这里用一个够长的文档,确保"没滚"与"滚到底"不会混淆。
 await page.evaluate(async()=>{const h=window.harness;const f=new window.TFileCtor('demo/outline.html');
  const p=(c)=>`<p>${c.repeat(600)}</p>`;
  h.files.set(f.path,`<!doctype html><html><head><style>body{margin:0}h2{margin:40px 0}p{margin:0 0 60px}</style></head><body><h1 id="top">第一</h1><p><a href="#s3">跳到第三节</a></p>${p('甲')}<h2>第二 没有 id</h2>${p('乙')}<h2 id="s3">第三 有 id</h2>${p('丙')}</body></html>`);
  h.main.view.file=f;await h.main.view.onLoadFile(f);});
 await page.waitForFunction(()=>{const v=window.harness.main.view;return !!v.iframe?.contentDocument?.documentElement&&v.textNodes.size>=4;});
 await page.locator('.html-atelier-panel .html-atelier-tabs button',{hasText:'大纲'}).click();
 const outlineJump=await page.evaluate(async(kind)=>{
  const v=window.harness.main.view;const w=v.iframe.contentWindow;w.scrollTo(0,0);
  const lists=[...document.querySelectorAll('.html-atelier-panel .html-atelier-outline .html-atelier-list')];
  const pick=kind==='heading'?lists[0].children[1]:lists[1].children[2]; // 无 id 的标题 / 靠后的文案行
  pick.click();
  await new Promise(r=>setTimeout(r,300));
  return {y:Math.round(w.scrollY),mode:v.mode,innerH:w.innerHeight};
 },'heading');
 assert.ok(outlineJump.y>0,'点无 id 的大纲标题应把预览滚到目标: '+JSON.stringify(outlineJump));
 assert.notEqual(outlineJump.mode,'split','不应因为没有 id 就切到源码/分栏: '+JSON.stringify(outlineJump));
 const textJump=await page.evaluate(async()=>{
  const v=window.harness.main.view;const w=v.iframe.contentWindow;w.scrollTo(0,0);
  const lists=[...document.querySelectorAll('.html-atelier-panel .html-atelier-outline .html-atelier-list')];
  lists[1].children[4].click();
  await new Promise(r=>setTimeout(r,300));
  return {y:Math.round(w.scrollY)};
 });
 assert.ok(textJump.y>0,'点文案列表也应把预览滚到目标: '+JSON.stringify(textJump));
 await page.locator('.html-atelier-panel .html-atelier-tabs button',{hasText:'编辑'}).click();

 // 链接点击的职责分工(用户 2026-09-15 确认的期望行为,别再"顺手修"反):
 //   编辑/分栏模式 = 点文字选中该文字(包括链接文字),不跳转;
 //   预览模式     = 链接负责跳转。
 const clickLink=async(mode)=>{
  await page.evaluate(async(m)=>{
   const v=window.harness.main.view;const w=v.iframe.contentWindow;
   v.setMode(m);
   await new Promise(r=>setTimeout(r,150));
   w.scrollTo(0,0);
   return null;
  },mode);
  return page.evaluate(async()=>{
   const v=window.harness.main.view;const w=v.iframe.contentWindow;
   const a=w.document.querySelector('a[href="#s3"]');
   const r=a.getBoundingClientRect();
   a.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true,
    clientX:Math.round(r.left+4),clientY:Math.round(r.top+4)}));
   await new Promise(r2=>setTimeout(r2,350));
   const dest=w.document.getElementById('s3');const dr=dest.getBoundingClientRect();
   return {mode:v.mode,y:Math.round(w.scrollY),top:Math.round(dr.top),innerH:w.innerHeight,
    anchor:v.currentAnchor,selectedKind:v.selected?.kind??null};
  });
 };
 const editClick=await clickLink('edit');
 assert.equal(editClick.selectedKind,'text','编辑模式点链接文字应选中该文字: '+JSON.stringify(editClick));
 assert.ok(editClick.top>=editClick.innerH,'编辑模式点链接不应跳转(设计如此): '+JSON.stringify(editClick));
 const previewClick=await clickLink('preview');
 assert.ok(previewClick.y>0&&previewClick.top>=0&&previewClick.top<previewClick.innerH,
  '预览模式点锚点链接必须跳转: '+JSON.stringify(previewClick));
 assert.equal(previewClick.anchor,'#s3','预览模式跳转后锚点未记录: '+JSON.stringify(previewClick));

 // 修改清单「定位」不得强切分栏(用户反馈 2026-09-16):编辑模式下点定位,模式必须
 // 保持编辑、预览滚到目标;源码模式下才切分栏(预览侧高亮需要预览可见,与
 // prepareLocate 同策略)。同批反馈:整段表单的「文字片段」按钮此前是死按钮
 // (setTab('edit') 同键早退,段落表单本来就在编辑标签上),必须真的退出整段
 // 模式、回到该段落第一个片段的片段表单。
 await page.evaluate(async()=>{const v=window.harness.main.view;v.setMode('edit');await new Promise(r=>setTimeout(r,150));});
 await frame.locator('h1').click({position:{x:12,y:12}});
 const outlineText=page.getByRole('textbox',{name:'文字内容'});await outlineText.waitFor();
 await outlineText.fill('第一(已改)');
 await page.locator('.html-atelier-panel .html-atelier-tabs button',{hasText:'修改'}).click();
 await page.getByRole('button',{name:'定位',exact:true}).first().click();
 await page.waitForTimeout(250);
 const locateInEdit=await page.evaluate(()=>window.harness.main.view.mode);
 assert.equal(locateInEdit,'edit','编辑模式下修改清单定位被强切到了别的模式: '+locateInEdit);
 await page.evaluate(async()=>{const v=window.harness.main.view;v.setMode('source');await new Promise(r=>setTimeout(r,200));});
 await page.getByRole('button',{name:'定位',exact:true}).first().click();
 await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>window.harness.main.view.mode),'split',
  '源码模式下修改清单定位应切到分栏(预览高亮需要预览可见)');
 await page.evaluate(async()=>{const v=window.harness.main.view;v.setMode('edit');await new Promise(r=>setTimeout(r,150));});
 await page.locator('.html-atelier-panel .html-atelier-tabs button',{hasText:'编辑'}).click();
 await page.getByRole('button',{name:'整段编辑',exact:true}).click();
 await page.getByRole('textbox',{name:'整段编辑'}).waitFor();
 await page.getByRole('button',{name:'文字片段',exact:true}).click();
 await page.getByRole('textbox',{name:'文字内容'}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'整段编辑'}).count(),0,
  '「文字片段」点击后仍停留在整段表单(死按钮未修)');
 // 清空一个片段(文字节点消失,后续段落 id 全部前移):修改清单必须只显示一条
 // "删除",不得出现幻影条目 —— 段 id 是顺序流水号,跨"基准/工作稿"解析不稳定,
 // 按 id 配对会把后面每段都算成"已修改"(用户实测 2026-09-16)
 await page.locator('.html-atelier-panel .html-atelier-tabs button',{hasText:'编辑'}).click();
 await frame.locator('h1').click({position:{x:12,y:12}});
 const clearBox=page.getByRole('textbox',{name:'文字内容'});await clearBox.waitFor();
 await clearBox.fill('');
 await page.locator('.html-atelier-panel .html-atelier-tabs button',{hasText:'修改'}).click();
 await page.waitForTimeout(250);
 const changeRows=await page.evaluate(()=>[...document.querySelectorAll('.html-atelier-change')].map(r=>r.textContent?.replace(/\s+/g,' ').slice(0,60)??''));
 assert.equal(changeRows.length,1,'清空一个片段后修改清单出现幻影条目: '+JSON.stringify(changeRows));
 assert.ok(changeRows[0].includes('删除'),'清空片段应显示为删除: '+JSON.stringify(changeRows));
 // 删除项的定位:base 侧 id 不得拿去工作稿里查(会撞上错位后的其它片段)→ 必须降级分栏滚源码
 await page.getByRole('button',{name:'定位',exact:true}).first().click();
 await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>window.harness.main.view.mode),'split','删除项定位应降级到分栏');
 await page.evaluate(async()=>{const v=window.harness.main.view;v.setMode('edit');await new Promise(r=>setTimeout(r,150));});
 await page.locator('.html-atelier-panel .html-atelier-tabs button',{hasText:'编辑'}).click();
 await page.locator('.html-atelier-statusbar').getByRole('button',{name:'撤销',exact:true}).click();
 await page.waitForTimeout(200);

 // 面板排版:标签滑动指示块必须停在选中项下方(动效的核心机制 —— 标签数一变就会错位),
 // 且切标签要真的挂上入场动画
 const tabPill=await page.evaluate(async()=>{
  const tabs=document.querySelector('.html-atelier-panel .html-atelier-tabs');
  [...tabs.querySelectorAll('button')][2].click();
  await new Promise(r=>setTimeout(r,420));
  // 点击会重建标签按钮,必须重新取节点(旧节点已脱离文档,rect 恒为 0)
  const btns=[...tabs.querySelectorAll('button')];
  const pill=getComputedStyle(tabs,'::before');
  const m=new DOMMatrixReadOnly(pill.transform==='none'?'':pill.transform);
  const out={active:btns.filter(b=>b.classList.contains('html-atelier-active')).length,
   pillLeft:Math.round(tabs.getBoundingClientRect().left+2+m.m41),
   wantLeft:Math.round(btns[2].getBoundingClientRect().left),
   anim:getComputedStyle(document.querySelector('.html-atelier-panel .html-atelier-panelcontent')).animationName};
  btns[0].click();
  return out;
 });
 assert.equal(tabPill.active,1,'同一时刻只能有一个标签选中: '+JSON.stringify(tabPill));
 assert.ok(Math.abs(tabPill.pillLeft-tabPill.wantLeft)<=2,'标签指示块未对齐选中项: '+JSON.stringify(tabPill));
 assert.equal(tabPill.anim,'html-atelier-pane-in','切标签应有入场动效: '+JSON.stringify(tabPill));

 // 回到原文件,后面的检查继续针对它
 await page.evaluate(async()=>{const h=window.harness;const f=new window.TFileCtor('demo/studio.html');h.main.view.file=f;await h.main.view.onLoadFile(f);});

 // 手动收起记忆:收起时抑制;但用户**自己重新展开**侧栏后必须解除,
 // 否则回到 HTML 文件面板永不自动出现(用户实测 2026-09-14)
 const sb=await page.evaluate(async()=>{
  const h=window.harness;const ws=h.plugin.app.workspace;const p=h.plugin;
  const tick=()=>new Promise(r=>setTimeout(r,60));
  ws.rightSplit={collapsed:false};h.emit('layout-change');await tick();
  const r0=window.sidebarReveals;
  ws.rightSplit={collapsed:true};h.emit('layout-change'); // 用户收起(面板还在)
  const sup1=p.sidebar.isSuppressed();
  h.emit('active-leaf-change',h.main);await tick();       // 抑制期间回到 HTML
  const r1=window.sidebarReveals;
  ws.rightSplit={collapsed:false};h.emit('layout-change'); // 用户自己重新展开
  const sup2=p.sidebar.isSuppressed();
  h.emit('active-leaf-change',h.main);await tick();
  const r2=window.sidebarReveals;
  ws.rightSplit={collapsed:false};
  return {sup1,sup2,r0,r1,r2};
 });
 assert.equal(sb.sup1,true,'收起时应记录抑制: '+JSON.stringify(sb));
 assert.equal(sb.r1,sb.r0,'抑制期间回到 HTML 不得自动展开');
 assert.equal(sb.sup2,false,'用户重新展开侧栏后抑制必须解除');
 assert.equal(sb.r2,sb.r1+1,'解除后回到 HTML 应重新展开面板');

 // 设置必须真的生效(round4 缺陷 38/33/42)
 // 1) 解析 revision 门禁:currentIndex 必须把解析结果登记到当前 revision(BUG 42)
 const gate=await page.evaluate(()=>{const v=window.harness.main.view,s=v.session;
  const before=s.canUseVisualEdits();const i1=v.currentIndex();const after=s.canUseVisualEdits();
  window.__i1=i1;return {before,after,cached:v.currentIndex()===i1};});
 assert.equal(gate.before,false,'未登记解析结果时不应开放可视化编辑: '+JSON.stringify(gate));
 assert.equal(gate.after,true,'currentIndex 未把解析结果登记到当前 revision');
 assert.equal(gate.cached,true,'同一 revision 内应复用解析结果');
 // 2) editor.showChangeHighlights:开启时页面上出现 Range 级高亮,关闭后清除
 await page.getByRole('button',{name:'编辑',exact:true}).first().click();
 const h1=frame.locator('h1');await h1.click({position:{x:30,y:25}});
 const box=page.getByRole('textbox',{name:'文字内容'});await box.waitFor();await box.fill('高亮测试标题');
 await page.waitForFunction(()=>!!window.harness.main.view.iframe?.contentDocument?.querySelector('style[data-atelier-change]'));
 const gate2=await page.evaluate(()=>{const v=window.harness.main.view,s=v.session;
  const stale=s.canUseVisualEdits();const fresh=v.currentIndex();
  return {stale,updated:s.canUseVisualEdits(),parsed:s.parsedRevision,rev:s.revision,newIndex:fresh!==window.__i1};});
 assert.equal(gate2.stale,false,'编辑后旧解析结果必须失效: '+JSON.stringify(gate2));
 assert.equal(gate2.updated,true,'重新解析后应恢复开放');
 assert.equal(gate2.parsed,gate2.rev,'revision 变化后未重新登记解析结果');
 assert.equal(gate2.newIndex,true,'revision 变化后仍复用旧解析结果');
 const hlOn=await page.evaluate(()=>{const v=window.harness.main.view;const w=v.iframe.contentWindow;const set=w.CSS?.highlights?.get?.('html-atelier-changed');return {count:set?set.size:-1,style:!!v.iframe.contentDocument.querySelector('style[data-atelier-change]')};});
 assert.ok(hlOn.count>0,'showChangeHighlights 开启时未注册高亮: '+JSON.stringify(hlOn));
 await page.evaluate(()=>{const p=window.harness.plugin;p.applySettings({...p.settings,editor:{...p.settings.editor,showChangeHighlights:false}});});
 const hlOff=await page.evaluate(()=>{const v=window.harness.main.view;const w=v.iframe.contentWindow;const set=w.CSS?.highlights?.get?.('html-atelier-changed');return {count:set?set.size:-1,style:!!v.iframe.contentDocument.querySelector('style[data-atelier-change]')};});
 assert.equal(hlOff.count<=0,true,'关闭后仍留有高亮: '+JSON.stringify(hlOff));
 assert.equal(hlOff.style,false,'关闭后仍留有高亮样式');
 // 3) ui.language 热切:不重载插件即生效,且可切回(缺陷 33)
 const toEn=await page.evaluate(()=>{const p=window.harness.plugin;p.applySettings({...p.settings,ui:{language:'en'}});return {save:p.t('tbSave'),aria:document.querySelector('.html-atelier-toolbar button')?.getAttribute('aria-label')??''};});
 assert.equal(toEn.save,'Save','ui.language 切换为 en 未立即生效: '+JSON.stringify(toEn));
 const toZh=await page.evaluate(()=>{const p=window.harness.plugin;p.applySettings({...p.settings,ui:{language:'zh-CN'}});return p.t('tbSave');});
 assert.equal(toZh,'保存','切回 zh-CN 未生效');
 // 设置页传进来的是它自己那份**可变副本**。applySettings 必须快照,不能存引用:
 // 存引用后 prev===next,所有 *Changed 判定恒为 false → 改第二项设置不再生效
 // (语言选了英文界面不变、开关拨了预览不重绘;用户反馈设置页问题时暴露 2026-09-15)
 const twice=await page.evaluate(()=>{
  const p=window.harness.plugin;
  const draft=JSON.parse(JSON.stringify(p.settings));
  draft.ui.language='en';p.applySettings(draft);
  const afterFirst=p.t('tbSave');
  draft.ui.language='zh-CN';p.applySettings(draft);   // 同一个对象引用,再改一次
  const afterSecond=p.t('tbSave');
  p.applySettings({...p.settings,ui:{language:'zh-CN'}});
  return {afterFirst,afterSecond};
 });
 assert.equal(twice.afterFirst,'Save','第一次改动应生效: '+JSON.stringify(twice));
 assert.equal(twice.afterSecond,'保存','同一个设置对象第二次改动没有被检测到(applySettings 存了引用): '+JSON.stringify(twice));
 // 4) 死键清除:preview.defaultHeight 已从设置 schema 与设置页移除
 const deadKeys=await page.evaluate(()=>{const p=window.harness.plugin;const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  return {schema:has(p.settings.preview,'defaultHeight')};});
 assert.equal(deadKeys.schema,false,'preview.defaultHeight 仍在 schema 中');
 assert.deepEqual(errors,[]);
 console.log('Browser checks passed: sidebar opening, isolated preview, modes UI, selection, live editing, restore, undo, save, external conflict, save-as draft, v2 draft recovery, adopt-remote, shared sessions, narrow sidebar, settings-actually-work (revision gate, change highlights, language hot-switch, dead key removed).');
}finally{await browser.close();}
