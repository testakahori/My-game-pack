'use strict';
// 開発版（npm run electron:dev）が使う生成物を、まとめて作り直す。
// どれも git 管理外か、ビルドしたときにしかできないので、ソースを更新しても古いまま残る
// （2026-10-10 の実機確認では、DisplayMOD 1.0.0 の jar と 8月のギフト取得ツールが残っていた）。
// 使い方：npm run dev:refresh（--dry-run で手順だけを表示する）
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// プロキシ環境では ForgeGradle の証明書確認が失敗するので、取得済みの依存でオフラインにビルドする。
const GRADLE_ARGS = ['build', '--offline', '--no-daemon', '-Dnet.minecraftforge.gradle.check.certs=false'];

function steps({ windows = process.platform === 'win32' } = {}) {
  // DisplayMod と SaikutuMod には gradlew がないので、CI と同じく BridgeMod のものを使う。
  const gradlew = path.join(root, 'BridgeMod', windows ? 'gradlew.bat' : 'gradlew');
  return [
    { title: '画面（dist）', npm: ['run', 'build'], cwd: root },
    { title: 'BRIDGE の同梱物とギフト取得ツール', npm: ['run', 'prepare:bridge-runtime'], cwd: root },
    ...['BridgeMod', 'DisplayMod', 'SaikutuMod'].map(mod => ({ title: `${mod} の jar`, cmd: gradlew, args: GRADLE_ARGS, cwd: path.join(root, mod) })),
    // dev は build/game-packs/saikutu の jar を配置するので、SaikutuMod のビルドのあとに作る。
    { title: '採掘のゲームパック', cmd: process.execPath, args: [path.join(root, 'scripts', 'prepare-game-packs.cjs')], cwd: root },
  ];
}

// cmd.exe /s /c に渡す1行。全体を引用符で囲み、空白を含む部分だけをさらに囲む。
function commandLine(cmd, args) {
  return `"${[cmd, ...args].map(part => /[\s"]/.test(part) ? `"${part}"` : part).join(' ')}"`;
}

function run(step) {
  const options = { cwd: step.cwd, stdio: 'inherit' };
  // npm run から呼ばれたときは、同じ npm を node で直接動かす（.cmd を shell なしで起動できないため）。
  if (step.npm && process.env.npm_execpath) return spawnSync(process.execPath, [process.env.npm_execpath, ...step.npm], options);
  const [cmd, args] = step.npm ? ['npm', step.npm] : [step.cmd, step.args];
  if (process.platform === 'win32' && (step.npm || /\.(bat|cmd)$/i.test(cmd))) {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', commandLine(cmd, args)], { ...options, windowsVerbatimArguments: true });
  }
  return spawnSync(cmd, args, options);
}

function main(argv = process.argv.slice(2)) {
  const list = steps();
  if (argv.includes('--dry-run')) {
    list.forEach((step, i) => console.log(`${i + 1}. ${step.title}: ${step.npm ? `npm ${step.npm.join(' ')}` : `${step.cmd} ${step.args.join(' ')}`}（${path.relative(root, step.cwd) || '.'}）`));
    return 0;
  }
  const started = Date.now();
  for (const [i, step] of list.entries()) {
    console.log(`\n[dev:refresh] ${i + 1}/${list.length} ${step.title}`);
    const begin = Date.now();
    const result = run(step);
    if (result.error || result.status !== 0) {
      console.error(`[dev:refresh] 失敗：${step.title}（${result.error ? result.error.message : `終了コード ${result.status}`}）。ここで止めました。`);
      if (step.cmd?.includes('gradlew')) console.error('[dev:refresh] Gradle の依存が手元にないときは、ネットにつないで一度 --offline なしでビルドしてください。');
      return 1;
    }
    console.log(`[dev:refresh] ${step.title}：完了（${Math.round((Date.now() - begin) / 1000)}秒）`);
  }
  console.log(`\n[dev:refresh] すべて完了（${Math.round((Date.now() - started) / 1000)}秒）。起動は npm run electron:dev。`);
  console.log('[dev:refresh] Claude Code（VS Code）から起動するときは、先に環境変数 ELECTRON_RUN_AS_NODE を外す。');
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { steps, commandLine, run, main };
