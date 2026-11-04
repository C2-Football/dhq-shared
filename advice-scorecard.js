/* global module */
// Advice is a separate, prospective instrument. Never import player forecasts as issued advice.
(function(root) {
 'use strict';
 const VERSION='advice-scorecard-v1', POLICY='weekly-pregame-projection-v1';
 const CANDIDATE='depth-aware-v1', SIMPLE='max-next-week-lineup-v1';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const stable=x=>Array.isArray(x)?'['+x.map(stable).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}':JSON.stringify(x??null);
 const num=x=>typeof x==='number'&&Number.isFinite(x);
 const time=x=>typeof x==='string'?Date.parse(x):NaN;
 const ids=x=>[...new Set((x||[]).map(String))];
 const round=x=>Math.round(x*100)/100;
 const BENCH=new Set(['BN','BE','BENCH','IR','TAXI','RES']);
 const active=r=>ids(r.players).filter(p=>!ids([...(r.reserve||[]),...(r.taxi||[])]).includes(p));
 const hold=()=>({kind:'hold',incoming:[],outgoing:[],drops:[],faab:0,reason:'Hold / no clear upgrade',expectedBenefit:0});
 function rules(c) {
  const ss=root.App?.StartSit;
  if(!ss)throw Error('Canonical StartSit rules unavailable');
  const slots=c.league.roster_positions.map(ss.normSlot);
  if(slots.some(s=>!BENCH.has(s)&&!ss.BASE_POSITIONS.has(s)&&!ss.FLEX_ALLOWED[s]))throw Error('Unsupported roster slot');
  return {slots:slots.filter(s=>!BENCH.has(s)),capacity:slots.filter(s=>!['IR','TAXI','RES'].includes(s)).length,ss};
 }
 function legality(c,m) {
  const errors=[],mine=c.roster,own=ids(mine.players),incoming=ids(m.incoming),outgoing=ids(m.outgoing),drops=ids(m.drops);
  if(m.kind==='hold')return {ok:!incoming.length&&!outgoing.length&&!drops.length,reasons:[]};
  if(m.kind!==c.kind)errors.push('wrong_advice_type');
  if(!incoming.length||new Set([...incoming,...outgoing,...drops]).size!==incoming.length+outgoing.length+drops.length)errors.push('invalid_package');
  const protectedIds=ids([...(mine.reserve||[]),...(mine.taxi||[]),...(mine.keepers||[]),...(mine.protected_players||[]),...(mine.locked_players||[]),...(c.protectedPids||[]),...(c.league.locked_players||[])]);
  if([...outgoing,...drops].some(p=>!own.includes(p)||protectedIds.includes(p)))errors.push('unowned_or_protected_drop');
  if([...incoming,...outgoing,...drops].some(p=>!c.players[p]||c.locks?.[p]!==false))errors.push('unknown_or_locked_player');
  if(incoming.some(p=>own.includes(p)))errors.push('already_owned');
  if(c.kind==='waiver') {
   if(outgoing.length)errors.push('waiver_outgoing_must_be_drops');
   const copies=Math.max(1,Number(c.league.settings?.player_copies)||1);
   if(incoming.some(p=>!c.eligiblePlayerIds.includes(p)||c.rosters.filter(r=>ids([...(r.players||[]),...(r.reserve||[]),...(r.taxi||[])]).includes(p)).length>=copies))errors.push('not_available');
   if(!num(m.faab)||m.faab<0||!num(c.budget.remaining)||m.faab>c.budget.remaining||m.faab<c.budget.minimum)errors.push('invalid_faab');
  } else {
   const partner=c.rosters.find(r=>String(r.roster_id)===String(m.partnerRosterId));
   if(!partner||String(partner.roster_id)===String(mine.roster_id)||incoming.some(p=>!active(partner).includes(p)))errors.push('invalid_partner_ownership');
   if(partner) {
    const blocked=ids([...(partner.keepers||[]),...(partner.protected_players||[]),...(partner.locked_players||[])]);
    if(incoming.some(p=>blocked.includes(p)))errors.push('partner_protected');
    if(active(partner).length-incoming.length+outgoing.length>rules(c).capacity)errors.push('partner_required_drop_missing');
   }
  }
  if(active(mine).length-outgoing.length-drops.length+incoming.length>rules(c).capacity)errors.push('required_drop_missing');
  // Ownership/scoring are frozen. Never ask today's NFL week about an old deadline.
  const check=root.App?.RecommendationEligibility?.check?.({...c.league,rosters:c.rosters},mine,'ownership');
  if(check&&!check.ok)errors.push('provider_rules: '+check.reason);
  const settings=c.league.settings||{};
  if(c.kind==='trade'&&(settings.disable_trades===true||Number(settings.disable_trades)===1||settings.trades_enabled===false||Number(settings.trade_deadline)>0&&c.decisionWeek>Number(settings.trade_deadline)))errors.push('trades_disabled_or_deadline_passed');
  if(c.kind==='waiver'&&(settings.waivers_enabled===false||settings.waivers_enabled===0||Number(settings.disable_waivers)===1||Number(settings.disable_adds)===1))errors.push('waivers_disabled');
  if(root.calcFantasyPts?.detailed?.({},c.league.scoring_settings).supported===false)errors.push('unsupported_scoring');
  return {ok:!errors.length,reasons:errors};
 }
 function rosterAfter(c,m){return active(c.roster).filter(p=>![...(m.outgoing||[]),...(m.drops||[])].includes(p)).concat(m.incoming||[]);}
 // Weighted bipartite matching; the weights are frozen PROJECTIONS, never actual scores.
 function lineup(c,roster,week) {
  const {slots,ss}=rules(c),missing=[],rows=[];
  ids(roster).forEach(pid=>{
   const p=week.players?.[pid],base=c.players[pid];
   if(!p||!base){missing.push(pid);return;}
   if(['bye','out','inactive','reserve'].includes(p.status))return;
   if(!num(p.projection)||p.status!=='available'){missing.push(pid);return;}
   rows.push({pid,projection:p.projection,positions:ids(base.fantasy_positions?.length?base.fantasy_positions:[base.position]).map(ss.normSlot)});
  });
  rows.sort((a,b)=>b.projection-a.projection||a.pid.localeCompare(b.pid));
  const assigned=new Map();
  const place=(i,seen)=>{
   for(let s=0;s<slots.length;s++) {
    if(seen.has(s)||!rows[i].positions.some(p=>(ss.FLEX_ALLOWED[slots[s]]||[slots[s]]).includes(p)))continue;
    seen.add(s);if(!assigned.has(s)||place(assigned.get(s),seen)){assigned.set(s,i);return true;}
   }return false;
  };
  rows.forEach((r,i)=>place(i,new Set()));
  const starters=[...assigned].sort((a,b)=>a[0]-b[0]).map(([s,i])=>({slot:slots[s],pid:rows[i].pid,projection:rows[i].projection}));
  return {starters,missing,complete:!missing.length,openSlots:slots.length-starters.length,projected:round(starters.reduce((s,p)=>s+p.projection,0))};
 }
 function normalizeMove(kind,candidate,c) {
  if(!candidate)return hold();
  const incoming=ids((candidate.incoming||[]).map(p=>typeof p==='object'?p.pid:p));
  const outgoing=ids((candidate.outgoing||[]).map(p=>typeof p==='object'?p.pid:p));
  return {kind,incoming,outgoing:kind==='trade'?outgoing:[],drops:kind==='waiver'?outgoing:ids(candidate.requiredDrops),
   partnerRosterId:candidate.partner?.rosterId??null,faab:kind==='waiver'?c.budget.assumedBid:0,
   faabAssumption:kind==='waiver'?'Assumed bid, conditional on a successful acquisition; no winning bid forecast':null,
   reason:candidate.reason||'',expectedBenefit:candidate.weekly?.delta??null,support:clone(candidate)};
 }
 function opportunities(c) {
  // Documented baseline universe: every legal single add/drop or one-for-one trade,
  // plus the exact multi-player packages issued by DHQ. Same ownership/locks/budget.
  const choices=[hold(),...(c.issued.candidates||[]).map(x=>normalizeMove(c.kind,x,c))],own=active(c.roster);
  for(const pid of c.eligiblePlayerIds) {
   if(c.kind==='waiver')for(const drop of [null,...own])choices.push({kind:'waiver',incoming:[pid],outgoing:[],drops:drop?[drop]:[],faab:c.budget.assumedBid,reason:'Simple projection alternative'});
   else {const partner=c.rosters.find(r=>active(r).includes(pid));if(partner)for(const give of own)choices.push({kind:'trade',incoming:[pid],outgoing:[give],drops:[],faab:0,partnerRosterId:partner.roster_id,reason:'Simple projection alternative'});}
  }
  const seen=new Set();return choices.filter(m=>{const k=stable([m.incoming,m.outgoing,m.drops,m.partnerRosterId]);if(seen.has(k)||!legality(c,m).ok)return false;seen.add(k);return true;});
 }
 function recommend(c,{candidateVersion=c.versions?.candidate||CANDIDATE}={}) {
  const initial=c.initialWeek,base=lineup(c,active(c.roster),initial),all=opportunities(c);
  const scored=all.map(m=>{
   const l=lineup(c,rosterAfter(c,m),initial),lost=[...(m.outgoing||[]),...(m.drops||[])].reduce((n,p)=>n+Math.max(0,initial.players[p]?.projection||0),0);
   return {...m,expectedBenefit:l.complete&&base.complete?round(l.projected-base.projected):null,lostDepthProjection:round(lost)};
  });
  const ranked=weight=>scored.filter(m=>m.expectedBenefit!=null).sort((a,b)=>(b.expectedBenefit-weight*b.lostDepthProjection)-(a.expectedBenefit-weight*a.lostDepthProjection)||a.lostDepthProjection-b.lostDepthProjection||stable(a).localeCompare(stable(b)));
  const simple=ranked(0).find(m=>m.expectedBenefit>0)||hold();
  const current=['ready','empty'].includes(c.issued.status)?normalizeMove(c.kind,c.issued.candidates?.[0],c):null;
  // The challenger is explicitly versioned. No assignment back into the production engine.
  const candidate=candidateVersion===CANDIDATE?(ranked(0.1).find(m=>m.expectedBenefit-0.1*m.lostDepthProjection>0)||hold()):null;
  return {current,candidate,hold:hold(),simple,universe:{policy:'all legal single-player alternatives plus issued packages',count:scored.length},candidateError:candidate?null:'candidate_version_unavailable'};
 }
 function sourceIssues(sources,at,maxAge) {
  const issues=[];
  if(!Array.isArray(sources)||!sources.length)return ['missing_source_timestamps'];
  for(const s of sources){if(!s.source||!Number.isFinite(time(s.observedAt)))issues.push('missing_source_timestamp');
   else if(time(s.observedAt)>time(at)||s.asOf&&time(s.asOf)>time(at))issues.push('future_input');
   else if(time(at)-time(s.observedAt)>maxAge*1000||s.cacheAgeSeconds>maxAge)issues.push('stale_input');}
  return [...new Set(issues)];
 }
 function checkContext(c) {
  if(c?.schemaVersion!==1||!['waiver','trade'].includes(c.kind)||!c.league?.league_id||!c.roster||!c.issued||!c.players||!Array.isArray(c.eligiblePlayerIds)||!Array.isArray(c.rosters)||!c.versions?.current||!c.versions?.candidate)throw Error('Invalid advice context');
  if(!['tuning','validation'].includes(c.cohort)||c.policy!==POLICY||!num(c.season)||!c.weeks?.length||c.weeks.some((w,i)=>!Number.isInteger(w.week)||w.week<1||w.week>18||i&&w.week!==c.weeks[i-1].week+1||!Number.isFinite(time(w.firstKickoffAt))||!Number.isFinite(time(w.freezeAt))||time(w.freezeAt)>=time(w.firstKickoffAt)||!Number.isFinite(time(w.endsAt))||time(w.endsAt)<=time(w.firstKickoffAt)))throw Error('Invalid preregistered policy, cohort or calendar');
  if(!Number.isFinite(time(c.capturedAt))||!Number.isFinite(time(c.deadline))||!Number.isFinite(time(c.effectiveAt))||!c.scheduleSource)throw Error('Decision timing evidence required');
  rules(c);return c;
 }
 function makeRecord(c,hash) {
  c=clone(checkContext(c));const choices=recommend(c),inputHash=hash(c),configHash=hash({scoring:c.league.scoring_settings,slots:c.league.roster_positions,settings:c.league.settings,policy:c.policy,weeks:c.weeks,cohort:c.cohort,budget:c.budget});
  const unsupported=[];
  const before=lineup(c,active(c.roster),c.initialWeek),m=choices.current;
  if(m){const after=lineup(c,rosterAfter(c,m),c.initialWeek);if(before.complete&&after.complete&&num(m.expectedBenefit)&&Math.abs(after.projected-before.projected-m.expectedBenefit)>0.15)unsupported.push('Displayed projected gain does not match the captured legal lineup calculation');}
  const body={schemaVersion:1,kind:'dhq_advice',decisionId:c.decisionId,context:c,inputHash,configHash,choices,
   versions:{current:c.versions.current,candidate:c.versions.candidate,simple:SIMPLE},engineInputs:{current:inputHash,candidate:inputHash,simple:inputHash},sourceIssues:sourceIssues(c.sources,c.capturedAt,c.maxInputAgeSeconds||3600),explanationAudit:{unsupportedClaims:unsupported,unverifiedClaims:['Manager direction and acceptance are heuristics, not observed manager intentions.']}};
  return {...body,contentHash:hash(body)};
 }
 function checkRecord(r,hash) {
  try{checkContext(r.context);const {contentHash,...body}=r;if(r.kind!=='dhq_advice'||hash(body)!==contentHash||hash(r.context)!==r.inputHash||Object.values(r.engineInputs).some(x=>x!==r.inputHash))return 'fingerprint_mismatch';
   // Do not rerun a candidate with today's implementation while grading an old
   // record. The issued recommendations, their versions and input IDs are frozen.
   const c=r.context,current=['ready','empty'].includes(c.issued.status)?normalizeMove(c.kind,c.issued.candidates?.[0],c):null;
   if(stable(current)!==stable(r.choices.current)||r.versions.current!==c.versions.current||r.versions.candidate!==c.versions.candidate)return 'recommendation_mismatch';return null;
  }catch(e){return e.message;}
 }
 function horizons(c) {return c.kind==='waiver'?[{id:'next',count:1},{id:'four',count:4}]:[{id:'four',count:4},{id:'season',count:c.weeks.length}];}
 function scoreOutcomes(c,w,outcome,line) {
  if(!line.complete)return {ready:false,reason:'missing_pre_kickoff_projection'};
  if(!outcome||outcome.season!==c.season||outcome.week!==w.week||outcome.configHash!==w.configHash)return {ready:false,reason:'missing_or_mismatched_outcomes'};
  let total=0;const contributions=[];
  for(const s of line.starters){const o=outcome.players?.[s.pid];
   if(!o||!['final','zero','bye'].includes(o.status)||!num(o.points))return {ready:false,reason:o?.status==='pending'?'pending_games':'missing_player_outcomes'};
   total+=o.points;contributions.push({...s,actual:o.points,status:o.status});}
  return {ready:true,total:round(total),starters:contributions};
 }
 function evaluate(entry,packets,{hash,now=new Date().toISOString()}={}) {
  const r=entry.record,c=r.context,errors=[],results=[];
  const invalid=checkRecord(r,hash);if(invalid)errors.push(invalid);
  const cutoff=Math.min(time(c.deadline),time(c.weeks[0].firstKickoffAt));
  if(!Number.isFinite(time(entry.receivedAt))||time(entry.receivedAt)<time(c.capturedAt)||time(entry.receivedAt)>=cutoff||time(c.capturedAt)>=cutoff)errors.push('late_or_invalid_receipt');
  if(time(entry.receivedAt)>time(now))errors.push('future_receipt');
  errors.push(...r.sourceIssues);
  const legal={};for(const [key,m]of Object.entries(r.choices))if(['current','candidate','hold','simple'].includes(key))legal[key]=m?legality(c,m):{ok:false,reasons:['missing_'+key]};
  if(!r.choices.current)errors.push('missing_current_recommendation');
  else if(!legal.current.ok)errors.push('illegal_current_recommendation');
  for(const plan of c.weeks){
   const p=packets.find(x=>x.week===plan.week),w=p?.lineup,outcome=p?.outcome;
   const row={week:plan.week,status:'pending',reason:'missing_lineup_interval',models:{}};results.push(row);
   if(!w)continue;
   const ts=time(w.observedAt),receipt=time(p.lineupReceivedAt);
   if(!Number.isFinite(ts)||!Number.isFinite(receipt)||receipt<ts||receipt>=time(plan.firstKickoffAt)||ts<time(plan.freezeAt)||ts>=time(plan.firstKickoffAt)||w.policy!==c.policy||w.configHash!==r.configHash||w.season!==c.season||w.week!==plan.week){row.reason='late_or_invalid_lineup_snapshot';continue;}
   const issues=sourceIssues(w.sources,w.observedAt,c.maxInputAgeSeconds||3600);if(issues.length){row.reason=issues.join(', ');continue;}
   if(Object.values(w.players||{}).some(p=>p.status==='available'&&(!Number.isFinite(time(p.kickoff))||time(p.kickoff)<=ts))){row.reason='player_kickoff_precedes_lineup_snapshot';continue;}
   if(outcome&&(time(outcome.observedAt)>time(now)||time(outcome.observedAt)<time(plan.firstKickoffAt)||outcome.scoringHash!==hash(c.league.scoring_settings))){row.reason='invalid_outcome_provenance';continue;}
   for(const key of ['hold','simple','current','candidate']){
    const m=r.choices[key];if(!m||!legal[key].ok){row.models[key]={ready:false,reason:legal[key].reasons.join(', ')};continue;}
    // Predeclared full-week effect: if the move is not effective at the weekly
    // freeze, hold that entire week. No post-kickoff swaps or hindsight injuries.
    const roster=time(c.effectiveAt)<=ts?rosterAfter(c,m):active(c.roster),line=lineup(c,roster,w);
    const bench=roster.filter(pid=>!line.starters.some(s=>s.pid===pid)),benchKnown=bench.every(pid=>['zero','final','bye'].includes(outcome?.players?.[pid]?.status));
    row.models[key]={...scoreOutcomes(c,w,outcome,line),lineup:line,moveEffective:time(c.effectiveAt)<=ts,benchPoints:benchKnown?round(bench.reduce((sum,pid)=>sum+(outcome.players[pid].points||0),0)):null};
   }
   row.status=row.models.current?.ready&&row.models.hold?.ready&&row.models.simple?.ready?'complete':'pending';
   row.reason=row.status==='complete'?null:Object.values(row.models).find(x=>!x.ready)?.reason;
   if(row.status==='complete')for(const key of ['current','candidate'])if(row.models[key]?.ready){row.models[key].versusHold=round(row.models[key].total-row.models.hold.total);row.models[key].versusSimple=round(row.models[key].total-row.models.simple.total);}
  }
  return {decisionId:r.decisionId,eligible:!errors.length,exclusions:[...new Set(errors)],legality:legal,weeks:results,
   horizons:horizons(c).map(h=>{
    const weeks=results.slice(0,h.count),complete=weeks.length===h.count&&weeks.every(w=>w.status==='complete');
    const paired=complete&&weeks.every(w=>w.models.candidate?.ready),sum=(key,metric)=>round(weeks.filter(w=>w.models[key]?.ready&&w.models.hold?.ready&&w.models.simple?.ready).reduce((s,w)=>s+(w.models[key][metric]||0),0));
    return {...h,status:errors.length?'excluded':complete?'complete':'partial',completedWeeks:weeks.filter(w=>w.status==='complete').length,requiredWeeks:h.count,
     costlyDropPoints:weeks.filter(w=>w.status==='complete').flatMap(w=>w.models.hold.starters.filter(s=>(r.choices.current?.drops||[]).includes(s.pid))).reduce((s,x)=>s+x.actual,0),
     current:complete?{versusHold:sum('current','versusHold'),versusSimple:sum('current','versusSimple')}:null,
     partialCurrent:!complete?{versusHold:sum('current','versusHold'),versusSimple:sum('current','versusSimple')}:null,
     candidate:paired?{versusHold:sum('candidate','versusHold'),versusSimple:sum('candidate','versusSimple')}:null,
     pairedDelta:paired?round(sum('candidate','versusHold')-sum('current','versusHold')):null};}),
   costs:{faabAssumed:r.choices.current?.faab??null,lostPlayers:ids([...(r.choices.current?.drops||[]),...(r.choices.current?.outgoing||[])]),
    costlyDropPoints:results.filter(w=>w.status==='complete').flatMap(w=>w.models.hold.starters.filter(s=>(r.choices.current?.drops||[]).includes(s.pid))).reduce((s,x)=>s+x.actual,0)},
   feasibility:{conditionalOnly:true,offerSent:'unknown',accepted:'unknown',completedAcquisition:false,causalWins:null}};
 }
 // Connected components link any repeated player/week exposure, even across leagues.
 // This conservative interval has no independence claim at the decision/view level.
 function uncertainty(rows) {
  const parent=rows.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i])),seen=new Map();
  rows.forEach((r,i)=>r.exposures.forEach(key=>{if(seen.has(key))parent[find(i)]=find(seen.get(key));else seen.set(key,i);}));
  const groups=new Map();rows.forEach((r,i)=>{const k=find(i);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r.value);});
  if(groups.size<8)return {clusters:groups.size,interval:null,conclusion:'insufficient evidence',method:'player/week overlap components; fewer than 8 independent components'};
  let seed=7411;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},g=[...groups.values()],samples=[];
  for(let k=0;k<1000;k++){const sample=[];for(let i=0;i<g.length;i++)sample.push(...g[Math.floor(random()*g.length)]);samples.push(sample.reduce((a,b)=>a+b,0)/sample.length);}
  samples.sort((a,b)=>a-b);return {clusters:groups.size,interval:[samples[25],samples[974]].map(round),conclusion:'manual review required',method:'95% component cluster bootstrap; descriptive, not causal'};
 }
 function summarize(entries,evaluations,coverage=[]) {
  const unique=[...new Map(entries.map(e=>[e.record.decisionId,e])).values()],groups=new Map(),lookup=new Map(evaluations.map(e=>[e.decisionId,e]));
  for(const entry of unique){const r=entry.record,c=r.context,e=lookup.get(r.decisionId);if(!e)continue;
   for(const h of e.horizons){const key=[c.kind,h.id,c.format,c.cohort,r.versions.current,r.versions.candidate].join('|');if(!groups.has(key))groups.set(key,{key,kind:c.kind,horizon:h.id,format:c.format,cohort:c.cohort,versions:r.versions,rows:[],pending:0,excluded:0,missingCandidate:0});const g=groups.get(key);
    if(!r.choices.candidate||h.status==='complete'&&!h.candidate)g.missingCandidate++;
    if(h.status==='excluded')g.excluded++;else if(h.status!=='complete')g.pending++;else {
     const weeks=c.weeks.slice(0,h.count),pids=ids([...(c.roster.players||[]),...['current','candidate','simple'].flatMap(k=>r.choices[k]?.incoming||[])]);
     g.rows.push({id:r.decisionId,value:h.current.versusHold,simple:h.current.versusSimple,paired:h.pairedDelta,faab:e.costs.faabAssumed,costlyDropPoints:h.costlyDropPoints,exposures:weeks.flatMap(w=>pids.map(p=>`${c.season}:${w.week}:${p}`)),weeks:weeks.map(w=>`${c.season}:${w.week}`),pids,league:c.league.league_id});
    }
   }
  }
  return {verdict:'Insufficient evidence. Promotion is manual; collection duration is not evidence of improvement.',milestones:{recordsPresent:unique.length>0,completedHorizonGradesPresent:evaluations.some(e=>e.eligible&&e.horizons.some(h=>h.status==='complete')),deployment:'Not inferred from an evidence export'},
   coverage:{expected:coverage.length,captured:unique.length,missing:coverage.filter(x=>['missing','failed'].includes(x.status)).length,failed:coverage.filter(x=>x.status==='failed').length,unsupportedExplanations:unique.filter(e=>e.record.explanationAudit?.unsupportedClaims?.length).length,intervals:coverage},
   groups:[...groups.values()].map(g=>{const rows=g.rows,n=rows.length,mean=k=>n?round(rows.reduce((s,r)=>s+(r[k]||0),0)/n):null,paired=rows.filter(r=>num(r.paired));return {...g,rows:undefined,evaluated:n,averageVsHold:mean('value'),averageVsSimple:mean('simple'),helped:n?rows.filter(r=>r.value>0.01).length/n:null,tied:n?rows.filter(r=>Math.abs(r.value)<=0.01).length/n:null,hurt:n?rows.filter(r=>r.value< -0.01).length/n:null,
    largestGain:n?Math.max(0,...rows.map(r=>r.value)):null,largestLoss:n?Math.min(0,...rows.map(r=>r.value)):null,faabAssumed:rows.reduce((s,r)=>s+(r.faab||0),0),costlyDropPoints:rows.reduce((s,r)=>s+r.costlyDropPoints,0),
    distinct:{decisions:n,weeks:new Set(rows.flatMap(r=>r.weeks)).size,players:new Set(rows.flatMap(r=>r.pids)).size,leagues:new Set(rows.map(r=>r.league)).size},
    uncertainty:uncertainty(rows),paired:{n:paired.length,mean:paired.length?round(paired.reduce((s,r)=>s+r.paired,0)/paired.length):null,uncertainty:uncertainty(paired.map(r=>({...r,value:r.paired})))},worst:rows.slice().sort((a,b)=>a.value-b.value).slice(0,5).map(r=>({decisionId:r.id,points:r.value}))};})};
 }
 function probabilityScore(predictions,events){
  const accepted=[],missing=[];for(const p of predictions||[]){const e=(events||[]).find(e=>e.eventId===p.eventId&&e.horizon===p.horizon);
   if(!p.eventId||!p.horizon||p.kind!=='probability'||!num(p.probability)||p.probability<0||p.probability>1||!e||typeof e.occurred!=='boolean'||![p.receivedAt,p.deadline,e.observedAt].every(t=>Number.isFinite(time(t)))||time(p.receivedAt)>=time(p.deadline)||time(e.observedAt)<=time(p.deadline)){missing.push(p.eventId||null);continue;}
   const y=+e.occurred,prob=Math.min(1-1e-15,Math.max(1e-15,p.probability));accepted.push({eventId:p.eventId,p:p.probability,y,brier:(p.probability-y)**2,logLoss:-y*Math.log(prob)-(1-y)*Math.log(1-prob)});}
  return {n:accepted.length,missing,brier:accepted.length?accepted.reduce((s,r)=>s+r.brier,0)/accepted.length:null,logLoss:accepted.length?accepted.reduce((s,r)=>s+r.logLoss,0)/accepted.length:null,bins:Array.from({length:10},(_,i)=>{const rows=accepted.filter(r=>Math.min(9,Math.floor(r.p*10))===i);return {from:i/10,to:(i+1)/10,n:rows.length,observed:rows.length?rows.reduce((s,r)=>s+r.y,0)/rows.length:null};})};
 }
 const api={VERSION,POLICY,CANDIDATE,SIMPLE,stable,clone,active,rules,legality,lineup,rosterAfter,normalizeMove,opportunities,recommend,sourceIssues,makeRecord,checkRecord,evaluate,summarize,uncertainty,probabilityScore};
 root.App=root.App||{};root.App.AdviceScorecard=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
