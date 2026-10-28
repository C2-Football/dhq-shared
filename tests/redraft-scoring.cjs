'use strict';
// Execute canonical browser scripts, including the actual forecast/scoring path.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const b={console,Date,Map,Set,App:{},S:{nflState:{season:'2026',week:8}},fetch:async()=>({ok:false}),setTimeout,clearTimeout};b.window=b;b.globalThis=b;vm.createContext(b);
for(const file of ['sleeper-api.js','startsit-engine.js','weekly-proj.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),b);
function score(stats,scoring,position){return b.App.WeeklyProj.projectPlayer('p',{playersData:{p:{position,team:'BUF'}},statsData:{},priorData:{},week:8,scoring,providerProjections:{p:stats}});}
test('custom passing scoring reaches the production forecast',()=>assert.equal(score({pass_att:30,pass_yd:250,pass_td:2,pass_cmp:20,pass_fd:10},{pass_yd:.04,pass_td:4,pass_cmp:.5,pass_fd:1},'QB').points.median,38));
test('ordinary defense sack/int rules are scored once',()=>assert.equal(score({sack:2,int:2},{sack:1,int:2,idp_sack:3,idp_int:4},'DEF').points.median,6));
test('TE premium and threshold are neither omitted nor doubled',()=>assert.equal(score({rec:4,rec_yd:100},{rec:1,rec_yd:.1,bonus_rec_te:.5,bonus_rec_yd_100:3},'TE').points.median,19));
test('explicit zeros beat defaults and aliases',()=>{assert.equal(score({rec:4},{rec:0,bonus_rec_te:0},'TE').points.median,0);assert.equal(b.calcFantasyPts({sack:2,idp_sack:2},{idp_sack:0,sack:3},'LB'),0);});
test('IDP aliases and total tackles preserve production',()=>{assert.equal(b.calcFantasyPts({sack:2,tkl_solo:3},{idp_sack:3,idp_tkl_solo:1},'LB'),9);assert.equal(b.calcFantasyPts({tkl_solo:3,tkl_ast:2},{idp_tkl:1},'LB'),5);});
test('unknown rules pause the forecast',()=>{const p=score({rush_att:10,rush_yd:100},{rush_yd:.1,unrecognized_bonus:2},'RB');assert.equal(p.points.median,null);assert.equal(p.available,false);assert.deepEqual(Array.from(p.scoringSupport.unsupported),['unrecognized_bonus']);});
test('questionable participation has a healthy scenario, not a made-up expected-value haircut',()=>{const raw=b.App.StartSit.projectPlayerWeek({pid:'p',week:8,position:'RB',baseline:{rush_att:10,rush_yd:100},injuryStatus:'Questionable'});const out=b.App.StartSit.scoreProjection(raw,{rush_yd:.1});assert.equal(out.points.median,null);assert.equal(out.conditionalPoints.median,10);assert.equal(out.available,false);});
