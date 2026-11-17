import cloudbase from '@cloudbase/js-sdk';
const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
const need=(ok,step)=>{if(!ok)throw Object.assign(new Error(step),{step});};
export async function run(config,suffix){
  const report={scope:'REAL browser MediaRecorder using synthetic canvas+oscillator; real CloudBase upload/download; no real phone/camera/microphone',steps:[]};
  const mark=(step,detail)=>report.steps.push({step,pass:true,detail});
  const app=cloudbase.init({...config,debug:false}),auth=app.auth();
  let context,interval,stream,video,url;
  try{
    const session=await auth.getSession();need(!session.error&&session.data.session,'native_session');
    const user=session.data.session.user,uid=String(user.id||user.uid);need(!!uid,'native_uid');mark('native_session_restored');
    need(typeof MediaRecorder==='function','media_recorder_available');
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const graphics=canvas.getContext('2d');let frame=0;
    const draw=()=>{graphics.fillStyle=frame%2?'#182f56':'#24654b';graphics.fillRect(0,0,320,180);graphics.fillStyle='#fff';graphics.font='18px sans-serif';graphics.fillText('SYNTHETIC R25 VIDEO',30,60);graphics.beginPath();graphics.arc(30+(frame*11)%260,120,16,0,2*Math.PI);graphics.fill();frame++;};
    draw();interval=setInterval(draw,100);
    context=new AudioContext();const osc=context.createOscillator(),gain=context.createGain(),dest=context.createMediaStreamDestination();
    osc.frequency.value=440;gain.gain.value=.05;osc.connect(gain);gain.connect(dest);osc.start();await context.resume();
    stream=new MediaStream([...canvas.captureStream(10).getVideoTracks(),...dest.stream.getAudioTracks()]);
    const mime='video/webm;codecs=vp8,opus';need(MediaRecorder.isTypeSupported(mime),'webm_vp8_opus_available');
    const recorder=new MediaRecorder(stream,{mimeType:mime});const chunks=[];
    const recorded=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=resolve;recorder.onerror=()=>reject(Object.assign(new Error('recording_failed'),{step:'recording_failed'}));});
    recorder.start(100);await new Promise(r=>setTimeout(r,1600));recorder.stop();await recorded;
    const blob=new Blob(chunks,{type:mime}),before=await hash(await blob.arrayBuffer());need(blob.size>1000,'recorded_nonempty_webm');
    mark('actual_media_recorder_produced_webm',{bytes:blob.size,mime,canvasFrames:frame});
    stream.getTracks().forEach(t=>t.stop());clearInterval(interval);interval=null;await context.close();context=null;
    const path=uid+'/'+suffix,bucket=app.storage.from('r25wf-private');
    const uploaded=await bucket.upload(path,blob,{contentType:'video/webm',upsert:false});need(!uploaded.error,'private_webm_upload');mark('private_webm_upload');
    const downloaded=await bucket.download(path);need(!downloaded.error&&downloaded.data instanceof Blob,'private_webm_download');
    const after=await hash(await downloaded.data.arrayBuffer());need(before===after&&downloaded.data.size===blob.size,'webm_byte_hash_roundtrip');
    mark('webm_byte_hash_roundtrip',{bytes:blob.size,sha256:after});
    video=document.createElement('video');video.muted=true;video.playsInline=true;video.width=320;video.height=180;document.body.append(video);
    url=URL.createObjectURL(downloaded.data);video.src=url;
    const ended=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Object.assign(new Error('playback_timeout'),{step:'playback_timeout'})),9000);video.onended=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(Object.assign(new Error('decode_failed'),{step:'decode_failed'}));};});
    await video.play();await ended;
    const quality=video.getVideoPlaybackQuality();need(video.videoWidth===320&&video.videoHeight===180&&quality.totalVideoFrames>0,'actual_webm_decoded_and_played_to_end');
    mark('actual_webm_decoded_and_played_to_end',{width:video.videoWidth,height:video.videoHeight,decodedFrames:quality.totalVideoFrames,droppedFrames:quality.droppedVideoFrames,durationSeconds:Number.isFinite(video.duration)?video.duration:null});
    report.status='PASS_SYNTHETIC_WEBM_ROUNDTRIP_PLAYBACK';report.objectKeyTemplate='<anchor_uid>/'+suffix;
  }catch(error){report.status='FAIL';report.failedStep=error.step||'Unexpected browser/SDK error (text suppressed)';}
  finally{if(stream)stream.getTracks().forEach(t=>t.stop());if(interval)clearInterval(interval);if(context&&context.state!=='closed')await context.close();if(video)video.remove();if(url)URL.revokeObjectURL(url);}
  return report;
}

export async function playExisting(config,path,expectedSha256){
  const report={scope:'Recipient native SDK download and Chromium Blob video playback of the already submitted synthetic WebM',steps:[]};
  const app=cloudbase.init({...config,debug:false});let video,url;
  try{
    const session=await app.auth().getSession();need(!session.error&&session.data.session,'recipient_native_session');
    const r=await app.storage.from('r25wf-private').download(path);need(!r.error&&r.data instanceof Blob,'recipient_private_download');
    const actual=await hash(await r.data.arrayBuffer());need(actual===expectedSha256,'recipient_exact_video_sha256');
    report.steps.push({step:'recipient_exact_video_sha256',pass:true,detail:{bytes:r.data.size,sha256:actual}});
    video=document.createElement('video');video.muted=true;video.playsInline=true;document.body.append(video);url=URL.createObjectURL(r.data);video.src=url;
    const ended=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Object.assign(new Error('recipient_playback_timeout'),{step:'recipient_playback_timeout'})),9000);video.onended=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(Object.assign(new Error('recipient_decode_failed'),{step:'recipient_decode_failed'}));};});
    await video.play();await ended;const q=video.getVideoPlaybackQuality();need(video.videoWidth===320&&video.videoHeight===180&&q.totalVideoFrames>0,'recipient_video_played_to_end');
    report.steps.push({step:'recipient_video_played_to_end',pass:true,detail:{width:video.videoWidth,height:video.videoHeight,decodedFrames:q.totalVideoFrames,droppedFrames:q.droppedVideoFrames}});
    report.status='PASS_RECIPIENT_VIDEO_PLAYBACK';
  }catch(error){report.status='FAIL';report.failedStep=error.step||'Unexpected recipient browser/SDK error (text suppressed)';}
  finally{if(video)video.remove();if(url)URL.revokeObjectURL(url);}
  return report;
}
