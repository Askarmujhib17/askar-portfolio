import { categories, lanRooms, fields, validateEntry } from './schema.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const API = '/api/ap-survey';
let records = [], queue = [], db, editing = null, editVersion = null, currentPhoto = '', existingPhoto = false;
let unlocked = false, syncing = false, readingPhoto = false, saving = false, revision = 0;
let photoUrl = '';
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
  records = (saved?.records || []).map(r => ({...r,newCabling:r.newCabling ?? (r.relocation==='Yes'?'Not assessed':'')})); queue = (saved?.queue || []).map(q => q.entry ? {...q,entry:{...q.entry,newCabling:q.entry.newCabling ?? (q.entry.relocation==='Yes'?'Not assessed':'')}} : q); render();
}
function saveState(nextRecords = records, nextQueue = queue) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace','readwrite');
    transaction.objectStore('workspace').put({ records: nextRecords, queue: nextQueue }, 'state');
    transaction.oncomplete = () => { records = nextRecords; queue = nextQueue; revision++; resolve(); };
    transaction.onerror = transaction.onabort = () => reject(new Error('Could not save on this device. Your form is still here. Check browser/device storage.'));
  });
}
// Serialize cache changes so sync responses cannot overwrite a newly captured draft.
let changes = Promise.resolve();
function mutate(callback) {
  const task = changes.then(callback); changes = task.catch(() => {}); return task;
}
function relocationUI() {
  const yes = $('relocation').value === 'Yes'; $('relocationDetails').classList.toggle('hidden', !yes);
  $('reason').required = yes; $('newCabling').required = yes; $('photo').required = yes && !currentPhoto && !existingPhoto;
}
function previewPhoto() {
  if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = ''; }
  $('photoPreview').src = currentPhoto || (existingPhoto && editing ? `${API}/photos/${editing}` : '');
  $('photoPreview').classList.toggle('hidden', !currentPhoto && !existingPhoto);
  $('photoStatus').textContent = currentPhoto || existingPhoto ? 'Photo attached. Upload another image to replace it.' : '';
  relocationUI();
}
function resetForm() {
  editing = null; editVersion = null; currentPhoto = ''; existingPhoto = false; $('form').reset(); previewPhoto();
  $('formTitle').textContent = 'New survey entry'; $('save').textContent = 'Save & next location →'; $('cancel').classList.add('hidden');
}
function showList() { $('entry').classList.add('hidden'); $('list').classList.remove('hidden'); render(); window.scrollTo(0,0); }
function showForm() { $('entry').classList.remove('hidden'); $('list').classList.add('hidden'); window.scrollTo(0,0); }
function filteredRecords() {
  const search = $('search').value.toLowerCase();
  return records.filter(r => fields.some(f => String(r[f] || '').toLowerCase().includes(search)) && ($('categoryFilter').value === 'all' || r.category === $('categoryFilter').value) && ($('lanFilter').value === 'all' || (r.lanRoom || '') === $('lanFilter').value));
}
function render() {
  $('total').textContent = records.length; $('count').textContent = records.length;
  const filtered = filteredRecords(); $('listCount').textContent = `Showing ${filtered.length} of ${records.length} total entries`;
  $('empty').classList.toggle('hidden', !!filtered.length); $('table').classList.toggle('hidden', !filtered.length);
  $('empty').querySelector('h2').textContent = records.length ? 'No matching entries' : 'No entries yet';
  $('rows').innerHTML = filtered.map(r => `<tr>${fields.slice(0,10).map(f => `<td>${esc(r[f] || '—')}</td>`).join('')}<td>${esc(r.relocation || 'Not recorded')}</td><td style="white-space:normal;min-width:160px">${esc(r.reason || '—')}</td><td>${esc(r.relocation === 'Yes' ? (r.newCabling || 'Not assessed') : '—')}</td><td>${r.photo || r.hasPhoto ? `<button data-photo="${esc(r.id)}">View photo</button> <button data-download="${esc(r.id)}">Download photo</button>` : '—'}</td><td><span class="draft ${r.model && r.hostname && r.serial && r.mac ? 'complete' : ''}">${r.model && r.hostname && r.serial && r.mac ? 'Complete' : 'Add later'}</span><div class="sub">${queue.some(q => q.id === r.id) ? 'Saved on device · not yet synced' : 'Synced ✓'}</div></td><td><button data-edit="${esc(r.id)}">Edit</button> <button class="danger" data-delete="${esc(r.id)}">Delete</button></td></tr>`).join('');
  $('pendingPanel').classList.toggle('hidden', !queue.length);
  $('pendingRows').innerHTML = queue.map(q => `<div style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e9e4"><strong>${esc(q.entry?.room || q.room || 'Deleted entry')}</strong> · ${q.operation === 'delete' ? 'Delete' : 'Save'}<p class="hint">${esc(q.error || 'Waiting to sync')}</p><button data-retry="${esc(q.id)}">Retry</button> <button data-discard="${esc(q.id)}">Discard unsynced change</button></div>`).join('');
  status();
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
  do { const page = await api(`entries?offset=${offset}`); all.push(...page.entries); offset = page.nextOffset; } while (offset !== null);
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
            if (response.entry) next.push(response.entry);
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
$('loginForm').onsubmit = async event => {
  event.preventDefault(); $('unlock').disabled = true; $('loginError').textContent = '';
  try { await api('login','POST',{ pin:$('pin').value }); $('pin').value = ''; localStorage.setItem('ap-survey-used','yes'); openWorkspace(); await sync(); }
  catch (error) { $('loginError').textContent = error.message; }
  finally { $('unlock').disabled = false; }
};
$('logout').onclick = async () => {
  if (queue.length && !confirm('There are unsynced changes. They will remain on this device. Lock the app?')) return;
  try { await api('logout','POST',{}); localStorage.removeItem('ap-survey-used'); lock(); }
  catch (error) { notify(error.message); }
};
$('relocation').onchange = relocationUI;
$('photo').onchange = async () => {
  const file = $('photo').files[0]; if (!file) return;
  readingPhoto = true; $('save').disabled = true; $('photoStatus').textContent = 'Preparing photo…';
  try {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP photo.');
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas'); const scale = Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
    canvas.width = Math.round(bitmap.width*scale); canvas.height = Math.round(bitmap.height*scale);
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
    const prepared = canvas.toDataURL('image/jpeg',0.9);
    if (prepared.length > 7*1024*1024) throw new Error('Photo is too large. Choose a smaller image.');
    currentPhoto = prepared; previewPhoto();
  } catch (error) { $('photo').value = ''; $('photoStatus').textContent = error.message || 'Could not read this image.'; relocationUI(); }
  finally { readingPhoto = false; $('save').disabled = saving; }
};
$('form').onsubmit = async event => {
  event.preventDefault(); if (readingPhoto || saving || !$('form').reportValidity()) return;
  const old = records.find(r => r.id === editing);
  const entry = { ...Object.fromEntries(fields.map(f => [f,$(f).value.trim()])), id:editing || crypto.randomUUID(), updatedAt:editVersion, createdAt:old?.createdAt || new Date().toISOString(), hasPhoto:existingPhoto };
  if (entry.relocation === 'Yes') { if (currentPhoto) entry.photo = currentPhoto; }
  else { entry.reason = ''; entry.newCabling = ''; entry.hasPhoto = false; }
  const invalid = validateEntry(entry);
  if (invalid || (entry.relocation === 'Yes' && !currentPhoto && !existingPhoto)) { notify(invalid || 'Attach a wide-angle relocation photo.'); return; }
  saving = true; $('save').disabled = true;
  try { const wasEdit = !!editing; await enqueue(entry); lastSave = { id:entry.id, room:entry.room }; resetForm(); render(); $('notice').classList.add('hidden'); if (wasEdit) showList(); else $('building').focus(); void sync(); }
  catch (error) { notify(error.message); }
  finally { saving = false; $('save').disabled = readingPhoto; }
};
const captureBusy=()=>{if(readingPhoto||saving){notify('Wait for the photo or save to finish before changing pages.');return true;}return false;};
$('view').onclick = () => {if(!captureBusy())showList();}; $('new').onclick = () => { if(captureBusy())return;resetForm(); showForm(); };
$('cancel').onclick = () => { if(captureBusy())return;resetForm(); showList(); }; $('search').oninput = render;
$('categoryFilter').onchange = render; $('lanFilter').onchange = render;
$('clearFilters').onclick = () => { $('search').value=''; $('categoryFilter').value='all'; $('lanFilter').value='all'; render(); };
$('refresh').onclick = () => { void sync(); };
async function loadPhoto(record) {
  if (record.photo) return await (await fetch(record.photo)).blob();
  const response = await fetch(`${API}/photos/${record.id}`, { credentials:'same-origin', cache:'no-store' });
  if (!response.ok) { if (response.status === 401) lock('Enter your PIN to access photos.'); throw new Error('Could not fetch this photo. Check your connection and login.'); }
  return await response.blob();
}
function saveDownload(name, blob) {
  const anchor = document.createElement('a'); const url=URL.createObjectURL(blob); anchor.href=url; anchor.download=name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url),10000);
}
function photoName(record,type) { return `${record.building}-${record.floor}-${record.room}-relocation`.replace(/[^a-z0-9_-]/gi,'-').slice(0,120)+'.'+(type==='image/png'?'png':type==='image/webp'?'webp':'jpg'); }
$('rows').onclick = async event => {
  const { edit, delete:remove, photo, download } = event.target.dataset;
  try {
    if (edit) {
      if (readingPhoto || saving) return;
      const record=records.find(r=>r.id===edit); resetForm(); editing=edit; editVersion=record.updatedAt||null;
      fields.forEach(f=>$(f).value=record[f]||(f==='newCabling'?'Not assessed':'')); currentPhoto=record.photo||''; existingPhoto=!!record.hasPhoto; previewPhoto();
      $('formTitle').textContent='Edit survey entry'; $('save').textContent='Save changes'; $('cancel').classList.remove('hidden'); showForm();
    }
    if (photo || download) {
      const record=records.find(r=>r.id===(photo||download)); const blob=await loadPhoto(record);
      if(download) saveDownload(photoName(record,blob.type),blob);
      else { if(photoUrl)URL.revokeObjectURL(photoUrl); photoUrl=URL.createObjectURL(blob); $('photoDialogImage').src=photoUrl; $('photoDialog').showModal(); }
    }
    if(remove && syncing){notify('Wait for the current sync to finish before deleting an entry.');return;}
    if(remove && confirm('Delete this entry from your shared register?')) {
      await mutate(async()=>{
        const record=records.find(r=>r.id===remove),previous=queue.find(q=>q.id===remove);
        const nextQueue=queue.filter(q=>q.id!==remove);if(lastSave?.id===remove)lastSave=null;
        if(previous?.operation!=='create') nextQueue.push({id:remove,room:record.room,operation:'delete',expectedUpdatedAt:previous?.expectedUpdatedAt||record.updatedAt,token:crypto.randomUUID()});
        await saveState(records.filter(r=>r.id!==remove),nextQueue);
      });render();void sync();
    }
  }catch(error){notify(error.message);}
};
$('pendingRows').onclick=async event=>{
  const {retry,discard}=event.target.dataset;
  try {
    if(retry){await mutate(()=>saveState(records,queue.map(q=>q.id===retry?{...q,error:undefined,lastError:undefined}:q)));render();void sync();}
    if(discard&&confirm('Discard this unsynced change and reload the server version? Download a backup first if you need to keep it.')){
      if(syncing){notify('Wait for the current sync to finish before discarding a change.');return;}
      if(!navigator.onLine){notify('Reconnect before discarding a change so the server version can be restored.');return;}
      const remote=await fetchEntries();
      await mutate(async()=>{if(lastSave?.id===discard)lastSave=null;const nextQueue=queue.filter(q=>q.id!==discard),ids=new Set(nextQueue.map(q=>q.id));await saveState([...remote.filter(r=>!ids.has(r.id)),...records.filter(r=>ids.has(r.id))],nextQueue);});render();
    }
  }catch(error){notify(error.message);}
};
$('csv').onclick=()=>{
  const headers=['Site/Building','Floor','Room / Location','Category','Network Type','Old AP Model','Old AP Hostname','Old AP Serial','Old AP MAC Address','LAN / Server Room','AP Relocation Required','Relocation Reason','New Cabling Required','Photo Attached','Sync Status'];
  const cell=value=>'"'+String(value??'').replace(/^(\s*)([=+@-])/,'$1\'$2').replace(/"/g,'""')+'"';
  const text='\ufeff'+[headers,...records.map(r=>[...fields.map(f=>r[f]),r.photo||r.hasPhoto?'Yes':'No',queue.some(q=>q.id===r.id)?'Pending':'Synced'])].map(row=>row.map(cell).join(',')).join('\r\n');saveDownload('ap-survey.csv',new Blob([text],{type:'text/csv;charset=utf-8'}));
};
const toDataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
$('backup').onclick=async()=>{
  $('backup').disabled=true;notify('Preparing backup, including photos…');
  try{
    const copy=structuredClone(records),tasks=structuredClone(queue);
    for(const r of copy)if(r.hasPhoto&&!r.photo)r.photo=await toDataUrl(await loadPhoto(r));
    saveDownload('ap-survey-backup.json',new Blob([JSON.stringify({version:1,records:copy,pendingChanges:tasks},null,2)],{type:'application/json'}));notify('Backup downloaded, including available photos and unsynced changes.');
  }catch(error){notify('Backup not created: '+error.message);}finally{$('backup').disabled=false;}
};
$('restore').onclick=()=>{$('file').value='';$('file').click();};
$('file').onchange=async()=>{
  try{
    const file=$('file').files[0];if(!file)return; if(file.size>100*1024*1024)throw new Error('Backup is too large (maximum 100 MB).');
    const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.records)||data.records.length>5000)throw new Error('Choose an AP Survey backup.');
    const prepared=[];let skipped=0;
    for(const record of data.records){
      if(records.some(r=>r.id===record.id)){skipped++;continue;}
      const entry={...Object.fromEntries(fields.map(f=>[f,record[f]||(f==='newCabling'&&record.relocation==='Yes'?'Not assessed':'')])),id:record.id,photo:record.photo||'',hasPhoto:false};
      const invalid=validateEntry(entry);if(invalid)throw new Error(`${record.room||'Entry'}: ${invalid} Complete missing fields in the original prototype before exporting.`);
      if(entry.relocation==='Yes'&&!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(entry.photo))throw new Error(`${entry.room}: relocation photo is missing or invalid.`);
      if(entry.photo.length>7*1024*1024)throw new Error(`${entry.room}: photo is too large.`);
      prepared.push(entry);
    }
    if(new Set(prepared.map(r=>r.id)).size!==prepared.length)throw new Error('Backup contains duplicate entry IDs.');
    if(!prepared.length){notify('No new entries to import. Existing IDs were skipped.');return;}
    if(!confirm(`Add ${prepared.length} entries? ${skipped} existing entries will be skipped. Your current register will not be replaced.`))return;
    await mutate(async()=>{await saveState([...records,...prepared], [...queue,...prepared.map(entry=>({id:entry.id,operation:'create',entry,token:crypto.randomUUID()}))]);});render();notify('Backup imported on this device. Syncing…');void sync();
  }catch(error){notify('Import failed: '+error.message);}
};
$('print').onclick=()=>window.print();
window.addEventListener('online',()=>{if(unlocked)void sync();});window.addEventListener('offline',status);
window.addEventListener('beforeunload',event=>{if(saving||readingPhoto){event.preventDefault();event.returnValue='';}});
setInterval(()=>{if(unlocked&&navigator.onLine&&!syncing&&!saving)void sync();},30000);
async function start(){
  try{await openDb();await api('session');openWorkspace();await sync();}
  catch(error){
    if(error.status===0&&localStorage.getItem('ap-survey-used')==='yes'){openWorkspace();notify('Offline: showing cached entries. New drafts will sync when you reconnect.');}
    else lock(error.status===401?'':error.message);
  }
}
void start();
if('serviceWorker' in navigator) navigator.serviceWorker.register('/ap-survey/sw.js',{scope:'/ap-survey/'}).catch(()=>notify('Offline page caching is unavailable. Keep this tab open while surveying without reception.'));
