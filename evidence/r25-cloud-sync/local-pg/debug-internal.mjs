import fs from 'node:fs/promises';
import {createDatabase,withIdentity} from './bootstrap.mjs';
const source=await fs.readFile('/workspace/tcl-r25-cloud/backend/r25-cloudbase/schema.sql','utf8');
const sql=source.replace("RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INTERNAL_ERROR','message','云端未确认完成，请保留本机内容并重试原操作'));",'RAISE;');
await fs.writeFile('schema-debug.sql',sql);
const db=await createDatabase();await db.exec(sql);await db.exec("INSERT INTO public.r25wf_users(uid,role,display_name) VALUES('local-admin','admin','local')");
try{console.log(await withIdentity(db,{uid:'local-admin'},()=>db.query("SELECT public.r25wf_api('invites.create','{\"role\":\"operator\",\"targetUid\":\"local-operator-A\",\"displayName\":\"opA\"}','debug-create')")));}
catch(e){console.log(JSON.stringify(e,Object.getOwnPropertyNames(e),2))}
finally{await db.close()}
