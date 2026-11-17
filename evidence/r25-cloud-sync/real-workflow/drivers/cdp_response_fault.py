"""Bounded real-Chromium response-stage fault injection. Never prints raw requests/errors."""
import hashlib,json,time,uuid
def sha(value):return hashlib.sha256(value if isinstance(value,bytes) else value.encode()).hexdigest()
def verify_lost_response(live,browser,run,task_id):
 # Response-stage CDP interception uses the real Chromium transport. No Route.fetch.
 lost_id=str(uuid.uuid4());lost_op=str(uuid.uuid4());lost_payload=live.contract.submission(run+'-lost-response',task_id,live.uid['operator'],str(uuid.uuid4()),lost_id);drops=[];fault_errors=[]
 page=live.pages['anchor'];context=live.contexts['anchor'];cdp=context.new_cdp_session(page)
 def pause_response(event):
  request_id=event.get('requestId')
  try:
   if lost_op not in event.get('request',{}).get('postData',''):
    return cdp.send('Fetch.continueResponse' if 'responseStatusCode' in event else 'Fetch.continueRequest',{'requestId':request_id})
   raw=cdp.send('Fetch.getResponseBody',{'requestId':request_id})
   import base64
   body=base64.b64decode(raw['body']) if raw.get('base64Encoded') else raw['body'].encode()
   parsed=json.loads(body)
   drops.append({'status':event.get('responseStatusCode'),'serverEnvelopeConfirmed':isinstance(parsed,dict) and parsed.get('ok') is True,'bodySha256':sha(body),'transport':'real Chromium response stage'})
   live.report['droppedResponses']=drops;live.record()
   cdp.send('Fetch.failRequest',{'requestId':request_id,'errorReason':'ConnectionClosed'})
  except Exception as error:
   fault_errors.append({'type':type(error).__name__,'stage':'CDP response interception; raw message omitted'})
   try:cdp.send('Fetch.failRequest',{'requestId':request_id,'errorReason':'Aborted'})
   except Exception:pass
 cdp.on('Fetch.requestPaused',pause_response);cdp.send('Fetch.enable',{'patterns':[{'urlPattern':'*'+live.contract.data.get('rpcName','r25wf_api')+'*','requestStage':'Response'}]})
 page.evaluate('args=>{window.__r25LossOutcome=null;window.__r25AcceptanceClient.call(...args).then(result=>{window.__r25LossOutcome=result});return true}',[live.contract.action('submissionCreate'),lost_payload,lost_op])
 deadline=time.monotonic()+45
 while not drops and not fault_errors and time.monotonic()<deadline:page.wait_for_timeout(100)
 live.report['faultCallbackErrors']=fault_errors
 live.check('lost_response_fault_reached_real_successful_server_commit',bool(drops) and not fault_errors and all(x['status']==200 and x['serverEnvelopeConfirmed'] for x in drops),drops)
 observed=page.evaluate('()=>({settled:window.__r25LossOutcome!==null,confirmed:window.__r25LossOutcome?.ok===true})')
 live.check('lost_response_not_reported_as_confirmed_to_client',not observed['confirmed'],observed)
 live.report['operations'].append({'actor':'anchor','action':live.contract.action('submissionCreate'),'operationId':lost_op,'ok':None,'fault':'Server response paused/verified/dropped; original client context closed before confirmation'})
 context.close();live.pages.pop('anchor');live.contexts.pop('anchor');live.actor(browser,'anchor')
 recovered=live.contract.entity(live.call('anchor','submissionCreate',lost_payload,lost_op)['data'],'submission')
 rows=live.contract.rows(live.call('operator','submissionList')['data']);live.check('retry_after_committed_lost_response_creates_exactly_one_submission',live.contract.id(recovered)==lost_id and sum(live.contract.id(x)==lost_id for x in rows)==1)
 return lost_id
