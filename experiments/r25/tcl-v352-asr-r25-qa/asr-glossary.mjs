// Local, explicit spelling glossary. This does not infer missing speech or product facts.
export const GLOSSARY_LIMITS = Object.freeze({terms:24, termChars:24, totalChars:240, sourceChars:100000});
const identity = value => value.toLowerCase().replace(/[\s-]+/g, '');
const unsafe = /(?:https?:|www\.|@|<\||\|>|[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|[￥¥$€]|\d\s*(?:元|块|折|%|Hz|赫兹|尼特|nit|瓦|W|英寸|寸|年|个月)|售[价卖]|价格|优惠|保修|赠送|支持|保证|承诺|秒杀|领先|第一|最[高低好佳快强大新]|必[买须])/iu;

function cleanTerm(value) {
  const term=String(value).trim().replace(/[ \t]+/g,' ');
  if(!term || [...term].length>GLOSSARY_LIMITS.termChars || unsafe.test(term) || /\d{7,}/.test(term)) throw new Error('术语只填写短英文型号或技术缩写，不填网址、联系方式、价格、参数承诺或完整句子');
  // Restrict punctuation and unsupported controls. Digits alone cannot be a term.
  if(!/^[A-Za-z][A-Za-z0-9 .+-]*$/.test(term) || /\.{2}|[+-]{2}|\s{2}/.test(term)) throw new Error('当前只支持英文型号或技术缩写的拼写校正');
  if((term.match(/ /g)||[]).length>3) throw new Error('请填写简短术语，不要输入整句讲解词');
  return term;
}

export function parseTerms(raw) {
  if(typeof raw!=='string' || raw.length>4096) throw new Error('术语输入过长');
  const terms=[],seen=new Set();
  for(const line of raw.split(/[\r\n,，;；]+/)) {
    if(!line.trim())continue;
    const term=cleanTerm(line),key=identity(term);
    if(seen.has(key))continue;
    seen.add(key);terms.push(term);
  }
  if(terms.length>GLOSSARY_LIMITS.terms || terms.reduce((n,t)=>n+[...t].length,0)>GLOSSARY_LIMITS.totalChars) throw new Error('最多保存24个术语、合计240字；请只保留本次讲解所需的词');
  return terms;
}

// Read only document content, never file names, locators or unrelated JSON properties.
export function extractTerms(parsed) {
  let remaining=GLOSSARY_LIMITS.sourceChars;
  const segments=[];
  const add=text=>{if(typeof text!=='string'||remaining<=0)return;const part=text.slice(0,remaining);segments.push(part);remaining-=part.length;};
  for(const block of parsed?.blocks||[]) {
    if(remaining<=0)break;
    if(block.kind==='paragraph')add(block.text);
    if(block.kind==='table')for(const row of block.rows||[]){if(remaining<=0)break;for(const cell of row.cells||[]){add(cell);if(remaining<=0)break;}}
  }
  const terms=[],seen=new Set();let count=0;
  for(const segment of segments) {
    // A URL/mail cannot contribute an apparent model ID. Do not extract units or prices.
    const text=segment.replace(/(?:https?:\/\/|www\.)[^\s，。；、<>]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi,' ');
    const candidates=text.match(/(?<![A-Za-z0-9])(?:Mini[ -]?LED|QLED|OLED|HDMI(?:[ -]?\d+(?:\.\d+)*)?|MEMC|VRR|ALLM|HDR(?:\d+\+?)?|Dolby[ -]+(?:Vision|Atmos)|TCL|USB(?:[ -]?\d+(?:\.\d+)*)?|Wi[ -]?Fi|[A-Za-z]{1,8}\d{1,4}[A-Za-z]{0,6}(?:[ -]+(?:Pro|Max|Ultra|Plus|Mini))*)(?![A-Za-z0-9+-]|\.\d|[ -]+(?:Pro|Max|Ultra|Plus|Mini)\b)/gi)||[];
    for(const candidate of candidates) {
      let term;try{term=cleanTerm(candidate);}catch{continue;}
      const key=identity(term);if(seen.has(key))continue;
      if(terms.length>=GLOSSARY_LIMITS.terms||count+[...term].length>GLOSSARY_LIMITS.totalChars)continue;
      terms.push(term);seen.add(key);count+=[...term].length;
    }
  }
  return terms;
}

const escapeRegex=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function canonicalizeTerms(input, terms=[]) {
  const text=String(input??'');
  const clean=parseTerms(terms.join('\n')).filter(t=>/^[A-Za-z][A-Za-z0-9 .+-]*$/.test(t));
  const forms=clean.map(term=>({term,key:identity(term)})).sort((a,b)=>b.key.length-a.key.length);
  if(!forms.length)return {text,changes:0};
  const byKey=new Map(forms.map(x=>[x.key,x.term]));
  const pattern=forms.map(x=>[...x.key].map(escapeRegex).join('[ \\t-]*')).join('|');
  const re=new RegExp('(?<![A-Za-z0-9+-])(?:'+pattern+')(?![A-Za-z0-9+-]|\\.\\d|[ \\t-]+(?:Pro|Max|Ultra|Plus|Mini)\\b)','gi');
  let changes=0;
  const result=text.replace(re,match=>{const canonical=byKey.get(identity(match));if(canonical!==match)changes++;return canonical;});
  return {text:result,changes};
}
