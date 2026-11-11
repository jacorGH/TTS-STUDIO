(() => {
'use strict';
const $ = id => document.getElementById(id);
const state = { lines: [], generated: new Map(), manifestText: '', running: false };
const profiles = {
  N:{name:'Narrator',voice:'ash',description:'Thoughtful young man; warm, steady delivery.'},
  W:{name:'Woman narrator',voice:'coral',description:'Thoughtful young woman; clear, natural delivery.'},
  S:{name:'Scripture',voice:'sage',description:'Reverent, clear, measured Scripture reading.'},
  M:{name:'Conversational man',voice:'onyx',description:'Sincere conversational male delivery.'},
  F:{name:'Conversational woman',voice:'nova',description:'Sincere conversational female delivery.'}
};
const instructions = {
  N:'Speak as a thoughtful young man in first-century Judea. Use a warm, grounded, natural delivery.',
  W:'Speak as a thoughtful young woman in first-century Judea. Use a clear, natural delivery.',
  S:'Read Scripture reverently, clearly, and at a measured pace. Preserve the meaning and pronunciation of the text.',
  M:'Use a sincere, natural conversational male delivery.',
  F:'Use a sincere, natural conversational female delivery.'
};
function apiBase(){return $('apiUrl').value.trim().replace(/\/+$/,'');}
function headers(){return {'Content-Type':'application/json','x-app-access-code':$('accessCode').value};}
function message(el,text,ok=false){el.textContent=text;el.style.color=ok?'#82d5bd':'#f0b9a8';}
function renderProfiles(){
  $('voiceProfiles').innerHTML=Object.entries(profiles).map(([tag,p])=>`<div class="voice-card"><strong>${tag} · ${p.name}</strong><small>OpenAI voice: ${p.voice}<br>${p.description}</small></div>`).join('');
}
function validateLines(raw){
  const data=JSON.parse(raw);
  if(!Array.isArray(data)) throw new Error('The JSON root must be an array.');
  const seen=new Set();
  const lines=data.map((x,i)=>{
    if(!x || typeof x!=='object') throw new Error(`Line ${i+1} is not an object.`);
    const id=String(x.id||'').trim(), text=String(x.text||'').trim(), tag=String(x.voice||'N').trim().toUpperCase();
    if(!id || !text) throw new Error(`Line ${i+1} needs both id and text.`);
    if(seen.has(id)) throw new Error(`Duplicate line ID: ${id}`);
    if(!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid ID "${id}". Use letters, numbers, _ or -.`);
    seen.add(id);
    return {id,text,tag:profiles[tag]?tag:'N'};
  });
  if(!lines.length) throw new Error('No dialogue lines were found.');
  return lines;
}
function updateProgress(done,total,label){
  $('progressCount').textContent=`${done} / ${total}`;
  $('progressBar').style.width=total?`${done/total*100}%`:'0%';
  $('progressLabel').textContent=label;
}
function renderResults(){
  $('results').innerHTML=[...state.generated.entries()].map(([id,item])=>{
    const url=URL.createObjectURL(item.blob);
    return `<div class="result"><div><strong>${escapeHtml(id)}</strong><small>${escapeHtml(item.voice)} · ${Math.round(item.blob.size/1024)} KB</small></div><audio controls preload="none" src="${url}"></audio></div>`;
  }).join('');
  $('exportZip').disabled=state.generated.size===0;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function testConnection(){
  const base=apiBase(); if(!base){message($('connectionMessage'),'Enter your Render API URL.');return;}
  $('connectionStatus').textContent='Checking…';
  try{
    const r=await fetch(base+'/health',{cache:'no-store'});
    if(!r.ok) throw new Error(`Health check returned ${r.status}`);
    const data=await r.json();
    const v=await fetch(base+'/api/voices',{headers:headers(),cache:'no-store'});
    if(!v.ok) throw new Error(v.status===401?'Access code rejected. Check APP_ACCESS_CODE.':`Voice check returned ${v.status}`);
    $('connectionStatus').textContent='Connected';
    message($('connectionMessage'),`Connected to ${data.service||'TTS server'}. Voice endpoint authenticated.`,true);
    localStorage.setItem('ttsApiUrl',base);
  }catch(e){
    $('connectionStatus').textContent='Connection failed';
    message($('connectionMessage'),`${e.message}. Check URL, Render status, and ALLOWED_ORIGINS.`);
  }
}
async function generate(){
  if(state.running || !state.lines.length) return;
  if(!apiBase() || !$('accessCode').value){message($('jsonMessage'),'Connect to your server before generating.');return;}
  state.running=true; $('generate').disabled=true;
  const todo=state.lines.filter(x=>!state.generated.has(x.id));
  let done=0;
  updateProgress(0,todo.length,'Generating English audio…');
  for(const line of todo){
    try{
      const p=profiles[line.tag]||profiles.N;
      const r=await fetch(apiBase()+'/api/speech',{method:'POST',headers:headers(),body:JSON.stringify({
        text:line.text,voice:p.voice,instructions:instructions[line.tag]||instructions.N,model:'gpt-4o-mini-tts'
      })});
      if(!r.ok){let detail=`HTTP ${r.status}`;try{const j=await r.json();detail=j.error||detail;}catch{}throw new Error(detail);}
      const blob=await r.blob();
      state.generated.set(line.id,{blob,voice:p.voice,tag:line.tag});
      renderResults();
    }catch(e){
      const row=document.createElement('div');row.className='result';row.textContent=`${line.id}: ${e.message}`;$('results').appendChild(row);
    }
    done++;updateProgress(done,todo.length,`Generated ${line.id}`);
  }
  state.running=false;$('generate').disabled=false;
  $('generate').textContent='Generate remaining English audio';
  updateProgress(done,todo.length,`Finished · ${state.generated.size} audio file(s) ready`);
}
function parseExistingIds(src,lang){
  const ids=new Set();
  const re=/TW\.Dubs\.add\s*\(\s*(['"])([^'"]+)\1\s*,\s*\[([\s\S]*?)\]\s*\)\s*;?/g;
  let m;
  while((m=re.exec(src))!==null){
    if(m[2]!==lang) continue;
    const inner=m[3], q=/(["'])(.*?)\1/g;let n;
    while((n=q.exec(inner))!==null) ids.add(n[2]);
  }
  return ids;
}
async function exportOverlay(){
  if(!window.JSZip){message($('exportMessage'),'ZIP library did not load. Refresh while online.');return;}
  const zip=new JSZip(), lang=$('language').value;
  if(lang!=='en'){message($('exportMessage'),'Spanish export will be enabled in phase 2.');return;}
  let manifest=state.manifestText.trim();
  if(!manifest) manifest=`// The Way — generated voice registrations.\n// Keep this file with your existing game manifest.\n`;
  const existing=parseExistingIds(manifest,lang);
  const newIds=[...state.generated.keys()].filter(id=>!existing.has(id));
  for(const [id,item] of state.generated.entries()) zip.file(`audio/${lang}/${id}.mp3`,item.blob);
  if(newIds.length){
    manifest += `\n\n// TTS Studio additions — ${new Date().toISOString()}\nTW.Dubs.add('${lang}', ${JSON.stringify(newIds,null,2)});\n`;
  }
  zip.file('manifest.js',manifest);
  zip.file('OVERLAY-README.txt',
`TTS Studio audio overlay\n\nMerge this ZIP into the root of your existing game project. Keep the folder structure intact.\n\nFiles:\n- audio/${lang}/<line-id>.mp3 — generated dialogue audio\n- manifest.js — your imported manifest with new TW.Dubs.add('${lang}', [...]) registrations appended\n\nImportant:\n- Back up your existing project before merging.\n- If your game loads manifest.js from a different path, place the updated file at that same path.\n- Existing manifest content is preserved when you import your current manifest into TTS Studio before export.\n- Registrations already present for this language are not added a second time.\n- Spanish is reserved for phase 2 and will use audio/es/ with TW.Dubs.add('es', [...]).\n`);
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
  const a=document.createElement('a'),url=URL.createObjectURL(blob);
  a.href=url;a.download=`tts-studio-${lang}-overlay-${new Date().toISOString().slice(0,10)}.zip`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
  message($('exportMessage'),`Overlay created: ${state.generated.size} MP3 file(s), ${newIds.length} new manifest registration(s).`,true);
}
$('testConnection').addEventListener('click',testConnection);
$('loadJson').addEventListener('click',()=>{
  try{
    state.lines=validateLines($('jsonInput').value);
    $('dialogueSummary').hidden=false;
    $('dialogueSummary').textContent=`${state.lines.length} valid lines · ${new Set(state.lines.map(x=>x.tag)).size} voice profile(s)`;
    $('generate').disabled=false;
    $('generate').textContent='Generate English audio';
    message($('jsonMessage'),'Dialogue validated successfully.',true);
  }catch(e){state.lines=[];$('generate').disabled=true;$('dialogueSummary').hidden=true;message($('jsonMessage'),e.message);}
});
$('jsonFile').addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;
  $('jsonInput').value=await f.text();
  $('loadJson').click();
});
$('generate').addEventListener('click',generate);
$('exportZip').addEventListener('click',exportOverlay);
$('manifestFile').addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;
  state.manifestText=await f.text();
  message($('exportMessage'),`Loaded ${f.name} (${state.manifestText.length.toLocaleString()} characters).`,true);
});
$('apiUrl').value=localStorage.getItem('ttsApiUrl')||'';
renderProfiles();
})();