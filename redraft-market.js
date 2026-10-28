/* global module */
/* Canonical redraft market input contract. CBS prices are never projections. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.App = root.App || {}; root.App.RedraftMarket = api; }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';
    const VERSION = 'cbs-chart-v1', DAY = 86400000, MAX_AGE = 10 * DAY;
    const COLUMNS = { QB: ['1QB-4', '1QB-6', '2QB'], RB: ['non', '0.5', 'PPR'], WR: ['non', '0.5', 'PPR'], TE: ['non', '0.5', 'PPR'] };
    const MIN_ROWS = { QB: 12, RB: 25, WR: 30, TE: 10 };
    const DEFAULT_WEIGHTS = Object.freeze({ budget: 0.25, cbs: 0.15, fantasyCalc: 0.10 });
    const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').replace(/\s+/g, ' ');
    const team = value => ({ JAX: 'JAC', LA: 'LAR', WSH: 'WAS', OAK: 'LV', SD: 'LAC', STL: 'LAR' }[String(value).toUpperCase()] || String(value || '').toUpperCase());
    function sourceUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'www.cbssports.com' && u.pathname.startsWith('/fantasy/football/news/') && !u.username && !u.password; } catch (_) { return false; } }
    const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    function validateChart(chart, { season, week, now = Date.now() } = {}) {
        const errors = [];
        if (!chart || !sourceUrl(chart.sourceUrl)) errors.push('A canonical CBS football article URL is required.');
        if (!Number.isInteger(chart?.season) || chart.season !== Number(season)) errors.push('Chart season does not match the current NFL season.');
        if (!Number.isInteger(chart?.week) || chart.week < 1 || chart.week > 18 || chart.week > Number(week)) errors.push('Chart week is invalid or in the future.');
        for (const field of ['publishedAt', 'updatedAt']) if (chart?.[field] != null && (!date(chart[field]) || Date.parse(chart[field]) > now + 300000)) errors.push('Invalid ' + field + '.');
        if (chart?.publishedAt && (new Date(chart.publishedAt).getUTCFullYear() < chart.season || new Date(chart.publishedAt).getUTCFullYear() > chart.season + 1)) errors.push('Publication year contradicts chart season.');
        if (chart?.updatedAt && chart?.publishedAt && Date.parse(chart.updatedAt) < Date.parse(chart.publishedAt)) errors.push('Update predates publication.');
        if (!chart?.attribution || !Array.isArray(chart?.rows)) errors.push('Missing attribution or rows.');
        const counts = {}, seen = new Set();
        for (const pos of Object.keys(COLUMNS)) if (JSON.stringify(chart?.columns?.[pos]) !== JSON.stringify(COLUMNS[pos])) errors.push('Unexpected ' + pos + ' columns; parser review required.');
        for (const row of chart?.rows || []) {
            const cols = COLUMNS[row.position], key = normalize(row.name) + '|' + row.position + '|' + team(row.team);
            if (!cols || !normalize(row.name) || !/^[A-Z]{2,3}$/.test(team(row.team))) { errors.push('Invalid player identity.'); continue; }
            if (seen.has(key)) errors.push('Duplicate player row: ' + row.name);
            seen.add(key); counts[row.position] = (counts[row.position] || 0) + 1;
            if (!row.values || JSON.stringify(Object.keys(row.values).sort()) !== JSON.stringify([...cols].sort())) errors.push('Missing or unexpected value columns: ' + row.name);
            for (const col of cols) if (row.values?.[col] !== null && (typeof row.values?.[col] !== 'number' || !Number.isFinite(row.values[col]) || row.values[col] < 0 || row.values[col] > 200)) errors.push('Invalid numeric value: ' + row.name);
            if (cols.every(c => row.values?.[c] == null)) errors.push('Entirely empty player row: ' + row.name);
        }
        for (const pos of Object.keys(MIN_ROWS)) if ((counts[pos] || 0) < MIN_ROWS[pos]) errors.push('Insufficient ' + pos + ' coverage.');
        if ((chart?.rows?.length || 0) > 400) errors.push('Unexpected row count.');
        return { valid: errors.length === 0, errors, counts };
    }
    function mapRows(rows, players, aliases = {}) {
        const catalog = Object.entries(players || {}).map(([id,p]) => ({ id, name: normalize(p.full_name || [p.first_name,p.last_name].filter(Boolean).join(' ')), pos: p.position, team: team(p.team) }));
        return rows.map(row => {
            const name = normalize(row.name), alias = aliases[name + '|' + row.position];
            let matches = catalog.filter(p => p.pos === row.position && (alias ? p.id === String(alias) : p.name === name));
            let method = alias ? 'alias' : 'exact';
            if (!matches.length && !alias && /^[a-z] /.test(name)) {
                const [initial,...rest] = name.split(' ');
                matches = catalog.filter(p => p.pos === row.position && p.name[0] === initial && p.name.split(' ').slice(1).join(' ') === rest.join(' '));
                method = 'initial';
            }
            // Team supports disambiguation; a unique full-name match survives a team change.
            if (matches.length > 1) { const sameTeam = matches.filter(p => p.team === team(row.team)); if (sameTeam.length) matches = sameTeam; }
            // Initials with a team mismatch are not enough identity evidence.
            if (method === 'initial') matches = matches.filter(p => p.team === team(row.team));
            const match = matches.length === 1 ? matches[0] : null;
            return { ...row, playerId: match?.id || null, mappingStatus: match ? 'mapped' : matches.length > 1 ? 'ambiguous' : 'unmapped', mappingMethod: match ? method : null, teamMismatch: !!match && match.team !== team(row.team), candidates: match ? [] : matches.map(p => p.id) };
        });
    }
    function validateSnapshot(snapshot, context) {
        const validation = validateChart(snapshot?.chart, context), errors = [...validation.errors];
        if (snapshot?.schemaVersion !== 1 || snapshot?.parserVersion !== VERSION || !/^[a-f0-9]{64}$/.test(snapshot?.contentHash || '') || !/^[a-f0-9]{64}$/.test(snapshot?.id || '')) errors.push('Invalid snapshot version/hash.');
        if (!date(snapshot?.firstImportedAt) || Date.parse(snapshot.firstImportedAt) > Date.parse(snapshot?.fetchedAt)) errors.push('Invalid first import time.');
        if (!date(snapshot?.fetchedAt) || Date.parse(snapshot.fetchedAt) > (context?.now ?? Date.now()) + 300000) errors.push('Invalid fetch time.');
        const ids = new Set(); let mapped = 0;
        for (const row of snapshot?.chart?.rows || []) {
            if (!['mapped','unmapped','ambiguous'].includes(row.mappingStatus)) errors.push('Missing mapping status.');
            if (row.mappingStatus === 'mapped') { if (!row.playerId || ids.has(row.playerId)) errors.push('Duplicate/missing stable player ID.'); ids.add(row.playerId); mapped++; }
            else if (row.playerId !== null) errors.push('Unresolved mapping cannot have a player ID.');
        }
        if (mapped / Math.max(1, snapshot?.chart?.rows?.length || 0) < 0.90) errors.push('Less than 90% of chart players map unambiguously.');
        return { valid: !errors.length, errors, mapped, total: snapshot?.chart?.rows?.length || 0 };
    }
    function compare(candidate, active) {
        if (!active) return { allowed: true, warnings: [] };
        const a = active.chart, b = candidate.chart, warnings = [];
        if (b.season < a.season || (b.season === a.season && b.week < a.week)) return { allowed: false, warnings: ['Older chart cannot replace the active snapshot.'] };
        if (b.season === a.season && b.week === a.week) {
            if (candidate.contentHash !== active.contentHash && Date.parse(candidate.fetchedAt) < Date.parse(active.fetchedAt)) return { allowed: false, warnings: ['An earlier observed same-week snapshot cannot replace the active import.'] };
            const at = Date.parse(a.updatedAt || a.publishedAt || ''), bt = Date.parse(b.updatedAt || b.publishedAt || '');
            if ((Number.isFinite(at) && (!Number.isFinite(bt) || bt < at)) || (b.sourceUrl !== a.sourceUrl && (!Number.isFinite(bt) || bt <= at))) return { allowed: false, warnings: ['Same-week chart chronology is older or ambiguous.'] };
        }
        if (b.season === a.season) {
            if (b.rows.length < a.rows.length * 0.75) warnings.push('Chart lost more than 25% of its rows.');
            const old = new Map(a.rows.filter(r=>r.playerId).map(r=>[r.playerId,r])); let compared=0, jumps=0;
            for (const row of b.rows) { const prev=old.get(row.playerId); if (!prev) continue; for (const col of COLUMNS[row.position]) { const x=prev.values[col], y=row.values[col]; if (x != null && y != null) { compared++; if (Math.abs(x-y)>Math.max(5,x*0.5)) jumps++; } } }
            if (compared >= 30 && jumps/compared > 0.30) warnings.push('More than 30% of comparable values changed unexpectedly.');
        }
        return { allowed: true, warnings };
    }
    function format(league) {
        const sc=league?.scoring_settings || {}, rp=(league?.roster_positions || []).map(s=>String(s).toUpperCase()), warnings=[];
        const ppr=Number(sc.rec ?? 0), qbs=rp.filter(p=>p==='QB').length, sf=rp.some(p=>['SUPER_FLEX','QB_FLEX','OP','SFLEX'].includes(p));
        if (![0,0.5,1].includes(ppr) || ![4,6].includes(Number(sc.pass_td)) || qbs<1 || qbs>2 || (qbs>=2 && sf)) return { supported:false, warnings:['CBS has no compatible PPR/passing-TD/QB-slot column.'] };
        const standard={pass_yd:0.04,pass_td:Number(sc.pass_td),pass_int:-2,rush_yd:0.1,rush_td:6,rec:ppr,rec_yd:0.1,rec_td:6,fum_lost:-2,pass_2pt:2,rush_2pt:2,rec_2pt:2};
        const defense=/^(?:fg|xp|def|idp|pts_allow|yds_allow|yd_allow|tkl|sack|int$|fum_rec|ff$|safe|blk_kick|st_)/;
        const unusual=Object.entries(sc).filter(([key,value])=>Number(value)!==0 && !(key in standard) && !defense.test(key)).map(([k])=>k);
        for (const key of ['pass_yd','rush_yd','rush_td','rec_yd','rec_td']) if (Number(sc[key] ?? 0)!==standard[key]) unusual.push(key);
        for (const key of ['pass_int','fum_lost','pass_2pt','rush_2pt','rec_2pt']) if (key in sc && Number(sc[key])!==standard[key]) unusual.push(key);
        if (unusual.length) return { supported:false, warnings:['CBS does not price these custom scoring rules: '+[...new Set(unusual)].join(', ')] };
        if (sf) warnings.push('Superflex uses the published 2QB column approximately.');
        if (qbs>=2 || sf) warnings.push('CBS publishes one 2QB column; passing-TD variants are not separated.');
        if (Number(league.total_rosters)!==12) warnings.push('Published chart has no league-size calibration.');
        const columns={QB:qbs>=2||sf?'2QB':Number(sc.pass_td)===4?'1QB-4':'1QB-6',RB:ppr===1?'PPR':ppr===0.5?'0.5':'non'}; columns.WR=columns.RB;columns.TE=columns.RB;
        return { supported:true, approximate:!!warnings.length, warnings, columns, key:JSON.stringify([columns,sc,rp,league.total_rosters]) };
    }
    function input(snapshot, league, week, now=Date.now()) {
        const selected=format(league), chart=snapshot?.chart, basis=chart?.publishedAt || snapshot?.firstImportedAt || snapshot?.fetchedAt, ageMs=basis?now-Date.parse(basis):null;
        const status=!chart?'missing':chart.season!==Number(league.season)?'wrong-season':chart.week>week?'future':week-chart.week>1||ageMs>MAX_AGE?'stale':chart.week===week?'current-week':'previous-week';
        const active=selected.supported && ['current-week','previous-week'].includes(status), values={}, entries={};
        const maximum=Math.max(0,...(chart?.rows || []).map(row=>row.values[selected.columns?.[row.position]]).filter(v=>typeof v==='number' && Number.isFinite(v)));
        for (const row of chart?.rows || []) if (row.playerId && row.mappingStatus==='mapped') {
            const column=selected.columns?.[row.position], value=column?row.values[column]:null;
            entries[row.playerId]={original:value??null,column:column||null,mappingStatus:row.mappingStatus,teamMismatch:row.teamMismatch};
            if (active && value!=null) values[row.playerId]=value;
        }
        return { version:snapshot?.id || 'none', status, active, maximum, ageMs, ageBasis:chart?.publishedAt ? 'publication' : 'first import', format:selected, values, entries, sourceUrl:chart?.sourceUrl || null, publishedAt:chart?.publishedAt || null, updatedAt:chart?.updatedAt || null, fetchedAt:snapshot?.fetchedAt || null, season:chart?.season, week:chart?.week };
    }
    // Both sources normalize to the *same unblended* board ceiling. Missing
    // source weight stays with the engine; it is never transferred or stacked.
    function blend(base, { cbs, fantasyCalc, weights=DEFAULT_WEIGHTS }={}) {
        const finite = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
        const budget=Math.min(0.25,finite(weights.budget)), requested={cbs:finite(weights.cbs),fantasyCalc:finite(weights.fantasyCalc)};
        const total=requested.cbs+requested.fantasyCalc, factor=total>budget?budget/total:1;
        const maps={cbs:cbs?.active?cbs.values:null,fantasyCalc}, maxima={}, ceiling=Math.max(0,...Object.values(base)), values={}, details={};
        for (const source of Object.keys(maps)) maxima[source]=Math.max(0,...Object.values(maps[source]||{}).filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0));
        if (cbs?.active && Number.isFinite(cbs.maximum) && cbs.maximum > 0) maxima.cbs=cbs.maximum;
        for (const [pid,engine] of Object.entries(base)) {
            let result=engine, used=0; const sources={};
            if (engine === 0) { values[pid]=0; details[pid]={engine:0,engineWeight:1,sources,value:0,reason:'Zero supported seasonal value; market prices cannot create future production.'}; continue; }
            for (const source of Object.keys(maps)) {
                const raw=maps[source]?.[pid], weight=requested[source]*factor;
                if (typeof raw!=='number'||!Number.isFinite(raw)||raw<0||!maxima[source]||!weight) continue;
                const normalized=raw/maxima[source]*ceiling;
                result+=(normalized-engine)*weight; used+=weight; sources[source]={raw,normalized,weight,contribution:normalized*weight};
            }
            values[pid]=result;details[pid]={engine,engineWeight:1-used,sources,value:result};
        }
        return { values, details, weights:{budget,cbs:requested.cbs*factor,fantasyCalc:requested.fantasyCalc*factor}, ceiling };
    }
    async function hash(value) {
        const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
        return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), b=>b.toString(16).padStart(2,'0')).join('');
    }
    async function createSnapshot(chart, players, { season, week, now=Date.now(), aliases={}, mode='manual', permissionReference=null, previous=null }={}) {
        const validation=validateChart(chart,{season,week,now});
        if (!validation.valid) throw new Error(validation.errors.join(' '));
        // Never trust IDs supplied by an import. Re-map against the current catalog.
        const clean={sourceUrl:chart.sourceUrl,attribution:chart.attribution,season:chart.season,week:chart.week,publishedAt:chart.publishedAt??null,updatedAt:chart.updatedAt??null,columns:chart.columns,rows:chart.rows.map(({name,position,team,values})=>({name,position,team,values}))};
        const mapped=mapRows(clean.rows,players,aliases);
        const body={schemaVersion:1,parserVersion:VERSION,contentHash:await hash(clean),fetchedAt:new Date(now).toISOString(),firstImportedAt:previous?.chart?.season===clean.season && previous?.chart?.week===clean.week ? (previous.firstImportedAt || previous.fetchedAt) : new Date(now).toISOString(),mode,permissionReference,chart:{...clean,rows:mapped},mappingHash:await hash(mapped.map(r=>[r.playerId,r.mappingStatus,r.teamMismatch,r.candidates]))};
        const snapshot={...body,id:await hash(body)}, result=validateSnapshot(snapshot,{season,week,now});
        if (!result.valid) throw new Error(result.errors.join(' '));
        return snapshot;
    }
    async function verify(snapshot, context) {
        const result=validateSnapshot(snapshot,context);
        if (!result.valid) throw new Error(result.errors.join(' '));
        const {id,...body}=snapshot;
        if (await hash(body)!==id) throw new Error('Snapshot integrity hash does not match.');
        return snapshot;
    }
    return { hash, createSnapshot, verify, VERSION, COLUMNS, MIN_ROWS, MAX_AGE, DEFAULT_WEIGHTS, normalize, team, sourceUrl, validateChart, mapRows, validateSnapshot, compare, format, input, blend };
});
