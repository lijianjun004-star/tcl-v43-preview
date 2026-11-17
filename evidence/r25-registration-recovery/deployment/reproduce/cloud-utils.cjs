'use strict';
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const SDK='/workspace/r25-review/final-package-backend/node_modules/';
const {AuthSupervisor}=require(SDK+'@cloudbase/toolbox');
const Manager=require(SDK+'@cloudbase/manager-node');
const ENV='unknown-roadrunner-d7cap6e21f517';
const REGION='ap-shanghai';
const PRIVATE='/workspace/r25-deployment/private';
fs.mkdirSync(PRIVATE,{recursive:true,mode:0o700});
async function manager(){const c=await new AuthSupervisor({throwError:true,timeout:20000,proxy:process.env.HTTPS_PROXY}).getLoginState();if(!c?.secretId||!c?.secretKey)throw Error('OFFICIAL_LOGIN_REQUIRED');return new Manager({envId:ENV,region:REGION,secretId:c.secretId,secretKey:c.secretKey,token:c.token,proxy:process.env.HTTPS_PROXY});}
async function sql(m,Sql){return m.database.executePGSql({Sql,Role:'service_role'});}
function first(response){let r=response?.Response||response;for(let i=0;i<3&&!Array.isArray(r?.Rows)&&r?.Data&&typeof r.Data==='object';i++)r=r.Data;if(!Array.isArray(r.Rows))throw Error('PG_RESPONSE_SHAPE');const row=typeof r.Rows[0]==='string'?JSON.parse(r.Rows[0]):r.Rows[0];let cell=row?.[0];for(let i=0;i<3&&typeof cell==='string';i++){try{cell=JSON.parse(cell);}catch{break;}}return cell;}
function save(name,value){fs.writeFileSync(path.join(PRIVATE,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
module.exports={manager,sql,first,save,sha,ENV,REGION,PRIVATE};
