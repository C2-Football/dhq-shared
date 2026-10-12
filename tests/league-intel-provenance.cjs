'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'dhq-engine.js'), 'utf8');
const cacheKey = 'dhq_leagueintel_v14';
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function state(leagueId, season = 2026) {
  return { currentLeagueId: leagueId, season, platform: 'fixture', players: {}, rosters: [],
    leagues: [{ league_id: leagueId, scoring_settings: {}, roster_positions: ['QB'] }],
    nflState: { season_type: 'regular' } };
}
function harness() {
  const storage = new Map(), timers = [], events = [], requests = [], errors = [];
  const pending = new Map();
  const window = { App: {}, S: state('A'), DhqEvents: { emit: (name, detail) => events.push({ name, detail }) },
    Sleeper: { fetchSeasonStats: year => {
      const leagueId = window.S.currentLeagueId;
      requests.push({ leagueId, year });
      return (pending.get(leagueId)?.promise || Promise.resolve()).then(() => ({}));
    } } };
  const context = vm.createContext({ window, performance, URL, Date, setTimeout: fn => timers.push(fn),
    console: { log() {}, warn: (...args) => errors.push(args) },
    DhqStorage: { get: (key, fallback) => storage.get(key) ?? fallback, set: (key, value) => storage.set(key, value) },
    STORAGE_KEYS: { HIST_KEY: leagueId => 'history:' + leagueId },
    fetch: async () => ({ ok: true, json: async () => [] }),
  });
  vm.runInContext(source, context, { filename: 'dhq-engine.js' });
  return { window, storage, events, requests, errors,
    block(leagueId) { const gate = deferred(); pending.set(leagueId, gate); return gate; },
    switchTo(leagueId, season) { Object.assign(window.S, state(leagueId, season)); },
    flushTimers() { while (timers.length) timers.shift()(); },
  };
}

test('cache restore derives source identity from its matching envelope', () => {
  const h = harness();
  h.storage.set(cacheKey, { ts: Date.now(), leagueId: 'A', data: { ownerProfiles: { 1: { trades: 2 } } } });
  assert.equal(h.window.App.loadLICache(), true);
  assert.equal(h.window.App.LI.sourceLeagueId, 'A');
  assert.equal(h.window.App.LI_LOADED, true);
  h.flushTimers();
  assert.equal(h.events[0].detail.leagueId, 'A');
});

test('wrong cache envelope and contradictory embedded identity are rejected', () => {
  const h = harness();
  h.storage.set(cacheKey, { ts: Date.now(), leagueId: 'B', data: { sourceLeagueId: 'B' } });
  assert.equal(h.window.App.loadLICache(), false);
  h.storage.set(cacheKey, { ts: Date.now(), leagueId: 'A', data: { sourceLeagueId: 'B' } });
  assert.equal(h.window.App.loadLICache(), false);
  assert.equal(h.window.App.LI_LOADED, false);
});

test('deferred cache-ready event cannot announce a previous league', () => {
  const h = harness();
  h.storage.set(cacheKey, { ts: Date.now(), leagueId: 'A', data: {} });
  h.window.App.loadLICache();
  h.switchTo('B');
  h.flushTimers();
  assert.equal(h.events.length, 0);
});

test('cache saves use data provenance instead of the current global league', () => {
  const h = harness();
  h.window.App.LI = { sourceLeagueId: 'A', ownerProfiles: {} };
  h.window.App.LI_LOADED = true;
  h.switchTo('B');
  assert.equal(h.window.App.saveLICache(), true);
  assert.equal(h.storage.get(cacheKey).leagueId, 'A');
  h.window.App.LI = {};
  h.storage.delete(cacheKey);
  assert.equal(h.window.App.saveLICache(), false);
  assert.equal(h.storage.has(cacheKey), false);
});

test('new league supersedes pending old run; old finally cannot clear newer loading', async () => {
  const h = harness(), gateA = h.block('A'), gateB = h.block('B');
  const loadA = h.window.App.loadLeagueIntel();
  assert.equal(h.requests.length, 5);
  await h.window.App.loadLeagueIntel();
  assert.equal(h.requests.length, 5, 'same-league pending load is deduplicated');
  h.switchTo('B');
  const loadB = h.window.App.loadLeagueIntel();
  assert.equal(h.requests.length, 10);
  gateA.resolve();
  await loadA;
  assert.equal(h.window._liLoading, true);
  assert.equal(h.window.App.LI_LOADED, false);
  assert.equal(h.window.App.LI.sourceLeagueId, undefined);
  assert.equal(h.events.length, 0);
  gateB.resolve();
  await loadB;
  assert.equal(h.window._liLoading, false);
  assert.equal(h.window.App.LI_LOADED, true);
  assert.equal(h.window.App.LI.sourceLeagueId, 'B');
  assert.equal(h.storage.get(cacheKey).leagueId, 'B');
  assert.deepEqual(h.events.map(event => event.detail.leagueId), ['B']);
});

test('late prior completion cannot replace a newer published league or cache', async () => {
  const h = harness(), gateA = h.block('A'), gateB = h.block('B');
  const loadA = h.window.App.loadLeagueIntel();
  h.switchTo('B');
  const loadB = h.window.App.loadLeagueIntel();
  gateB.resolve();
  await loadB;
  const publishedB = h.window.App.LI;
  gateA.resolve();
  await loadA;
  assert.equal(h.window.App.LI, publishedB);
  assert.equal(h.window.App.LI.sourceLeagueId, 'B');
  assert.equal(h.storage.get(cacheKey).leagueId, 'B');
  assert.deepEqual(h.events.map(event => event.detail.leagueId), ['B']);
});

test('loaded legacy or other-league data reloads, with readiness false during loading', async () => {
  const h = harness(), gate = h.block('A');
  h.window.App.LI = { sourceLeagueId: 'B' };
  h.window.App.LI_LOADED = true;
  const loading = h.window.App.loadLeagueIntel();
  assert.equal(h.window.App.LI_LOADED, false);
  gate.resolve();
  await loading;
  assert.equal(h.window.App.LI.sourceLeagueId, 'A');
  const count = h.requests.length;
  await h.window.App.loadLeagueIntel();
  assert.equal(h.requests.length, count, 'matching completed league is deduplicated');

  h.window.App.LI = {};
  h.window.App.LI_LOADED = true;
  await h.window.App.loadLeagueIntel();
  assert.equal(h.window.App.LI.sourceLeagueId, 'A', 'legacy in-memory data restores verified matching cache');
});

test('run retains its initial state snapshot across global field replacement', async () => {
  const h = harness(), gate = h.block('A');
  const loading = h.window.App.loadLeagueIntel();
  h.switchTo('B', 2030);
  h.switchTo('A', 2031);
  gate.resolve();
  await loading;
  assert.equal(h.window.App.LI.sourceLeagueId, 'A');
  assert.deepEqual(Array.from(h.window.App.LI.leagueYears), [2022, 2023, 2024, 2025, 2026]);
});

test('changing league without starting a replacement still rejects stale publication', async () => {
  const h = harness(), gate = h.block('A');
  const loading = h.window.App.loadLeagueIntel();
  h.switchTo('B');
  gate.resolve();
  await loading;
  assert.equal(h.window.App.LI_LOADED, false);
  assert.equal(h.window.App.LI.sourceLeagueId, undefined);
  assert.equal(h.window._liLoading, false);
  assert.equal(h.storage.has(cacheKey), false);
  assert.equal(h.events.length, 0);
});
