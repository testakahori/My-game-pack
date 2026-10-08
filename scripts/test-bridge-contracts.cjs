// BridgeMOD・saikutuMOD の中で Minecraft に依存しない部品（認証・強さの上限・視聴者名）を、javac だけで検証する。
// CI の mod-build ジョブで実行する。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-contracts-'));
const bin = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
const main = 'BridgeMod/src/main/java/jp/douma/bridgemod/', contract = 'BridgeMod/src/contractTest/java/jp/douma/bridgemod/';
const saikutu = 'SaikutuMod/src/main/java/jp/douma/saikutumod/', saikutuContract = 'SaikutuMod/src/contractTest/java/jp/douma/saikutumod/';
try {
  const classes = path.join(temp, 'classes'), fixture = path.join(temp, 'fixture');
  fs.mkdirSync(classes); fs.mkdirSync(fixture);
  execFileSync(bin('javac'), ['-encoding', 'UTF-8', '-d', classes,
    ...['BridgeAuth', 'EffectLimits', 'ListenerNames'].map(name => main + name + '.java'),
    ...['BridgeAuthContractTest', 'EffectLimitsContractTest', 'ListenerNamesContractTest'].map(name => contract + name + '.java'),
    saikutu + 'SaikutuLimits.java', saikutuContract + 'SaikutuLimitsContractTest.java'],
    { cwd: root, windowsHide: true, stdio: 'inherit' });
  const run = (name, ...args) => execFileSync(bin('java'), ['-Xmx64m', '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', classes, name.includes('.') ? name : 'jp.douma.bridgemod.' + name, ...args],
    { cwd: root, windowsHide: true, stdio: 'inherit' });
  run('BridgeAuthContractTest', fixture);
  run('EffectLimitsContractTest');
  run('ListenerNamesContractTest');
  run('jp.douma.saikutumod.SaikutuLimitsContractTest');
} finally {
  // Only this invocation's verified temporary test output may be removed.
  if (path.dirname(temp) === fs.realpathSync(os.tmpdir()) && path.basename(temp).startsWith('bridge-contracts-')) fs.rmSync(temp, { recursive: true, force: true });
}
