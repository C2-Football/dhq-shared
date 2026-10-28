# dhq-shared

Canonical source of the **shared browser engine** used by both Dynasty HQ products:

- **War Room** (`C2-Football/WarRoom`) — desktop command center
- **ReconAI / Scout** (`C2-Football/ReconAI`) — mobile PWA

This repo is the single source of truth. Both apps **vendor** these modules into their own
build at deploy time and at local-dev startup, so **neither app depends on the other's repo**.

```
                          ┌──────────────────┐
   edit here ───push───▶  │   dhq-shared      │
                          └────────┬─────────┘
                       vendored at │ build (sync)
                 ┌─────────────────┴─────────────────┐
                 ▼                                     ▼
         WarRoom/reconai-shared/              ReconAI/shared/  (these 30 files)
         (classic <script> tags via           (side-effect `import` in main.js,
          js/shared/shared-loader.js)           bundled by Vite)
```

## How to make a change

1. Edit a module here and push to `main`.
2. Each app picks it up on its **next build / `npm run dev`** (their sync step copies these
   files in). No app reads the other app's repo anymore.

There is intentionally no build/runtime CDN serving from this repo — the apps copy the files
locally, so a change is "live" once each app redeploys.

## Module contract

Every module here is a **classic, global-attaching script** (no ES exports). It runs for
side effects and attaches its API to `window.*`. This is why the *same* file works in both
consumers: War Room loads it via `<script>`, ReconAI imports it for side effects under Vite.
Do not add `export`/`import` statements to these files.

## Modules (30)

Authoritative list also lives in each app's sync script
(`WarRoom/scripts/sync-reconai-shared.cjs`, `ReconAI/scripts/sync-shared.cjs`) and in
[`manifest.json`](manifest.json).

App-specific modules that are **not** shared (Scout-only `data-cache.js`,
`league-memory.js`, …; War Room's own `js/shared/*`) stay in their respective app repos.

## Shared data (`draft-war-room/`)

The rookie/prospect CSVs consumed by `rookie-data.js` also live here (static,
hand-curated data): `draft-war-room/player.csv`, `draft-war-room/player-enrichment.csv`,
`draft-war-room/data/mock_draft_db.csv`. Both apps vendor these alongside the modules
and load them **same-origin** from their own deploy — neither fetches them cross-repo.
War-Room-only draft-tool data (`player-sources.csv`, `prospects_test_2025.csv`,
`players-final.json`) stays in the WarRoom repo.

## Redraft reliability handoff (local, 2026-10-27)

The scoring implementation in `sleeper-api.js` is authoritative. Forecasts use
`WeeklyProj → StartSit → calcFantasyPts`; `.detailed()` reports unsupported rules.
Nonzero unsupported scoring rules make a forecast unavailable. An omitted setting
contributes zero. Canonical IDP aliases take precedence over their alternate names,
including explicit zero, while team D/ST uses ordinary `sack` / `int` rules.

WarRoom synchronizes `startsit-engine.js`, `weekly-proj.js`, and `nfl-context.js`
into its direct-script paths at build time. These former manual twins now use the
current WarRoom implementations as the shared source. `player-value.js` retains
its existing byte-identical twin check. Other consumers must validate these API
updates before adopting the coordinated release.

Run `node tests/redraft-scoring.cjs`, `node tests/elite-player.cjs`, and
`node tests/league-intel-provenance.cjs`. The app's `test:redraft-reliability` suite
adds scoped cache/retry, availability, eligibility, trade and UI fixtures.
The legacy `isRedraftActive()` caller gate now denotes seasonal **format**, even
when values have not loaded; `rosState()` is the separate readiness check.
`getValue()` returns `null` for missing seasonal evidence and preserves actual zero.
The legacy negotiation API remains numeric for compatibility; it is an
uncalibrated comparison score, not a probability.

This branch is a local candidate. Publish and verify the final shared commit only
with release authorization, then update the app's pinned dependency to that exact
accessible commit and run its sync, tests and production build. Never deploy the
app with a private/unpublished local SHA in its active checkout step.

### CBS redraft market contract (local integration)

`redraft-market.js` is the canonical snapshot validation, identity mapping, format-selection, and normalized combined-market adapter. Load it before `player-value.js`. The app sync copies it to `js/shared/redraft-market.js`; `player-value.js` remains byte-identical across repositories. For the redraft skin, the default single 25% market budget reserves 15% for valid CBS prices and 10% for FantasyCalc; unavailable weights stay with the seasonal engine. These are provisional engineering weights. Other skins keep existing behavior. Market prices never change forecast fantasy points or rescue unknown/zero seasonal values.

CBS retrieval/scheduler and UI live in WarRoom-sandbox; see `docs/cbs-redraft-market.md` there for source-access restrictions, validation, operator import, tests, and release coordination. No automatic CBS source is enabled by this shared module. Publish and verify the real shared revision before changing the app's deployment pin; do not deploy against a local-only commit.

### Value history and finite monitoring (local candidate)

Load `value-history.js` before `supabase-client.js`. Both snapshot writers now return a promise, reject validation/authentication/database/readback failures, and resolve only after persisted rows are queried back. Hot-path callers must handle rejection in the background. Writes require the app's additive `20261028000000_value_monitor.sql` migration; capture identities separate formats, immutable daily observations, and event records. Missing values remain null; zero is valid. Previously stored timestamps/provenance cannot be retroactively verified.

`value-monitor-runtime.cjs` is a Node host for the actual canonical `dhq-engine.js` and `player-value.js` calculations. It fetches/validates inputs in a new isolated host per observation and records source/settings/engine provenance. It does not itself enroll users or enable a scheduler. The app supplies its canonical module paths, availability module, database worker, migration, read-only reporting UI and an explicitly gated hourly job. See the app's `docs/value-monitor.md` for the finite baseline-plus-seven contract, local evidence and exact activation/readback steps. The snapshot contract can be tested here with `node --test tests/value-history.cjs`; persistence and server/app parity tests live in the app and execute the synchronized production modules.
