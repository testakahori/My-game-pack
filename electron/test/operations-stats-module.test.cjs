// 操作履歴・配信統計・視聴者数・受取額・配信の記録・ギフト案内画像（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOperationsStats } = require('../operations_stats.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-stats-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = path.join(root, 'bridge'), state = { bridge: null }, handlers = new Map();
  fs.mkdirSync(bridge);
  const operationsStats = createOperationsStats({ BrowserWindow: { getFocusedWindow: () => null }, dialog: {}, getBridgeBatDir: () => bridge, bridgeChild: () => state.bridge });
  operationsStats.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { bridge, state, operationsStats, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('配信の記録の状態: main から受け取った BRIDGE の子プロセスがあるときだけ見張り中とし、記録の失敗を出す', t => {
  const x = setup(t);
  fs.writeFileSync(path.join(x.bridge, 'runtime-status.json'), JSON.stringify({ recording: { error: '記録できません' } }));
  assert.deepEqual(x.invoke('stream:session:status'), { active: null, monitoring: false, error: '' });
  x.state.bridge = { pid: 1 };
  assert.deepEqual(x.invoke('stream:session:status'), { active: null, monitoring: true, error: '記録できません' });
});

test('起動のときの履歴の整理: 古い配列の履歴を JSONL に直し、30日より古い行を消す', t => {
  const x = setup(t);
  const file = path.join(x.bridge, 'operations-history.json');
  const old = new Date(Date.now() - 40 * 86400000).toISOString(), recent = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify([{ at: recent, commandFile: 'new.txt' }, { at: old, commandFile: 'old.txt' }]));
  x.operationsStats.pruneOperationsHistoryOldRows(30);
  assert.deepEqual(fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line).commandFile), ['new.txt']);
  assert.deepEqual(x.invoke('operations:history').map(row => row.commandFile), ['new.txt']);
});
