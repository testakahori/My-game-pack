const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'display-contract-'));
const bin = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
const run = (name, args) => process.stdout.write(execFileSync(bin(name), args, { cwd: root, encoding: 'utf8', windowsHide: true }));
try {
  const classes = path.join(temp, 'classes'), fixture = path.join(temp, 'fixture');
  fs.mkdirSync(classes); fs.mkdirSync(fixture);
  run('javac', ['-encoding', 'UTF-8', '-d', classes,
    'DisplayMod/src/main/java/jp/douma/displaymod/api/DisplayRequest.java',
    'BridgeMod/src/main/java/jp/douma/bridgemod/DisplayLink.java',
    'examples/display-integration/OptionalDisplay.java',
    'DisplayMod/src/contractTest/java/jp/douma/bridgemod/DisplayContractTest.java']);
  run('javac', ['-encoding', 'UTF-8', '-d', fixture, 'DisplayMod/src/contractTest/fixtures/DisplayApi.java']);
  for (const mode of ['absent', 'present', 'throwing', 'linkage']) run('java', ['-Xmx64m', '-Ddisplay.test.mode=' + mode, '-cp',
    mode === 'absent' ? classes : classes + path.delimiter + fixture, 'jp.douma.bridgemod.DisplayContractTest', mode]);
} finally {
  // Only this invocation's verified temporary test output may be removed.
  if (path.dirname(temp) === fs.realpathSync(os.tmpdir()) && path.basename(temp).startsWith('display-contract-')) fs.rmSync(temp, { recursive: true, force: true });
}
