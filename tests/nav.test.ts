import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NavigationService,NavEntry} from '../src/services/nav';

// F06 导航栈契约。AC10 的根因是"遍历造成的加载"被当成普通导航压栈:
// 后退后重新压入同一路径,会把前进分支截断到只剩两项,forward() 随即返回 null。

const entry=(path:string,scrollRatio=0):NavEntry=>({path,anchor:'',scrollRatio,zoom:100,width:'auto'});

test('A10 普通导航压栈:压入新路径会截断前进分支',()=>{
 const nav=new NavigationService();const owner={};
 nav.push(owner,entry('a.html'));
 nav.push(owner,entry('b.html'));
 nav.push(owner,entry('c.html'));
 nav.back(owner);                     // index → b
 assert.equal(nav.canForward(owner),true);
 nav.push(owner,entry('d.html'));     // 从 b 处开辟新分支
 assert.equal(nav.canForward(owner),false);
 assert.equal(nav.back(owner)?.path,'b.html');
 assert.equal(nav.back(owner)?.path,'a.html');
 assert.equal(nav.back(owner),null);
});

test('A10 遍历加载走 alignToPath:前进分支完整保留(AC10 回归)',()=>{
 const nav=new NavigationService();const owner={};
 nav.push(owner,entry('report.html'));
 nav.push(owner,entry('media.html'));
 nav.push(owner,entry('refs.html'));
 const back=nav.back(owner);          // 后退到 media.html
 assert.equal(back?.path,'media.html');
 // 视图在遍历加载完成后调用 alignToPath,而不是 push
 nav.alignToPath(owner,'media.html');
 assert.equal(nav.canForward(owner),true);
 const fwd=nav.forward(owner);
 assert.equal(fwd?.path,'refs.html','前进必须能回到被离开的那一项');
 nav.alignToPath(owner,'refs.html');
 assert.equal(nav.canForward(owner),false);
});

test('A10 连续后退再前进可回到最深处',()=>{
 const nav=new NavigationService();const owner={};
 for(const p of ['a.html','b.html','c.html','d.html'])nav.push(owner,entry(p));
 assert.equal(nav.back(owner)?.path,'c.html');
 nav.alignToPath(owner,'c.html');
 assert.equal(nav.back(owner)?.path,'b.html');
 nav.alignToPath(owner,'b.html');
 assert.equal(nav.forward(owner)?.path,'c.html');
 nav.alignToPath(owner,'c.html');
 assert.equal(nav.forward(owner)?.path,'d.html');
});

test('A10 同一路径多次入栈时,遍历对齐取最近的一项(AC10 回归)',()=>{
 const nav=new NavigationService();const owner={};
 // 真实序列:a → media → a → b(再次回到 a 会新增一项,不合并)
 for(const p of ['a.html','media.html','a.html','b.html'])nav.push(owner,entry(p));
 const st=nav.stackFor(owner);
 assert.equal(st.index,3);
 nav.back(owner);                       // 期望回到最近的 a(index 2)
 nav.alignToPath(owner,'a.html');
 assert.equal(st.index,2,'对齐必须命中最近的 a,而不是最早那次访问');
 assert.equal(nav.canForward(owner),true);
 assert.equal(nav.forward(owner)?.path,'b.html');
 nav.alignToPath(owner,'b.html');
 assert.equal(st.index,3);
 nav.back(owner);
 nav.alignToPath(owner,'a.html');
 assert.equal(st.index,2);
 nav.back(owner);                       // 再退一步到 media
 nav.alignToPath(owner,'media.html');
 assert.equal(st.index,1);
 assert.equal(nav.forward(owner)?.path,'a.html');
});

test('A10 对齐不会把索引挪到远处(只改必要的一步)',()=>{
 const nav=new NavigationService();const owner={};
 for(const p of ['a.html','b.html','c.html'])nav.push(owner,entry(p));
 nav.back(owner);                       // index 1
 nav.alignToPath(owner,'a.html');       // 目标在 index 0
 assert.equal(nav.stackFor(owner).index,0);
 assert.equal(nav.canForward(owner),true);
 assert.equal(nav.forward(owner)?.path,'b.html');
});

test('A10 同一文件的连续状态变化(模式/视口)更新栈顶而非新增',()=>{
 const nav=new NavigationService();const owner={};
 nav.push(owner,entry('a.html',0));
 nav.push(owner,{...entry('a.html',0.5),zoom:150});
 const st=nav.stackFor(owner);
 assert.equal(st.entries.length,1);
 assert.equal(st.entries[0].zoom,150);
});

test('A10 导航栈上限 100,超出后丢最旧项',()=>{
 const nav=new NavigationService();const owner={};
 for(let i=0;i<120;i++)nav.push(owner,entry(`f${i}.html`));
 const st=nav.stackFor(owner);
 assert.equal(st.entries.length,100);
 assert.equal(st.entries[0].path,'f20.html');
 assert.equal(st.entries[99].path,'f119.html');
});

test('A10 两个叶子各自独立(两标签位置不互相影响)',()=>{
 const nav=new NavigationService();const a={},b={};
 nav.push(a,entry('x.html'));
 nav.push(a,entry('y.html'));
 nav.push(b,entry('p.html'));
 assert.equal(nav.canBack(a),true);
 assert.equal(nav.canBack(b),false);
 nav.back(a);
 assert.equal(nav.stackFor(a).index,0);
 assert.equal(nav.stackFor(b).index,0);
});

test('A10 文件级位置记录可迁移与持久化(改名/重启恢复)',()=>{
 const nav=new NavigationService();
 nav.recordPosition({...entry('old.html',0.42),anchor:'#sec'});
 nav.rename('old.html','new.html');
 assert.equal(nav.lastPosition('old.html'),undefined);
 assert.equal(nav.lastPosition('new.html')?.scrollRatio,0.42);
 const json=nav.toJSON();
 assert.deepEqual(Object.keys(json),['new.html']);
 const restored=new NavigationService();
 restored.fromJSON(json);
 assert.equal(restored.lastPosition('new.html')?.anchor,'#sec');
});

test('A10 位置持久化拒绝自相矛盾的条目',()=>{
 const nav=new NavigationService();
 nav.fromJSON({'a.html':{path:'b.html',scrollRatio:0} as unknown as NavEntry});
 assert.equal(nav.lastPosition('a.html'),undefined);
 nav.fromJSON({notAnObject:3,ok:{path:'ok',scrollRatio:0.1,anchor:'',zoom:100,width:'auto'}});
 assert.equal(nav.lastPosition('ok')?.scrollRatio,0.1);
});

test('A10 audit 回归:位置持久化保留最近的 200 个而不是最早的',()=>{
 const nav=new NavigationService();
 for(let i=0;i<500;i++)nav.recordPosition({path:`p${i}.html`,anchor:'',scrollRatio:0,zoom:100,width:'auto'});
 const json=nav.toJSON();
 const keys=Object.keys(json);
 assert.equal(keys.length,200);
 assert.ok(keys.includes('p499.html'),'最新访问的文件必须保留');
 assert.ok(!keys.includes('p0.html'),'最早访问的文件应被淘汰');
});

test('A10 自检回归:iframe 被移除后的死窗口不得让滚动读写抛异常',()=>{
 // iframe 元素被移除后,它的 WindowProxy 仍在,但 document/documentElement 已为 null
 // (Chromium 108+ 丢弃浏览上下文)。renderFrame/滚动抓取/恢复都持有旧窗口引用,
 // 不设防会抛 "Cannot read properties of null (reading 'scrollHeight')",
 // 直接中断重绘(实测:预览整体空白)。见 audit/runtime/selfcheck-newpaths.mjs。
 const dead={document:null} as unknown as Window;
 const deadNoRoot={document:{documentElement:null}} as unknown as Window;
 const nav=new NavigationService();
 assert.equal(nav.scrollRatioOf(null),0);
 assert.equal(nav.scrollRatioOf(undefined),0);
 assert.equal(nav.scrollRatioOf(dead),0);
 assert.equal(nav.scrollRatioOf(deadNoRoot),0);
 assert.doesNotThrow(()=>nav.restoreScroll(dead,0.5));
 assert.doesNotThrow(()=>nav.restoreScroll(deadNoRoot,0.5));
 // 活窗口仍按比例计算
 const live={document:{documentElement:{scrollHeight:1000}},innerHeight:200,scrollY:400} as unknown as Window;
 assert.equal(nav.scrollRatioOf(live),0.5);
});
