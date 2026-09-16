import {TextPatch} from '../core/patch';

// "替换为单一图片"里删除 srcset 整个属性的补丁规划(纯函数:面板与审计探针共用同一实现)。
// 区间:属性名 → 值(含收尾引号);只吃掉**紧随其后**的一个分隔空白。
// 若吃掉前一个空白,当 srcset 是首个属性且下一个属性没有前导空格时
// (<img srcset="a 1x"alt="x">),标签名会与下一个属性粘连,<img> 元素被破坏(round4 BUG 12)。
export function planSrcsetRemoval(source:string,attr:{start:number; valueEnd:number; quote:string}):TextPatch|null {
 const valueEnd=attr.quote?attr.valueEnd+1:attr.valueEnd;
 const after=valueEnd<source.length&&/\s/.test(source[valueEnd])?valueEnd+1:valueEnd;
 if(after>source.length)return null;
 return {start:attr.start,end:after,expected:source.slice(attr.start,after),replacement:''};
}

