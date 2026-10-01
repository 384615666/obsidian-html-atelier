import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {renderSelectionBoxes} from '../src/views/selectionOverlay';

// 与 htmlView 的结构一致:layer 挂在 <html> 下,shadow root 里先放样式,之后反复画框
function makeOverlay(){
 const doc=new JSDOM('<!doctype html><html><head></head><body><h1>标题</h1></body></html>').window.document;
 const layer=doc.createElement('html-atelier-selection-layer');
 doc.documentElement.append(layer);
 const root=layer.attachShadow({mode:'open'});
 const style=doc.createElement('style');
 style.textContent='html-atelier-selection-box{position:fixed}';
 root.append(style);
 return root;
}

const boxes=(root:ShadowRoot)=>[...root.querySelectorAll('html-atelier-selection-box')] as HTMLElement[];
const styles=(root:ShadowRoot)=>root.querySelectorAll('style').length;

test('重画悬停/选中框时保留 shadow root 里的样式', ()=>{
 const root=makeOverlay();

 // 首次画框(旧实现在这一步就用 replaceChildren() 把 <style> 删了)
 renderSelectionBoxes(root,[{left:10,top:20,width:100,height:30},{left:10,top:60,width:40,height:30}],true);
 assert.equal(styles(root),1);
 assert.equal(boxes(root).length,2);
 assert.equal(boxes(root)[0].style.getPropertyValue('--html-atelier-border'),'2px solid #9275df');
 assert.equal(boxes(root)[0].style.getPropertyValue('--html-atelier-x'),'7px');

 // 悬停到别处:旧框换成新框,样式还在
 renderSelectionBoxes(root,[{left:0,top:0,width:5,height:5}],false);
 assert.equal(styles(root),1);
 assert.equal(boxes(root).length,1);
 assert.equal(boxes(root)[0].style.getPropertyValue('--html-atelier-border'),'1px dashed #9275df');

 // 退出编辑模式:清空所有框,样式保留
 renderSelectionBoxes(root,[],false);
 assert.equal(boxes(root).length,0);
 assert.equal(styles(root),1);
});
