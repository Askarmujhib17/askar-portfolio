import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, issueSession, authenticated, photoBytes } from '../server/ap-survey.js';
import { newJob, withJobSummary, normalizeLocation, validateLocation, jobTotals, duplicateJob, parseInventory, validateEntry } from '../public/ap-survey/schema.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'test-only',AP_SURVEY_PIN:'123456',AP_SURVEY_SESSION_SECRET:'test-session-secret-not-a-real-key-12345'};
const id='ba8b95b5-8fb0-4484-a5a3-1d746881d33f';
const entry={id,building:'Block E',floor:'1',room:'E1-3 CLASSROOM',category:'Classrooms',network:'MOE-Owned',model:'',hostname:'',serial:'',mac:'',lanRoom:'Lan Room 1',relocation:'No',reason:'',newCabling:''};
function request(route,method='GET',body,cookie){return new Request(`https://example.com/api/ap-survey/${route}`,{method,headers:{...(method!=='GET'?{'Origin':'https://example.com','Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});}
async function session(){return '__Host-ap-survey='+await issueSession(env);}
function fakeDb(initial=[]){
 const rows=structuredClone(initial);let uploads=0;let version=0;const db={rows,get uploads(){return uploads},rpc:async()=>({data:true,error:null}),storage:{from:()=>({upload:async()=>{uploads++;return{error:null}},download:async()=>({data:new Blob(['photo'],{type:'image/jpeg'}),error:null})})}};
 db.from=()=>{let action='select',payload,filters=[],start=0,end=499;
 const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},range(a,b){start=a;end=b;return q},insert(p){action='insert';payload=p;return q},update(p){action='update';payload=p;return q},delete(){action='delete';return q},maybeSingle(){return execute(true)},then(resolve,reject){return execute(false).then(resolve,reject)}};
 async function execute(single){let matches=rows.filter(r=>filters.every(([k,v])=>r[k]===v));
 if(action==='insert'){if(rows.some(r=>r.id===payload.id))return{error:{code:'23505'}};const r={...payload,created_at:'2026-10-13T00:00:00Z',updated_at:`2026-10-13T00:00:0${++version}Z`};rows.push(r);matches=[r];}
 if(action==='update'){matches.forEach(r=>Object.assign(r,payload,{updated_at:`2026-10-13T00:00:0${++version}Z`}));}
 if(action==='delete'){for(const r of matches)rows.splice(rows.indexOf(r),1);}
 return{data:single?matches[0]||null:matches.slice(start,end+1),error:null};}
 return q;};return db;
}
test('sessions enforce signature, expiry and PIN rotation',async()=>{
 const token=await issueSession(env,Date.now()-1000);const req=request('session','GET',null,'__Host-ap-survey='+token);
 assert.equal(await authenticated(req,env),true);
 assert.equal(await authenticated(req,{...env,AP_SURVEY_PIN:'654321'}),false);
 assert.equal(await authenticated(req,env,Date.now()+8*24*3600000),false);
 assert.equal(await authenticated(request('session','GET',null,'__Host-ap-survey='+token.slice(0,-1)+'x'),env),false);
});
test('all data and photos require a session',async()=>{
 for(const route of ['entries','photos/'+id])assert.equal((await handle(request(route),env,fakeDb())).status,401);
});
test('login returns secure cookie, rejects incorrect PIN and fails closed without limiter',async()=>{
 let db=fakeDb();let response=await handle(request('login','POST',{pin:'123456'}),env,db);assert.equal(response.status,200);assert.match(response.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);
 response=await handle(request('login','POST',{pin:'000000'}),env,db);assert.equal(response.status,401);
 db.rpc=async()=>({data:false});response=await handle(request('login','POST',{pin:'123456'}),env,db);assert.equal(response.status,429);
 db.rpc=async()=>({error:{message:'missing'}});response=await handle(request('login','POST',{pin:'123456'}),env,db);assert.equal(response.status,503);
});
test('mutations reject cross-origin requests and oversized bodies',async()=>{
 const cookie=await session();const req=request('entries','POST',{entry},cookie);req.headers.set('Origin','https://attacker.example');assert.equal((await handle(req,env,fakeDb())).status,403);
 const huge=request('entries','POST',{entry},cookie);huge.headers.set('Content-Length','99999999');assert.equal((await handle(huge,env,fakeDb())).status,413);
});
test('required fields, exact categories, LAN choices and relocation reason validated',()=>{
 assert.equal(validateEntry(entry),'');assert.ok(validateEntry({...entry,lanRoom:''}));assert.ok(validateEntry({...entry,category:'Made up'}));assert.ok(validateEntry({...entry,room:' '}));assert.ok(validateEntry({...entry,relocation:'Yes',newCabling:'Not assessed',reason:' '}));assert.equal(validateEntry({...entry,mac:'aabb.ccdd.eeff'}),'');assert.ok(validateEntry({...entry,mac:'bad'}));
});
test('relocation requires photo, image format is checked',async()=>{
 const cookie=await session();const response=await handle(request('entries','POST',{entry:{...entry,relocation:'Yes',newCabling:'Not assessed',reason:'Too close to fan'}},cookie),env,fakeDb());assert.equal(response.status,400);
 assert.throws(()=>photoBytes('data:image/jpeg;base64,YWJj'),/format/);
 assert.throws(()=>photoBytes('data:text/html;base64,YQ=='),/JPG/);
});
test('create retries are idempotent; stale edits and deletes cannot overwrite',async()=>{
 const cookie=await session(),db=fakeDb();let response=await handle(request('entries','POST',{entry},cookie),env,db);assert.equal(response.status,201);const saved=(await response.json()).entry;
 response=await handle(request('entries','POST',{entry},cookie),env,db);assert.equal(response.status,201);assert.equal(db.rows.length,1);
 response=await handle(request('entries/'+id,'PUT',{entry:{...entry,hostname:'L1AP01'},expectedUpdatedAt:'old'},cookie),env,db);assert.equal(response.status,409);assert.equal(db.rows[0].old_ap_hostname,'');
 response=await handle(request('entries/'+id,'PUT',{entry:{...entry,hostname:'L1AP01'},expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,200);
 response=await handle(request('entries/'+id,'DELETE',{expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,409);assert.equal(db.rows.length,1);
});
test('saved photos can be viewed/downloaded and retained on edit without reupload',async()=>{
 const cookie=await session(),db=fakeDb(),photo='data:image/jpeg;base64,/9j/AA==';
 let response=await handle(request('entries','POST',{entry:{...entry,relocation:'Yes',newCabling:'Not assessed',reason:'Too close to fan',photo}},cookie),env,db);assert.equal(response.status,201);const saved=(await response.json()).entry;assert.equal(saved.hasPhoto,true);assert.equal(db.uploads,1);
 response=await handle(request('entries/'+id,'PUT',{entry:{...entry,relocation:'Yes',newCabling:'Not assessed',reason:'Fan and mounting clearance'},expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,200);assert.equal(db.uploads,1);
 response=await handle(request('photos/'+id+'?download'),env,db);assert.equal(response.status,401);
 response=await handle(request('photos/'+id+'?download','GET',null,cookie),env,db);assert.equal(response.status,200);assert.match(response.headers.get('Content-Disposition'),/attachment/);assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('all network options accepted and cabling persisted in relocation record',async()=>{
 for(const network of ['MOE-Owned','School-Owned','Unknown'])assert.equal(validateEntry({...entry,network}),'');
 assert.ok(validateEntry({...entry,network:'Other'}));
 assert.ok(validateEntry({...entry,relocation:'Yes',newCabling:'Not assessed',reason:'Fan',newCabling:'Maybe'}));
 const cookie=await session(),db=fakeDb();
 let response=await handle(request('entries','POST',{entry:{...entry,network:'School-Owned',relocation:'Yes',newCabling:'Not assessed',reason:'Fan',newCabling:'Yes',photo:'data:image/jpeg;base64,/9j/AA=='}},cookie),env,db);
 assert.equal(response.status,201);let saved=(await response.json()).entry;assert.equal(saved.newCabling,'Yes');assert.equal(db.rows[0].new_cabling,'Yes');assert.equal(saved.network,'School-Owned');
 response=await handle(request('entries/'+id,'PUT',{entry:{...entry,network:'Unknown',relocation:'Yes',newCabling:'Not assessed',reason:'Fan',newCabling:'No'},expectedUpdatedAt:saved.updatedAt},cookie),env,db);
 assert.equal(response.status,200);saved=(await response.json()).entry;assert.equal(saved.newCabling,'No');
 // An older app that does not send cabling must preserve the recorded answer.
 const legacy={...entry,network:'Unknown',relocation:'Yes',newCabling:'Not assessed',reason:'Fan clearance'};delete legacy.newCabling;
 response=await handle(request('entries/'+id,'PUT',{entry:legacy,expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,200);saved=(await response.json()).entry;assert.equal(saved.newCabling,'No');
 response=await handle(request('entries/'+id,'PUT',{entry:{...entry,network:'Unknown'},expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,200);assert.equal(db.rows[0].new_cabling,null);assert.equal((await response.json()).entry.newCabling,'');
});
test('expansion requires one shared photo, saves both cabling answers and remarks',async()=>{
 const cookie=await session(),db=fakeDb();
 const expansion={...entry,additionalAP:'Yes',expansionCabling:'Yes',remarks:'Confirm route with ICT manager'};
 let response=await handle(request('entries','POST',{entry:expansion},cookie),env,db);assert.equal(response.status,400);
 response=await handle(request('entries','POST',{entry:{...expansion,relocation:'Yes',newCabling:'Yes',reason:'Near fan',photo:'data:image/jpeg;base64,/9j/AA=='}},cookie),env,db);
 assert.equal(response.status,201);let saved=(await response.json()).entry;assert.equal(saved.additionalAP,'Yes');assert.equal(saved.expansionCabling,'Yes');assert.equal(saved.remarks,expansion.remarks);assert.equal(db.uploads,1);
 const legacy={...entry,relocation:'Yes',newCabling:'Yes',reason:'Updated clearance note'};
 response=await handle(request('entries/'+id,'PUT',{entry:legacy,expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,200);saved=(await response.json()).entry;assert.equal(saved.additionalAP,'Yes');assert.equal(saved.remarks,expansion.remarks);assert.equal(db.uploads,1);
 response=await handle(request('entries/'+id,'PUT',{entry:{...entry,additionalAP:'No',expansionCabling:'',remarks:''},expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,200);saved=(await response.json()).entry;assert.equal(saved.additionalAP,'No');assert.equal(saved.expansionCabling,'');assert.equal(saved.hasPhoto,true);
});
test('legacy records do not get inferred expansion and remarks are bounded',async()=>{
 const db=fakeDb(),cookie=await session();const response=await handle(request('entries','POST',{entry},cookie),env,db);assert.equal(response.status,201);const saved=(await response.json()).entry;assert.equal(saved.additionalAP,'');assert.equal(saved.remarks,'');
 assert.ok(validateEntry({...entry,additionalAP:'Yes',expansionCabling:'Maybe'}));assert.ok(validateEntry({...entry,remarks:'a'.repeat(3001)}));
});

test('multi-AP locations persist quantities, extras and one classroom photo',async()=>{
 const db=fakeDb(),cookie=await session();const jobs=[{...newJob('TR'),hostname:'A',relocation:'Yes',reason:'Fan',cabling:'Yes',equipment:'Scissor lift'},{...newJob('TR'),hostname:'B',equipment:'Scissor lift'},{...newJob('Expansion'),cabling:'Yes',bracket:true,equipment:'Scaffolding'}];
 const multi=withJobSummary({...entry,jobs,photos:[{data:'data:image/jpeg;base64,/9j/AA=='}],expansionUnrecorded:false});
 let response=await handle(request('entries','POST',{entry:multi},cookie),env,db);assert.equal(response.status,201);let saved=(await response.json()).entry;assert.equal(saved.jobs.length,3);assert.equal(saved.photos.length,1);assert.equal(db.uploads,1);
 const totals=jobTotals([saved]);assert.equal(totals.totalCables,2);assert.equal(totals.brackets,1);assert.equal(totals.liftJobs,2);assert.equal(totals.liftLocations,1);assert.equal(totals.scaffoldingLocations,1);
 // PostgreSQL JSONB may return objects with a different property order.
 db.rows[0].ap_jobs=db.rows[0].ap_jobs.map(j=>Object.fromEntries(Object.entries(j).reverse()));
 response=await handle(request('entries','POST',{entry:multi},cookie),env,db);assert.equal(response.status,201);assert.equal(db.rows.length,1);assert.equal(db.uploads,1);
 response=await handle(request('entries/'+id,'PUT',{entry:{...saved,remarks:'Updated'},expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,200);saved=(await response.json()).entry;assert.equal(db.uploads,1);assert.equal(saved.jobs[2].bracket,true);
 response=await handle(request('entries/'+id,'PUT',{entry,expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,409);
});
test('multiple photos allowed outside classrooms and photo references cannot escape a location',async()=>{
 const db=fakeDb(),cookie=await session(),photo={data:'data:image/jpeg;base64,/9j/AA=='};
 const multi=withJobSummary({...entry,category:'canteen',jobs:[newJob('Expansion')],photos:[photo,photo]});
 let response=await handle(request('entries','POST',{entry:multi},cookie),env,db);assert.equal(response.status,201);let saved=(await response.json()).entry;assert.equal(saved.photos.length,2);
 response=await handle(request('entries/'+id,'PUT',{entry:{...saved,photos:[{remoteIndex:99}]},expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,400);
 response=await handle(request('entries/'+id,'PUT',{entry:{...saved,category:'Classrooms'},expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,400);
 response=await handle(request('photos/'+id+'?photo=1','GET',null,cookie),env,db);assert.equal(response.status,200);
 response=await handle(request('photos/'+id+'?photo=2','GET',null,cookie),env,db);assert.equal(response.status,404);
});
test('duplicate identifiers, legacy conversion and inventory parsing',()=>{
 const first={...newJob('TR'),hostname:'AP01',serial:'S',mac:'aabb.ccdd.eeff'},second=duplicateJob(first);assert.equal(second.hostname,'');assert.equal(second.serial,'');assert.equal(second.mac,'');assert.notEqual(first.id,second.id);
 assert.ok(validateLocation(withJobSummary({...entry,jobs:[first,{...second,hostname:'ap01'}]})));
 const legacy=normalizeLocation({...entry,additionalAP:'Yes',expansionCabling:'Not assessed'});assert.equal(legacy.jobs.length,2);assert.equal(legacy.jobs[1].cabling,'Not assessed');assert.equal(legacy.jobs[0].equipment,'Needs assessment');
 const items=parseInventory('Hostname,Model,Serial,MAC\r\nL1AP01,"Cisco, model",S123,aabb.ccdd.eeff\r\n');assert.equal(items[0].model,'Cisco, model');assert.equal(items[0].serial,'S123');
 assert.throws(()=>parseInventory('Hostname\nAP01\nap01'),/duplicate/);assert.throws(()=>parseInventory('Room,Other\nA,B'),/Hostname/);
});
test('inventory API validates and upserts only approved columns after authentication',async()=>{
 let written;const db={from:table=>{assert.equal(table,'ap_survey_inventory');return{upsert:async rows=>{written=rows;return{error:null}}};}};const cookie=await session();
 let response=await handle(request('inventory','POST',{items:[{hostname:' L1AP01 ',model:'C9130',serial:'S',mac:'aabb.ccdd.eeff',unwanted:'ignored'}]},cookie),env,db);assert.equal(response.status,200);assert.equal(written[0].hostname_key,'l1ap01');assert.equal(written[0].unwanted,undefined);
 response=await handle(request('inventory','POST',{items:[{hostname:'AP01',model:'',serial:'',mac:'invalid'}]},cookie),env,db);assert.equal(response.status,400);
 response=await handle(request('inventory','POST',{items:[]}),env,db);assert.equal(response.status,401);
});
