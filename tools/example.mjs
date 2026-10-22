import {readFileSync} from 'node:fs';
import {guard} from './api.mjs';
const request=JSON.parse(readFileSync(new URL('../fixtures/example-request.json',import.meta.url)));
for(const candidate of [undefined,'',request.raw.replace('not ok 37','ok 37')]) {
  const result=guard({...request,...(candidate===undefined?{}:{candidate})});
  console.log(JSON.stringify({decision:result.decision,reason:result.reason,metrics:result.metrics,output:result.output},null,2));
}
