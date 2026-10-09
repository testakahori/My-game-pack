const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-auth-'));
const bin = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
try {
  const classes = path.join(temp, 'classes'), fixture = path.join(temp, 'fixture');
  fs.mkdirSync(classes); fs.mkdirSync(fixture);
  execFileSync(bin('javac'), ['-encoding', 'UTF-8', '-d', classes,
    'BridgeMod/src/main/java/jp/douma/bridgemod/BridgeAuth.java',
    'BridgeMod/src/contractTest/java/jp/douma/bridgemod/BridgeAuthContractTest.java'], { cwd: root, windowsHide: true, stdio: 'inherit' });
  execFileSync(bin('java'), ['-Xmx64m', '-cp', classes, 'jp.douma.bridgemod.BridgeAuthContractTest', fixture], { cwd: root, windowsHide: true, stdio: 'inherit' });
} finally {
  // Only this invocation's verified temporary test output may be removed.
  if (path.dirname(temp) === fs.realpathSync(os.tmpdir()) && path.basename(temp).startsWith('bridge-auth-')) fs.rmSync(temp, { recursive: true, force: true });
}
