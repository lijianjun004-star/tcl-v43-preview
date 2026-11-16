(() => {
 const NativeWorker=window.Worker;
 window.Worker=class extends NativeWorker {
  constructor(...args){super(...args);this.addEventListener('message',e=>{if(e.data?.__mockWhisperTrace){window.__inferCalls=e.data.calls;window.__mockPipeline=e.data.model;}});}
 };
 if(!navigator.mediaDevices)navigator.mediaDevices={};
 const __nativeGUM=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
 navigator.mediaDevices.getUserMedia=async constraints=>{
  const tracks=[];
  if(constraints&&constraints.video){
    const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;
    let n=0;const c=canvas.getContext('2d');
    const draw=()=>{c.fillStyle=n++%2?'#152238':'#21314a';c.fillRect(0,0,360,640);c.fillStyle='#fff';c.font='30px sans-serif';c.fillText('E2E',40,140)};
    draw();const iv=setInterval(draw,80);
    canvas.captureStream(15).getTracks().forEach(t=>{
     t.getSettings=()=>({width:360,height:640,frameRate:15,resizeMode:'none'});
     t.applyConstraints=async()=>{};
     const stop=t.stop.bind(t);t.stop=()=>{clearInterval(iv);stop()};tracks.push(t);
    });
  }
  if(constraints&&constraints.audio){ const real=await __nativeGUM({audio:true}); real.getAudioTracks().forEach(t=>tracks.push(t)); }
  return new MediaStream(tracks);
 };
})();