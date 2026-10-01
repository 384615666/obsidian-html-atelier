// 预览 iframe 里的悬停/选中框。框画在 shadow root 里(不受页面样式影响),
// 框自己的样式 <style> 也放在同一个 shadow root 里。
// 单独成模块、不依赖 obsidian,便于在 jsdom 里做回归测试。

const BOX_TAG='html-atelier-selection-box';

export interface BoxRect {left:number;top:number;width:number;height:number}

// 用新框替换旧框:选中项实线,悬停项虚线。只能逐个移除旧框,不能整体 replaceChildren() ——
// 那样会把同在 shadow root 里的 <style> 一起删掉,之后画出的框是 static、0×0,
// 编辑模式里就看不到任何悬停/选中框。
export function renderSelectionBoxes(root:ShadowRoot,rects:Iterable<BoxRect>,selected:boolean){
 for(const old of root.querySelectorAll(BOX_TAG))old.remove();
 const border=`${selected?'2px solid':'1px dashed'} #9275df`;
 for(const rect of rects){
  const box=root.ownerDocument.createElement(BOX_TAG);
  box.style.setProperty('--html-atelier-x',`${rect.left-3}px`);
  box.style.setProperty('--html-atelier-y',`${rect.top-2}px`);
  box.style.setProperty('--html-atelier-w',`${rect.width+6}px`);
  box.style.setProperty('--html-atelier-h',`${rect.height+4}px`);
  box.style.setProperty('--html-atelier-border',border);
  root.append(box);
 }
}
