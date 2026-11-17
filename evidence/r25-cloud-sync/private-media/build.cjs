const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const modules='/workspace/tcl-cloud-tools/node_modules';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const sdk=JSON.parse(fs.readFileSync(path.join(modules,'@cloudbase/js-sdk/package.json')));
 if(sdk.version!=='3.11.1')throw new Error('Expected official stable SDK3.11.1');
 await require(path.join(modules,'esbuild')).build({entryPoints:[path.join(__dirname,'media-client.mjs')],bundle:true,platform:'browser',format:'iife',globalName:'R25MediaSDK',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],outfile:path.join(__dirname,'media-client.bundle.js'),logLevel:'silent'});
 const result={sdkVersion:sdk.version,entrySha256:sha(fs.readFileSync(path.join(__dirname,'media-client.mjs'))),bundleSha256:sha(fs.readFileSync(path.join(__dirname,'media-client.bundle.js'))),networkExecuted:false};
 fs.writeFileSync(path.join(__dirname,'adapter-build.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
})().catch(()=>{console.error('BUILD_FAILED_NO_CLOUD_OPERATION');process.exitCode=1});
