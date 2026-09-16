// 对象定位（报告 §12.3 第 5 条）：唯一 HTML id、节点路径、局部文本与邻近上下文组合，
// 多候选时标记歧义。D1 仅作为历史与选择的历史载荷，完整重建逻辑在解析层完善。
export interface ObjectLocator {
 htmlId?:string;
 nodePath?:string;
 textProbe?:string;
 context?:string;
 ambiguous?:boolean;
}
