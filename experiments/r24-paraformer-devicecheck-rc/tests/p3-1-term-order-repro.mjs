import fs from 'node:fs';
const dir=process.argv[2];
const src=fs.readFileSync(dir+'/app.js','utf8');
function extract(name){const i=src.indexOf('function '+name+'(');if(i<0)throw new Error('missing '+name);let j=src.indexOf('{',i),d=0,k=j;for(;k<src.length;k++){const c=src[k];if(c==='{')d++;else if(c==='}'){d--;if(d===0)break;}}return src.slice(i,k+1);}
const need=['spokenNumberValue','normalizeInterfaceDecimals','normalizeSpokenNumbers'];
let code=need.map(extract).join('\n');
// pull helper deps referenced but not defined
for(let pass=0;pass<5;pass++){const m=[...code.matchAll(/\b([A-Za-z_]\w*)\(/g)].map(x=>x[1]);for(const n of new Set(m)){if(new RegExp('function '+n+'\\(').test(code))continue;if(src.includes('function '+n+'(')){try{code+='\n'+extract(n);}catch{}}}}
const {canonicalizeTerms}=await import(dir+'/asr-glossary.mjs');
const fn=new Function(code+'\nreturn {normalizeSpokenNumbers};')();
const terms=['HDMI 2.1','T7M Pro','USB 3.0'];
for(const raw of ['支持hdmi二点一接口','支持 HDMI 二点一 接口','这款t七m pro很好','usb三点零接口','支持hdmi 2.1接口']){
  const a=canonicalizeTerms(raw,terms).text; const b=fn.normalizeSpokenNumbers(a).text; const c=canonicalizeTerms(b,terms).text;
  console.log(JSON.stringify({raw,afterCanon:a,final_current:b,final_if_recanon:c}));
}
