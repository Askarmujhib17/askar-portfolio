import { categories, lanRooms, fields, validateEntry, normalizeExpansion, surveyTotals, locationFields, equipmentOptions, newJob, duplicateJob, normalizeLocation, withJobSummary, validateLocation, jobTotals, parseInventory } from './schema.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const API = '/api/ap-survey';
let records = [], queue = [], db, editing = null, editVersion = null, currentPhoto = '', existingPhoto = false;
let unlocked = false, syncing = false, readingPhoto = false, saving = false, revision = 0;
let photoUrl = '';
let jobs=[],draftPhotos=[],inventory=[],expansionUnrecorded=false,formDirty=false,replacePhotoIndex=null;
let jobChoiceTouched=false;
let expansionTouched = false;
let lastSave = null, syncRequested = false;
class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
function notify(message) { $('notice').textContent = message; $('notice').classList.remove('hidden'); }
function lock(message = '') {
  unlocked = false; $('login').classList.remove('hidden'); $('workspace').classList.add('hidden'); $('logout').classList.add('hidden'); $('loginError').textContent = message; status();
}
function openWorkspace() {
  unlocked = true; $('login').classList.add('hidden'); $('workspace').classList.remove('hidden'); $('logout').classList.remove('hidden'); status();
}
function status() {
  if (lastSave) {
    const pending = queue.find(q => q.id === lastSave.id);
    const label = !pending ? `Synced ✓ ${lastSave.room} is saved in your database.` : (pending.error || pending.lastError) ? `Sync failed — ${lastSave.room} is saved on this device. ${pending.error || pending.lastError}` : !navigator.onLine ? `Saved on device — ${lastSave.room} will sync when you reconnect.` : syncing ? `Syncing ${lastSave.room} to your database…` : `Saved on device — ${lastSave.room} is waiting to sync.`;
    $('saveStatus').textContent = label; $('saveStatus').classList.remove('hidden');
  } else $('saveStatus').classList.add('hidden');
  $('syncStatus').textContent = !unlocked ? 'PIN protected' : syncing ? 'Syncing…' : queue.length ? `${queue.length} unsynced · ${navigator.onLine ? 'check drafts' : 'offline'}` : navigator.onLine ? 'All entries synced' : 'Offline · cached entries';
}
async function api(path, method = 'GET', body) {
  let response;
  try { response = await fetch(`${API}/${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type':'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError('No connection to the server. Changes are kept on this device.', 0); }
  let data;
  try { data = await response.json(); } catch { throw new ApiError('Survey API is unavailable. Check that Cloudflare deployed the Pages Functions.', response.status || 503); }
  if (!response.ok) {
    if (response.status === 401 && path !== 'login') lock('Enter your PIN again. Unsynced drafts are still on this device.');
    throw new ApiError(data.error || 'Server request failed.', response.status);
  }
  return data;
}
function addOptions(id, options, blankLabel = '(blanks)') {
  for (const value of options) { const option = document.createElement('option'); option.value = value; option.textContent = value || blankLabel; $(id).append(option); }
}
addOptions('category', categories); addOptions('categoryFilter', categories);
addOptions('lanRoom', lanRooms); addOptions('lanFilter', lanRooms);
async function openDb() {
  db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('askar-ap-survey-cloud-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const saved = await new Promise((resolve, reject) => {
    const request = db.transaction('workspace','readonly').objectStore('workspace').get('state');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  records=(saved?.records||[]).map(normalizeLocation);queue=(saved?.queue||[]).map(q=>q.entry?{...q,entry:withJobSummary(normalizeLocation(q.entry))}:q);inventory=saved?.inventory||[];renderInventory();render();
}
function saveState(nextRecords = records, nextQueue = queue) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace','readwrite');
    transaction.objectStore('workspace').put({ records: nextRecords, queue: nextQueue, inventory }, 'state');
    transaction.oncomplete = () => { records = nextRecords; queue = nextQueue; revision++; resolve(); };
    transaction.onerror = transaction.onabort = () => reject(new Error('Could not save on this device. Your form is still here. Check browser/device storage.'));
  });
}
// Serialize cache changes so sync responses cannot overwrite a newly captured draft.
let changes = Promise.resolve();
function mutate(callback) {
  const task = changes.then(callback); changes = task.catch(() => {}); return task;
}
function options(values,value){return values.map(v=>`<option value="${esc(v)}"${v===value?' selected':''}>${esc(v)}</option>`).join('');}
function jobLabel(job){const group=jobs.filter(j=>j.type===job.type);return `${job.type==='TR'?'TR':'EXP'}-${String(group.indexOf(job)+1).padStart(2,'0')}`;}
function jobSummary(job,label){return `${label} · ${job.hostname||'No hostname'} · Cable: ${job.type==='TR'&&job.relocation!=='Yes'?'No':job.cabling} · ${job.equipment}${job.type==='Expansion'&&job.bracket?' · L-bracket':''}`;}
function jobInput(j,label,field,extra=''){return `<div><label for="${esc(j.id)}-${field}">${label}</label><input id="${esc(j.id)}-${field}" data-field="${field}" value="${esc(j[field])}" maxlength="${field==='mac'?30:field==='serial'?100:150}" ${extra}></div>`;}
function renderJobs(openId){
 for(const type of ['TR','Expansion']){
  $(type==='TR'?'jobsTR':'jobsExpansion').innerHTML=jobs.filter(j=>j.type===type).map(j=>{
   const label=jobLabel(j),relocated=j.type==='TR'&&j.relocation==='Yes';
   return `<details class="apjob" data-job="${esc(j.id)}"${j.id===openId?' open':''}><summary><strong data-job-summary>${esc(jobSummary(j,label))}</strong></summary><div class="jobbody"><div class="grid">${jobInput(j,type==='TR'?'Old AP Hostname (inventory search)':'Proposed AP label / hostname (optional)','hostname',type==='TR'?'list="inventoryNames" autocomplete="off"':'')}${jobInput(j,'AP Model (optional)','model')}${type==='TR'?jobInput(j,'Old AP Serial (optional)','serial')+jobInput(j,'Old AP MAC (optional)','mac'):''}
   ${type==='TR'?`<div><label>Relocate existing AP?</label><select data-field="relocation">${options(['No','Yes'],j.relocation)}</select></div><div class="full relocationReason${relocated?'':' hidden'}"><label>Relocation reason *</label><textarea data-field="reason" maxlength="1000"${relocated?' required':''}>${esc(j.reason)}</textarea></div>`:''}
   <div class="jobCabling${type==='Expansion'||relocated?'':' hidden'}"><label>New cabling required?</label><select data-field="cabling">${options(['No','Yes','Not assessed'],j.cabling)}</select></div><div><label>Access equipment</label><select data-field="equipment">${options(equipmentOptions,j.equipment)}</select></div>
   ${type==='Expansion'?`<div><label>L-bracket required?</label><select data-field="bracket"><option value="false"${!j.bracket?' selected':''}>No</option><option value="true"${j.bracket?' selected':''}>Yes</option></select></div>`:''}<div class="full"><label>AP-specific notes (optional)</label><textarea data-field="notes" maxlength="1000">${esc(j.notes)}</textarea></div></div><div class="tools"><button type="button" data-similar="${esc(j.id)}">+ Add similar AP</button><button type="button" data-remove-job="${esc(j.id)}" class="danger">Remove AP</button></div></div></details>`;
  }).join('');
 }
 $('expansionLegacy').classList.toggle('hidden',!expansionUnrecorded);photoRules();
}
function photoRules(){
 $('photo').multiple=$('category').value!=='Classrooms';
 $('photoStatus').textContent=`${draftPhotos.length} photo(s) attached. ${jobs.some(j=>j.type==='Expansion'||j.relocation==='Yes')?'At least one is required.':'Photos are optional.'} ${$('category').value==='Classrooms'?'Classrooms use one shared photo.':'Maximum six photos; 10 MB combined new uploads.'}`;
}
function photoUrlFor(record,photo){return photo.data||`${API}/photos/${record.id}?photo=${photo.remoteIndex}`;}
function renderPhotos(){photoRules();$('photoList').innerHTML=draftPhotos.map((p,i)=>`<div class="photocard"><img src="${esc(photoUrlFor({id:editing},p))}" alt="Room photo ${i+1}"><p class="hint">Photo ${i+1}</p><button type="button" data-replace-photo="${i}">Replace</button> <button type="button" data-remove-photo="${i}" class="danger">Remove</button></div>`).join('');}
function resetForm(retain=false){
 const carried=retain?Object.fromEntries(['building','floor','lanRoom','network','category'].map(f=>[f,$(f).value])):{};
 editing=null;editVersion=null;draftPhotos=[];expansionUnrecorded=false;jobChoiceTouched=false;$('form').reset();Object.entries(carried).forEach(([f,v])=>$(f).value=v);
 jobs=[newJob('TR')];if($('category').value==='Classrooms')jobs.push(newJob('Expansion'));
 $('formTitle').textContent='New location survey';$('save').textContent='Save & next location →';$('saveBlank').classList.remove('hidden');$('cancel').classList.add('hidden');renderJobs(jobs[0].id);renderPhotos();formDirty=false;
}
function showList(){$('entry').classList.add('hidden');$('list').classList.remove('hidden');$('inventory').classList.add('hidden');render();window.scrollTo(0,0);}
function showForm(){$('entry').classList.remove('hidden');$('list').classList.add('hidden');$('inventory').classList.add('hidden');window.scrollTo(0,0);}
function filteredRecords(){const q=$('search').value.toLowerCase();return records.filter(r=>{
 const exp=r.jobs.some(j=>j.type==='Expansion')?'Yes':r.expansionUnrecorded?'':'No';
 const text=[...locationFields.map(f=>r[f]),...r.jobs.flatMap(j=>Object.values(j))].join(' ').toLowerCase();
 return text.includes(q)&&($('categoryFilter').value==='all'||r.category===$('categoryFilter').value)&&($('lanFilter').value==='all'||r.lanRoom===$('lanFilter').value)&&($('expansionFilter').value==='all'||exp===$('expansionFilter').value);
 });}
function reviewJobs(record){return record.jobs.map((j,i)=>`<details><summary>${esc(`${j.type==='TR'?'TR':'EXP'} · ${j.hostname||'Unnamed AP'} · ${j.equipment}`)}</summary><p>Model: ${esc(j.model||'—')}<br>Serial: ${esc(j.serial||'—')}<br>MAC: ${esc(j.mac||'—')}<br>Relocation: ${j.type==='TR'?esc(j.relocation):'N/A'}<br>Cabling: ${esc(j.type==='TR'&&j.relocation!=='Yes'?'No':j.cabling)}<br>L-bracket: ${j.type==='Expansion'?(j.bracket?'Yes':'No'):'N/A'}<br>Reason: ${esc(j.reason||'—')}<br>Notes: ${esc(j.notes||'—')}</p></details>`).join('');}
function render(){
 $('total').textContent=records.length;$('count').textContent=records.length;const filtered=filteredRecords();$('listCount').textContent=`Showing ${filtered.length} of ${records.length} locations`;
 const current=jobTotals(filtered),all=jobTotals(records);const metrics=[['Locations','locations'],['TR APs','tr'],['Additional APs','expansion'],['Total APs','totalAPs'],['Relocation cable runs','relocationCables'],['Expansion cable runs','expansionCables'],['Total new cable runs','totalCables'],['L-brackets','brackets'],['Scaffolding · AP jobs','scaffoldingJobs'],['Scaffolding · locations','scaffoldingLocations'],['Scissor lift · AP jobs','liftJobs'],['Scissor lift · locations','liftLocations'],['Cabling not assessed','pendingCabling'],['Equipment needs assessment','equipmentPending'],['Expansion not recorded · locations','expansionUnrecorded']];
 $('cablingSummary').innerHTML='<h2 class="section">Survey quantities</h2><table><thead><tr><th>Quantity</th><th>Filtered</th><th>Full register</th></tr></thead><tbody>'+metrics.map(([label,key])=>`<tr><td>${label}</td><td>${current[key]}</td><td>${all[key]}</td></tr>`).join('')+'</tbody></table><p class="hint">Each cabling Yes means one cable run. Equipment counts are AP jobs and affected locations, not bookings. Totals include unsynced locations.</p>';
 $('empty').classList.toggle('hidden',!!filtered.length);$('table').classList.toggle('hidden',!filtered.length);$('empty').querySelector('h2').textContent=records.length?'No matching locations':'No locations yet';
 const nameCounts=new Map();for(const r of records)for(const j of r.jobs)if(j.hostname.trim()){const n=j.hostname.trim().toLowerCase();nameCounts.set(n,(nameCounts.get(n)||0)+1);}
 $('rows').innerHTML=filtered.map(r=>`<tr>${['building','floor','room','category','network','lanRoom'].map(f=>`<td>${esc(r[f]||'—')}</td>`).join('')}<td class="joblist">${r.jobs.some(j=>nameCounts.get(j.hostname.trim().toLowerCase())>1)?'<p class="danger">Check duplicate hostname</p>':''}${reviewJobs(r)}</td><td>${(r.photos||[]).map((p,i)=>`<p><button data-view-photo="${esc(r.id)}" data-index="${i}">View ${i+1}</button> <button data-download-photo="${esc(r.id)}" data-index="${i}">Download</button></p>`).join('')||'—'}</td><td style="white-space:pre-wrap;min-width:160px">${esc(r.remarks||'—')}</td><td>${queue.some(q=>q.id===r.id)?'Saved on device · pending':'Synced ✓'}</td><td><button data-edit="${esc(r.id)}">Edit</button> <button data-delete="${esc(r.id)}" class="danger">Delete location</button></td></tr>`).join('');
 $('pendingPanel').classList.toggle('hidden',!queue.length);$('pendingRows').innerHTML=queue.map(q=>`<div style="padding:12px 0"><strong>${esc(q.entry?.room||q.room||'Deleted location')}</strong><p class="hint">${esc(q.error||q.lastError||'Waiting to sync')}</p><button data-retry="${esc(q.id)}">Retry</button> <button data-discard="${esc(q.id)}">Discard unsynced change</button></div>`).join('');status();
}
async function enqueue(entry) {
  return await mutate(async () => {
    const previous = queue.find(q => q.id === entry.id);
    const task = { id: entry.id, operation: previous?.operation === 'create' || !editing ? 'create' : 'update', expectedUpdatedAt: previous?.expectedUpdatedAt || editVersion || records.find(r => r.id === entry.id)?.updatedAt, entry, token: crypto.randomUUID() };
    await saveState([...records.filter(r => r.id !== entry.id), entry], [...queue.filter(q => q.id !== entry.id), task]);
    return task;
  });
}
async function fetchEntries() {
  let all = [], offset = 0;
  do { const page = await api(`entries?offset=${offset}`); all.push(...page.entries.map(normalizeLocation)); offset = page.nextOffset; } while (offset !== null);
  return all;
}
async function refresh() {
  const startRevision = revision;
  const remote = await fetchEntries();
  await mutate(async () => {
    // If a save just finished while this fetch was in flight, get a fresh snapshot next time.
    if (revision !== startRevision) return;
    const pendingIds = new Set(queue.map(q => q.id));
    await saveState([...remote.filter(r => !pendingIds.has(r.id)), ...records.filter(r => pendingIds.has(r.id))], queue);
  });
  render();
}
async function sync() {
  if (syncing) { syncRequested = true; return; }
  if (!unlocked || !navigator.onLine) return;
  syncRequested = false; syncing = true; status();
  try {
    for (const initial of [...queue]) {
      const task = queue.find(q => q.id === initial.id); if (!task || task.error) continue;
      try {
        let response;
        if (task.operation === 'delete') response = await api(`entries/${task.id}`, 'DELETE', { expectedUpdatedAt:task.expectedUpdatedAt });
        else response = await api(task.operation === 'create' ? 'entries' : `entries/${task.id}`, task.operation === 'create' ? 'POST' : 'PUT', { entry:task.entry, expectedUpdatedAt:task.expectedUpdatedAt });
        await mutate(async () => {
          const current = queue.find(q => q.id === task.id);
          if (current?.token === task.token) {
            const next = records.filter(r => r.id !== task.id);
            if (response.entry) next.push(normalizeLocation(response.entry));
            await saveState(next, queue.filter(q => q.id !== task.id));
          } else if (current && response.entry) {
            // A newer local edit must use the version returned by this completed save.
            await saveState(records, queue.map(q => q.id === task.id ? { ...q, operation:q.operation === 'delete' ? 'delete' : 'update', expectedUpdatedAt:response.entry.updatedAt } : q));
          }
        });
      } catch (error) {
        if ([400,409,413,415].includes(error.status)) {
          await mutate(async () => saveState(records, queue.map(q => q.token === task.token ? { ...q, error:error.message } : q)));
        } else {
          if (lastSave?.id === task.id) $('saveStatus').textContent = `Sync failed — saved on device. ${error.message}`;
          await mutate(async () => saveState(records, queue.map(q => q.token === task.token ? { ...q, lastError:error.message } : q)));
          notify(error.message); break;
        }
      }
    }
    if (unlocked) await refresh();
  } catch (error) { notify(error.message); }
  finally { syncing = false; render(); if (syncRequested && unlocked && navigator.onLine) { syncRequested = false; void sync(); } }
}
async function loadInventory(){let items=[],offset=0;do{const page=await api(`inventory?offset=${offset}`);items.push(...page.items);offset=page.nextOffset;}while(offset!==null);inventory=items;await mutate(()=>saveState());renderInventory();}
function renderInventory(){
 $('inventoryNames').innerHTML=inventory.map(r=>`<option value="${esc(r.hostname)}">${esc(r.model||'')}</option>`).join('');
 const q=$('inventorySearch').value.toLowerCase();const subset=inventory.filter(r=>Object.values(r).join(' ').toLowerCase().includes(q));$('inventoryStatus').textContent=`${inventory.length} APs available for hostname lookup.`;
 $('inventoryTable').innerHTML='<table><thead><tr><th>Hostname</th><th>Model</th><th>Serial</th><th>MAC</th></tr></thead><tbody>'+subset.map(r=>`<tr>${['hostname','model','serial','mac'].map(f=>`<td>${esc(r[f]||'—')}</td>`).join('')}</tr>`).join('')+'</tbody></table>';
}
$('loginForm').onsubmit=async e=>{e.preventDefault();$('unlock').disabled=true;try{await api('login','POST',{pin:$('pin').value});$('pin').value='';localStorage.setItem('ap-survey-used','yes');openWorkspace();await sync();try{await loadInventory();}catch(err){notify(err.message);}}catch(err){$('loginError').textContent=err.message;}finally{$('unlock').disabled=false;}};
$('logout').onclick=async()=>{if((queue.length||formDirty)&&!confirm('Saved drafts remain on this device; unsaved form changes are not uploaded. Lock app?'))return;try{await api('logout','POST',{});localStorage.removeItem('ap-survey-used');lock();}catch(err){notify(err.message);}};
function busy(){if(readingPhoto||saving){notify('Wait for the current photo or save to finish.');return true;}return false;}
function leaveForm(){return !formDirty||confirm('Leave unsaved form changes? Saved/offline locations are retained.');}
$('view').onclick=()=>{if(!busy()&&leaveForm())showList();};$('new').onclick=()=>{if(!busy()){resetForm(false);showForm();}};
$('cancel').onclick=()=>{if(!busy()&&leaveForm()){resetForm(false);showList();}};
$('category').onchange=()=>{formDirty=true;if(!editing&&!jobChoiceTouched){if($('category').value==='Classrooms'&&!jobs.some(j=>j.type==='Expansion'))jobs.push(newJob('Expansion'));else if($('category').value!=='Classrooms')jobs=jobs.filter(j=>j.type==='TR');}renderJobs();renderPhotos();};
$('assessExpansion').onclick=()=>{expansionUnrecorded=false;formDirty=true;renderJobs();};
function addJob(type,source){if(jobs.length>=100){notify('Maximum 100 AP jobs per location.');return;}const job=source?duplicateJob(source):newJob(type);jobs.push(job);jobChoiceTouched=true;if(job.type==='Expansion')expansionUnrecorded=false;formDirty=true;renderJobs(job.id);}
$('addTR').onclick=()=>addJob('TR');$('addExpansion').onclick=()=>addJob('Expansion');
function jobEvent(e){const details=e.target.closest('[data-job]');if(!details||!e.target.dataset.field)return;const job=jobs.find(j=>j.id===details.dataset.job),field=e.target.dataset.field;
 if(!job||!['hostname','model','serial','mac','relocation','reason','cabling','equipment','bracket','notes'].includes(field))return;
 job[field]=field==='bracket'?e.target.value==='true':e.target.value;formDirty=true;jobChoiceTouched=true;
 if(field==='hostname'&&e.type==='change'&&job.type==='TR'){
  const item=inventory.find(r=>r.hostname.toLowerCase()===job.hostname.trim().toLowerCase());if(item){Object.assign(job,{hostname:item.hostname,model:item.model,serial:item.serial,mac:item.mac});renderJobs(job.id);return;}
 }
 details.querySelector('[data-job-summary]').textContent=jobSummary(job,jobLabel(job));
 if(field==='relocation'){
  if(job.relocation==='No'){job.reason='';job.cabling='No';}else job.cabling='Not assessed';renderJobs(job.id);
 }
 photoRules();
}
for(const id of ['jobsTR','jobsExpansion']){
 $(id).oninput=jobEvent;$(id).onchange=jobEvent;$(id).onclick=e=>{
  const similar=e.target.dataset.similar,remove=e.target.dataset.removeJob;
  if(similar)addJob('',jobs.find(j=>j.id===similar));
  if(remove&&confirm('Remove this AP job from the location?')){const removed=jobs.find(j=>j.id===remove);jobs=jobs.filter(j=>j.id!==remove);jobChoiceTouched=true;if(removed?.type==='Expansion')expansionUnrecorded=false;formDirty=true;renderJobs();}
 };
}
for(const [button,field,input] of [['applyEquipment','equipment','bulkEquipment'],['applyCabling','cabling','bulkCabling'],['applyBracket','bracket','bulkBracket']])$(button).onclick=()=>{
 const target=$('bulkTarget').value;if(!confirm('Apply this requirement to matching AP jobs in this location?'))return;
 for(const job of jobs){if(target!=='all'&&job.type!==target)continue;if(field==='cabling'&&job.type==='TR'&&job.relocation!=='Yes')continue;if(field==='bracket'&&job.type!=='Expansion')continue;job[field]=field==='bracket'?$(input).value==='true':$(input).value;}
 formDirty=true;renderJobs();
};
$('form').addEventListener('input',()=>formDirty=true);
$('photoList').onclick=e=>{
 if(busy())return;const remove=e.target.dataset.removePhoto,replace=e.target.dataset.replacePhoto;
 if(remove!==undefined){draftPhotos.splice(Number(remove),1);formDirty=true;renderPhotos();}
 if(replace!==undefined){replacePhotoIndex=Number(replace);$('photo').multiple=false;$('photo').value='';$('photo').click();}
};
$('photo').onchange=async()=>{
 const files=Array.from($('photo').files||[]);if(!files.length){replacePhotoIndex=null;return;}
 const max=$('category').value==='Classrooms'?1:6;
 if((replacePhotoIndex===null?draftPhotos.length+files.length:draftPhotos.length)>max){notify(`This location allows ${max} photo(s). Use Replace to change an existing photo.`);replacePhotoIndex=null;$('photo').value='';return;}
 readingPhoto=true;$('save').disabled=true;$('saveBlank').disabled=true;
 try{
  const prepared=[];for(const file of files){
   if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose JPG, PNG or WebP photos.');
   const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas'),scale=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const data=canvas.toDataURL('image/jpeg',0.85);if(data.length>7*1024*1024)throw new Error('A photo is too large. Choose a smaller image.');prepared.push({data});
  }
  const next=[...draftPhotos];if(replacePhotoIndex===null)next.push(...prepared);else next.splice(replacePhotoIndex,1,prepared[0]);
  if(next.reduce((n,p)=>n+(p.data?.length||0)*0.75,0)>10*1024*1024)throw new Error('Combined new photos must be under 10 MB.');
  draftPhotos=next;formDirty=true;renderPhotos();
 }catch(err){notify(err.message);}finally{readingPhoto=false;$('save').disabled=false;$('saveBlank').disabled=false;$('photo').value='';replacePhotoIndex=null;photoRules();}
};
async function submitLocation(retain){
 if(busy())return;
 for(const input of $('form').querySelectorAll(':invalid')){const details=input.closest('details');if(details)details.open=true;}
 if(!$('form').reportValidity())return;
 const entry=withJobSummary({...Object.fromEntries(locationFields.map(f=>[f,$(f).value.trim()])),id:editing||crypto.randomUUID(),jobs:structuredClone(jobs),photos:structuredClone(draftPhotos),expansionUnrecorded,updatedAt:editVersion,createdAt:records.find(r=>r.id===editing)?.createdAt||new Date().toISOString()});
 const invalid=validateLocation(entry);if(invalid){notify(invalid);return;}
 if(entry.category==='Classrooms'&&entry.photos.length>1){notify('Classrooms use one shared photo. Remove extra photos.');return;}
 if(jobs.some(j=>j.type==='Expansion'||j.relocation==='Yes')&&!draftPhotos.length){notify('Attach a wide-angle photo for relocation or expansion.');return;}
 const names=new Set(jobs.map(j=>j.hostname.trim().toLowerCase()).filter(Boolean));
 if(records.some(r=>r.id!==entry.id&&r.jobs.some(j=>names.has(j.hostname.trim().toLowerCase())))&&!confirm('A hostname is already assigned to another saved location. Save anyway?'))return;
 saving=true;$('save').disabled=true;$('saveBlank').disabled=true;
 try{const wasEdit=!!editing;await enqueue(entry);lastSave={id:entry.id,room:entry.room};resetForm(retain&&!wasEdit);render();$('notice').classList.add('hidden');if(wasEdit)showList();else{$('room').focus();window.scrollTo(0,0);}void sync();}
 catch(err){notify(err.message);}finally{saving=false;$('save').disabled=false;$('saveBlank').disabled=false;}
}
$('form').onsubmit=e=>{e.preventDefault();void submitLocation(true);};$('saveBlank').onclick=()=>void submitLocation(false);
for(const id of ['search','categoryFilter','lanFilter','expansionFilter'])$(id)[id==='search'?'oninput':'onchange']=render;
$('clearFilters').onclick=()=>{$('search').value='';for(const id of ['categoryFilter','lanFilter','expansionFilter'])$(id).value='all';render();};$('refresh').onclick=()=>void sync();
async function loadPhoto(record,photo){if(photo.data)return await(await fetch(photo.data)).blob();const response=await fetch(`${API}/photos/${record.id}?photo=${photo.remoteIndex}`,{credentials:'same-origin',cache:'no-store'});if(!response.ok){if(response.status===401)lock('Enter your PIN to access photos.');throw new Error('Could not load photo. Check connection and login.');}return response.blob();}
function saveDownload(name,blob){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('rows').onclick=async e=>{
 const {edit,delete:remove,viewPhoto,downloadPhoto,index}=e.target.dataset;
 try{
  if(edit){if(busy())return;const r=records.find(r=>r.id===edit);resetForm();editing=r.id;editVersion=r.updatedAt||null;for(const f of locationFields)$(f).value=r[f]||'';jobs=structuredClone(r.jobs);draftPhotos=structuredClone(r.photos||[]);expansionUnrecorded=!!r.expansionUnrecorded;jobChoiceTouched=true;$('formTitle').textContent='Edit location survey';$('save').textContent='Save changes';$('saveBlank').classList.add('hidden');$('cancel').classList.remove('hidden');renderJobs(jobs[0]?.id);renderPhotos();showForm();formDirty=false;}
  if(viewPhoto||downloadPhoto){const r=records.find(r=>r.id===(viewPhoto||downloadPhoto)),i=Number(index),blob=await loadPhoto(r,r.photos[i]);if(downloadPhoto){const name=[r.building,r.floor,r.room,'survey',i+1].join('-').replace(/[^a-z0-9_-]/gi,'-').slice(0,120);saveDownload(name+'.'+(blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg'),blob);}else{if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=URL.createObjectURL(blob);$('photoDialogImage').src=photoUrl;$('photoDialog').showModal();}}
  if(remove){if(syncing){notify('Wait for syncing to finish before deleting.');return;}if(!confirm('Delete this location and all its AP jobs from the shared register?'))return;
   await mutate(async()=>{const r=records.find(r=>r.id===remove),previous=queue.find(q=>q.id===remove),next=queue.filter(q=>q.id!==remove);if(previous?.operation!=='create')next.push({id:remove,room:r.room,operation:'delete',expectedUpdatedAt:previous?.expectedUpdatedAt||r.updatedAt,token:crypto.randomUUID()});if(lastSave?.id===remove)lastSave=null;await saveState(records.filter(r=>r.id!==remove),next);});render();void sync();}
 }catch(err){notify(err.message);}
};
$('pendingRows').onclick=async e=>{
 const {retry,discard}=e.target.dataset;try{
  if(retry){await mutate(()=>saveState(records,queue.map(q=>q.id===retry?{...q,error:undefined,lastError:undefined}:q)));render();void sync();}
  if(discard){if(syncing||!navigator.onLine){notify('Wait for sync to finish and reconnect before discarding.');return;}if(!confirm('Discard this unsynced change? Download a backup first if needed.'))return;const remote=await fetchEntries();await mutate(async()=>{if(lastSave?.id===discard)lastSave=null;const next=queue.filter(q=>q.id!==discard),ids=new Set(next.map(q=>q.id));await saveState([...remote.filter(r=>!ids.has(r.id)),...records.filter(r=>ids.has(r.id))],next);});render();}
 }catch(err){notify(err.message);}
};
const csvCell=value=>'"'+String(value??'').replace(/^(\s*)([=+@-])/,'$1\'$2').replace(/"/g,'""')+'"';
$('csv').onclick=()=>{
 const headers=['Building','Floor','Location','Category','Network','LAN / Server Room','Job','Type','Hostname','Model','Serial','MAC','Relocation','Reason','Cabling','Equipment','L-bracket','AP Notes','Location Remarks','Sync'];
 const rows=[];for(const r of records){const counters={TR:0,Expansion:0};for(const j of r.jobs){const label=`${j.type==='TR'?'TR':'EXP'}-${String(++counters[j.type]).padStart(2,'0')}`;rows.push([r.building,r.floor,r.room,r.category,r.network,r.lanRoom,label,j.type,j.hostname,j.model,j.serial,j.mac,j.type==='TR'?j.relocation:'N/A',j.reason,j.type==='TR'&&j.relocation!=='Yes'?'No':j.cabling,j.equipment,j.type==='Expansion'?(j.bracket?'Yes':'No'):'N/A',j.notes,r.remarks,queue.some(q=>q.id===r.id)?'Pending':'Synced']);}}
 saveDownload('ap-survey-jobs.csv',new Blob(['\ufeff'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
};
$('backup').onclick=async()=>{
 $('backup').disabled=true;notify('Preparing full backup including photos…');try{
  const copy=structuredClone(records);for(const r of copy){const photos=[];for(const p of r.photos||[]){if(p.data)photos.push(p);else{const blob=await loadPhoto(r,p);const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});photos.push({data});}}r.photos=photos;delete r.photo;}
  saveDownload('ap-survey-backup.json',new Blob([JSON.stringify({version:2,records:copy,inventory,pendingChanges:queue},null,2)],{type:'application/json'}));notify('Backup downloaded with AP jobs, photos and an inventory copy. Inventory can be restored separately from the inventory page.');
 }catch(err){notify('Backup failed: '+err.message);}finally{$('backup').disabled=false;}
};
$('restore').onclick=()=>{$('file').value='';$('file').click();};$('file').onchange=async()=>{
 try{const file=$('file').files[0];if(!file)return;if(file.size>100*1024*1024)throw new Error('Backup limit: 100 MB.');const data=JSON.parse(await file.text());if(![1,2].includes(data.version)||!Array.isArray(data.records)||data.records.length>5000)throw new Error('Choose an AP Survey backup.');const additions=[];let skipped=0;
  for(const raw of data.records){if(records.some(r=>r.id===raw.id)){skipped++;continue;}const r=withJobSummary(normalizeLocation(raw));const error=validateLocation(r);if(error)throw new Error(`${r.room||'Location'}: ${error}`);if((r.photos||[]).some(p=>!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.data||'')))throw new Error('Backup photos must be embedded, not server references.');if(r.jobs.some(j=>j.type==='Expansion'||j.relocation==='Yes')&&!r.photos.length)throw new Error(`${r.room}: shared photo missing.`);if(r.photos.length>6||(r.category==='Classrooms'&&r.photos.length>1))throw new Error('Too many location photos.');if(r.photos.reduce((n,p)=>n+p.data.length*0.75,0)>10*1024*1024)throw new Error('Photos exceed 10 MB for one location.');additions.push(r);}
  if(new Set(additions.map(r=>r.id)).size!==additions.length)throw new Error('Duplicate location IDs in backup.');if(!additions.length){notify('No new locations to import. Existing IDs are skipped.');return;}if(!confirm(`Add ${additions.length} locations? ${skipped} existing locations will be skipped.`))return;
  await mutate(()=>saveState([...records,...additions],[...queue,...additions.map(entry=>({id:entry.id,entry,operation:'create',token:crypto.randomUUID()}))]));render();notify('Locations imported on this device. Syncing…');void sync();
 }catch(err){notify('Import failed: '+err.message);}
};
$('manageInventory').onclick=async()=>{$('entry').classList.add('hidden');$('list').classList.add('hidden');$('inventory').classList.remove('hidden');renderInventory();try{await loadInventory();}catch(err){notify(err.message);}};
$('inventoryBack').onclick=showList;$('inventorySearch').oninput=renderInventory;
$('importInventory').onclick=()=>{$('inventoryFile').value='';$('inventoryFile').click();};
$('inventoryTemplate').onclick=()=>saveDownload('ap-inventory-template.csv',new Blob(['Hostname,Model,Serial,MAC\r\nL1AP01,AIR-AP3802I-S-K9,,\r\n'],{type:'text/csv'}));
$('inventoryFile').onchange=async()=>{try{const f=$('inventoryFile').files[0];if(!f)return;if(f.size>2*1024*1024)throw new Error('CSV maximum 2 MB.');const items=parseInventory(await f.text());if(!confirm(`Import ${items.length} inventory APs? Matching hostnames will be updated. Saved surveys are not changed.`))return;await api('inventory','POST',{items});await loadInventory();notify(`Imported ${items.length} APs. Choose their hostnames in a TR job.`);}catch(err){notify('Inventory import failed: '+err.message);}};
$('print').onclick=()=>{document.querySelectorAll('#rows details').forEach(d=>d.open=true);window.print();};
window.addEventListener('online',()=>{if(unlocked)void sync();});window.addEventListener('offline',status);
window.addEventListener('beforeunload',e=>{if(saving||readingPhoto||formDirty){e.preventDefault();e.returnValue='';}});
setInterval(()=>{if(unlocked&&navigator.onLine&&!syncing&&!saving)void sync();},30000);
async function start(){try{await openDb();resetForm();await api('session');openWorkspace();await sync();try{await loadInventory();}catch(err){notify(err.message);}}catch(err){if(err.status===0&&localStorage.getItem('ap-survey-used')==='yes'){openWorkspace();notify('Offline: cached locations and inventory are available. Drafts sync on reconnection.');}else lock(err.status===401?'':err.message);}}
void start();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/ap-survey/sw.js',{scope:'/ap-survey/'}).catch(()=>notify('Offline page caching unavailable. Keep this tab open without reception.'));

$('restoreInventoryBackup').onclick=()=>{$('inventoryBackupFile').value='';$('inventoryBackupFile').click();};
$('inventoryBackupFile').onchange=async()=>{try{
 const file=$('inventoryBackupFile').files[0];if(!file)return;if(file.size>100*1024*1024)throw new Error('Backup maximum 100 MB.');
 const data=JSON.parse(await file.text());if(!Array.isArray(data.inventory)||!data.inventory.length||data.inventory.length>2000)throw new Error('No valid inventory in this backup.');
 const items=data.inventory.map(r=>({hostname:r.hostname,model:r.model,serial:r.serial,mac:r.mac}));
 if(!confirm(`Restore ${items.length} inventory APs? Matching hostnames will be overwritten, saved surveys remain unchanged.`))return;
 await api('inventory','POST',{items});await loadInventory();notify('Inventory restored.');
}catch(err){notify('Inventory restore failed: '+err.message);}};
