// UTF-8 字节数。用于按"实际占用"做容量判断(草稿容量提醒),
// 而不是按字符数——中文等非 ASCII 字符占 3 字节,字符数会低估占用。
export function utf8Bytes(text:string):number{
 let n=0;
 for(const ch of text){
  const cp=ch.codePointAt(0)??0;
  if(cp<0x80)n+=1;
  else if(cp<0x800)n+=2;
  else if(cp<0x10000)n+=3;
  else n+=4;
 }
 return n;
}
