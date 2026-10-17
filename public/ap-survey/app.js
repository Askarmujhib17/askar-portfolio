import { LEGACY_SCHOOL_ID, schoolTypes, vendorForSchool, surveyFields, schoolJob, schoolLocation, prepareSurvey, surveyProblem, lanRooms, equipmentOptions, duplicateJob, jobTotals, parseInventory } from './schema.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const API = '/api/ap-survey';
let records = [], queue = [], db, editing = null, editVersion = null;
let unlocked = false, syncing = false, readingPhoto = false, saving = false, revision = 0;
let photoUrl = '';
let jobs=[],draftPhotos=[],inventory=[],expansionUnrecorded=false,formDirty=false;
let schools=[],activeSchool=null,editingSchool=null;
let storageReady;
$('unlock').disabled=true;
function ensureStorage(){
  if(!storageReady)storageReady=openDb().catch(error=>{throw new Error('Device storage is not ready. Close other AP Survey tabs and reopen this page. Your saved data has not been cleared.');});
  return storageReady;
}
let lastSave = null, syncRequested = false;
class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
function notify(message) { $('notice').textContent = message; $('notice').classList.remove('hidden'); }
function lock(message = '') {
  unlocked = false; $('login').classList.remove('hidden'); $('workspace').classList.add('hidden');$('schoolsScreen').classList.add('hidden'); $('logout').classList.add('hidden'); $('loginError').textContent = message; status();
}
function openWorkspace(){unlocked=true;$('login').classList.add('hidden');$('logout').classList.remove('hidden');showSchools();}
function status() {
  if (lastSave&&activeSchool&&lastSave.schoolId===activeSchool.id) {
    const pending = queue.find(q => q.id === lastSave.id);
    const label = !pending ? `Synced ✓ ${lastSave.room} is saved in your database.` : (pending.error || pending.lastError) ? `Sync failed — ${lastSave.room} is saved on this device. ${pending.error || pending.lastError}` : !navigator.onLine ? `Saved on device — ${lastSave.room} will sync when you reconnect.` : syncing ? `Syncing ${lastSave.room} to your database…` : `Saved on device — ${lastSave.room} is waiting to sync.`;
    $('saveStatus').textContent = label; $('saveStatus').classList.remove('hidden');
  } else $('saveStatus').classList.add('hidden');
  $('syncStatus').textContent = !unlocked ? 'PIN protected' : syncing ? 'Syncing…' : queue.length ? `${queue.length} unsynced · ${navigator.onLine ? 'check drafts' : 'offline'}` : navigator.onLine ? 'All entries synced' : 'Offline · cached entries';
}
async function api(path, method = 'GET', body,schoolId=activeSchool?.id) {
  const endpoint=new URL(`${API}/${path}`,location.origin);
  if(!/^(login|logout|session|schools)(\/|$)/.test(path)){if(!schoolId)throw new ApiError('Select a school first.',400);endpoint.searchParams.set('schoolId',schoolId);}
  let response;
  try { response = await fetch(endpoint.pathname+endpoint.search, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type':'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); }
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
addOptions('lanRoom', lanRooms); addOptions('lanFilter', lanRooms);
async function openDb() {
  db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('askar-ap-survey-cloud-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => { $('loginError').textContent='Device storage is waiting for another AP Survey tab. Close other tabs for this app.'; };
  });
  const saved = await new Promise((resolve, reject) => {
    const request = db.transaction('workspace','readonly').objectStore('workspace').get('state');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => { $('loginError').textContent='Device storage is waiting for another AP Survey tab. Close other tabs for this app.'; };
  });
  records=(saved?.records||[]).map(schoolLocation);queue=(saved?.queue||[]).map(q=>q.entry?{...q,schoolId:q.entry.schoolId||LEGACY_SCHOOL_ID,entry:prepareSurvey(schoolLocation(q.entry))}:{...q,schoolId:q.schoolId||LEGACY_SCHOOL_ID});inventory=(saved?.inventory||[]).map(r=>({...r,schoolId:r.schoolId||r.school_id||LEGACY_SCHOOL_ID}));schools=saved?.schools||[];renderSchools();render();
}
function saveState(nextRecords = records, nextQueue = queue) {
  return ensureStorage().then(()=>new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace','readwrite');
    transaction.objectStore('workspace').put({ records: nextRecords, queue: nextQueue, inventory,schools }, 'state');
    transaction.oncomplete = () => { records = nextRecords; queue = nextQueue; revision++; resolve(); };
    transaction.onerror = transaction.onabort = () => reject(new Error('Could not save on this device. Your form is still here. Check browser/device storage.'));
  }));
}
// Serialize cache changes so sync responses cannot overwrite a newly captured draft.
let changes = Promise.resolve();
function mutate(callback) {
  const task = changes.then(callback); changes = task.catch(() => {}); return task;
}
function options(values,value){return values.map(v=>`<option value="${esc(v)}"${v===value?' selected':''}>${esc(v||'Use location default')}</option>`).join('');}
const schoolRecords=()=>activeSchool?records.filter(r=>r.schoolId===activeSchool.id):[];
const schoolInventory=()=>activeSchool?inventory.filter(r=>r.schoolId===activeSchool.id):[];
const schoolQueue=()=>activeSchool?queue.filter(q=>(q.schoolId||q.entry?.schoolId)===activeSchool.id):[];
function schoolReady(){return activeSchool&&schoolTypes.includes(activeSchool.type);}
function renderSchools(){
 $('schoolList').innerHTML=schools.length?schools.map(s=>`<div class="schoolrow"><div><h2>${esc(s.name)}</h2><p>${esc(s.type==='Unassigned'?'Needs school details':`${s.type} · ${vendorForSchool(s.type)} APs`)}</p><p class="hint">${records.filter(r=>r.schoolId===s.id).length} cached locations · ${queue.filter(q=>(q.schoolId||q.entry?.schoolId)===s.id).length} unsynced</p></div><div class="tools"><button class="primary" data-open-school="${esc(s.id)}">Open survey</button><button data-edit-school="${esc(s.id)}">${s.type==='Unassigned'?'Set school details':'Edit details'}</button></div></div>`).join(''):'<div class="panel"><p>No schools yet. Add your first school to start surveying.</p></div>';
}
function showSchools(){activeSchool=null;lastSave=null;$('workspace').classList.add('hidden');$('schoolsScreen').classList.remove('hidden');renderSchools();status();window.scrollTo(0,0);}
async function loadSchools(){const result=await api('schools');schools=result.schools;await mutate(()=>saveState());renderSchools();}
function schoolBar(){if(!activeSchool)return;$('currentSchoolName').textContent=activeSchool.name;$('currentSchoolType').textContent=schoolReady()?`${activeSchool.type} · ${vendorForSchool(activeSchool.type)} APs`:'Complete school details before saving changes.';}
async function chooseSchool(id){if(syncing){notify('Wait for the current school sync to finish.');return;}activeSchool=schools.find(s=>s.id===id);if(!activeSchool)return;lastSave=null;$('schoolsScreen').classList.add('hidden');$('workspace').classList.remove('hidden');schoolBar();resetForm();renderInventory();showList();try{await sync();await loadInventory();}catch(err){notify(err.message);}}
function editSchoolForm(school){editingSchool=school?.id||null;$('schoolForm').classList.remove('hidden');$('schoolFormTitle').textContent=school?'School details':'New school';$('schoolName').value=school?.name||'';$('schoolType').value=schoolTypes.includes(school?.type)?school.type:'';$('schoolName').focus();}
$('addSchool').onclick=()=>editSchoolForm();$('cancelSchool').onclick=()=>{$('schoolForm').classList.add('hidden');editingSchool=null;};
$('schoolList').onclick=e=>{if(e.target.dataset.openSchool)void chooseSchool(e.target.dataset.openSchool);if(e.target.dataset.editSchool)editSchoolForm(schools.find(s=>s.id===e.target.dataset.editSchool));};
$('schoolForm').onsubmit=async e=>{
 e.preventDefault();if(!$('schoolName').value.trim()){showProblem({field:'schoolName',message:'Enter the school name.'});return;}if(!schoolTypes.includes($('schoolType').value)){showProblem({field:'schoolType',message:'Choose Primary or Secondary.'});return;}
 $('saveSchool').disabled=true;try{const r=await api(editingSchool?`schools/${editingSchool}`:'schools',editingSchool?'PUT':'POST',{name:$('schoolName').value.trim(),type:$('schoolType').value});schools=[...schools.filter(s=>s.id!==r.school.id),r.school];await mutate(()=>saveState());$('schoolForm').classList.add('hidden');renderSchools();notify('School saved. Open its survey to continue.');}catch(err){notify(err.message);}finally{$('saveSchool').disabled=false;}
};
function showProblem(problem){
 document.querySelectorAll('.invalid').forEach(el=>{el.classList.remove('invalid');el.removeAttribute('aria-invalid');});
 const target=problem.jobId?document.getElementById(`${problem.jobId}-${problem.field}`):document.getElementById(problem.field);
 notify(problem.message);if(target){const details=target.closest('details');if(details)details.open=true;target.classList.add('invalid');target.setAttribute('aria-invalid','true');target.scrollIntoView({behavior:'smooth',block:'center'});target.focus({preventScroll:true});}
}
function jobLabel(job){return`${job.type==='TR'?'TR':'EXP'}-${String(jobs.filter(j=>j.type===job.type).indexOf(job)+1).padStart(2,'0')}`;}
function toggle(job,field,label){const yes=field==='bracket'?job.bracket:job[field]==='Yes',labelValue=field==='cabling'&&job.cabling==='Not assessed'?'Not assessed':yes?'Yes':'No';return`<button type="button" id="${esc(job.id)}-${field}" class="toggle" aria-pressed="${yes}" data-toggle="${field}">${label}: ${labelValue}</button>`;}
function jobInput(job,label,field,max=150){return`<div><label for="${esc(job.id)}-${field}">${label}</label><input id="${esc(job.id)}-${field}" data-field="${field}" value="${esc(job[field]||'')}" maxlength="${max}"></div>`;}
function renderJobs(openId){
 for(const type of ['TR','Expansion'])$(type==='TR'?'jobsTR':'jobsExpansion').innerHTML=jobs.filter(j=>j.type===type).map(j=>{
 const label=jobLabel(j),more=(j.equipmentOverride||j.lanRoomOverride)?' · exception set':'';
 return`<div class="aprow" data-job="${esc(j.id)}"><div class="aprowhead"><strong>${label}</strong>${type==='TR'?`<input id="${esc(j.id)}-hostname" data-field="hostname" list="inventoryNames" value="${esc(j.hostname)}" maxlength="150" placeholder="Hostname *" aria-label="${label} hostname" enterkeyhint="next">`:'<span class="hint">Additional AP</span>'}<button type="button" class="danger" data-remove-job="${esc(j.id)}" aria-label="Remove ${label}">Remove</button></div><div class="requirementrow">${type==='TR'?toggle(j,'relocation','Relocate'):''}${toggle(j,'bracket','L-bracket')}${type==='Expansion'||j.relocation==='Yes'?toggle(j,'cabling','New cabling'):''}</div><details class="compactdetails"${j.id===openId?' open':''}><summary>More details · MAC / serial / exceptions${esc(more)}</summary><div class="grid">${type==='Expansion'?jobInput(j,'Proposed hostname (optional)','hostname'):''}${jobInput(j,'AP model (optional)','model')}${type==='TR'?jobInput(j,'MAC (optional)','mac',30)+jobInput(j,'Serial (optional)','serial',100):''}<div><label for="${esc(j.id)}-lanRoomOverride">LAN room exception</label><select id="${esc(j.id)}-lanRoomOverride" data-field="lanRoomOverride">${options(['',...lanRooms],j.lanRoomOverride)}</select></div><div><label for="${esc(j.id)}-equipmentOverride">Equipment exception</label><select id="${esc(j.id)}-equipmentOverride" data-field="equipmentOverride">${options(['',...equipmentOptions],j.equipmentOverride)}</select></div>${j.type==='TR'&&j.relocation==='Yes'?`<div class="full"><label for="${esc(j.id)}-reason">Relocation detail (optional)</label><textarea id="${esc(j.id)}-reason" data-field="reason" maxlength="1000">${esc(j.reason)}</textarea></div>`:''}<div class="full"><label for="${esc(j.id)}-notes">AP notes (optional)</label><textarea id="${esc(j.id)}-notes" data-field="notes" maxlength="1000">${esc(j.notes)}</textarea></div></div><button type="button" data-similar="${esc(j.id)}" style="margin-top:10px">+ Add similar AP</button></details></div>`;
 }).join('');
 $('expansionQuantity').value=jobs.filter(j=>j.type==='Expansion').length;$('expansionLegacy').classList.toggle('hidden',!expansionUnrecorded);
}
function renderPhotos(){
 const primary=draftPhotos[0];$('photoStatus').textContent=primary?`${draftPhotos.length>1?`${draftPhotos.length} legacy photos retained; only the first is shown here. `:''}Photo attached. Upload a new image to replace it.`:'No photo attached. This is optional.';
 $('photoList').innerHTML=primary?`<div class="photocard"><img src="${esc(primary.data||photoEndpoint(editing,primary.remoteIndex,activeSchool.id))}" alt="Location photo"><button type="button" id="removePhoto">Remove photo${draftPhotos.length>1?'s':''}</button></div>`:'';
}
function resetForm(retain=false){
 const carried=retain?Object.fromEntries(['building','floor','lanRoom'].map(f=>[f,$(f).value])):{};
 editing=null;editVersion=null;draftPhotos=[];jobs=[schoolJob('TR')];expansionUnrecorded=false;$('form').reset();for(const[f,v]of Object.entries(carried))$(f).value=v;
 $('formTitle').textContent='New location';$('save').textContent='Save & next location →';$('saveBlank').classList.remove('hidden');$('cancel').classList.add('hidden');$('pastePanel').open=false;$('hostnamePaste').value='';$('hostnamePasteStatus').textContent='';renderJobs();renderPhotos();formDirty=false;
}
function busy(){if(readingPhoto||saving){notify('Wait for the current photo or save to finish.');return true;}return false;}
function leaveForm(){return !formDirty||confirm('Leave unsaved form changes? Saved drafts are retained.');}
function showList(){$('entry').classList.add('hidden');$('list').classList.remove('hidden');$('inventory').classList.add('hidden');render();window.scrollTo(0,0);}
function showForm(){$('entry').classList.remove('hidden');$('list').classList.add('hidden');$('inventory').classList.add('hidden');window.scrollTo(0,0);}
function suggestions(){
 const rs=schoolRecords(),buildings=[...new Set(rs.map(r=>r.building))].sort();$('buildingNames').innerHTML=buildings.map(v=>`<option value="${esc(v)}"></option>`).join('');$('roomNames').innerHTML=[...new Set(rs.map(r=>r.roomName))].sort().map(v=>`<option value="${esc(v)}"></option>`).join('');
 const current=$('buildingFilter').value;$('buildingFilter').innerHTML='<option value="all">All buildings</option>'+buildings.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');$('buildingFilter').value=buildings.includes(current)?current:'all';
}
function filteredRecords(){const q=$('search').value.toLowerCase();return schoolRecords().filter(r=>{
 const exp=r.jobs.some(j=>j.type==='Expansion')?'Yes':r.expansionUnrecorded?'':'No';const text=[...surveyFields.map(f=>r[f]),...r.jobs.flatMap(j=>Object.values(j))].join(' ').toLowerCase();
 return text.includes(q)&&($('buildingFilter').value==='all'||r.building===$('buildingFilter').value)&&($('lanFilter').value==='all'||r.lanRoom===$('lanFilter').value||r.jobs.some(j=>j.lanRoomOverride===$('lanFilter').value))&&($('expansionFilter').value==='all'||exp===$('expansionFilter').value);
 });}
function reviewJobs(r){return r.jobs.map(j=>`<details><summary>${esc(`${j.type==='TR'?'TR':'EXP'} · ${j.hostname||'Proposed AP'} · ${j.equipment}`)}</summary><p>Model: ${esc(j.model||'—')}<br>MAC: ${esc(j.mac||'—')}<br>Serial: ${esc(j.serial||'—')}<br>LAN room: ${esc(j.lanRoomOverride||r.lanRoom)}<br>Relocation: ${j.type==='TR'?j.relocation:'N/A'}<br>Cabling: ${j.type==='TR'&&j.relocation!=='Yes'?'No':esc(j.cabling)}<br>L-bracket: ${j.bracket?'Yes':'No'}<br>Notes: ${esc([j.reason,j.notes].filter(Boolean).join(' · ')||'—')}</p></details>`).join('');}
function render(){
 if(!activeSchool){renderSchools();status();return;}schoolBar();suggestions();renderInventory();
 const allRecords=schoolRecords(),filtered=filteredRecords();$('total').textContent=allRecords.length;$('count').textContent=allRecords.length;$('listCount').textContent=`Showing ${filtered.length} of ${allRecords.length} locations in ${activeSchool.name}`;
 const a=jobTotals(filtered),b=jobTotals(allRecords),metrics=[['Locations','locations'],['TR APs','tr'],['Additional APs','expansion'],['Total APs','totalAPs'],['Relocation cable runs','relocationCables'],['Expansion cable runs','expansionCables'],['Total cable runs','totalCables'],['Cabling not assessed','pendingCabling'],['L-brackets','brackets'],['Scaffolding · AP jobs','scaffoldingJobs'],['Scaffolding · locations','scaffoldingLocations'],['Scissor lift · AP jobs','liftJobs'],['Scissor lift · locations','liftLocations'],['Equipment not assessed','equipmentPending'],['Older expansion not recorded','expansionUnrecorded']];
 $('cablingSummary').innerHTML='<h2 class="section">School survey quantities</h2><table><thead><tr><th>Quantity</th><th>Filtered</th><th>Whole school</th></tr></thead><tbody>'+metrics.map(([label,key])=>`<tr><td>${label}</td><td>${a[key]}</td><td>${b[key]}</td></tr>`).join('')+'</tbody></table><p class="hint">Each cabling Yes = one run. Equipment quantities are affected APs/locations, not bookings. Totals include unsynced locations.</p>';
 $('empty').classList.toggle('hidden',!!filtered.length);$('table').classList.toggle('hidden',!filtered.length);$('empty').querySelector('h2').textContent=allRecords.length?'No matching locations':'No locations yet';
 const names=new Map();for(const r of allRecords)for(const j of r.jobs){const n=j.hostname.trim().toLowerCase();if(n)names.set(n,(names.get(n)||0)+1);}
 $('rows').innerHTML=filtered.map(r=>`<tr>${['building','floor','roomNumber','roomName','lanRoom','network'].map(f=>`<td>${esc(r[f]||'—')}</td>`).join('')}<td class="joblist">${r.jobs.some(j=>names.get(j.hostname.trim().toLowerCase())>1)?'<p class="danger">Duplicate hostname — check</p>':''}${reviewJobs(r)}</td><td>${r.photos.map((p,i)=>`<p><button data-view-photo="${esc(r.id)}" data-index="${i}">View ${i+1}</button> <button data-download-photo="${esc(r.id)}" data-index="${i}">Download</button></p>`).join('')||'—'}</td><td style="white-space:pre-wrap;min-width:150px">${esc(r.remarks||'—')}</td><td>${queue.some(q=>q.id===r.id)?'Saved on device · pending':'Synced ✓'}</td><td><button data-edit="${esc(r.id)}">Edit</button> <button data-delete="${esc(r.id)}" class="danger">Delete</button></td></tr>`).join('');
 const pending=schoolQueue();$('pendingPanel').classList.toggle('hidden',!pending.length);$('pendingRows').innerHTML=pending.map(q=>`<div style="padding:12px 0"><strong>${esc(q.entry?.roomName||q.room||'Deleted location')}</strong><p class="hint">${esc(q.error||q.lastError||'Waiting to sync')}</p><button data-retry="${esc(q.id)}">Retry</button> <button data-discard="${esc(q.id)}">Discard unsynced change</button></div>`).join('');status();
}
async function enqueue(entry) {
  return await mutate(async () => {
    const previous = queue.find(q => q.id === entry.id);
    const task = { id: entry.id, schoolId:entry.schoolId, operation: previous?.operation === 'create' || !editing ? 'create' : 'update', expectedUpdatedAt: previous?.expectedUpdatedAt || editVersion || records.find(r => r.id === entry.id)?.updatedAt, entry, token: crypto.randomUUID() };
    await saveState([...records.filter(r => r.id !== entry.id), entry], [...queue.filter(q => q.id !== entry.id), task]);
    return task;
  });
}
async function fetchEntries(schoolId=activeSchool?.id) {
  let all = [], offset = 0;
  do { const page = await api(`entries?offset=${offset}`,'GET',undefined,schoolId); all.push(...page.entries.map(schoolLocation)); offset = page.nextOffset; } while (offset !== null);
  return all;
}
async function refresh() {
  if(!activeSchool)return;const schoolId=activeSchool.id;
  const startRevision = revision;
  const remote = await fetchEntries(schoolId);
  await mutate(async () => {
    // If a save just finished while this fetch was in flight, get a fresh snapshot next time.
    if (revision !== startRevision) return;
    const pendingIds = new Set(queue.map(q => q.id));
    await saveState([...remote.filter(r => !pendingIds.has(r.id)), ...records.filter(r => r.schoolId!==schoolId||pendingIds.has(r.id))], queue);
  });
  render();
}
async function sync() {
  if (syncing) { syncRequested = true; return; }
  if (!unlocked || !activeSchool || !navigator.onLine) return;
  syncRequested = false; syncing = true; status();
  const syncingSchool=activeSchool.id;
  try {
    for (const initial of queue.filter(q=>schoolReady()&&(q.schoolId||q.entry?.schoolId)===syncingSchool)) {
      const task = queue.find(q => q.id === initial.id); if (!task || task.error) continue;
      try {
        let response;
        if (task.operation === 'delete') response = await api(`entries/${task.id}`, 'DELETE', { expectedUpdatedAt:task.expectedUpdatedAt },task.schoolId);
        else response = await api(task.operation === 'create' ? 'entries' : `entries/${task.id}`, task.operation === 'create' ? 'POST' : 'PUT', { entry:task.entry, expectedUpdatedAt:task.expectedUpdatedAt },task.schoolId);
        await mutate(async () => {
          const current = queue.find(q => q.id === task.id);
          if (current?.token === task.token) {
            const next = records.filter(r => r.id !== task.id);
            if (response.entry) next.push(schoolLocation(response.entry));
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
    if (unlocked&&activeSchool?.id===syncingSchool) await refresh();
  } catch (error) { notify(error.message); }
  finally { syncing = false; render(); if (syncRequested && unlocked && navigator.onLine) { syncRequested = false; void sync(); } }
}
async function loadInventory(){if(!activeSchool)return;const schoolId=activeSchool.id;let items=[],offset=0;do{const page=await api(`inventory?offset=${offset}`,'GET',undefined,schoolId);items.push(...page.items.map(r=>({...r,schoolId})));offset=page.nextOffset;}while(offset!==null);await mutate(async()=>{inventory=[...inventory.filter(r=>r.schoolId!==schoolId),...items];await saveState();});renderInventory();}
function renderInventory(){
 const items=schoolInventory();$('inventoryNames').innerHTML=items.map(r=>`<option value="${esc(r.hostname)}">${esc(r.model||'')}</option>`).join('');
 const q=$('inventorySearch').value.toLowerCase(),subset=items.filter(r=>Object.values(r).join(' ').toLowerCase().includes(q));$('inventoryStatus').textContent=`${items.length} APs in this school's inventory.`;
 $('inventoryTable').innerHTML='<table><thead><tr><th>Hostname</th><th>Model</th><th>Serial</th><th>MAC</th></tr></thead><tbody>'+subset.map(r=>`<tr>${['hostname','model','serial','mac'].map(f=>`<td>${esc(r[f]||'—')}</td>`).join('')}</tr>`).join('')+'</tbody></table>';
}
$('loginForm').onsubmit=async e=>{e.preventDefault();$('unlock').disabled=true;try{await ensureStorage();await api('login','POST',{pin:$('pin').value});$('pin').value='';localStorage.setItem('ap-survey-used','yes');await loadSchools();openWorkspace();}catch(err){$('loginError').textContent=err.message;}finally{$('unlock').disabled=false;}};
$('logout').onclick=async()=>{if(busy()||!leaveForm())return;try{await api('logout','POST',{});localStorage.removeItem('ap-survey-used');formDirty=false;lock();}catch(err){notify(err.message);}};
$('changeSchool').onclick=()=>{if(syncing){notify('Wait for syncing to finish before changing schools.');return;}if(!busy()&&leaveForm()){formDirty=false;showSchools();}};
$('editCurrentSchool').onclick=()=>{if(syncing||busy()||!leaveForm())return;const school=activeSchool;formDirty=false;showSchools();editSchoolForm(school);};
$('view').onclick=()=>{if(!busy()&&leaveForm()){formDirty=false;showList();}};
$('new').onclick=()=>{if(!busy()&&leaveForm()){if(!schoolReady()){notify('Set the school details before adding locations.');return;}resetForm();showForm();}};
$('cancel').onclick=()=>{if(!busy()&&leaveForm()){resetForm();showList();}};
function addJob(type,source){if(busy())return;if(jobs.length>=100){notify('Maximum 100 APs per location.');return;}const job=source?{...duplicateJob(source),equipmentOverride:source.equipmentOverride||'',lanRoomOverride:source.lanRoomOverride||''}:schoolJob(type);jobs.push(job);if(job.type==='Expansion')expansionUnrecorded=false;formDirty=true;renderJobs(source?job.id:undefined);if(job.type==='TR')$(`${job.id}-hostname`).focus();}
$('addTR').onclick=()=>addJob('TR');
function setExpansionQuantity(value){if(busy())return;const amount=Number(value),current=jobs.filter(j=>j.type==='Expansion');if(!Number.isInteger(amount)||amount<0||amount+jobs.filter(j=>j.type==='TR').length>100){notify('Enter a whole number; maximum 100 APs per location.');renderJobs();return;}if(amount<current.length&&current.slice(amount).some(j=>j.hostname||j.bracket||j.cabling==='Yes'||j.notes||j.equipmentOverride||j.lanRoomOverride)&&!confirm('Remove the last additional APs and their requirements?')){renderJobs();return;}jobs=[...jobs.filter(j=>j.type==='TR'),...current.slice(0,amount),...Array.from({length:Math.max(0,amount-current.length)},()=>schoolJob('Expansion'))];expansionUnrecorded=false;formDirty=true;renderJobs();}
$('expansionQuantity').onchange=e=>setExpansionQuantity(e.target.value);$('lessExpansion').onclick=()=>setExpansionQuantity(Math.max(0,jobs.filter(j=>j.type==='Expansion').length-1));$('moreExpansion').onclick=()=>setExpansionQuantity(jobs.filter(j=>j.type==='Expansion').length+1);$('assessExpansion').onclick=()=>setExpansionQuantity(jobs.filter(j=>j.type==='Expansion').length);
function hostnamePasteFeedback(message) {
 $('hostnamePasteStatus').textContent=message;
}
$('addHostnames').onclick=()=>{
 if(busy())return;
 // Accept real line breaks and separators copied from messages or spreadsheets.
 const names=$('hostnamePaste').value.replace(/\\r\\n|\\[rn]/g,'\n').split(/[\r\n,\t\\]+/).map(v=>v.trim()).filter(Boolean);
 if(!names.length){hostnamePasteFeedback('Paste at least one hostname.');return;}
 if(names.some(n=>n.length>150)){hostnamePasteFeedback('Each hostname must be 150 characters or fewer. Nothing was added.');return;}
 const seen=new Set(jobs.map(j=>j.hostname.trim().toLowerCase()).filter(Boolean));
 let skipped=0;
 const additions=names.filter(name=>{const key=name.toLowerCase();if(seen.has(key)){skipped++;return false;}seen.add(key);return true;});
 if(!additions.length){hostnamePasteFeedback(`No APs added. ${skipped} duplicate hostname${skipped===1?'':'s'} skipped; already in this location.`);return;}
 const untouched=job=>job.type==='TR'&&!job.hostname&&!job.model&&!job.serial&&!job.mac&&!job.notes&&!job.reason&&!job.bracket&&job.relocation==='No'&&job.cabling==='No'&&!job.equipmentOverride&&!job.lanRoomOverride;
 const remaining=jobs.filter(j=>!untouched(j));
 if(remaining.length+additions.length>100){hostnamePasteFeedback('Maximum 100 APs per location. Nothing was added; shorten the list.');return;}
 const inventoryItems=schoolInventory();
 const newJobs=additions.map(hostname=>{
  const item=inventoryItems.find(r=>r.hostname.toLowerCase()===hostname.toLowerCase());
  return {...schoolJob('TR'),hostname,...(item?{hostname:item.hostname,model:item.model,serial:item.serial,mac:item.mac}:{})};
 });
 jobs=[...remaining,...newJobs];formDirty=true;renderJobs();
 $('hostnamePaste').value='';
 hostnamePasteFeedback(`Added ${newJobs.length} AP${newJobs.length===1?'':'s'}.${skipped?` ${skipped} duplicate hostname${skipped===1?'':'s'} skipped.`:''}`);
 const first=$(`${newJobs[0].id}-hostname`);first.scrollIntoView({behavior:'smooth',block:'center'});first.focus({preventScroll:true});
};
function jobEvent(e){const row=e.target.closest('[data-job]'),field=e.target.dataset.field;if(!row||!field)return;const job=jobs.find(j=>j.id===row.dataset.job);if(!job||!['hostname','model','serial','mac','reason','notes','equipmentOverride','lanRoomOverride'].includes(field))return;job[field]=e.target.value;formDirty=true;if(e.type==='change'&&field==='hostname'&&job.type==='TR'){const item=schoolInventory().find(r=>r.hostname.toLowerCase()===job.hostname.trim().toLowerCase());if(item){Object.assign(job,{hostname:item.hostname,model:item.model,serial:item.serial,mac:item.mac});renderJobs();}}}
for(const id of ['jobsTR','jobsExpansion']){$(id).oninput=jobEvent;$(id).onchange=jobEvent;$(id).onclick=e=>{if(busy())return;const row=e.target.closest('[data-job]'),job=jobs.find(j=>j.id===row?.dataset.job);if(!job)return;const {toggle:field,similar,removeJob}=e.target.dataset;if(field){if(field==='bracket')job.bracket=!job.bracket;else if(['relocation','cabling'].includes(field))job[field]=job[field]==='Yes'?'No':'Yes';if(field==='relocation'){job.cabling='No';if(job.relocation==='No')job.reason='';}formDirty=true;renderJobs(row.querySelector('details')?.open?job.id:undefined);}if(similar)addJob(job.type,job);if(removeJob&&confirm('Remove this AP from the location?')){jobs=jobs.filter(j=>j.id!==removeJob);if(job.type==='Expansion')expansionUnrecorded=false;formDirty=true;renderJobs();}};}
$('form').addEventListener('input',()=>formDirty=true);$('form').addEventListener('change',()=>formDirty=true);
$('locationEquipment').onchange=()=>{formDirty=true;};
$('photoList').onclick=e=>{if(e.target.id==='removePhoto'&&!busy()&&confirm('Remove attached location photo(s)?')){draftPhotos=[];formDirty=true;renderPhotos();}};
$('photo').onchange=async()=>{if(busy())return;const file=$('photo').files?.[0];if(!file)return;readingPhoto=true;$('save').disabled=true;$('saveBlank').disabled=true;try{if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPG, PNG or WebP image.');const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas'),scale=Math.min(1,2200/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const data=canvas.toDataURL('image/jpeg',0.85);if(data.length>7*1024*1024)throw new Error('Photo exceeds 5 MB. Choose a smaller image.');draftPhotos=[{data},...draftPhotos.slice(1)];formDirty=true;renderPhotos();}catch(err){notify(err.message);}finally{readingPhoto=false;$('save').disabled=false;$('saveBlank').disabled=false;$('photo').value='';}};
async function submitLocation(retain){
 if(busy())return;if(!schoolReady()){notify('Complete the school details before saving.');return;}
 const raw={...Object.fromEntries(surveyFields.map(f=>[f,$(f).value.trim()])),schoolId:activeSchool.id,id:editing||crypto.randomUUID(),jobs:structuredClone(jobs),photos:structuredClone(draftPhotos),expansionUnrecorded,updatedAt:editVersion,createdAt:records.find(r=>r.id===editing)?.createdAt||new Date().toISOString()};
 const problem=surveyProblem(raw);if(problem){showProblem(problem);return;}const entry=prepareSurvey(raw),names=new Set(entry.jobs.map(j=>j.hostname.trim().toLowerCase()).filter(Boolean));
 if(schoolRecords().some(r=>r.id!==entry.id&&r.jobs.some(j=>names.has(j.hostname.trim().toLowerCase())))&&!confirm('A hostname is assigned to another location in this school. Save anyway?'))return;
 saving=true;$('save').disabled=true;$('saveBlank').disabled=true;
 try{const wasEdit=!!editing;await enqueue(entry);lastSave={id:entry.id,room:entry.roomName,schoolId:entry.schoolId};resetForm(retain&&!wasEdit);render();$('notice').classList.add('hidden');if(wasEdit)showList();else{$('roomName').focus();window.scrollTo(0,0);}void sync();}catch(err){notify(err.message);}finally{saving=false;$('save').disabled=false;$('saveBlank').disabled=false;}
}
$('form').onsubmit=e=>{e.preventDefault();void submitLocation(true);};$('saveBlank').onclick=()=>void submitLocation(false);
function photoEndpoint(id,index,schoolId){return `${API}/photos/${encodeURIComponent(id)}?photo=${Number(index)||0}&schoolId=${encodeURIComponent(schoolId)}`;}
for(const id of ['search','buildingFilter','lanFilter','expansionFilter'])$(id)[id==='search'?'oninput':'onchange']=render;
$('clearFilters').onclick=()=>{$('search').value='';for(const id of ['buildingFilter','lanFilter','expansionFilter'])$(id).value='all';render();};$('refresh').onclick=()=>void sync();
async function loadPhoto(record,photo){if(photo.data)return await(await fetch(photo.data)).blob();const response=await fetch(photoEndpoint(record.id,photo.remoteIndex,record.schoolId),{credentials:'same-origin',cache:'no-store'});if(!response.ok){if(response.status===401)lock('Enter your PIN to access photos.');throw new Error('Could not load photo. Check connection and login.');}return response.blob();}
function saveDownload(name,blob){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
$('rows').onclick=async e=>{
 const {edit,delete:remove,viewPhoto,downloadPhoto,index}=e.target.dataset;
 try{
  if(edit){if(busy())return;const r=schoolRecords().find(r=>r.id===edit);resetForm();editing=r.id;editVersion=r.updatedAt||null;for(const f of surveyFields)$(f).value=r[f]||'';jobs=structuredClone(r.jobs);draftPhotos=structuredClone(r.photos||[]);expansionUnrecorded=!!r.expansionUnrecorded;$('formTitle').textContent='Edit location survey';$('save').textContent='Save changes';$('saveBlank').classList.add('hidden');$('cancel').classList.remove('hidden');renderJobs();renderPhotos();showForm();formDirty=false;}
  if(viewPhoto||downloadPhoto){const r=schoolRecords().find(r=>r.id===(viewPhoto||downloadPhoto)),i=Number(index),blob=await loadPhoto(r,r.photos[i]);if(downloadPhoto){const name=[r.building,r.floor,r.roomName,'survey',i+1].join('-').replace(/[^a-z0-9_-]/gi,'-').slice(0,120);saveDownload(name+'.'+(blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg'),blob);}else{if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=URL.createObjectURL(blob);$('photoDialogImage').src=photoUrl;$('photoDialog').showModal();}}
  if(remove){if(syncing){notify('Wait for syncing to finish before deleting.');return;}if(!confirm('Delete this location and all its AP jobs from the shared register?'))return;
   await mutate(async()=>{const r=schoolRecords().find(r=>r.id===remove),previous=queue.find(q=>q.id===remove),next=queue.filter(q=>q.id!==remove);if(previous?.operation!=='create')next.push({id:remove,schoolId:activeSchool.id,room:r.roomName,operation:'delete',expectedUpdatedAt:previous?.expectedUpdatedAt||r.updatedAt,token:crypto.randomUUID()});if(lastSave?.id===remove)lastSave=null;await saveState(records.filter(r=>r.id!==remove),next);});render();void sync();}
 }catch(err){notify(err.message);}
};
$('pendingRows').onclick=async e=>{
 const {retry,discard}=e.target.dataset;try{
  if(retry&&schoolQueue().some(q=>q.id===retry)){await mutate(()=>saveState(records,queue.map(q=>q.id===retry?{...q,error:undefined,lastError:undefined}:q)));render();void sync();}
  if(discard){if(syncing||!navigator.onLine){notify('Wait for sync to finish and reconnect before discarding.');return;}if(!confirm('Discard this unsynced change? Download a backup first if needed.'))return;const schoolId=activeSchool.id,remote=await fetchEntries(schoolId);await mutate(async()=>{if(lastSave?.id===discard)lastSave=null;const next=queue.filter(q=>q.id!==discard),ids=new Set(next.map(q=>q.id));await saveState([...remote.filter(r=>!ids.has(r.id)),...records.filter(r=>r.schoolId!==schoolId||ids.has(r.id))],next);});render();}
 }catch(err){notify(err.message);}
};
const csvCell=value=>'"'+String(value??'').replace(/^(\s*)([=+@-])/,'$1\'$2').replace(/"/g,'""')+'"';
$('csv').onclick=()=>{
 const headers=['School','School Type','AP Vendor','Building','Floor','Room Number','Room Name','Network','LAN / Server Room','Job','Type','Hostname','Model','Serial','MAC','Relocation','Reason','Cabling','Equipment','L-bracket','AP Notes','Location Remarks','Sync'];
 const rows=[];for(const r of schoolRecords()){const counters={TR:0,Expansion:0};for(const j of r.jobs){rows.push([activeSchool.name,activeSchool.type,vendorForSchool(activeSchool.type),r.building,r.floor,r.roomNumber,r.roomName,r.network,j.lanRoomOverride||r.lanRoom,`${j.type==='TR'?'TR':'EXP'}-${++counters[j.type]}`,j.type,j.hostname,j.model,j.serial,j.mac,j.type==='TR'?j.relocation:'N/A',j.reason,j.type==='TR'&&j.relocation!=='Yes'?'No':j.cabling,j.equipment,j.bracket?'Yes':'No',j.notes,r.remarks,queue.some(q=>q.id===r.id)?'Pending':'Synced']);}}
 saveDownload('ap-survey-jobs.csv',new Blob(['\ufeff'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
};
$('backup').onclick=async()=>{
 $('backup').disabled=true;notify('Preparing full backup including photos…');try{
  const school=structuredClone(activeSchool),savedInventory=structuredClone(schoolInventory()),pendingChanges=structuredClone(schoolQueue()),copy=structuredClone(schoolRecords());for(const r of copy){const photos=[];for(const p of r.photos||[]){if(p.data)photos.push(p);else{const blob=await loadPhoto(r,p);const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});photos.push({data});}}r.photos=photos;delete r.photo;}
  saveDownload('ap-survey-backup.json',new Blob([JSON.stringify({version:3,school,records:copy,inventory:savedInventory,pendingChanges},null,2)],{type:'application/json'}));notify('Backup downloaded with AP jobs, photos and an inventory copy. Inventory can be restored separately from the inventory page.');
 }catch(err){notify('Backup failed: '+err.message);}finally{$('backup').disabled=false;}
};
$('restore').onclick=()=>{$('file').value='';$('file').click();};$('file').onchange=async()=>{
 try{if(!schoolReady())throw new Error('Complete school details first.');const targetSchool=activeSchool.id;const file=$('file').files[0];if(!file)return;if(file.size>100*1024*1024)throw new Error('Backup limit: 100 MB.');const data=JSON.parse(await file.text());if(activeSchool?.id!==targetSchool)throw new Error('School changed. Start the import again.');if(![1,2,3].includes(data.version)||!Array.isArray(data.records)||data.records.length>5000)throw new Error('Choose an AP Survey backup.');
 if(data.version===3&&data.school?.id!==activeSchool.id)throw new Error('This backup belongs to a different school. Open that school before importing.');
 if(data.version<3&&!confirm(`Assign this older backup to ${activeSchool.name}? Import only records belonging to this school.`))return;
 const additions=[];let skipped=0;
 for(const raw of data.records){if(records.some(r=>r.id===raw.id)){skipped++;continue;}const r=prepareSurvey(schoolLocation({...raw,schoolId:activeSchool.id}));const problem=surveyProblem(r);if(problem)throw new Error(`${r.roomName}: ${problem.message}`);if(r.photos.length>1)throw new Error(`${r.roomName}: this older location has multiple photos; keep its backup and import manually.`);if(r.photos.some(p=>!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p.data||'')||p.data.length>7*1024*1024))throw new Error('Backup photos must be embedded images under 5 MB.');additions.push(r);}
 if(new Set(additions.map(r=>r.id)).size!==additions.length)throw new Error('Duplicate location IDs in backup.');if(!additions.length){notify('No new locations to import. Existing IDs are skipped.');return;}if(!confirm(`Add ${additions.length} locations to ${activeSchool.name}? ${skipped} existing locations skipped.`))return;
 await mutate(()=>saveState([...records,...additions],[...queue,...additions.map(entry=>({id:entry.id,schoolId:entry.schoolId,entry,operation:'create',token:crypto.randomUUID()}))]));render();notify('Locations imported on this device. Syncing…');void sync();
 }catch(err){notify('Import failed: '+err.message);}
};
$('manageInventory').onclick=async()=>{if(busy()||!leaveForm())return;formDirty=false;$('entry').classList.add('hidden');$('list').classList.add('hidden');$('inventory').classList.remove('hidden');renderInventory();try{await loadInventory();}catch(err){notify(err.message);}};
$('inventoryBack').onclick=showList;$('inventorySearch').oninput=renderInventory;
$('importInventory').onclick=()=>{$('inventoryFile').value='';$('inventoryFile').click();};
$('inventoryTemplate').onclick=()=>saveDownload('ap-inventory-template.csv',new Blob(['Hostname,Model,Serial,MAC\r\nL1AP01,AIR-AP3802I-S-K9,,\r\n'],{type:'text/csv'}));
$('inventoryFile').onchange=async()=>{try{const targetSchool=activeSchool.id,f=$('inventoryFile').files[0];if(!f)return;if(f.size>2*1024*1024)throw new Error('CSV maximum 2 MB.');const items=parseInventory(await f.text());if(activeSchool?.id!==targetSchool)throw new Error('School changed. Start the import again.');if(!confirm(`Import ${items.length} inventory APs? Matching hostnames will be updated. Saved surveys are not changed.`))return;await api('inventory','POST',{items});await loadInventory();notify(`Imported ${items.length} APs. Choose their hostnames in a TR job.`);}catch(err){notify('Inventory import failed: '+err.message);}};
$('print').onclick=()=>{document.querySelectorAll('#rows details').forEach(d=>d.open=true);window.print();};
window.addEventListener('online',()=>{if(unlocked)void sync();});window.addEventListener('offline',status);
window.addEventListener('beforeunload',e=>{if(saving||readingPhoto||formDirty){e.preventDefault();e.returnValue='';}});
setInterval(()=>{if(unlocked&&navigator.onLine&&!syncing&&!saving)void sync();},30000);
async function start(){try{await ensureStorage();$('unlock').disabled=false;resetForm();await api('session');await loadSchools();openWorkspace();}catch(err){if(err.status===0&&localStorage.getItem('ap-survey-used')==='yes'){openWorkspace();notify('Offline: select a cached school. Saved drafts sync when you reconnect and open that school.');}else lock(err.status===401?'':err.message);}}
void start();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/ap-survey/sw.js',{scope:'/ap-survey/'}).catch(()=>notify('Offline page caching unavailable. Keep this tab open without reception.'));

$('restoreInventoryBackup').onclick=()=>{$('inventoryBackupFile').value='';$('inventoryBackupFile').click();};
$('inventoryBackupFile').onchange=async()=>{try{
 const targetSchool=activeSchool.id,file=$('inventoryBackupFile').files[0];if(!file)return;if(file.size>100*1024*1024)throw new Error('Backup maximum 100 MB.');
 const data=JSON.parse(await file.text());if(activeSchool?.id!==targetSchool)throw new Error('School changed. Start the import again.');if(data.school?.id&&data.school.id!==activeSchool.id)throw new Error('This inventory backup belongs to a different school.');if(!Array.isArray(data.inventory)||!data.inventory.length||data.inventory.length>2000)throw new Error('No valid inventory in this backup.');
 const items=data.inventory.map(r=>({hostname:r.hostname,model:r.model,serial:r.serial,mac:r.mac}));
 if(!confirm(`Restore ${items.length} inventory APs? Matching hostnames will be overwritten, saved surveys remain unchanged.`))return;
 await api('inventory','POST',{items});await loadInventory();notify('Inventory restored.');
}catch(err){notify('Inventory restore failed: '+err.message);}};
