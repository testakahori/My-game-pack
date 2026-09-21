// src/components/MappingEditor.tsx
import React, { useEffect, useMemo, useState } from "react";
import type { CommandSet, GiftMapping } from "../types";
import MinecraftCommandIcon from "./MinecraftCommandIcon";
import { useUnsavedChanges } from "../UnsavedChanges";

type Props = {
  mappings?: GiftMapping[];
  commandSets?: CommandSet[];

  onAdd?: (m: Omit<GiftMapping, "id">) => void | Promise<void>;
  onRemove?: (id: string) => void;
  onUpdate?: (id: string, updated: Partial<GiftMapping>) => void | Promise<void>;
  onPickGift?: (id: string, name: string, image?: string | null, diamonds?: number) => void;

  commandsDirKey?: string;
  defaultGiftId?: string;
  defaultGiftName?: string;
  defaultGiftImage?: string | null;
  defaultGiftDiamonds?: number;
  defaultCommandsDirHint?: string;
};

type CmdFile = { name: string; title: string; category?: string; description?: string };
const commandCategory = (raw = "") => { const key = raw.split("|")[0].trim(); return key === "お助け" ? "お助け系" : key === "妨害" ? "妨害系" : key || "その他"; };
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
  const [commandCategoryFilter, setCommandCategoryFilter] = useState("");
  const [commandQuery, setCommandQuery] = useState("");
  const commandGroups = useMemo(() => {
    const groups = new Map<string, CmdFile[]>();
    for (const file of cmdFiles) { const category = commandCategory(file.category); groups.set(category, [...(groups.get(category) || []), file]); }
    return [...groups].sort(([a], [b]) => a.localeCompare(b, "ja"));
  }, [cmdFiles]);
  const visibleCommandGroups = useMemo(() => commandGroups.map(([category, files]) => ({ category, files: files.filter(file => (!commandCategoryFilter || category === commandCategoryFilter) && `${file.title} ${file.name} ${file.description || ""}`.toLowerCase().includes(commandQuery.trim().toLowerCase())) })).filter(group => group.files.length), [commandGroups, commandCategoryFilter, commandQuery]);
  const selectedCommandVisible = visibleCommandGroups.some(group => group.files.some(file => file.name === selectedTxtName));
  const [listQuery, setListQuery]         = useState<string>("");
  const [giftImageMap, setGiftImageMap]   = useState<Record<string, string>>({});
  const [giftDiamondMap, setGiftDiamondMap] = useState<Record<string, number>>({});
  const [saveMsg, setSaveMsg]             = useState<SaveMsg | null>(null);
  const [saving, setSaving] = useState(false);
  const [cmdMsg, setCmdMsg]               = useState<SaveMsg | null>(null);
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const currentSnapshot = JSON.stringify({ commandFile, repeat });
  const [savedSnapshot, setSavedSnapshot] = useState(currentSnapshot);
  useUnsavedChanges(currentSnapshot !== savedSnapshot, saving);

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
    if (!api?.bridgeCommandsReadMeta) {
      setCmdMsg({ type: "error", text: "コマンド一覧APIが見つかりません。" });
      return;
    }
    setCmdMsg(null);
    api.bridgeCommandsReadMeta()
      .then((list: CmdFile[]) => {
        setCmdFiles(list);
        setCmdMsg({ type: "ok", text: `${list.length}件のコマンドを読み込みました。` });
        setTimeout(() => setCmdMsg(null), 2500);
      })
      .catch((error: any) => {
        setCmdMsg({ type: "error", text: `コマンド再読込エラー: ${error?.message ?? String(error)}` });
      });
  };

  useEffect(() => { loadCmdFiles(); }, []);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = (window as any).mygamepack;
    if (!api?.giftsRead) return;
    const reloadGiftDetails = () => api.giftsRead()
      .then((res: any) => {
        const map: Record<string, string> = {};
        const diamonds: Record<string, number> = {};
        for (const g of res.gifts || []) {
          if (g.image) map[String(g.id)] = g.image;
          if (Number.isFinite(g.diamond_count)) diamonds[String(g.id)] = g.diamond_count;
        }
        setGiftImageMap(map);
        setGiftDiamondMap(diamonds);
      })
      .catch(() => {});
    void reloadGiftDetails();
    return api.onGiftsUpdated?.(() => { void reloadGiftDetails(); });
  }, []);

  useEffect(() => {
    if (typeof props.defaultGiftId === "string")   setGiftId(props.defaultGiftId);
    if (typeof props.defaultGiftName === "string") setGiftName(props.defaultGiftName);
    const selected = mappings.find(mapping => String(mapping.giftId) === props.defaultGiftId);
    const file = selected?.commandFile || "";
    const times = clampRepeat(Number(selected?.repeat ?? 1));
    setCommandFile(file); setSelectedTxtName(file); setRepeat(times);
    setSavedSnapshot(JSON.stringify({ commandFile: file, repeat: times }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.defaultGiftId, props.defaultGiftName, already?.id]);

  const handleSelectTxt = (name: string) => {
    setSelectedTxtName(name);
    setCommandFile(name);
  };

  const handleSaveUpsert = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
    const payload: Partial<GiftMapping> = {
      giftId: giftId.trim(),
      name: giftName.trim() || giftId.trim(),
      commandFile: commandFile.trim(),
      repeat: clampRepeat(Number(repeat || 1)),
      commandSetLabel: commandFile.trim(),
    };
    if (already) {
      if (!props.onUpdate) return;
      await props.onUpdate(already.id, payload);
      setSaveMsg({ type: "ok", text: "ギフト設定を上書きしました" });
    } else {
      if (!props.onAdd) return;
      await props.onAdd(payload as Omit<GiftMapping, "id">);
      setSaveMsg({ type: "ok", text: "ギフト設定を追加しました" });
    }
    setSavedSnapshot(currentSnapshot);
    setTimeout(() => setSaveMsg(null), 3000);
    } catch (error: any) {
      setSaveMsg({ type: "error", text: `保存できませんでした: ${error?.message || String(error)}` });
    } finally { setSaving(false); }
  };

  // 現在選択中ギフトの情報
  const hasGift      = giftId.trim().length > 0;
  const isCatalogSelection = giftId === props.defaultGiftId;
  const giftImage = (isCatalogSelection ? props.defaultGiftImage : null) ?? giftImageMap[giftId];
  const giftDiamonds = (isCatalogSelection ? props.defaultGiftDiamonds : null) ?? giftDiamondMap[giftId];
  const isConfigured = !!(already?.commandFile);
  const visibleMappings = showAllRoutes ? filteredMappings : filteredMappings.slice(0, 6);

  return (
    <div className="gift-mapping-stack">
      <section className="gift-flow-panel">
        <header className="gift-flow-heading">
          <div>
            <h2><span>2</span> 実行内容と回数を設定</h2>
            <p>選択したギフトに実行するコマンドと回数を設定します。</p>
          </div>
          <button type="button" onClick={loadCmdFiles}>↻ コマンド再読込</button>
        </header>
        {cmdMsg ? <p className={`gift-flow-message gift-flow-message--${cmdMsg.type}`}>{cmdMsg.text}</p> : null}

        <div className="gift-flow-body">
          <div className={`gift-flow-source ${hasGift ? "is-ready" : ""}`}>
            <div className="gift-flow-source__ring">
              {giftImage ? <img src={giftImage} alt={giftName || "選択中ギフト"} /> : null}
            </div>
            <b>{hasGift ? (giftName || giftId) : "ギフト未選択"}</b>
            <small>{hasGift ? `💎 ${giftDiamonds ?? 1}` : "上から選択してください"}</small>
          </div>

          <div className="gift-flow-link" aria-hidden="true"><i /><span>◆</span><i /></div>

          <div className="gift-command-stage">
            <label>実行するコマンド</label>
            <div className="gift-command-filters">
              <select aria-label="コマンドのカテゴリ" value={commandCategoryFilter} onChange={e => setCommandCategoryFilter(e.target.value)}>
                <option value="">すべてのカテゴリ</option>
                {commandGroups.map(([category, files]) => <option key={category} value={category}>{category}（{files.length}）</option>)}
              </select>
              <input aria-label="コマンド検索" placeholder="名前・効果で検索" value={commandQuery} onChange={e => setCommandQuery(e.target.value)} />
            </div>
            <div className="gift-command-controls">
              <span className="gift-command-icon"><MinecraftCommandIcon command={commandFile || selectedTxtName} /></span>
              <select
                disabled={saving}
                value={selectedTxtName}
                onChange={(e) => handleSelectTxt(e.target.value)}
                aria-label="実行するコマンド"
              >
                <option value="">
                  {cmdFiles.length === 0 ? "コマンド設定でTXTを作成してください" : "選択してください"}
                </option>
                {selectedTxtName && !selectedCommandVisible && <optgroup label="現在の設定"><option value={selectedTxtName}>{titleMap[selectedTxtName] || selectedTxtName}</option></optgroup>}
                {visibleCommandGroups.map(group => <optgroup key={group.category} label={group.category}>
                  {group.files.map(file => <option key={file.name} value={file.name}>{file.title || file.name}</option>)}
                </optgroup>)}
              </select>
              <div className="gift-repeat-control">
                <label htmlFor="gift-repeat">回数（1〜100）</label>
                <button type="button" disabled={saving} onClick={() => setRepeat((value) => clampRepeat(value - 1))}>−</button>
                <input
                  id="gift-repeat"
                  disabled={saving}
                  type="number"
                  min={1}
                  max={100}
                  value={repeat}
                  onChange={(e) => setRepeat(clampRepeat(Number(e.target.value)))}
                />
                <button type="button" disabled={saving} onClick={() => setRepeat((value) => clampRepeat(value + 1))}>＋</button>
              </div>
            </div>
            {!visibleCommandGroups.length && cmdFiles.length > 0 && <p role="status">一致するコマンドがありません。検索条件を変えてください。</p>}
            <small>
              参照: <code>{commandsDirHint}/{commandFile || "—"}</code>
            </small>
          </div>

          <div className="gift-flow-link gift-flow-link--end" aria-hidden="true"><i /><span>◆</span><i /></div>

          <button
            type="button"
            className="gift-save-rule"
            disabled={!canSave || saving}
            onClick={handleSaveUpsert}
          >
            <span>▣</span>
            {saving ? "保存中…" : already ? "このルートを更新" : "このルートを保存"}
          </button>
        </div>

        {already ? <p className="gift-flow-notice">設定済みのギフトです。保存すると現在のルートを上書きします。</p> : null}
        {saveMsg ? <p className={`gift-flow-message gift-flow-message--${saveMsg.type}`}>{saveMsg.text}</p> : null}
      </section>

      <section className="gift-registered-panel">
        <header className="gift-registered-heading">
          <div>
            <h3><span>3</span> 登録済みギフト <em>{filteredMappings.length} / {mappings.length} 件</em></h3>
            <p>保存したルートをクリックすると編集できます。</p>
          </div>
          <div className="gift-registered-search">
            <span>⌕</span>
            <input value={listQuery} onChange={(e) => setListQuery(e.target.value)} placeholder="検索" />
            {listQuery.trim() ? <button type="button" onClick={() => setListQuery("")}>×</button> : null}
          </div>
        </header>

        {filteredMappings.length === 0 ? (
          <div className="gift-registered-empty">
            {mappings.length === 0 ? "まだ登録されていません。" : "検索に一致するギフトがありません。"}
          </div>
        ) : (
          <div className="gift-registered-grid">
            {visibleMappings.map((mapping, index) => {
              const missing = !(mapping.commandFile || "").trim();
              const mappingImage = giftImageMap[String(mapping.giftId)];
              const resolvedTitle = mapping.commandFile ? (titleMap[mapping.commandFile] || mapping.commandFile) : "未設定";
              const isCurrentlyEditing = String(mapping.giftId) === String(giftId);

              return (
                <article
                  key={mapping.id}
                  className={`gift-route-card ${isCurrentlyEditing ? "is-editing" : ""} ${missing ? "is-missing" : ""}`}
                  onClick={() => {
                    props.onPickGift?.(String(mapping.giftId), mapping.name, mappingImage, giftDiamondMap[String(mapping.giftId)]);
                  }}
                >
                  <span className="gift-route-index">{index + 1}</span>
                  {props.onRemove ? (
                    <button
                      type="button"
                      className="gift-route-remove"
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onRemove?.(mapping.id);
                      }}
                      aria-label={`${mapping.name}を削除`}
                    >
                      ×
                    </button>
                  ) : null}
                  <span className="gift-route-art">
                    {mappingImage ? <img src={mappingImage} alt="" /> : null}
                  </span>
                  <div>
                    <b>{mapping.name}</b>
                    <small>{resolvedTitle}</small>
                    <em>× {mapping.repeat ?? 1}回</em>
                  </div>
                  <footer>💎 {giftDiamondMap[String(mapping.giftId)] ?? "?"}</footer>
                </article>
              );
            })}
          </div>
        )}
        {filteredMappings.length > 6 ? (
          <button type="button" className="gift-more-routes" onClick={() => setShowAllRoutes((value) => !value)}>
            {showAllRoutes ? "閉じる⌃" : `もっと見る（残り${filteredMappings.length - 6}件）⌄`}
          </button>
        ) : null}
      </section>
    </div>
  );
};

export default MappingEditor;
