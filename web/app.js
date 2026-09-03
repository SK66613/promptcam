(()=>{
'use strict';

const $=id=>document.getElementById(id);
const STORAGE_KEY='promptcam:web:v2';
const DEFAULT_SCRIPT=`Всем привет!\n\nСегодня я хочу показать вам PromptCam — простой суфлёр прямо поверх камеры.\n\nТекст двигается автоматически, а в записанное видео сам суфлёр не попадает.\n\nМожно менять скорость прокрутки, размер текста, фон и положение суфлёра.\n\nГотово. Поехали!`;
const defaults={script:DEFAULT_SCRIPT,speed:42,font:32,opacity:52,position:38};
const clamp=(value,min,max,fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

const editor=$('editorView');
const camera=$('cameraView');
const script=$('scriptInput');
const clearScript=$('clearScriptButton');
const wordCount=$('wordCount');
const charCount=$('charCount');
const speed=$('speedInput');
const font=$('fontInput');
const opacity=$('opacityInput');
const position=$('positionInput');
const speedValue=$('speedValue');
const fontValue=$('fontValue');
const opacityValue=$('opacityValue');
const positionValue=$('positionValue');
const openCamera=$('openCameraButton');

const video=$('cameraVideo');
const text=$('prompterText');
const panel=$('prompterPanel');
const scroller=$('prompterScroller');
const back=$('backButton');
const flip=$('switchCameraButton');
const play=$('playPromptButton');
const reset=$('resetPromptButton');
const record=$('recordButton');
const recordingPill=$('recordingPill');
const recordingTime=$('recordingTime');
const countdown=$('countdown');
const countdownNumber=countdown.querySelector('span');
const toast=$('toast');
const settingsToggle=$('toggleSettingsButton');
const cameraSettings=$('cameraSettings');
const camSpeed=$('cameraSpeedInput');
const camFont=$('cameraFontInput');
const camOpacity=$('cameraOpacityInput');
const camPosition=$('cameraPositionInput');

const dialog=$('resultDialog');
const resultVideo=$('resultVideo');
const share=$('shareButton');
const download=$('downloadButton');
const retry=$('retryButton');
const returnToScript=$('returnToScriptButton');

let state=loadState();
let stream=null;
let facing='user';
let running=false;
let raf=0;
let lastFrame=0;
let recorder=null;
let chunks=[];
let clockTimer=0;
let recordingStartedAt=0;
let resultBlob=null;
let resultUrl=null;
let toastTimer=0;
let busy=false;

function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');
    return{
      script:typeof saved.script==='string'?saved.script:defaults.script,
      speed:clamp(saved.speed,15,110,defaults.speed),
      font:clamp(saved.font,22,56,defaults.font),
      opacity:clamp(saved.opacity,20,90,defaults.opacity),
      position:clamp(saved.position,25,55,defaults.position)
    };
  }catch(_){return {...defaults};}
}

function saveState(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(_){}
}

function plural(n,one,few,many){
  const mod10=n%10,mod100=n%100;
  if(mod10===1&&mod100!==11)return one;
  if(mod10>=2&&mod10<=4&&(mod100<12||mod100>14))return few;
  return many;
}

function updateCounts(){
  const value=script.value;
  const words=value.trim()?value.trim().split(/\s+/u).filter(Boolean).length:0;
  const chars=value.length;
  wordCount.textContent=`${words} ${plural(words,'слово','слова','слов')}`;
  charCount.textContent=`${chars} ${plural(chars,'символ','символа','символов')}`;
}

function positionLabel(value){
  if(value<=31)return'Выше';
  if(value>=47)return'Ниже';
  return'По центру';
}

function syncUI(){
  speed.value=camSpeed.value=String(state.speed);
  font.value=camFont.value=String(state.font);
  opacity.value=camOpacity.value=String(state.opacity);
  position.value=camPosition.value=String(state.position);
  speedValue.textContent=`${Math.round(state.speed)} px/сек`;
  fontValue.textContent=`${Math.round(state.font)} px`;
  opacityValue.textContent=`${Math.round(state.opacity)}%`;
  positionValue.textContent=positionLabel(state.position);
  text.style.fontSize=`${state.font}px`;
  panel.style.setProperty('--prompter-opacity',(state.opacity/100).toFixed(2));
  panel.style.top=`${state.position}dvh`;
}

function msg(message,ms=3600){
  clearTimeout(toastTimer);
  toast.textContent=message;
  toast.classList.remove('hidden');
  toastTimer=setTimeout(()=>toast.classList.add('hidden'),ms);
}

function stopTracks(){
  if(stream)stream.getTracks().forEach(track=>track.stop());
  stream=null;
  video.srcObject=null;
}

function cameraError(error,source='camera'){
  if(!window.isSecureContext)return'Камера работает только по защищённой HTTPS-ссылке.';
  if(error?.name==='NotAllowedError'||error?.name==='SecurityError'){
    return source==='microphone'
      ?'Доступ к микрофону запрещён. Разреши микрофон для PromptCam в настройках браузера.'
      :'Доступ к камере запрещён. Разреши камеру для PromptCam в настройках браузера.';
  }
  if(error?.name==='NotFoundError'||error?.name==='DevicesNotFoundError'){
    return source==='microphone'?'Микрофон на устройстве не найден.':'Камера на устройстве не найдена.';
  }
  if(error?.name==='NotReadableError'||error?.name==='TrackStartError'){
    return source==='microphone'?'Микрофон сейчас занят другим приложением.':'Камера сейчас занята другим приложением.';
  }
  if(error?.name==='OverconstrainedError')return'Выбранный режим камеры недоступен на этом устройстве.';
  return source==='microphone'?'Не удалось включить микрофон. Попробуй закрыть другие приложения и повторить.':'Не удалось открыть камеру. Попробуй перезагрузить страницу.';
}

async function requestVideo(mode){
  try{
    return await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:mode},width:{ideal:1920},height:{ideal:1080}},
      audio:false
    });
  }catch(error){error.promptcamSource='camera';throw error;}
}

async function requestAudio(){
  try{return await navigator.mediaDevices.getUserMedia({video:false,audio:true});}
  catch(error){error.promptcamSource='microphone';throw error;}
}

async function startCamera(mode=facing){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('UNSUPPORTED_MEDIA');
  stopTracks();
  facing=mode;
  let videoStream;
  let audioStream;
  try{
    videoStream=await requestVideo(mode);
    audioStream=await requestAudio();
    stream=new MediaStream([...videoStream.getVideoTracks(),...audioStream.getAudioTracks()]);
  }catch(error){
    videoStream?.getTracks().forEach(track=>track.stop());
    audioStream?.getTracks().forEach(track=>track.stop());
    throw error;
  }
  video.srcObject=stream;
  video.classList.toggle('mirrored',mode==='user');
  await video.play().catch(()=>{});
}

function setRun(value){
  running=value;
  play.querySelector('.play-icon').classList.toggle('hidden',value);
  play.querySelector('.pause-icon').classList.toggle('hidden',!value);
  play.setAttribute('aria-label',value?'Пауза суфлёра':'Старт суфлёра');
  lastFrame=0;
  if(value&&!raf)raf=requestAnimationFrame(frame);
  if(!value&&raf){cancelAnimationFrame(raf);raf=0;}
}

function frame(timestamp){
  if(!running){raf=0;return;}
  if(!lastFrame)lastFrame=timestamp;
  const dt=Math.min((timestamp-lastFrame)/1000,.1);
  lastFrame=timestamp;
  const max=Math.max(0,scroller.scrollHeight-scroller.clientHeight);
  scroller.scrollTop=Math.min(max,scroller.scrollTop+state.speed*dt);
  if(scroller.scrollTop>=max-1){setRun(false);return;}
  raf=requestAnimationFrame(frame);
}

function resetPrompt(){
  setRun(false);
  scroller.scrollTop=0;
}

function formatTime(seconds){
  return`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}

function preferredMime(){
  if(typeof MediaRecorder==='undefined')return'';
  const types=['video/mp4;codecs=h264,aac','video/mp4','video/webm;codecs=vp8,opus','video/webm'];
  for(const type of types){
    try{if(!MediaRecorder.isTypeSupported||MediaRecorder.isTypeSupported(type))return type;}catch(_){}
  }
  return'';
}

function setRecordingUI(active){
  camera.classList.toggle('is-recording',active);
  record.classList.toggle('recording',active);
  recordingPill.classList.toggle('hidden',!active);
  record.setAttribute('aria-label',active?'Остановить запись':'Начать запись');
}

async function runCountdown(){
  for(let n=3;n>=1;n--){
    countdownNumber.textContent=String(n);
    countdownNumber.style.animation='none';
    void countdownNumber.offsetWidth;
    countdownNumber.style.animation='';
    countdown.classList.remove('hidden');
    await wait(850);
  }
  countdown.classList.add('hidden');
}

async function startRecording(){
  if(!stream)return msg('Сначала открой камеру.');
  if(typeof MediaRecorder==='undefined')return msg('Этот браузер пока не умеет записывать видео через сайт. Суфлёр можно использовать без записи.',5200);
  if(busy)return;
  busy=true;
  record.disabled=true;
  flip.disabled=true;
  settingsToggle.disabled=true;
  resetPrompt();
  try{
    await runCountdown();
    chunks=[];
    const type=preferredMime();
    recorder=type?new MediaRecorder(stream,{mimeType:type}):new MediaRecorder(stream);
    recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
    recorder.onerror=()=>msg('Во время записи произошла ошибка. Попробуй записать ещё раз.',5000);
    recorder.onstop=finishRecording;
    recorder.start(1000);
    recordingStartedAt=Date.now();
    recordingTime.textContent='00:00';
    clearInterval(clockTimer);
    clockTimer=setInterval(()=>{
      recordingTime.textContent=formatTime(Math.floor((Date.now()-recordingStartedAt)/1000));
    },400);
    setRecordingUI(true);
    setRun(true);
  }catch(_){
    recorder=null;
    msg('Не удалось начать запись. Закрой другие приложения с камерой и попробуй снова.',5000);
  }finally{
    busy=false;
    record.disabled=false;
    flip.disabled=Boolean(recorder&&recorder.state!=='inactive');
    settingsToggle.disabled=false;
    countdown.classList.add('hidden');
  }
}

function stopRecording(){
  if(!recorder||recorder.state==='inactive'||busy)return;
  busy=true;
  record.disabled=true;
  setRun(false);
  clearInterval(clockTimer);
  try{recorder.stop();}
  catch(_){
    busy=false;
    record.disabled=false;
    setRecordingUI(false);
    msg('Не удалось корректно остановить запись. Попробуй ещё раз.',5000);
  }
}

function closeResult(){
  if(typeof dialog.close==='function'&&dialog.open)dialog.close();
  else dialog.removeAttribute('open');
  resultVideo.pause();
}

function openResult(){
  if(typeof dialog.showModal==='function')dialog.showModal();
  else dialog.setAttribute('open','');
}

function finishRecording(){
  clearInterval(clockTimer);
  setRecordingUI(false);
  busy=false;
  record.disabled=false;
  flip.disabled=false;
  const type=recorder?.mimeType||chunks[0]?.type||'video/mp4';
  resultBlob=new Blob(chunks,{type});
  chunks=[];
  recorder=null;
  if(!resultBlob.size){
    resultBlob=null;
    msg('Запись получилась пустой. Проверь доступ к камере и попробуй ещё раз.',5200);
    return;
  }
  if(resultUrl)URL.revokeObjectURL(resultUrl);
  resultUrl=URL.createObjectURL(resultBlob);
  resultVideo.src=resultUrl;
  download.href=resultUrl;
  download.download=type.includes('webm')?'promptcam-video.webm':'promptcam-video.mp4';
  openResult();
}

async function shareRecording(){
  if(!resultBlob)return;
  const ext=resultBlob.type.includes('webm')?'webm':'mp4';
  const file=new File([resultBlob],`promptcam-video.${ext}`,{type:resultBlob.type||`video/${ext}`});
  if(navigator.share){
    try{
      if(!navigator.canShare||navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title:'PromptCam'});
        return;
      }
    }catch(error){if(error?.name==='AbortError')return;}
  }
  msg('На этом устройстве передача файла недоступна. Нажми «Скачать файл».',5200);
}

function showEditor(){
  if(recorder&&recorder.state!=='inactive')return msg('Сначала останови запись.');
  closeResult();
  resetPrompt();
  stopTracks();
  camera.classList.add('hidden');
  editor.classList.remove('hidden');
  document.body.classList.remove('no-scroll');
}

function bindRange(input,key,min,max){
  input.addEventListener('input',()=>{
    state[key]=clamp(input.value,min,max,defaults[key]);
    syncUI();
    saveState();
  });
}

script.value=state.script;
updateCounts();
syncUI();

script.addEventListener('input',()=>{
  state.script=script.value;
  saveState();
  updateCounts();
});
clearScript.addEventListener('click',()=>{
  script.value='';
  state.script='';
  saveState();
  updateCounts();
  script.focus();
});
bindRange(speed,'speed',15,110);
bindRange(font,'font',22,56);
bindRange(opacity,'opacity',20,90);
bindRange(position,'position',25,55);
bindRange(camSpeed,'speed',15,110);
bindRange(camFont,'font',22,56);
bindRange(camOpacity,'opacity',20,90);
bindRange(camPosition,'position',25,55);

openCamera.addEventListener('click',async()=>{
  const value=script.value.trim();
  if(!value){script.focus();return alert('Сначала вставь текст для суфлёра.');}
  if(!navigator.mediaDevices?.getUserMedia)return alert('Этот браузер не поддерживает доступ к камере. Открой PromptCam в Safari или Chrome.');
  openCamera.disabled=true;
  const oldLabel=openCamera.querySelector('span').textContent;
  openCamera.querySelector('span').textContent='Открываю камеру…';
  text.textContent=value;
  state.script=script.value;
  saveState();
  syncUI();
  try{
    await startCamera('user');
    editor.classList.add('hidden');
    camera.classList.remove('hidden');
    document.body.classList.add('no-scroll');
    requestAnimationFrame(()=>scroller.scrollTop=0);
  }catch(error){
    const message=error?.message==='UNSUPPORTED_MEDIA'?'Этот браузер не поддерживает камеру. Открой PromptCam в Safari или Chrome.':cameraError(error,error?.promptcamSource);
    alert(message);
  }finally{
    openCamera.disabled=false;
    openCamera.querySelector('span').textContent=oldLabel;
  }
});

back.addEventListener('click',showEditor);
flip.addEventListener('click',async()=>{
  if(busy||recorder&&recorder.state!=='inactive')return;
  flip.disabled=true;
  try{await startCamera(facing==='user'?'environment':'user');}
  catch(error){msg(cameraError(error,error?.promptcamSource),5200);}
  finally{flip.disabled=false;}
});
play.addEventListener('click',()=>setRun(!running));
reset.addEventListener('click',resetPrompt);
record.addEventListener('click',()=>recorder&&recorder.state!=='inactive'?stopRecording():startRecording());
settingsToggle.addEventListener('click',()=>{
  const willOpen=cameraSettings.classList.contains('hidden');
  cameraSettings.classList.toggle('hidden',!willOpen);
  settingsToggle.setAttribute('aria-expanded',String(willOpen));
});
share.addEventListener('click',shareRecording);
retry.addEventListener('click',()=>{closeResult();resetPrompt();});
returnToScript.addEventListener('click',showEditor);

document.addEventListener('visibilitychange',()=>{if(document.hidden)setRun(false);});
window.addEventListener('pagehide',()=>{
  stopTracks();
  clearInterval(clockTimer);
  if(resultUrl)URL.revokeObjectURL(resultUrl);
});
})();
