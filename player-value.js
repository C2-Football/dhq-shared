// ══════════════════════════════════════════════════════════════════
// js/utils/player-value.js — Shared player valuation constants and functions
// Single source of truth for: aging curves, pick values, roster construction
// targets, and the projectPlayerValue projection engine.
//
// Consumed by: league-detail.js, trade-calc.js
// Exposed as: window.App.PlayerValue
// ══════════════════════════════════════════════════════════════════

window.App.PlayerValue = (function () {

    // ── Roster construction targets ──────────────────────────────────
    const IDEAL_ROSTER = { QB:3, RB:7, WR:7, TE:4, K:2, DL:7, LB:6, DB:6 };
    const DRAFT_ROUNDS  = 7;
    const PICK_HORIZON  = 3;
    const PICK_IDEAL    = DRAFT_ROUNDS * PICK_HORIZON;

    const LINEUP_STARTERS    = { QB:1, RB:2, WR:3, TE:1, K:1, DL:3, LB:2, DB:3 };
    const MIN_STARTER_QUALITY = { QB:2, RB:3, WR:3, TE:2, K:1, DL:4, LB:5, DB:4 };
    const NFL_STARTER_POOL    = { QB:32, RB:40, WR:64, TE:32, K:32, DL:64, LB:64, DB:64 };
    const POS_PT_TARGETS      = { QB:20, RB:36, WR:36, TE:10, K:9, DL:24, LB:16, DB:24 };
    const POS_WEIGHTS         = { QB:14, RB:14, WR:14, TE:8, K:3, DL:13, LB:10, DB:12 };
    const TOTAL_WEIGHT        = Object.values(POS_WEIGHTS).reduce((a,b)=>a+b,0); // 88

    // ── Draft pick values (DHQ equivalent, used as fallback when DHQ engine absent) ──
    const PICK_VALUES = { 1:6250, 2:3150, 3:1650, 4:850, 5:450, 6:225, 7:125 };
    const PICK_COLORS = { 1:'var(--k-d4af37, #d4af37)', 2:'var(--k-5dade2, #5dade2)', 3:'var(--k-2ecc71, #2ecc71)', 4:'var(--k-bb8fce, #bb8fce)', 5:'var(--k-95a5a6, #95a5a6)', 6:'var(--k-7f8c8d, #7f8c8d)', 7:'var(--k-6c7a7d, #6c7a7d)' };

    // Slot-specific values (16-team × 7-round = 112 picks).
    // Dynamically generated from pick-value-model.js (industry consensus) when available.
    // Falls back to hardcoded table only if CDN script fails to load.
    const PICK_VALUES_BY_SLOT = (function() {
        if (typeof window.getIndustryPickValue === 'function') {
            const table = {};
            for (let pick = 1; pick <= 112; pick++) {
                table[pick] = window.getIndustryPickValue(pick, 16, 7);
            }
            return table;
        }
        // Emergency fallback — aligned with pick-value-model.js output
        return {
            1:7500, 2:6718, 3:6018, 4:5391, 5:4830, 6:4327, 7:3878, 8:3474,
            9:3113, 10:2789, 11:2499, 12:2240, 13:2007, 14:1799, 15:1612, 16:1445,
            17:1395, 18:1347, 19:1300, 20:1255, 21:1212, 22:1170, 23:1130, 24:1091,
            25:1053, 26:1017, 27:982, 28:948, 29:916, 30:884, 31:854, 32:824,
            33:796, 34:748, 35:703, 36:661, 37:621, 38:584, 39:549, 40:516,
            41:485, 42:456, 43:429, 44:403, 45:379, 46:356, 47:335, 48:315,
            49:296, 50:279, 51:262, 52:247, 53:232, 54:218, 55:205, 56:193,
            57:182, 58:171, 59:161, 60:151, 61:142, 62:134, 63:126, 64:119,
            65:112, 66:105, 67:99, 68:93, 69:88, 70:83, 71:78, 72:73,
            73:69, 74:65, 75:61, 76:58, 77:54, 78:51, 79:48, 80:45,
            81:43, 82:40, 83:38, 84:36, 85:34, 86:32, 87:30, 88:28,
            89:27, 90:25, 91:24, 92:22, 93:21, 94:20, 95:19, 96:18,
            97:17, 98:16, 99:15, 100:14, 101:13, 102:13, 103:12, 104:11,
            105:11, 106:10, 107:10, 108:9, 109:9, 110:8, 111:8, 112:7,
        };
    })();

    // Compute overall draft slot from slot_to_roster_id maps
    // draftSlotMaps = { year: { rosterId: slotInRound } }
    function getPickOverallSlot(year, round, fromRosterId, allRosters, draftSlotMaps) {
        if (!fromRosterId || !allRosters?.length) return null;
        const numTeams = allRosters.length;
        // Primary: Sleeper's authoritative slot_to_roster_id
        const yearMap = draftSlotMaps?.[Number(year)];
        if (yearMap) {
            const slotInRound = yearMap[String(fromRosterId)];
            if (slotInRound >= 1) return (round - 1) * numTeams + slotInRound;
        }
        // Fallback: waiver_position (set by Sleeper post-season as draft-order proxy)
        const roster = allRosters.find(r => String(r.roster_id) === String(fromRosterId));
        if (!roster) return null;
        const slotInRound = roster.settings?.waiver_position;
        if (slotInRound >= 1 && slotInRound <= numTeams) return (round - 1) * numTeams + slotInRound;
        return null;
    }

    // Resolve pick value — prefers shared/pick-value-model.js when available,
    // then slot-specific table, then round-average fallback.
    function resolvePickValue(year, round, fromRosterId, allRosters, draftSlotMaps) {
        const slot = getPickOverallSlot(year, round, fromRosterId, allRosters, draftSlotMaps);
        let value = PICK_VALUES[round] || 100;
        let resolvedSlot = null;
        if (slot) {
            if (window.getIndustryPickValue) {
                const numTeams = allRosters?.length || 12;
                const val = window.getIndustryPickValue(slot, numTeams, DRAFT_ROUNDS);
                if (val > 0) { value = val; resolvedSlot = slot; }
            }
            if (!resolvedSlot && PICK_VALUES_BY_SLOT[slot]) { value = PICK_VALUES_BY_SLOT[slot]; resolvedSlot = slot; }
        }
        // Future year discount: 12% per year (matches dhq-engine.js)
        const curYear = parseInt(window.S?.season) || new Date().getFullYear();
        const pickYear = parseInt(year) || curYear;
        const yearsAhead = Math.max(0, pickYear - curYear);
        if (yearsAhead > 0) value = Math.round(value * Math.pow(0.88, yearsAhead));
        return { value, slot: resolvedSlot };
    }

    // ── Aging curves ─────────────────────────────────────────────────
    // Max achievable DHQ per position (caps projection ceiling)
    const POS_CEILINGS = { QB:12000, RB:9000, WR:10500, TE:8500, DL:7000, LB:7000, DB:7000 };

    // Age curves and decay rates are owned by reconai/shared/constants.js.
    // Provide fallbacks with CDN-matching values in case constants.js hasn't loaded.
    window.App.ageCurveWindows = window.App.ageCurveWindows || {
        QB:{build:[23,27],peak:[28,34],decline:[35,38]},
        RB:{build:[21,22],peak:[23,25],decline:[26,28]},
        WR:{build:[22,24],peak:[25,28],decline:[29,31]},
        TE:{build:[23,25],peak:[26,29],decline:[30,32]},
        DL:{build:[22,24],peak:[25,29],decline:[30,32]},
        EDGE:{build:[22,24],peak:[25,29],decline:[30,32]},
        LB:{build:[22,23],peak:[24,28],decline:[29,31]},
        DB:{build:[21,23],peak:[24,27],decline:[28,30]},
        K:{build:[23,27],peak:[28,35],decline:[36,40]},
    };
    window.App.peakWindows = window.App.peakWindows || Object.fromEntries(
        Object.entries(window.App.ageCurveWindows).map(([pos, curve]) => [pos, curve.peak])
    );
    window.App.decayRates = window.App.decayRates || { QB:0.12, RB:0.22, WR:0.18, TE:0.16, K:0.08, DL:0.15, EDGE:0.15, LB:0.16, DB:0.18 };

    function pickValueBySlot(round, slotInRound, totalTeams, draftRounds) {
        const rd = Math.max(1, Number(round) || 1);
        const teams = Math.max(1, Number(totalTeams) || 12);
        const slot = Math.max(1, Number(slotInRound) || Math.ceil(teams / 2));
        const rounds = Math.max(1, Number(draftRounds) || DRAFT_ROUNDS);
        const overall = (rd - 1) * teams + slot;
        if (window.getPickValueBySlot) {
            const val = window.getPickValueBySlot(rd, slot, teams, rounds);
            if (val > 0) return val;
        }
        if (window.getIndustryPickValue) {
            const val = window.getIndustryPickValue(overall, teams, rounds);
            if (val > 0) return val;
        }
        if (PICK_VALUES_BY_SLOT[overall]) return PICK_VALUES_BY_SLOT[overall];
        return PICK_VALUES[rd] || 100;
    }

    // ── getPickValue ─────────────────────────────────────────────────
    // Returns DHQ-equivalent value for a draft pick. Delegates to DHQ engine when available.
    function getPickValue(season, round, totalTeams, slotInRound, draftRounds) {
        const teams = totalTeams || 12;
        const slot = Number(slotInRound) || null;
        // dhqPickValueFn already applies year discount internally
        if (window.App?.LI?.dhqPickValueFn) {
            const val = window.App.LI.dhqPickValueFn(season, round, slot || Math.ceil(teams / 2));
            if (val > 0) return val;
        }
        let value = slot ? pickValueBySlot(round, slot, teams, draftRounds) : (PICK_VALUES[round] || 100);
        // Future year discount: 12% per year (matches dhq-engine.js)
        const curYear = parseInt(window.S?.season) || new Date().getFullYear();
        const pickYear = parseInt(season) || curYear;
        const yearsAhead = Math.max(0, pickYear - curYear);
        if (yearsAhead > 0) value = Math.round(value * Math.pow(0.88, yearsAhead));
        return value;
    }

    // ── Usage signal helpers ─────────────────────────────────────────
    // Reads from window.S.playerStats[pid].prevRawStats (Sleeper season totals).
    // Returns a multiplier on the base decay rate.  > 1 = faster decline, < 1 = slower.
    function computeUsageDecayMultiplier(pid, nPos) {
        const raw = window.S?.playerStats?.[pid]?.prevRawStats;
        if (!raw) return 1.0;
        const gp = raw.gp || 0;
        if (gp < 4) return 1.0; // too few games for a reliable signal

        if (nPos === 'RB') {
            const cpg = (raw.rush_att || 0) / gp;
            if (cpg >= 20) return 1.10;  // workhorse — tread wears faster
            if (cpg < 12)  return 0.90;  // pass-catching back — lighter load
            return 1.0;
        }
        if (nPos === 'WR' || nPos === 'TE') {
            const tpg = (raw.rec_tgt || raw.rec_att || 0) / gp;
            const hiThreshold = nPos === 'TE' ? 7 : 8;
            if (tpg >= hiThreshold) return 0.93; // featured target — established role, more stable
            return 1.0;
        }
        if (nPos === 'QB') {
            const rapg = (raw.rush_att || 0) / gp;
            if (rapg >= 7) return 1.05; // mobile QB — physical wear from running
            return 1.0;
        }
        return 1.0;
    }

    // Returns a one-time additive DHQ adjustment for WR/TE based on target share trend.
    // Positive trend (rising share) → positive bonus; negative → penalty.
    // Applied only in year 1 of the projection; dampened to avoid over-weighting one signal.
    function computeUsageTrendBonus(nPos, baseDhq, trend) {
        if (nPos !== 'WR' && nPos !== 'TE') return 0;
        if (Math.abs(trend) < 0.10) return 0;  // below noise threshold
        // Cap trend influence at ±50%; scale to ±5% of base DHQ
        const capped = Math.min(Math.max(trend, -0.50), 0.50);
        return Math.round(baseDhq * capped * 0.10);
    }

    // ── projectPlayerValue ───────────────────────────────────────────
    // Projects (or retro-jects) a player's DHQ value `delta` seasons away.
    // Uses position-specific peak windows, usage-adjusted decay rates, and
    // a confidence half-life to produce calibrated multi-year projections.
    //
    // Parameters:
    //   pid      — player id (used for isElitePlayer lookup + usage stat read)
    //   baseDhq  — current DHQ score
    //   baseAge  — player's current age
    //   pos      — position string (may be variant like 'DE', 'CB', 'OLB')
    //   delta    — years offset; positive = future, negative = past
    //   meta     — optional { trend: Number } where trend ≈ YoY PPG change fraction
    //
    // Usage signals (read from window.S.playerStats[pid].prevRawStats):
    //   RB carries/game  ≥20 → decay ×1.10 (workhorse ages faster)
    //   RB carries/game  <12 → decay ×0.90 (pass-catcher ages slower)
    //   WR/TE targets/game ≥8/7 → decay ×0.93 (featured role, more stable)
    //   QB rush att/game  ≥7  → decay ×1.05 (mobile QB wear)
    //   WR/TE rising target share (meta.trend >10%) → year-1 value bonus
    //   WR/TE declining target share (meta.trend <-10%) → year-1 value penalty
    function projectPlayerValue(pid, baseDhq, baseAge, pos, delta, meta) {
        if (!baseDhq || baseDhq <= 0 || delta === 0) return baseDhq;
        const ageCurveWindows = window.App.ageCurveWindows;
        const peakWindows = window.App.peakWindows;
        const decayRates  = window.App.decayRates;
        const nPos = pos === 'DE' || pos === 'DT'   ? 'DL'
                   : pos === 'CB' || pos === 'S'    ? 'DB'
                   : pos === 'OLB' || pos === 'ILB' ? 'LB'
                   : pos;
        const curve = ageCurveWindows[nPos] || { build:[22,24], peak:peakWindows[nPos] || [24,29], decline:[30,32] };
        const [pLo, pHi] = curve.peak;
        const declineHi = curve.decline[1];
        const decay = decayRates[nPos] || 0.12;
        const ceiling = POS_CEILINGS[nPos] || 10000;

        if (!baseAge || baseAge <= 0) return baseDhq;

        const trend = meta?.trend || 0;        // e.g. +0.15 = trending up 15%
        const trendBoost = 1 + (trend * 0.5);  // dampen raw trend for projection

        // Offseason projections decay slower (less in-season noise)
        const month = new Date().getMonth(); // 0-indexed
        const inSeason = month >= 8 || month <= 1; // Sep–Feb
        const halfLife = inSeason ? 1.5 : 3.0;

        const isElite  = typeof window.App?.isElitePlayer === 'function'
                         ? window.App.isElitePlayer(pid) : baseDhq >= 7000;
        const isProven = baseDhq >= 4000;
        const peakMid  = Math.floor((pLo + pHi) / 2);

        // ── Usage-adjusted decay rate ──────────────────────────────
        const usageMult    = computeUsageDecayMultiplier(pid, nPos);
        const effectiveDecay = decay * usageMult;

        // ── Target share trend bonus (WR/TE only, year 1) ──────────
        const trendBonus = computeUsageTrendBonus(nPos, baseDhq, trend);

        let val = baseDhq;

        if (delta > 0) {
            // ── Future projection ─────────────────────────────────────
            for (let yr = 1; yr <= delta; yr++) {
                const ageAtYr   = baseAge + yr;
                const confidence = Math.pow(0.5, yr / halfLife);
                if (ageAtYr <= pLo) {
                    // Pre-peak: larger growth window
                    const growthRate = isElite ? 0.18 : isProven ? 0.14 : 0.08;
                    const projected  = val * (1 + growthRate * trendBoost);
                    val = projected * confidence + val * (1 - confidence);
                } else if (ageAtYr <= peakMid) {
                    // Early-peak: still appreciating
                    const rate = isElite ? 0.06 : isProven ? 0.03 : 0.0;
                    val *= (1 + rate * trendBoost);
                } else if (ageAtYr <= pHi) {
                    // Late-peak: holding or starting to decline
                    val *= isElite ? 1.0 : isProven ? (1 - effectiveDecay * 0.1) : (1 - effectiveDecay * 0.25);
                } else if (ageAtYr <= declineHi) {
                    // Valuable decline band: reduce gradually, not like a cliff.
                    const declineFloor = { QB:0.78, RB:0.62, WR:0.68, TE:0.70, K:0.82, DL:0.70, LB:0.68, DB:0.66 }[nPos] || 0.68;
                    const progress = (ageAtYr - pHi) / Math.max(1, declineHi - pHi);
                    const target = declineFloor + (1 - declineFloor) * (1 - Math.max(0, Math.min(1, progress)));
                    val *= target;
                } else {
                    // Post-decline: steeper decline, 0.25 acceleration per year beyond the valuable band.
                    const yearsPast = ageAtYr - declineHi;
                    const accel = 1 + yearsPast * 0.25;
                    val *= (1 - effectiveDecay * accel);
                }
                // Apply target share trend pressure in year 1 only (signal fades quickly)
                if (yr === 1 && trendBonus !== 0) val += trendBonus;
                // SOS adjustment: year 1 only, current season projections (not dynasty multi-year)
                // Easy schedule (rank 25-32) → small positive; Hard (rank 1-8) → small negative
                // Range: ±5% max; uses last completed season's average opponent defense rank
                if (yr === 1 && window.App?.SOS?.ready) {
                    const pd = window.App?.SOS?.defenseRankings; // existence check only
                    if (pd) {
                        const playerTeam = window.App?._playersCache?.[pid]?.team;
                        const sos = playerTeam
                            ? window.App.SOS.getPlayerSOS(pid, nPos, playerTeam)
                            : null;
                        if (sos?.avgRank != null) {
                            // rank 16.5 = league average; ±16.5 range → ±5% adjustment
                            const sosAdj = (sos.avgRank - 16.5) / 16.5 * 0.05;
                            val = val * (1 + sosAdj);
                        }
                    }
                }
                val = Math.min(val, ceiling);
            }
        } else {
            // ── Historical retrojection ───────────────────────────────
            for (let yr = 1; yr <= Math.abs(delta); yr++) {
                const ageAtYr = (baseAge || 25) - yr;
                if (ageAtYr < pLo - 2) {
                    val *= (1 - 0.15);                // worth less when very young
                } else if (ageAtYr <= pHi) {
                    val *= (1 + effectiveDecay * 0.1); // in window, similar value
                } else {
                    val *= (1 + effectiveDecay * 0.5); // worth more when younger past value window
                }
            }
        }

        return Math.max(0, Math.round(val));
    }

    // ── Rest-of-Season (ROS) value — redraft only ────────────────────
    // Format-aware player value: redraft leagues value players by projected
    // points over the remaining fantasy season (league-scored via the
    // projection engine), scaled into the DHQ range so Trade Center math, pick
    // values, tiers, and coloring all keep working unchanged. Dynasty/keeper
    // fall through to DHQ (App.LI.playerScores). Built once per (league, week).
    //
    // REDRAFT DOCTRINE (owner ruling 2026-08-02): the only league-specific
    // inputs are the league's SCORING and ROSTER settings. Everything else is
    // baseline shared by everyone — public stats, the provider's season
    // projection line (via WeeklyProj.buildSeasonBaseline), and a capped
    // FantasyCalc REDRAFT market calibration. No age curves, draft capital,
    // or dynasty market may influence redraft values.
    let _ros = null; // { leagueId, week, remainingWeeks, points:{pid}, values:{pid}, scale }

    // ROS value = gross-points share + value-over-replacement share. Tuned
    // 2026-08-02 against ESPN / Yahoo / FantasyPros / FantasyCalc redraft
    // consensus on a standard 12-team half-PPR control: the original 0.35
    // gross share floated 12-16 QBs into a 1QB top-50 (market band: 2-5);
    // 0.15 lands the QB tier inside the band (ρ 0.87-0.94 across sources)
    // while VOR keeps flex-starter separation. 0.10 over-deflates and
    // degrades within-QB ordering.
    const ROS_GROSS_WT = 0.15, ROS_VOR_WT = 0.85;
    // FantasyCalc REDRAFT market calibration weight — the redraft mirror of the
    // dynasty tenet: the league-scored engine is the spine, the market is only
    // a CAPPED trim (25% influence, only where the market prices a player).
    const ROS_MARKET_WT = 0.25;
    // When the dynasty engine isn't loaded (other-platform redraft leagues),
    // anchor the value ceiling here instead of bestDHQ — pure display scale.
    const ROS_SCALE_CEILING = 9500;
    // FantasyCalc redraft values, fetched once per league (redraft only):
    // { leagueId, map: {sleeperPid: value} | null, fetching }
    let _rosMarket = { leagueId: null, map: null, fetching: null };

    // Keeper value = dynasty-leaning blend of long-term DHQ and this-season ROS.
    // A keeper call is closer to a 1-year-ahead dynasty question than to "points
    // left this season," so weight dynasty higher than a straight split. Tunable —
    // revisit if real usage shows misranking (e.g. ageing vets held too high).
    const KEEPER_DYNASTY_WT = 0.6, KEEPER_ROS_WT = 0.4;

    function _currentLeagueId() {
        return String(window.S?.currentLeagueId
            || window.App?.LeagueSkin?.getCurrent?.()?.leagueId || '');
    }
    // CHOPPED counts as redraft here: it is a one-season format, so value is
    // rest-of-season, never dynasty. (The survival-weighted horizon is a
    // later phase — season-end is already vastly closer than dynasty DHQ.)
    function _isRedraft(skin) {
        const s = skin || window.App?.LeagueSkin?.getCurrent?.() || null;
        return !!s && (s.type === 'redraft' || s.type === 'chopped');
    }
    function _isKeeper(skin) {
        const s = skin || window.App?.LeagueSkin?.getCurrent?.() || null;
        return !!s && s.type === 'keeper';
    }

    // Healthy, neutral-matchup per-week median for a player, league-scored.
    // Ignores transient injury_status — ROS is a season-long estimate.
    // When a provider SEASON projection line exists it anchors the baseline
    // (buildSeasonBaseline) — that is what makes rookies and role-change
    // players priceable in redraft; pure history is the fallback.
    function _perWeekMedian(pid, ctx) {
        const WP = window.App?.WeeklyProj, SS = window.App?.StartSit;
        if (!WP || !SS || !WP.buildBaseline) return 0;
        const player = ctx.playersData?.[pid];
        if (!player) return 0;
        const season = ctx.statsData?.[pid] || null;
        const prior = ctx.priorData?.[pid] || null;
        const projRow = (ctx.projectionsData && ctx.projectionsData[pid]) || null;
        const baseline = (projRow && WP.buildSeasonBaseline)
            ? WP.buildSeasonBaseline(pid, season, prior, projRow, ctx.scoring, ctx.week, ctx.projPreW)
            : WP.buildBaseline(pid, season, prior, ctx.scoring, ctx.week);
        if (!baseline) return 0;
        const pos = (window.App?.normPos?.(player.position)) || player.position || '';
        const proj = SS.projectPlayerWeek({ pid, week: ctx.week, position: pos, baseline, dvpMult: 1, vegas: null, injuryStatus: '' });
        const scored = SS.scoreProjection(proj, ctx.scoring);
        return (scored && scored.points && scored.points.median) || 0;
    }

    // A projection row with no meaningful projected volume is an empty shell,
    // not a claim the player will play — keep it out of the redraft universe.
    function _projHasVolume(row) {
        if (!row) return false;
        return (Number(row.pts_ppr) || Number(row.pts_std) || Number(row.pts_half_ppr)
            || Number(row.pass_att) || Number(row.rush_att) || Number(row.rec_tgt) || Number(row.rec)
            || Number(row.fga) || Number(row.xpm) || Number(row.idp_tkl) || 0) > 0;
    }

    // Fetch FantasyCalc REDRAFT values for this league's own settings (teams /
    // QB count / PPR) — fire-and-forget; when it lands the (league, week) ROS
    // cache is invalidated so the next read rebuilds with the calibration in.
    // League-parameterized by design: the market anchor itself follows the
    // league's roster and scoring shape, never a generic default.
    function _ensureRosMarket(league, leagueId) {
        if (_rosMarket.leagueId === leagueId && (_rosMarket.map || _rosMarket.fetching)) return;
        if (typeof fetch !== 'function') return;
        const rp = (league.roster_positions || []).map(s => String(s).toUpperCase());
        const numQbs = rp.some(s => s === 'SUPER_FLEX' || s === 'QB_FLEX' || s === 'OP') ? 2 : 1;
        const numTeams = Number(league.total_rosters) || 12;
        const rec = Number((league.scoring_settings || {}).rec);
        const ppr = !Number.isFinite(rec) ? 0.5 : rec >= 0.9 ? 1 : rec >= 0.4 ? 0.5 : 0;
        _rosMarket = { leagueId, map: null, fetching: true };
        fetch('https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=' + numQbs + '&numTeams=' + numTeams + '&ppr=' + ppr)
            .then(r => (r && r.ok ? r.json() : null))
            .then(rows => {
                if (_rosMarket.leagueId !== leagueId) return;
                const map = {};
                (Array.isArray(rows) ? rows : []).forEach(d => {
                    const sid = d && d.player && d.player.sleeperId;
                    if (sid && d.value > 0 && d.player.position !== 'PICK') map[String(sid)] = Number(d.value);
                });
                _rosMarket = { leagueId, map: Object.keys(map).length ? map : null, fetching: null };
                if (_rosMarket.map && _ros && _ros.leagueId === leagueId) {
                    _ros = null; // rebuild on next read, calibrated
                    try { window.dispatchEvent(new CustomEvent('wr:ros-market-loaded', { detail: { leagueId } })); } catch (e) { /* headless */ }
                }
            })
            .catch(() => { if (_rosMarket.leagueId === leagueId) _rosMarket = { leagueId, map: null, fetching: null }; });
    }

    // Replacement-rank (1-indexed) for a position = the last startable player at that
    // position across the league. Reuses the dynasty engine's flex-aware per-team slot
    // count (lineupContext.perTeamSlots) when available; falls back to league starter
    // counts, then a sane per-position default. Used to compute value-over-replacement.
    function _replacementRank(pos, totalTeams, slotsOverride) {
        // slotsOverride lets a caller price a league OTHER than the one whose
        // LeagueIntel happens to be loaded — the whole point of Empire's
        // mark-to-league pass. Without it, behaviour is unchanged.
        if (slotsOverride && slotsOverride[pos] > 0) return Math.max(1, Math.round(totalTeams * slotsOverride[pos]));
        if (slotsOverride) return Math.max(1, Math.round(totalTeams * ({ QB:1, RB:2, WR:3, TE:1, K:1, DL:3, LB:2, DB:3 }[pos] || 1)));
        const lc = window.App?.LI?.lineupContext?.position?.[pos];
        const sc = window.App?.LI?.starterCounts?.[pos];
        const slotsPerTeam = (lc && lc.perTeamSlots > 0) ? lc.perTeamSlots
                           : (sc > 0 ? sc : ({ QB:1, RB:2, WR:3, TE:1, K:1, DL:3, LB:2, DB:3 }[pos] || 1));
        return Math.max(1, Math.round(totalTeams * slotsPerTeam));
    }

    // Starting slots per team, per position, straight from roster_positions —
    // flex-aware. FLEX/SUPER_FLEX demand is spread across the positions that
    // can legally fill them, which is what makes a superflex league price QBs
    // like the scarce asset they are. Pure: no globals, so Empire can call it
    // once per league.
    const _FLEX_ELIGIBLE = {
        FLEX: ['RB', 'WR', 'TE'],
        WR_RB_FLEX: ['RB', 'WR'],
        REC_FLEX: ['WR', 'TE'],
        SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
        QB_FLEX: ['QB', 'RB', 'WR', 'TE'],
        OP: ['QB', 'RB', 'WR', 'TE'],
        IDP_FLEX: ['DL', 'LB', 'DB'],
    };
    // How a flex slot's demand splits across its eligible positions. SUPER_FLEX
    // is overwhelmingly a QB slot in practice, so it is weighted that way
    // rather than split evenly — an even split would understate QB scarcity,
    // which is the single biggest cross-league price difference there is.
    const _FLEX_SHARE = {
        SUPER_FLEX: { QB: 0.75, RB: 0.08, WR: 0.12, TE: 0.05 },
        QB_FLEX: { QB: 0.75, RB: 0.08, WR: 0.12, TE: 0.05 },
        OP: { QB: 0.75, RB: 0.08, WR: 0.12, TE: 0.05 },
        FLEX: { RB: 0.35, WR: 0.5, TE: 0.15 },
        WR_RB_FLEX: { RB: 0.45, WR: 0.55 },
        REC_FLEX: { WR: 0.75, TE: 0.25 },
        IDP_FLEX: { DL: 0.34, LB: 0.33, DB: 0.33 },
    };
    function slotsFromRoster(rosterPositions) {
        const out = {};
        const bench = /^(BN|BE|BENCH|IR|TAXI|RES)$/i;
        (rosterPositions || []).forEach(raw => {
            const s = String(raw || '').toUpperCase();
            if (!s || bench.test(s)) return;
            if (_FLEX_ELIGIBLE[s]) {
                const share = _FLEX_SHARE[s] || {};
                _FLEX_ELIGIBLE[s].forEach(pos => { out[pos] = (out[pos] || 0) + (share[pos] || (1 / _FLEX_ELIGIBLE[s].length)); });
                return;
            }
            const pos = (window.App?.normPos?.(s)) || s;
            out[pos] = (out[pos] || 0) + 1;
        });
        return out;
    }

    // Build + cache the ROS value map. No-op (leaves _ros null → getValue
    // falls back to DHQ) when not redraft, projections/DHQ unavailable, or no
    // weeks remain. ctx = { leagueId, league, playersData, statsData, priorData, skin }.
    function ensureRos(ctx) {
        ctx = ctx || {};
        const skin = ctx.skin || window.App?.LeagueSkin?.getCurrent?.() || null;
        // Keeper leagues need the same ROS/VOR map built (getKeeperValue blends
        // it with dynasty DHQ below) — getValue()/getRosPoints() still gate
        // strictly on redraft, so this widening doesn't change what they return.
        if (!_isRedraft(skin) && !_isKeeper(skin)) { _ros = null; return null; }
        const S = window.S || {};
        const league = ctx.league || skin?.league || (S.leagues && S.leagues[0]) || {};
        const leagueId = String(ctx.leagueId || league.league_id || league.id || _currentLeagueId());
        const WP = window.App?.WeeklyProj;
        const week = WP && WP.currentWeek ? WP.currentWeek() : 1;
        // Callers that can't thread the hydrated maps (Trade Center's early
        // mount, the draft stack) inherit them from the hydrate bridge — a
        // missing priorData/projectionsData must degrade the BASELINE, never
        // silently flip a redraft surface back to dynasty pricing.
        const playersData = ctx.playersData || S.players || {};
        const statsData = ctx.statsData || S.statsData || {};
        const priorData = ctx.priorData || S.priorData || {};
        const projectionsData = ctx.projectionsData || S.projectionsData || null;
        // Market calibration: an injected map wins (tests/harness); otherwise
        // kick the per-league FantasyCalc REDRAFT fetch (redraft only).
        if (!ctx.marketRedraft && _isRedraft(skin) && !ctx.noMarketFetch) _ensureRosMarket(league, leagueId);
        const market = ctx.marketRedraft || (_rosMarket.leagueId === leagueId ? _rosMarket.map : null);
        if (_ros && _ros.leagueId === leagueId && _ros.week === week) return _ros; // cached
        const built = computePrices({ ...ctx, league, leagueId, week, playersData, statsData, priorData, projectionsData, marketRedraft: market, _captureForecast: true });
        _ros = built;
        return _ros;
    }

    // ── Pure per-league price board ──────────────────────────────────
    // Everything ensureRos used to do inline, with NO module cache written.
    // That is what lets Empire mark every league to its OWN book at once:
    // pass a league's scoring, roster slots and team count and get that
    // league's board back, without disturbing the single-league _ros cache
    // every other surface depends on.
    //   ctx additionally accepts: perTeamSlots (from slotsFromRoster),
    //   playerScores (universe/ceiling override), totalTeams.
    function computePrices(ctx) {
        ctx = ctx || {};
        const S = window.S || {};
        const league = ctx.league || {};
        const leagueId = String(ctx.leagueId || league.league_id || league.id || '');
        const WP = window.App?.WeeklyProj;
        const week = Number(ctx.week) || (WP && WP.currentWeek ? WP.currentWeek() : 1);
        const playersData = ctx.playersData || S.players || {};
        const statsData = ctx.statsData || S.statsData || {};
        const priorData = ctx.priorData || S.priorData || {};
        const projectionsData = ctx.projectionsData || S.projectionsData || null;
        const market = ctx.marketRedraft || null;
        const perTeamSlots = ctx.perTeamSlots || null;

        const playerScores = ctx.playerScores || window.App?.LI?.playerScores || null;
        // The dynasty engine is no longer a hard gate: with a projections map
        // the redraft board can build on any platform. No projections AND no
        // dynasty universe → nothing to price.
        if (!playerScores && !projectionsData) return null;
        const scoring = ctx.scoring || league.scoring_settings || {};
        // Horizon: the END of the fantasy season (playoffs included) — a
        // redraft asset keeps scoring through the title game, and this keeps
        // late-season redraft surfaces from reverting to dynasty pricing.
        const pws = Number(league.settings?.playoff_week_start) || 15;
        const seasonEnd = pws >= 16 ? 18 : 17;
        const calendarWeeks = Math.max(0, seasonEnd - week);
        // CHOPPED: the calendar is a lie. What a player is worth to you is
        // capped by how many more weeks you can expect to be ALIVE, so the
        // horizon is the survival expectation when we have one. This is
        // rank-neutral on its own (a uniform multiplier cancels in the
        // bestVOR scale) — its real bite is the BYE deduction below: losing
        // one week out of an expected three is a third of your remaining
        // season, where out of thirteen it is a rounding error.
        const survival = ctx.horizonWeeks != null
            ? Number(ctx.horizonWeeks)
            : (window.App?.ChopOdds?.horizonFor?.(leagueId, null));
        const remainingWeeks = (survival > 0 && survival < calendarWeeks) ? survival : calendarWeeks;
        if (remainingWeeks <= 0) return null; // season truly over

        const projWeek = week + 1;
        const totalTeams = Number(ctx.totalTeams) || Number(league.total_rosters) || (S.rosters?.length) || 12;

        // ── Universe: dynasty-scored players ∪ provider-projected players ──
        // (doctrine: a projectable player must never be invisible in redraft
        // just because the dynasty engine didn't score them — and vice versa.)
        const universe = Object.create(null);
        let bestDHQ = 0;
        if (playerScores) for (const pid in playerScores) {
            universe[pid] = 1;
            if (playerScores[pid] > bestDHQ) bestDHQ = playerScores[pid];
        }
        if (projectionsData) for (const pid in projectionsData) {
            if (!universe[pid] && _projHasVolume(projectionsData[pid])) universe[pid] = 1;
        }

        // ── Pass 1: project each player's healthy per-week points + record position ──
        const perWkByPid = {}, posByPid = {};
        for (const pid in universe) {
            const perWk = _perWeekMedian(pid, { playersData, statsData, priorData, projectionsData, projPreW: ctx.projPreW, scoring, week: projWeek });
            if (perWk <= 0) continue;
            perWkByPid[pid] = perWk;
            const player = playersData[pid];
            posByPid[pid] = (window.App?.normPos?.(player?.position)) || player?.position || '';
        }

        // ── Value-over-replacement baseline per position ──────────────────
        // Redraft value must reward SCARCITY, not gross points — otherwise QBs (who put up
        // the most raw points) dominate the board and a top passer ranks #1 overall, which
        // diverges from market consensus. Mirror the dynasty engine's lineupValuePPGFor:
        // value = 35% gross + 65% edge-above-replacement, where replacement = the last
        // startable player at that position (so a 22-PPG QB whose replacement scores 18 has
        // a small edge, while a 16-PPG RB whose replacement scores 8 has a large one).
        const byPos = {};
        for (const pid in perWkByPid) (byPos[posByPid[pid]] = byPos[posByPid[pid]] || []).push(perWkByPid[pid]);
        const replacementPerWk = {};
        for (const pos in byPos) {
            if (!pos) continue; // unknown-position bucket gets no replacement baseline (handled in pass 2)
            const arr = byPos[pos].sort((a, b) => b - a);
            const rank = _replacementRank(pos, totalTeams, perTeamSlots);
            replacementPerWk[pos] = arr[Math.min(rank, arr.length) - 1] || 0;
        }

        // ── Pass 2: raw ROS points (display) + VOR-weighted value (ranking/scaling) ──
        const points = {}, values = {}, vor = {};
        let maxVor = 0;
        for (const pid in universe) {
            const perWk = perWkByPid[pid] || 0;
            const pos = posByPid[pid] || '';
            // Unprojectable (no projection line AND no NFL history) or unknown position → no
            // demonstrated ROS value. Pin to 0 EXPLICITLY so getValue returns 0 in redraft rather
            // than leaking the player's full DYNASTY DHQ score (the value-vs-"0 pts" contradiction).
            if (perWk <= 0 || !pos) { points[pid] = 0; values[pid] = 0; continue; }
            const player = playersData[pid];
            const bye = player ? Number(player.bye_week) : 0;
            // The bye only costs you if it lands inside the weeks you expect to
            // PLAY — which under a survival horizon is shorter than the season.
            const byeInWindow = bye > week && bye <= Math.min(seasonEnd, week + remainingWeeks);
            const effWeeks = Math.max(0, remainingWeeks - (byeInWindow ? 1 : 0));
            points[pid] = Math.max(0, Math.round(perWk * effWeeks * 10) / 10); // raw projected ROS pts (display)
            const repl = replacementPerWk[pos] || 0;
            const lineupVal = perWk * ROS_GROSS_WT + Math.max(0, perWk - repl) * ROS_VOR_WT; // scarcity-weighted per-week value
            vor[pid] = Math.max(0, lineupVal * effWeeks);
            if (vor[pid] > maxVor) maxVor = vor[pid];
        }
        if (maxVor <= 0) return null;

        // ── Capped market calibration (FantasyCalc REDRAFT, league params) ──
        // Blend in VOR space so the scale anchor sees the calibrated board:
        // market values are normalized so the market's top asset equals the
        // local top VOR, then each priced player moves at most ROS_MARKET_WT
        // of the way toward the market's view. Unpriced players keep their
        // engine value untouched.
        if (market) {
            let maxMkt = 0;
            for (const pid in market) if (market[pid] > maxMkt) maxMkt = market[pid];
            if (maxMkt > 0) {
                const mktScale = maxVor / maxMkt;
                let newMax = 0;
                for (const pid in vor) {
                    const mv = market[pid];
                    if (mv > 0 && (vor[pid] > 0 || perWkByPid[pid] > 0)) {
                        vor[pid] = vor[pid] * (1 - ROS_MARKET_WT) + (mv * mktScale) * ROS_MARKET_WT;
                    }
                    if (vor[pid] > newMax) newMax = vor[pid];
                }
                maxVor = newMax || maxVor;
            }
        }

        // Anchor the top asset to the dynasty-scale ceiling so buckets, colors
        // and Trade Center math keep working; pure display scalar (falls back
        // to a constant when no dynasty engine is loaded on this platform).
        const ceiling = bestDHQ > 0 ? bestDHQ : ROS_SCALE_CEILING;
        const scale = ceiling / maxVor;
        for (const pid in vor) values[pid] = Math.min(10000, Math.round(vor[pid] * scale));
        const result = { leagueId, week, remainingWeeks, points, values, scale, bestDHQ: ceiling, maxVor, replacementPerWk, marketApplied: !!market };
        // Side-channel only: failure or absence of the ledger never changes ROS.
        if (ctx._captureForecast && window.App?.ForecastLedger?.capture) {
            try {
                Promise.resolve(window.App.ForecastLedger.capture({ ...ctx, league, leagueId, scoring, playersData, statsData, priorData, projectionsData, marketRedraft: market, totalTeams }, result, perWkByPid)).catch(() => {});
            } catch (_) { /* non-fatal shadow recording */ }
        }
        return result;
    }

    // Format-aware value: redraft (with ROS built for the current league) →
    // scaled ROS; otherwise → dynasty DHQ. Drop-in for App.LI.playerScores[pid].
    function getValue(pid, opts) {
        opts = opts || {};
        if (_isRedraft(opts.skin) && _ros && _ros.leagueId === _currentLeagueId() && _ros.values[pid] != null) {
            return _ros.values[pid];
        }
        return (window.App?.LI?.playerScores?.[pid]) || 0;
    }
    // Keeper-adjusted value: blends dynasty DHQ with Rest-of-Season value.
    // Standalone — does NOT touch getValue()/valueMap(), so every existing
    // consumer keeps returning pure dynasty for keeper leagues exactly as
    // before; only a surface that explicitly calls this opts into the blend.
    function getKeeperValue(pid, opts) {
        opts = opts || {};
        const dynastyVal = (window.App?.LI?.playerScores?.[pid]) || 0;
        if (!dynastyVal) return 0;
        const rosReady = _ros && _ros.leagueId === _currentLeagueId() && _ros.values[pid] != null && _ros.values[pid] > 0;
        // No ROS signal (unprojectable rookie/stash, or ROS not built) → lean
        // on dynasty alone. ensureRos() explicitly zero-pins unprojectable
        // players for redraft display purposes — that 0 means "no redraft
        // trade value," not "no keeper value," so it must not drag this blend
        // toward zero for exactly the stashes a keeper call cares most about.
        if (!rosReady) return dynastyVal;
        return Math.min(10000, Math.round(KEEPER_DYNASTY_WT * dynastyVal + KEEPER_ROS_WT * _ros.values[pid]));
    }
    // Raw projected ROS points for display (null when not built for this league).
    function getRosPoints(pid) {
        if (_ros && _ros.leagueId === _currentLeagueId()) return _ros.points[pid] != null ? _ros.points[pid] : null;
        return null;
    }
    function rosState() { return _ros; }
    // True only when the CURRENT league is redraft AND its ROS map is built —
    // the guard bypass surfaces (draft stack, trade calc) use to decide
    // whether a 0 means "worthless in redraft" (honor it) or "not built yet"
    // (fall back). Never treat a redraft 0 as permission to price dynasty.
    function isRedraftActive() {
        return _isRedraft(null) && !!_ros && _ros.leagueId === _currentLeagueId();
    }
    // Build the ROS map purely from the hydrate bridge (window.S) — for
    // surfaces with no hydrated props in scope (draft room, mock draft).
    function ensureRosFromState() {
        const S = window.S || {};
        return ensureRos({
            leagueId: S.currentLeagueId,
            league: (S.leagues && S.leagues[0]) || null,
            playersData: S.players, statsData: S.statsData,
            priorData: S.priorData, projectionsData: S.projectionsData,
        });
    }
    // A drop-in replacement for App.LI.playerScores: a Proxy over the real map
    // so Object.keys/enumeration still see every player id, but value lookups
    // (map[pid]) route through getValue (ROS for redraft, DHQ otherwise).
    function valueMap(opts) {
        const raw = window.App?.LI?.playerScores || {};
        if (typeof getValue !== 'function') return raw;
        return new Proxy(raw, { get: (t, k) => (typeof k === 'string' && k in t) ? getValue(k, opts) : t[k] });
    }

    return {
        IDEAL_ROSTER,
        DRAFT_ROUNDS,
        PICK_HORIZON,
        PICK_IDEAL,
        LINEUP_STARTERS,
        MIN_STARTER_QUALITY,
        NFL_STARTER_POOL,
        POS_PT_TARGETS,
        POS_WEIGHTS,
        TOTAL_WEIGHT,
        PICK_VALUES,
        PICK_VALUES_BY_SLOT,
        PICK_COLORS,
        POS_CEILINGS,
        getPickValue,
        pickValueBySlot,
        getPickOverallSlot,
        resolvePickValue,
        projectPlayerValue,
        ensureRos,
        computePrices,
        slotsFromRoster,
        ensureRosFromState,
        isRedraftActive,
        getValue,
        getKeeperValue,
        getRosPoints,
        rosState,
        valueMap,
    };
})();
