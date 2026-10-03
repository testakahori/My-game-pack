const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../../package.json');

test('配布パッケージにはGitHub更新フィードと自動更新ランタイムを設定しない', () => {
  assert.equal(pkg.build.publish, null);
  assert.equal(pkg.dependencies['electron-updater'], undefined);
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true);
});
