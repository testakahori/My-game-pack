// src/components/MappingEditor.tsx
import React, { useEffect, useMemo, useState } from "react";
import type { CommandSet, GiftMapping } from "../types";

type Props = {
  mappings?: GiftMapping[];
  commandSets?: CommandSet[];

  onAdd?: (m: Omit<GiftMapping, "id">) => void;
  onRemove?: (id: string) => void;
  onUpdate?: (id: string, updated: Partial<GiftMapping>) => void;

  commandsDirKey?: string;
  defaultGiftId?: string;
  defaultGiftName?: string;
  defaultGiftImage?: string | null;
  defaultGiftDiamonds?: number;
  defaultCommandsDirHint?: string;
};

type CmdFile = { name: string; title: string };
type SaveMsg = { type: "ok" | "error"; text: string };

function clampRepeat(v: number) {
  if (!Number.isFinite(v)) return 1;
  return Math.min(100, Math.max(1, Math.floor(v)));
}

const MappingEditor: React.FC<Props> = (props) => {
  const mappings        = Array.isArray(props.mappings) ? props.mappings : [];
  const commandsDirHint = (props.defaultCommandsDirHint || "bridge/commands").trim() || "bridge/commands";

  const [giftId, setGiftId]               = useState(props.defaultGiftId ?? "");
  const [giftName, setGiftName]           = useState(props.defaultGiftName ?? "");
  const [repeat, setRepeat]               = useState<number>(1);
  const [commandFile, setCommandFile]     = useState<string>("");
  const [selectedTxtName, setSelectedTxtName] = useState<string>("");
  const [cmdFiles, setCmdFiles]           = useState<CmdFile[]>([]);
  const [listQuery, setListQuery]         = useState<string>("");
  const [giftImageMap, setGiftImageMap]   = useState<Record<string, string>>({});
  const [saveMsg, setSaveMsg]             = useState<SaveMsg | null>(null);

  const titleMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of cmdFiles) m[f.name] = f.title;
    return m;
  }, [cmdFiles]);

  const already = useMemo(
    () => mappings.find((m) => String(m.giftId) === String(giftId)),
    [mappings, giftId]
  );

  const canSave = useMemo(() => (
    giftId.trim().length > 0 &&
    commandFile.trim().length > 0 &&
    Number.isFinite(repeat) &&
    repeat >= 1 &&
    repeat <= 100
  ), [giftId, commandFile, repeat]);

  const filteredMappings = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return mappings;
    return mappings.filter((m) => {
      const hay = `${m.giftId ?? ""} ${m.name ?? ""} ${m.commandFile ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [mappings, listQuery]);

  const loadCmdFiles = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = (window as any).mygamepack;
    if (!api?.bridgeCommandsList) return;
    api.bridgeCommandsList()
      .then((list: CmdFile[]) => setCmdFiles(list))
      .catch(() => {});
  };

  useEffect(() => { loadCmdFiles(); }, []);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = (window as any).mygamepack;
    if (!api?.giftsRead) return;
    api.giftsRead()
      .then((res: any) => {
        const map: Record<string, string> = {};
        for (const g of res.gifts || []) {
          if (g.image) map[String(g.id)] = g.image;
        }
        setGiftImageMap(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof props.defaultGiftId === "string")   setGiftId(props.defaultGiftId);
    if (typeof props.defaultGiftName === "string") setGiftName(props.defaultGiftName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.defaultGiftId, props.defaultGiftName]);

  useEffect(() => {
    if (!already) return;
    setCommandFile(already.commandFile || "");
    setRepeat(clampRepeat(Number(already.repeat ?? 1)));
    setSelectedTxtName(already.commandFile || "");
  }, [already?.id]);

  const handleSelectTxt = (name: string) => {
    setSelectedTxtName(name);
    setCommandFile(name);
  };

  const handleSaveUpsert = () => {
    if (!canSave) return;
    setSaveMsg(null);
    const payload: Partial<GiftMapping> = {
      giftId: giftId.trim(),
      name: giftName.trim() || giftId.trim(),
      commandFile: commandFile.trim(),
      repeat: clampRepeat(Number(repeat || 1)),
      commandSetLabel: commandFile.trim(),
    };
    if (already) {
      if (!props.onUpdate) return;
      props.onUpdate(already.id, payload);
      setSaveMsg({ type: "ok", text: "ギフト設定を上書きしました" });
    } else {
      if (!props.onAdd) return;
      props.onAdd(payload as Omit<GiftMapping, "id">);
      setSaveMsg({ type: "ok", text: "ギフト設定を追加しました" });
    }
    setTimeout(() => setSaveMsg(null), 3000);
  };

  // 現在選択中ギフトの情報
  const hasGift      = giftId.trim().length > 0;
  const giftImage    = props.defaultGiftImage ?? giftImageMap[giftId];
  const giftDiamonds = props.defaultGiftDiamonds;
  const isConfigured = !!(already?.commandFile);

  return (
    <div className="space-y-5">

      {/* ══ 編集パネル ══ */}
      <div className={`border rounded-3xl shadow-xl overflow-hidden transition-all ${
        hasGift
          ? "bg-gray-800 border-cyan-700/50 ring-1 ring-cyan-700/20"
          : "bg-gray-800 border-gray-700"
      }`}>

        {/* ── 現在編集中のギフト ── */}
        <div className={`px-6 py-4 border-b transition-all ${
          hasGift
            ? "bg-cyan-950/30 border-cyan-800/40"
            : "bg-gray-900/40 border-gray-700"
        }`}>
          {hasGift ? (
            <div className="flex items-center gap-4">
              {/* ギフト画像 */}
              <div className="w-16 h-16 rounded-2xl bg-gray-700 flex items-center justify-center overflow-hidden shrink-0 ring-2 ring-cyan-500/40">
                {giftImage
                  ? <img src={giftImage} alt={giftName} className="w-full h-full object-contain" />
                  : <span className="text-gray-500 text-xs">No img</span>
                }
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-black text-white truncate">{giftName || giftId}</span>
                  {giftDiamonds !== undefined && (
                    <span className="text-xs text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded-full border border-cyan-800/40">
                      💎 {giftDiamonds}
                    </span>
                  )}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    isConfigured
                      ? "text-emerald-400 bg-emerald-950/60 border-emerald-800/40"
                      : already
                      ? "text-amber-400 bg-amber-950/60 border-amber-800/40"
                      : "text-gray-400 bg-gray-800 border-gray-700"
                  }`}>
                    {isConfigured ? "✓ 設定済み（編集中）" : already ? "登録済み・未設定" : "新規登録"}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">ID: {giftId}</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-gray-500">
              <div className="w-16 h-16 rounded-2xl bg-gray-700/40 border-2 border-dashed border-gray-600 flex items-center justify-center shrink-0">
                <span className="text-2xl opacity-40">🎁</span>
              </div>
              <div>
                <div className="font-bold text-gray-400">ギフトが選択されていません</div>
                <div className="text-xs text-gray-600 mt-0.5">上のギフト一覧からギフトをクリックして選択してください</div>
              </div>
            </div>
          )}
        </div>

        {/* ── 設定フォーム ── */}
        <div className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-gray-300 uppercase tracking-wider">❷ 実行内容と回数を設定</h2>
            <button
              type="button"
              onClick={loadCmdFiles}
              className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition"
            >
              🔄 再読込
            </button>
          </div>

          {already && (
            <div className="px-3 py-2 bg-amber-950/30 border border-amber-700/40 rounded-xl text-xs text-amber-300">
              ⚠ 設定済みのギフトです。保存すると<b>上書き</b>されます。
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 実行内容選択 */}
            <div>
              <label className="text-xs font-bold text-gray-400 mb-2 block">実行する内容</label>
              <select
                value={selectedTxtName}
                onChange={(e) => handleSelectTxt(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-sm text-gray-100 outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                <option value="">
                  {cmdFiles.length === 0
                    ? "（コマンド設定でTXTを作成してください）"
                    : "選択してください"}
                </option>
                {cmdFiles.map((x) => (
                  <option key={x.name} value={x.name}>{x.title || x.name}</option>
                ))}
              </select>
              {cmdFiles.length > 0 && (
                <div className="text-[10px] text-gray-500 mt-1">
                  {cmdFiles.length} 件 / 参照: <code className="text-cyan-400">{commandsDirHint}/{commandFile || "—"}</code>
                </div>
              )}
            </div>

            {/* 回数 */}
            <div>
              <label className="text-xs font-bold text-gray-400 mb-2 block">回数（1〜100）</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={repeat}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    setRepeat(clampRepeat(n));
                  }}
                  className="w-28 bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-sm text-gray-100 outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
                <span className="text-sm text-gray-400">回繰り返す</span>
              </div>
            </div>
          </div>

          {/* 保存ボタン + フィードバック */}
          <div className="flex items-center gap-4 flex-wrap">
            <button
              disabled={!canSave}
              onClick={handleSaveUpsert}
              className={`px-8 py-3 rounded-xl font-black text-sm transition-all active:scale-95 ${
                canSave
                  ? "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-900/30"
                  : "bg-gray-700 text-gray-500 cursor-not-allowed"
              }`}
            >
              {already ? "💾 保存（上書き）" : "💾 保存（追加）"}
            </button>

            {!canSave && hasGift && (
              <p className="text-xs text-gray-500">実行内容を選択してください</p>
            )}
            {!canSave && !hasGift && (
              <p className="text-xs text-gray-500">ギフトを選択してください</p>
            )}
          </div>

          {saveMsg && (
            <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
              saveMsg.type === "ok"
                ? "bg-emerald-900/40 border border-emerald-700/40 text-emerald-300"
                : "bg-red-900/40 border border-red-700/40 text-red-300"
            }`}>
              {saveMsg.type === "ok" ? "✅ " : "❌ "}{saveMsg.text}
            </div>
          )}
        </div>
      </div>

      {/* ══ 登録済みギフト一覧 ══ */}
      <div className="bg-gray-800 border border-gray-700 rounded-3xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-black text-gray-200">
              ❸ 登録済みギフト
              <span className="text-cyan-300 ml-1">{filteredMappings.length}</span>
              <span className="text-gray-500 font-normal text-sm"> / 全 {mappings.length} 件</span>
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">設定を登録したギフトの一覧です</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-[10px]" />
              <input
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder="検索"
                className="pl-7 pr-3 py-2 w-[180px] bg-gray-900 border border-gray-700 rounded-xl text-xs text-gray-100 outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
            </div>
            {listQuery.trim() && (
              <button
                type="button"
                onClick={() => setListQuery("")}
                className="text-xs text-gray-400 hover:text-gray-200 px-2 py-2 rounded-lg border border-gray-700"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {filteredMappings.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-gray-700 rounded-2xl text-gray-500 text-sm">
            {mappings.length === 0
              ? "まだ登録されていません。上のフォームからギフトを設定してください。"
              : "検索に一致するギフトがありません。"}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredMappings.map((m) => {
              const missing       = !(m.commandFile || "").trim();
              const giftImage     = giftImageMap[String(m.giftId)];
              const resolvedTitle = m.commandFile ? (titleMap[m.commandFile] || m.commandFile) : null;
              const isCurrentlyEditing = String(m.giftId) === String(giftId);

              return (
                <div
                  key={m.id}
                  className={`flex items-center gap-4 rounded-2xl p-4 border transition-all ${
                    isCurrentlyEditing
                      ? "bg-cyan-950/30 border-cyan-700/50 ring-1 ring-cyan-700/20"
                      : missing
                      ? "bg-red-950/15 border-red-800/40"
                      : "bg-gray-900/50 border-gray-700 hover:border-gray-600"
                  }`}
                >
                  {/* ギフト画像 */}
                  <div className="w-12 h-12 rounded-xl bg-gray-700 flex items-center justify-center overflow-hidden shrink-0">
                    {giftImage
                      ? <img src={giftImage} alt={m.name} className="w-full h-full object-contain" />
                      : <span className="text-gray-600 text-[8px]">{m.name.slice(0, 3)}</span>
                    }
                  </div>

                  {/* 情報 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-black text-gray-200 truncate max-w-[140px]">{m.name}</span>
                      {isCurrentlyEditing && (
                        <span className="text-[9px] font-bold text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-700/40">編集中</span>
                      )}
                    </div>

                    {missing ? (
                      <div className="text-xs font-bold text-red-400 mt-0.5">⚠ 実行内容が未設定</div>
                    ) : (
                      <div className="text-xs text-emerald-300 font-bold mt-0.5 truncate">
                        {resolvedTitle}
                      </div>
                    )}

                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-gray-500">
                        {m.repeat ?? 1}回繰り返し
                      </span>
                      {m.commandFile && (
                        <span className="text-[9px] text-gray-600 truncate">📄 {m.commandFile}</span>
                      )}
                    </div>
                  </div>

                  {/* 削除ボタン */}
                  {props.onRemove && (
                    <button
                      onClick={() => props.onRemove!(m.id)}
                      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-500 hover:text-white hover:bg-red-700 transition font-bold text-sm leading-none"
                      title="削除"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MappingEditor;
