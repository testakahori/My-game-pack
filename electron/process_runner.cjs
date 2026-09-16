const { spawn } = require("child_process");

// 起動失敗と応答のない子プロセスも必ず呼び出し元へ返す。
function runProc(cmd, args, cwd, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`処理が${Math.round(timeoutMs / 1000)}秒以内に完了しませんでした。通信状態を確認して、もう一度お試しください。`));
    }, timeoutMs);
    child.stdout.on("data", (data) => { out = (out + data).slice(-65536); });
    child.stderr.on("data", (data) => { err = (err + data).slice(-65536); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`取得ツールを起動できませんでした (${error.code || error.message})。アプリの実行環境を確認してください。`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out });
      else {
        const failure = err.split(/\r?\n/).find(line => line.startsWith("FAILED:"));
        reject(new Error(failure ? failure.replace(/^FAILED:\s*/, "") : err || out || `処理に失敗しました (終了コード: ${code})`));
      }
    });
  });
}

module.exports = { runProc };
