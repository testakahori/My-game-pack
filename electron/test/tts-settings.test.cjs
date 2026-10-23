// 読み上げの既定値・範囲・エンジンのポートは bridge/tts_settings.json、整え方と声の設定の入れ方は bridge/tts_settings.cjs の1か所（処理のコピー PR9）。
// 前は BRIDGE（bridge/index.js）・アプリ（electron/tts_ipc.cjs・tts.cjs）・画面（TTSSettingsPage.tsx）・開発用（vite.config.ts・devApiMock.ts）が別々に持っていた。
// 読み上げのテストは音量をエンジンに渡さず、画面の再生で 1 までに丸めていたので、100〜200% が同じ大きさで鳴った（本番は大きくなる）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('読み上げの設定: 既定値・範囲・ポートは1つの表', () => {
  const { TTS_SETTINGS } = require('../../bridge/tts_settings.cjs');
  assert.deepEqual(TTS_SETTINGS.defaults, {
    engine: 'voicevox', speakerId: 2, speedScale: 1.2, pitchScale: 0, intonationScale: 1, volume: 1,
    enabled: true, commentEnabled: true, giftEnabled: true, giftTemplate: '{sender}さんから{gift}が来たよ！',
  });
  assert.deepEqual(TTS_SETTINGS.ranges, { speedScale: [0.5, 2], pitchScale: [-0.15, 0.15], intonationScale: [0, 2], volume: [0, 2] });
  assert.deepEqual(TTS_SETTINGS.ports, { voicevox: 50021, aivis: 10101 });
  assert.equal(TTS_SETTINGS.giftTemplateMax, 200);
});

test('読み上げの設定: 整え方は今の BRIDGE・アプリと同じ結果', () => {
  const { normalizeTtsSettings } = require('../../bridge/tts_settings.cjs');
  assert.deepEqual(normalizeTtsSettings({ engine: 'aivis', speakerId: 2.7, speedScale: 9, pitchScale: 'x', intonationScale: -1, volume: 1.8, enabled: false, giftTemplate: 'a'.repeat(300) }), {
    engine: 'aivis', speakerId: 2, speedScale: 2, pitchScale: 0, intonationScale: 0, volume: 1.8,
    enabled: false, commentEnabled: true, giftEnabled: true, giftTemplate: 'a'.repeat(200),
  });
  assert.deepEqual(normalizeTtsSettings(null), normalizeTtsSettings({}));
  assert.equal(normalizeTtsSettings({ engine: 'other' }).engine, 'voicevox');
  assert.equal(normalizeTtsSettings({ speakerId: -5 }).speakerId, 0);
});

test('読み上げの設定: 声の設定（速さ・高さ・抑揚・音量）は1つの関数でエンジンの問い合わせに入れる', () => {
  const { applyVoiceSettings, normalizeTtsSettings } = require('../../bridge/tts_settings.cjs');
  const query = applyVoiceSettings({ accent_phrases: [] }, normalizeTtsSettings({ speedScale: 1.5, pitchScale: 0.1, intonationScale: 0.8, volume: 1.8 }));
  assert.deepEqual(query, { accent_phrases: [], speedScale: 1.5, pitchScale: 0.1, intonationScale: 0.8, volumeScale: 1.8 });
  // 本番（BRIDGE）と読み上げのテスト（アプリ）の両方がこの関数を使う。テストは整えた設定ごと渡し、音量も入る。
  assert.match(read('bridge/index.js'), /applyVoiceSettings\(query, cfg\)/);
  assert.match(read('electron/tts.cjs'), /applyVoiceSettings\(query, settings\)/);
  assert.match(read('electron/tts_ipc.cjs'), /synthesize\(normalized\.engine, text, normalized\)/);
  // 画面の再生では音量を掛けない（エンジンが入れる。前は 1 までに丸めていた）。
  assert.doesNotMatch(read('src/components/TTSSettingsPage.tsx'), /Math\.min\(1, Math\.max\(0, settings\.volume\)\)/);
});

test('読み上げの設定: 既定値・範囲・ポートの写しを持たない', () => {
  for (const file of ['bridge/index.js', 'electron/tts_ipc.cjs', 'electron/tts.cjs', 'vite.config.ts', 'src/components/TTSSettingsPage.tsx', 'src/lib/devApiMock.ts']) {
    const source = read(file);
    // ポートは数字で探す（\b を付けると「\ のあとに16進数」を書かない見張りに当たる）。
    for (const copy of [/50021/, /10101/, /speedScale: 1\.2/, /function clampNumber/, /function ttsNumber/, /cfg\.speedScale \?\? /]) {
      assert.doesNotMatch(source, copy, `${file} に読み上げの決まりの写しがある（${copy}）`);
    }
  }
  const page = read('src/components/TTSSettingsPage.tsx');
  assert.match(page, /bridge\/tts_settings\.json/, '画面は表を読む');
  assert.doesNotMatch(page, /engine === "voicevox" \? 3/, '話者の既定は表の speakerId');
  assert.doesNotMatch(page, /minLabel="0\.5" midLabel="1\.0" maxLabel="2\.0" onChange=\{\(intonationScale\)/, '抑揚の左端の目盛りは範囲の下限');
});

// 読み上げのテスト（tts:test → electron/tts.cjs の synthesize）を、通信なしで動かして音量が入ることを確かめる（PR9 の最後のレビュー）。
// http.request を差し替え、エンジンへ送った synthesis の本文を見る（本物のポートは使わない）。
test('読み上げのテスト: 整えた設定の音量・速さがエンジンへ送る本文に入る', async t => {
  const http = require('node:http');
  const { EventEmitter } = require('node:events');
  const sent = [];
  const original = http.request;
  t.after(() => { http.request = original; });
  http.request = (options, onResponse) => {
    const req = new EventEmitter();
    let body = '';
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.write = chunk => { body += chunk; };
    req.end = () => {
      sent.push({ path: options.path, body });
      const res = new EventEmitter();
      res.statusCode = 200;
      setImmediate(() => {
        onResponse(res);
        res.emit('data', Buffer.from(options.path.startsWith('/audio_query') ? JSON.stringify({ accent_phrases: [] }) : 'RIFF'));
        res.emit('end');
      });
    };
    return req;
  };
  const { synthesize } = require('../tts.cjs');
  const { normalizeTtsSettings } = require('../../bridge/tts_settings.cjs');
  await synthesize('voicevox', 'テスト', normalizeTtsSettings({ volume: 1.8, speedScale: 9 }));
  const synthesis = sent.find(request => request.path.startsWith('/synthesis'));
  assert.ok(synthesis, JSON.stringify(sent));
  assert.deepEqual(JSON.parse(synthesis.body), { accent_phrases: [], speedScale: 2, pitchScale: 0, intonationScale: 1, volumeScale: 1.8 });
});

// 画面と開発用の表示の既定のエンジンも表から読み、目盛りの端の文字も範囲から作る（PR9 の最後のレビュー）。
test('読み上げの設定: 画面と開発用の表示はエンジンの既定も表から読み、開発用のテストも音量を入れる', () => {
  for (const file of ['src/components/TTSSettingsPage.tsx', 'src/lib/devApiMock.ts']) {
    assert.doesNotMatch(read(file), /\.\.\.TTS_SETTINGS\.defaults, engine: "voicevox"/, file + ' がエンジンの既定を書いたままにしている');
  }
  const page = read('src/components/TTSSettingsPage.tsx');
  for (const label of ['maxLabel="2.0"', 'maxLabel="200%"', 'maxLabel="+0.15"', 'minLabel="-0.15"', 'minLabel="0%"']) {
    assert.equal(page.includes(label), false, `目盛りの文字 ${label} を範囲から作っていない`);
  }
  const mock = read('src/lib/devApiMock.ts');
  assert.match(mock, /query\.volumeScale = settings\.volume/, '開発用の読み上げのテストも音量を入れる（画面の再生では掛けないため）');
});
