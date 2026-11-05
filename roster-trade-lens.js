/* global module */
// Read-only acquisition scenarios for My Roster. Every offer is a hypothesis;
// nothing here saves GM strategy, changes a roster, or submits a transaction.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const VERSION = 'roster-trade-lens-v1';
    const BENCH = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES']);
    const OUT = new Set(['OUT', 'IR', 'PUP', 'SUS', 'NA', 'DNP', 'BYE', 'COV', 'FA']);
    const str = x => String(x == null ? '' : x);
    const num = x => x == null || typeof x === 'string' && !x.trim() || typeof x === 'boolean' || !Number.isFinite(Number(x)) ? null : Number(x);
    const round = x => Number.isFinite(x) ? Math.round(x * 10) / 10 : null;
    const ids = r => (Array.isArray(r?.players) ? r.players : []).map(str);
    const active = r => { const excluded = new Set([...(r?.reserve || []), ...(r?.taxi || [])].map(str)); return ids(r).filter(id => !excluded.has(id)); };
    const set = x => new Set(x && typeof x !== 'string' && typeof x[Symbol.iterator] === 'function' ? Array.from(x, str) : []);
    const unavailable = reason => ({ status: 'unavailable', reason, before: null, after: null, delta: null });
    const hash = value => { let h = 2166136261; for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };
    const position = p => App.normPos ? App.normPos(p?.position) : App.RosterLensBasis?.position?.(p?.position) || App.StartSit?.normSlot(p?.position || '');
    const name = p => p?.full_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'Player';
    const basisOf = opts => App.RosterLensBasis?.normalize?.(opts.basis) || (['average', 'idp-average'].includes(opts.basis) ? opts.basis : 'projected');
    const windowOf = opts => App.RosterLensBasis?.normalizeWindow?.(opts.averageWindow) || 'season';
    function skinFor(opts) {
        if (opts.skin || opts.leagueSkin) return opts.skin || opts.leagueSkin;
        return App.LeagueSkin?.resolve?.({ league: opts.league, rosters: opts.rosters || opts.league?.rosters }) || {};
    }
    function contextFor(opts) {
        const league = opts.league || {}, rosters = opts.rosters || league.rosters || [];
        const revision = hash(JSON.stringify(rosters.map(r => [str(r.roster_id), str(r.owner_id), ids(r).sort(),
            (r.reserve || []).map(str).sort(), (r.taxi || []).map(str).sort(), (r.keepers || []).map(str).sort(),
            (r.locked_players || []).map(str).sort(), (r.protected_players || []).map(str).sort()]).sort((a, b) => a[0].localeCompare(b[0]))));
        return { accountKey: str(opts.accountKey || opts.userId), platform: str(opts.platform || league._platform ||
            (league._mfl ? 'mfl' : league._espn ? 'espn' : league._yahoo ? 'yahoo' : 'sleeper')),
        leagueId: str(league.league_id || league.id), season: str(league.season), myRosterId: str(opts.roster?.roster_id), basis: basisOf(opts), averageWindow: windowOf(opts), revision };
    }
    function scopeFor(context) { return [VERSION, context.accountKey, context.platform, context.leagueId, context.season, context.myRosterId, context.basis || 'projected', ...(context.basis === 'projected' ? [] : [context.averageWindow || 'season']), context.revision].join('|'); }
    function strategyFor(opts, type) {
        const fx = opts.gm || root.WR?.GmMode?.effects?.(opts.league?.league_id || opts.league?.id) || {};
        const raw = fx.strategy || fx;
        const saved = fx.hasStrategy === true || !!(fx.strategy && fx.strategy.mode);
        const canonical = root.WR?.GmMode?.normalize || (v => ['rebuild', 'compete', 'win_now', 'custom'].includes(v) ? v : 'compete');
        const savedMode = canonical(fx.mode || raw.mode);
        const explored = ['rebuild', 'compete', 'win_now'].includes(opts.exploreMode) ? opts.exploreMode : null;
        const mode = type === 'redraft' ? 'win_now' : explored || savedMode;
        const labels = { rebuild: 'Rebuild', compete: 'Compete', win_now: 'Win now', custom: 'Custom' };
        return { mode, savedMode, label: labels[mode], savedLabel: labels[savedMode],
            source: saved ? 'saved' : 'default', exploreMode: explored,
            acceptanceFloor: Math.max(55, Math.min(90, num(fx.acceptanceFloor) ?? num(raw.acceptanceFloor) ?? 75)), untouchable: set(fx.untouchable || raw.untouchable || raw.untouchables),
            targetPositions: set(fx.targetPositions || raw.targetPositions), sellPositions: set(fx.sellPositions || raw.sellPositions),
            sellRules: fx.sellRules || raw.sellRules || [],
            maxOverpayPct: num(fx.maxOverpayPct) ?? (mode === 'win_now' ? 0.20 : mode === 'rebuild' ? 0.07 : 0.12) };
    }
    function protectedFor(roster, opts, strategy) {
        const own = str(roster.roster_id) === str(opts.roster?.roster_id);
        const protectedIds = set([...(roster.keepers || []), ...(roster.locked_players || []), ...(roster.protected_players || []),
            ...(roster.reserve || []), ...(roster.taxi || []), ...(opts.protectedByRosterId?.[str(roster.roster_id)] || []),
            ...(own ? [...(strategy?.untouchable || []), ...(opts.protectedPids || [])] : [])]);
        const tags = opts.playerTags || (str(root.S?.currentLeagueId) === str(opts.league?.league_id || opts.league?.id) ? root._playerTags : {}) || {};
        if (own) ids(roster).forEach(pid => { if (['untouchable', 'protected', 'keeper', 'locked', 'taxi'].includes(str(tags[pid]).toLowerCase())) protectedIds.add(pid); });
        return protectedIds;
    }
    function restriction(opts, skin, currentWeek) {
        const league = opts.league || {}, settings = league.settings || {}, provider = opts.provider || App.Platforms?.getForLeague?.(league), caps = provider?.capabilities || {};
        if (skin.features?.showTrades === false || skin.showTrades === false || skin.type === 'chopped' || Number(settings.disable_trades || 0) === 1
            || settings.trades_enabled === false || settings.trades_enabled === 0 || settings.tradesEnabled === false || settings.allow_trades === false
            || caps.hasTrades === false || caps.supportsTrades === false || caps.canTrade === false || opts.canTrade === false) return ['disabled', 'Trading is disabled for this league.'];
        if (num(settings.trade_deadline) > 0 && currentWeek != null && currentWeek > Number(settings.trade_deadline)) return ['disabled', 'The league trade deadline has passed.'];
        if (['complete', 'pre_draft', 'drafting'].includes(skin.phase || skin.state?.phase)) return ['disabled', 'Trade comparisons resume when this league is in season.'];
        if (typeof root.wrIsPro === 'function' && !root.wrIsPro()) return ['disabled', 'Roster trade recommendations are included with Pro.'];
        const user = str(opts.userId), roster = opts.roster || {};
        if (user && roster.owner_id != null && user !== str(roster.owner_id) && !(roster.co_owners || []).map(str).includes(user)
            && !(league._mflFranchiseId != null && str(league._mflFranchiseId) === str(roster.roster_id))) return ['disabled', 'Open My Roster to compare your own trade moves.'];
        return null;
    }
    function sellPriority(asset, strategy) {
        if (strategy.sellPositions.has(asset.pos)) return true;
        return strategy.sellRules.some(rule => {
            let parsed = rule;
            try { if (typeof root.GMStrategy?.parseSellRule === 'function') parsed = root.GMStrategy.parseSellRule(rule); } catch (_) { return false; }
            return parsed && typeof parsed === 'object' && str(parsed.pos).toUpperCase() === asset.pos
                && (num(parsed.ageAbove) == null || asset.age != null && asset.age >= Number(parsed.ageAbove));
        });
    }
    function rules(league) {
        const SS = App.StartSit, raw = league.roster_positions;
        if (!SS?.optimalLineupWeekly || !SS.BASE_POSITIONS || !Array.isArray(raw) || !raw.length) return { reason: 'The legal lineup rules have not loaded.' };
        const normalized = raw.map(SS.normSlot);
        if (normalized.some(slot => !BENCH.has(slot) && !SS.BASE_POSITIONS.has(slot) && !SS.FLEX_ALLOWED?.[slot])) return { reason: 'The league has a starting slot this preview cannot evaluate.' };
        if (!normalized.some(slot => !BENCH.has(slot))) return { reason: 'The league has no verified starting slots.' };
        return { capacity: normalized.filter(slot => !['IR', 'TAXI', 'RES'].includes(slot)).length };
    }
    function projectLineup(roster, projections, players, league) {
        const missing = [], pool = active(roster).map(pid => {
            const p = projections?.[pid], pos = position(players[pid]), points = num(p?.points?.median);
            const knownOut = OUT.has(str(p?.injuryStatus).toUpperCase());
            if (!players[pid] || !App.StartSit.BASE_POSITIONS.has(pos) || !p || !knownOut && (points == null || !p.statLine?.median)) missing.push(pid);
            return { pid, pos, available: p?.available === true, pts: points };
        });
        if (missing.length) return { ...unavailable('Some active players have no usable league-scored projection.'), missingPlayerIds: missing };
        const optimal = App.StartSit.optimalLineupWeekly(pool, league.roster_positions);
        return { status: 'ready', points: optimal.total, starters: optimal.starters, unfilled: optimal.slots.filter(slot => !slot.pid).length };
    }
    function move(roster, outgoing, incoming) {
        return { ...roster, players: ids(roster).filter(id => !outgoing.includes(id)).concat(incoming),
            reserve: (roster.reserve || []).map(str).filter(id => !outgoing.includes(id)), taxi: (roster.taxi || []).map(str).filter(id => !outgoing.includes(id)) };
    }
    function assessmentFor(roster, opts) {
        const supplied = opts.assessmentsByRosterId?.[str(roster.roster_id)] || (opts.assessments || []).find?.(a => str(a.rosterId) === str(roster.roster_id));
        if (supplied) return supplied;
        const lid = str(opts.league.league_id || opts.league.id);
        if (App.LI_LOADED && str(App.LI?.sourceLeagueId) === lid) {
            // team-assess.js is part of WR_SHARED_FILES, loaded eagerly before
            // any tab. Prefer its App API; never depend on trade-calc mounting.
            const assessor = App.assessTeamFromGlobal || root.assessTeamFromGlobal;
            const globalsMatch = str(root.S?.currentLeagueId) === lid && Array.isArray(root.S?.rosters)
                && contextFor({ ...opts, rosters: root.S.rosters }).revision === contextFor(opts).revision;
            if (globalsMatch && typeof assessor === 'function') {
                try { return assessor(roster.roster_id); } catch (_) { /* no unscoped fallback */ }
            }
            const playerStats = opts.playerStats || (globalsMatch ? root.S?.playerStats : null);
            if (playerStats && Object.keys(playerStats).length && typeof App.assessAllTeams === 'function') {
                try { return App.assessAllTeams(opts.rosters || opts.league.rosters, opts.players || opts.playersData, playerStats, opts.league, opts.league.users || [],
                    opts.tradedPicks || (globalsMatch ? root.S?.tradedPicks : []) || []).find(a => str(a.rosterId) === str(roster.roster_id)) || null; } catch (_) { /* unavailable is explicit */ }
            }
        }
        return null;
    }
    function directionFor(assessment, type, partnerWeekly) {
        if (type === 'redraft') return { label: partnerWeekly.status === 'ready' && partnerWeekly.delta > 0 ? 'Current-season lineup fit' : 'Current-season value swap', source: 'inferred',
            reason: partnerWeekly.status === 'ready' ? (partnerWeekly.basis === 'average' ? 'Their average-lineup benchmark changes by ' : partnerWeekly.basis === 'idp-average' ? 'Their mixed-basis lineup changes by ' : 'Their projected lineup changes by ') + (partnerWeekly.delta > 0 ? '+' : '') + partnerWeekly.delta + ' points.' : 'Their lineup comparison is unavailable.' };
        const tier = str(assessment?.tier).toUpperCase();
        if (tier === 'REBUILDING') return { label: 'Rebuilding profile', source: 'inferred', reason: 'Inferred from the current roster assessment; this is not their saved GM plan.' };
        if (tier === 'ELITE' || tier === 'CONTENDER') return { label: 'Competing profile', source: 'inferred', reason: 'Inferred from the current roster assessment; this is not their saved GM plan.' };
        return { label: 'Direction unknown', source: 'unavailable', reason: 'No verified strategy has been supplied by this manager.' };
    }
    function weeklyComparison(before, after, week) {
        if (before.status !== 'ready' || after.status !== 'ready') return { ...unavailable(after.reason || before.reason), week };
        return { status: 'ready', week, before: before.points, after: after.points, delta: round(after.points - before.points),
            beforeStarters: before.starters, afterStarters: after.starters, openSlotsBefore: before.unfilled, openSlotsAfter: after.unfilled };
    }
    function valueMapFor(opts, type, players) {
        if (opts.valuesByPid && typeof opts.valuesByPid === 'object') return opts.valuesByPid;
        const lid = str(opts.league.league_id || opts.league.id), PV = App.PlayerValue;
        if (!PV?.getValue) return {};
        const ros = PV.rosState?.(), week = num(opts.currentWeek) ?? num(App.WeeklyProj?.currentWeek?.()) ?? num(root.S?.currentWeek);
        const ready = type === 'redraft' ? str(ros?.leagueId) === lid && num(ros?.week) === week && (ros?.season == null || str(ros.season) === str(opts.league.season)) && str(root.S?.currentLeagueId) === lid
            : App.LI_LOADED && str(App.LI?.sourceLeagueId) === lid;
        if (!ready) return {};
        return Object.fromEntries(Object.keys(players).map(pid => [pid, PV.getValue(pid, { skin: opts.skin || opts.leagueSkin || { type } })]));
    }
    function rank(candidates, opts) {
        const mode = opts?.mode || 'compete';
        return [...candidates].sort((a, b) => {
            const score = c => (mode === 'rebuild' ? (c.futureFit?.ageDifference || 0) * 2 : (c.weekly.delta || 0) * 10)
                + Math.min(5, c.price.delta / Math.max(1, c.price.give) * 10) + (c.partnerWeekly?.delta > 0 ? 2 : 0)
                + (c.targetPriority ? 3 : 0) + (c.sellPriority ? 2 : 0) + (c.timelineFit?.matched ? 8 : 0) - (c.outgoing.length - 1);
            return score(b) - score(a) || a.id.localeCompare(b.id);
        });
    }
    function build(opts) {
        opts = opts || {};
        const league = opts.league || {}, roster = opts.roster || {}, rosters = opts.rosters || league.rosters || [], players = opts.players || opts.playersData || {};
        const context = contextFor(opts), scope = scopeFor(context), skin = skinFor(opts), type = skin.type || 'unknown', strategy = strategyFor(opts, type);
        const currentWeek = num(opts.currentWeek) ?? num(App.WeeklyProj?.currentWeek?.()) ?? num(root.S?.currentWeek);
        const week = num(opts.week) ?? (currentWeek == null ? null : currentWeek + 1);
        const basis = basisOf(opts), basisLabel = App.RosterLensBasis?.describe?.(basis, windowOf(opts))?.label || ({ projected: 'Projected', average: 'Avg points', 'idp-average': 'IDP avg' })[basis];
        const base = { version: VERSION, scope, context, basis, basisLabel, averageWindow: windowOf(opts), inputRevision: opts.revision ?? null, strategy: { mode: strategy.mode, savedMode: strategy.savedMode, savedLabel: strategy.savedLabel, label: strategy.label, source: strategy.source, exploreMode: strategy.exploreMode, acceptanceFloor: strategy.acceptanceFloor },
            week, timing: week ? 'First full week after a trade · Week ' + week : 'Trade timing unavailable', candidates: [], before: null,
            notice: 'Possible packages, not agreed prices. One preview at a time; live rosters and your saved GM plan stay unchanged.' };
        const no = (status, reason) => ({ ...base, status, reason });
        const common = App.RecommendationEligibility?.check({ ...league, rosters }, roster, 'trade');
        if (common && !common.ok) return no('unavailable', common.reason);
        const blocked = restriction(opts, skin, currentWeek);
        if (blocked) return no(...blocked);
        if (!['dynasty', 'keeper', 'redraft'].includes(type)) return no('unavailable', 'This league format does not have verified trade-lens support yet.');
        if (!context.accountKey || !context.leagueId || !context.season || !context.myRosterId || !Array.isArray(roster.players)) return no('unavailable', 'The active account, league and roster must finish loading.');
        if (!Number.isInteger(week) || currentWeek == null || week <= currentWeek || week > 18) return no('unavailable', 'A full future NFL week is required for a trade preview.');
        if (!league.scoring_settings || !Object.keys(league.scoring_settings).length || Object.values(league.scoring_settings).some(v => num(v) == null)) return no('unavailable', 'Complete league scoring rules are required.');
        if (basis !== 'projected' && !App.RosterLensBasis) return no('unavailable', 'The current-season average comparison service has not loaded.');
        const si = rules(league);
        if (si.reason) return no('unavailable', si.reason);
        const live = rosters.find(r => str(r.roster_id) === context.myRosterId);
        if (!live || JSON.stringify([...ids(live)].sort()) !== JSON.stringify([...ids(roster)].sort()) || JSON.stringify(active(live).sort()) !== JSON.stringify(active(roster).sort()) || str(live.owner_id) !== str(roster.owner_id)) return no('unavailable', 'Your roster snapshot no longer matches the league. Refresh it first.');
        if (num(league.total_rosters) > rosters.length) return no('unavailable', 'Some league rosters are still loading.');
        const rosterState = App.getRosterDataState?.({ roster, currentLeague: league, rosters, leagueSkin: skin });
        if (rosterState && !rosterState.isUsable) return no('unavailable', rosterState.message || 'Your roster is not ready for a trade comparison.');
        const ownership = {};
        rosters.forEach(r => ids(r).forEach(pid => { ownership[pid] = (ownership[pid] || 0) + 1; }));
        if (rosters.some(r => !Array.isArray(r.players)) || new Set(rosters.map(r => str(r.roster_id))).size !== rosters.length || Object.values(ownership).some(count => count !== 1)) return no('unavailable', 'Complete league rosters with unique player ownership are required.');
        const projections = basis === 'projected' ? opts.projectionsByPid || {} : App.RosterLensBasis.adapt({ ...opts, players }), before = projectLineup(roster, projections, players, league);
        if (before.status !== 'ready') return { ...no('unavailable', basis === 'projected' ? before.reason : 'Some active players lack verified current-season averages or required projections for this comparison.'), before };
        const values = valueMapFor({ ...opts, skin }, type, players);
        const asset = pid => ({ pid, id: pid, name: name(players[pid]), pos: position(players[pid]), team: players[pid]?.team || null,
            age: num(players[pid]?.age), value: num(typeof values[pid] === 'object' ? values[pid]?.value : values[pid]), projection: num(projections[pid]?.points?.median),
            comparisonBasis: projections[pid]?.comparisonBasis || 'projected', averageGames: projections[pid]?.averageGames ?? null,
            averageSeason: projections[pid]?.averageSeason ?? null, averageWindow: projections[pid]?.averageWindow ?? null, averageSource: projections[pid]?.averageSource ?? null });
        const ownProtected = protectedFor(roster, opts, strategy);
        const owned = ids(roster).map(asset).filter(a => a.value > 0 && !ownProtected.has(a.pid))
            .sort((a, b) => Number(sellPriority(b, strategy)) - Number(sellPriority(a, strategy)) || b.value - a.value).slice(0, 14);
        if (!owned.length) return { ...no('unavailable', 'No tradable, priced players are available outside your protected core.'), before };
        const suggestions = [];
        let pricedTargets = 0;
        rosters.filter(r => str(r.roster_id) !== context.myRosterId && r.owner_id != null).slice(0, 31).forEach(partnerRoster => {
            const protectedIds = protectedFor(partnerRoster, opts, strategy);
            const targets = ids(partnerRoster).map(asset).filter(a => a.value > 0 && !protectedIds.has(a.pid))
                .sort((a, b) => Number(strategy.targetPositions.has(b.pos)) - Number(strategy.targetPositions.has(a.pos)) || b.value - a.value).slice(0, 12);
            pricedTargets += targets.length;
            const partnerBefore = projectLineup(partnerRoster, projections, players, league), assessment = assessmentFor(partnerRoster, opts);
            const owner = (league.users || []).find(u => str(u.user_id) === str(partnerRoster.owner_id));
            const partnerName = owner?.display_name || partnerRoster.metadata?.team_name || 'Team ' + partnerRoster.roster_id;
            const scopedIntel = str(opts.ownerIntel?.sourceLeagueId) === context.leagueId ? opts.ownerIntel
                : App.LI_LOADED && str(App.LI?.sourceLeagueId) === context.leagueId ? App.LI : {};
            const savedDna = opts.ownerScoutingScope === context.leagueId + ':' + context.season ? opts.savedOwnerDna?.[str(partnerRoster.owner_id)] : null;
            const scouting = App.OwnerScouting?.read?.({ roster: partnerRoster, assessment: assessment || {}, league, intel: scopedIntel, ownerName: partnerName, savedDna });
            const packages = owned.map(a => [a]);
            for (let a = 0; a < Math.min(8, owned.length); a++) for (let b = a + 1; b < Math.min(8, owned.length); b++) packages.push([owned[a], owned[b]]);
            targets.forEach(target => packages.forEach(outgoing => {
                const give = outgoing.reduce((sum, a) => sum + a.value, 0), receive = target.value;
                // No manufactured bargain: price must stay near parity in both directions.
                if (give < receive * 0.85 || give > receive * (1 + Math.min(0.25, strategy.maxOverpayPct))) return;
                const giveIds = outgoing.map(a => a.pid), changed = move(roster, giveIds, [target.pid]), changedPartner = move(partnerRoster, [target.pid], giveIds);
                if (active(changed).length > si.capacity || active(changedPartner).length > si.capacity) return;
                const after = projectLineup(changed, projections, players, league), weekly = weeklyComparison(before, after, week);
                weekly.basis = basis; weekly.basisLabel = basisLabel; weekly.averageWindow = windowOf(opts);
                if (weekly.status !== 'ready' || weekly.openSlotsAfter > weekly.openSlotsBefore) return;
                const ages = outgoing.map(a => a.age), avgAge = ages.every(a => a != null) ? ages.reduce((sum, a) => sum + a, 0) / ages.length : null;
                const ageDifference = avgAge == null || target.age == null ? null : round(avgAge - target.age);
                if (strategy.mode === 'rebuild' ? ageDifference == null || ageDifference < 3 : weekly.delta <= 0.1) return;
                const partnerWeekly = weeklyComparison(partnerBefore, projectLineup(changedPartner, projections, players, league), week);
                partnerWeekly.basis = basis;
                if (partnerWeekly.status === 'ready' && partnerWeekly.openSlotsAfter > partnerWeekly.openSlotsBefore) return;
                const direction = directionFor(assessment, type, partnerWeekly);
                const timelineFit = { matched: type !== 'redraft' && (strategy.mode === 'rebuild' ? direction.label === 'Competing profile' && ageDifference >= 3
                    : direction.label === 'Rebuilding profile' && ageDifference != null && ageDifference < 0 && weekly.delta > 0), source: 'inferred',
                reason: strategy.mode === 'rebuild' ? 'Their competing roster profile may value present production while you receive a younger asset.'
                    : 'An older productive target on a rebuilding roster profile may fit your nearer-term window.' };
                const reason = basis === 'average' ? 'Compares legal lineups using current-season average points. Historical production is not a forecast.'
                    : basis === 'idp-average' ? 'Uses current-season averages for IDPs and weekly projections for other players.' : timelineFit.matched ? timelineFit.reason : strategy.mode === 'rebuild' ? 'A younger asset fits your rebuild; the current lineup cost is shown explicitly.'
                    : type === 'redraft' ? 'Improves your next full-week lineup under this league’s scoring.' : 'Adds immediate starting-lineup help while showing the dynasty value you give up.';
                const caution = [];
                if (weekly.delta < 0) caution.push(basis === 'projected' ? 'You give up projected production now.' : 'This comparison lowers your lineup benchmark.');
                if (outgoing.length > 1) caution.push('Consolidating two players reduces your depth.');
                if (give > receive) caution.push('You send more ' + (type === 'redraft' ? 'season value' : 'DHQ value') + ' than you receive.');
                if (type !== 'redraft' && target.age != null && target.age > (num(App.ageCurveWindows?.[target.pos]?.peak?.[1]) ?? 99)) caution.push('The incoming player is beyond the position’s typical peak-age range.');
                if (partnerWeekly.status !== 'ready') caution.push('The other team’s lineup impact is incomplete.');
                const engine = App.TradeEngine, mine = assessmentFor(roster, opts);
                let acceptance = null;
                if (typeof engine?.calcAcceptanceLikelihood === 'function') {
                    const dna = scouting?.key || 'NONE';
                    const posture = engine.calcOwnerPosture?.(assessment, dna);
                    const taxes = engine.calcPsychTaxes?.(mine, assessment, dna, posture) || [];
                    const grudge = engine.calcGrudgeTax?.(roster.owner_id, partnerRoster.owner_id, opts.grudges || root._tcGrudges || [], dna);
                    if (grudge?.total) taxes.push({ name: 'Grudge Tax', impact: grudge.total });
                    const likelihood = num(engine.calcAcceptanceLikelihood(give, receive, dna, taxes, mine, assessment, { totalPieces: outgoing.length + 1 }));
                    if (likelihood != null) acceptance = { likelihood: Math.round(Math.max(5, Math.min(95, likelihood))), source: 'Trade Engine estimate' };
                }
                // A saved floor filters recommendations; it never changes the opponent estimate.
                if (acceptance && acceptance.likelihood < strategy.acceptanceFloor) return;
                if (!acceptance && strategy.source === 'saved' && (num(opts.gm?.acceptanceFloor) != null || num(opts.gm?.strategy?.acceptanceFloor) != null)) return;
                const id = [context.myRosterId, str(partnerRoster.roster_id), giveIds.slice().sort().join(','), target.pid].join(':');
                const c = { id, kind: 'trade', anchorPlayerId: outgoing[0].pid, incoming: [target], outgoing, partner: { rosterId: partnerRoster.roster_id, ownerId: partnerRoster.owner_id,
                    name: partnerName, direction, scouting: scouting || null }, basis, basisLabel, averageWindow: windowOf(opts), weekly, partnerWeekly,
                season: unavailable(basis !== 'projected' ? 'Current-season averages are historical benchmarks, not rest-of-season forecasts. Choose Projected for a season comparison.' : type === 'redraft' ? 'Remaining-season evidence has not been loaded.' : 'Multi-year outcomes are not simulated.'),
                price: { give, receive, delta: receive - give, unit: type === 'redraft' ? 'season value' : 'DHQ' }, futureFit: { ageDifference, outgoingAverageAge: avgAge, incomingAge: target.age,
                    label: ageDifference == null ? 'Age comparison unavailable' : ageDifference > 0 ? 'Younger roster asset' : ageDifference < 0 ? 'Older roster asset' : 'Similar age', source: 'roster ages; development is not forecast' },
                ...(acceptance ? { acceptance } : {}), reason, timelineFit, cautions: caution.concat(basis !== 'projected' ? ['Historical averages do not predict next week or the remaining season.'] : []), targetPriority: strategy.targetPositions.has(target.pos), sellPriority: outgoing.some(a => sellPriority(a, strategy)) };
                c.builderContext = { kind: 'roster-lens-package', source: 'roster-trade-lens', ...context, currentWeek, week, partnerRosterId: str(partnerRoster.roster_id), givePlayerIds: giveIds, receivePlayerIds: [target.pid] };
                suggestions.push(c);
            }));
        });
        const seenTargets = new Set(), ranked = rank(suggestions, strategy).filter(c => { const pid = c.incoming[0].pid; if (seenTargets.has(pid)) return false; seenTargets.add(pid); return true; }).slice(0, Math.max(1, Math.min(8, num(opts.limit) || 5)));
        return { ...base, status: ranked.length ? 'ready' : pricedTargets ? 'empty' : 'unavailable', reason: ranked.length ? null : pricedTargets ? 'No verified package meets your ' + strategy.acceptanceFloor + '% acceptance floor, protected core and GM plan.' : 'Other teams’ player prices are unavailable for this league.',
            before, candidates: ranked, readiness: { pricing: true, weekly: true, season: false } };
    }
    async function load(opts, inspectInputs) {
        opts = opts || {};
        const league = opts.league || {}, rosters = opts.rosters || league.rosters || [], players = opts.players || opts.playersData || {}, skin = skinFor(opts);
        const currentWeek = num(opts.currentWeek) ?? num(App.WeeklyProj?.currentWeek?.()) ?? num(root.S?.currentWeek), week = num(opts.week) ?? (currentWeek == null ? null : currentWeek + 1);
        let args = { ...opts, league: { ...league, rosters }, rosters, players, skin, currentWeek, week };
        if (!args.projectionsByPid) {
            const preflight = build(args);
            if (preflight.status === 'disabled' || (preflight.status === 'unavailable' && !preflight.before)) return preflight;
        }
        // A supplied projection snapshot is isolated; otherwise verify the NFL season before fetching.
        if (basisOf(args) !== 'projected') args = await (App.RosterLensBasis?.prepare?.(args) || args);
        if (basisOf(args) !== 'average' && !args.projectionsByPid && App.WeeklyProj?.projectPlayer && str(root.S?.nflState?.season) === str(league.season) && week > currentWeek && week <= 18) {
            const provider = await App.WeeklyProj.ensureWeekProjections?.(week, { season: league.season }) || {};
            args.projectionsByPid = {};
            [...new Set(rosters.flatMap(ids))].forEach(pid => { args.projectionsByPid[pid] = App.WeeklyProj.projectPlayer(pid, { playersData: players, statsData: opts.statsData || {},
                priorData: opts.priorData || opts.priorStatsData || {}, scoring: league.scoring_settings, week, providerProjections: provider || {}, projectionsData: opts.projectionsData || {} }); });
        }
        if (skin.type === 'redraft' && str(root.S?.currentLeagueId) === str(league.league_id || league.id)) {
            try { App.PlayerValue?.ensureRos?.({ league, leagueId: league.league_id || league.id, skin, playersData: players, statsData: opts.statsData || {}, priorData: opts.priorData || opts.priorStatsData || {}, projectionsData: opts.projectionsData || {} }); } catch (_) { /* unavailable values stay unavailable */ }
        }
        if (args.projectionsByPid && basisOf(args) === 'projected') {
            args.projectionsByPid = { ...args.projectionsByPid };
            for (const pid of Object.keys(args.projectionsByPid)) args.projectionsByPid[pid] = App.RosterForecastScenario?.adapt(args.projectionsByPid[pid]) || args.projectionsByPid[pid];
        }
        // Weekly results never prepare or simulate the rest of the season.
        // The selected preserved package opts into loadSeason explicitly.
        const evaluated=build(args);
        const participationNotice=App.RosterForecastScenario?.notice(args.projectionsByPid,players,args.roster);
        const answer = { ...evaluated, participationNotice, candidates:evaluated.candidates.map(c => {
            const partner=rosters.find(r => str(r.roster_id) === str(c.partner.rosterId));
            const partnerNotice=App.RosterForecastScenario?.notice(args.projectionsByPid,players,partner);
            return {...c,conditionalParticipation:!!(participationNotice || partnerNotice),cautions:[...(c.cautions || []),...new Set([participationNotice,partnerNotice].filter(Boolean))]};
        }) };
        if (typeof inspectInputs === 'function') inspectInputs(args);
        return answer;
    }
    async function loadSeason(opts) {
        opts = opts || {};
        const result = opts.result, candidateId = str(opts.candidateId), context = contextFor(opts), scope = scopeFor(context);
        const answer = season => ({ status: season.status, reason: season.reason || null, candidateId, scope, context, season });
        const no = reason => answer(unavailable(reason));
        const league = opts.league || {}, rosters = opts.rosters || league.rosters || [], players = opts.players || opts.playersData || {}, skin = skinFor(opts);
        const candidate = result?.candidates?.find(c => c.id === candidateId);
        const valid = () => {
            if (!candidate || result?.status !== 'ready' || result.scope !== scope || scopeFor(contextFor(opts)) !== scope) return 'This roster preview changed. Refresh it before comparing the season.';
            if ((result.inputRevision ?? null) !== (opts.revision ?? null)) return 'The roster evidence changed. Refresh the selected package first.';
            const mode = strategyFor(opts, skin.type);
            if (result.strategy.mode !== mode.mode || result.strategy.savedMode !== mode.savedMode) return 'Your GM direction changed. Refresh the trade lens first.';
            const currentAccount = root.WR?.WaiverPlans?.account?.() || ((App.OD || root.OD)?.getCurrentUserId?.() ? 'account:' + (App.OD || root.OD).getCurrentUserId() : null);
            if (currentAccount && currentAccount !== context.accountKey) return 'Your account changed. Refresh the selected package.';
            if (root.S?.currentLeagueId != null && str(root.S.currentLeagueId) !== context.leagueId) return 'The active league changed. Refresh the selected package.';
            const check = validateBuilderContext(candidate.builderContext, opts);
            return check.ok ? null : check.reason;
        };
        const invalid = valid();
        if (invalid) return no(invalid);
        if (basisOf(opts) !== 'projected') return no('Current-season averages are historical benchmarks, not rest-of-season forecasts. Choose Projected for a season comparison.');
        if (skin.type !== 'redraft') return no('Remaining-season trade points are available for in-season redraft only; multi-year outcomes are not simulated.');
        if (str(root.S?.nflState?.season) !== str(league.season) || !(skin.phase === 'in_season' || (!skin.phase && league.status === 'in_season'))) return no('A verified current-season redraft context is required.');
        if (!App.TradeSeasonImpact?.prepare || !App.TradeSeasonImpact?.analyze) return no('The remaining-season projection service has not loaded.');
        let seasonContext = opts.seasonContext;
        try {
            if (!seasonContext) seasonContext = await App.TradeSeasonImpact.prepare({ league: { ...league, rosters }, playersData: players, statsData: opts.statsData || {},
                priorData: opts.priorData || opts.priorStatsData || {}, projectionsData: opts.projectionsData || {}, fromWeek: result.week });
            const changed = valid();
            if (changed) return no(changed);
            if (seasonContext?.status !== 'ready') return no(seasonContext?.reason || 'Remaining-season evidence is unavailable.');
            if (str(seasonContext.league?.league_id || seasonContext.league?.id) !== context.leagueId || str(seasonContext.league?.season) !== context.season || seasonContext.fromWeek !== result.week
                || contextFor({ ...opts, league: seasonContext.league, rosters: seasonContext.league.rosters }).revision !== context.revision
                || JSON.stringify(seasonContext.league.scoring_settings) !== JSON.stringify(league.scoring_settings)
                || JSON.stringify(seasonContext.league.roster_positions) !== JSON.stringify(league.roster_positions)) return no('The season snapshot no longer matches this league and roster.');
            return answer(App.TradeSeasonImpact.analyze({ context: seasonContext, myRosterId: context.myRosterId, partnerRosterId: candidate.partner.rosterId,
                givePlayerIds: candidate.outgoing.map(a => a.pid), receivePlayerIds: candidate.incoming.map(a => a.pid), pointsOnly: true }));
        } catch (_) { return no('Remaining-season lineup points could not be loaded.'); }
    }
    function validateBuilderContext(target, opts) {
        const current = contextFor(opts || {}), bad = reason => ({ ok: false, reason });
        if (target?.kind !== 'roster-lens-package' || !target.accountKey || !current.accountKey) return bad('This trade preview has no active account context.');
        for (const field of ['accountKey', 'platform', 'leagueId', 'season', 'myRosterId', 'basis', 'revision']) if (str(target[field]) !== str(current[field])) return bad('The account, league, roster or comparison basis changed. Refresh the trade lens before opening this package.');
        if (current.basis !== 'projected' && windowOf(target) !== current.averageWindow) return bad('The average-points window changed. Refresh the trade lens before opening this package.');
        const skin = skinFor(opts), league = opts.league || {}, rosters = opts.rosters || league.rosters || [];
        const currentWeek = num(opts.currentWeek) ?? num(App.WeeklyProj?.currentWeek?.()) ?? num(root.S?.currentWeek);
        if (num(target.currentWeek) !== currentWeek || num(target.week) == null || Number(target.week) <= currentWeek) return bad('The NFL week changed. Refresh this trade preview before opening its package.');
        const blocked = restriction(opts, skin, currentWeek);
        if (blocked) return bad(blocked[1]);
        const mine = rosters.find(r => str(r.roster_id) === current.myRosterId), other = rosters.find(r => str(r.roster_id) === str(target.partnerRosterId));
        if (!mine || !other || mine === other || !other.owner_id) return bad('This trade partner is no longer available.');
        const give = target.givePlayerIds, receive = target.receivePlayerIds;
        if (!Array.isArray(give) || !Array.isArray(receive) || !give.length || !receive.length || new Set([...give, ...receive].map(str)).size !== give.length + receive.length) return bad('The package contains missing or duplicate players.');
        if (give.some(pid => !ids(mine).includes(str(pid))) || receive.some(pid => !ids(other).includes(str(pid)))) return bad('A proposed player is no longer owned by these teams.');
        if ([...give, ...receive].some(pid => rosters.reduce((count, r) => count + ids(r).filter(id => id === str(pid)).length, 0) !== 1)) return bad('A proposed player has conflicting ownership data. Refresh the league first.');
        const strategy = strategyFor(opts, skin.type);
        const protectedMine = protectedFor(mine, opts, strategy), protectedOther = protectedFor(other, opts, strategy);
        if (give.some(pid => protectedMine.has(str(pid))) || receive.some(pid => protectedOther.has(str(pid)))) return bad('This package includes a protected, locked, keeper, reserve or taxi player. Refresh the trade lens.');
        const si = rules(league);
        if (si.reason || active(move(mine, give.map(str), receive.map(str))).length > si.capacity || active(move(other, receive.map(str), give.map(str))).length > si.capacity) return bad('This package requires a roster-capacity adjustment first.');
        if (opts.players || opts.playersData) {
            const players = opts.players || opts.playersData;
            const coverage = r => {
                const pool = active(r).map(pid => ({ pid, pos: position(players[pid]), pts: 0, available: true }));
                if (pool.some(p => !players[p.pid] || !App.StartSit.BASE_POSITIONS.has(p.pos))) return null;
                return App.StartSit.optimalLineupWeekly(pool, league.roster_positions).slots.filter(slot => !slot.pid).length;
            };
            const mineBefore = coverage(mine), otherBefore = coverage(other), mineAfter = coverage(move(mine, give.map(str), receive.map(str))), otherAfter = coverage(move(other, receive.map(str), give.map(str)));
            if ([mineBefore, otherBefore, mineAfter, otherAfter].some(value => value == null)) return bad('Player eligibility is incomplete. Refresh the trade lens before opening this package.');
            if (mineAfter > mineBefore || otherAfter > otherBefore) return bad('This package leaves a team with an additional unfilled starting position. Adjust the package first.');
        }
        return { ok: true, myOwnerId: mine.owner_id, partnerOwnerId: other.owner_id, givePlayerIds: give.map(str), receivePlayerIds: receive.map(str) };
    }
    const api = { VERSION, load, loadSeason, build, rank, contextFor, scopeFor, validateBuilderContext,
        toBuilderContext: candidate => candidate?.builderContext ? JSON.parse(JSON.stringify(candidate.builderContext)) : null };
    App.RosterTradeLens = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
