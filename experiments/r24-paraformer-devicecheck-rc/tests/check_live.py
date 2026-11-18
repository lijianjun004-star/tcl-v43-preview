import hashlib, json, os, sys, time, urllib.request, ssl
BASE='https://lijianjun004-star.github.io/tcl-v43-preview/tcl-r24-paraformer/'
pkg=sys.argv[1]
model={'sherpa-onnx-asr.js':(41274,'ab619fbad082d474ef35616072d3ace7e8f533d3725c611c1c60d7b97cac41c9'),
'sherpa-onnx-wasm-main-vad-asr.js':(95311,'3e0cbcad90833164f04097e51fbc99b8812dc03977382578fb73eba7f5d13ec4'),
'sherpa-onnx-wasm-main-vad-asr.wasm':(11539169,'2fc8dc389b23ad07f0d526b2e7c7c828543956d053db858d73cff192be7589e3'),
'sherpa-onnx-wasm-main-vad-asr.data':(82547881,'9b89b7afaf5375704e758e85e88955abab381f81c466b24ecc7320b24d81b80f')}
exp={}
for root,_,fs in os.walk(pkg):
    for f in fs:
        p=os.path.join(root,f); rel=os.path.relpath(p,pkg)
        b=open(p,'rb').read(); exp[rel]=(len(b),hashlib.sha256(b).hexdigest())
for k,v in model.items(): exp['vendor/paraformer/'+k]=v
ctx=ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE') or '/root/.ccr/ca-bundle.crt')
res=[]
for rel in sorted(exp):
    url=BASE+rel+'?v=recheck'+str(int(time.time()))
    try:
        r=urllib.request.urlopen(urllib.request.Request(url,headers={'Cache-Control':'no-cache'}),context=ctx,timeout=180)
        b=r.read(); st=r.status
    except Exception as e:
        res.append((rel,'ERR',str(e)[:80])); continue
    ok = st==200 and len(b)==exp[rel][0] and hashlib.sha256(b).hexdigest()==exp[rel][1]
    res.append((rel,st,'MATCH' if ok else f'MISMATCH len={len(b)}'))
bad=[r for r in res if r[2]!='MATCH']
for r in res: print(*r)
print('TOTAL',len(res),'MATCH',len(res)-len(bad),'BAD',len(bad))
