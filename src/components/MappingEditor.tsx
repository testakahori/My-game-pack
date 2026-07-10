// src/components/MappingEditor.tsx
import React, { useEffect, useMemo, useState } from "react";
import type { CommandSet, GiftMapping } from "../types";
import MinecraftCommandIcon from "./MinecraftCommandIcon";

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
  const [giftDiamondMap, setGiftDiamondMap] = useState<Record<string, number>>({});
  const [saveMsg, setSaveMsg]             = useState<SaveMsg | null>(null);
  const [cmdMsg, setCmdMsg]               = useState<SaveMsg | null>(null);
  const [showAllRoutes, setShowAllRoutes] = useState(false);

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
    if (!api?.bridgeCommandsList) {
      setCmdMsg({ type: "error", text: "コマンド一覧APIが見つかりません。" });
      return;
    }
    setCmdMsg(null);
    api.bridgeCommandsList()
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
    api.giftsRead()
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
  const giftDiamonds = props.defaultGiftDiamonds ?? giftDiamondMap[giftId];
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
            <div className="gift-command-controls">
              <span className="gift-command-icon"><MinecraftCommandIcon command={commandFile || selectedTxtName} /></span>
              <select
                value={selectedTxtName}
                onChange={(e) => handleSelectTxt(e.target.value)}
                aria-label="実行するコマンド"
              >
                <option value="">
                  {cmdFiles.length === 0 ? "コマンド設定でTXTを作成してください" : "選択してください"}
                </option>
                {cmdFiles.map((x) => (
                  <option key={x.name} value={x.name}>{x.title || x.name}</option>
                ))}
              </select>
              <div className="gift-repeat-control">
                <label htmlFor="gift-repeat">回数（1〜100）</label>
                <button type="button" onClick={() => setRepeat((value) => clampRepeat(value - 1))}>−</button>
                <input
                  id="gift-repeat"
                  type="number"
                  min={1}
                  max={100}
                  value={repeat}
                  onChange={(e) => setRepeat(clampRepeat(Number(e.target.value)))}
                />
                <button type="button" onClick={() => setRepeat((value) => clampRepeat(value + 1))}>＋</button>
              </div>
            </div>
            <small>
              参照: <code>{commandsDirHint}/{commandFile || "—"}</code>
            </small>
          </div>

          <div className="gift-flow-link gift-flow-link--end" aria-hidden="true"><i /><span>◆</span><i /></div>

          <button
            type="button"
            className="gift-save-rule"
            disabled={!canSave}
            onClick={handleSaveUpsert}
          >
            <span>▣</span>
            {already ? "このルートを更新" : "このルートを保存"}
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
                    setGiftId(String(mapping.giftId));
                    setGiftName(mapping.name);
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
