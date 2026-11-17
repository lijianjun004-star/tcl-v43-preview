'use strict';
// Optional read-only authoritative ID-set snapshot for the synthetic admin check.
// No network by default. Never outputs IDs or submission contents.
const fs=require('node:fs'),path=require('node:path');
const {management,pg}=require('./accept-cloud.cjs');
async function main(args=process.argv.slice(2)){
 if(!args.length){process.stdout.write('{"status":"DRY_RUN_ZERO_NETWORK","scope":"read-only submission IDs into private fixture directory"}\n');return;}
 if(args.length!==2||args[0]!=='--execute')throw Error();
 const dir=path.resolve(args[1]),file=path.join(dir,'fixture.json'),stat=fs.lstatSync(file);
 if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o077))throw Error();
 const f=JSON.parse(fs.readFileSync(file,'utf8'));
 if(f.envId!=='unknown-roadrunner-d7cap6e21f517'||f.testOnly!==true||f.executionApproved!==true)throw Error();
 const output=path.join(dir,'submission-index-before-extra.json');if(fs.existsSync(output))throw Error();
 const index=await pg(await management(),"SELECT jsonb_build_object('ids',coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb))::text AS result FROM public.r25wf_submissions");
 if(!Array.isArray(index.ids)||index.ids.some(x=>typeof x!=='string'))throw Error();
 fs.writeFileSync(output,JSON.stringify({...index,snapshotAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({status:'READ_ONLY_SUBMISSION_INDEX_SAVED',count:index.ids.length})+'\n');
}
if(require.main===module)main().catch(()=>{process.stdout.write('{"status":"FAIL","error":"Controlled private snapshot failure; raw details omitted"}\n');process.exitCode=1;});
