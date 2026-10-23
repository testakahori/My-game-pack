"use strict";
// 守るファイル（アプリの設定・読み上げの設定など）を、壊れても消えないように読み書きする
// （2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 5）。
// アプリ（electron）と BRIDGE の両方が使うので bridge/ に置く（処理のコピーの設計書 2026-10-18 の 3）。
// 書くときは、一時ファイルに書いてディスクに確実に残して（fsync）から差し替え、書く前の正しい中身を <名前>.last-good に写す。
// 読むときに壊れていたら、壊れたファイルを <名前>.broken-<時刻> に残し、写しから戻す（写しも無ければ既定値）。画面には出さず、記録だけを残す。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Windows では、ウイルス対策などが一瞬ファイルを開いていると差し替えが失敗することがある。短く数回やり直す（合わせて 160ms ほど。最後のレビューの軽い 1）。
const RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_TRIES = 5;
const RETRY_WAIT_MS = 40;
const waitSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (error) {
      if (attempt >= RENAME_TRIES || !RETRY_CODES.has(error?.code)) throw error;
      waitSync(RETRY_WAIT_MS);
    }
  }
}

// fs の関数は fs.xxx の形で呼ぶ（テストで差し替えるため。分割代入しない）。
function writeFileDurable(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, "w");
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    renameWithRetry(temp, file);
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
  const reason = valueProblem(value, problem);
  return reason ? { bytes, reason } : { bytes, value };
}

// 値そのものの理由（オブジェクトでない・ファイルごとの項目の型）。読むときと書くときの両方で使う。
function valueProblem(value, problem) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "オブジェクトでない";
  return problem ? problem(value) : "";
}

// 記録の1行の文（時刻は書く側が付ける）。名前は label（どのフォルダーかを入れた名前）、無ければファイル名。
// 写しが使えないときに動く中身は defaultsLabel（BRIDGE 側の読み上げの設定は userData 側）、無ければ「既定値」。
// 戻した元は sourceLabel（写しより先に見たほかのファイル）、無ければ「前の正しい状態の写し」。
function describeRecovery(entry) {
  const name = entry.label || path.basename(entry.file);
  const fallback = entry.defaultsLabel || "既定値";
  const source = entry.sourceLabel || "前の正しい状態の写し";
  const restored = entry.action === "restored";
  // 戻す元が無く、壊れたファイルを元の場所に置いたまま（ギフト設定）。外した（切り替えの途中の記録）。設定ファイルの PR3。
  if (entry.action === "kept") {
    return entry.brokenFile
      ? `${name} が壊れていた（${entry.reason}）。前の正しい状態の写しが無い（または使えない）ので、そのまま置いた。壊れたファイルの写し: ${path.basename(entry.brokenFile)}`
      : `${name} が壊れていた（${entry.reason}）。別の名前で残せなかったので、ファイルには触らず、そのまま置いた`;
  }
  if (entry.action === "set-aside") return `${name} が壊れていた（${entry.reason}）ので、別の名前で残して外した。壊れたファイル: ${path.basename(entry.brokenFile)}`;
  if (!entry.brokenFile) {
    return `${name} が壊れていた（${entry.reason}）。別の名前で残せなかったので、ファイルには触らず、${restored ? `${source}の中身` : fallback}で動く`;
  }
  const broken = path.basename(entry.brokenFile);
  return restored
    ? `${name} が壊れていた（${entry.reason}）ので、${source}から戻した。壊れたファイル: ${broken}`
    : `${name} が壊れていた（${entry.reason}）。前の正しい状態の写しが無い（または壊れている）ので、${fallback}で動く。壊れたファイル: ${broken}`;
}

// 読むだけ（戻さない・書かない・記録しない）。正しければ値、無い・壊れていれば null。
// BRIDGE が userData 側の読み上げの設定を使うときのため（userData は main のもの。設定ファイルの PR2）。
function peekJsonFile(file, problem) {
  const current = inspect(file, problem);
  return current.missing || current.reason ? null : current.value;
}

// 同じ中身の壊れたファイル（<名前>.broken-…）がもう残してあれば、その場所（無ければ ""）。何度も同じものを残さないため。
function existingBrokenCopy(file, bytes) {
  const dir = path.dirname(file), prefix = `${path.basename(file)}.broken-`;
  let names = [];
  try { names = fs.readdirSync(dir).filter(name => name.startsWith(prefix)); } catch { return ""; }
  for (const name of names) {
    const candidate = path.join(dir, name);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && stat.size === bytes.length && fs.readFileSync(candidate).equals(bytes)) return candidate;
    } catch { /* 読めないものは比べない */ }
  }
  return "";
}

// 今の中身が壊れていれば、同じ中身をまだ残していないときだけ写して残し、その場所を返す（もう残してあればその場所）。
// 壊れていない・無い・写せないときは ""。元のファイルには触らない（設定ファイルの PR3）。
function preserveBrokenCopy(file, { problem, now = () => new Date() } = {}) {
  const current = inspect(file, problem);
  if (current.missing || !current.reason || !current.bytes) return "";
  const existing = existingBrokenCopy(file, current.bytes);
  if (existing) return existing;
  const brokenFile = brokenPath(file, now());
  try { writeFileDurable(brokenFile, current.bytes); return brokenFile; } catch { return ""; }
}

// 書く前に、今の中身が正しければ写しに、壊れていれば壊れたファイルとして残してから書く。書く所の多いギフト設定のため
// （設定ファイルの PR3）。壊れたファイルを残せないときは書かない（上書きで失わない）。
function writeWithLastGood(file, content, { problem, now } = {}) {
  const current = inspect(file, problem);
  if (!current.missing && !current.reason) writeFileDurable(lastGoodPath(file), current.bytes);
  else if (current.reason && !preserveBrokenCopy(file, { problem, now })) {
    throw new Error(`${path.basename(file)} が壊れていて、別の名前で残せません（${current.reason}）`);
  }
  writeFileDurable(file, content);
}

// 壊れたファイルを別の名前に残し（写せなければ名前を変え）、元の場所から外して、残した場所を返す。
// 残せなければ投げる（元のファイルには触らない）。切り替えの途中の記録のため（設定ファイルの PR3）。
function setAsideBrokenFile(file, { now = () => new Date() } = {}) {
  const current = inspect(file);
  const brokenFile = brokenPath(file, now());
  if (current.bytes) {
    let copied = false;
    try { writeFileDurable(brokenFile, current.bytes); copied = true; } catch { /* 下で名前を変える */ }
    if (copied) {
      // 写したあと消せなければ投げる（中身は写しに残っている）。
      fs.unlinkSync(file);
      return brokenFile;
    }
  }
  fs.renameSync(file, brokenFile);
  return brokenFile;
}

// 2回続けて元の場所に書き戻せなかったら、この間は書き戻しを試さない（読むたびに試すと、BRIDGE がコメントのたびに止まる。PR2 の最後のレビューの軽い 2）。
const RETRY_AFTER_MS = 30000;

// restoreSources は、写しより先に見る、同じ値を書いているほかのファイル（{ file, label } の並び）。写しは「1つ前の保存」なので、
// BRIDGE 側の読み上げの設定は、アプリが同じ値を書いている userData 側の今の中身を先に使う（2026-10-24 ユーザーの決定。PR2 の最後のレビューの重要 1）。
// keepBroken は、戻す元が無いとき、壊れたファイルを元の場所に置いたままにする（消さない・名前を変えない。中身の写しだけ残す）。
// ギフト設定のため：空の雛形で動くと、配信者からは理由も分からずにギフト設定が消えたように見える（設計書 6.4。設定ファイルの PR3）。
// acceptSource は、戻す元の値を使ってよいか（ギフト設定と切り替えの記録の「今のゲーム」が合うか。設計書 6.6）。
// adaptSource は、戻す元の値を直して使う（null なら使わない）。直したときは記録の戻した元の名前を adaptedLabel にする
// （切り替えの記録の写しは、今のゲームだけをギフト設定に合わせて使う。2026-10-24 ユーザーの決定。PR3 の最後のレビューの重要 2）。
function createSafeJsonFile({ file, defaults, problem, record, now = () => new Date(), label, defaultsLabel, restoreSources, keepBroken = false, acceptSource, adaptSource, adaptedLabel }) {
  // このプロセスの間に扱った壊れたファイル（中身の印・残した名前・理由）。同じ壊れたファイルを何度も残したり記録したりせず、
  // 写しを書き戻せなかったときは次に読むときにやり直す（最後のレビューの重要 1。アプリの設定は何度も読まれる）。
  const handled = new Map();

  function note(entry) {
    const labels = { ...(label ? { label } : {}), ...(defaultsLabel ? { defaultsLabel } : {}) };
    try { record?.({ ...entry, ...labels }); } catch { /* 記録できなくても読み書きは止めない */ }
  }

  function markOf(target, current) {
    if (current.bytes) return crypto.createHash("sha256").update(current.bytes).digest("hex");
    try { const stat = fs.statSync(target); return `${stat.size}:${stat.mtimeMs}`; } catch { return ""; }
  }

  // 壊れたファイルを別の名前で残す。同じ中身をもう残してあればそれを使う（reused）。まず中身を写し（元の場所は空けない）、
  // 写せなければ名前を変える（keepBroken のときは変えない）。どちらもできなければ brokenFile は ""（元のファイルには触らない）。
  function preserve(target, current) {
    if (current.bytes) {
      const existing = existingBrokenCopy(target, current.bytes);
      if (existing) return { brokenFile: existing, renamed: false, reused: true };
    }
    const brokenFile = brokenPath(target, now());
    if (current.bytes) {
      try { writeFileDurable(brokenFile, current.bytes); return { brokenFile, renamed: false }; } catch { /* 下で名前を変える */ }
    }
    if (keepBroken) return { brokenFile: "", renamed: false };
    try { fs.renameSync(target, brokenFile); return { brokenFile, renamed: true }; } catch { return { brokenFile: "", renamed: false }; }
  }

  // 戻す元を順に探す：restoreSources の今の中身 → 前の正しい状態の写し。acceptSource が false の値は使わない。
  function findSource(target) {
    for (const source of [...(restoreSources?.() || []), { file: lastGoodPath(target) }]) {
      const found = inspect(source.file, problem);
      if (found.missing || found.reason || (acceptSource && !acceptSource(found.value))) continue;
      if (!adaptSource) return { ...found, label: source.label };
      const adapted = adaptSource(found.value);
      if (!adapted) continue;
      if (adapted === found.value) return { ...found, label: source.label };
      return { value: adapted, bytes: Buffer.from(JSON.stringify(adapted, null, 2)), label: adaptedLabel || source.label };
    }
    return null;
  }

  // 元の場所が、残した壊れたファイルのままか（名前を変えて残したなら、空いたままか）。
  // 戻すあいだに別のプロセス（アプリと BRIDGE）が書き換えていたら、それを上書きも削除もしない（PR2 の最後のレビューの軽い 4）。
  function unchanged(target, entry) {
    const current = inspect(target, problem);
    if (current.missing) return entry.renamed;
    return markOf(target, current) === entry.mark;
  }

  // 壊れたファイルを残せたときだけ、元の場所を戻す元の中身に差し替える（戻す元が無ければ元の場所を空ける）。
  // 失敗しても投げない。壊れたファイルは元の場所か別の名前に残っているので、次に読むときにやり直す。
  // 別のプロセスが書き換えていたら null（読み直す）。
  function settle(target, entry) {
    const source = findSource(target);
    const waiting = entry.failures >= 2 && now().getTime() < entry.retryAt;
    // keepBroken で戻す元が無ければ、元の場所に置いたまま何もしない（同じ壊れたファイルは、このプロセスの間は覚えておく）。
    if (entry.brokenFile && !waiting && (source || !keepBroken)) {
      if (!unchanged(target, entry)) {
        handled.delete(target);
        return null;
      }
      try {
        if (source) writeFileDurable(target, source.bytes);
        else if (fs.existsSync(target)) fs.unlinkSync(target);
        handled.delete(target);
      } catch {
        entry.failures = (entry.failures || 0) + 1;
        if (entry.failures >= 2) entry.retryAt = now().getTime() + RETRY_AFTER_MS;
      }
    }
    const state = !entry.brokenFile ? "unpreserved" : source ? "restored" : keepBroken ? "kept" : "defaults";
    return { state, reason: entry.reason, good: Boolean(source), sourceLabel: source?.label, value: source ? source.value : defaults() };
  }

  const missing = () => ({ state: "missing", value: defaults() });

  // 今のファイルを調べ、壊れていれば残して戻す（戻す元も無ければ既定値）。読むのは投げない
  // （アプリの設定は起動の途中でも読むので、投げるとウィンドウが出ない）。again は、別のプロセスが書き換えていたときに1回だけ読み直すため。
  function load(again = true) {
    const target = file();
    const current = inspect(target, problem);
    const earlier = handled.get(target);
    if (current.missing) {
      // 前に壊れたファイルの名前を変えて残したが、まだ書き戻せていない。
      if (earlier?.brokenFile) return settle(target, earlier) || (again ? load(false) : missing());
      handled.delete(target);
      return missing();
    }
    if (!current.reason) {
      handled.delete(target);
      return { state: "ok", value: current.value, bytes: current.bytes };
    }
    const mark = markOf(target, current);
    let entry = earlier && earlier.mark && earlier.mark === mark ? earlier : null;
    let fresh = false;
    if (!entry) {
      entry = { mark, reason: current.reason, ...preserve(target, current) };
      handled.set(target, entry);
      fresh = true;
    } else if (!entry.brokenFile) {
      // 同じ壊れたファイルで、前は残せなかった。もう一度残してみる（残せたら記録する）。
      Object.assign(entry, preserve(target, current));
      fresh = Boolean(entry.brokenFile);
    }
    const result = settle(target, entry);
    if (!result) return again ? load(false) : missing();
    // 置いたままの壊れたファイルを、前に（アプリを起動し直す前に）残してあれば、もう一度は記録しない。
    if (fresh && !(keepBroken && entry.reused)) {
      note({ file: target, reason: entry.reason, action: result.good ? "restored" : keepBroken ? "kept" : "defaults", brokenFile: entry.brokenFile, ...(result.sourceLabel ? { sourceLabel: result.sourceLabel } : {}) });
    }
    return result;
  }

  return {
    read() { return load().value; },
    // 値の代わりに状態を返す（ギフト設定を戻すだけで、値は使わない所のため）。
    check() { const { state, reason } = load(); return reason ? { state, reason } : { state }; },
    // 今のファイルが初めから正しかったときだけ、その中身を写しにしてから書く（壊れた中身で写しを上書きしない）。
    // 壊れたファイルを別の名前で残せていないときは書かない（上書きで失わない）。
    // 書く値の型が違えば書かない（書くと次に読むときにファイル全体が壊れている扱いになり、1つ前の写しに戻る。最後のレビューの軽い 2）。
    // エラーの文の名前は label（どちらのフォルダーか分かる。PR2 の最後のレビューの軽い 6）。
    // keepLastGood は写しを変えない（切り替えに失敗して元に戻すとき、写しを切り替えの途中の中身にしない。PR3 の最後のレビューの軽い 4）。
    write(value, { keepLastGood = false } = {}) {
      const target = file();
      const name = label || path.basename(target);
      const invalid = valueProblem(value, problem);
      if (invalid) throw new Error(`${name} に書く値が正しくありません（${invalid}）`);
      const current = load();
      if (current.state === "unpreserved") throw new Error(`${name} が壊れていて、別の名前で残せません（${current.reason}）`);
      if (current.state === "ok" && !keepLastGood) writeFileDurable(lastGoodPath(target), current.bytes);
      writeFileDurable(target, JSON.stringify(value, null, 2));
      handled.delete(target);
    },
  };
}

module.exports = { writeFileDurable, lastGoodPath, describeRecovery, createSafeJsonFile, peekJsonFile, inspectJsonFile: inspect, preserveBrokenCopy, writeWithLastGood, setAsideBrokenFile };
