const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { createEulerCredentials } = require('../euler_credentials.cjs');
const { connectionOptions, redactSecrets, retryDelay } = require('../../bridge/tiktok_connection.cjs');
const { runProc } = require('../process_runner.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'euler-key-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'credentials.json');
  const secret = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: text => {
      const iv = crypto.randomBytes(16), cipher = crypto.createCipheriv('aes-256-cbc', secret, iv);
      return Buffer.concat([iv, cipher.update(text), cipher.final()]);
    },
    decryptString: data => {
      const cipher = crypto.createDecipheriv('aes-256-cbc', secret, data.subarray(0, 16));
      return Buffer.concat([cipher.update(data.subarray(16)), cipher.final()]).toString();
    },
  };
  const options = { filePath: () => file, safeStorage };
  return { file, safeStorage, store: createEulerCredentials(options), reopen: () => createEulerCredentials(options) };
}

test('Eulerキー: 暗号化保存・再起動後の読込・更新適用の判定・削除', t => {
  const { file, store, reopen } = fixture(t);
  assert.equal(store.status(null, false).configured, false);
  store.save('  fixture-key-one  ');
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /fixture-key-one/);
  const current = reopen().runtime({ PATH: 'keep', SIGN_API_KEY: 'inherited-key' });
  assert.equal(current.env.SIGN_API_KEY, 'fixture-key-one');
  assert.equal(current.env.PATH, 'keep');
  assert.equal(store.status(current.revision, true).restartRequired, false);
  assert.doesNotMatch(JSON.stringify(store.status(null, true)), /fixture-key/);
  store.save('fixture-key-two');
  assert.equal(store.status(current.revision, true).restartRequired, true);
  assert.equal(store.status(current.revision, false).restartRequired, false);
  store.clear(); store.clear();
  assert.equal(store.status(current.revision, true).restartRequired, true);
  assert.equal(store.runtime({ SIGN_API_KEY: 'inherited-key' }).env.SIGN_API_KEY, undefined);
  assert.equal(fs.existsSync(file), false);
});

test('Eulerキー: 不正入力・暗号化不可・破損は平文保存や黙った接続にフォールバックしない', t => {
  const { file, store, safeStorage } = fixture(t);
  for (const input of ['', null, {}, 'a b', 'a\nb', 'a\x00b', 'x'.repeat(4097)]) assert.throws(() => store.save(input));
  assert.equal(fs.existsSync(file), false);
  store.save('fixture-preserved-key');
  const before = fs.readFileSync(file);
  safeStorage.isEncryptionAvailable = () => false;
  assert.throws(() => store.save('replacement'), /暗号化/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.throws(() => store.runtime(), /読み込めません/);
  assert.match(store.status(null, false).error, /読み込めません/);
  safeStorage.isEncryptionAvailable = () => true;
  fs.writeFileSync(file, 'corrupted');
  assert.throws(() => store.runtime(), /読み込めません/);
  store.save('repaired-key');
  assert.equal(store.runtime({}).env.SIGN_API_KEY, 'repaired-key');
});

test('Connector 2.5: 実APIクライアントへのキー設定と429の待ち時間（ミリ秒）', () => {
  const requireBridge = createRequire(path.resolve(__dirname, '../../bridge/index.js'));
  const { TikTokLiveConnection, SignatureRateLimitError, SignConfig } = requireBridge('tiktok-live-connector');
  const connection = new TikTokLiveConnection('fixture', connectionOptions({ SIGN_API_KEY: 'fixture-constructor-key' }));
  assert.equal(SignConfig.apiKey, 'fixture-constructor-key');
  assert.equal(connection.webClient.apiClient.configuration.baseOptions.headers['X-Api-Key'], 'fixture-constructor-key');
  const error = new SignatureRateLimitError('Please wait before making another request.', 'Retry %s', { headers: { 'retry-after': '120', 'x-ratelimit-reset': '2000000000' } });
  assert.equal(error.retryAfter, 120000);
  assert.equal(retryDelay(error, 1), 120000);
  assert.equal(retryDelay({ message: 'offline' }, 1), 30000);
  assert.equal(retryDelay({ message: 'network' }, 9), 60000);
  assert.deepEqual(connectionOptions({}), { processInitialData: false });
});

test('APIキー: エラー文と子プロセスの分割出力から漏れない', async () => {
  const key = 'fixture+private/key';
  const safe = redactSecrets(`${key} ${encodeURIComponent(key)} {"apiKey":"some-other-key"}`, key);
  assert.doesNotMatch(safe, /fixture|some-other-key/);
  const env = { ...process.env, SIGN_API_KEY: key };
  const result = await runProc(process.execPath, ['-e', 'process.stdout.write(process.env.SIGN_API_KEY.slice(0,5));setTimeout(()=>console.log(process.env.SIGN_API_KEY.slice(5)),30)'], os.tmpdir(), { env });
  assert.doesNotMatch(result.out, /fixture/);
  await assert.rejects(runProc(process.execPath, ['-e', 'console.error("FAILED: " + process.env.SIGN_API_KEY);process.exit(2)'], os.tmpdir(), { env }), error => !error.message.includes(key) && error.message.includes('非表示'));
});
