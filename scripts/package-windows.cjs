const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
// The version rule lives in release_version.cjs. Build installers with npm run release:win,
// which runs the build and prepare steps first (scripts/release-windows.cjs). Run directly,
// this script would package whatever an earlier build left behind, so it refuses.
const { assertReleaseVersion, RELEASE_PIPELINE_ENV } = require('./release_version.cjs');
if (process.env[RELEASE_PIPELINE_ENV] !== '1') {
  console.error('Build installers with npm run release:win (local builds: scripts/package-local.cjs)');
  process.exit(1);
}
const { build, Platform, Arch } = require('electron-builder');
const { stripSensitiveEnvVars } = require('builder-util');
const { NpmNodeModulesCollector } = require('app-builder-lib/out/node-module-collector/npmNodeModulesCollector.js');

// Windows electron-builder 26.15 wraps npm in an encoded PowerShell command.
// For Windows builds, invoke the same npm CLI directly with Node and literal argv.
// This keeps the dependency collector intact without shell or antivirus changes.
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const local = process.argv.includes('--local');
assertReleaseVersion(version, local);
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
    throw new Error(`Incomplete production dependencies: ${tree.problems.join("; ")}. Run npm ci --ignore-scripts to rebuild node_modules from package-lock.json (unlink node_modules first if it is a junction or link)`);
  }
  fs.writeFileSync(output, stdout);
};

build({ projectDir: root, targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), publish: 'never',
  config: { directories: { output: path.resolve(process.argv.slice(2).find(arg => arg !== '--local') || path.join(root, local ? 'release-local' : 'release')) } },
// The temp-file exit hook calls process.exit(0) on beforeExit and drops any pending exit code, so exit explicitly.
}).catch(error => { console.error(error); process.exit(1); });
