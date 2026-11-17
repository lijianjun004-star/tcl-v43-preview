'use strict';
// Root may deploy this READ-ONLY probe as Event(index main) first and map only
// its own HTTP service path. It never reads body, creates users or prints errors.
const {createProvider}=require('./provider-cloudbase.cjs');
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
async function probe(){return await createProvider().probeReadOnly();}
exports.main=async event=>{
  const method=event?.httpMethod||event?.requestContext?.httpMethod;
  if(method&&method!=='GET')return {statusCode:405,headers,body:JSON.stringify({ok:false,code:'READONLY_GET_ONLY'})};
  const data=await probe();
  return method||event?.headers?{statusCode:200,headers,body:JSON.stringify(data),isBase64Encoded:false}:data;
};
// Optional HTTP/Web bootstrap entry for comparison only. Credentials are never
// taken from client headers. Event + service gateway is the preferred probe.
if(require.main===module){
  require('node:http').createServer(async(req,res)=>{
    req.resume();
    if(req.method!=='GET'){res.writeHead(405,headers);res.end(JSON.stringify({ok:false,code:'READONLY_GET_ONLY'}));return;}
    try{const data=await probe();res.writeHead(200,headers);res.end(JSON.stringify(data));}
    catch{res.writeHead(503,headers);res.end(JSON.stringify({ok:false,code:'PROBE_UNAVAILABLE'}));}
  }).listen(Number(process.env.PORT)||9000,'0.0.0.0');
}
