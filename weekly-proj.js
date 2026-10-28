// ══════════════════════════════════════════════════════════════════
// js/shared/weekly-proj.js — window.App.WeeklyProj
// Client accessor that turns whatever weekly context we have into
// league-scored start/sit projections via the shared App.StartSit engine.
//
// PROGRESSIVE ENHANCEMENT: works TODAY off local data (season stats +
// recent weekly-points form), with neutral matchup/Vegas. When the
// refresh-projections edge function + player_week_projections table land,
// setContext() feeds real DvP/Vegas/injury and the same code path lights up.
//
// All scoring flows through calcFantasyPts(statLine, scoring) so every
// league's exact rules (PPR / SF / IDP / yardage bonuses) are honored.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const SS = () => App.StartSit;

    // External weekly context, keyed by `${nflTeam}|${week}`: { dvpMult, vegas:{impliedTotal,spread,opp}, injury:{pid:status} }.
    // Empty until the edge function populates it — projections stay neutral.
    const _ctx = { byTeamWeek: {}, byPid: {} };

    function setContext(ctx) {
        if (!ctx) return;
        if (ctx.byTeamWeek) Object.assign(_ctx.byTeamWeek, ctx.byTeamWeek);
        if (ctx.byPid) Object.assign(_ctx.byPid, ctx.byPid);
    }
    function teamWeekCtx(team, week) {
        return _ctx.byTeamWeek[`${String(team || '').toUpperCase()}|${week}`] || null;
    }

    // Opponent NFL team for a player's team in a given week — prefers the live
    // NFL context (ESPN scoreboard), then falls back to the SOS engine's
    // derived schedule so FUTURE weeks (no live context yet) still resolve an
    // opponent for matchup grading + the season schedule rail.
    function opponentTeam(team, week, ctx) {
        const T = String(team || '').toUpperCase();
        if (ctx && ctx.opp) return String(ctx.opp).toUpperCase();
        const sch = App.SOS && App.SOS.schedule;
        return (sch && sch[week] && sch[week][T]) ? String(sch[week][T]).toUpperCase() : null;
    }

    // Defense-vs-position multiplier from the SOS engine's per-position defense
    // rankings (1 = toughest defense → suppress production; 32 = softest →
    // boost). Neutral (1.0) until App.SOS.initialize() resolves, and for
    // positions SOS doesn't rank (K/DEF/IDP). This is the real DvP layer the
    // engine was built for — no backend projections table required.
    function dvpMultFor(oppTeam, pos) {
        const ranks = App.SOS && App.SOS.defenseRankings;
        if (!ranks || !oppTeam) return 1;
        const P = String(pos || '').toUpperCase();
        if (P !== 'QB' && P !== 'RB' && P !== 'WR' && P !== 'TE') return 1;
        const rank = ranks[oppTeam] && ranks[oppTeam]['vs' + P];
        if (!(rank > 0)) return 1;
        // rank 16.5 → 1.0 · rank 1 (toughest) → ~0.86 · rank 32 (softest) → ~1.14
        const mult = 1 + ((rank - 16.5) / 15.5) * 0.14;
        return Math.max(0.82, Math.min(1.18, mult));
    }

    function currentWeek() {
        const s = root.S || {};
        const w = Number(s.nflState?.week || s.currentWeek || s.nflState?.display_week || 0);
        return w > 0 ? w : 1;
    }

    // ── Provider weekly projections (Sleeper) ─────────────────────────
    // https://api.sleeper.app/v1/projections/nfl/regular/{season}/{week}
    // returns raw projected STAT LINES by pid (same stat keys as Sleeper
    // stats), so they score through the exact same league-scoring path as
    // everything else (owner tenet: league rules, never generic points).
    // This is what makes ROOKIES projectable — no NFL history required
    // (owner ask 2026-07-12: "projected should look at the upcoming week").
    // Lazily fetched once per (season, week), cached in-module; consumers
    // hear 'wr:projections-loaded' and recompute.
    // Raw provider snapshots: 15 minute success TTL, 30 second failure backoff.
    // Failures are retryable; request identity prevents pre-refresh completions
    // from replacing a fresh snapshot. No calculation timestamp is a fetch time.
    const PROJECTION_TTL_MS = 15 * 60 * 1000, RETRY_MS = 30 * 1000;
    const _providers = new Map(); let _generation = 0;
    function providerSeason() {
        const s = root.S || {};
        const lg = (s.leagues || []).find(l => String(l.league_id || l.id) === String(s.currentLeagueId)) || s.league;
        return String(lg?.season || s.nflState?.season || new Date().getFullYear());
    }
    function providerKey(season, week) { return String(root.S?.currentLeagueId || '') + '|' + season + '|' + week; }
    function invalidate() { _generation++; _providers.clear(); _ctx.byTeamWeek = {}; _ctx.byPid = {}; }
    function freshness(week, season = providerSeason()) {
        const row = _providers.get(providerKey(season, week));
        return { fetchedAt: row?.fetchedAt ?? null, providerAsOf: row?.providerAsOf ?? null,
            expiresAt: row?.fetchedAt ? row.fetchedAt + PROJECTION_TTL_MS : null, error: row?.error || null };
    }
    function ensureWeekProjections(week, options = {}) {
        const w = Number(week) || currentWeek(), season = String(options.season || providerSeason());
        const key = providerKey(season, w), now = Date.now(), old = _providers.get(key);
        if (old?.fetching) return old.fetching;
        if (!options.force && old?.byPid && now - old.fetchedAt < PROJECTION_TTL_MS) return Promise.resolve(old.byPid);
        if (!options.force && old?.retryAt > now) return Promise.resolve(null);
        if (typeof root.fetch !== 'function') return Promise.resolve(null);
        const generation = _generation, leagueId = String(root.S?.currentLeagueId || '');
        const row = { byPid: null, fetchedAt: null, providerAsOf: null };
        _providers.set(key, row);
        row.fetching = Promise.resolve().then(() => root.fetch('https://api.sleeper.app/v1/projections/nfl/regular/' + season + '/' + w))
            .then(r => { if (!r?.ok) throw new Error('Projection fetch failed'); return r.json(); })
            .then(map => {
                if (!map || Array.isArray(map) || typeof map !== 'object' || !Object.keys(map).length) throw new Error('Projections not published');
                if (generation !== _generation || _providers.get(key) !== row) return null;
                row.byPid = map; row.fetchedAt = Date.now();
                if (leagueId === String(root.S?.currentLeagueId || '')) {
                    try { root.dispatchEvent(new CustomEvent('wr:projections-loaded', { detail: { leagueId, season, week: w } })); } catch (_) { /* headless */ }
                }
                return map;
            }).catch(error => { if (_providers.get(key) === row) { row.error = error.message; row.retryAt = Date.now() + RETRY_MS; } return null; })
            .finally(() => { row.fetching = null; });
        return row.fetching;
    }
    function decisionHorizon(league, options = {}) {
        const week = Number(options.week) || currentWeek(), settings = league?.settings || {};
        const playoffStart = Number(settings.playoff_week_start) || 15;
        const rounds = Number(settings.playoff_teams) > 1 ? Math.ceil(Math.log2(Number(settings.playoff_teams))) : null;
        const explicitEnd = Number(settings.playoff_end_week || settings.end_week);
        const end = Math.min(18, explicitEnd || (rounds ? playoffStart + rounds - 1 : 17));
        const games = options.games || Object.values(_ctx.byTeamWeek).filter(g => Number(g.week) === week);
        const states = games.map(g => App.NflContext?.gameStatus?.(g) || 'unknown');
        const completed = states.length > 0 && states.every(state => state === 'final');
        const upcoming = states.length > 0 && states.every(state => state === 'upcoming');
        const offseason = league?.status === 'complete' || root.S?.nflState?.season_type === 'post';
        const from = offseason ? end + 1 : week + (completed ? 1 : 0);
        return { week, fromWeek: from, endWeek: end, regularEnd: playoffStart - 1,
            tradeFromWeek: upcoming && Number(settings.trade_review_days ?? 0) === 0 ? from : Math.max(from, week + 1),
            weeks: Array.from({length: Math.max(0, end - from + 1)}, (_,i) => from + i),
            timingKnown: states.length > 0 && states.every(state => state !== 'unknown'),
            assumption: explicitEnd ? null : rounds ? 'Championship cutoff assumes one-week playoff rounds from the configured playoff start and team count.' : 'Fantasy season end assumed Week 17; no verified championship cutoff supplied.' };
    }
    // Published provider line for a pid, or null. Pre-season most rows are
    // all-zero shells until analysts publish — only trust lines with real
    // projected volume. A cold cache self-warms (fire-and-forget fetch).
    function meaningfulProviderLine(line) {
        if (!line || typeof line !== 'object') return null;
        const vol = Number(line.pts_ppr) || Number(line.pts_std) || Number(line.pass_att) || Number(line.rush_att) || Number(line.rec_tgt) || Number(line.rec) || Number(line.idp_tkl) || Number(line.sack) || Number(line.int) || Number(line.fga) || Number(line.xpm) || 0;
        return vol > 0 ? line : null;
    }
    function providerLine(pid, week) {
        const w = Number(week) || currentWeek();
        const row = _providers.get(providerKey(providerSeason(), w));
        if (!row?.byPid || Date.now() - row.fetchedAt >= PROJECTION_TTL_MS) { ensureWeekProjections(w); return null; }
        return meaningfulProviderLine(row.byPid[pid]);
    }

    // Build league-scored histories independently of fantasy roster ownership.
    // Matchup actuals remain authoritative where present; raw NFL game logs
    // fill gaps for free agents / recent pickups and identify genuine zero games.
    function weeklyPointsScope(leagueId, season, scoring) {
        return [String(leagueId), String(season), JSON.stringify(Object.entries(scoring || {}).sort(([a], [b]) => a.localeCompare(b)))].join('|');
    }
    function playedStatLine(raw, scoring) {
        if (!raw || typeof raw !== 'object') return false;
        if (['gp', 'off_snp', 'def_snp', 'st_snp', 'pass_att', 'rush_att', 'rec_tgt', 'fga', 'xpa'].some(key => Number(raw[key]) > 0)) return true;
        return Object.keys(scoring || {}).some(key => Number(scoring[key]) !== 0 && Number.isFinite(Number(raw[key])) && Number(raw[key]) !== 0);
    }
    async function loadWeeklyPoints({ leagueId, season, throughWeek, scoring, previousPoints = {}, previousPlayed = {}, fetcher = root.fetch }) {
        if (typeof fetcher !== 'function') throw new Error('Weekly stats fetch unavailable');
        const points = {}, played = {};
        let complete = true;
        const weeks = Array.from({ length: Math.max(0, Math.min(18, Number(throughWeek) || 0)) }, (_, i) => i + 1);
        const get = async url => {
            try { const response = await fetcher(url); return response.ok ? await response.json() : null; }
            catch (_) { return null; }
        };
        await Promise.all(weeks.map(async week => {
            const [raw, matchups] = await Promise.all([
                get('https://api.sleeper.app/v1/stats/nfl/regular/' + season + '/' + week),
                get('https://api.sleeper.app/v1/league/' + leagueId + '/matchups/' + week),
            ]);
            const rawReady = raw && !Array.isArray(raw) && Object.keys(raw).length > 0;
            const matchupReady = Array.isArray(matchups) && matchups.length > 0;
            if (!rawReady || !matchupReady) complete = false;
            const wk = { ...(previousPoints[week] || {}) }, participation = { ...(previousPlayed[week] || {}) };
            if (rawReady && scoring && Object.keys(scoring).length) Object.entries(raw).forEach(([pid, line]) => {
                const didPlay = playedStatLine(line, scoring);
                participation[pid] = didPlay;
                if (!didPlay) { delete wk[pid]; return; }
                if (!matchupReady && Number.isFinite(previousPoints[week]?.[pid])) return;
                // Raw stat keys match the league's scoring keys, including return
                // yards, first downs and position bonuses. Keep full precision.
                const total = root.calcFantasyPts?.(line, scoring, root.S?.players?.[pid]?.position);
                if (Number.isFinite(total)) wk[pid] = Math.round(total * 100) / 100;
            });
            if (matchupReady) matchups.forEach(row => Object.entries(row?.players_points || {}).forEach(([pid, value]) => {
                if (value == null || value === '' || !Number.isFinite(Number(value))) return;
                const pts = Number(value);
                if (pts !== 0 || participation[pid] === true) {
                    wk[pid] = pts;
                    participation[pid] = true;
                } else if (rawReady) {
                    // An inactive roster placeholder is not a played zero game.
                    delete wk[pid];
                    participation[pid] = false;
                }
            }));
            points[week] = wk;
            played[week] = participation;
        }));
        return { points, played, complete };
    }

    // Histories contain completed regular-season games in the active league.
    // Missing data is unavailable, while genuine zero and negative games count.
    function weeklyHistory(pid) {
        const state = root.S || {};
        if (state.weeklyPlayerPointsLeagueId != null && state.currentLeagueId != null && String(state.weeklyPlayerPointsLeagueId) !== String(state.currentLeagueId)) return [];
        if (state.weeklyPlayerPointsSeason != null && state.season != null && String(state.weeklyPlayerPointsSeason) !== String(state.season)) return [];
        const wpp = state.weeklyPlayerPoints || {};
        const through = state.weeklyPlayerPointsThroughWeek ?? (Number(state.currentWeek) > 0 ? Number(state.currentWeek) - 1 : 18);
        return Object.keys(wpp).map(Number).filter(week => week > 0 && week <= through).sort((a, b) => a - b).flatMap(week => {
            const value = wpp[week]?.[pid];
            if (value == null || value === '' || !Number.isFinite(Number(value)) || state.weeklyPlayerPlayed?.[week]?.[pid] === false) return [];
            return [{ week, pts: Number(value) }];
        });
    }

    function formStats(pid, lastN) {
        const hist = weeklyHistory(pid);
        if (!hist.length) return null;
        const n = lastN === 'season' || !lastN ? hist.length : Math.max(1, Number(lastN) || 5);
        const recent = hist.slice(-n);
        return {
            rollingPPG: +(recent.reduce((sum, game) => sum + game.pts, 0) / recent.length).toFixed(1),
            high: +Math.max(...hist.map(game => game.pts)).toFixed(1),
            low: +Math.min(...hist.map(game => game.pts)).toFixed(1),
            games: hist.length,
            recentCount: recent.length,
        };
    }

    function recentPPG(pid, week, lookback) {
        const recent = weeklyHistory(pid).filter(game => game.week < week).slice(-(lookback || 3));
        return recent.length ? recent.reduce((sum, game) => sum + game.pts, 0) / recent.length : null;
    }

    // Build a per-game baseline STAT LINE for a player: blend current-season
    // and prior-season per-game lines, then nudge by recent-form ratio.
    function buildBaseline(pid, season, prior, scoring, week) {
        const ss = SS();
        const seasonGp = Number(season && season.gp) || 0;
        const seasonLine = ss.perGameLine(season, seasonGp);
        const priorLine = ss.perGameLine(prior, Number(prior && prior.gp) || 0);

        // Lean on prior early in the year; lean on this season as games accrue.
        const seasonW = Math.min(seasonGp, 6) / 6 * 0.75 + (seasonGp > 0 ? 0.05 : 0);
        const priorW = 0.35;
        let line = ss.blendLines([{ line: seasonLine, weight: seasonW }, { line: priorLine, weight: priorW }]);
        if (!line) return null;

        // Recent-form multiplier (hot/cold) from weekly points vs season PPG.
        if (App.calcPPG && season) {
            const seasonPPG = App.calcPPG(season, scoring);
            const recent = recentPPG(pid, week, 3);
            if (seasonPPG > 2 && recent != null) {
                const factor = Math.max(0.7, Math.min(1.4, recent / seasonPPG));
                line = ss.scaleLine(line, factor);
            }
        }
        return line;
    }

    // Season-long baseline for ROS/redraft values: the provider's SEASON
    // projection line is the shared public baseline (role-, depth- and
    // rookie-aware, identical for every league — the league differentiates by
    // SCORING it, never by changing it), and actual play takes over as games
    // accrue. preW is the preseason projection weight; its influence decays
    // linearly to zero by 6 games played, mirroring buildBaseline's own
    // season ramp. Falls back cleanly: no projection row → historical blend;
    // no history (rookies) → pure projection line.
    function buildSeasonBaseline(pid, season, prior, projSeason, scoring, week, preW) {
        const ss = SS();
        if (!ss) return null;
        const projLine = ss.perGameLine(projSeason, Number(projSeason && projSeason.gp) || 18);
        const hist = buildBaseline(pid, season, prior, scoring, week);
        if (!projLine) return hist;
        if (!hist) return projLine;
        const seasonGp = Number(season && season.gp) || 0;
        const w = (preW == null ? 0.85 : preW) * Math.max(0, 1 - seasonGp / 6);
        if (w <= 0) return hist;
        return ss.blendLines([{ line: projLine, weight: w }, { line: hist, weight: 1 - w }]);
    }

    // A player with no NFL team has no game to play — in any week.
    // Sleeper leaves `team` null for one (sometimes the literal 'FA'), carries
    // no bye_week, and keeps status 'Active' (that is ROSTER status, not a
    // team), so none of the checks below caught it: an unsigned back scored a
    // full projection off last season's baseline and got recommended as a
    // start. Owner report 2026-09-06: Kareem Hunt (pid 4098, team null)
    // projected ~13 points while a free agent.
    const NO_NFL_TEAM = new Set(['', 'FA', 'FA*', 'NONE', 'NULL', 'UNDEFINED']);
    function hasNflTeam(player) {
        const t = String((player && player.team) || '').trim().toUpperCase();
        return !t ? false : !NO_NFL_TEAM.has(t);
    }

    function isByeOrOut(player, ctx, pid, week) {
        const sleeperStatus = (player && player.injury_status) || '';
        const ctxStatus = ctx && ctx.injury && ctx.injury[pid];
        // Checked before bye/injury so the reason surfaces as "FA" rather than
        // an empty status the UI would render as playable.
        if (!hasNflTeam(player)) return 'FA';
        const byeWeek = App.NFLByes ? App.NFLByes.weekForPlayer(player, providerSeason()) : Number(player && player.bye_week);
        if (byeWeek === Number(week)) return 'BYE';
        return ctxStatus || sleeperStatus || '';
    }

    // Project one player for a given week, scored through `scoring`.
    function projectPlayer(pid, { playersData, statsData, priorData, scoring, week, providerProjections, projectionsData }) {
        const ss = SS();
        if (!ss || !pid) return null;
        const player = (playersData && playersData[pid]) || null;
        const pos = (App.normPos && App.normPos(player && player.position)) || (player && player.position) || '';
        const season = (statsData && statsData[pid]) || null;
        const prior = (priorData && priorData[pid]) || null;
        // Provider analyst line anchors the baseline when published (already a
        // single-week line) — the internal season/prior blend is the fallback.
        // Scenario callers supply an isolated provider snapshot. An explicit
        // empty map deliberately uses the fallback without touching the live
        // one-week cache or dispatching projection refresh events.
        const prov = providerProjections !== undefined
            ? meaningfulProviderLine(providerProjections && providerProjections[pid])
            : providerLine(pid, week);
        const baseline = prov || (projectionsData
            ? buildSeasonBaseline(pid, season, prior, projectionsData[pid], scoring, week)
            : buildBaseline(pid, season, prior, scoring, week));

        const team = player && player.team;
        const ctx = teamWeekCtx(team, week);
        const oppTeam = opponentTeam(team, week, ctx);
        const injuryStatus = isByeOrOut(player, ctx, pid, week);

        // Blend any live-context DvP with the SOS-derived defense-vs-position
        // multiplier (real DvP layer). Neutral 1.0 when SOS isn't ready — and
        // neutral for provider lines, which are already matchup-aware (no
        // double-counting the opponent).
        const ctxDvp = ctx && Number.isFinite(ctx.dvpMult) ? ctx.dvpMult : 1;
        const dvpMult = prov ? 1 : (ctxDvp !== 1 ? ctxDvp : 1) * dvpMultFor(oppTeam, pos);

        const proj = ss.projectPlayerWeek({
            pid, week, position: pos, baseline,
            dvpMult,
            vegas: ctx ? ctx.vegas : null,
            weather: ctx ? ctx.weather : null,
            opponent: ctx
                ? { abbr: ctx.opp, home: ctx.home, impliedTotal: ctx.vegas && ctx.vegas.impliedTotal, spread: ctx.vegas && ctx.vegas.spread }
                : (oppTeam ? { abbr: oppTeam } : null),
            injuryStatus,
            roleNote: ctx ? ctx.roleNote : '',
        });
        return ss.scoreProjection(proj, scoring);
    }

    function projectRoster(playerIds, opts) {
        const out = {};
        (playerIds || []).forEach(pid => { const p = projectPlayer(pid, opts); if (p) out[pid] = p; });
        return out;
    }

    // ── "Why this number" ledger ─────────────────────────────────────
    // Re-runs the projectPlayer pipeline one stage at a time, scoring each
    // intermediate stat line, so the UI can show the build-up instead of a
    // bare number. Deltas are league-scored points. The final row scores the
    // SAME median stat line under a neutral 0.5-PPR baseline — the honest
    // version of "consensus": identical stat line, your rules vs generic.
    const STANDARD_SCORING = {
        pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
        rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
        rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
        fum_lost: -2,
    };
    function explainPlayer(pid, opts) {
        const ss = SS();
        if (!ss || !pid) return null;
        const { playersData, statsData, priorData, scoring } = opts || {};
        const week = (opts && opts.week) || currentWeek();
        const player = (playersData && playersData[pid]) || null;
        const pos = (App.normPos && App.normPos(player && player.position)) || (player && player.position) || '';
        const season = (statsData && statsData[pid]) || null;
        const prior = (priorData && priorData[pid]) || null;
        const prov = providerLine(pid, week);
        const baseline = prov || buildBaseline(pid, season, prior, scoring, week);
        if (!baseline) return null;

        const team = player && player.team;
        const ctx = teamWeekCtx(team, week);
        const oppTeam = opponentTeam(team, week, ctx);
        const injuryStatus = isByeOrOut(player, ctx, pid, week);
        const avail = ss.availability(injuryStatus);

        const ctxDvp = ctx && Number.isFinite(ctx.dvpMult) ? ctx.dvpMult : 1;
        const dvpMult = prov ? 1 : (ctxDvp !== 1 ? ctxDvp : 1) * dvpMultFor(oppTeam, pos);
        const vegas = ctx ? ctx.vegas : null;
        const weather = ctx ? ctx.weather : null;

        // scoreProjection handles TE-premium; wrap one line in a throwaway proj.
        // opts.calcFn lets Node tests inject a scorer (browser uses the global).
        const scoreLine = (line, rules) =>
            ss.scoreProjection({ position: pos, statLine: { median: line, floor: null, ceiling: null } }, rules, opts && opts.calcFn).points.median;

        const stages = [];
        let line = baseline;
        let pts = scoreLine(line, scoring);
        const dvpRank = (() => {
            const r = App.SOS && App.SOS.defenseRankings;
            const v = r && oppTeam && r[oppTeam] && r[oppTeam]['vs' + pos];
            return v > 0 ? v : null;
        })();
        stages.push({
            key: 'base',
            label: prov ? 'Analyst line' : 'Usage baseline',
            detail: prov
                ? 'Sleeper weekly projection — already matchup-aware'
                : 'Season + prior-year per-game blend, recent-form adjusted',
            pts, delta: null,
        });

        const step = (key, label, detail, nextLine) => {
            const nextPts = scoreLine(nextLine, scoring);
            stages.push({ key, label, detail, pts: nextPts, delta: nextPts - pts });
            line = nextLine; pts = nextPts;
        };

        if (!prov) {
            step('dvp', 'Matchup — DvP',
                oppTeam
                    ? ('vs ' + oppTeam + (dvpRank ? ' — allows rank ' + dvpRank + ' fantasy pts to ' + pos : ' — defense-vs-position'))
                    : 'No opponent resolved — neutral',
                ss.applyMatchup(line, dvpMult));
        }
        step('vegas', 'Vegas',
            (vegas && Number.isFinite(Number(vegas.impliedTotal)))
                ? ('Implied total ' + vegas.impliedTotal + (Number.isFinite(Number(vegas.spread)) ? ' · spread ' + (vegas.spread > 0 ? '+' : '') + vegas.spread : ''))
                : 'No line available — neutral',
            ss.applyVegas(line, pos, vegas));
        step('weather', 'Weather',
            weather ? (weather.indoor ? 'Dome — no adjustment' : (weather.display || 'Outdoor') + (weather.temp != null ? ' · ' + Math.round(weather.temp) + '°' : '')) : 'No report — neutral',
            weather ? ss.applyWeather(line, weather) : line);
        step('avail', 'Injury / availability',
            injuryStatus ? String(injuryStatus) : 'No designation',
            avail.mult !== 1 ? ss.scaleLine(line, avail.mult) : line);

        const standardPts = scoreLine(line, STANDARD_SCORING);
        // Round once, then derive the edge from the ROUNDED pair — the three
        // displayed numbers must reconcile exactly (17.8 − 13.1 = 4.7, never
        // 4.8 from hidden precision).
        const leagueR = Math.round(pts * 10) / 10;
        const standardR = Math.round(standardPts * 10) / 10;
        return {
            pid, week, position: pos, opponent: oppTeam || null,
            provider: !!prov,
            injuryStatus: injuryStatus || '',
            stages,
            leaguePts: leagueR,
            standardPts: standardR,
            scoringEdge: Math.round((leagueR - standardR) * 10) / 10,
        };
    }

    // GM mode → optimization objective. win_now plays it safe (floor),
    // rebuild chases upside (ceiling), everyone else optimizes the median.
    function objectiveForMode(mode) {
        if (mode === 'win_now') return 'floor';
        if (mode === 'rebuild') return 'ceiling';
        return 'median';
    }
    function modeFor(leagueId) {
        try { return (App.WR && App.WR.GmMode && App.WR.GmMode.effects(leagueId).mode) || (root.WR && root.WR.GmMode && root.WR.GmMode.effects(leagueId).mode) || 'compete'; }
        catch (e) { return 'compete'; }
    }

    // Optimal weekly lineup for a roster + the delta vs current starters.
    // roster: { players:[], starters:[], reserve:[], taxi:[] }
    function optimalForRoster(roster, currentLeague, opts) {
        const ss = SS();
        opts = opts || {};
        const scoring = (currentLeague && currentLeague.scoring_settings) || {};
        const rosterPositions = (currentLeague && currentLeague.roster_positions) || [];
        const week = opts.week || currentWeek();
        const leagueId = (currentLeague && (currentLeague.league_id || currentLeague.id)) || '';
        const mode = opts.mode || modeFor(leagueId);
        const objective = opts.objective || objectiveForMode(mode);

        const resSet = new Set((roster && roster.reserve) || []);
        const taxiSet = new Set((roster && roster.taxi) || []);
        const ids = ((roster && roster.players) || []).filter(id => id && !resSet.has(id) && !taxiSet.has(id));

        const projections = projectRoster(ids, { playersData: opts.playersData, statsData: opts.statsData, priorData: opts.priorData, scoring, week });
        const scoreOf = pid => { const p = projections[pid]; return p && p.available ? (p.points[objective] || 0) : 0; };

        const players = ids.map(pid => {
            const p = projections[pid];
            const pl = opts.playersData && opts.playersData[pid];
            return { pid, pos: (App.normPos && App.normPos(pl && pl.position)) || (pl && pl.position) || '', available: !!(p && p.available), pts: scoreOf(pid) };
        });

        const optimal = ss.optimalLineupWeekly(players, rosterPositions);
        const delta = ss.lineupDelta((roster && roster.starters) || [], optimal, scoreOf);
        return { week, mode, objective, scoring, projections, optimal, delta };
    }

    App.WeeklyProj = App.WeeklyProj || {
        gameStatusFor: (team, week) => App.NflContext?.gameStatus?.(teamWeekCtx(team, week)) || 'unknown',
        setContext, currentWeek, recentPPG, weeklyHistory, formStats, loadWeeklyPoints, weeklyPointsScope, buildBaseline, buildSeasonBaseline,
        projectPlayer, projectRoster, optimalForRoster, explainPlayer,
        ensureWeekProjections, providerLine, freshness, invalidate, decisionHorizon, PROJECTION_TTL_MS, RETRY_MS,
        objectiveForMode, modeFor,
        _ctx,
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.WeeklyProj;
})(typeof window !== 'undefined' ? window : globalThis);
