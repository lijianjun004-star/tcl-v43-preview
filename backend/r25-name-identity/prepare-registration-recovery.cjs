'use strict';
// Offline administrator helper. Makes no cloud calls; never prints a recovery
// secret. The private snapshot must come from the trusted database console.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const ENV_ID='unknown-roadrunner-d7cap6e21f517';
function prepare(snapshot,{randomBytes=crypto.randomBytes}={}) {
 const keys=['envId','reservationId','operationId','name','role','operationProof'];
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||Object.keys(snapshot).length!==keys.length||keys.some(k=>typeof snapshot[k]!=='string')||Object.keys(snapshot).some(k=>!keys.includes(k)))throw Error('INVALID_SNAPSHOT');
 const {envId,reservationId,operationId,name,role,operationProof}=snapshot;
 if(envId!==ENV_ID||!/^[a-f0-9-]{36}$/.test(reservationId)||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(operationId)||!['anchor','operator'].includes(role)||!/^[a-f0-9]{64}$/.test(operationProof))throw Error('INVALID_SNAPSHOT');
 if(name!==name.normalize('NFKC').trim()||![...name].length||[...name].length>40||/[\p{Cc}\p{Cf}]/u.test(name))throw Error('INVALID_SNAPSHOT');
 const operationSecret=randomBytes(32).toString('hex');
 if(!/^[a-f0-9]{64}$/.test(operationSecret))throw Error('INVALID_ENTROPY');
 const newProof=crypto.createHash('sha256').update(operationSecret,'utf8').digest('hex');
 if(newProof===operationProof)throw Error('INVALID_ENTROPY');
 const payload={reservationId,operationId,name,role,expectedProof:operationProof,newProof};
 // Base64 literal contains no SQL punctuation from user-provided names.
 const encoded=Buffer.from(JSON.stringify(payload),'utf8').toString('base64');
 const sql="BEGIN;\nSELECT public.r25wf_name_recovery_rotate(convert_from(decode('"+encoded+"','base64'),'UTF8')::jsonb) AS recovery_result;\nCOMMIT;\n";
 const code='R25REC1.'+Buffer.from(JSON.stringify({version:1,envId,name,role,operationId,operationSecret}),'utf8').toString('base64url');
 return {sql,code};
}
function main(args=process.argv.slice(2)) {
 if(args.length!==2)throw Error('USAGE: node prepare-registration-recovery.cjs PRIVATE_SNAPSHOT.json NEW_PRIVATE_OUTPUT_DIRECTORY');
 const [input,directory]=args;
 const stat=fs.statSync(input);
 if(!stat.isFile()||stat.size>4096)throw Error('INVALID_SNAPSHOT_FILE');
 const result=prepare(JSON.parse(fs.readFileSync(input,'utf8')));
 // Refuse an existing output directory: no overwrite of a prior private code.
 fs.mkdirSync(directory,{mode:0o700});
 fs.writeFileSync(path.join(directory,'rotate-proof.sql'),result.sql,{mode:0o600,flag:'wx'});
 fs.writeFileSync(path.join(directory,'recovery-code.txt'),result.code+'\n',{mode:0o600,flag:'wx'});
 process.stdout.write('Prepared private files. Apply rotate-proof.sql through the trusted database console. Distribute recovery-code.txt privately only after rotated=true. No cloud calls were made.\n');
}
if(require.main===module){try{main();}catch(error){process.stderr.write((error.message.startsWith('USAGE:')?error.message:'Recovery preparation failed; check the private snapshot and a new output directory.')+'\n');process.exitCode=1;}}
module.exports={prepare,main,ENV_ID};
