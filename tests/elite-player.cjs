'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { window: { App: {} }, console };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../utils.js'), 'utf8'), sandbox);
const app = sandbox.window.App;
function reference(pid) {
  const scores = (app.PlayerValue?.valueMap ? app.PlayerValue.valueMap() : null) || app.LI?.playerScores || {};
  const meta = app.LI?.playerMeta || {};
  const id = String(pid), score = Number(scores[id] ?? scores[pid] ?? 0);
  if (score >= 7000) return true;
  const pos = app.normPos(meta[id]?.pos || meta[pid]?.pos || '');
  if (!pos || !score) return false;
  const atPos = Object.entries(scores).filter(([p]) => app.normPos(meta[p]?.pos || '') === pos).sort((a,b) => b[1]-a[1]);
  const rank = atPos.findIndex(([p]) => String(p) === id);
  return rank >= 0 && rank < 5;
}
let seed = 713, comparisons = 0;
const rand = n => ((seed = (seed * 1664525 + 1013904223) >>> 0) % n);
const positions = ['QB', 'RB', 'WR', 'TE', 'EDGE', 'DL', 'CB', 'DB', 'PK', 'K', '', null];
const values = [0, 100, 3000, 3000, 6000, 6999, 7000, 9000, null, undefined, NaN, '5000', -10];
for (let round=0; round<80; round++) {
  app.LI = { playerScores: {}, playerMeta: {} }; app.PlayerValue = null;
  for (let i=0; i<90; i++) {
    const id = i % 2 ? `p${i}` : String(i);
    app.LI.playerScores[id] = values[rand(values.length)];
    app.LI.playerMeta[id] = { pos: positions[rand(positions.length)] };
  }
  const snapshot = app.createElitePlayerSnapshot();
  for (const id of [...Object.keys(app.LI.playerScores), 'missing']) {
    assert.equal(app.isElitePlayer(id), reference(id), `rank differs for ${id} in round ${round}`);
    assert.equal(snapshot(id), reference(id), `snapshot rank differs for ${id} in round ${round}`); comparisons++;
  }
}
// A dynamic proxy models dynasty/keeper/ROS values. Unrelated-position getters
// must not run, while changes in values and positions remain visible immediately.
let adjusted = 100, reads = [];
const scores = { target: 100, a: 200, b: 300, c: 400, d: 500, e: 600, unrelated: 9999 };
app.LI = { playerScores: scores, playerMeta: Object.fromEntries(Object.keys(scores).map(id => [id, {pos:id==='unrelated'?'WR':'RB'}])) };
app.PlayerValue = { valueMap: () => new Proxy(scores, { get(object, key) { reads.push(key); return key==='target' ? adjusted : object[key]; } }) };
assert.equal(app.isElitePlayer('target'), false);
assert(!reads.includes('unrelated'), 'ranking RB must not resolve WR values');
const initialSnapshot = app.createElitePlayerSnapshot();
const readsAfterSnapshot = reads.length;
for (let i=0; i<100; i++) assert.equal(initialSnapshot('target'), false);
assert.equal(reads.length, readsAfterSnapshot, 'bulk snapshot reads must not recalculate values');
adjusted = 650; assert.equal(app.isElitePlayer('target'), true, 'current format value must be used');
assert.equal(initialSnapshot('target'), false, 'capture snapshot remains immutable');
assert.equal(app.createElitePlayerSnapshot()('target'), true, 'new capture reads current format values');
adjusted = 100; scores.e = 50; assert.equal(app.isElitePlayer('target'), true, 'in-place score update must not leave stale rank');
scores.e = 600; app.LI.playerMeta.e.pos = 'WR'; assert.equal(app.isElitePlayer('target'), true, 'position update must not leave stale rank');
app.LI.playerMeta.target.pos = ''; adjusted = 7000; assert.equal(app.isElitePlayer('target'), true, '7000 threshold remains position independent');
assert.equal(app.countElitePlayers(['target']), 1);
console.log(`PASS elite-player live and snapshot rank equivalence (${comparisons} comparisons each), dynamic format/metadata updates, immutable bulk reads, and lazy positional reads`);
// Explicit forecast metadata must preserve the live classification result while
// avoiding repeated universe rankings for each projected season.
Object.assign(app, { ageCurveWindows:{}, peakWindows:{}, decayRates:{} });
sandbox.window.S = {};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../player-value.js'), 'utf8'), sandbox);
for (const elite of [false,true]) {
  let calls=0; app.isElitePlayer=()=>{calls++;return elite;};
  for (const delta of [-2,1,2,3]) {
    const live = app.PlayerValue.projectPlayerValue('p',3000,24,'WR',delta,{trend:.2});
    const afterLive=calls;
    const captured = app.PlayerValue.projectPlayerValue('p',3000,24,'WR',delta,{trend:.2,elite});
    assert.equal(captured,live); assert.equal(calls,afterLive);
  }
}
console.log('PASS explicit elite scenario metadata preserves live projections without repeated rank work');
