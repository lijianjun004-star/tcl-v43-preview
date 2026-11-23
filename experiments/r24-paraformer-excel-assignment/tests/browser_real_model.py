#!/usr/bin/env python3
"""Independent real Paraformer browser harness, without any response/model mock.

This is a module-level real-model check, not UI E2E or physical-phone accuracy.
"""
import argparse
import asyncio
import json
import re
import traceback
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright

ROUTE = '/tcl-r24-paraformer-excel-qa/'
SAMPLE_SHA = 'a1bd32dc78493c123f9625a66deee562aed2895f53fbc39f2cca3be7e6f4f20f'
MANIFEST_SHA = '9a9538a91e1ba4230577d1a4410fe4ac429039ced6478af15346e378cedc6df2'
CACHE_NAME = 'tcl-r24-paraformer-excel-qa-assets-1.12.20-v1'

HARNESS = r"""async ({route,samplePin,manifestPin,cacheName}) => {
  const hash = async buffer => [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const diagnostics=[],progress=[];
  const module = await import(route+'paraformer-bridge.mjs');
  const asr = module.createLocalParaformer({onProgress:msg=>progress.push(String(msg)),onDiagnostic:d=>diagnostics.push(d),loadTimeoutMs:180000,inferTimeoutMs:120000});
  const result={diagnostics,progress,cacheBefore:await caches.keys()};
  let disposed=false;
  try {
    const sample=await fetch('/fixtures/public-mandarin.wav');
    if(!sample.ok) throw new Error('Public sample HTTP '+sample.status);
    const audio=await sample.blob();
    result.sample={bytes:audio.size,sha256:await hash(await audio.arrayBuffer()),type:audio.type};
    if(audio.size!==177572 || result.sample.sha256!==samplePin) throw new Error('Public sample bytes do not match the explicit source pin');
    const manifestURL=route+'vendor/paraformer/manifest.json';
    const manifestResponse=await fetch(manifestURL);
    if(!manifestResponse.ok)throw new Error('Model manifest HTTP '+manifestResponse.status);
    const manifestBytes=await manifestResponse.arrayBuffer();
    result.manifest={sha256:await hash(manifestBytes),bytes:manifestBytes.byteLength};
    if(result.manifest.sha256!==manifestPin)throw new Error('Model manifest pin mismatch');
    const manifest=JSON.parse(new TextDecoder().decode(manifestBytes));
    result.model={version:manifest.version,runtime:manifest.runtime,source:manifest.source};
    const started=performance.now();
    await asr.preload();
    result.loadMilliseconds=performance.now()-started;
    const inferStarted=performance.now();
    result.transcription=await asr(audio);
    result.inferMilliseconds=performance.now()-inferStarted;
    result.busyAfterInference=asr.isResourceBusy();
    result.cacheAfter=await caches.keys();
    if(!result.cacheAfter.includes(cacheName))throw new Error('QA model cache namespace not created');
    const cache=await caches.open(cacheName),entries=[];
    const all=[{file:'manifest.json',bytes:manifestBytes.byteLength,sha256:manifestPin},...Object.values(manifest.files)];
    for(const entry of all){
      const u=new URL(route+'vendor/paraformer/'+entry.file,location.origin).href;
      const hit=await cache.match(u);
      if(!hit)throw new Error('Verified model cache missing '+entry.file);
      const data=await hit.arrayBuffer();
      const row={file:entry.file,bytes:data.byteLength,sha256:await hash(data),expectedBytes:entry.bytes,expectedSha256:entry.sha256};
      if(row.bytes!==entry.bytes||row.sha256!==entry.sha256)throw new Error('Independent cache readback mismatch '+entry.file);
      entries.push(row);
    }
    result.cacheReadback=entries;
    asr.dispose();disposed=true;
    result.busyAfterDispose=asr.isResourceBusy();
    result.released=diagnostics.some(d=>d.stage==='worker-released');
    return result;
  } finally {if(!disposed)asr.dispose();}
}"""


async def run(args):
    out=Path(args.evidence);out.mkdir(parents=True,exist_ok=True)
    base=args.base_url.rstrip('/');allowed_host=urlparse(base).netloc
    rows=[];errors=[];requests=[];http_failures=[];result=None;failure=None
    def check(name,condition,detail=None):
        row={'name':name,'pass':bool(condition),'detail':detail};rows.append(row)
        print(json.dumps(row,ensure_ascii=False),flush=True)
        if not condition:raise AssertionError(name+': '+str(detail))
    try:
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(headless=True)
            context=await browser.new_context(viewport={'width':390,'height':844})
            context.on('request',lambda req: requests.append({'url':req.url,'method':req.method,'type':req.resource_type}))
            context.on('response',lambda response:http_failures.append({'url':response.url,'status':response.status}) if response.status>=400 and urlparse(response.url).path!='/favicon.ico' else None)
            page=await context.new_page()
            page.on('pageerror',lambda exc:errors.append({'pageerror':str(exc)}))
            page.on('console',lambda msg:errors.append({'console':msg.text,'location':msg.location}) if msg.type=='error' and urlparse(msg.location.get('url','')).path!='/favicon.ico' else None)
            try:
                await page.goto(base+ROUTE,wait_until='networkidle',timeout=30000)
                result=await asyncio.wait_for(page.evaluate(HARNESS,{'route':ROUTE,'samplePin':SAMPLE_SHA,'manifestPin':MANIFEST_SHA,'cacheName':CACHE_NAME}),timeout=350)
                check('public source recording exact SHA and size',result['sample']['sha256']==SAMPLE_SHA and result['sample']['bytes']==177572,result['sample'])
                check('fixed official model manifest SHA',result['manifest']['sha256']==MANIFEST_SHA,result['manifest'])
                check('real Mandarin inference returned nonempty Chinese',bool(re.search(r'[\u3400-\u9fff]',result['transcription'].get('text',''))),result['transcription'])
                check('real engine reports ParaformerSmall',result['transcription'].get('model')=='ParaformerSmall-int8')
                check('one short public sample completed in full',4.0<result['transcription'].get('duration',0)<7.0 and len(result['transcription'].get('chunks',[]))==1,result['transcription'].get('duration'))
                check('five cache files independently rehashed',len(result['cacheReadback'])==5,result['cacheReadback'])
                check('QA cache does not use official storage key',CACHE_NAME in result['cacheAfter'] and 'tcl-r24-paraformer-assets-1.12.20-v1' not in result['cacheAfter'],result['cacheAfter'])
                check('real worker readiness and inference observed',any(x.get('stage')=='model-ready' for x in result['diagnostics']) and any(x.get('stage')=='inference-complete' for x in result['diagnostics']))
                check('worker disposed and resource lock released',result['released'] and not result['busyAfterDispose'] and not result['busyAfterInference'])
                external=[r for r in requests if r['url'].startswith(('http://','https://')) and urlparse(r['url']).netloc!=allowed_host]
                uploads=[r for r in requests if r['method'] not in ('GET','HEAD','OPTIONS')]
                check('no external model/audio requests',not external,external)
                check('no audio-upload or mutation requests',not uploads,uploads)
                check('no browser errors',not errors,errors)
                check('no failing business resources',not http_failures,http_failures)
            finally:await browser.close()
    except Exception:failure=traceback.format_exc()
    report={'checks':rows,'passed':sum(r['pass'] for r in rows),'failure':failure,'result':result,'errors':errors,'http_failures':http_failures,'requests':requests,'scope':'Independent real Chromium module harness with actual Paraformer bridge/Worker/WASM/model and pinned public Mandarin WAV. No model/request mocks. Not full UI E2E, physical-phone acceptance, TCL speech validation, or a measured speech accuracy claim.'}
    (out/'browser-real-model-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'passed':report['passed'],'failure':failure},ensure_ascii=False),flush=True)
    if failure:raise SystemExit(1)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--base-url',required=True);parser.add_argument('--evidence',required=True)
    asyncio.run(run(parser.parse_args()))
