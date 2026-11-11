const DEFAULT_API_BASE = "";
const CAST_LABELS = {N:"Narrator · Ash",W:"Woman narrator · Coral",S:"Scripture · Sage",M:"Male character · Onyx",F:"Female character · Nova"};
const $ = id => document.getElementById(id);
let batch = [];
let generated = new Map();
let stopRequested = false;
let activeAudioUrl = null;
let toastTimer;

const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open("tts-studio-audio", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("audio");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function dbGet(key) {
  try { const db = await dbPromise; return await new Promise((resolve,reject)=>{const r=db.transaction("audio").objectStore("audio").get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}); }
  catch { return null; }
}
async function dbPut(key, value) {
  const db = await dbPromise;
  return new Promise((resolve,reject)=>{const r=db.transaction("audio","readwrite").objectStore("audio").put(value,key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});
}
async function dbDeletePrefix(prefix) {
  const db = await dbPromise;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("audio","readwrite"), store=tx.objectStore("audio"), r=store.openCursor();
    r.onsuccess=()=>{const c=r.result;if(c){if(String(c.key).startsWith(prefix))c.delete();c.continue();}};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });
}
function settings(){return {base:(localStorage.getItem("tts_api_base")||DEFAULT_API_BASE).replace(/\/+$/,""),code:localStorage.getItem("tts_access_code")||""};}
function headers(){return {"x-app-access-code":settings().code};}
function showToast(message){$("toast").textContent=message;$("toast").classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.remove("show"),2600);}
function setConnection(ok,message){$("connectionBadge").textContent=ok?"Connected":"Not connected";$("connectionBadge").className="status-badge "+(ok?"good":"bad");$("connectionText").textContent=message;}
function setProgress(done,total,label){const pct=total?Math.round(done/total*100):0;$("progressBar").style.width=pct+"%";$("progressPercent").textContent=pct+"%";$("progressLabel").textContent=label;$("generatedCount").textContent=`${done} / ${total}`;}
function safeText(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function normalizeBase(base){return base.replace(/\/+$/,"");}
function batchKey(item){return `${item.id}`;}

async function testConnection(showMessage=true){
  const {base,code}=settings();
  if(!base||!code){setConnection(false,"Set your backend URL and access code in Settings.");if(showMessage)$("settingsMessage").textContent="Enter both values first.";return false;}
  try{
    const health=await fetch(base+"/health");
    if(!health.ok)throw new Error("Backend health check failed.");
    const response=await fetch(base+"/api/voices",{headers:{"x-app-access-code":code}});
    if(!response.ok){const d=await response.json().catch(()=>({}));throw new Error(d.error||"Access check failed.");}
    const data=await response.json();
    setConnection(true,`Connected · ${data.model||"TTS model ready"}`);
    if(showMessage)$("settingsMessage").textContent=`Connected. Model: ${data.model}`;
    return true;
  }catch(e){setConnection(false,e.message);if(showMessage)$("settingsMessage").textContent=e.message;return false;}
}

function parseBatch(){
  try{
    const parsed=JSON.parse($("jsonInput").value);
    if(!Array.isArray(parsed))throw new Error("The top-level JSON value must be an array.");
    if(!parsed.length)throw new Error("The JSON array is empty.");
    const seen=new Set();
    batch=parsed.map((item,index)=>{
      if(!item||typeof item!=="object")throw new Error(`Entry ${index+1} is not an object.`);
      const id=String(item.id??"").trim(), voice=String(item.voice??"N").toUpperCase(), text=String(item.text??"");
      if(!id)throw new Error(`Entry ${index+1} is missing its id.`);
      if(seen.has(id))throw new Error(`Duplicate id: ${id}`);
      if(!text.trim())throw new Error(`Entry ${index+1} has no text.`);
      if(text.length>4096)throw new Error(`Entry ${index+1} exceeds 4,096 characters.`);
      seen.add(id);
      return {id,voice,text};
    });
    renderBatch();
    loadCached();
    $("parseStatus").textContent=`${batch.length} valid entries · ${batch.filter(x=>!CAST_LABELS[x.voice]).length} unknown voice tags use N`;
    $("generateButton").disabled=false;
    updateExportButton();
    showToast(`${batch.length} dialogue entries loaded`);
  }catch(e){$("parseStatus").textContent=e.message;showToast(e.message);}
}
function renderBatch(){
  $("lineCount").textContent=`${batch.length} lines`;
  $("lineList").className="line-list";
  $("lineList").innerHTML=batch.map(item=>`<div class="line-item"><div class="line-top"><span class="line-id">${safeText(item.id)}</span><span class="line-voice">${safeText(item.voice)} · ${safeText(CAST_LABELS[item.voice]||"Fallback · Ash")}</span></div><div class="line-text">${safeText(item.text)}</div></div>`).join("");
}
async function loadCached(){
  generated.clear();
  for(const item of batch){const blob=await dbGet(batchKey(item));if(blob instanceof Blob)generated.set(batchKey(item),blob);}
  renderAudio();
  const done=batch.filter(x=>generated.has(batchKey(x))).length;
  setProgress(done,batch.length,done?`${done} recording${done===1?"":"s"} restored from this device`:"Ready when you are");
}
async function generateBatch(){
  if(!batch.length)return;
  if(!(await testConnection(false))){showToast("Connect to your backend first.");return;}
  stopRequested=false;$("generateButton").disabled=true;$("stopButton").disabled=false;
  let done=batch.filter(x=>generated.has(batchKey(x))).length;
  setProgress(done,batch.length,"Preparing batch…");
  for(let i=0;i<batch.length;i++){
    if(stopRequested)break;
    const item=batch[i], key=batchKey(item);
    if(generated.has(key))continue;
    setProgress(done,batch.length,`Generating ${i+1} of ${batch.length} · ${item.id}`);
    try{
      const response=await fetch(settings().base+"/api/speech",{
        method:"POST",headers:{...headers(),"Content-Type":"application/json"},
        body:JSON.stringify(Object.assign({id:item.id,voice:item.voice,text:item.text},typeof window.ttsVoiceFor==="function"?window.ttsVoiceFor(item):{},(typeof window.ttsInstructions==="function"&&window.ttsInstructions(item))?{instructions:window.ttsInstructions(item)}:{}))
      });
      if(!response.ok){const detail=await response.json().catch(()=>({}));const m=String(detail.detail||detail.error||`HTTP ${response.status}`);if(/per day|RPD/i.test(m)){const t=/try again in\s*([\dhms.]+)/i.exec(m);throw new Error(`OpenAI’s daily limit is reached. Try again in ${t?t[1]:"a while"}.`);}if(/rate limit/i.test(m))throw new Error("OpenAI’s per-minute limit; wait a minute and retry.");throw new Error(m);}
      const blob=await response.blob();
      generated.set(key,blob);
      await dbPut(key,blob);
      done++;renderAudio();setProgress(done,batch.length,`Saved ${item.id}`);
    }catch(e){
      showToast(`Stopped at ${item.id}: ${e.message}`);
      break;
    }
  }
  $("generateButton").disabled=false;$("stopButton").disabled=true;
  const completed=batch.filter(x=>generated.has(batchKey(x))).length;
  setProgress(completed,batch.length,stopRequested?"Paused by you":completed===batch.length?"Batch complete":"Batch paused · retry to continue");
  updateExportButton();
  if(completed===batch.length)showToast("All audio recordings generated.");
}
function renderAudio(){
  const items=batch.filter(x=>generated.has(batchKey(x)));
  $("audioList").innerHTML=items.map(item=>{
    const blob=generated.get(batchKey(item));
    const url=URL.createObjectURL(blob);
    return `<div class="audio-item"><div class="audio-item-head"><strong>${safeText(item.id)}.mp3</strong><span class="audio-state">READY</span></div><audio controls preload="none" src="${url}"></audio></div>`;
  }).join("");
  updateExportButton();
}
function updateExportButton(){$("exportZipButton").disabled=generated.size===0;}
async function exportZip(){
  if(!window.JSZip){showToast("ZIP library did not load. Check your connection.");return;}
  const zip=new JSZip(), folder=zip.folder("audio/en");
  for(const item of batch){const blob=generated.get(batchKey(item));if(blob)folder.file(`${safeFilename(item.id)}.mp3`,blob);}
  const ids=batch.filter(x=>generated.has(batchKey(x))).map(x=>x.id);
  folder.file("manifest.json",JSON.stringify({language:"en",format:"mp3",recordings:ids},null,2));
  const content=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:3}});
  const url=URL.createObjectURL(content), a=document.createElement("a");
  a.href=url;a.download=(window.ttsBatchName?String(window.ttsBatchName).replace(/[^a-zA-Z0-9._-]+/g,"-"):"tts-audio-en")+".zip";document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function safeFilename(s){return String(s).replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,180)||"recording";}
function clearBatch(){
  if(!confirm("Clear this batch from the app? Saved audio remains in this browser unless you remove website data."))return;
  batch=[];generated.clear();$("jsonInput").value="";$("lineList").className="line-list empty-state";$("lineList").textContent="Import or paste a batch to see your dialogue entries.";
  $("lineCount").textContent="0 lines";$("parseStatus").textContent="No dialogue loaded";$("audioList").innerHTML="";
  $("generateButton").disabled=true;setProgress(0,0,"Ready when you are");updateExportButton();
}
function openSettings(){
  const s=settings();$("apiBase").value=s.base;$("accessCode").value=s.code;$("settingsMessage").textContent="";
  $("settingsModal").hidden=false;
}
function saveSettings(){
  localStorage.setItem("tts_api_base",normalizeBase($("apiBase").value.trim()));
  localStorage.setItem("tts_access_code",$("accessCode").value);
  $("settingsModal").hidden=true;testConnection(false);showToast("Settings saved on this device.");
}
async function loadSample(){
  try{const r=await fetch("./sample-batch.json");if(!r.ok)throw new Error();$("jsonInput").value=JSON.stringify([{id:"s-KJV-7c5c72ce",voice:"S",text:"And now when the even was come, because it was the preparation, that is, the day before the sabbath, Joseph of Arimathea, an honourable counsellor, which also waited for the kingdom of God, came, and went in boldly unto Pilate, and craved the body of Jesus."}],null,2);parseBatch();}
  catch{$("jsonInput").value=JSON.stringify([{id:"s-KJV-7c5c72ce",voice:"S",text:"And now when the even was come, because it was the preparation, that is, the day before the sabbath, Joseph of Arimathea, an honourable counsellor, which also waited for the kingdom of God, came, and went in boldly unto Pilate, and craved the body of Jesus."}],null,2);parseBatch();}
}

$("settingsOpen").addEventListener("click",openSettings);
$("settingsClose").addEventListener("click",()=>$("settingsModal").hidden=true);
$("settingsCancel").addEventListener("click",()=>$("settingsModal").hidden=true);
$("saveSettings").addEventListener("click",saveSettings);
$("testConnection").addEventListener("click",()=>{localStorage.setItem("tts_api_base",normalizeBase($("apiBase").value.trim()));localStorage.setItem("tts_access_code",$("accessCode").value);testConnection(true);});
$("chooseFile").addEventListener("click",()=>$("fileInput").click());
$("fileInput").addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;try{$("jsonInput").value=await f.text();window.ttsBatchName=f.name.replace(/\.json$/i,"");parseBatch();}catch{showToast("Could not read that file.");}e.target.value="";});
$("parseButton").addEventListener("click",parseBatch);
$("loadSample").addEventListener("click",loadSample);
$("generateButton").addEventListener("click",generateBatch);
$("stopButton").addEventListener("click",()=>{stopRequested=true;$("stopButton").disabled=true;});
$("exportZipButton").addEventListener("click",exportZip);
$("clearButton").addEventListener("click",clearBatch);
const dz=$("dropzone");
["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.style.borderColor="#a8d7c4";}));
["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.style.borderColor="";}));
dz.addEventListener("drop",async e=>{const f=e.dataTransfer.files?.[0];if(!f)return;try{$("jsonInput").value=await f.text();parseBatch();}catch{showToast("Could not read that file.");}});
(async()=>{await testConnection(false);})();
