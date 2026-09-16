// 嵌入代码块参数的纯解析(F21)。与 obsidian 宿主无关,因此可以被 node 测试直接引用;
// index.ts 以 re-export 保持既有导入路径不变。
export interface EmbedParams {path:string|null; height:number|'auto'; width:number|'auto'; anchor:string|null; toolbar:boolean}

export function parseEmbedParams(src:string):{params:EmbedParams|null; error:string|null} {
 const params:EmbedParams={path:null,height:'auto',width:'auto',anchor:null,toolbar:true};
 const unknown:string[]=[];
 for(const lineRaw of src.split(/\r?\n/)){
  const line=lineRaw.trim();
  if(!line)continue;
  const m=/^([A-Za-z]+)\s*:\s*(.+)$/.exec(line);
  if(!m){unknown.push(line);continue;}
  const [,keyRaw,valueRaw]=m;
  const key=keyRaw.toLowerCase();
  // 值首尾空白一律剥离:引号是可选语法糖,' demo/a.html ' 与 " demo/a.html "
  // 此前分别保留空格/连引号一起进路径,查找必然失败并报 "(missing)"
  // (审计 round4 BUG 25)。
  let value=valueRaw.trim();
  const quoted=/^"(.*)"$/.exec(value)??/^'(.*)'$/.exec(value);
  if(quoted)value=quoted[1].trim();
  if(key==='path')params.path=value;
  else if(key==='height'){params.height=value==='auto'?'auto':clampInt(value,160,1600,'auto');}
  else if(key==='width'){params.width=value==='auto'?'auto':clampInt(value,240,3840,'auto');}
  else if(key==='anchor')params.anchor=value;
  // 布尔参数要接受常见真值写法:只比 'true' 会让 toolbar: yes/on/1 静默变 false,
  // 与 toolbar: no 无从区分(审计复检 §3.23 M6)。
  else if(key==='toolbar')params.toolbar=/^(true|yes|on|1)$/i.test(value);
  else unknown.push(line);
 }
 if(unknown.length)return {params:null,error:`未知参数: ${unknown.join(', ')}`};
 if(!params.path)return {params:null,error:'缺少 path'};
 return {params,error:null};
}

// 只接受十进制整数字面量。Number() 会接受 '0x100'(256)、'1e2'(100)、'0b1010'、
// ' 12 '(空格式数字),用户看到的 0x100 与得到的 256 毫无关系(审计 round4 BUG 24)。
function clampInt(v:string,min:number,max:number,dflt:number|'auto'):number|'auto'{
 if(!/^[+-]?\d+$/.test(v.trim()))return dflt;
 const n=Number(v.trim());
 return Math.min(max,Math.max(min,n));
}

