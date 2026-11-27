"""Offline character error and keyword comparison after transcription. Standard library only."""
from argparse import ArgumentParser
from collections import Counter
from pathlib import Path
import json
import re
import unicodedata

def canon(text):
    # Keep letters, digits, combining marks and all Han characters. Only case, width,
    # punctuation and whitespace are normalized. Numeral spellings remain visible in CER.
    return ''.join(c for c in unicodedata.normalize('NFKC',text).casefold()
                   if not c.isspace() and not unicodedata.category(c).startswith('P'))

def edits(ref, hyp):
    # For equal-cost paths prefer substitution, deletion, insertion (in that order).
    table=[[0]*(len(hyp)+1) for _ in range(len(ref)+1)]
    for j in range(len(hyp)+1): table[0][j]=j
    for i,a in enumerate(ref,1):
        table[i][0]=i
        for j,b in enumerate(hyp,1):
            table[i][j]=min(table[i-1][j-1]+(a!=b),table[i-1][j]+1,table[i][j-1]+1)
    i,j=len(ref),len(hyp)
    events=[]
    while i or j:
        if i and j and table[i][j]==table[i-1][j-1]+(ref[i-1]!=hyp[j-1]):
            if ref[i-1]!=hyp[j-1]:
                events.append({'op':'substitution','refIndex':i-1,'hypIndex':j-1,'from':ref[i-1],'to':hyp[j-1]})
            i-=1;j-=1
        elif i and table[i][j]==table[i-1][j]+1:
            events.append({'op':'deletion','refIndex':i-1,'hypIndex':j,'from':ref[i-1],'to':''});i-=1
        else:
            events.append({'op':'insertion','refIndex':i,'hypIndex':j-1,'from':'','to':hyp[j-1]});j-=1
    return list(reversed(events))

def keywords(text):
    keys=['TCL','T5M','T7M','尺寸','核对官方资料']
    normalized=canon(text)
    def hit(key, x):
        if key.isascii():
            return bool(re.search(r'(?<![a-z0-9])'+re.escape(key.casefold())+r'(?![a-z0-9])',x))
        return key in x
    # These two aliases only assess spoken-digit equivalence; preserve literal coverage separately.
    with_aliases=re.sub(r'(?<![a-z0-9])t([五七])m(?![a-z0-9])',lambda m:'t'+{'五':'5','七':'7'}[m[1]]+'m',normalized)
    return {key:{'literal':hit(key,normalized),'spokenDigitEquivalent':hit(key,with_aliases)} for key in keys}

parser=ArgumentParser(description='Compare the held-out gold to .txt or an OpenAI transcription JSON with text.')
parser.add_argument('gold',type=Path)
parser.add_argument('transcript',type=Path)
args=parser.parse_args()
reference=args.gold.read_text(encoding='utf-8').strip()
hyp=args.transcript.read_text(encoding='utf-8').strip()
if args.transcript.suffix.lower()=='.json': hyp=json.loads(hyp)['text']
if not isinstance(hyp,str): raise ValueError('响应 text 必须为字符串')
r,h=canon(reference),canon(hyp)
if not r: raise ValueError('参考文本为空')
if max(len(r),len(h))>3000: raise ValueError('该验收脚本用于短音频，限 3000 个规范化字符')
trace=edits(r,h);counts=Counter(event['op'] for event in trace)
flags=keywords(hyp)
out={
 'reference':reference,'transcription':hyp,'referenceNormalized':r,'transcriptionNormalized':h,
 'referenceCharacters':len(r),'transcriptionCharacters':len(h),'edits':len(trace),'CER':len(trace)/len(r),
 'substitutions':counts['substitution'],'deletions':counts['deletion'],'insertions':counts['insertion'],
 'keywordMatches':flags,'literalKeywordsMatched':sum(x['literal'] for x in flags.values()),'keywordCount':len(flags),
 'editOperations':trace,
 'policy':'NFKC、casefold、忽略标点和空白；CER 保留中英文和数字原字形，含替换、删除、插入，可超过 1。关键词采用固定品牌型号及短语；仅在另一栏将 T五M/T七M 视为同音型号。'
}
print(json.dumps(out,ensure_ascii=False,indent=2))
