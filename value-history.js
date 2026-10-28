// Canonical snapshot contract and finite-run report. No inferred historical values.
(function(root) {
 'use strict';
 const VERSION='value-history-v1';
 const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
 async function fingerprint(v) {const bytes=new TextEncoder().encode(stable(v));return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
 function normalize(r, now=new Date().toISOString()) {
  if(!r || !r.leagueId || !r.playerId || !['dynasty','redraft'].includes(r.valueType) || !['draft','trade','periodic','monitor'].includes(r.source)) throw Error('Invalid snapshot identity, format or source');
  const season=Number(r.season),week=Number(r.week);
  if(!Number.isInteger(season)||season<2000||season>2200||!Number.isInteger(week)||week<0||week>22) throw Error('Invalid snapshot season/week');
  if(r.value!=null && (typeof r.value!=='number'||!Number.isFinite(r.value)||r.value<0)) throw Error('Invalid snapshot value');
  const ts=r.ts||now, calculated=r.calculatedAt||null;
  if(!Number.isFinite(Date.parse(ts))||(calculated&&!Number.isFinite(Date.parse(calculated))))throw Error('Invalid snapshot timestamp');
  const status=r.status||(r.value==null?'missing':'ok');
  if(!['ok','missing','stale','error'].includes(status)||(status==='ok'&&r.value==null))throw Error('Invalid calculation status');
  const event=r.eventId||r.context?.trade_key||r.context?.event_id;
  const key=r.captureKey||(r.source==='periodic'?'browser-day:'+ts.slice(0,10):event? r.source+':'+event:null);
  if(!key||key.length>512)throw Error('Snapshot requires a stable capture key or event identity');
  return {league_id:String(r.leagueId),player_id:String(r.playerId),season,week,ts,value:r.value??null,value_type:r.valueType,source:r.source,context:r.context||{},capture_key:key,calculated_at:calculated,calculation_status:status,provenance:r.provenance||{},roster_ids:r.rosterIds||[],run_id:r.runId||null,capture_index:r.captureIndex??null};
 }
 function causes(a,b) {
  const x=a?.provenance||{},y=b?.provenance||{},out=[];
  for(const [key,label] of [['engineVersion','engine update'],['buildVersion','build update'],['settingsFingerprint','settings change'],['sourceFingerprint','source data change']])if(x[key]&&y[key]&&x[key]!==y[key])out.push(label);
  if(a&&b&&stable(a.roster_ids)!==stable(b.roster_ids))out.push('roster membership change');
  return out.length?out:['unknown']; // association, never a causal attribution
 }
 function report(run,captures,rows,now=Date.now()) {
  const ids=run.player_ids||[],due=run.capture_times||[];
  const days=due.map((at,i)=>{const c=captures.find(c=>c.capture_index===i),rs=rows.filter(r=>r.capture_index===i),valid=rs.filter(r=>r.value!=null&&r.calculation_status==='ok');
   return {index:i,scheduledAt:at,status:(!c||['scheduled','collecting'].includes(c.status))&&Date.parse(at)+6*3600000<now?'missing':c?.status||'scheduled',saved:rs.length,valid:valid.length,expected:ids.length,stale:rs.filter(r=>r.calculation_status==='stale').length,error:c?.error||null,attempts:c?.attempts||0,capturedAt:c?.captured_at||null};});
  const movements=ids.map(id=>{const r=rows.filter(r=>r.player_id===id).sort((a,b)=>a.capture_index-b.capture_index),a=r.find(r=>r.capture_index===0),b=r.find(r=>r.capture_index===7);
   const comparable=a?.value!=null&&b?.value!=null&&a.calculation_status==='ok'&&b.calculation_status==='ok';
   const delta=comparable?Number(b.value)-Number(a.value):null,pct=comparable&&Number(a.value)!==0?delta/Math.abs(Number(a.value))*100:null;
   return {playerId:id,start:a?.value??null,end:b?.value??null,delta,pct,observations:r.length,associations:causes(a,b),jump:delta!=null&&(Math.abs(delta)>=1000||(pct!=null&&Math.abs(pct)>=25)),comparisonLimited:!!(a&&b&&['engineVersion','settingsFingerprint'].some(k=>!a.provenance?.[k]||!b.provenance?.[k]||a.provenance[k]!==b.provenance[k]))};});
  const good=days.filter(d=>d.status==='complete'&&d.valid===ids.length);
  const sorted=movements.filter(m=>m.delta!=null).sort((a,b)=>b.delta-a.delta);
  return {run,days,movements,risers:sorted.filter(m=>m.delta>0).slice(0,5),fallers:sorted.filter(m=>m.delta<0).reverse().slice(0,5),expected:ids.length*8,completed:rows.length,valid:days.reduce((s,d)=>s+d.valid,0),complete:good.length===8,status:(run.status==='complete'&&good.length!==8)||(run.status==='active'&&Date.parse(run.ends_at)+6*3600000<now)?'incomplete':run.status,lastSuccess:captures.filter(c=>c.status==='complete').map(c=>c.captured_at).filter(Boolean).sort().at(-1)||null,next:run.status==='active'?days.find(d=>Date.parse(d.scheduledAt)>now)?.scheduledAt||null:null,missingDays:days.filter(d=>['missing','failed','partial'].includes(d.status)).map(d=>d.index)};
 }
 const api={VERSION,normalize,report,causes,stable,fingerprint};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.App=root.App||{};root.App.ValueHistory=api;
})(typeof window!=='undefined'?window:globalThis);
