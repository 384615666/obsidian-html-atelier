import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {parseDocument,applyText,makePreview,markerRegex,EditSession,alignSegments} from '../src/model';

test('replaces only selected source ranges, preserving HTML, CSS, comments, CRLF and nested formatting',()=>{
 const input='<!DOCTYPE html>\r\n<!-- keep -->\r\n<style>.x { color: red; }</style><h1 class="x">你好 <em>世界</em> !</h1><p data-x="1">另一个段落</p>';
 const m=parseDocument(input);const s=m.segments.find(x=>x.text==='世界')!;
 assert.equal(applyText(m,new Map([[s.id,'宇宙 & <朋友>']])) ,input.replace('世界','宇宙 &amp; &lt;朋友&gt;'));
 assert.equal(applyText(m,new Map()),input);
});
test('decodes entities for editing but preserves their original spelling when untouched',()=>{
 const input='<p>A &amp; B &#x4E2D; &nbsp; 😀</p><p>keep &quot;x&quot;</p>';const m=parseDocument(input);
 assert.equal(m.segments[0].text,'A & B 中 \u00a0 😀');assert.equal(applyText(m,new Map([[m.segments[0].id,m.segments[0].text]])),input);
 assert.equal(applyText(m,new Map([[m.segments[0].id,'<img onerror=alert(1)>']])), '<p>&lt;img onerror=alert(1)&gt;</p><p>keep &quot;x&quot;</p>');
});
test('multiple edits maintain offsets and Unicode',()=>{
 const input='<h1>😀 第一</h1><p>第二</p><button>第三</button>';const m=parseDocument(input);
 assert.equal(applyText(m,new Map(m.segments.map((s,i)=>[s.id,['一','二二二','三'][i]]))),'<h1>一</h1><p>二二二</p><button>三</button>');
});
test('excludes code, controls, metadata and hidden content',()=>{
 const m=parseDocument('<title>title</title><script>x()</script><style>a{}</style><p hidden>hide</p><textarea>control</textarea><select><option>opt</option></select><svg><text>vector</text></svg><p>visible</p>');
 assert.deepEqual(m.segments.map(s=>s.text),['visible']);
});
test('single segment restore preserves other edits; undo restores the restored edit',()=>{
 const s=new EditSession('<p>A</p><p>B</p>');s.set('t0','AA');s.set('t1','BB');s.selected='t0';s.restore();
 assert.equal(s.value('t0'),'A');assert.equal(s.value('t1'),'BB');assert.equal(s.changes.size,1);
 s.undo();assert.equal(s.value('t0'),'AA');assert.equal(s.value('t1'),'BB');
});
test('save updates restore baseline; empty replacement remains selectable in preview',()=>{
 const s=new EditSession('<p>A</p>');s.set('t0','B');s.saved(applyText(s.model,s.changes));assert.equal(s.dirty,false);assert.equal(s.history.length,0);
 s.set('t0','C');s.selected='t0';s.restore();assert.equal(s.value('t0'),'B');s.set('t0','');assert.equal(applyText(s.model,s.changes),'<p></p>');
});
test('preview removes executable embeds and handlers and maps editable text',()=>{
 const input='<html><head><meta http-equiv="refresh" content="0;url=https://example.com"><script>bad()</script></head><body onload="bad()"><h1>Hello <b>world</b></h1><iframe src="https://example.com"></iframe><img src="a.png" onerror="bad()"></body></html>';
 const preview=makePreview(parseDocument(input),'app://local/vault/pages/');const doc=new JSDOM(preview).window.document;
 assert.equal(doc.querySelector('script,iframe,[onload],[onerror]'),null);assert.equal(doc.querySelectorAll('meta[http-equiv]').length,1);
 assert.equal((preview.match(/<!--html-atelier-text:/g)||[]).length,2);assert.equal(doc.querySelector('h1')?.children.length,1);assert.equal(doc.querySelector('base')?.href,'app://local/vault/pages/');
 assert.equal(doc.querySelector('img')?.src,'app://local/vault/pages/a.png');assert.match(doc.querySelector('meta')!.content,/script-src 'none'/);
});
test('malformed HTML and table text still produce usable preview mappings',()=>{
 const source='<table><tr><td>一<td>二</table><p>三';const m=parseDocument(source);const doc=new JSDOM(makePreview(m,'app://local/')).window.document;
 const walker=doc.createTreeWalker(doc,128);const text=[];let node;while((node=walker.nextNode()))if(node.nodeValue?.startsWith('html-atelier-text:'))text.push(node.nextSibling?.textContent);
 assert.deepEqual(text,m.segments.map(s=>s.text));
});

test('audit R1 回归:head 带属性时 CSP/base 仍注入;无 head 时自动补齐',()=>{
 for(const input of [
  '<html><head lang="en"><title>t</title></head><body><p>hi</p></body></html>',
  '<html><body><p>hi</p></body></html>',
  '<p>hi</p>',
 ]){
  const preview=makePreview(parseDocument(input),'app://local/vault/x/','n1');
  assert.match(preview,/script-src 'none'/);
  assert.match(preview,/base href="app:\/\/local\/vault\/x\/"/);
  const doc=new JSDOM(preview).window.document;
  assert.equal(doc.querySelector('base')?.getAttribute('href'),'app://local/vault/x/');
  assert.match(doc.querySelector('meta[http-equiv]')!.content,/script-src 'none'/);
 }
});

test('audit R2 回归:用户源码中的旧格式注释不再被当作文字标记',()=>{
 const input='<p>alpha<!--html-atelier-text:t0-->CONFIDENTIAL DRAFT</p><p>real</p>';
 const preview=makePreview(parseDocument(input),'app://local/x/','zz7');
 // 新标记都带 nonce;用户的手写标记(无 nonce)不会命中 markerRegex
 const userFake='html-atelier-text:t0';
 assert.equal(markerRegex('zz7').exec(userFake),null);
 assert.ok(preview.includes(`html-atelier-text:zz7:`));
 assert.ok(preview.includes(userFake)); // 用户注释原样保留
 // 匹配只命中带 nonce 的标记(alpha 与 CONFIDENTIAL DRAFT 被注释拆成两个文字节点,加 real 共 3 个)
 const hits=preview.match(/html-atelier-text:zz7:t\d+/g)??[];
 assert.equal(hits.length,3);
});

test('alignSegments:清空一个段落后不再产生幻影变更(用户实测 2026-09-16)',()=>{
 // 段 id 是文档顺序流水号,按 id 跨源配对会把后续每段都算成"已修改"。
 // 对齐后:清空 = 恰一条"删除",前后段落保持"未变"。
 const base=parseDocument('<html><body><p>一</p><p>二</p><p>三</p><p>四</p></body></html>').segments;
 const work=parseDocument('<html><body><p>一</p><p></p><p>三</p><p>四</p></body></html>').segments;
 const pairs=alignSegments(base,work);
 const changed=pairs.filter(pr=>!pr.base||!pr.work||pr.base.text!==pr.work.text);
 assert.equal(changed.length,1,'清空一段只应有一条变更: '+JSON.stringify(changed.map(pr=>[pr.base?.text,pr.work?.text])));
 assert.equal(changed[0].base?.text,'二');
 assert.equal(changed[0].work,null);
});
test('alignSegments:原地修改/插入/删除/无变更的配对',()=>{
 const B='<html><body><p>一</p><p>二</p><p>三</p></body></html>';
 const P=(w:string)=>alignSegments(parseDocument(B).segments,parseDocument(w).segments);
 const mod=P('<html><body><p>一</p><p>二X</p><p>三</p></body></html>');
 assert.deepEqual(mod.map(pr=>pr.base?.text+'>'+pr.work?.text),['一>一','二>二X','三>三']);
 const add=P('<html><body><p>一</p><p>新</p><p>二</p><p>三</p></body></html>');
 assert.equal(add.filter(pr=>!pr.base).length,1);
 assert.equal(add.find(pr=>!pr.base)?.work?.text,'新');
 const del=P('<html><body><p>一</p><p>三</p></body></html>');
 assert.equal(del.filter(pr=>!pr.work).length,1);
 assert.equal(del.find(pr=>!pr.work)?.base?.text,'二');
 const same=P(B);
 assert.equal(same.filter(pr=>pr.base&&pr.work&&pr.base.text===pr.work.text).length,3);
});
test('alignSegments:相邻多处修改按顺序配对,不串位',()=>{
 const base=parseDocument('<html><body><p>a</p><p>b</p><p>c</p></body></html>').segments;
 const work=parseDocument('<html><body><p>A</p><p>B</p><p>c</p></body></html>').segments;
 const pairs=alignSegments(base,work);
 assert.deepEqual(pairs.map(pr=>[pr.base?.text,pr.work?.text]),[['a','A'],['b','B'],['c','c']]);
});
