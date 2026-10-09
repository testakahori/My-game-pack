const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'effect-limits-'));
const bin = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
try {
  execFileSync(bin('javac'), ['-encoding', 'UTF-8', '-d', temp,
    'BridgeMod/src/main/java/jp/douma/bridgemod/EffectLimits.java',
    'BridgeMod/src/contractTest/java/jp/douma/bridgemod/EffectLimitsContractTest.java',
    'SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuLimits.java',
    'SaikutuMod/src/contractTest/java/jp/douma/saikutumod/SaikutuLimitsContractTest.java'], { cwd: root, windowsHide: true, stdio: 'inherit' });
  execFileSync(bin('java'), ['-Xmx64m', '-cp', temp, 'jp.douma.bridgemod.EffectLimitsContractTest'], { cwd: root, windowsHide: true, stdio: 'inherit' });
  execFileSync(bin('java'), ['-Xmx64m', '-cp', temp, 'jp.douma.saikutumod.SaikutuLimitsContractTest'], { cwd: root, windowsHide: true, stdio: 'inherit' });
} finally {
  // Only this invocation's verified temporary test output may be removed.
  if (path.dirname(temp) === fs.realpathSync(os.tmpdir()) && path.basename(temp).startsWith('effect-limits-')) fs.rmSync(temp, { recursive: true, force: true });
}
