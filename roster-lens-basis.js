/* global module */
// Observed current-season averages are a comparison basis, never a forecast.
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const number = value => value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim() || !Number.isFinite(Number(value)) ? null : Number(value);
    const normalize = basis => ['projected', 'average', 'idp-average'].includes(basis) ? basis : 'projected';
    const normalizeWindow = value => ['3', '5'].includes(String(value)) ? String(value) : 'season';
    const windowLabel = value => normalizeWindow(value) === 'season' ? 'Season' : 'Last ' + normalizeWindow(value) + ' games';
    const position = value => ({ DE: 'DL', DT: 'DL', EDGE: 'DL', NT: 'DL', IDL: 'DL', ILB: 'LB', OLB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DST: 'DEF', 'D/ST': 'DEF' })[String(value || '').toUpperCase()] || String(value || '').toUpperCase();
    const hasIdp = league => (league?.roster_positions || []).some(slot => ['DL', 'LB', 'DB', 'IDP', 'IDP_FLEX'].includes(position(String(slot).trim())));
    const scoringKey = scoring => JSON.stringify(Object.entries(scoring || {}).sort(([a], [b]) => a.localeCompare(b)));
    const leagueId = opts => String(opts.league?.league_id || opts.league?.id || '');
    const platformOf = opts => String(opts.platform || opts.league?._platform || (opts.league?._mfl ? 'mfl' : opts.league?._espn ? 'espn' : opts.league?._yahoo ? 'yahoo' : root.S?.platform || 'sleeper'));
    function describe(basis, averageWindow) {
        const id = normalize(basis), window = normalizeWindow(averageWindow), period = window === 'season' ? 'Current-season' : windowLabel(window);
        return { id, label: ({ projected: 'Projected', average: 'Avg points', 'idp-average': 'IDP avg' })[id],
            averageWindow: window, windowLabel: windowLabel(window),
            description: id === 'projected' ? 'League-scored weekly projections.' : id === 'average' ? period + ' points per game with league scoring.' : period + ' average points for IDPs; offensive players and D/ST keep weekly projections.',
            seasonAvailable: id === 'projected' };
    }
    function sourceContext(opts) { return { leagueId: leagueId(opts), season: String(opts.league?.season || ''), scoringKey: scoringKey(opts.league?.scoring_settings) }; }
    function matches(context, opts) {
        const expected = sourceContext(opts);
        return !!context && ['leagueId', 'season', 'scoringKey'].every(key => String(context[key]) === expected[key]);
    }
    function currentAverage(pid, opts) {
        const league = opts.league || {}, season = String(league.season || ''), scoring = league.scoring_settings || {}, raw = opts.statsData?.[pid], averageWindow = normalizeWindow(opts.averageWindow);
        const missing = { value: null, games: null, season, averageWindow, source: windowLabel(averageWindow) + ' average unavailable' };
        if (!season) return missing;
        const native = raw?._mflScoring;
        if (native) {
            const average = number(native.average);
            if (averageWindow === 'season' && (opts.statsSeason == null || String(opts.statsSeason) === season) && String(native.season) === season && native.week == null && raw.week == null && native.scoringKey === scoringKey(scoring) && matches(opts.statsContext, opts) && average != null)
                return { value: average, games: number(native.games), season, averageWindow, source: 'MFL official season average' };
        }
        // MFL history may have been scored from flattened rule approximations.
        // Its scope alone cannot prove an authoritative native average.
        if (native || league._mfl || String(league._platform || '') === 'mfl' || leagueId(opts).startsWith('mfl_')) return missing;
        if (averageWindow !== 'season' && platformOf(opts) !== 'sleeper') return missing;
        if (opts.averageHistory) {
            const history = opts.averageHistory;
            if (!history.complete || !matches(history.context, opts) || number(history.throughWeek) !== completedThrough(opts)) return missing;
            const rows = Object.keys(history.points || {}).map(Number).filter(week => week > 0 && week <= history.throughWeek).sort((a, b) => a - b)
                .flatMap(week => { const value = number(history.points[week]?.[pid]); return value == null || history.played?.[week]?.[pid] === false ? [] : [value]; });
            const recent = averageWindow === 'season' ? rows : rows.slice(-Number(averageWindow));
            if (!recent.length) return missing;
            return { value: +(recent.reduce((sum, value) => sum + value, 0) / recent.length).toFixed(1), games: recent.length, season, averageWindow, source: 'Completed games · league scoring' };
        }
        const WP = App.WeeklyProj, expected = WP?.weeklyPointsScope?.(leagueId(opts), season, scoring);
        if (expected && root.S?.weeklyPlayerPointsScope === expected && (averageWindow === 'season' ? root.S?.weeklyPlayerPointsComplete !== false : completeState(opts))) {
            const form = WP.formStats?.(pid, averageWindow === 'season' ? 'season' : Number(averageWindow)), value = number(form?.rollingPPG);
            const games = number(averageWindow === 'season' ? form?.games : form?.recentCount);
            if (value != null && games > 0) return { value, games, season, averageWindow, source: 'Completed games · league scoring' };
        }
        // A recent-game request must never silently become a season average.
        if (averageWindow !== 'season' || opts.statsSeason != null && String(opts.statsSeason) !== season) return missing;
        if (!raw || typeof raw !== 'object' || raw.week != null || raw.season != null && String(raw.season) !== season) return missing;
        const games = number(raw.gp), pos = position((opts.players || opts.playersData)?.[pid]?.position);
        const hasScoredData = Object.keys(raw).some(key => !['gp', 'season', 'season_type', 'week', 'player_id', 'team_id'].includes(key) && number(raw[key]) != null);
        if (!(games > 0) || !hasScoredData || !Object.keys(scoring).length) return missing;
        let points = null, average = null;
        try {
            if (typeof App.LeagueStats?.score === 'function') points = number(App.LeagueStats.score(raw, scoring, pos));
            else {
                if (typeof App.calcRawPts === 'function') points = number(App.calcRawPts(raw, scoring));
                if (typeof App.calcPPG === 'function') average = number(App.calcPPG(raw, scoring));
            }
        } catch (_) { return missing; }
        // Some legacy calcPPG implementations clamp negative performances.
        // Canonical signed raw points divided by the verified GP preserves them.
        const value = points != null ? points / games : average;
        return { value, games, season, averageWindow, source: 'Current-season stats · league scoring' };
    }
    function comparison(pid, opts) {
        const basis = normalize(opts.basis), player = (opts.players || opts.playersData)?.[pid], pos = position(player?.position);
        const average = basis === 'average' || basis === 'idp-average' && ['DL', 'LB', 'DB'].includes(pos);
        const projected = opts.projected;
        if (!average) {
            const value = number(typeof projected === 'object' ? projected?.points?.median ?? projected?.median : projected);
            return { ...(projected && typeof projected === 'object' ? projected : {}), available: projected?.available !== false && value != null,
                points: { ...(projected?.points || {}), median: value }, comparisonBasis: 'projected', averageGames: null, averageSeason: null, averageWindow: null, averageSource: null };
        }
        const observed = currentAverage(pid, opts), week = number(opts.week), bye = App.NFLByes?.weekForPlayer?.(player, Number(opts.league?.season));
        const status = String(player?.injury_status || '').toUpperCase();
        const unavailable = !player?.team || ['FA', 'FA*'].includes(player.team) || player.active === false || ['Inactive', 'Retired'].includes(player.status)
            || ['OUT', 'IR', 'PUP', 'SUS', 'SUSPENDED', 'DOUBTFUL', 'DNP', 'NA', 'COV'].includes(status) || week != null && bye === week;
        return { available: !unavailable && observed.value != null, injuryStatus: week != null && bye === week ? 'BYE' : status,
            points: { median: observed.value }, statLine: { median: observed.value == null ? null : { observedAverage: observed.value } },
            comparisonBasis: 'average', averageGames: observed.games, averageSeason: observed.season, averageWindow: observed.averageWindow, averageSource: observed.source };
    }
    function adapt(opts) {
        if (normalize(opts.basis) === 'projected') return opts.projectionsByPid || {};
        return Object.fromEntries(Object.keys(opts.players || opts.playersData || {}).map(pid => [pid, comparison(pid, { ...opts, projected: opts.projectionsByPid?.[pid] })]));
    }
    function completedThrough(opts) {
        const current = number(opts.currentWeek) || number(App.WeeklyProj?.currentWeek?.()) || number(root.S?.currentWeek) || number(root.S?.nflState?.week);
        return current == null ? null : Math.max(0, Math.min(18, current - 1));
    }
    function completeState(opts) {
        const state = root.S || {}, expected = App.WeeklyProj?.weeklyPointsScope?.(leagueId(opts), opts.league?.season, opts.league?.scoring_settings);
        return state.weeklyPlayerPointsComplete === true && expected && state.weeklyPlayerPointsScope === expected
            && String(state.weeklyPlayerPointsLeagueId) === leagueId(opts) && String(state.currentLeagueId) === leagueId(opts)
            && String(state.weeklyPlayerPointsSeason) === String(opts.league?.season)
            && number(state.weeklyPlayerPointsThroughWeek) === completedThrough(opts);
    }
    const recentCache = new Map();
    async function prepare(opts) {
        if (normalize(opts.basis) === 'projected') return opts;
        const league = opts.league || {}, mfl = league._mfl || league._platform === 'mfl' || leagueId(opts).startsWith('mfl_');
        if (normalizeWindow(opts.averageWindow) !== 'season') {
            if (mfl || opts.averageHistory || completeState(opts)) return opts;
            const throughWeek = completedThrough(opts), context = sourceContext(opts), WP = App.WeeklyProj;
            const unavailable = { ...opts, averageHistory: { context, throughWeek, complete: false } };
            if (!(throughWeek > 0) || !leagueId(opts) || !league.season || typeof WP?.loadWeeklyPoints !== 'function' || platformOf(opts) !== 'sleeper') return unavailable;
            const owner = opts.accountKey || opts.accountId || (App.OD || root.OD)?.getCurrentUserId?.() || opts.userId || root.S?.user?.user_id || '';
            const key = JSON.stringify([owner, context, throughWeek]), existing = recentCache.get(key);
            if (existing && Date.now() - existing.at < 15 * 60 * 1000) return { ...opts, averageHistory: await existing.promise };
            const promise = Promise.resolve().then(() => WP.loadWeeklyPoints({ leagueId: leagueId(opts), season: league.season, throughWeek, scoring: league.scoring_settings }))
                .then(history => ({ ...history, context, throughWeek })).catch(() => ({ context, throughWeek, complete: false }));
            recentCache.set(key, { at: Date.now(), promise });
            if (recentCache.size > 8) recentCache.delete(recentCache.keys().next().value);
            const averageHistory = await promise;
            if (!averageHistory.complete) recentCache.delete(key);
            return { ...opts, averageHistory };
        }
        if (!mfl || matches(opts.statsContext, opts)) return opts;
        if (typeof root.MFL?.loadPlayerStats !== 'function') return opts;
        try {
            const response = await root.MFL.loadPlayerStats(league, { season: league.season, week: null, players: opts.players || opts.playersData || {} });
            if (response?.statsByPid) return { ...opts, statsData: response.statsByPid, statsSeason: league.season, statsContext: sourceContext(opts) };
        } catch (_) { /* unavailable stays distinct from zero */ }
        return opts;
    }
    const api = { normalize, normalizeWindow, windowLabel, position, hasIdp, describe, sourceContext, currentAverage, comparison, adapt, prepare };
    App.RosterLensBasis = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
