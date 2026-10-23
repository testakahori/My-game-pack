"use strict";
// 守るファイル（アプリの設定・読み上げの設定など）を、壊れても消えないように読み書きする
// （2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 5）。
// アプリ（electron）と BRIDGE の両方が使うので bridge/ に置く（処理のコピーの設計書 2026-10-18 の 3）。
// 書くときは、一時ファイルに書いてディスクに確実に残して（fsync）から差し替え、書く前の正しい中身を <名前>.last-good に写す。
// 読むときに壊れていたら、壊れたファイルを <名前>.broken-<時刻> に残し、写しから戻す（写しも無ければ既定値）。画面には出さず、記録だけを残す。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// fs の関数は fs.xxx の形で呼ぶ（テストで差し替えるため。分割代入しない）。
function writeFileDurable(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, "w");
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* 一時ファイルが残るだけ */ }
  }
}

const lastGoodPath = file => `${file}.last-good`;

const pad = value => String(value).padStart(2, "0");
// 壊れたファイルの名前。端末の時刻で、同じ名前があれば -2・-3…と足す（前に残したものを上書きしない）。
function brokenPath(file, date) {
  const base = `${file}.broken-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  let candidate = base;
  for (let n = 2; fs.existsSync(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

// 中身を調べる。無ければ missing、壊れていれば reason（理由の文）、正しければ value。bytes は読めたバイト。
function inspect(file, problem) {
  let bytes;
  try { bytes = fs.readFileSync(file); }
  catch (error) {
    if (error?.code === "ENOENT") return { missing: true };
    return { reason: `ファイルを読めない（${error?.code || error?.message || error}）` };
  }
  let text = bytes.toString("utf8");
  // メモ帳などで保存すると先頭に付く BOM は外して読む。
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let value;
  try { value = JSON.parse(text); }
  catch { return { bytes, reason: "JSON として読めない" }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { bytes, reason: "オブジェクトでない" };
  const reason = problem ? problem(value) : "";
  return reason ? { bytes, reason } : { bytes, value };
}

// 記録の1行の文（時刻は書く側が付ける）。
function describeRecovery(entry) {
  const name = path.basename(entry.file);
  const broken = path.basename(entry.brokenFile);
  return entry.action === "restored"
    ? `${name} が壊れていた（${entry.reason}）ので、前の正しい状態の写しから戻した。壊れたファイル: ${broken}`
    : `${name} が壊れていた（${entry.reason}）。前の正しい状態の写しが無い（または壊れている）ので、既定値で動く。壊れたファイル: ${broken}`;
}

function createSafeJsonFile({ file, defaults, problem, record, now = () => new Date() }) {
  function note(entry) {
    try { record?.(entry); } catch { /* 記録できなくても読み書きは止めない */ }
  }

  // 壊れたファイルを別の名前で残す。名前を変えられなければ中身を写す（元の場所は消せれば消す）。
  // どちらもできなければ投げる。元のファイルには触らない（上書きで失わないことを優先する）。
  function preserve(target, current) {
    const brokenFile = brokenPath(target, now());
    try { fs.renameSync(target, brokenFile); return brokenFile; } catch { /* 下で中身を写す */ }
    if (current.bytes) {
      try { writeFileDurable(brokenFile, current.bytes); } catch { current.copyFailed = true; }
      if (!current.copyFailed) {
        try { fs.unlinkSync(target); } catch { /* 戻すときに上書きする */ }
        return brokenFile;
      }
    }
    throw new Error(`${path.basename(target)} が壊れていて、別の名前で残せません（${current.reason}）`);
  }

  // 今のファイルを調べ、壊れていれば残して写しから戻す（写しも無ければ既定値）。
  function load() {
    const target = file();
    const current = inspect(target, problem);
    if (current.missing) return { state: "missing", value: defaults() };
    if (!current.reason) return { state: "ok", value: current.value, bytes: current.bytes };
    const brokenFile = preserve(target, current);
    const copy = inspect(lastGoodPath(target), problem);
    if (!copy.missing && !copy.reason) {
      writeFileDurable(target, copy.bytes);
      note({ file: target, reason: current.reason, action: "restored", brokenFile });
      return { state: "restored", value: copy.value };
    }
    note({ file: target, reason: current.reason, action: "defaults", brokenFile });
    return { state: "defaults", value: defaults() };
  }

  return {
    read() { return load().value; },
    // 今のファイルが初めから正しかったときだけ、その中身を写しにしてから書く（壊れた中身で写しを上書きしない）。
    write(value) {
      const target = file();
      const current = load();
      if (current.state === "ok") writeFileDurable(lastGoodPath(target), current.bytes);
      writeFileDurable(target, JSON.stringify(value, null, 2));
    },
  };
}

module.exports = { writeFileDurable, lastGoodPath, describeRecovery, createSafeJsonFile };
