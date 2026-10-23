// 守るファイル（アプリの設定・読み上げの設定など）を、壊れても消えないように読み書きする共通の関数
// （2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 5）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeFileDurable, lastGoodPath, describeRecovery, createSafeJsonFile, peekJsonFile } = require('../../bridge/safe_json_file.cjs');

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

// Windows では、ウイルス対策などが一瞬ファイルを開いていると差し替えが EPERM・EBUSY で失敗することがある。短く数回やり直す（最後のレビューの軽い 1）。
test('書く: 差し替えが一時的に失敗したら、短く数回やり直す。ずっと失敗するなら投げる', t => {
  const { file } = setup(t);
  let calls = 0;
  const restore = replace(t, 'renameSync', original => (from, to) => {
    calls++;
    if (calls <= 2) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return original(from, to);
  });
  writeFileDurable(file, 'after');
  restore();
  assert.equal(calls, 3);
  assert.equal(fs.readFileSync(file, 'utf8'), 'after');
  let attempts = 0;
  const restoreAlways = replace(t, 'renameSync', () => () => { attempts++; throw eperm(); });
  assert.throws(() => writeFileDurable(file, 'never'), /EPERM/);
  restoreAlways();
  assert.ok(attempts > 1 && attempts <= 5, String(attempts));
  assert.equal(fs.readFileSync(file, 'utf8'), 'after');
});

// 書く値の型が違えば書かない。書いてしまうと、次に読むときにファイル全体（ログインも）が壊れている扱いになり、1つ前の写しに戻る（最後のレビューの軽い 2）。
test('書く: 書く値が正しくなければ書かず、今のファイルも写しもそのまま', t => {
  const { file, store } = setup(t);
  store.write({ a: '1' });
  assert.throws(() => store.write({ a: 1 }), /x\.json に書く値が正しくありません（項目 a の型が違う）/);
  assert.throws(() => store.write(null), /x\.json に書く値が正しくありません（オブジェクトでない）/);
  assert.throws(() => store.write(['a']), /オブジェクトでない/);
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ a: '1' }, null, 2));
  assert.equal(fs.existsSync(lastGoodPath(file)), false);
});

// 読み上げの設定は userData と BRIDGE の2か所で同じ名前なので、記録にどちらのフォルダーかを入れる（PR1 の最後のレビューからの申し送り。設定ファイルの PR2）。
test('記録の名前: label があれば名前に使う。defaultsLabel があれば「既定値」の代わりに使う', () => {
  const base = { file: path.join(os.tmpdir(), 'x.json'), reason: 'JSON として読めない', brokenFile: path.join(os.tmpdir(), 'x.json.broken-20261023-153012'),
    label: 'tts-settings.json（BRIDGE のフォルダー）', defaultsLabel: 'userData の読み上げの設定（無ければ既定値）' };
  assert.equal(describeRecovery({ ...base, action: 'defaults' }),
    'tts-settings.json（BRIDGE のフォルダー） が壊れていた（JSON として読めない）。前の正しい状態の写しが無い（または壊れている）ので、userData の読み上げの設定（無ければ既定値）で動く。壊れたファイル: x.json.broken-20261023-153012');
  assert.equal(describeRecovery({ ...base, action: 'restored' }),
    'tts-settings.json（BRIDGE のフォルダー） が壊れていた（JSON として読めない）ので、前の正しい状態の写しから戻した。壊れたファイル: x.json.broken-20261023-153012');
  assert.equal(describeRecovery({ ...base, action: 'defaults', brokenFile: '' }),
    'tts-settings.json（BRIDGE のフォルダー） が壊れていた（JSON として読めない）。別の名前で残せなかったので、ファイルには触らず、userData の読み上げの設定（無ければ既定値）で動く');
});

test('読む: label・defaultsLabel を記録に入れる', t => {
  const { file, records, store } = setup(t, { label: 'L', defaultsLabel: 'D' });
  fs.writeFileSync(file, '{壊れた');
  store.read();
  assert.equal(records.length, 1);
  assert.equal(records[0].label, 'L');
  assert.equal(records[0].defaultsLabel, 'D');
});

// BRIDGE が userData 側の読み上げの設定を使うときは、読むだけで戻したり書いたりしない（userData は main のもの）。
test('読むだけ: 正しければ値、無い・壊れていれば null。ファイルには触らない', t => {
  const { dir, file } = setup(t);
  assert.equal(peekJsonFile(file), null, '無い');
  fs.writeFileSync(file, '{"a":"x"}');
  assert.deepEqual(peekJsonFile(file), { a: 'x' });
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":"bom"}')]));
  assert.deepEqual(peekJsonFile(file), { a: 'bom' });
  for (const content of ['{壊れた', 'null', '[]']) {
    fs.writeFileSync(file, content);
    assert.equal(peekJsonFile(file), null, content);
  }
  fs.writeFileSync(file, '{"a":1}');
  assert.equal(peekJsonFile(file, problem), null, 'problem に合わない');
  assert.deepEqual(peekJsonFile(file), { a: 1 }, 'problem を渡さなければ型は見ない');
  assert.deepEqual(fs.readdirSync(dir), ['x.json'], '.broken- も .last-good も作らない');
});
