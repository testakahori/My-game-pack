// src/components/CommandSetManager.tsx
import React, { useMemo, useState } from "react";

const CATEGORIES = ["お助け系", "妨害系", "その他"] as const;

function normalizeFileName(name: string) {
  const base = (name || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w.\-]/g, "");
  if (!base) return "";
  return base.toLowerCase().endsWith(".txt") ? base : `${base}.txt`;
}

function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const CommandSetManager: React.FC = () => {
  const [title, setTitle]           = useState("ハスク！");
  const [subtitle, setSubtitle]     = useState("ハスク追加");
  const [category, setCategory]     = useState<string>("その他");
  const [commandsText, setCommandsText] = useState(
    `execute as @p at @p run summon minecraft:husk ^ ^ ^ {NoAI:0b,NoGravity:0b,CustomNameVisible:1b,CustomName:"\\"{ListenerName}\\""}\neffect give @e[type=minecraft:husk,sort=nearest,limit=1] minecraft:slow_falling 3 1 true`
  );
  const [filename, setFilename]     = useState("husk.txt");
  const [saveMsg, setSaveMsg]       = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving]         = useState(false);

  const normalizedFilename = useMemo(() => normalizeFileName(filename), [filename]);

  const commandLines = useMemo(() => {
    return commandsText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }, [commandsText]);

  const canSave =
    title.trim().length > 0 &&
    normalizedFilename.length > 0 &&
    commandLines.length > 0;

  const buildContent = () => {
    const parts: string[] = [];
    parts.push(`# TITLE: ${title.trim()}`);
    if (subtitle.trim()) parts.push(`# SUBTITLE: ${subtitle.trim()}`);
    if (category) parts.push(`# CATEGORY: ${category}`);
    parts.push("");
    parts.push(...commandLines);
    return parts.join("\n");
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveMsg(null);
    const content = buildContent();
    const fn = normalizedFilename;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = (window as any).mygamepack;

    try {
      if (api?.bridgeCommandsWrite) {
        await api.bridgeCommandsWrite({ filename: fn, content });
        setSaveMsg({ type: "ok", text: `保存しました: bridge/commands/minecraft/${fn}` });
      } else {
        downloadText(fn, content);
        setSaveMsg({ type: "ok", text: `ダウンロードしました: ${fn}（bridge/commands/minecraft に配置してください）` });
      }
    } catch (e: any) {
      // 書き込み失敗時: フォルダを開いてDL
      try {
        if (api?.bridgeCommandsOpenFolder) await api.bridgeCommandsOpenFolder();
      } catch {}
      downloadText(fn, content);
      setSaveMsg({
        type: "error",
        text: `フォルダへの直接保存に失敗しました。フォルダを開きファイルを移動してください（ダウンロード済: ${fn}）`,
      });
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
            コマンド行：<span className="text-cyan-300 font-bold">{commandLines.length}</span> 行
          </div>
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
            {normalizedFilename && (
              <p className="text-[11px] text-gray-500 mt-1">
                保存先：<code className="text-cyan-300">bridge/commands/minecraft/{normalizedFilename}</code>
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
