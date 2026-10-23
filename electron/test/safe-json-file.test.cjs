// 守るファイル（アプリの設定・読み上げの設定など）を、壊れても消えないように読み書きする共通の関数
// （2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 5）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeFileDurable, lastGoodPath, describeRecovery, createSafeJsonFile } = require('../../bridge/safe_json_file.cjs');

const NOW = () => new Date(2026, 9, 23, 15, 30, 12);
const problem = value => typeof value.a === 'number' ? '項目 a の型が違う' : '';

function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-json-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'x.json');
  const records = [];
  const store = createSafeJsonFile({ file: () => file, defaults: () => ({ a: 'default' }), problem, record: entry => records.push(entry), now: NOW, ...options });
  return { dir, file, records, store, brokenFile: path.join(dir, 'x.json.broken-20261023-153012') };
}

// fs の関数を、このテストの間だけ差し替える。返す関数を呼ぶと、その場で元に戻す。
function replace(t, name, make) {
  const original = fs[name];
  const restore = () => { fs[name] = original; };
  fs[name] = make(original);
  t.after(restore);
  return restore;
}

const eperm = () => Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });

test('書く: 一時ファイルに書いて fsync してから差し替え、一時ファイルを残さない', t => {
  const { dir, file } = setup(t);
  const calls = [];
  const restoreSync = replace(t, 'fsyncSync', original => fd => { calls.push('fsync'); return original(fd); });
  const restoreRename = replace(t, 'renameSync', original => (from, to) => { calls.push('rename'); return original(from, to); });
  writeFileDurable(file, '{"a":"1"}');
  restoreSync(); restoreRename();
  assert.deepEqual(calls, ['fsync', 'rename']);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":"1"}');
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), []);
});

test('書く: 差し替えに失敗したら一時ファイルを消して投げ、元のファイルはそのまま', t => {
  const { dir, file } = setup(t);
  fs.writeFileSync(file, 'before');
  const restore = replace(t, 'renameSync', () => () => { throw eperm(); });
  assert.throws(() => writeFileDurable(file, 'after'), /EPERM/);
  restore();
  assert.equal(fs.readFileSync(file, 'utf8'), 'before');
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), []);
});

test('atomicWrite は writeFileDurable と同じもの', () => {
  assert.equal(require('../settings_backups.cjs').atomicWrite, writeFileDurable);
});

test('読む: 無いときは既定値で、写しがあっても使わず、記録しない', t => {
  const { file, records, store } = setup(t);
  fs.writeFileSync(lastGoodPath(file), '{"a":"good"}');
  assert.equal(lastGoodPath(file), file + '.last-good');
  assert.deepEqual(store.read(), { a: 'default' });
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(records, []);
});

test('読む: 正しいファイルはそのまま。先頭に BOM があっても読める', t => {
  const { dir, file, records, store } = setup(t);
  fs.writeFileSync(file, '{"a":"x","other":3}');
  assert.deepEqual(store.read(), { a: 'x', other: 3 });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":"bom"}')]));
  assert.deepEqual(store.read(), { a: 'bom' });
  assert.deepEqual(records, []);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['x.json']);
});

test('読む: 壊れた中身ごとに、写しから戻し、壊れたファイルを名前を変えて残し、1行記録する', t => {
  const cases = [
    ['', 'JSON として読めない'], ['{"a":', 'JSON として読めない'], [Buffer.alloc(8), 'JSON として読めない'],
    ['null', 'オブジェクトでない'], ['[]', 'オブジェクトでない'], ['3', 'オブジェクトでない'], ['"x"', 'オブジェクトでない'],
    ['{"a":1}', '項目 a の型が違う'],
  ];
  for (const [content, reason] of cases) {
    const { file, records, store, brokenFile } = setup(t);
    fs.writeFileSync(file, content);
    fs.writeFileSync(lastGoodPath(file), '{"a":"good"}');
    assert.deepEqual(store.read(), { a: 'good' }, JSON.stringify(String(content)));
    assert.equal(fs.readFileSync(file, 'utf8'), '{"a":"good"}', '写しのバイトを書き戻す');
    assert.deepEqual(fs.readFileSync(brokenFile), Buffer.from(content), '壊れたファイルは元のバイトのまま');
    assert.deepEqual(records, [{ file, reason, action: 'restored', brokenFile }]);
  }
});

test('読む: 読めないとき（フォルダーになっている）も壊れていると扱う', t => {
  const { file, records, store, brokenFile } = setup(t);
  fs.mkdirSync(file);
  fs.writeFileSync(lastGoodPath(file), '{"a":"good"}');
  assert.deepEqual(store.read(), { a: 'good' });
  assert.equal(fs.statSync(brokenFile).isDirectory(), true);
  assert.deepEqual(records.map(entry => entry.reason), ['ファイルを読めない（EISDIR）']);
});

test('読む: 写しが無い・写しも壊れているときは既定値。壊れたファイルは残し、写しは消さない', t => {
  for (const copy of [null, '{壊れた写し', '{"a":2}']) {
    const { file, records, store, brokenFile } = setup(t);
    fs.writeFileSync(file, '{壊れた');
    if (copy !== null) fs.writeFileSync(lastGoodPath(file), copy);
    assert.deepEqual(store.read(), { a: 'default' });
    assert.equal(fs.existsSync(file), false, '元の場所は空いたまま');
    assert.equal(fs.readFileSync(brokenFile, 'utf8'), '{壊れた');
    if (copy !== null) assert.equal(fs.readFileSync(lastGoodPath(file), 'utf8'), copy, '壊れた写しはそのまま');
    assert.deepEqual(records, [{ file, reason: 'JSON として読めない', action: 'defaults', brokenFile }]);
  }
});

test('読む: 同じ秒に2回壊れても、前の壊れたファイルを上書きしない', t => {
  const { file, store, brokenFile } = setup(t);
  fs.writeFileSync(file, 'first');
  store.read();
  fs.writeFileSync(file, 'second');
  store.read();
  assert.equal(fs.readFileSync(brokenFile, 'utf8'), 'first');
  assert.equal(fs.readFileSync(brokenFile + '-2', 'utf8'), 'second');
});

// 読むのは止めない（アプリの設定は起動の途中でも読むので、投げるとウィンドウが出ない。最後のレビューの重要 1）。
// 残せない壊れたファイルを上書きしないよう、止めるのは書くときだけ。
test('読む: 中身を写せないときは名前を変えて残す。どちらもできなければファイルに触らず写しの値で動き、書くのは止める', t => {
  {
    const { file, store, brokenFile } = setup(t);
    fs.writeFileSync(file, '{壊れた');
    fs.writeFileSync(lastGoodPath(file), '{"a":"good"}');
    let calls = 0;
    const restore = replace(t, 'renameSync', original => (from, to) => { if (calls++ === 0) throw eperm(); return original(from, to); });
    assert.deepEqual(store.read(), { a: 'good' });
    restore();
    assert.equal(fs.readFileSync(brokenFile, 'utf8'), '{壊れた');
  }
  {
    const { file, store, records } = setup(t);
    fs.writeFileSync(file, '{壊れた');
    fs.writeFileSync(lastGoodPath(file), '{"a":"good"}');
    const restore = replace(t, 'renameSync', () => () => { throw eperm(); });
    assert.deepEqual(store.read(), { a: 'good' }, '投げない');
    assert.deepEqual(store.read(), { a: 'good' });
    assert.throws(() => store.write({ a: 'new' }), /x\.json が壊れていて、別の名前で残せません（JSON として読めない）/);
    restore();
    assert.equal(fs.readFileSync(file, 'utf8'), '{壊れた', '元のファイルには触らない');
    assert.deepEqual(records, [{ file, reason: 'JSON として読めない', action: 'restored', brokenFile: '' }], '記録は1回');
  }
});

// 前は壊れたファイルの名前を変えてから写しを書き戻していたので、書き戻しに失敗すると元の場所が空き、
// 次に読むと「ファイルが無い」として黙って既定値になり、その後の保存で写しまで上書きした（最後のレビューの重要 1）。
test('読む: 写しを書き戻せなくても投げず、壊れたファイルを元の場所に置いたまま、次に読むときにやり直す', t => {
  const { dir, file, store, records, brokenFile } = setup(t);
  fs.writeFileSync(file, '{壊れた');
  fs.writeFileSync(lastGoodPath(file), '{"a":"good"}');
  const restore = replace(t, 'renameSync', original => (from, to) => { if (to === file) throw eperm(); return original(from, to); });
  assert.deepEqual(store.read(), { a: 'good' });
  assert.equal(fs.readFileSync(file, 'utf8'), '{壊れた', '元の場所は空けない');
  restore();
  assert.deepEqual(store.read(), { a: 'good' });
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":"good"}', '次に読むときに書き戻す');
  assert.equal(fs.readFileSync(brokenFile, 'utf8'), '{壊れた');
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.includes('.broken-')), ['x.json.broken-20261023-153012'], '壊れたファイルは1つだけ');
  assert.equal(records.length, 1);
});

// 別のプログラムが削除を許さずに開いていると、名前の変更も削除もできない。読むたびに壊れたファイルと記録を増やさない（最後のレビューの重要 1）。
test('読む: 名前を変えられず消せないファイルでも、壊れたファイルを何度も残さず、記録も1回', t => {
  for (const copy of [null, '{"a":"good"}']) {
    const { dir, file, store, records } = setup(t);
    fs.writeFileSync(file, '{壊れた');
    if (copy) fs.writeFileSync(lastGoodPath(file), copy);
    const restoreRename = replace(t, 'renameSync', original => (from, to) => { if (from === file || to === file) throw eperm(); return original(from, to); });
    const restoreUnlink = replace(t, 'unlinkSync', original => target => { if (target === file) throw eperm(); return original(target); });
    for (let i = 0; i < 5; i++) assert.deepEqual(store.read(), copy ? { a: 'good' } : { a: 'default' });
    restoreRename(); restoreUnlink();
    assert.equal(fs.readdirSync(dir).filter(name => name.includes('.broken-')).length, 1, String(copy));
    assert.equal(records.length, 1, String(copy));
  }
});

test('書く: 正しく読めた中身だけを写しにする', t => {
  const { file, store, brokenFile } = setup(t);
  store.write({ a: '1' });
  assert.equal(fs.existsSync(lastGoodPath(file)), false, '前は無いので写しも無い');
  store.write({ a: '2' });
  assert.deepEqual(JSON.parse(fs.readFileSync(lastGoodPath(file), 'utf8')), { a: '1' });
  fs.writeFileSync(file, '{壊れた');
  store.write({ a: '3' });
  assert.equal(fs.readFileSync(brokenFile, 'utf8'), '{壊れた');
  assert.deepEqual(JSON.parse(fs.readFileSync(lastGoodPath(file), 'utf8')), { a: '1' }, '壊れた中身で写しを上書きしない');
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ a: '3' }, null, 2));
});

test('記録が投げても、読み書きは止めない', t => {
  const { file, store } = setup(t, { record: () => { throw new Error('記録できない'); } });
  fs.writeFileSync(file, '{壊れた');
  fs.writeFileSync(lastGoodPath(file), '{"a":"good"}');
  assert.deepEqual(store.read(), { a: 'good' });
  fs.writeFileSync(file, '{壊れた');
  store.write({ a: 'next' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 'next' });
});

test('記録の文', () => {
  const entry = { file: path.join(os.tmpdir(), 'app-config.json'), reason: 'JSON として読めない', brokenFile: path.join(os.tmpdir(), 'app-config.json.broken-20261023-153012') };
  assert.equal(describeRecovery({ ...entry, action: 'restored' }),
    'app-config.json が壊れていた（JSON として読めない）ので、前の正しい状態の写しから戻した。壊れたファイル: app-config.json.broken-20261023-153012');
  assert.equal(describeRecovery({ ...entry, action: 'defaults' }),
    'app-config.json が壊れていた（JSON として読めない）。前の正しい状態の写しが無い（または壊れている）ので、既定値で動く。壊れたファイル: app-config.json.broken-20261023-153012');
  assert.equal(describeRecovery({ ...entry, action: 'restored', brokenFile: '' }),
    'app-config.json が壊れていた（JSON として読めない）。別の名前で残せなかったので、ファイルには触らず、前の正しい状態の写しの中身で動く');
  assert.equal(describeRecovery({ ...entry, action: 'defaults', brokenFile: '' }),
    'app-config.json が壊れていた（JSON として読めない）。別の名前で残せなかったので、ファイルには触らず、既定値で動く');
});
