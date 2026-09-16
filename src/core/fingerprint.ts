// 内容指纹：用于历史事件 before/after 校验与草稿身份核对。
// expected 字符串承担精确性职责；指纹只做快速的"内容是否还是那一份"判断，
// 因此采用双种子 FNV-1a 加长度校验，避免碰撞导致误校验。
export function fingerprint(source:string):string {
 let h1=0x811c9dc5,h2=0x01000193^source.length;
 for(let i=0;i<source.length;i++){
  const c=source.charCodeAt(i);
  h1=(h1^c)>>>0;h1=Math.imul(h1,0x01000193)>>>0;
  h2=(h2^(c+i))>>>0;h2=Math.imul(h2,0x85ebca6b)>>>0;
 }
 return `${h1.toString(16).padStart(8,'0')}${h2.toString(16).padStart(8,'0')}:${source.length}`;
}
