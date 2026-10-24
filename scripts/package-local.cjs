// 試し用の版（-local.）のインストーラー。配る版と同じく、版・MOD の作り直し忘れを確かめ、ビルドと準備を通してから作る（scripts/release-windows.cjs）。
// 使い方：npm exec -- node scripts/package-local.cjs <出力先>（docs/ローカル更新.md）。
require('./release-windows.cjs').main([...process.argv.slice(2), '--local']).catch(error => { console.error(error?.message || error); process.exitCode = 1; });
