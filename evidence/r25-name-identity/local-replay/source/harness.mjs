/** Independent local test helper. Never imports the real provider or reads process credentials. */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {createDatabase,withIdentity} from './bootstrap.mjs';
const root=path.dirname(new URL(import.meta.url).pathname);
const product='/workspace/tcl-r25-name-login/backend/r25-name-identity';
export const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
export const md5=value=>crypto.createHash('md5').update(value).digest('hex');
export async function loadDatabase(dataDir="memory://"){
 const db=await createDatabase(dataDir);
 const base=await fs.readFile('/workspace/tcl-r25-name-login/backend/r25-cloudbase/schema.sql','utf8');
 const service=await fs.readFile(path.join(product,'001-name-identity.sql'),'utf8');
 await db.exec(base);await seedFixtures(db);await db.exec(service);
 return{db,baseSha:sha(base),serviceSha:sha(service)};
}
export function databaseTransport(db){return async(action,payload={})=>withIdentity(db,{role:'service_role'},async()=>(await db.query('SELECT public.r25wf_name_identity_service($1,$2::jsonb) AS result',[action,JSON.stringify(payload)])).rows[0].result)};
export function nativeFixture(){
 const users=new Map(),calls=[];let serial=0,hold=null,afterCreateError=null;
 return{users,calls,
   holdCreate:()=>{let release;hold=new Promise(r=>release=r);return()=>{release();hold=null}},
   failAfterNextCreate:code=>afterCreateError=code,
   createNativeUser:async({username,password,displayName,marker})=>{
    calls.push({method:'createNativeUser',username,displayName,marker,passwordPresent:typeof password==='string'});
    if(hold)await hold;
    if(users.has(username)){const e=new Error('synthetic duplicate');e.code='USER_EXISTS';throw e}
    const user={uid:'local-created-'+(++serial),username,description:marker,status:'ACTIVE'};users.set(username,user);
    if(afterCreateError){const e=new Error('synthetic ambiguous native reply');e.code=afterCreateError;afterCreateError=null;throw e}
    return{uid:user.uid,username};
   },
   findNativeUser:async username=>{calls.push({method:'findNativeUser',username});return users.get(username)||null}
 };
}
export async function seedFixtures(db){
 if((await db.query("SELECT count(*)::int n FROM public.r25wf_users WHERE uid='local-admin'")).rows[0].n)return;
 await db.exec(`INSERT INTO public.r25wf_users(uid,role,display_name) VALUES
 ('local-admin','admin','本地管理员'),('local-operator','operator','本地运营'),
 ('legacy-one','anchor','旧成员甲'),('legacy-two','anchor','同名旧成员'),('legacy-three','anchor','同名旧成员')`);
}
export async function seedInvite(db,{code,role='anchor',id=crypto.randomUUID(),targetUid=null,expired=false,creator='local-admin'}){
 await db.query(`INSERT INTO public.r25wf_invites(id,code_hash,role,display_name,target_uid,created_by,expires_at)
 VALUES($1,$2,$3,'',$4,$5,clock_timestamp()+$6::interval)`,[id,md5(code.toLowerCase()),role,targetUid,creator,expired?'-1 hour':'48 hours']);return{id,code};
}
export async function writeReport(filename,report){await fs.writeFile(path.join(root,filename),JSON.stringify(report,null,2)+'\n')}
