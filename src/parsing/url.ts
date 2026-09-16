// 引用分类与解析(另存为重写 / 资源清单 / 依赖图共用一份判定)。
// 审计 round4 的把关意见是"统一走一个引用解析函数":大小写、协议相对、尾部 `/`、
// `<base>`、百分号解码顺序,过去散落在 assets.ts / saveService.ts / links.ts 各自实现,
// 于是同一形态在不同入口得到不同结论。
const SCHEME=/^[a-z][a-z0-9+.-]*:/i;

// query/fragment 不属于路径:资源存在性判断与重写都要先剥掉
export const stripQuery=(ref:string)=>ref.split('#')[0].split('?')[0];

// 引用种类。与 assets/save-as 语境相关的是前四类:
// absolute/protocol-relative 是站外;vault-root 是库内根路径;relative 按文档目录解析。
export type RefKind='empty'|'anchor'|'protocol-relative'|'vault-root'|'absolute'|'relative';

export function classifyRef(ref:string):RefKind {
 if(!ref)return 'empty';
 if(ref.startsWith('#'))return 'anchor';
 if(ref.startsWith('//'))return 'protocol-relative';
 if(ref.startsWith('/'))return 'vault-root';
 if(SCHEME.test(ref))return 'absolute';
 return 'relative';
}

// 站外引用(或页内锚点):不重写、不参与本地资源存在性判断
export function isRemoteRef(ref:string):boolean {
 const kind=classifyRef(ref);
 return kind==='empty'||kind==='anchor'||kind==='absolute'||kind==='protocol-relative'||kind==='vault-root';
}

// 站外网络引用(不含页内锚点)。`//cdn/x.png` 与 `https://…` 同属站外:
// 此前资源清单只枚举了带 scheme 的形态,协议相对引用被当成库内文件 → 恒报"缺失",
// 而"已按设置拦截"徽标又永远不会出现(审计 round4 BUG 26)。
export function isNetworkRef(ref:string):boolean {
 const kind=classifyRef(ref);
 return kind==='absolute'||kind==='protocol-relative';
}

// 库内路径规范化。'..' 在库根处截断(不越出 vault)。
export function normJoin(dir:string,rel:string):string {
 const parts=dir?dir.split('/'):[];
 for(const part of rel.split('/')){
  if(part==='.'||part==='')continue;
  if(part==='..'){parts.pop();continue;}
  parts.push(part);
 }
 return parts.join('/');
}

export function dirOf(path:string):string{return path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';}

// 相对引用是否越出了库根。normJoin 会把多余的 '..' 截断在库根,截断后的路径
// 静默指向另一个文件;另存为重写必须把这种引用放进"未重写"清单(见 saveService)。
export function escapesVaultRoot(dir:string,rel:string):boolean {
 let depth=dir?dir.split('/').filter(Boolean).length:0;
 for(const part of rel.split('/')){
  if(part==='.'||part==='')continue;
  if(part==='..'){if(depth===0)return true;depth--;continue;}
  depth++;
 }
 return false;
}

// 库内引用的统一解析:根引用 `/x.png` 从库根解析,**不**套用页面目录。
// 此前 resourcesWithBase 用 normJoin(pageDir,…) 覆盖了根语义,存在的文件被报"缺失"
// (审计 round4 BUG 15)。
export function resolveVaultRef(pageDir:string,ref:string):string {
 const clean=stripQuery(ref).trim();
 if(classifyRef(clean)==='vault-root')return clean.replace(/^\/+/,'');
 return normJoin(pageDir,clean);
}

// srcset 候选切分。按 HTML 规范的 "parse a srcset attribute" 算法:
//  1) 跳过空白与逗号(候选分隔符);
//  2) **URL 一路读到下一个空白** —— URL 内部允许逗号(`a,b.png`),末尾逗号表示"最后一个候选";
//  3) 描述符读到下一个"括号外的"逗号,该逗号才是分隔符。
// 之前按"逗号+空白"切分是错的两种写法:无空格的分隔符(`a.png 1x,b.png 2x`)会把第二个候选
// 吞进描述符("b.png 从依赖图里消失,改它不刷新预览"),而首尾逗号会产出 `a.png,` 这种幻影路径
// (审计报告 5 N2)。
// 末尾逗号规则(规范步骤 8):URL 以逗号结尾时**结束解析**。浏览器实测
// `srcset="a.png, b.png"` 只加载 a.png —— 逗号之后的候选项本来就不参与加载,
// 所以按规范切分不会漏掉"真正会被加载的文件"。
export interface SrcsetCandidate {url:string; start:number; end:number}

const isAsciiWs=(ch:string)=>ch===' '||ch==='\t'||ch==='\n'||ch==='\f'||ch==='\r';

export function srcsetCandidates(value:string):SrcsetCandidate[] {
 const out:SrcsetCandidate[]=[];
 let i=0;
 while(true){
  while(i<value.length&&(value[i]===','||isAsciiWs(value[i])))i++;
  if(i>=value.length)break;
  const start=i;
  while(i<value.length&&!isAsciiWs(value[i]))i++;
  let end=i;
  let url=value.slice(start,end);
  if(url.endsWith(',')){url=url.slice(0,-1);end--;out.push({url,start,end});break;}
  out.push({url,start,end});
  // 描述符:括号内的逗号不是分隔符(如 (min-width: 100px) 写法)
  let depth=0;
  while(i<value.length){
   const ch=value[i];
   if(ch==='(')depth++;
   else if(ch===')')depth=Math.max(0,depth-1);
   else if(ch===','&&depth===0)break;
   i++;
  }
 }
 return out;
}

export function srcsetUrls(value:string):string[] {
 return srcsetCandidates(value).map(c=>c.url).filter(Boolean);
}

// 末尾 `/` 是语义的一部分:'assets/' 是目录,'assets' 是文件,相对解析结果不同。
export const isDirRef=(ref:string)=>stripQuery(ref).trim().endsWith('/');
