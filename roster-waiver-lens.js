/* global module */
// A read-only view of real, legal waiver alternatives. No provider writes.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const number = value => value === null || value === undefined || value === '' || typeof value === 'boolean'
        ? null : Number.isFinite(Number(value)) ? Number(value) : null;
    const idOf = league => String(league?.league_id || league?.id || '');
    const own = (map, key) => Object.prototype.hasOwnProperty.call(map || {}, key);
    const basisOf = args => App.RosterLensBasis?.normalize?.(args.basis) || (['average','idp-average'].includes(args.basis) ? args.basis:'projected');
    const ids = roster => [...new Set([...(roster?.players || []), ...(roster?.reserve || []), ...(roster?.taxi || [])].filter(x => x != null && String(x) !== '0').map(String))];
    const windowOf = args => App.RosterLensBasis?.normalizeWindow?.(args.averageWindow) || 'season';
    const norm = pos => App.normPos?.(pos) || App.RosterLensBasis?.position?.(pos) || ({ DST:'DEF', 'D/ST':'DEF', DE:'DL', DT:'DL', NT:'DL', IDL:'DL', EDGE:'DL', CB:'DB', S:'DB', SS:'DB', FS:'DB', OLB:'LB', ILB:'LB', MLB:'LB' }[pos] || pos);
    const typeOf = args => args.skin?.type || App.LeagueSkin?.build?.({league:args.league})?.type
        || ({0:'redraft',1:'keeper',2:'dynasty',3:'chopped'})[args.league?.settings?.type] || 'unknown';
    function account(args) {
        const authenticated=args.accountId || (App.OD || root.OD)?.getCurrentUserId?.();
        if (authenticated) return 'account:'+String(authenticated);
        const platform=args.league?._platform || root.S?.platform || 'sleeper';
        return platform === 'sleeper' && (args.userId || root.S?.user?.user_id) ? 'sleeper:'+String(args.userId || root.S.user.user_id) : '';
    }
    function scope(args) {
        const league=args.league || {}, owner=account(args);
        const platform=league._platform || (league._mfl ? 'mfl' : league._espn ? 'espn' : league._yahoo ? 'yahoo' : root.S?.platform || 'sleeper');
        return owner && idOf(league) && league.season ? [owner,platform,idOf(league),league.season,basisOf(args),...(basisOf(args) === 'projected' ? []:[windowOf(args)])].map(encodeURIComponent).join(':') : null;
    }
    function result(args, status, reason, extras) {
        return { status, reason, scope:scope(args), week:number(args.week) || App.WeeklyProj?.currentWeek?.() || null,
            candidates:[], readiness:{weekly:false,season:false}, before:null,
            notice:'Preview only. Review the drop, bid and player locks on your league platform.', ...extras,
            basis:basisOf(args),averageWindow:windowOf(args),basisLabel:App.RosterLensBasis?.describe?.(basisOf(args),windowOf(args))?.label || ({projected:'Projected',average:'Avg points','idp-average':'IDP avg'})[basisOf(args)] };
    }
    function restrictions(args) {
        const league=args.league || {}, settings=league.settings || {}, skin=args.skin || {};
        if (!scope(args)) return ['unavailable','Your account and league context are still loading.'];
        if (args.dataScope && args.dataScope !== scope(args)) return ['unavailable','League data changed. Refresh the lens.'];
        if (args.rostersLeagueId && String(args.rostersLeagueId) !== idOf(league)) return ['unavailable','League roster data is still loading.'];
        const currentSeason=String(args.currentSeason || root.S?.nflState?.season || '');
        if (!currentSeason || String(league.season) !== currentSeason) return ['unavailable','Current-season forecasts are unavailable for this league season.'];
        if (typeof root.wrIsPro === 'function' && !root.wrIsPro()) return ['disabled','Roster upgrade recommendations are included with Pro.'];
        const provider=args.provider || App.Platforms?.getForLeague?.(league);
        const caps=provider?.capabilities || {};
        if (settings.waivers_enabled === false || settings.waivers_enabled === 0 || settings.waiversEnabled === false || settings.disable_waivers === true || number(settings.disable_waivers) === 1
            || settings.disable_adds === true || number(settings.disable_adds) === 1 || caps.hasWaivers === false || caps.supportsWaivers === false) return ['disabled','Waiver additions are disabled for this league.'];
        if (['complete','pre_draft','drafting'].includes(skin.phase || skin.state?.phase)) return ['disabled','Waiver comparisons resume when this league is in season.'];
        if (['dfs','unknown'].includes(typeOf(args))) return ['disabled','Waiver comparisons are unavailable for this league format.'];
        if (App.Chopped?.isChopped?.(league) && App.Chopped?.isEliminated?.(args.roster)) return ['disabled','You were chopped — your roster was released to waivers.'];
        if (!args.roster || !Array.isArray(args.roster.players) || !Array.isArray(args.rosters) || !args.rosters.length
            || !args.rosters.some(r => String(r.roster_id) === String(args.roster.roster_id) && ids(r).slice().sort().join('|') === ids(args.roster).slice().sort().join('|'))
            || args.rosters.some(r => !Array.isArray(r.players))) return ['unavailable','Complete league rosters are needed to verify available players.'];
        if (number(league.total_rosters) > args.rosters.length) return ['unavailable','Some league rosters are still loading.'];
        const rosterState=App.getRosterDataState?.({roster:args.roster,currentLeague:league,rosters:args.rosters,leagueSkin:args.skin});
        if (rosterState && !rosterState.isUsable) return ['unavailable',rosterState.message || 'Your roster is not ready for comparisons.'];
        const user=args.userId || root.S?.user?.user_id;
        if (user && args.roster.owner_id && String(user) !== String(args.roster.owner_id)
            && !(args.roster.co_owners || []).map(String).includes(String(user))
            && !(league._mflFranchiseId != null && String(league._mflFranchiseId) === String(args.roster.roster_id))) return ['disabled','Open My Roster to compare your own waiver moves.'];
        if (typeof App.buildFaRosterRead !== 'function') return ['unavailable','The waiver comparison service is unavailable.'];
        return null;
    }
    function projectionNumber(value) {
        if (value && typeof value === 'object') return value.available === false ? null : number(value.points?.median ?? value.median);
        return number(value);
    }
    const projectedVolume = line => !!line && ['pts_ppr','pts_std','pass_att','rush_att','rec_tgt','rec','idp_tkl','fga','xpm'].some(key => number(line[key]) > 0);
    function rosMatches(args, week) {
        const state=args.rosState;
        return !!state && String(state.leagueId) === idOf(args.league) && number(state.week) === week
            && (state.season == null || String(state.season) === String(args.league?.season || ''))
            && (state.scope == null || state.scope === scope(args));
    }
    function verifiedRos(args, week) {
        if (basisOf(args) !== 'projected') return () => null;
        const state=args.rosState;
        if (!rosMatches(args,week)) return () => null;
        return pid => {
            // Reuse the verified healthy ROS baseline only for the same explicit
            // participation scenario used by the weekly preview. Never fill unknowns with zero.
            const conditional=args.projectionsByPid?.[pid]?.conditionalParticipation === true;
            if (!own(state.points,pid) && !conditional) return null;
            const value=number(state.points?.[pid]) ?? (conditional ? number(state.healthyPoints?.[pid]) : null);
            // The seasonal value engine zero-pins unprojectable players. A
            // zero is scoring evidence only with a real projection baseline.
            return value === 0 && projectionNumber(args.projectionsByPid?.[pid]) == null && !args.rosEvidenceByPid?.[pid] ? null : value;
        };
    }
    function rookieLocked(args, pid, p) {
        if (idOf(args.league) === String(root.S?.currentLeagueId || '') && App.rookiesLockedForWaivers && App.isRookieWaiverLockedCandidate) {
            const locked=App.rookiesLockedForWaivers(args.league,args.draft);
            return App.isRookieWaiverLockedCandidate(pid,p,{rookiesLocked:locked,prospectNames:new Set(),statsData:args.statsData || {},prevStatsData:args.priorData || {}});
        }
        // This service is eager; the full FA tab may not have loaded yet.
        const drafts=[...(args.league?.drafts || []),...(args.drafts || []),args.draft].filter(Boolean)
            .filter(d => !d.season || String(d.season) === String(args.league.season));
        const pending=drafts.some(d => ['pre_draft','drafting'].includes(d.status));
        const leaguePending=['pre_draft','drafting'].includes(args.league.status);
        const isRookie=(number(p.years_exp) ?? 0) === 0 && !(args.statsData?.[pid]?.gp > 0) && !(args.priorData?.[pid]?.gp > 0);
        return typeOf(args) === 'dynasty' && (pending || leaguePending) && isRookie;
    }
    function rank(input, options) {
        const candidates=Array.isArray(input) ? input : input?.candidates || [];
        const horizon=typeof options === 'string' ? options : options?.horizon || 'week';
        const score=c => horizon === 'season' ? c.season?.delta : c.weekly?.delta;
        return candidates.filter(c => horizon === 'both'
            ? c.weekly.delta != null && c.season.delta != null && c.weekly.delta >= 0 && c.season.delta >= 0 && (c.weekly.delta > 0 || c.season.delta > 0)
            : score(c) > 0).slice().sort((a,b) => (score(b) ?? -Infinity)-(score(a) ?? -Infinity) || a.id.localeCompare(b.id));
    }
    function evaluate(input) {
        const args={...input,priorData:input.priorData || input.priorStatsData || {}};
        const blocked=restrictions(args);
        if (blocked) return result(args,...blocked);
        const common = App.RecommendationEligibility?.check({ ...args.league, rosters: args.rosters }, args.roster);
        if (common && !common.ok) return result(args, 'unavailable', common.reason);
        const basis=basisOf(args), week=number(args.week) || App.WeeklyProj?.currentWeek?.() || null;
        if (basis !== 'projected' && !App.RosterLensBasis) return result(args,'unavailable','The current-season average comparison service has not loaded.');
        if (basis !== 'projected') args.projectionsByPid=App.RosterLensBasis.adapt(args);
        if (!(week >= 1 && week <= 18)) return result(args,'unavailable','The current NFL week is unavailable.');
        const players=args.players || {}, owned=new Set(ids(args.roster));
        if (!Object.keys(players).length || [...owned].some(pid => !players[pid]?.position)) return result(args,'unavailable','Player and roster data are still loading.');
        const ros=verifiedRos(args,week), project=pid => projectionNumber(args.projectionsByPid?.[pid]);
        const type=typeOf(args), gm=args.gm || {}, effects=gm.effects || gm;
        const protectedPids=[...(effects.untouchable || []),...(gm.untouchables || []),...(args.protectedPids || [])].map(String);
        const valueOf=pid => own(args.valuesByPid,pid) ? number(args.valuesByPid[pid]) : null;
        const conditionalPids=new Set(Object.keys(args.projectionsByPid || {}).filter(pid => args.projectionsByPid[pid]?.conditionalParticipation));
        const options={week,protectedPids,project,rosProject:ros,conditionalPids};
        const reads=['week','season'].map(horizon => App.buildFaRosterRead(args.roster,{...args.league,rosters:args.rosters},players,valueOf,{...options,horizon}));
        const read=reads[0];
        if (!read.known) return result(args,'unavailable','The legal starting lineup could not be verified.');
        const copies=Math.max(1,number(args.league.settings?.player_copies) || 1), counts={};
        args.rosters.forEach(r => ids(r).forEach(pid => { counts[pid]=(counts[pid] || 0)+1; }));
        const candidates=[], seen=new Set(), filters=gm.faFilters || {};
        const excluded=new Set((filters.excludePositions || []).map(norm));
        const beforeWeek=read.beforeWeekly.complete ? number(read.beforeWeekly.total) : null;
        const beforeRos=read.beforeRos?.complete ? number(read.beforeRos.total) : null;
        const reserve=new Set([...(args.roster.reserve || []),...(args.roster.taxi || [])].map(String));
        const missingRos=ids(args.roster).filter(pid => !reserve.has(pid) && ros(pid) == null);
        const seasonReason=basis !== 'projected'
            ? 'Current-season averages are historical benchmarks, not rest-of-season forecasts. Choose Projected for a season comparison.'
            : missingRos.length ? 'ROS forecast unavailable for ' + missingRos.map(pid => players[pid]?.full_name || pid).join(', ') + '.' : null;
        const conditionalRos=pid => number(args.rosState?.points?.[pid]) == null && args.projectionsByPid?.[pid]?.conditionalParticipation === true && ros(pid) != null;
        if (beforeWeek == null && beforeRos == null) return result(args,'unavailable',basis === 'projected' ? 'Lineup forecasts are incomplete. Missing forecasts stay unknown.'
            : basis === 'average' ? 'Current-season average comparisons are incomplete. Missing averages stay unknown.' : 'Current-season averages or required projections are incomplete for this comparison.');
        Object.entries(players).forEach(([pid,p]) => {
            const pos=norm(p.position), value=valueOf(pid);
            if (owned.has(pid) || (counts[pid] || 0) >= copies || !read.rows.some(r => r.pos === pos)
                || !p.team || ['FA','FA*'].includes(p.team) || ['Inactive','Retired'].includes(p.status) || p.active === false
                || !(p.full_name || p.first_name || p.last_name) || rookieLocked(args,pid,p) || excluded.has(pos)
                || number(filters.minDhq) > 0 && !(value >= Number(filters.minDhq))
                || number(filters.maxAge) > 0 && number(p.age) > Number(filters.maxAge)
                || filters.requirePrimeYears && !((App.getAgeCurve?.(pos)?.peak?.[1] || App.peakWindows?.[pos]?.[1] || 29) > (number(p.age) ?? 25))) return;
            if (['redraft','keeper','chopped','best_ball'].includes(type) && pos === 'QB'
                && !(String(p.depth_chart_position || p.position).toUpperCase() === 'QB' && number(p.depth_chart_order) === 1)) return;
            reads.forEach(comparison => {
                const fit=comparison.fit(pos,value,{pid});
                if (!(fit.weeklyGain > 0 || fit.rosGain > 0)) return;
                const dropPid=fit.dropPid || null, id=pid+':'+(dropPid || 'open');
                if (seen.has(id)) return;
                seen.add(id);
                const asset=(key,player) => ({pid:key,name:player.full_name || [player.first_name,player.last_name].filter(Boolean).join(' ') || key,
                    position:norm(player.position),team:player.team || null,projection:project(key),comparisonBasis:args.projectionsByPid?.[key]?.comparisonBasis || 'projected',
                    averageGames:args.projectionsByPid?.[key]?.averageGames ?? null,averageSeason:args.projectionsByPid?.[key]?.averageSeason ?? null,averageSource:args.projectionsByPid?.[key]?.averageSource ?? null,averageWindow:args.projectionsByPid?.[key]?.averageWindow ?? null});
                const incoming=asset(pid,p), outgoing=dropPid ? asset(dropPid,players[dropPid]) : null;
                const delta=number(fit.weeklyGain), rosDelta=number(fit.rosGain);
                const weekly={status:delta != null && beforeWeek != null ? 'ready':'unavailable',before:beforeWeek,after:delta != null && beforeWeek != null ? +(beforeWeek+delta).toFixed(2):null,delta,basis,averageWindow:windowOf(args)};
                const season={status:rosDelta != null && beforeRos != null ? 'ready':'unavailable',before:beforeRos,after:rosDelta != null && beforeRos != null ? +(beforeRos+rosDelta).toFixed(1):null,delta:rosDelta,basis:'fixed-roster ROS lineup points',
                    conditionalParticipation:ids(args.roster).filter(key => !reserve.has(key)).concat(pid).some(conditionalRos),
                    reason:seasonReason || (ros(pid) == null ? 'ROS forecast unavailable for ' + incoming.name + '.' : null)};
                const cautions=[];
                if (p.injury_status) cautions.push('Injury: '+p.injury_status);
                if (number(p.depth_chart_order) > 1) cautions.push('Depth-chart role may limit opportunity.');
                if (delta < 0) cautions.push((basis === 'projected' ? 'Lowers this week’s best lineup by ':'Lowers the lineup benchmark by ')+Math.abs(delta).toFixed(1)+' points.');
                if (basis !== 'projected') cautions.push('Current-season averages describe past games and do not forecast next week.');
                if (rosDelta < 0) cautions.push('Lowers projected ROS lineup points by '+Math.abs(rosDelta).toFixed(1)+'.');
                const budget=number(args.league.settings?.waiver_budget), spent=number(args.roster.settings?.waiver_budget_used);
                const price={bid:null,remaining:budget != null && spent != null ? Math.max(0,budget-spent):null,minimum:number(args.league.settings?.waiver_budget_min),basis:'Choose your maximum on the claim plan; no winning bid is predicted.'};
                candidates.push({id,pid,dropPid,anchorPlayerId:dropPid,player:p,drop:dropPid ? players[dropPid]:null,
                    incoming:[incoming],outgoing:outgoing ? [outgoing]:[],weekly,season,price,cautions,requiresLockCheck:true,
                    basis,averageWindow:windowOf(args),reason:delta > 0 ? '+'+delta.toFixed(1)+(basis === 'average' ? (windowOf(args) === 'season' ? ' current-season average lineup points.' : ' last '+windowOf(args)+' games average lineup points.'):basis === 'idp-average' ? ' mixed-basis lineup points.':' projected lineup points this week.') : '+'+rosDelta.toFixed(1)+' projected ROS lineup points.',
                    handoff:{pid,dropPid,position:pos,leagueId:idOf(args.league),week,basis,averageWindow:windowOf(args),source:'roster-waiver-lens',reason:'Compare '+incoming.name+(outgoing ? ' for '+outgoing.name : ' using an open roster spot')+'. '+(delta == null ? 'Lineup comparison unavailable.' : (basis === 'projected' ? 'Week lineup gain ':'Average-basis lineup change ')+(delta>0?'+':'')+delta.toFixed(1)+'.')+(basis !== 'projected' ? ' Historical averages are not forecasts.':rosDelta == null ? ' ROS gain unavailable.' : ' ROS lineup gain '+(rosDelta>0?'+':'')+rosDelta.toFixed(1)+'.')}});
            });
        });
        return result(args,candidates.length ? 'ready':'empty',candidates.length ? null:'No confirmed upgrade with the available forecasts.',{
            week,candidates:candidates.sort((a,b) => (b.weekly.delta ?? -Infinity)-(a.weekly.delta ?? -Infinity) || a.id.localeCompare(b.id)),
            readiness:{weekly:beforeWeek != null,season:beforeRos != null},before:{weekly:beforeWeek,season:beforeRos},
            basisDescription:basis !== 'projected' ? App.RosterLensBasis.describe(basis,windowOf(args)).description : type === 'chopped' ? 'This-week lineup points; survival probability changes are not modeled.' : 'Best legal lineup before and after one alternative move. ROS holds rosters fixed.'});
    }
    async function load(input, inspectInputs) {
        let args={...input,league:input.league || {},priorData:input.priorData || input.priorStatsData,draft:input.draft || input.briefDraftInfo};
        args.rosters=args.rosters || args.league.rosters;
        args.week=number(args.week) || App.WeeklyProj?.currentWeek?.();
        const blocked=restrictions(args);
        if (blocked) return result(args,...blocked);
        const common = App.RecommendationEligibility?.check({ ...args.league, rosters: args.rosters }, args.roster);
        if (common && !common.ok) return result(args, 'unavailable', common.reason);
        const seasonal=['redraft','keeper','chopped','best_ball'].includes(typeOf(args));
        const leagueScores=App.LI_LOADED === true && String(App.LI?.sourceLeagueId || '') === idOf(args.league)
            ? App.LI?.playerScores : null;
        if (!args.valuesByPid && !seasonal && !leagueScores) return result(args,'unavailable','Current-league player values are still loading.');
        const initialScope=scope(args), initialAccount=account({});
        const state=root.S || {}, current=idOf(args.league) === String(state.currentLeagueId || '');
        const sameSeason=String(args.league.season) === String(state.season || state.nflState?.season || '');
        args.drafts=args.drafts || (current && sameSeason ? state.drafts:[]) || [];
        args.players=args.players || (current && sameSeason ? state.players:null) || {};
        const fetchStats=async season => typeof root.fetchSeasonStats === 'function' ? await root.fetchSeasonStats(String(season)).catch(()=>({})) : {};
        const providerPromise=args.projectionsByPid || basisOf(args) === 'average' ? Promise.resolve(null) : App.WeeklyProj?.ensureWeekProjections?.(args.week);
        const [stats,prior,providerLines]=await Promise.all([
            args.statsData != null ? args.statsData : current && sameSeason && state.statsData ? state.statsData : fetchStats(args.league.season),
            args.priorData != null ? args.priorData : current && sameSeason && state.priorData ? state.priorData : fetchStats(Number(args.league.season)-1),
            Promise.resolve(providerPromise).catch(()=>null)
        ]);
        if (account({}) !== initialAccount || scope(args) !== initialScope
            || current && String(root.S?.currentLeagueId || '') !== idOf(args.league)) return result(args,'unavailable','League or account changed. Open the lens again.');
        args.statsData=stats || {}; args.priorData=prior || {};
        if (basisOf(args) !== 'projected') args=await (App.RosterLensBasis?.prepare?.(args) || args);
        if (account({}) !== initialAccount || scope(args) !== initialScope
            || current && String(root.S?.currentLeagueId || '') !== idOf(args.league)) return result(args,'unavailable','League or account changed. Open the lens again.');
        args.projectionsData=args.projectionsData || (current && sameSeason ? state.projectionsData:null);
        if (!args.projectionsByPid && basisOf(args) !== 'average') {
            args.projectionsByPid={};
            Object.entries(args.players).forEach(([pid,p]) => {
                const raw=providerLines?.[pid], baseline=projectedVolume(raw)
                    || args.statsData[pid]?.gp > 0 || args.priorData[pid]?.gp > 0 || projectedVolume(args.projectionsData?.[pid]);
                if (!baseline) return;
                try {
                    const projected=App.WeeklyProj?.projectPlayer?.(pid,{playersData:args.players,statsData:args.statsData,priorData:args.priorData,projectionsData:args.projectionsData,providerProjections:providerLines || {},scoring:args.league.scoring_settings || {},week:args.week});
                    const scenario=App.RosterForecastScenario?.adapt(projected) || projected;
                    if (scenario?.available && projectionNumber(scenario) != null) args.projectionsByPid[pid]=scenario;
                } catch (_) { /* No invented projection on service failure. */ }
            });
        }
        const PV=App.PlayerValue;
        if (!args.rosState) {
            try {
                args.rosState=PV?.computePrices?.({league:args.league,leagueId:idOf(args.league),week:args.week,playersData:args.players,statsData:args.statsData,priorData:args.priorData,projectionsData:args.projectionsData,playerScores:args.valuesByPid || leagueScores || {},noMarketFetch:true});
                if (args.rosState) args.rosState={...args.rosState,scope:initialScope,season:args.league.season};
            } catch (_) { /* ROS is optional; weekly evidence remains usable. */ }
        }
        if (!args.valuesByPid) {
            args.valuesByPid={};
            Object.keys(args.players).forEach(pid => {
                const raw=seasonal ? (rosMatches(args,args.week) ? args.rosState?.values?.[pid]:null) : leagueScores?.[pid];
                if (number(raw) != null) args.valuesByPid[pid]=number(raw);
            });
        }
        const evaluated=evaluate(args);
        const participationNotice=App.RosterForecastScenario?.notice(args.projectionsByPid,args.players,args.roster);
        const answer = { ...evaluated, participationNotice, candidates:evaluated.candidates.map(c => {
            const notice=App.RosterForecastScenario?.notice(args.projectionsByPid,args.players,{players:[...ids(args.roster),...(Array.isArray(c.incoming) ? c.incoming:[c.incoming]).filter(Boolean).map(p => p.pid)]});
            return {...c,conditionalParticipation:!!notice,cautions:[...(c.cautions || []),...(notice ? [notice]:[])]};
        }) };
        if (typeof inspectInputs === 'function') inspectInputs(args);
        return answer;
    }
    const api={load,evaluate,rank,scope,restrictions};
    App.RosterWaiverLens=api;
    root.WR=root.WR || {}; root.WR.RosterWaiverLens=api;
    if (typeof module !== 'undefined' && module.exports) module.exports=api;
})(typeof window !== 'undefined' ? window : globalThis);
