import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { fields, categories, lanRooms, validateEntry } from '../public/ap-survey/schema.js';
const script=fs.readFileSync(new URL('../public/ap-survey/app.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'')+'\nglobalThis.testApi={enqueue,sync,refresh,saveState,mutate,resetForm,render,getRecords:()=>records,getQueue:()=>queue,setEditing:(id,version)=>{editing=id;editVersion=version},setPhoto:(photo)=>currentPhoto=photo};';
const entry={id:'ba8b95b5-8fb0-4484-a5a3-1d746881d33f',building:'E',floor:'1',room:'E1-3',category:'Classrooms',network:'MOE-Owned',model:'',hostname:'',serial:'',mac:'',lanRoom:'Lan Room 2',relocation:'No',reason:'',newCabling:''};
async function browser(){
 const nodes={};const node=id=>nodes[id]??={value:['categoryFilter','lanFilter'].includes(id)?'all':id==='network'?'MOE-Owned':'',textContent:'',dataset:{},disabled:false,classList:{add(){},remove(){},toggle(){}},append(){},focus(){},reportValidity(){return true},querySelector(){return node('emptyTitle')},reset(){for(const f of fields)node(f).value=f==='network'?'MOE-Owned':'';node('photo').value='';}};
 let stored,failStorage=false;
 const transaction=()=>{const tx={objectStore:()=>({get:()=>{const req={};queueMicrotask(()=>{req.result=stored;req.onsuccess?.();});return req;},put(value){queueMicrotask(()=>{if(failStorage){tx.error=new Error('Full');tx.onerror?.();}else{stored=structuredClone(value);tx.oncomplete?.();}});}})};return tx;};
 const local={};let uuid=1;
 const state={remote:[],writes:0,failApi:0};
 const context={console,fields,categories,lanRooms,validateEntry,structuredClone,Blob,URL,setTimeout,FileReader:class{},setInterval:()=>{},crypto:{randomUUID:()=>`ba8b95b5-8fb0-4484-a5a3-${String(uuid++).padStart(12,'0')}`},navigator:{onLine:true},window:{scrollTo(){},addEventListener(){}},document:{getElementById:node,createElement:()=>({}),body:{append(){}}},localStorage:{getItem:k=>local[k],setItem:(k,v)=>local[k]=v,removeItem:k=>delete local[k]},indexedDB:{open:()=>{const req={};queueMicrotask(()=>{req.result={transaction,createObjectStore(){}};req.onsuccess();});return req;}},confirm:()=>true,fetch:async(url,opts)=>{
 if(state.failApi) return new Response(JSON.stringify({error:'Test failure'}),{status:state.failApi});
 if(url.endsWith('/session'))return Response.json({ok:true});
 if(url.includes('entries?'))return Response.json({entries:state.remote,nextOffset:null});
 if(opts?.method==='POST'||opts?.method==='PUT'){state.writes++;const body=JSON.parse(opts.body);const r={...body.entry,photo:undefined,hasPhoto:!!body.entry.photo,updatedAt:'server-version'};state.remote=[r];return Response.json({entry:r});}
 return Response.json({ok:true});
 }};
 vm.createContext(context);vm.runInContext(script,context);await new Promise(resolve=>setTimeout(resolve,10));
 return{context,state,node,api:context.testApi,setStorageFailure:value=>failStorage=value};
}
test('capture resets after durable local save; offline queue survives for later sync',async()=>{
 const b=await browser();b.context.navigator.onLine=false;for(const f of fields)b.node(f).value=entry[f];await b.node('form').onsubmit({preventDefault(){}});
 assert.equal(b.api.getQueue().length,1);assert.equal(b.node('room').value,'');assert.equal(b.state.writes,0);
 b.context.navigator.onLine=true;await b.api.sync();assert.equal(b.api.getQueue().length,0);assert.equal(b.state.writes,1);assert.equal(b.api.getRecords()[0].updatedAt,'server-version');
});
test('device storage failure leaves form intact and does not send to server',async()=>{
 const b=await browser();b.setStorageFailure(true);for(const f of fields)b.node(f).value=entry[f];await b.node('form').onsubmit({preventDefault(){}});
 assert.equal(b.node('room').value,'E1-3');assert.equal(b.state.writes,0);assert.equal(b.api.getQueue().length,0);
});
test('category and LAN filters combine with search and count',async()=>{
 const b=await browser();await b.api.saveState([entry,{...entry,id:'other',category:'ISH',lanRoom:'Server Room'}],[]);b.api.render();assert.equal(b.node('listCount').textContent,'Showing 2 of 2 total entries');
 b.node('categoryFilter').value='Classrooms';b.node('lanFilter').value='Lan Room 2';b.api.render();assert.equal(b.node('listCount').textContent,'Showing 1 of 2 total entries');b.node('search').value='not present';b.api.render();assert.equal(b.node('listCount').textContent,'Showing 0 of 2 total entries');
});
test('conflicts keep local draft and mark it for review instead of dropping data',async()=>{
 const b=await browser();b.context.navigator.onLine=false;await b.api.enqueue(entry);b.context.navigator.onLine=true;b.state.failApi=409;await b.api.sync();assert.equal(b.api.getQueue().length,1);assert.equal(b.api.getQueue()[0].error,'Test failure');assert.equal(b.api.getRecords()[0].room,'E1-3');
});
test('editing an offline creation retains create operation and photograph',async()=>{
 const b=await browser();b.context.navigator.onLine=false;const photo='data:image/jpeg;base64,/9j/AA==';await b.api.enqueue({...entry,relocation:'Yes',reason:'Near fan',photo});b.api.setEditing(entry.id,null);await b.api.enqueue({...entry,relocation:'Yes',reason:'Fan clearance',photo});assert.equal(b.api.getQueue().length,1);assert.equal(b.api.getQueue()[0].operation,'create');assert.equal(b.api.getQueue()[0].entry.photo,photo);
});
test('online submission changes status to Synced only after server acknowledgement',async()=>{
 const b=await browser();for(const f of fields)b.node(f).value=entry[f];await b.node('form').onsubmit({preventDefault(){}});
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(b.api.getQueue().length,0);assert.match(b.node('saveStatus').textContent,/Synced ✓ E1-3/);assert.match(b.node('rows').innerHTML,/Synced ✓/);
});
test('failed server submission shows failed status and keeps the draft',async()=>{
 const b=await browser();b.state.failApi=503;for(const f of fields)b.node(f).value=entry[f];await b.node('form').onsubmit({preventDefault(){}});
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(b.api.getQueue().length,1);assert.match(b.node('saveStatus').textContent,/Sync failed/);assert.doesNotMatch(b.node('saveStatus').textContent,/Synced ✓/);
});
test('offline submission status says saved on device, never synced',async()=>{
 const b=await browser();b.context.navigator.onLine=false;for(const f of fields)b.node(f).value=entry[f];await b.node('form').onsubmit({preventDefault(){}});assert.match(b.node('saveStatus').textContent,/Saved on device/);assert.doesNotMatch(b.node('saveStatus').textContent,/Synced ✓/);
});
