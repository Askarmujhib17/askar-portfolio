export const categories = ['', 'art and craft room', 'basketball court', 'canteen', 'CCA Room', 'Circulation Space', 'Classrooms', 'Computer Room', 'Cookery Room', 'Councelling Room', 'Dance Studio', 'D&T workshop', 'E-Exam Venue', 'General Office', 'Gym', 'HOD office', 'ICT Support Rm', 'ISH', 'LEARNING AND BEHAVIOR SUPPORT RM', 'MEDIA RESOURCE LIB', 'Mother tongue language room', 'multi-purpose hall', 'nursing room', 'outdoor learning area', 'parade square', 'staff lounge', 'staff meeting room', 'staff room', 'study area', 'subject based banding room'];
export const lanRooms = Array.from({ length: 8 }, (_, i) => `Lan Room ${i + 1}`).concat('Server Room');
export const networkTypes = ['MOE-Owned', 'School-Owned', 'Unknown'];
export const cablingOptions = ['Yes', 'No', 'Not assessed'];
export const fields = ['building', 'floor', 'room', 'category', 'network', 'model', 'hostname', 'serial', 'mac', 'lanRoom', 'relocation', 'reason', 'newCabling', 'additionalAP', 'expansionCabling', 'remarks'];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateEntry(entry) {
  if (!entry || !UUID.test(entry.id || '')) return 'Invalid entry ID.';
  const limits = { building: 150, floor: 30, room: 200, category: 100, network: 30, model: 150, hostname: 150, serial: 100, mac: 30, lanRoom: 30, relocation: 3, reason: 1000 };
  for (const [field, max] of Object.entries(limits)) {
    if (typeof entry[field] !== 'string' || entry[field].length > max) return `Invalid ${field}.`;
  }
  if (![entry.building, entry.floor, entry.room].every(value => value.trim())) return 'Building, floor and room are required.';
  if (!categories.includes(entry.category)) return 'Choose a category from the list.';
  if (!lanRooms.includes(entry.lanRoom)) return 'Choose a LAN / Server Room.';
  if (!networkTypes.includes(entry.network)) return 'Invalid network type.';
  if (!['Yes', 'No'].includes(entry.relocation)) return 'Choose whether relocation is required.';
  if (entry.mac && !/^[a-f\d]{12}$/i.test(entry.mac.replace(/[:.\-]/g, ''))) return 'Enter a valid MAC address or leave it blank.';
  if (entry.relocation === 'Yes' && !entry.reason.trim()) return 'Enter a relocation reason.';
  if (entry.newCabling !== undefined && typeof entry.newCabling !== 'string') return 'Invalid cabling choice.';
  if (entry.relocation === 'Yes' && entry.newCabling !== undefined && !cablingOptions.includes(entry.newCabling)) return 'Choose whether new cabling is required.';
  if (entry.additionalAP !== undefined && !['Yes','No',''].includes(entry.additionalAP)) return 'Invalid expansion choice.';
  if (entry.additionalAP === 'Yes' && !cablingOptions.includes(entry.expansionCabling)) return 'Choose cabling for the additional AP.';
  if (entry.remarks !== undefined && (typeof entry.remarks !== 'string' || entry.remarks.length > 3000)) return 'Remarks must be at most 3000 characters.';
  return '';
}

export function normalizeExpansion(r) {
  return {...r,additionalAP:r.additionalAP ?? '',expansionCabling:r.additionalAP==='Yes'?(r.expansionCabling||'Not assessed'):'',remarks:r.remarks ?? ''};
}
export function surveyTotals(records) {
  const t={rooms:records.length,additionalAPs:0,relocationCables:0,expansionCables:0,pendingCabling:0,expansionUnrecorded:0};
  for(const r of records){
    if(r.relocation==='Yes'){if(r.newCabling==='Yes')t.relocationCables++;else if(!r.newCabling||r.newCabling==='Not assessed')t.pendingCabling++;}
    if(r.additionalAP==='Yes'){t.additionalAPs++;if(r.expansionCabling==='Yes')t.expansionCables++;else if(!r.expansionCabling||r.expansionCabling==='Not assessed')t.pendingCabling++;}
    else if(!r.additionalAP)t.expansionUnrecorded++;
  }
  return {...t,totalCables:t.relocationCables+t.expansionCables};
}

export const equipmentOptions = ['None','Scaffolding','Scissor lift','Needs assessment'];
export const locationFields = ['building','floor','room','category','network','lanRoom','remarks'];
export function newJob(type='TR') {
  return {id:crypto.randomUUID(),type,model:'',hostname:'',serial:'',mac:'',relocation:'No',reason:'',cabling:type==='Expansion'?'No':'Not assessed',equipment:'None',bracket:false,notes:''};
}
export function duplicateJob(job) {
  return {...job,id:crypto.randomUUID(),hostname:'',serial:'',mac:''};
}
export function locationJobs(record) {
  if(Array.isArray(record.jobs))return record.jobs;
  const tr={...newJob('TR'),id:`${record.id}-tr`,model:record.model||'',hostname:record.hostname||'',serial:record.serial||'',mac:record.mac||'',relocation:record.relocation||'No',reason:record.reason||'',cabling:record.relocation==='Yes'?(record.newCabling||'Not assessed'):'No',equipment:'Needs assessment'};
  const jobs=[tr];
  if(record.additionalAP==='Yes')jobs.push({...newJob('Expansion'),id:`${record.id}-exp`,cabling:record.expansionCabling||'Not assessed',equipment:'Needs assessment'});
  return jobs;
}
export function normalizeLocation(record) {
  const photos=Array.isArray(record.photos)?record.photos:record.photo?[{data:record.photo}]:record.hasPhoto?[{remoteIndex:0}]:[];
  return {...record,jobs:locationJobs(record),photos,remarks:record.remarks||'',expansionUnrecorded:record.expansionUnrecorded??(!Array.isArray(record.jobs)&&!record.additionalAP)};
}
export function withJobSummary(record) {
  const jobs=record.jobs||[],tr=jobs.find(j=>j.type==='TR'),exp=jobs.find(j=>j.type==='Expansion');
  return {...record,model:tr?.model||'',hostname:tr?.hostname||'',serial:tr?.serial||'',mac:tr?.mac||'',relocation:tr?.relocation||'No',reason:tr?.reason||'',newCabling:tr?.relocation==='Yes'?tr.cabling:'',additionalAP:exp?'Yes':record.expansionUnrecorded?'':'No',expansionCabling:exp?.cabling||''};
}
export function validateLocation(record) {
  const error=validateEntry(withJobSummary(record));if(error)return error;
  if(!Array.isArray(record.jobs)||!record.jobs.length||record.jobs.length>100)return 'Add between 1 and 100 AP jobs.';
  const ids=new Set(),names=new Set();
  for(const job of record.jobs){
    if(!job||typeof job.id!=='string'||job.id.length>100||ids.has(job.id))return 'AP job IDs must be unique.';ids.add(job.id);
    if(!['TR','Expansion'].includes(job.type))return 'Choose TR or Expansion for each AP.';
    for(const [field,max] of Object.entries({model:150,hostname:150,serial:100,mac:30,reason:1000,notes:1000}))if(typeof job[field]!=='string'||job[field].length>max)return `Invalid ${field} in AP job.`;
    if(!equipmentOptions.includes(job.equipment)||typeof job.bracket!=='boolean')return 'Choose equipment and L-bracket requirements.';
    if(!cablingOptions.includes(job.cabling))return 'Choose cabling for each AP.';
    if(!['Yes','No'].includes(job.relocation))return 'Choose whether the existing AP must move.';
    if(job.type==='TR'&&job.relocation==='Yes'&&!job.reason.trim())return 'Enter a reason for each relocated AP.';
    if(job.mac&&!/^[a-f\d]{12}$/i.test(job.mac.replace(/[:.\-]/g,'')))return 'Enter a valid MAC or leave it blank.';
    const name=job.hostname.trim().toLowerCase();if(name&&names.has(name))return 'Duplicate hostname in this location.';if(name)names.add(name);
  }
  return '';
}
export function jobTotals(records) {
  const t={locations:records.length,tr:0,expansion:0,relocationCables:0,expansionCables:0,brackets:0,pendingCabling:0,scaffoldingJobs:0,scaffoldingLocations:0,liftJobs:0,liftLocations:0,equipmentPending:0,expansionUnrecorded:0};
  for(const record of records){let scaffold=false,lift=false;if(record.expansionUnrecorded)t.expansionUnrecorded++;
    for(const j of locationJobs(record)){
      const exp=j.type==='Expansion';if(exp)t.expansion++;else t.tr++;
      if(exp||j.relocation==='Yes'){if(j.cabling==='Yes')t[exp?'expansionCables':'relocationCables']++;else if(j.cabling==='Not assessed')t.pendingCabling++;}
      if(j.bracket)t.brackets++;
      if(j.equipment==='Scaffolding'){t.scaffoldingJobs++;scaffold=true;}
      if(j.equipment==='Scissor lift'){t.liftJobs++;lift=true;}
      if(j.equipment==='Needs assessment')t.equipmentPending++;
    }if(scaffold)t.scaffoldingLocations++;if(lift)t.liftLocations++;
  }return {...t,totalAPs:t.tr+t.expansion,totalCables:t.relocationCables+t.expansionCables};
}
// CSV supports quoted commas/newlines and spreadsheet-exported tab-separated files.
export function parseInventory(text) {
  const delimiter=text.split(/\r?\n/)[0].includes('\t')?'\t':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
  if(quoted)throw new Error('Unclosed quote in CSV.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  const clean=s=>s.replace(/^\uFEFF/,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const names=rows.shift()?.map(clean)||[];
  const aliases={hostname:['hostname','oldaphostname','aphostname'],model:['model','oldapmodel','apmodel'],serial:['serial','serialnumber','oldapserial','oldapserialnumber'],mac:['mac','macaddress','oldapmacaddress','oldapmac']};
  const indexes=Object.fromEntries(Object.entries(aliases).map(([field,labels])=>[field,names.findIndex(n=>labels.includes(n))]));
  if(indexes.hostname<0)throw new Error('CSV needs a Hostname column. Optional columns: Model, Serial, MAC.');
  const items=rows.map(values=>Object.fromEntries(Object.entries(indexes).map(([field,index])=>[field,index<0?'':(values[index]||'').trim()]))).filter(r=>r.hostname);
  if(!items.length||items.length>2000)throw new Error('Import between 1 and 2,000 inventory rows.');
  if(new Set(items.map(r=>r.hostname.toLowerCase())).size!==items.length)throw new Error('CSV contains duplicate hostnames.');
  return items;
}
