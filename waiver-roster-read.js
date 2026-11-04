/* global module */
// Canonical legal waiver add/drop comparison, shared by My Roster and Waivers.
(function (root) {
    'use strict';
    // Shared preflight used by boards, roster lenses and Home. Unknown ownership
    // can never establish a free agent. This is read-only transaction planning.
    function eligibility(league, roster, kind = 'waiver') {
        const settings = league?.settings || {}, rosters = league?.rosters;
        const caps = root.App?.Platforms?.getForLeague?.(league)?.capabilities || {};
        const disabled = kind === 'trade'
            ? settings.disable_trades === true || Number(settings.disable_trades) === 1 || settings.trades_enabled === false || caps.hasTrades === false
            : settings.waivers_enabled === false || settings.waivers_enabled === 0 || settings.waiversEnabled === false || settings.disable_waivers === true || Number(settings.disable_waivers) === 1 || settings.disable_adds === true || Number(settings.disable_adds) === 1 || caps.hasWaivers === false || caps.supportsWaivers === false;
        if (kind !== 'ownership' && disabled) return { ok: false, reason: kind === 'trade' ? 'Trades are disabled for this league.' : 'Waiver additions are disabled for this league.' };
        if (kind !== 'ownership' && league?.status === 'complete') return { ok: false, reason: 'The league season is complete.' };
        if (!Array.isArray(rosters) || !rosters.length || !Number.isInteger(Number(league.total_rosters)) || Number(league.total_rosters) !== rosters.length
            || new Set(rosters.map(r => String(r.roster_id))).size !== rosters.length || rosters.some(r => !Array.isArray(r.players)))
            return { ok: false, reason: 'Complete league rosters and team count are required to verify ownership.' };
        const mine = rosters.find(r => String(r.roster_id) === String(roster?.roster_id));
        if (!mine || JSON.stringify([...(mine.players || [])].map(String).sort()) !== JSON.stringify([...(roster?.players || [])].map(String).sort()))
            return { ok: false, reason: 'Your roster snapshot does not match the league. Refresh league data.' };
        const owners = {}, copies = Math.max(1, Number(settings.player_copies) || 1);
        rosters.forEach(r => new Set([...(r.players || []), ...(r.reserve || []), ...(r.taxi || [])].map(String)).forEach(pid => owners[pid] = (owners[pid] || 0) + 1));
        if (Object.values(owners).some(count => count > copies)) return { ok: false, reason: 'Player ownership conflicts across league rosters.' };
        if (kind === 'ownership') return { ok: true, owners, copies };
        const SS = root.App?.StartSit;
        const slots = (league.roster_positions || []).map(x => SS?.normSlot?.(x) || x);
        if (!slots.length || slots.some(x => !['BN','BE','BENCH','IR','TAXI','RES','RES'].includes(x) && !(SS?.BASE_POSITIONS?.has(x) || SS?.FLEX_ALLOWED?.[x] || ['QB','RB','WR','TE','FLEX','SUPER_FLEX','K','DEF','DL','LB','DB','IDP_FLEX'].includes(x))))
            return { ok: false, reason: 'Legal roster slots are unavailable or unsupported.' };
        if (!league.scoring_settings || !Object.keys(league.scoring_settings).length) return { ok: false, reason: 'League scoring rules have not loaded.' };
        const scoringSupport = root.calcFantasyPts?.detailed?.({}, league.scoring_settings);
        if (scoringSupport?.supported === false) return { ok: false, reason: 'Unsupported scoring rules: ' + scoringSupport.unsupported.join(', ') + '. Recommendation paused.' };
        if (kind === 'trade' && Number(settings.trade_deadline) > 0 && (root.App?.WeeklyProj?.currentWeek?.() || 0) > Number(settings.trade_deadline)) return { ok: false, reason: 'The trade deadline has passed.' };
        if (kind === 'waiver' && Number(settings.waiver_budget) > 0) {
            if (mine.settings?.waiver_budget_used == null) return { ok: false, reason: 'Remaining FAAB has not been verified.' };
            const left = Math.max(0, Number(settings.waiver_budget) - Number(mine.settings.waiver_budget_used));
            const min = settings.waiver_budget_min == null ? 1 : Math.max(0, Number(settings.waiver_budget_min));
            if (!Number.isFinite(left) || left < min) return { ok: false, reason: 'Remaining FAAB is below the league minimum bid.' };
        }
        return { ok: true, owners, copies };
    }
    // Roster occupancy and waiver fit must use owned players and league slots,
    // not NFL depth-chart starter counts or generic dynasty quality targets.
    function buildFaRosterRead(roster, league, players, valueOf, options = {}) {
        const norm = pos => root.App?.normPos?.(pos) || root.App?.RosterLensBasis?.position?.(pos) || ({ DST: 'DEF', 'D/ST': 'DEF', DE: 'DL', DT: 'DL', NT: 'DL', IDL: 'DL', EDGE: 'DL', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', OLB: 'LB', ILB: 'LB', MLB: 'LB' }[pos] || pos);
        const flex = { FLEX: ['RB','WR','TE'], WRRBTE_FLEX: ['RB','WR','TE'], WRRB_FLEX: ['WR','RB'], REC_FLEX: ['WR','TE'], SUPER_FLEX: ['QB','RB','WR','TE'], QB_FLEX: ['QB','RB','WR','TE'], SFLEX: ['QB','RB','WR','TE'], OP: ['QB','RB','WR','TE'], IDP_FLEX: ['DL','LB','DB'] };
        const type = root.App?.LeagueSkin?.build?.({league})?.type || ({0:'redraft',1:'keeper',2:'dynasty',3:'chopped'})[league?.settings?.type] || 'unknown';
        const dynasty = type === 'dynasty';
        const positions = league?.roster_positions || [];
        const slots = positions.map(norm).filter(x => !['BN','BE','BENCH','IR','TAXI','RES'].includes(x));
        const capacity = positions.filter(x => !['IR','TAXI','RES'].includes(x)).length;
        const reserve = new Set([...(roster?.reserve || []), ...(roster?.taxi || [])].map(String));
        const protectedIds = new Set([...(league?.locked_players || []),...(options.protectedPids || []), ...(roster?.locked_players || []), ...(roster?.keepers || [])].map(String));
        const week = options.week ?? root.App?.WeeklyProj?.currentWeek?.() ?? root.S?.nflState?.week ?? null;
        const finite = n => n !== null && n !== undefined && Number.isFinite(Number(n)) ? Number(n) : null;
        function entry(pid, pos, value) {
            const p = players?.[pid] || {};
            const injury = String(p.injury_status || '').toUpperCase();
            const bye = root.App?.NFLByes?.weekForPlayer?.(p, Number(league?.season));
            const unavailable = reserve.has(String(pid)) ? 'Reserve / taxi'
                : !p.team || ['FA','FA*'].includes(p.team) ? 'No NFL team'
                : ['OUT','IR','PUP','SUS','SUSPENDED','DOUBTFUL','NA','COV'].includes(injury) ? injury
                : p.active === false || ['Inactive','Retired'].includes(p.status) ? p.status || 'Inactive'
                : week != null && bye === Number(week) ? 'Bye'
                : !dynasty && p.position === 'QB' && Number(p.depth_chart_order) > 1 ? 'Backup QB' : null;
            let projection = null;
            try { projection = finite(options.project?.(String(pid))); } catch (_) { /* unknown projection */ }
            if (injury && !unavailable && !options.conditionalPids?.has(String(pid))) projection = null; // unresolved participation is not a probability haircut
            let rosPoints = null;
            try { rosPoints = finite(options.rosProject?.(String(pid))); } catch (_) { /* unknown ROS */ }
            return { rosPoints, pid: String(pid), pos: norm(pos || p.position || ''), name: p.full_name || p.last_name || String(pid), dhq: finite(value), projection, available: !unavailable, unavailable, injury: injury || null, depth: p.depth_chart_order ?? null, bye: bye ?? null };
        }
        const eligibilityRead = eligibility(league, roster);
        const owned = [...new Set((roster?.players || []).map(String))].map(pid => entry(pid, null, valueOf(pid)));
        const active = owned.filter(p => !reserve.has(p.pid));
        const known = eligibilityRead.ok && !!roster && Array.isArray(roster.players) && slots.length > 0 && owned.every(p => p.pos);
        const eligible = slot => flex[slot] || [slot];
        // Weighted matching: greedy by value over a transversal matroid. FLEX
        // reassignment ensures one player occupies only one legal starter slot.
        function lineup(pool, metric) {
            const ordered = pool.slice().sort((a,b) => (b[metric] ?? 0) - (a[metric] ?? 0));
            const assigned = new Map();
            const place = (i, seen) => {
                for (let j = 0; j < slots.length; j++) {
                    if (seen.has(j) || !eligible(slots[j]).includes(ordered[i].pos)) continue;
                    seen.add(j);
                    if (!assigned.has(j) || place(assigned.get(j), seen)) { assigned.set(j, i); return true; }
                }
                return false;
            };
            ordered.forEach((p,i) => { if (metric === 'coverage' || p[metric] != null) place(i,new Set()); });
            const starters = [...assigned.values()].map(i => ordered[i]);
            return { count: starters.length, total: starters.reduce((sum,p) => sum + (p[metric] ?? 0),0), pids: starters.map(p => p.pid) };
        }
        const usable = active.filter(p => p.available);
        const coverage = lineup(usable, 'coverage').count;
        const weeklyLocked = owned.some(p => ['live','locked','final'].includes(root.App?.WeeklyProj?.gameStatusFor?.(players?.[p.pid]?.team, week)));
        const beforeWeekly = lineup(usable, 'projection');
        const beforeSeason = lineup(active, 'dhq');
        const beforeRos = lineup(active, 'rosPoints');
        beforeWeekly.complete = !weeklyLocked && usable.every(p=>p.projection!=null);
        beforeSeason.complete = active.every(p=>p.dhq!=null);
        beforeRos.complete = active.every(p=>p.rosPoints!=null);
        const rows = [...new Set(slots.flatMap(eligible))].map(pos => {
            const group = usable.filter(p => p.pos === pos);
            return { pos, owned: owned.filter(p => p.pos === pos), actual: group.length, required: slots.filter(x => x === pos).length, fillsStarter: known && lineup([...usable,{pos}], 'coverage').count > coverage };
        });
        function fit(pos, value, candidate = {}) {
            const base = { need: null, gain: null, weeklyGain: null, seasonGain: null, dropPid: null, color: 'var(--silver)', score: 0, short: 'Hold', label: 'No measured starting-lineup improvement' };
            if (!known || !rows.some(r => r.pos === norm(pos))) return { ...base, short: 'Unknown', label: eligibilityRead.reason || 'Roster fit unavailable' };
            const add = entry(candidate.pid || '__candidate', pos, value);
            const candidateLocked = ['live','locked','final'].includes(root.App?.WeeklyProj?.gameStatusFor?.(players?.[add.pid]?.team, week));
            if ((weeklyLocked || candidateLocked) && options.horizon !== 'season') return { ...base, label: 'Current-week games have started or finished. A remaining-week lineup with verified locks is required; no full-week gain is assumed.' };
            if (!candidate.pid) return { ...base, short: 'Unknown', label: 'Select a player to compare a legal add/drop' };
            if ((eligibilityRead.owners?.[add.pid] || 0) >= (eligibilityRead.copies || 1) || owned.some(p => p.pid === add.pid)) return { ...base, label: 'Player is already owned in this league' };
            if ((options.lockedPids || league.locked_players || []).map(String).includes(add.pid)) return { ...base, label: 'Acquisition is locked for this player.' };
            if (!add.available && options.horizon !== 'season') return { ...base, label: add.unavailable + ': no immediate lineup help' };
            if (active.length > capacity) return { ...base, label: 'Resolve the existing roster overage before planning an add' };
            const drops = active.length < capacity ? [null] : active.filter(p => !protectedIds.has(p.pid)
                && root._playerTags?.[p.pid] !== 'untouchable' && !p.injury
                && p.dhq != null && add.dhq != null && p.dhq <= add.dhq);
            let best = null;
            for (const drop of drops) {
                const after = active.filter(p => p.pid !== drop?.pid).concat(add);
                const playable = after.filter(p => p.available);
                const completeWeekly = !weeklyLocked && !candidateLocked && usable.every(p => p.projection != null) && (!add.available || add.projection != null);
                const completeSeason = active.every(p => p.dhq != null) && add.dhq != null;
                const weeklyGain = completeWeekly ? +(lineup(playable,'projection').total - beforeWeekly.total).toFixed(2) : null;
                const seasonGain = completeSeason ? Math.round(lineup(after,'dhq').total - beforeSeason.total) : null;
                const rosGain = active.every(p=>p.rosPoints != null) && add.rosPoints != null ? +(lineup(after,'rosPoints').total - beforeRos.total).toFixed(1) : null;
                if (options.horizon === 'week' && !(weeklyGain > 0)) continue;
                if (options.horizon === 'season' && !(rosGain > 0)) continue;
                if (options.horizon === 'both' && !(weeklyGain != null && rosGain != null && weeklyGain >= 0 && rosGain >= 0 && (weeklyGain > 0 || rosGain > 0))) continue;
                const benchGain = dynasty && completeSeason ? Math.round(after.reduce((n,p)=>n+p.dhq,0)-active.reduce((n,p)=>n+p.dhq,0)) : null;
                if (!(weeklyGain > 0) && !(seasonGain > 0) && !(benchGain > 0) && !(options.horizon && rosGain > 0)) continue;
                // Do not fix one slot by opening another, or sell a higher-valued
                // seasonal asset for a one-week bump without explicit owner choice.
                if (lineup(playable,'coverage').count < coverage) continue;
                const next = { conditional: !add.available || weeklyGain == null || !options.locksVerified, beforeWeekly: beforeWeekly.complete ? beforeWeekly.total : null, afterWeekly: completeWeekly ? lineup(playable,'projection').total : null, availabilityNote: !add.available ? add.unavailable + ': season upside assumes availability; return timing is not established.' : null, rosGain, candidateRosPoints: add.rosPoints, weeklyGain, seasonGain, benchGain, dropPid: drop?.pid || null, dropName: drop?.name || null, candidateProjection: add.projection, dropProjection: drop?.projection ?? null, dropValue: drop?.dhq ?? null, requiresLockCheck: true };
                if (options.horizon === 'season') {
                    if (!best || next.rosGain > best.rosGain || next.rosGain === best.rosGain && ((next.weeklyGain ?? -Infinity) > (best.weeklyGain ?? -Infinity) || next.weeklyGain === best.weeklyGain && (next.dropProjection ?? Infinity) < (best.dropProjection ?? Infinity))) best = next;
                    continue;
                }
                if (!best || (next.weeklyGain ?? 0) > (best.weeklyGain ?? 0) || (next.weeklyGain ?? 0) === (best.weeklyGain ?? 0) && ((next.seasonGain ?? 0) > (best.seasonGain ?? 0) || (next.seasonGain ?? 0) === (best.seasonGain ?? 0) && (next.dropValue ?? 0) < (best.dropValue ?? 0))) best = next;
            }
            if (!best) return { ...base, label: drops.length ? base.label : 'No safe drop identified; review roster space or protected players' };
            const weekly = best.weeklyGain > 0;
            const gain = options.horizon === 'season' ? best.rosGain : weekly ? best.weeklyGain : best.seasonGain > 0 ? best.seasonGain : best.benchGain;
            const benchOnly = dynasty && !weekly && !(best.seasonGain > 0);
            const fills = rows.find(r => r.pos === norm(pos))?.fillsStarter;
            return { ...base, ...best, gain, metric: weekly ? 'projected points this week' : dynasty ? 'dynasty value' : 'ROS starter value', score: benchOnly ? 1 : fills ? 4 : 3, short: benchOnly ? 'Dynasty stash' : fills ? 'Coverage' : 'Starter upgrade', need: fills ? {pos, urgency:'deficit'} : null, color: 'var(--good)',
                label: (best.conditional ? 'Conditional: ' : '') + '+' + gain + ' ' + (weekly ? 'projected lineup points this week' : benchOnly ? 'dynasty bench value; no starting-lineup gain' : dynasty ? 'dynasty value in your starting lineup' : 'ROS value in your starting lineup') + (best.dropName ? ' · possible drop: ' + best.dropName : ' · open roster spot') + (best.weeklyGain == null ? ' · Weekly downside unknown; recommendation paused.' : ' · Weekly lineup change: ' + (best.weeklyGain > 0 ? '+' : '') + best.weeklyGain) + (best.availabilityNote ? ' · ' + best.availabilityNote : '') + (!options.locksVerified ? ' · Verify acquisition and drop locks on your league platform.' : '') };
        }
        return { known, reason: eligibilityRead.reason || null, owned, rows, coverage, total: slots.length, fit, week, beforeWeekly, beforeSeason, beforeRos };
    }
    root.App = root.App || {};
    root.App.buildFaRosterRead = buildFaRosterRead;
    root.App.RecommendationEligibility = { check: eligibility };
    // A healthy-production scenario is evidence, but never an availability probability.
    // Keep the canonical forecast intact; acquisition previews label this assumption.
    root.App.RosterForecastScenario = {
        adapt(projection) {
            if (!projection?.availabilityUnknown || projection.scoringSupport?.supported === false
                || !projection.statLine?.median || projection.conditionalPoints?.median == null
                || !Number.isFinite(Number(projection.conditionalPoints.median))) return projection;
            return { ...projection, available: true, points: { ...projection.conditionalPoints }, conditionalParticipation: true };
        },
        notice(projections, players, roster) {
            const owned = new Set((roster?.players || []).map(String));
            const names = Object.entries(projections || {}).filter(([pid,p]) => owned.has(pid) && p?.conditionalParticipation)
                .map(([pid]) => players?.[pid]?.full_name || pid);
            return names.length ? 'If they play: ' + names.join(', ') + '. These lineup comparisons assume normal participation; availability is unconfirmed.' : null;
        }
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = buildFaRosterRead;

})(typeof window !== 'undefined' ? window : globalThis);
