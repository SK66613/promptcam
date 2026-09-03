(()=>{
const $=id=>document.getElementById(id);
const editor=$('editorView'),camera=$('cameraView'),script=$('scriptInput');
const speed=$('speedInput'),font=$('fontInput'),speedV=$('speedValue'),fontV=$('fontValue');
const open=$('openCameraButton'),video=$('cameraVideo'),text=$('prompterText'),scroller=$('prompterScroller');
const camSpeed=$('cameraSpeedInput'),camFont=$('cameraFontInput'),back=$('backButton'),flip=$('switchCameraButton');
const play=$('playPromptButton'),reset=$('resetPromptButton'),record=$('recordButton'),pill=$('recordingPill'),time=$('recordingTime');
const countdown=$('countdown'),toast=$('toast'),dialog=$('resultDialog'),resultVideo=$('resultVideo');
const share=$('shareButton'),download=$('downloadButton'),close=$('closeResultButton');
let stream=null,facing='user',px=+speed.value,fs=+font.value,running=false,raf=0,last=0;
let recorder=null,chunks=[],clock=0,blob=null,blobUrl=null,toastTimer=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function sync(){speed.value=camSpeed.value=px;speedV.textContent=`${Math.round(px)} px/сек`;font.value=camFont.value=fs;fontV.textContent=`${Math.round(fs)} px`;text.style.fontSize=`${fs}px`}
function msg(s,ms=3500){clearTimeout(toastTimer);toast.textContent=s;toast.classList.remove('hidden');toastTimer=setTimeout(()=>toast.classList.add('hidden'),ms)}
function stopTracks(){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null}
function errText(e){if(['NotAllowedError','SecurityError'].includes(e?.name))return'Разреши камеру и микрофон для этой страницы в Safari.';if(e?.name==='NotFoundError')return'Камера не найдена.';return`Ошибка камеры: ${e?.message||e?.name||'неизвестно'}`}
async function startCamera(mode=facing){if(!navigator.mediaDevices?.getUserMedia)throw new Error('Браузер не поддерживает камеру');stopTracks();facing=mode;try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:mode},width:{ideal:1920},height:{ideal:1080}},audio:true})}catch(e){stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:mode},audio:true}).catch(()=>{throw e})}video.srcObject=stream;video.classList.toggle('mirrored',mode==='user');await video.play().catch(()=>{})}
function setRun(v){running=v;play.textContent=v?'Ⅱ':'▶';last=0;if(v&&!raf)raf=requestAnimationFrame(frame);if(!v&&raf){cancelAnimationFrame(raf);raf=0}}
function frame(t){if(!running){raf=0;return}if(!last)last=t;const dt=Math.min((t-last)/1000,.1);last=t;const max=scroller.scrollHeight-scroller.clientHeight;scroller.scrollTop=Math.min(max,scroller.scrollTop+px*dt);if(scroller.scrollTop>=max-1){setRun(false);return}raf=requestAnimationFrame(frame)}
function resetPrompt(){setRun(false);scroller.scrollTop=0}
function fmt(s){return`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function mime(){if(typeof MediaRecorder==='undefined')return'';for(const t of['video/mp4;codecs=h264,aac','video/mp4','video/webm;codecs=vp8,opus','video/webm'])if(!MediaRecorder.isTypeSupported||MediaRecorder.isTypeSupported(t))return t;return''}
async function startRec(){if(!stream)return msg('Сначала открой камеру');if(typeof MediaRecorder==='undefined')return msg('В этом Safari запись через сайт недоступна, но суфлёр работает.',5000);record.disabled=flip.disabled=true;resetPrompt();for(let n=3;n;n--){countdown.textContent=n;countdown.classList.remove('hidden');await wait(850)}countdown.classList.add('hidden');chunks=[];try{const type=mime();recorder=type?new MediaRecorder(stream,{mimeType:type}):new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};recorder.onstop=finishRec;recorder.start(1000)}catch(e){record.disabled=flip.disabled=false;return msg(`Не удалось начать запись: ${e.message||e.name}`,5000)}record.classList.add('recording');pill.classList.remove('hidden');record.disabled=false;const started=Date.now();clock=setInterval(()=>time.textContent=fmt(Math.floor((Date.now()-started)/1000)),500);setRun(true)}
function stopRec(){if(!recorder||recorder.state==='inactive')return;record.disabled=true;setRun(false);recorder.stop()}
function finishRec(){clearInterval(clock);pill.classList.add('hidden');record.classList.remove('recording');record.disabled=flip.disabled=false;const type=recorder?.mimeType||chunks[0]?.type||'video/mp4';blob=new Blob(chunks,{type});chunks=[];if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl=URL.createObjectURL(blob);resultVideo.src=blobUrl;download.href=blobUrl;download.download=type.includes('webm')?'promptcam-video.webm':'promptcam-video.mp4';dialog.showModal();msg('Видео готово')}
async function shareRec(){if(!blob)return;const ext=blob.type.includes('webm')?'webm':'mp4';const file=new File([blob],`promptcam-video.${ext}`,{type:blob.type||`video/${ext}`});if(navigator.share&&navigator.canShare?.({files:[file]})){try{return await navigator.share({files:[file],title:'PromptCam video'})}catch(e){if(e?.name==='AbortError')return}}msg('Нажми «Скачать видео» — Safari сохранит или откроет файл.',5000)}
speed.oninput=()=>{px=+speed.value;sync()};font.oninput=()=>{fs=+font.value;sync()};camSpeed.oninput=()=>{px=+camSpeed.value;sync()};camFont.oninput=()=>{fs=+camFont.value;sync()};
open.onclick=async()=>{const s=script.value.trim();if(!s)return alert('Сначала вставь текст для суфлёра.');open.disabled=true;open.textContent='Открываю камеру…';text.textContent=s;sync();try{await startCamera('user');editor.classList.add('hidden');camera.classList.remove('hidden');requestAnimationFrame(()=>scroller.scrollTop=0)}catch(e){alert(errText(e))}finally{open.disabled=false;open.textContent='Открыть камеру'}};
back.onclick=()=>{if(recorder&&recorder.state!=='inactive')return msg('Сначала останови запись');resetPrompt();stopTracks();camera.classList.add('hidden');editor.classList.remove('hidden')};
flip.onclick=async()=>{if(recorder&&recorder.state!=='inactive')return;flip.disabled=true;try{await startCamera(facing==='user'?'environment':'user')}catch(e){msg(errText(e),5000)}finally{flip.disabled=false}};
play.onclick=()=>setRun(!running);reset.onclick=resetPrompt;record.onclick=()=>recorder&&recorder.state!=='inactive'?stopRec():startRec();share.onclick=shareRec;close.onclick=()=>dialog.close();
document.addEventListener('visibilitychange',()=>{if(document.hidden)setRun(false)});window.addEventListener('pagehide',()=>{stopTracks();if(blobUrl)URL.revokeObjectURL(blobUrl)});sync();
})();
