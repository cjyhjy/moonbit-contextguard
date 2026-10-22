import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export function sourceDigest(root) {
  const files=['moon.mod'];
  for(const directory of ['src','cmd']) {
    const walk=relative=>{for(const entry of readdirSync(join(root,relative),{withFileTypes:true})){const path=`${relative}/${entry.name}`;if(entry.isDirectory())walk(path);else if(entry.name.endsWith('.mbt')||entry.name==='moon.pkg')files.push(path);}};
    walk(directory);
  }
  files.sort();
  const records=files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}));
  return {sha256:createHash('sha256').update(JSON.stringify(records)).digest('hex'),files:records};
}

export function verificationInputs(root) {
  const files=['moon.mod','package.json','toolchain.lock.json'];
  for(const directory of ['src','cmd','tools','tests','evaluation','demo','adapters','fixtures','research','vendor/harnesspro']) {
    const walk=relative=>{for(const entry of readdirSync(join(root,relative),{withFileTypes:true})){const path=`${relative}/${entry.name}`;if(['__pycache__','downloads','runs'].includes(entry.name))continue;if(entry.isDirectory())walk(path);else if(!entry.name.endsWith('.pyc')&&!entry.name.startsWith('.DS_Store'))files.push(path);}};
    walk(directory);
  }
  files.sort();
  const records=files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}));
  return {sha256:createHash('sha256').update(JSON.stringify(records)).digest('hex'),files:records};
}
