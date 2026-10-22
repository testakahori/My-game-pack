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
    ...['BridgeAuth', 'JumpPhysics', 'ListenerNames', 'StormPlan', 'api/ProtectedBlockIds', 'CommandText', 'CommandRouting', 'api/GameEvents'].map(name => main + name + '.java'),
    ...['BridgeAuthContractTest', 'JumpPhysicsContractTest', 'ListenerNamesContractTest', 'ListenerNamesParity', 'StormPlanContractTest', 'ProtectedBlockIdsContractTest',
      'CommandRoutingContractTest', 'CommandTextParity', 'CommandKeyParity', 'GameCommandParity', 'GameModIdParity'].map(name => contract + name + '.java'),
    saikutu + 'Shockwave.java', saikutu + 'LoadedArea.java', saikutuContract + 'ShockwaveContractTest.java',
    saikutu + 'CommandText.java', saikutuContract + 'CommandTextParity.java',
    'DisplayMod/src/main/java/jp/douma/displaymod/api/DisplayRequest.java', 'DisplayMod/src/contractTest/java/jp/douma/bridgemod/DisplayIdParity.java'],
    { cwd: root, windowsHide: true, stdio: 'inherit' });
  const run = (name, ...args) => execFileSync(bin('java'), ['-Xmx64m', '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', classes, name.includes('.') ? name : 'jp.douma.bridgemod.' + name, ...args],
    { cwd: root, windowsHide: true, stdio: 'inherit' });
  run('BridgeAuthContractTest', fixture);
  run('JumpPhysicsContractTest');
  run('ListenerNamesContractTest');
  run('StormPlanContractTest');
  run('ProtectedBlockIdsContractTest');
  run('CommandRoutingContractTest');
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

  // コマンド txt の読み方（bridge/command_text.cjs）と、コマンドの名前の決まり（bridge/command_files.cjs）を、MOD にも同じ例の一覧で通す。
  // 1つでも結果が違えば失敗にする（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 4・5）。
  const { parseCommandText } = require('../bridge/command_text.cjs');
  const { BRIDGE_COMMAND_KEY } = require('../bridge/command_files.cjs');
  const readFixture = name => JSON.parse(fs.readFileSync(path.join(root, 'bridge', 'test', 'fixtures', name), 'utf8'));
  const parity = (className, inputs) => {
    const out = execFileSync(bin('java'), ['-Xmx64m', '-cp', classes, className],
      { cwd: root, windowsHide: true, input: inputs.map(value => '>' + hex(value)).join('\n') + '\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
    const results = out.split(/\r?\n/).filter(line => line.startsWith('>')).map(line => line.slice(1));
    if (results.length !== inputs.length) throw new Error(`${className}: ${inputs.length} inputs sent but ${results.length} results`);
    return results;
  };
  // MOD の CommandTextParity と同じ形（見出しをキーの順に「キー U+0000 値」を U+0001 でつなぎ、U+0002 のあとにコマンド）。
  const unhex = value => String.fromCharCode(...(value.match(/.{4}/g) || []).map(unit => parseInt(unit, 16)));
  const canonical = text => {
    const { meta, commands } = parseCommandText(text);
    return Object.keys(meta).sort().map(key => key + '\u0000' + meta[key]).join('\u0001') + '\u0002' + commands.join('\u0001');
  };
  const textCases = readFixture('command-text.json');
  for (const className of ['jp.douma.bridgemod.CommandTextParity', 'jp.douma.saikutumod.CommandTextParity']) {
    const results = parity(className, textCases.map(c => c.text));
    const mismatches = textCases.flatMap((c, i) => hex(canonical(c.text)) === results[i] ? [] : [`  ${c.name}: Bridge ${JSON.stringify(canonical(c.text))} / MOD ${JSON.stringify(unhex(results[i]))}`]);
    if (mismatches.length) throw new Error(`${className}: Bridge and MOD read command txt differently\n` + mismatches.join('\n'));
    console.log(`${className}: ${textCases.length} command txt examples match parseCommandText`);
  }
  // SaikutuMod が jar に入れているコマンド txt は、前の SaikutuMod の読み方（キーをそろえない・空の値も入れる）でも同じ結果になる
  // （同じ決まりにそろえても、同梱のファイルの動きは変わらない）。
  const oldSaikutu = text => {
    const meta = {}, commands = [];
    for (const raw of text.split(/\r\n|\r|\n/)) {
      const line = raw.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
      if (!line || line.startsWith('//')) continue;
      if (line.startsWith('#')) {
        const colon = line.indexOf(':');
        if (colon > 1) meta[line.slice(1, colon).replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')] = line.slice(colon + 1).replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
      } else commands.push(line);
    }
    return { meta, commands };
  };
  const bundled = path.join(root, 'SaikutuMod', 'src', 'main', 'resources', 'commands');
  for (const name of fs.readdirSync(bundled).filter(file => file.endsWith('.txt'))) {
    const text = fs.readFileSync(path.join(bundled, name), 'utf8');
    const { meta, commands } = parseCommandText(text);
    if (JSON.stringify({ meta, commands }) !== JSON.stringify(oldSaikutu(text))) throw new Error(`SaikutuMod bundled ${name}: the new reading changes the result`);
  }
  console.log('SaikutuMod bundled command txt: the new reading gives the same result');
  // 名前は BRIDGE が送る形（.txt を除いた部分）で比べる。/ や \ を含む例は、MOD が直接受け取ったときに断ることを見る。
  const nameCases = readFixture('command-names.json');
  const keyResults = parity('jp.douma.bridgemod.CommandKeyParity', nameCases.map(c => c.name));
  const keyMismatches = nameCases.flatMap((c, i) => {
    const bridge = BRIDGE_COMMAND_KEY.test(c.name.replace(/\.txt$/i, ''));
    return bridge === c.ok && keyResults[i] === (c.ok ? '1' : '0') ? [] : [`  ${JSON.stringify(c.name)}: expected ${c.ok} / Bridge ${bridge} / MOD ${keyResults[i] === '1'}`];
  });
  if (keyMismatches.length) throw new Error('CommandKeyParity: Bridge and MOD accept different command names\n' + keyMismatches.join('\n'));
  console.log(`CommandKeyParity: ${nameCases.length} command names match BRIDGE_COMMAND_KEY`);

  // ゲームの一覧・チャットの名前・ゲーム MOD の ID（bridge/game_commands.cjs）を、MOD にも同じ例の一覧で通す。
  // 1つでも結果が違えば失敗にする（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 6。処理のコピー PR6）。
  const { PACK_GAME_IDS, publicCommandKey, isGameModId } = require('../bridge/game_commands.cjs');
  const idsLine = execFileSync(bin('java'), ['-Xmx64m', '-cp', classes, 'jp.douma.bridgemod.GameCommandParity', 'ids'],
    { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).split(/\r?\n/).find(line => line.startsWith('>')) || '>';
  const javaGames = unhex(idsLine.slice(1)).split(',');
  if ([...javaGames].sort().join(',') !== [...PACK_GAME_IDS].sort().join(',')) {
    throw new Error(`GameCommandParity: BridgeMOD lists games ${javaGames.join(',')} but bridge/games.json has ${PACK_GAME_IDS.join(',')}`);
  }
  const gameCases = readFixture('game-commands.json');
  const publicKeys = parity('jp.douma.bridgemod.GameCommandParity', gameCases.map(c => c.name)).map(unhex);
  const gameMismatches = gameCases.flatMap((c, i) => publicCommandKey(c.name) === c.publicKey && publicKeys[i] === c.publicKey ? []
    : [`  ${JSON.stringify(c.name)}: expected ${JSON.stringify(c.publicKey)} / Bridge ${JSON.stringify(publicCommandKey(c.name))} / MOD ${JSON.stringify(publicKeys[i])}`]);
  if (gameMismatches.length) throw new Error('GameCommandParity: Bridge and MOD give different chat names\n' + gameMismatches.join('\n'));
  console.log(`GameCommandParity: ${javaGames.length} games and ${gameCases.length} chat names match bridge/game_commands.cjs`);
  const modCases = readFixture('game-mod-ids.json');
  const modResults = parity('jp.douma.bridgemod.GameModIdParity', modCases.map(c => c.id));
  const modMismatches = modCases.flatMap((c, i) => isGameModId(c.id) === c.ok && modResults[i] === (c.ok ? '1' : '0') ? []
    : [`  ${JSON.stringify(c.id)}: expected ${c.ok} / Bridge ${isGameModId(c.id)} / MOD ${modResults[i] === '1'}`]);
  if (modMismatches.length) throw new Error('GameModIdParity: Bridge and MOD accept different game MOD IDs\n' + modMismatches.join('\n'));
  console.log(`GameModIdParity: ${modCases.length} game MOD IDs match isGameModId`);

  // 音・粒子の ID（bridge/minecraft_ids.cjs）を、受け取る側の DisplayMOD（DisplayRequest.from）にも同じ例の一覧で通す
  // （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 10。処理のコピー PR7）。
  const { isResourceId } = require('../bridge/minecraft_ids.cjs');
  const idCases = readFixture('minecraft-ids.json');
  const idResults = parity('jp.douma.bridgemod.DisplayIdParity', idCases.map(c => c.id));
  const idMismatches = idCases.flatMap((c, i) => isResourceId(c.id) === c.ok && idResults[i] === (c.ok ? '1' : '0') ? []
    : [`  ${JSON.stringify(c.id.length > 40 ? c.id.slice(0, 20) + '…(' + c.id.length + ')' : c.id)}: expected ${c.ok} / Bridge ${isResourceId(c.id)} / DisplayMOD ${idResults[i] === '1'}`]);
  if (idMismatches.length) throw new Error('DisplayIdParity: Bridge and DisplayMOD accept different sound/particle IDs\n' + idMismatches.join('\n'));
  console.log(`DisplayIdParity: ${idCases.length} sound/particle IDs match isResourceId`);
} finally {
  // Only this invocation's verified temporary test output may be removed.
  if (path.dirname(temp) === fs.realpathSync(os.tmpdir()) && path.basename(temp).startsWith('bridge-contracts-')) fs.rmSync(temp, { recursive: true, force: true });
}
