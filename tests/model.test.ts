import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {parseDocument,applyText,makePreview,EditSession} from '../src/model';

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
