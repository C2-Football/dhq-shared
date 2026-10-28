'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),H=require('../value-history.js');
const row=extra=>H.normalize({leagueId:'L',playerId:'p',season:2026,week:8,valueType:'redraft',source:'periodic',ts:'2026-10-28T12:00:00Z',...extra});
test('canonical contract retains zero and missing, rejects invalid values, separates daily/event identities',()=>{
 assert.equal(row({value:0}).value,0);assert.equal(row({value:null}).calculation_status,'missing');assert.throws(()=>row({value:NaN}),/Invalid/);assert.notEqual(row({value:0}).capture_key,row({value:0,ts:'2026-10-29T12:00:00Z'}).capture_key);
 assert.throws(()=>row({value:1,source:'draft'}),/identity/);assert.equal(row({value:1,source:'trade',eventId:'event'}).capture_key,'trade:event');
});
test('report requires actual baseline and day seven and labels zero denominators and changed configuration',()=>{
 const run={status:'incomplete',player_ids:['p'],capture_times:Array.from({length:8},(_,i)=>new Date(Date.UTC(2026,9,20+i,12)).toISOString())};
 const r=H.report(run,[],[{player_id:'p',capture_index:0,value:0,calculation_status:'ok',provenance:{engineVersion:'old'}},{player_id:'p',capture_index:7,value:100,calculation_status:'ok',provenance:{engineVersion:'new'}}]);
 assert.equal(r.complete,false);assert.equal(r.movements[0].pct,null);assert.equal(r.movements[0].delta,100);assert.equal(r.movements[0].comparisonLimited,true);assert.deepEqual(r.movements[0].associations,['engine update']);
});
