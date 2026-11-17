/** localPGmock-auth storage mock; tests PostgreSQL policies, not actual Storage API/blob content. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {withIdentity,scope} from './bootstrap.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),report={scope,checks:[],errors:[],cloudCalls:0,actualStorageApi:false};
const db=new PGlite(path.join(root,'pg-data'),{extensions:{pgcrypto}});await db.waitReady;
function check(name,ok,detail){report.checks.push({name,pass:!!ok,...(detail===undefined?{}:{detail})});assert.ok(ok,name+': '+JSON.stringify(detail));}
async function as(uid,fn,role='authenticated'){return withIdentity(db,{uid,role},fn)}
async function rpc(uid,action,payload={},key='media-op-'+crypto.randomUUID()){return as(uid,async()=>(await db.query('SELECT public.r25wf_api($1,$2::jsonb,$3) as result',[action,JSON.stringify(payload),key])).rows[0].result)}
async function rejected(name,fn){let e;try{await fn()}catch(err){e=err}check(name,!!e,e?{code:e.code,message:e.message}:undefined)}
async function rows(uid,sql,args=[],role='authenticated'){return as(uid,async()=>(await db.query(sql,args)).rows,role)}
const a='000123',b='local-anchor-B',opA='local-operator-A',opB='local-operator-B';
try{
 const sql=await fs.readFile('/workspace/tcl-r25-cloud/backend/r25-cloudbase/media-storage.sql','utf8');report.mediaPolicySha256=crypto.createHash('sha256').update(sql).digest('hex');
 await db.exec(sql);check('media_policy_applies',true);
 await db.exec(`INSERT INTO storage.buckets(id,name,public) VALUES('legacy-local','legacy-local',true)`);
 await as(a,()=>db.query("INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('r25wf-private',$1,$2,$3::jsonb)",[a+'/audio-A.wav',a,JSON.stringify({size:20,mimetype:'audio/wav'})]));check('owner_can_insert_immutable_audio',true);
 await rejected('foreign_path_insert_blocked',()=>as(b,()=>db.query("INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('r25wf-private',$1,$2,$3::jsonb)",[a+'/forged.wav',b,JSON.stringify({size:20,mimetype:'audio/wav'})])));
 await rejected('unbound_user_upload_blocked',()=>as('unbound-local',()=>db.query("INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('r25wf-private','unbound-local/a.wav','unbound-local','{\"size\":20,\"mimetype\":\"audio/wav\"}')")));
 await rejected('malformed_size_is_rejected',()=>as(a,()=>db.query("INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('r25wf-private',$1,$2,$3::jsonb)",[a+'/invalid.wav',a,JSON.stringify({size:'no-number',mimetype:'audio/wav'})])));
 await rejected('oversize_upload_blocked',()=>as(a,()=>db.query("INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('r25wf-private',$1,$2,$3::jsonb)",[a+'/big.wav',a,JSON.stringify({size:52428801,mimetype:'audio/wav'})])));
 await rejected('mime_upload_blocked',()=>as(a,()=>db.query("INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('r25wf-private',$1,$2,$3::jsonb)",[a+'/bad.html',a,JSON.stringify({size:20,mimetype:'text/html'})])));
 check('owner_reads_before_submission',(await rows(a,"SELECT name FROM storage.objects WHERE bucket_id='r25wf-private'")).length===1);
 check('operator_cannot_read_unsubmitted',(await rows(opA,"SELECT name FROM storage.objects WHERE bucket_id='r25wf-private'")).length===0);
 await db.exec(`UPDATE public.r25wf_settings SET value='{"enabled":true}' WHERE key='private_media'`);
 const payload={id:'submission-media-A',operatorId:opA,sessionId:'media-training',snapshot:{turns:[{id:'m1',answer:'本地媒体提交'}]},media:[{path:a+'/audio-A.wav',mime:'audio/wav',size:20}]};
 const created=await rpc(a,'submissions.create',payload,'media-create-key');check('uploaded_media_submission_commits',created.ok===true,created);
 check('receiving_operator_reads_media',(await rows(opA,"SELECT name FROM storage.objects WHERE bucket_id='r25wf-private'")).length===1);
 check('other_operator_cannot_read_media',(await rows(opB,"SELECT name FROM storage.objects WHERE bucket_id='r25wf-private'")).length===0);
 check('other_anchor_cannot_read_media',(await rows(b,"SELECT name FROM storage.objects WHERE bucket_id='r25wf-private'")).length===0);
 check('anon_cannot_read_media',(await rows('',"SELECT name FROM storage.objects WHERE bucket_id='r25wf-private'",[],'anon')).length===0);
 const update=await as(a,()=>db.query("UPDATE storage.objects SET metadata='{}' WHERE bucket_id='r25wf-private' RETURNING name"));check('owner_cannot_update_existing_object',update.rows.length===0,update.rows);
 const del=await as(a,()=>db.query("DELETE FROM storage.objects WHERE bucket_id='r25wf-private' RETURNING name"));check('owner_cannot_delete_existing_object',del.rows.length===0,del.rows);
 await rejected('owner_cannot_overwrite_same_path',()=>as(a,()=>db.query("INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('r25wf-private',$1,$2,'{\"size\":20,\"mimetype\":\"audio/wav\"}')",[a+'/audio-A.wav',a])));
 const duplicate=await rpc(a,'submissions.create',{...payload,id:'submission-media-reuse',sessionId:'another-media-training'});check('object_cannot_bind_two_submissions',duplicate.ok===false&&duplicate.error.code==='MEDIA_ALREADY_ATTACHED',duplicate);
 const badMetadata=await rpc(a,'submissions.create',{...payload,id:'submission-media-size',sessionId:'size-test',media:[{...payload.media[0],size:21}]});check('request_size_must_match_storage',badMetadata.ok===false&&badMetadata.error.code==='MEDIA_INVALID',badMetadata);
 assert.deepEqual(await rpc(a,'submissions.create',payload,'media-create-key'),created);check('media_commit_idempotent_receipt',true);
 await as(a,()=>db.query("INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('legacy-local','local-old','legacy','{}')"));check('legacy_bucket_insert_unchanged',true);
 check('anon_legacy_bucket_read_unchanged',(await rows('',"SELECT name FROM storage.objects WHERE bucket_id='legacy-local'",[],'anon')).length===1);
 await db.query("UPDATE public.r25wf_users SET active=false WHERE uid=$1",[opA]);
 check('disabled_receiver_loses_media_access',(await rows(opA,"SELECT name FROM storage.objects WHERE bucket_id='r25wf-private'")).length===0);
 await db.query("UPDATE public.r25wf_users SET active=true WHERE uid=$1",[opA]);
 report.status='PASS';
}catch(e){report.status='FAIL';report.errors.push({message:e.message,code:e.code,stack:e.stack})}
finally{await db.close();await fs.writeFile(path.join(root,'media-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))}
if(report.status!=='PASS')process.exitCode=1;
