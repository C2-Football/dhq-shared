'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),M=require('../redraft-market.js');
test('combined market weight is capped and prices never create an absent or zero seasonal value',()=>{
 const out=M.blend({known:100,zero:0},{cbs:{active:true,values:{known:10,zero:100,absent:50}},fantasyCalc:{known:1000},weights:{budget:1,cbs:1,fantasyCalc:1}});
 assert.equal(out.weights.cbs+out.weights.fantasyCalc,.25);assert.equal(out.values.zero,0);assert.equal(out.values.absent,undefined);
});
test('punctuation/suffix identity and unresolved collision remain explicit',()=>{
 const rows=M.mapRows([{name:'Ken Walker III',position:'RB',team:'SEA'},{name:'J. Smith',position:'WR',team:'BUF'}],{a:{full_name:'Ken Walker',position:'RB',team:'KC'},b:{full_name:'John Smith',position:'WR',team:'BUF'},c:{full_name:'Joe Smith',position:'WR',team:'BUF'}});
 assert.equal(rows[0].playerId,'a');assert.equal(rows[0].teamMismatch,true);assert.equal(rows[1].playerId,null);assert.equal(rows[1].mappingStatus,'ambiguous');
});
test('two-QB columns and unsupported premiums are deliberate',()=>{
 const league={total_rosters:12,roster_positions:['QB','QB'],scoring_settings:{rec:1,pass_td:4,pass_yd:.04,rush_yd:.1,rush_td:6,rec_yd:.1,rec_td:6}};
 assert.equal(M.format(league).columns.QB,'2QB');league.scoring_settings.bonus_rec_te=.5;assert.equal(M.format(league).supported,false);
});
