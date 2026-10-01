import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inlineLocalStylesheets} from '../src/services/cssInline';

// 预览本地样式表内联回归(2026-09-30 真机定因):srcdoc 预览继承宿主 CSP,
// app:// 样式表加载被拦截 → 预览前把库内 <link rel=stylesheet> 内联成 <style>。

// assets:除 CSS 文件外"库内存在"的文件(url() 解析成功的候选);不在其中的路径
// resourceUrl 返回 null——真实 IO 用 getAbstractFileByPath 判存在性,这里对齐
function ioOf(files:Record<string,string>,assets:string[]=[]){
 const known=new Set([...Object.keys(files),...assets]);
 return {
  readCss:async(p:string)=>files[p]??null,
  resourceUrl:(p:string)=>known.has(p)?`app://hash/${p}`:null,
 };
}

test('库内 link rel=stylesheet 被内联为 style,url() 改写为绝对资源地址',async()=>{
 const files={'assets/coffee.css':'h1{color:red}p{background:url("bg.png")}'};
 const src='<html><head><link rel="stylesheet" href="../assets/coffee.css"></head><body><h1>x</h1></body></html>';
 const out=await inlineLocalStylesheets(src,'pages/x.html',ioOf(files,['assets/bg.png']));
 assert.ok(!/<link/i.test(out),'link 应被替换: '+out);
 assert.match(out,/<style>/);
 assert.match(out,/h1\{color:red\}/);
 // bg.png 按 coffee.css 自己的目录(assets/)解析
 assert.match(out,/url\("app:\/\/hash\/assets\/bg\.png"\)/);
});

test('本地 @import 递归展开(相对被导入文件目录),远程 @import 原样保留',async()=>{
 const files={
  'assets/coffee.css':'@import "sub/deep.css";@import url(https://fonts.googleapis.com/x.css);h1{color:red}',
  'assets/sub/deep.css':'h2{color:blue;background:url(../img.png)}',
 };
 const src='<html><head><link rel="stylesheet" href="/assets/coffee.css"></head><body></body></html>';
 const out=await inlineLocalStylesheets(src,'x.html',ioOf(files,['assets/img.png']));
 assert.match(out,/h2\{color:blue/,'被导入的本地 css 应递归内联');
 assert.match(out,/url\("app:\/\/hash\/assets\/img\.png"\)/,'@import 内 url 按被导入文件目录解析');
 assert.match(out,/@import\s+url\(https:\/\/fonts\.googleapis\.com\/x\.css\)/,'远程 @import 不得内联');
 assert.ok(!/@import\s+(?:url\(\s*)?['"]?sub\/deep\.css/i.test(out),'本地 @import 语句应被展开: '+out);
});

test('页内 <style> 的本地 @import 同样展开;循环引用终止',async()=>{
 const files={
  'a.css':'@import "b.css";a{color:red}',
  'b.css':'@import "a.css";b{color:blue}',
 };
 const src='<html><head><style>@import "a.css";h1{color:green}</style></head><body></body></html>';
 const out=await inlineLocalStylesheets(src,'page.html',ioOf(files));
 assert.match(out,/b\{color:blue\}/,'页内 import 链应展开');
 assert.match(out,/h1\{color:green\}/,'原有样式保留');
 // a.css→b.css→a.css 环:重复的 a.css 不再展开,但不得死循环/抛错
 assert.equal((out.match(/a\{color:red\}/g)??[]).length,1,'环上的重复导入只展开一次');
});

test('读不到的 CSS、远程 link、alternate 样式表保持原样',async()=>{
 const src=[
  '<html><head>',
  '<link rel="stylesheet" href="missing.css">',
  '<link rel="stylesheet" href="https://cdn.example.com/x.css">',
  '<link rel="alternate stylesheet" title="t" href="/assets/coffee.css">',
  '</head><body></body></html>',
 ].join('');
 const files={'assets/coffee.css':'h1{color:red}'};
 const out=await inlineLocalStylesheets(src,'x.html',ioOf(files));
 assert.match(out,/href="missing\.css"/,'缺失文件保留原 link(与被拦截时的表现一致)');
 assert.match(out,/href="https:\/\/cdn\.example\.com\/x\.css"/,'远程 link 不动');
 assert.match(out,/rel="alternate stylesheet"/,'alternate 样式表不内联(内联会让未选中的备用样式生效)');
 assert.ok(!/h1\{color:red\}/.test(out),'alternate 的目标文件不应被内联');
});

test('纯函数:入参源码字符串不被修改;media 属性随内联保留',async()=>{
 const files={'assets/coffee.css':'h1{color:red}'};
 const src='<html><head><link rel="stylesheet" media="print" href="/assets/coffee.css"></head><body></body></html>';
 const before=src;
 const out=await inlineLocalStylesheets(src,'x.html',ioOf(files));
 assert.equal(src,before);
 assert.match(out,/<style media="print">/,'media 属性必须带到内联 style 上');
});

test('预览链路:内联后的源码可再经 makePreview(标记/沙箱不受影响)',async()=>{
 const files={'pages/assets/coffee.css':'h1{color:red}'};
 const {makePreview,parseDocument}=await import('../src/model');
 const src='<!doctype html><html><head><link rel="stylesheet" href="assets/coffee.css"></head><body><h1>标题</h1></body></html>';
 const inlined=await inlineLocalStylesheets(src,'pages/x.html',ioOf(files));
 assert.match(inlined,/<style>h1\{color:red\}<\/style>/);
 const preview=makePreview(parseDocument(inlined),'app://h/pages/','n1');
 assert.match(preview,/<style>h1\{color:red\}<\/style>/);
 assert.match(preview,/script-src 'none'/);
 assert.match(preview,/html-atelier-text:n1:t0/,'正文标记不受内联影响');
});

test('注释与字符串里的 @import/url() 不被展开或改写(审计 m6)',async()=>{
 const files={'old.css':'oldrule{color:red}','a.css':'arule{color:red}'};
 const src='<html><head><style>/* @import "old.css"; */ p{content:"url(fake.png)"} @import "a.css"; h2{color:blue}</style></head><body></body></html>';
 const out=await inlineLocalStylesheets(src,'x.html',ioOf(files));
 assert.ok(!/oldrule\{color:red\}/.test(out),'注释掉的 import 不得展开: '+out);
 assert.match(out,/\/\* @import "old\.css"; \*\//,'注释文本原样保留');
 assert.match(out,/content:"url\(fake\.png\)"/,'字符串里的 url() 字面量不得改写');
 assert.match(out,/arule\{color:red\}/,'真正的 import 正常展开');
 assert.match(out,/h2\{color:blue\}/);
 // 保护段切分不得复制前面的代码段(splitCssLex push 起点 bug 的回归锁)
 assert.equal((out.match(/p\{content:"url\(fake\.png\)"\}/g)??[]).length,1,'代码段不得因注释/字符串切分而重复');
 assert.equal((out.match(/h2\{color:blue\}/g)??[]).length,1);
});

test('url() 引号形态仍被改写;@import url() 引号形态仍被展开(url 归代码段的回归面)',async()=>{
 const files={'assets/a.css':'@import url("b.css");h1{color:red}','assets/b.css':'h2{background:url("bg.png")}'};
 const src='<html><head><link rel="stylesheet" href="/assets/a.css"></head><body></body></html>';
 const out=await inlineLocalStylesheets(src,'x.html',ioOf(files,['assets/bg.png']));
 assert.match(out,/h2\{background:url\("app:\/\/hash\/assets\/bg\.png"\)\}/,'url("…") 引号形态必须照常改写');
 assert.match(out,/h1\{color:red\}/,'@import url("…") 引号形态必须照常展开');
});

test('子导入里未解析的相对 url() 不被父层按父目录重新解析(审计 m7)',async()=>{
 const files={
  'dirA/top.css':'@import "../dirB/sub.css";',
  'dirB/sub.css':'h2{background:url(bg.png)}', // dirB/bg.png 不存在;dirA/bg.png 存在
 };
 const src='<html><head><link rel="stylesheet" href="/dirA/top.css"></head><body></body></html>';
 const out=await inlineLocalStylesheets(src,'x.html',ioOf(files,['dirA/bg.png']));
 assert.match(out,/url\(bg\.png\)/,'解析不到的相对引用保持原样');
 assert.ok(!/dirA\/bg\.png/.test(out),'不得按父目录把 bg.png 指到 dirA 的同名文件: '+out);
});

test('带 disabled 的 link 不内联(浏览器不应用它,内联反而让它生效;审计 n1)',async()=>{
 const files={'assets/coffee.css':'h1{color:red}'};
 const src='<html><head><link rel="stylesheet" disabled href="/assets/coffee.css"></head><body></body></html>';
 const out=await inlineLocalStylesheets(src,'x.html',ioOf(files));
 assert.match(out,/<link rel="stylesheet" disabled/);
 assert.ok(!/h1\{color:red\}/.test(out),'disabled 样式表的目标文件不应被内联');
});

test('CSS 含 </style> 时转义,不得提前闭合标签逃逸进预览标记层(审计 n3)',async()=>{
 const files={'assets/tricky.css':'h1{color:red}\n/* </style><img src=x onerror=alert(1)> */\np{color:blue}'};
 const src='<html><head><link rel="stylesheet" href="/assets/tricky.css"></head><body></body></html>';
 const out=await inlineLocalStylesheets(src,'x.html',ioOf(files));
 assert.ok(!/<\/style>\s*<img/.test(out),'闭合标签不得裸露在 style 文本里: '+out);
 assert.match(out,/<\\\/style/,'应以 <\\/style 形式转义');
 assert.match(out,/p\{color:blue\}/,'转义不得破坏后续规则');
 // 再解析一遍仍是一个完整的 style:模型层文本段不因逃逸内容错位
 const {parseDocument}=await import('../src/model');
 const model=parseDocument(out);
 assert.ok(model.segments.every(x=>!/onerror/.test(x.text??'')),'逃逸出的标记文本不得成为可编辑文本段');
});
