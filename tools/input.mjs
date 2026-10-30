import {openSync,readSync,closeSync} from 'node:fs';

export const MAX_REQUEST_CHARS=8388608;

/** Stop reading once the UTF-16 transport budget is exhausted; reject bad UTF-8. */
export function readRequest(input=0, maxChars=MAX_REQUEST_CHARS) {
  if(!Number.isSafeInteger(maxChars)||maxChars<1||maxChars>MAX_REQUEST_CHARS)throw new TypeError('invalid request budget');
  const owned=typeof input!=='number';
  const fd=owned?openSync(input,'r'):input;
  const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  const chunk=Buffer.alloc(65536),parts=[];
  let chars=0;
  try {
    while(true) {
      const count=readSync(fd,chunk,0,chunk.length,null);
      const text=count?decoder.decode(chunk.subarray(0,count),{stream:true}):decoder.decode();
      chars+=text.length;
      if(chars>maxChars)throw new RangeError('request_budget_exceeded');
      parts.push(text);
      if(count===0)break;
    }
    return parts.join('');
  } finally {if(owned)closeSync(fd);}
}
