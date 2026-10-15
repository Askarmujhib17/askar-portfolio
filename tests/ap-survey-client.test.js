import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as schema from '../public/ap-survey/schema.js';
const script=fs.readFileSync(new URL('../public/ap-survey/app.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'')+'\nglobalThis.testApi={enqueue,sync,refresh,saveState,mutate,resetForm,render,addJob,submitLocation,renderPhotos,getRecords:()=>records,getQueue:()=>queue,getJobs:()=>jobs,getInventory:()=>inventory,setEditing:(id,v)=>{editing=id;editVersion=v},setPhotos:(photos)=>draftPhotos=photos};';
const location={id:'ba8b95b5-8fb0-4484-a5a3-1d746881d33f',building:'E',floor:'1',room:'E1-3',category:'Classrooms',network:'MOE-Owned',lanRoom:'Lan Room 2',remarks:''};
function base(){return schema.withJobSummary({...location,jobs:[schema.newJob('TR')],photos:[]});}
async function browser(){
 const nodes={};const node=id=>nodes[id]??={value:['categoryFilter','lanFilter','expansionFilter'].includes(id)?'all':id==='network'?'MOE-Owned':id==='bulkTarget'?'all':'',textContent:'',dataset:{},disabled:false,classList:{add(){},remove(){},toggle(){}},append(){},focus(){},addEventListener(){},reportValidity(){return true},querySelector(){return node('emptyTitle')},querySelectorAll(){return []},reset(){for(const f of schema.locationFields)node(f).value=f==='network'?'MOE-Owned':'';node('photo').value='';}};
 let stored,failStorage=false;const transaction=()=>{const tx={objectStore:()=>({get:()=>{const req={};queueMicrotask(()=>{req.result=stored;req.onsuccess?.();});return req;},put(value){queueMicrotask(()=>{if(failStorage){tx.error=new Error('Full');tx.onerror?.();}else{stored=structuredClone(value);tx.oncomplete?.();}});}})};return tx;};
 const local={},state={remote:[],writes:0,failApi:0};
 const context={...schema,console,structuredClone,Blob,URL,setTimeout,FileReader:class{},setInterval:()=>{},crypto, navigator:{onLine:true},window:{scrollTo(){},addEventListener(){}},document:{getElementById:node,querySelector:()=>node('photoLabel'),querySelectorAll:()=>[],createElement:()=>({}),body:{append(){}}},localStorage:{getItem:k=>local[k],setItem:(k,v)=>local[k]=v,removeItem:k=>delete local[k]},indexedDB:{open:()=>{const req={};queueMicrotask(()=>{req.result={transaction,createObjectStore(){}};req.onsuccess();});return req;}},confirm:()=>true,fetch:async(url,opts)=>{
 if(state.failApi)return new Response(JSON.stringify({error:'Test failure'}),{status:state.failApi});
 if(url.endsWith('/session'))return Response.json({ok:true});if(url.includes('inventory?'))return Response.json({items:[],nextOffset:null});
 if(url.includes('entries?'))return Response.json({entries:state.remote,nextOffset:null});
 if(opts?.method==='POST'||opts?.method==='PUT'){state.writes++;const body=JSON.parse(opts.body);const r={...body.entry,photo:undefined,photos:(body.entry.photos||[]).map((_,remoteIndex)=>({remoteIndex})),updatedAt:'server-version'};state.remote=[r];return Response.json({entry:r});}return Response.json({ok:true});
 }};vm.createContext(context);vm.runInContext(script,context);await new Promise(r=>setTimeout(r,10));return{context,state,node,api:context.testApi,setStorageFailure:value=>failStorage=value};
}
function fill(b){for(const f of schema.locationFields)b.node(f).value=location[f];}
test('offline capture keeps location context but clears room/AP identifiers, then syncs',async()=>{
 const b=await browser();b.context.navigator.onLine=false;fill(b);b.api.getJobs()[0].hostname='L1AP01';await b.api.submitLocation(true);assert.equal(b.api.getQueue().length,1);assert.equal(b.node('room').value,'');assert.equal(b.node('building').value,'E');assert.equal(b.node('lanRoom').value,'Lan Room 2');assert.equal(b.api.getJobs()[0].hostname,'');assert.equal(b.api.getJobs().length,2);assert.equal(b.state.writes,0);
 b.context.navigator.onLine=true;await b.api.sync();assert.equal(b.api.getQueue().length,0);assert.equal(b.state.writes,1);assert.match(b.node('saveStatus').textContent,/Synced ✓/);
});
test('save blank clears context; storage failure preserves unsaved form',async()=>{
 const b=await browser();b.context.navigator.onLine=false;fill(b);b.setStorageFailure(true);await b.api.submitLocation(false);assert.equal(b.node('room').value,'E1-3');assert.equal(b.api.getQueue().length,0);
 b.setStorageFailure(false);await b.api.submitLocation(false);assert.equal(b.node('building').value,'');assert.equal(b.api.getJobs().length,1);
});
test('every category supports multiple TR and expansion APs; similar AP clears identifiers',async()=>{
 const b=await browser();fill(b);b.node('category').value='canteen';b.api.getJobs()[0].hostname='OLD';b.api.getJobs()[0].serial='S1';b.api.getJobs()[0].model='C9130';b.api.getJobs()[0].equipment='Scissor lift';b.api.addJob('TR',b.api.getJobs()[0]);b.api.addJob('Expansion');b.api.addJob('Expansion');assert.equal(b.api.getJobs().length,4);const clone=b.api.getJobs()[1];assert.equal(clone.hostname,'');assert.equal(clone.serial,'');assert.equal(clone.model,'C9130');assert.equal(clone.equipment,'Scissor lift');assert.equal(b.api.getJobs()[2].cabling,'No');assert.equal(b.api.getJobs()[2].bracket,false);
});
test('classroom defaults, shared-photo requirement and classroom photo limit',async()=>{
 const b=await browser();fill(b);b.node('category').onchange();assert.equal(b.api.getJobs().length,2);await b.api.submitLocation(true);assert.equal(b.api.getQueue().length,0);assert.match(b.node('notice').textContent,/wide-angle photo/);
 b.api.setPhotos([{data:'one'},{data:'two'}]);await b.api.submitLocation(true);assert.equal(b.api.getQueue().length,0);assert.match(b.node('notice').textContent,/one shared photo/);
});
test('combined filters change location counts and equipment summaries',async()=>{
 const b=await browser();const r=base();r.jobs.push({...schema.newJob('Expansion'),cabling:'Yes',equipment:'Scissor lift'});await b.api.saveState([r,{...base(),id:'other',category:'ISH'}],[]);b.node('categoryFilter').value='Classrooms';b.node('expansionFilter').value='Yes';b.api.render();assert.equal(b.node('listCount').textContent,'Showing 1 of 2 locations');assert.match(b.node('cablingSummary').innerHTML,/Scissor lift/);
});
test('sync conflicts preserve local multi-AP draft and failed status',async()=>{
 const b=await browser();b.context.navigator.onLine=false;fill(b);await b.api.submitLocation(true);b.context.navigator.onLine=true;b.state.failApi=409;await b.api.sync();assert.equal(b.api.getQueue().length,1);assert.match(b.node('saveStatus').textContent,/Sync failed/);assert.equal(b.api.getRecords()[0].jobs.length,1);
});
test('apply common requirements respects target and TR relocation applicability',async()=>{
 const b=await browser();b.api.addJob('Expansion');b.node('bulkTarget').value='all';b.node('bulkCabling').value='Yes';b.node('applyCabling').onclick();assert.equal(b.api.getJobs()[0].cabling,'Not assessed');assert.equal(b.api.getJobs()[1].cabling,'Yes');b.node('bulkBracket').value='true';b.node('applyBracket').onclick();assert.equal(b.api.getJobs()[0].bracket,false);assert.equal(b.api.getJobs()[1].bracket,true);
});
