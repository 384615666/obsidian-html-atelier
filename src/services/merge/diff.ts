// 行级差异（D1 参考实现）：
// 契约是稳定、确定、保留 CRLF；以“行+行终止符”为不可分 token，混合换行风格因此保守冲突。
// 实现：去公共前后缀后用 LCS 动态规划；超出容量（约 2000×2000 行）时退化为整段替换，
// 由 diff3 层保守判冲突——绝不产出错误差异。D0-09 选定成熟库后经同一契约替换本实现。
export interface DiffHunk {aStart:number; aEnd:number; tokens:string[]}

export const DIFF_CELL_LIMIT=4_000_000;

export function tokenizeLines(text:string):string[] {
 const tokens:string[]=[];
 let start=0;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='\n'){tokens.push(text.slice(start,i+1));start=i+1;}
  else if(c==='\r'&&text[i+1]!=='\n'){tokens.push(text.slice(start,i+1));start=i+1;}
 }
 if(start<text.length)tokens.push(text.slice(start));
 return tokens;
}

// 返回把 a 变为 b 的替换块列表：按 aStart 升序、互不重叠；
// tokens 为替换内容（可空=删除；aStart===aEnd=纯插入）。
export function diffHunks(a:string[],b:string[]):DiffHunk[] {
 let start=0;
 const minLen=Math.min(a.length,b.length);
 while(start<minLen&&a[start]===b[start])start++;
 let endA=a.length,endB=b.length;
 while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
 const innerA=a.slice(start,endA),innerB=b.slice(start,endB);
 if(innerA.length===0&&innerB.length===0)return [];
 if(innerA.length*innerB.length>DIFF_CELL_LIMIT)
  return [{aStart:start,aEnd:endA,tokens:innerB}]; // 超容量：整段替换，diff3 层保守处理
 if(innerA.length===0)return [{aStart:start,aEnd:start,tokens:innerB}];
 if(innerB.length===0)return [{aStart:start,aEnd:endA,tokens:[]}];

 // LCS DP
 const n=innerA.length,m=innerB.length;
 const width=m+1;
 const table=new Uint32Array((n+1)*width);
 for(let i=1;i<=n;i++){
  const ai=innerA[i-1];
  for(let j=1;j<=m;j++){
   table[i*width+j]=ai===innerB[j-1]?table[(i-1)*width+(j-1)]+1:Math.max(table[(i-1)*width+j],table[i*width+(j-1)]);
  }
 }
 // 回溯编辑操作并反转为正序
 type Op='del'|'ins'|'same';
 const ops:Op[]=[];
 let i=n,j=m;
 while(i>0&&j>0){
  if(innerA[i-1]===innerB[j-1]){ops.push('same');i--;j--;}
  else if(table[(i-1)*width+j]>=table[i*width+(j-1)]){ops.push('del');i--;}
  else{ops.push('ins');j--;}
 }
 while(i>0){ops.push('del');i--;}
 while(j>0){ops.push('ins');j--;}
 ops.reverse();

 // 正序线性扫描：连续非 same 操作聚为一个 hunk
 const hunks:DiffHunk[]=[];
 let ai=0,bi=0,p=0;
 while(p<ops.length){
  if(ops[p]==='same'){ai++;bi++;p++;continue;}
  const delStart=ai;
  const ins:string[]=[];
  while(p<ops.length&&ops[p]!=='same'){
   if(ops[p]==='del')ai++;
   else{ins.push(innerB[bi]);bi++;}
   p++;
  }
  hunks.push({aStart:start+delStart,aEnd:start+ai,tokens:ins});
 }
 return hunks;
}
