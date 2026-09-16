// 转义规则（报告 §12.3 第 3 条）：普通文字用文本转义；属性根据原引号类型转义；
// 源码编辑不经过本模块。未触碰的区间永远保持原始拼写，由补丁模型保证。
export const escapeText=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

export type AttrQuote='"'|"'"|'';
// 契约(报告 F08):quote 参数必须与写入时实际包裹值的引号一致。
// 为消除"包裹引号与转义引号错配"这类调用方错误(audit/parsing R5),
// 两种引号一律同时转义;无引号场景再额外转义空白与 >。
export function escapeAttrValue(s:string,quote:AttrQuote):string {
 let out=s.replace(/&/g,'&amp;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');
 if(quote===''){
  // 无引号属性值:空白与 > 都会截断值(audit/parsing R4),全部转义
  out=out.replace(/[\t\n\r\f >]/g,c=>{
   if(c==='\t')return '&#9;';if(c==='\n')return '&#10;';if(c==='\r')return '&#13;';
   if(c==='\f')return '&#12;';if(c==='>')return '&gt;';return '&#32;';
  });
 }
 return out;
}

// 把"路径片段"拼进一个已存在的属性值。与 escapeAttrValue 的区别:**不转义 &**。
// 属性里原有的查询串/实体拼写(例如 ?a=1&amp;b=2)必须逐字节保留,重新转义 & 会把它
// 变成 &amp;amp;,浏览器解码后查询参数就错了(审计复检 §3.10 附带项)。
// 这里只需保证新片段不会提前结束属性:转义当前引号;无引号时再转义空白与 >。
export function escapeAttrPath(s:string,quote:AttrQuote):string {
 if(quote!=='')return quote==='"'?s.replace(/"/g,'&quot;'):s.replace(/'/g,'&#39;');
 return s.replace(/[\t\n\r\f >]/g,c=>{
  if(c==='\t')return '&#9;';if(c==='\n')return '&#10;';if(c==='\r')return '&#13;';
  if(c==='\f')return '&#12;';if(c==='>')return '&gt;';return '&#32;';
 });
}
