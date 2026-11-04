// src/components/MappingEditor.tsx
// ギフト設定の真ん中の列「② 実行内容を設定」（2026-11-05 ユーザーの決定で3列に組み直した）。
// 左で選んだギフトに、実行するコマンドと回数を決めて「この内容で登録」。登録したギフトは右の列（RegisteredGiftBoard）に並ぶ。
import React, { useEffect, useMemo, useState } from "react";
import type { CommandSet, GiftMapping } from "../types";
import MinecraftCommandIcon from "./MinecraftCommandIcon";
import { useUnsavedChanges } from "../UnsavedChanges";
import { commandOptionLabel } from "../lib/commandLabel";
import { toRepeat } from "../lib/integerInput";
import { commandFileStem, findCommandFile, sameCommandFile } from "../lib/commandFiles";
import { isDisabledMapping } from "../lib/giftMappingRows";
import DisabledMappingMark from "./DisabledMappingMark";
import { commandGroupLabel, groupCommandsByCategory, searchCommandGroups } from "../lib/commandGroups";

export type CmdFile = { name: string; title: string; category?: string; description?: string; invalidName?: boolean; invalidReason?: string };

type Props = {
  mappings?: GiftMapping[];
  commandSets?: CommandSet[];

  onAdd?: (m: Omit<GiftMapping, "id">) => void | Promise<void>;
  onUpdate?: (id: string, updated: Partial<GiftMapping>) => void | Promise<void>;
  // コマンドの一覧を読んだら渡す（右の列のマスにコマンドの名前を出すため）。
  onCommandFilesLoaded?: (files: CmdFile[]) => void;

  commandsDirKey?: string;
  defaultGiftId?: string;
  defaultGiftName?: string;
  defaultGiftImage?: string | null;
  defaultGiftDiamonds?: number;
  defaultCommandsDirHint?: string;
};

type SaveMsg = { type: "ok" | "error"; text: string };


const MappingEditor: React.FC<Props> = (props) => {
  const mappings        = Array.isArray(props.mappings) ? props.mappings : [];
  const commandsDirHint = (props.defaultCommandsDirHint || "bridge/commands").trim() || "bridge/commands";
  const onCommandFilesLoaded = props.onCommandFilesLoaded;

  const [giftId, setGiftId]               = useState(props.defaultGiftId ?? "");
  const [giftName, setGiftName]           = useState(props.defaultGiftName ?? "");
  const [repeat, setRepeat]               = useState<number>(1);
  const [commandFile, setCommandFile]     = useState<string>("");
  const [selectedTxtName, setSelectedTxtName] = useState<string>("");
  const [cmdFiles, setCmdFiles]           = useState<CmdFile[]>([]);
  const [commandCategoryFilter, setCommandCategoryFilter] = useState("");
  const [commandQuery, setCommandQuery] = useState("");
  // 分類の見出しの決め方は、いいね・フォローとルーレット・コメントと同じ1か所（src/lib/commandGroups.ts。2026-10-30）。
  const commandGroups = useMemo(() => groupCommandsByCategory(cmdFiles), [cmdFiles]);
  // 見出しの（件数）と分類で絞る欄の（件数）は、どちらも検索で絞ったあとの数（PR #174 レビュー 軽い7）。
  const searchedCommandGroups = useMemo(() => searchCommandGroups(commandGroups, commandQuery), [commandGroups, commandQuery]);
  const visibleCommandGroups = useMemo(() => searchedCommandGroups.filter(([category, files]) => files.length && (!commandCategoryFilter || category === commandCategoryFilter)).map(([category, files]) => ({ category, files })), [searchedCommandGroups, commandCategoryFilter]);
  // 同じコマンドかは .txt の有無・大文字小文字を問わない（src/lib/commandFiles.ts。処理のコピー PR8）。
  // 手で書いた Neko.TXT の割り当ても、一覧の neko.txt を選んだ形で出す（選択の値は一覧の名前）。
  const selectedListedName = findCommandFile(cmdFiles, selectedTxtName)?.name ?? selectedTxtName;
  const selectedCommandVisible = visibleCommandGroups.some(group => group.files.some(file => sameCommandFile(file.name, selectedTxtName)));
  const [giftImageMap, setGiftImageMap]   = useState<Record<string, string>>({});
  const [giftDiamondMap, setGiftDiamondMap] = useState<Record<string, number>>({});
  const [saveMsg, setSaveMsg]             = useState<SaveMsg | null>(null);
  const [saving, setSaving] = useState(false);
  const [cmdMsg, setCmdMsg]               = useState<SaveMsg | null>(null);
  const currentSnapshot = JSON.stringify({ commandFile, repeat });
  const [savedSnapshot, setSavedSnapshot] = useState(currentSnapshot);
  useUnsavedChanges(currentSnapshot !== savedSnapshot, saving);

  const titleOf = (commandFile: string) => findCommandFile(cmdFiles, commandFile)?.title;

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
        onCommandFilesLoaded?.(list);
        setCmdMsg({ type: "ok", text: `${list.length}件のコマンドを読み込みました。` });
        setTimeout(() => setCmdMsg(null), 2500);
      })
      .catch((error: any) => {
        setCmdMsg({ type: "error", text: `コマンドを再読み込みできませんでした: ${error?.message ?? String(error)}` });
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
    // 選択を外したとき（✖ で編集中のギフトを消した。2026-11-04）は、消したギフトを残さず空にする。
    setGiftId(props.defaultGiftId ?? "");
    setGiftName(props.defaultGiftName ?? "");
    const selected = mappings.find(mapping => String(mapping.giftId) === props.defaultGiftId);
    const file = selected?.commandFile || "";
    const times = toRepeat(selected?.repeat ?? 1);
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
      repeat: toRepeat(repeat),
      commandSetLabel: commandFile.trim(),
    };
    if (already) {
      if (!props.onUpdate) return;
      await props.onUpdate(already.id, payload);
      setSaveMsg({ type: "ok", text: "ギフト設定を上書きしました" });
    } else {
      if (!props.onAdd) return;
      await props.onAdd(payload as Omit<GiftMapping, "id">);
      setSaveMsg({ type: "ok", text: "登録しました。右の一覧の最後に入ります。" });
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
  const commandTitle = commandFile ? (titleOf(commandFile) || commandFileStem(commandFile)) : "";

  return (
    <section className="gift-step gift-edit" aria-labelledby="gift-edit-title">
      <header className="gift-step-heading">
        <h2 id="gift-edit-title"><span>2</span>実行内容を設定</h2>
        <button type="button" className="gift-step-tool" onClick={loadCmdFiles} title="コマンドの一覧を読み直します">↻ コマンドを再読み込み</button>
      </header>
      {cmdMsg ? <p className={`gift-edit-message gift-edit-message--${cmdMsg.type}`}>{cmdMsg.text}</p> : null}

      <div className={`gift-edit-gift ${hasGift ? "is-ready" : ""}`}>
        <div className="gift-edit-ring">
          {giftImage ? <img src={giftImage} alt={giftName || "選択中ギフト"} /> : null}
        </div>
        <b>{hasGift ? (giftName || giftId) : "ギフト未選択"}</b>
        <small>{hasGift ? `💎 ${giftDiamonds ?? 1}` : "左の一覧から選んでください"}</small>
        {isDisabledMapping(already) ? <DisabledMappingMark /> : null}
      </div>

      <div className="gift-edit-fields">
        <label className="gift-edit-field">
          <span>コマンドを検索</span>
          <span className="gift-edit-search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
            <input aria-label="コマンド検索" placeholder="名前・効果で検索" value={commandQuery} onChange={e => setCommandQuery(e.target.value)} />
          </span>
        </label>
        <label className="gift-edit-field">
          <span>カテゴリ</span>
          <select aria-label="コマンドのカテゴリ" value={commandCategoryFilter} onChange={e => setCommandCategoryFilter(e.target.value)}>
            <option value="">すべてのカテゴリ</option>
            {searchedCommandGroups.map(([category, files]) => <option key={category} value={category}>{category}（{files.length}）</option>)}
          </select>
        </label>
        <label className="gift-edit-field">
          <span>実行するコマンド</span>
          <select
            className="gift-edit-command"
            disabled={saving}
            value={selectedListedName}
            onChange={(e) => handleSelectTxt(e.target.value)}
            aria-label="実行するコマンド"
          >
            <option value="">
              {cmdFiles.length === 0 ? "コマンド設定でTXTを作成してください" : "選択してください"}
            </option>
            {selectedTxtName && !selectedCommandVisible && <optgroup label="現在の設定" className="command-optgroup"><option value={selectedListedName}>{titleOf(selectedTxtName) || selectedTxtName}</option></optgroup>}
            {visibleCommandGroups.map(group => <optgroup key={group.category} label={commandGroupLabel(group.category, group.files.length)} className="command-optgroup">
              {group.files.map(file => <option key={file.name} value={file.name}>{commandOptionLabel(file)}</option>)}
            </optgroup>)}
          </select>
        </label>
        {!visibleCommandGroups.length && cmdFiles.length > 0 && <p className="gift-edit-empty" role="status">一致するコマンドがありません。検索条件を変えてください。</p>}
        <div className="gift-edit-field gift-edit-repeat">
          <span><label htmlFor="gift-repeat">実行回数</label><small>1〜100回</small></span>
          <div className="gift-edit-stepper">
            <button type="button" aria-label="回数を減らす" disabled={saving} onClick={() => setRepeat((value) => toRepeat(value - 1))}>−</button>
            <input
              id="gift-repeat"
              disabled={saving}
              type="number"
              min={1}
              max={100}
              value={repeat}
              step={1}
              onChange={(e) => setRepeat(toRepeat(e.target.value))}
            />
            <button type="button" aria-label="回数を増やす" disabled={saving} onClick={() => setRepeat((value) => toRepeat(value + 1))}>＋</button>
          </div>
        </div>
      </div>

      <div className="gift-edit-summary">
        <span className="gift-edit-summary__icon"><MinecraftCommandIcon command={commandFile || selectedTxtName} /></span>
        <p>
          <b>{hasGift ? (giftName || giftId) : "ギフト未選択"}</b>
          <i aria-hidden="true">→</i>
          <b>{commandTitle || "コマンド未選択"}</b>
          <em>×{repeat}回</em>
        </p>
      </div>
      <small className="gift-edit-ref">参照: <code>{commandsDirHint}/{commandFile || "—"}</code></small>

      <button
        type="button"
        className="gift-edit-save"
        disabled={!canSave || saving}
        onClick={handleSaveUpsert}
      >
        {saving ? "保存中…" : already ? "この内容で更新" : "この内容で登録"}
      </button>

      {already ? <p className="gift-edit-notice">設定済みのギフトです。「この内容で更新」を押すと、今の設定を上書きします。</p> : null}
      {isDisabledMapping(already) ? <p className="gift-edit-disabled-note">このギフトの割り当ては設定ファイルで無効になっています。保存しても無効のままです。</p> : null}
      {saveMsg ? <p className={`gift-edit-message gift-edit-message--${saveMsg.type}`} role="status">{saveMsg.text}</p> : null}
    </section>
  );
};

export default MappingEditor;
