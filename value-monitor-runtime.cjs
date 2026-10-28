'use strict';
// Headless host for the SAME browser engines, not a second valuation formula.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const H=require('./value-history.js');
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:H.stable(x)).digest('hex');
const MODULES=['constants.js','utils.js','sleeper-api.js','dhq-core.js','pick-value-model.js','intelligence-context.js','rookie-data.js','dhq-providers.js','dhq-engine.js','startsit-engine.js','weekly-proj.js','nfl-context.js','redraft-market.js','player-value.js'];
function createHost({state,fetcher,sourceDir=__dirname,files={},now=Date.now()}) {
 class Clock extends Date {constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const storage=new Map(),messages=[];
 const b={App:{},S:state,Date:Clock,performance,URL,URLSearchParams,TextEncoder,AbortController,Promise,Map,Set,setTimeout,clearTimeout,
  crypto:crypto.webcrypto,console:{log(){},warn(...args){messages.push(args.map(String).join(' '));}},fetch:fetcher,
  location:{hostname:'localhost'},isSandbox:()=>true,localStorage:{getItem:()=>null,setItem(){}},
  DhqStorage:{get:(k,d)=>storage.get(k)??d,set:(k,v)=>storage.set(k,v)},STORAGE_KEYS:{HIST_KEY:id=>'history:'+id}};
 b.window=b;b.globalThis=b;b.App.S=state;b.App.LeagueSkin={getCurrent:()=>({type:state.format})};
 vm.createContext(b);let source='';
 for(const name of MODULES){const code=fs.readFileSync(files[name]||path.join(sourceDir,name),'utf8');source+=name+code;vm.runInContext(code,b,{filename:name});}
 if(files['availability-forecast.js']){const s=fs.readFileSync(files['availability-forecast.js'],'utf8');source+=s;vm.runInContext(s,b);}
 return {b,messages,engineVersion:hash(source)};
}
async function calculate({run,fetcher=fetch,sourceDir=__dirname,files={},now=Date.now(),cbsSnapshot=null,marketWeights,dataDir=sourceDir}) {
 const sources={},failures=[],inflight=new Map();
 const tracked=async(url,opts={})=>{
  const key=String(url);if(inflight.has(key))return (await inflight.get(key)).clone();
  const job=(async()=>{let response;
   try{
    if(key.startsWith('draft-war-room/')){const body=fs.readFileSync(path.resolve(dataDir,key));response=new Response(body);}
    else {const u=key.startsWith('/api/nfl-scoreboard')?new URL(key,'http://fixture'):null;const actual=u?'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates='+u.searchParams.get('season')+'&week='+u.searchParams.get('week')+'&seasontype='+u.searchParams.get('seasontype'):key;response=await fetcher(actual,{...opts,cache:'no-store',signal:AbortSignal.timeout(30000)});}
    if(!response.ok)throw Error('HTTP '+response.status);
    const raw=await response.clone().text();
    const isStats=/\/(stats|projections)\/nfl\/regular\//.test(key),isPlayers=key.endsWith('/players/nfl');
    let parsed=null;
    if(isStats||isPlayers||key.includes('fantasycalc.com')){
     parsed=JSON.parse(raw);
     if(isStats||isPlayers){if(!parsed||Array.isArray(parsed)||typeof parsed!=='object'||Object.values(parsed).some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw Error('Invalid player/stat input structure');}
     else if(!Array.isArray(parsed)||parsed.some(x=>!x?.player||typeof x.value!=='number'||!Number.isFinite(x.value)||x.value<0))throw Error('Invalid market input structure');
    }
    // HTTP Date is response time. Last-Modified is retained only as provider-reported metadata.
    const modified=response.headers.get('last-modified'),providerAsOf=modified&&Number.isFinite(Date.parse(modified))?new Date(modified).toISOString():null;
    const ageHeader=response.headers.get('age'),age=ageHeader==null?null:Number(ageHeader);
    const year=Number(key.match(/\/stats\/nfl\/regular\/(\d{4})/)?.[1]);
    const freshnessWindowSeconds=year&&year<Number(run.season)?30*86400:900;
    sources[key]={hash:hash(raw),fetchedAt:new Date().toISOString(),providerAsOf,cacheAgeSeconds:Number.isFinite(age)?age:null,freshnessWindowSeconds,stale:Number.isFinite(age)&&age>freshnessWindowSeconds,records:parsed?Object.keys(parsed).length:null,kind:key.startsWith('draft-war-room/')?'bundled reference':'provider retrieval'};
    return response;
   }catch(e){failures.push({url:key,error:e.message});throw e;}
  })();inflight.set(key,job);return (await job).clone();
 };
 const get=async p=>(await tracked('https://api.sleeper.app/v1'+p)).json();
 const [league,rosters,players,nflState]=await Promise.all([get('/league/'+run.league_id),get('/league/'+run.league_id+'/rosters'),get('/players/nfl'),get('/state/nfl')]);
 if(String(league.season)!==String(run.season)||String(nflState.season)!==String(run.season))throw Error('Monitor season no longer current; no historical reconstruction');
 if(!Array.isArray(rosters)||rosters.length!==Number(league.total_rosters)||!Object.keys(players||{}).length)throw Error('Incomplete league rosters/player directory');
 if(new Set(rosters.map(r=>r.roster_id)).size!==rosters.length||rosters.some(r=>!Array.isArray(r.players)))throw Error('Invalid roster identities/memberships');
 const type=league.settings?.type==null?null:Number(league.settings.type)===2?'dynasty':Number(league.settings?.type)===0?'redraft':null;
 if(type!==run.value_type)throw Error('Selected format does not match league configuration');
 const state={currentLeagueId:run.league_id,season:Number(run.season),leagues:[league],rosters,players,nflState,format:type,platform:'sleeper'};
 const host=createHost({state,fetcher:tracked,sourceDir,files,now}),b=host.b;
 let board,values,meta={};
 if(type==='dynasty'){
  await b.App.loadRookieProspects({force:true});await b.App.loadLeagueIntel();
  if(!b.App.LI_LOADED||b.App.LI.sourceLeagueId!==run.league_id)throw Error('Canonical dynasty calculation failed: '+host.messages.join(';'));
  values=b.App.LI.playerScores;meta=b.App.LI.playerMeta;
 }else{
  const [stats,prior,projections]=await Promise.all([get('/stats/nfl/regular/'+run.season),get('/stats/nfl/regular/'+(Number(run.season)-1)),get('/projections/nfl/regular/'+run.season)]);
  Object.assign(state,{statsData:stats,priorData:prior,projectionsData:projections});
  await b.App.NflContext.loadCurrent(run.season);
  const request=b.App.Intelligence.buildFantasyCalcRequest({league,rosters,isDynasty:false});
  let market={};try{const rows=await(await tracked(request.url)).json();for(const x of rows)if(x.player?.sleeperId&&Number.isFinite(x.value))market[x.player.sleeperId]=x.value;}catch(_){/* explicit source failure below */}
  if(cbsSnapshot){const valid=await b.App.RedraftMarket.verify(cbsSnapshot,{season:run.season,week:Number(nflState.week),now});if(!valid)throw Error('CBS snapshot integrity failed');}
  board=b.App.PlayerValue.computePrices({league,leagueId:run.league_id,week:Number(nflState.week)||1,playersData:players,statsData:stats,priorData:prior,projectionsData:projections,marketRedraft:market,cbsSnapshot,marketWeights,now,skin:{type:'redraft'}});
  values=board?.values||{};
 }
 const calculatedAt=new Date().toISOString(),fetchedAt=calculatedAt;
 const settingsFingerprint=hash({scoring:league.scoring_settings,roster:league.roster_positions,settings:league.settings,totalTeams:league.total_rosters,marketWeights:marketWeights||null});
 const sourceFingerprint=hash({inputs:Object.fromEntries(Object.entries(sources).sort().map(([u,s])=>[u,s.hash])),cbsVersion:cbsSnapshot?.id||null});
 const stale=Object.values(sources).some(s=>s.stale),incomplete=failures.length>0;
 return {host,league,rows:run.player_ids.map(pid=>{
  const value=values[pid]??null;
  return H.normalize({leagueId:run.league_id,playerId:pid,season:run.season,week:Number(nflState.week)||0,ts:fetchedAt,calculatedAt,value,valueType:type,source:'monitor',captureKey:'monitor:'+run.id+':'+run.capture_index,runId:run.id,captureIndex:run.capture_index,
   rosterIds:rosters.filter(r=>(r.players||[]).includes(pid)).map(r=>r.roster_id),status:value==null?'missing':stale?'stale':incomplete?'error':'ok',
   provenance:{captureStartedAt:new Date(now).toISOString(),engineVersion:host.engineVersion,buildVersion:run.buildVersion||null,settingsFingerprint,sourceFingerprint,sources,failures,engineMessages:host.messages,providerCurrency:'Provider as-of unavailable unless explicitly supplied; fetchedAt is retrieval only',fallback:type==='redraft'?(!board?'No seasonal board':board.availability?.[pid]?.unresolvedWeeks?.length?'Unresolved availability':null):meta[pid]?.source||null,horizon:board?.horizon||null,marketVersion:board?.marketBasis?.cbs?.version||null,seasonalBasis:type==='redraft'?{projectionAvailable:!!state.projectionsData?.[pid],currentStatsAvailable:!!state.statsData?.[pid],priorStatsAvailable:!!state.priorData?.[pid]}:null,missingReason:value==null?'Canonical engine returned no supported value':null}});
 })};
}
module.exports={calculate,createHost,MODULES,hash};
