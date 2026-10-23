// src/components/CommandSetManager.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useUnsavedChanges } from "../UnsavedChanges";
import { ipcErrorMessage } from "../lib/ipcError";
import { saveCommandDraft, type DraftCheck } from "../lib/commandDraft";

const CATEGORIES = ["お助け系", "妨害系", "その他"] as const;

// 名前・コマンドの行・見出しの確かめと、同じ名前のファイルがあるかは main（bridge/command_rows.cjs の checkCommandDraft）が持つ。
// 画面は結果を出すだけで、名前を書き換えず、自分で数えない。保存の決め方は src/lib/commandDraft.ts（処理のコピー PR8）。

const CommandSetManager: React.FC = () => {
  const [title, setTitle]           = useState("ハスク！");
  const [subtitle, setSubtitle]     = useState("ハスク追加");
  const [category, setCategory]     = useState<string>("その他");
  const [commandsText, setCommandsText] = useState(
    `execute as @p at @p run summon minecraft:husk ^ ^ ^ {NoAI:0b,NoGravity:0b,CustomNameVisible:1b,CustomName:"\\"{ListenerName}\\""}\neffect give @e[type=minecraft:husk,sort=nearest,limit=1] minecraft:slow_falling 3 1 true`
  );
  // 標準の husk.txt と重ならない名前にする（前は既定のまま保存すると標準のコマンドを黙って上書きした）。
  const [filename, setFilename]     = useState("my_husk.txt");
  const [cooldown, setCooldown]     = useState("");
  const [weight, setWeight]         = useState("");
  const [random, setRandom]         = useState("");
  const [sound, setSound]           = useState("");
  const [particle, setParticle]     = useState("");
  const [destructive, setDestructive] = useState(false);
  const [saveMsg, setSaveMsg]       = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving]         = useState(false);
  const currentSnapshot = JSON.stringify({ title, subtitle, category, commandsText, filename, cooldown, weight, random, sound, particle, destructive });
  const [savedSnapshot, setSavedSnapshot] = useState(currentSnapshot);
  useUnsavedChanges(currentSnapshot !== savedSnapshot, saving);

  // 書くときの本文（空でない行を前後の空白を除いて並べる）。コマンドの行かどうかは数えない（main の確かめが数える）。
  const bodyLines = useMemo(() => commandsText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), [commandsText]);

  const buildContent = () => {
    const parts: string[] = [];
    parts.push(`# TITLE: ${title.trim()}`);
    if (subtitle.trim()) parts.push(`# SUBTITLE: ${subtitle.trim()}`);
    if (category) parts.push(`# CATEGORY: ${category}`);
    if (cooldown) parts.push(`# COOLDOWN: ${cooldown}`);
    if (weight) parts.push(`# WEIGHT: ${weight}`);
    if (random.trim()) parts.push(`# RANDOM: ${random.trim()}`);
    if (sound.trim()) parts.push(`# SOUND: ${sound.trim()}`);
    if (particle.trim()) parts.push(`# PARTICLE: ${particle.trim()}`);
    if (destructive) parts.push("# DESTRUCTIVE: true");
    parts.push("");
    parts.push(...bodyLines);
    return parts.join("\n");
  };
  const content = buildContent();

  // 中身と名前が変わるたびに main で確かめる。古い返事は捨てる。確かめを待つ間は保存できない。
  // 待つ間も前の結果を出したままにする（前は入力のたびに消し、問題の枠・保存先・保存ボタンがちらついた。PR8 の最後のレビュー）。
  const [check, setCheck] = useState<DraftCheck | null>(null);
  const [checkError, setCheckError] = useState("");
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = (window as any).mygamepack;
    let current = true;
    if (!api?.bridgeCommandsCheck) {
      setCheckError("この画面では TXT を確かめられません。アプリの中で開いてください");
      setChecking(false);
      return;
    }
    setChecking(true);
    Promise.resolve(api.bridgeCommandsCheck({ filename, content }))
      .then((result: DraftCheck) => { if (current) { setCheck(result); setCheckError(""); } })
      .catch((error: unknown) => { if (current) setCheckError(ipcErrorMessage(error)); })
      .finally(() => { if (current) setChecking(false); });
    return () => { current = false; };
  }, [filename, content]);

  // 画面独自の確かめ（BRIDGE の決まりではない注意）。番号は main が数えたコマンドの何個目か。
  const healthProblems = useMemo(() => {
    const problems: string[] = [...(check?.problems ?? [])];
    (check?.commands ?? []).forEach((line, i) => {
      if (line.startsWith("{")) problems.push(`${i + 1}個目のコマンド: コマンド名がありません`);
      if (/\{PlayerMe\}/i.test(line)) problems.push(`${i + 1}個目のコマンド: 未対応の {PlayerMe} があります`);
      if (/summon\s+\S+\s+\^-?\d|\^-?\d+(\.\d+)?\s+\^/.test(line)) problems.push(`${i + 1}個目のコマンド: 視線依存の^座標は埋没の原因になります`);
    });
    if (checkError) problems.push(`確かめられませんでした: ${checkError}`);
    return problems;
  }, [check, checkError]);

  const canSave = title.trim().length > 0 && Boolean(check) && !checking && healthProblems.length === 0;

  const handleSave = async () => {
    if (!canSave || !check) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = (window as any).mygamepack;
    setSaving(true);
    setSaveMsg(null);
    try {
      const result = await saveCommandDraft({
        check, content,
        confirm: (message: string) => window.confirm(message),
        write: api?.bridgeCommandsWrite ? (request) => api.bridgeCommandsWrite(request) : undefined,
      });
      if (result.type === "canceled") return;
      if (result.type === "ok") {
        setSavedSnapshot(currentSnapshot);
        setCheck(result.check);
      }
      setSaveMsg({ type: result.type, text: result.text });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-gray-800 border border-gray-700 rounded-3xl p-6 shadow-xl">
        <h2 className="text-xl font-black text-cyan-200 mb-1">コマンド設定（TXT 作成）</h2>
        <p className="text-sm text-gray-400 mb-6">
          コマンドを入力してTXTファイルを作ります。保存すると{" "}
          <code className="text-cyan-300">bridge/commands/minecraft</code> に保存されます。
        </p>

        {/* TITLE / SUBTITLE / CATEGORY */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-bold text-gray-400"># TITLE</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder="例: ハスク！"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-400"># SUBTITLE</label>
            <input
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder="例: ハスク追加"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-400"># CATEGORY</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs text-gray-400"># COOLDOWN (ms)<input value={cooldown} onChange={e=>setCooldown(e.target.value)} className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2"/></label>
          <label className="text-xs text-gray-400"># WEIGHT<input value={weight} onChange={e=>setWeight(e.target.value)} className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2"/></label>
          <label className="text-xs text-gray-400"># RANDOM<input value={random} onChange={e=>setRandom(e.target.value)} placeholder="heal.txt*50,tnt.txt*50" className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2"/></label>
          <label className="text-xs text-gray-400"># SOUND<input value={sound} onChange={e=>setSound(e.target.value)} placeholder="entity.experience_orb.pickup" className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2"/></label>
          <label className="text-xs text-gray-400"># PARTICLE<input value={particle} onChange={e=>setParticle(e.target.value)} placeholder="minecraft:happy_villager" className="w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2"/></label>
          <label className="flex items-center gap-2 text-xs text-amber-300"><input type="checkbox" checked={destructive} onChange={e=>setDestructive(e.target.checked)}/>地形破壊系</label>
        </div>

        {/* コマンド入力 */}
        <div className="mt-5">
          <label className="text-xs font-bold text-gray-400">コマンド（1行=1コマンド）</label>
          <textarea
            value={commandsText}
            onChange={(e) => setCommandsText(e.target.value)}
            rows={8}
            className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm font-mono outline-none focus:ring-2 focus:ring-cyan-500"
            placeholder={"例:\nexecute as @p at @p run summon minecraft:husk ^ ^ ^\n# {ListenerName} で訪問者名に置換されます"}
          />
          <div className="mt-1 text-[11px] text-gray-500">
            コマンド行：<span className="text-cyan-300 font-bold">{check ? check.commands.length : "…"}</span> 行（# と // で始まる行は数えません）
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="rounded-lg bg-gray-700 px-3 py-1 text-xs" onClick={()=>setCommandsText('execute at @p if block ~ ~3 ~ air run summon minecraft:zombie ~ ~3 ~\nexecute at @p unless block ~ ~3 ~ air run summon minecraft:zombie ~2 ~ ~')}>安全スポーン雛形</button>
            <button type="button" className="rounded-lg bg-gray-700 px-3 py-1 text-xs" onClick={()=>setCommandsText('playsound entity.experience_orb.pickup master @a ~ ~ ~ 1 1\nexecute at @a run particle minecraft:happy_villager ~ ~1 ~ 0.5 0.8 0.5 0.05 20 force')}>演出雛形</button>
          </div>
          {healthProblems.length > 0 && <div className="mt-2 rounded-lg border border-red-700/40 bg-red-900/20 p-2 text-xs text-red-300">{healthProblems.map(p=><div key={p}>• {p}</div>)}</div>}
        </div>

        {/* ファイル名 + 保存ボタン */}
        <div className="mt-5 flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-bold text-gray-400">ファイル名（.txt）</label>
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder="例: husk_1.txt"
            />
            {check?.filename && (
              <p className="text-[11px] text-gray-500 mt-1">
                保存先：<code className="text-cyan-300">bridge/commands/minecraft/{check.filename}</code>
                {check.exists && <span className="ml-2 text-amber-300">同じ名前のファイルがあります。保存すると上書きします。</span>}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className={`px-6 py-3 rounded-xl font-bold transition-all active:scale-95 shrink-0 ${
              canSave && !saving
                ? "bg-cyan-600 hover:bg-cyan-500 text-white"
                : "bg-gray-700 text-gray-500 cursor-not-allowed"
            }`}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>

        {saveMsg && (
          <div
            className={`mt-4 px-4 py-3 rounded-xl text-sm ${
              saveMsg.type === "ok"
                ? "bg-emerald-900/30 border border-emerald-700/40 text-emerald-300"
                : "bg-red-900/30 border border-red-700/40 text-red-300"
            }`}
          >
            {saveMsg.type === "ok" ? "✅ " : "❌ "}{saveMsg.text}
          </div>
        )}
      </div>
    </div>
  );
};

export default CommandSetManager;
