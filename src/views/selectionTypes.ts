// 选择信息结构(视图与面板共享)
export interface SelectionInfo {
 kind:'text'|'link'|'image'|'paragraph';
 segmentId?:string;
 nodeId?:number;
 tagName?:string;
 containerIndex?:number;
 logicalStart?:number;
 logicalEnd?:number;
 offset?:number;
 description?:string;
}
