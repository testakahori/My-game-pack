// BridgeMOD・saikutuMOD の中で Minecraft に依存しない部品（認証・ジャンプの高さ・視聴者名・保護するブロック・衝撃波の形）を、javac だけで検証する。
// 視聴者名は Bridge（safeDisplayName）と同じ結果になることも、同じ入力を両方に通して確かめる。
// CI の mod-build ジョブで実行する。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { safeDisplayName } = require('../bridge/tiktok_events.cjs');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-contracts-'));
const bin = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
const main = 'BridgeMod/src/main/java/jp/douma/bridgemod/', contract = 'BridgeMod/src/contractTest/java/jp/douma/bridgemod/';
const saikutu = 'SaikutuMod/src/main/java/jp/douma/saikutumod/', saikutuContract = 'SaikutuMod/src/contractTest/java/jp/douma/saikutumod/';
try {
  const classes = path.join(temp, 'classes'), fixture = path.join(temp, 'fixture');
  fs.mkdirSync(classes); fs.mkdirSync(fixture);
  execFileSync(bin('javac'), ['-encoding', 'UTF-8', '-d', classes,
    ...['BridgeAuth', 'JumpPhysics', 'ListenerNames', 'api/ProtectedBlockIds'].map(name => main + name + '.java'),
    ...['BridgeAuthContractTest', 'JumpPhysicsContractTest', 'ListenerNamesContractTest', 'ListenerNamesParity', 'ProtectedBlockIdsContractTest'].map(name => contract + name + '.java'),
    saikutu + 'Shockwave.java', saikutuContract + 'ShockwaveContractTest.java'],
    { cwd: root, windowsHide: true, stdio: 'inherit' });
  const run = (name, ...args) => execFileSync(bin('java'), ['-Xmx64m', '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', classes, name.includes('.') ? name : 'jp.douma.bridgemod.' + name, ...args],
    { cwd: root, windowsHide: true, stdio: 'inherit' });
  run('BridgeAuthContractTest', fixture);
  run('JumpPhysicsContractTest');
  run('ListenerNamesContractTest');
  run('ProtectedBlockIdsContractTest');
  run('jp.douma.saikutumod.ShockwaveContractTest');
  // 視聴者名の規則は Bridge（bridge/tiktok_events.cjs の safeDisplayName）と MOD（ListenerNames）の2か所にある。
  // 境目になりやすい名前を両方に通し、1つでも結果が違えば失敗にする（Bridge は空なら次の候補の ID へ、MOD は viewer にする）。
  // 片割れのサロゲートも壊さずに渡せるよう、UTF-16 の1単位ごとの16進数で受け渡す。
  const hex = text => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16).padStart(4, '0')).join('');
  const x = n => 'x'.repeat(n), smile = '\u{1f600}', high = '\u{d83d}', low = '\u{de00}';
  const names = [
    '', 'ふつうの名前', 'viewer',
    // 書式コード（§ と次の1文字）。末尾の § だけ・§ の次が絵文字や片割れのサロゲート・全角空白。
    'abc§', '§', '§§a', '§cRed§r', '§' + smile + 'abc', '§\u{3000}name', '§' + high + 'abc', high + '§', x(39) + '§' + smile,
    // 片割れのサロゲート（上位だけ・下位だけ・逆順・正しいペアの後ろ）。
    high, low, 'a' + high + 'b', 'a' + low + 'b', low + high, smile + high,
    // 40文字の境目（サロゲートペアを途中で切らない）。前後の空白を削ってから数える。
    x(39) + smile + 'y', x(40) + smile, x(39) + smile + smile, x(50), smile.repeat(45), x(39) + ' yz', ' '.repeat(5) + x(45),
    // 前後の空白（全角空白だけ・NBSP・BOM・その他の空白）。幅のない空白（U+200B）は空白に数えない。
    '\u{3000}\u{3000}\u{3000}', '\u{a0}name\u{feff}', '\u{feff}\u{a0} 名前 \u{3000}', '\u{1680}\u{2000}\u{2005}\u{200a}\u{202f}\u{205f}name\u{2009}', '\u{200b}',
    // 引用符・バックスラッシュ。
    'a"b\'c\\d"\\\'', 'a\'},Passengers:[{id:"wither"}],x:{\'',
    // 文字の向き・改行を変える制御文字と、ふつうの制御文字。
    'abc\u{202e}def', '\u{2066}x\u{2069}', '\u{202a}\u{202b}\u{202c}\u{202d}\u{202e}', 'line\u{2028}break\u{2029}end', '\u{2028}\u{2029}',
    '\u{200e}abc\u{200f}\u{61c}', 'a\u{0}b\u{7}c\u{7f}\u{85}d\u{9f}', 'a\r\nb\tc', '\u{b}\u{c}',
  ];
  const output = execFileSync(bin('java'), ['-Xmx64m', '-cp', classes, 'jp.douma.bridgemod.ListenerNamesParity'],
    { cwd: root, windowsHide: true, input: names.map(name => '>' + hex(name)).join('\n') + '\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
  const results = output.split(/\r?\n/).filter(line => line.startsWith('>')).map(line => line.slice(1));
  if (results.length !== names.length) throw new Error(`ListenerNames parity: ${names.length} names sent but ${results.length} results`);
  const mismatches = names.flatMap((name, i) => hex(safeDisplayName(name) || 'viewer') === results[i] ? []
    : [`  input ${hex(name)}: Bridge ${hex(safeDisplayName(name) || 'viewer')} / MOD ${results[i]}`]);
  if (mismatches.length) throw new Error('ListenerNames parity: Bridge and MOD disagree\n' + mismatches.join('\n'));
  console.log(`ListenerNames parity: ${names.length} names match safeDisplayName`);
} finally {
  // Only this invocation's verified temporary test output may be removed.
  if (path.dirname(temp) === fs.realpathSync(os.tmpdir()) && path.basename(temp).startsWith('bridge-contracts-')) fs.rmSync(temp, { recursive: true, force: true });
}
