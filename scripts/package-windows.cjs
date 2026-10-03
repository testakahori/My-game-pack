const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { build, Platform, Arch } = require('electron-builder');
const { stripSensitiveEnvVars } = require('builder-util');
const { NpmNodeModulesCollector } = require('app-builder-lib/out/node-module-collector/npmNodeModulesCollector.js');

// Windows electron-builder 26.15 wraps npm in an encoded PowerShell command.
// For Windows builds, invoke the same npm CLI directly with Node and literal argv.
// This keeps the dependency collector intact without shell or antivirus changes.
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const local = process.argv.includes('--local');
if (local ? !version.includes('-local.') : !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(local ? 'Use a -local. version for a local package' : 'Use a stable version for a release package');
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!fs.existsSync(npmCli) || !npmCli.endsWith('npm-cli.js')) throw new Error('Run through npm or set npm_execpath to npm-cli.js');

NpmNodeModulesCollector.prototype.streamCollectorCommandToFile = async function (_command, args, cwd, output) {
  let stdout;
  try {
    stdout = cp.execFileSync(process.execPath, [npmCli, ...args], {
      cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      env: stripSensitiveEnvVars(process.env), stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (error.status !== 1 || !args.includes('list')) throw error;
    stdout = String(error.stdout || ''); // npm list can report valid JSON with ELSPROBLEMS.
  }
  const tree = JSON.parse(stdout);
  if (Array.isArray(tree.problems) && tree.problems.length) {
    throw new Error(`Incomplete production dependencies: ${tree.problems.join("; ")}`);
  }
  fs.writeFileSync(output, stdout);
};

build({ projectDir: root, targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), publish: 'never',
  config: { directories: { output: path.resolve(process.argv.slice(2).find(arg => arg !== '--local') || path.join(root, local ? 'release-local' : 'release')) } },
}).catch(error => { console.error(error); process.exitCode = 1; });
