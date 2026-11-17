'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const moduleRoot=process.env.R25_E2E_NODE_MODULES||'/workspace/tcl-cloud-tools/node_modules';
const esbuild=require(path.join(moduleRoot,'esbuild'));
const root=__dirname,out=path.join(root,'browser-client.bundle.js');
(async()=>{
 const sdk=JSON.parse(fs.readFileSync(path.join(moduleRoot,'@cloudbase/js-sdk/package.json')));
 const result=await esbuild.build({entryPoints:[path.join(root,'browser-client.mjs')],bundle:true,platform:'browser',format:'iife',globalName:'R25AcceptanceSDK',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[moduleRoot],outfile:out,metafile:true,logLevel:'silent'});
 const bytes=fs.readFileSync(out);
 fs.writeFileSync(path.join(root,'adapter-build.json'),JSON.stringify({sdk:sdk.name,sdkVersion:sdk.version,bundleBytes:bytes.length,bundleSha256:crypto.createHash('sha256').update(bytes).digest('hex'),entrySha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'browser-client.mjs'))).digest('hex'),networkExecuted:false},null,2)+'\n');
 console.log(JSON.stringify({status:'BUILD_ONLY',sdkVersion:sdk.version,bytes:bytes.length,networkExecuted:false}));
})().catch(()=>{console.error('Adapter build failed. Inspect local dependencies; no credentials or cloud operation were used.');process.exitCode=1});
