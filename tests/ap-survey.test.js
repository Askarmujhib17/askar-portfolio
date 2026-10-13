import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, issueSession, authenticated, photoBytes } from '../server/ap-survey.js';
import { validateEntry } from '../public/ap-survey/schema.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'test-only',AP_SURVEY_PIN:'123456',AP_SURVEY_SESSION_SECRET:'test-session-secret-not-a-real-key-12345'};
const id='ba8b95b5-8fb0-4484-a5a3-1d746881d33f';
const entry={id,building:'Block E',floor:'1',room:'E1-3 CLASSROOM',category:'Classrooms',network:'MOE-Owned',model:'',hostname:'',serial:'',mac:'',lanRoom:'Lan Room 1',relocation:'No',reason:''};
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
 assert.equal(validateEntry(entry),'');assert.ok(validateEntry({...entry,lanRoom:''}));assert.ok(validateEntry({...entry,category:'Made up'}));assert.ok(validateEntry({...entry,room:' '}));assert.ok(validateEntry({...entry,relocation:'Yes',reason:' '}));assert.equal(validateEntry({...entry,mac:'aabb.ccdd.eeff'}),'');assert.ok(validateEntry({...entry,mac:'bad'}));
});
test('relocation requires photo, image format is checked',async()=>{
 const cookie=await session();const response=await handle(request('entries','POST',{entry:{...entry,relocation:'Yes',reason:'Too close to fan'}},cookie),env,fakeDb());assert.equal(response.status,400);
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
 let response=await handle(request('entries','POST',{entry:{...entry,relocation:'Yes',reason:'Too close to fan',photo}},cookie),env,db);assert.equal(response.status,201);const saved=(await response.json()).entry;assert.equal(saved.hasPhoto,true);assert.equal(db.uploads,1);
 response=await handle(request('entries/'+id,'PUT',{entry:{...entry,relocation:'Yes',reason:'Fan and mounting clearance'},expectedUpdatedAt:saved.updatedAt},cookie),env,db);assert.equal(response.status,200);assert.equal(db.uploads,1);
 response=await handle(request('photos/'+id+'?download'),env,db);assert.equal(response.status,401);
 response=await handle(request('photos/'+id+'?download','GET',null,cookie),env,db);assert.equal(response.status,200);assert.match(response.headers.get('Content-Disposition'),/attachment/);assert.equal(response.headers.get('Cache-Control'),'no-store');
});
