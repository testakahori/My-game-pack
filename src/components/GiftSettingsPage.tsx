// src/components/GiftSettingsPage.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppTab, GiftMapping, CommandSet } from "../types";
import Header from "./Header";
import GiftTemplateToolbar from "./GiftTemplateToolbar";
import MappingEditor from "./MappingEditor";
import CommandSetManager from "./CommandSetManager";
import GiftsGridSection from "./GiftsGridSection";
import ImageEditorPage from "./ImageEditorPage";
import RegisteredGiftBoard from "./RegisteredGiftBoard";
import type { CmdFile } from "./MappingEditor";
import { useUnsavedGuard } from "../UnsavedChanges";
import { fromConfigMappings, removedPickedGift, toConfigMappings } from "../lib/giftMappingRows";
import { normalizeTikTokId } from "../lib/tiktokId";
import { dropOnBoard, type CatalogGift } from "../lib/giftBoard";
import "./GiftSettingsBoard.css";

const LS_ACTIVE_TAB   = "mc_bridge_active_tab_v1";
const LS_MAPPINGS     = "mc_tiktok_mappings_unified_v1";
const LS_COMMAND_SETS = "mc_bridge_command_sets_v1";

const DEV_SAMPLE_MAPPINGS: GiftMapping[] = [
  { id: "dev-heart", giftId: "7934", name: "ハートミー", commandFile: "skeleton.txt", repeat: 1, commandSetLabel: "スケルトン降下！" },
  { id: "dev-rose", giftId: "5655", name: "バラ", commandFile: "zombie.txt", repeat: 1, commandSetLabel: "ゾンビ襲来！" },
  { id: "dev-gg", giftId: "6064", name: "GG", commandFile: "creeper.txt", repeat: 1, commandSetLabel: "クリーパー！" },
  { id: "dev-tiktok", giftId: "5269", name: "TikTok", commandFile: "slime.txt", repeat: 1, commandSetLabel: "スライム！" },
  { id: "dev-first", giftId: "12202", name: "初見です", commandFile: "villager.txt", repeat: 1, commandSetLabel: "村人現る！" },
  { id: "dev-wink", giftId: "13298", name: "ウィンクする", commandFile: "cod.txt", repeat: 1, commandSetLabel: "タラ" },
];

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as T;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function uuid(): string {
  const c: any = typeof crypto !== "undefined" ? crypto : null;
  if (c?.randomUUID) return c.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isAppTab(v: unknown): v is AppTab {
  return v === AppTab.COMMAND_SETS || v === AppTab.MAPPINGS || v === AppTab.IMAGE_EDITOR;
}

// config.minecraft.json の mappings（id を持たない）を UI 用 GiftMapping へ変換（enabled: false を落とさない。src/lib/giftMappingRows.ts）
function configToGiftMappings(cfg: any): GiftMapping[] {
  return fromConfigMappings(cfg, uuid);
}

// gameName は登録済みギフトの一覧の見出し「<ゲーム名> ギフト一覧」に使う（2026-11-05 ユーザーの決定。選んだゲームで変わる）。
const GiftSettingsPage: React.FC<{ onOpenImageEditor?: () => void; gameName?: string }> = ({ onOpenImageEditor, gameName }) => {
  const { confirmDiscard } = useUnsavedGuard();
  const [activeTab, setActiveTab]       = useState<AppTab>(AppTab.MAPPINGS);
  const [mappings, setMappings]         = useState<GiftMapping[]>([]);
  const [commandSets, setCommandSets]   = useState<CommandSet[]>([]);
  // 右の列のマスに出すギフトの画像（左の列が読んだカタログ）と、コマンドの名前（真ん中の列が読んだ一覧）。
  const [catalogGifts, setCatalogGifts] = useState<CatalogGift[]>([]);
  const [commandFiles, setCommandFiles] = useState<CmdFile[]>([]);
  const [pickedGiftId, setPickedGiftId]         = useState<string | undefined>(undefined);
  const [pickedGiftName, setPickedGiftName]     = useState<string | undefined>(undefined);
  const [pickedGiftImage, setPickedGiftImage]   = useState<string | null | undefined>(undefined);
  const [pickedGiftDiamonds, setPickedGiftDiamonds] = useState<number | undefined>(undefined);
  // 初期ロード完了までは保存副作用を止める（空配列で config/localStorage を上書きしないため）
  const hydratedRef = useRef(false);
  const mappingsRef = useRef<GiftMapping[]>([]);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [saveError, setSaveError] = useState("");
  const [editorRevision, setEditorRevision] = useState(0);
  const pickedGiftIdRef = useRef<string | undefined>(undefined);
  useEffect(() => { pickedGiftIdRef.current = pickedGiftId; }, [pickedGiftId]);
  // 選択を外すと、カタログ（GiftsGridSection）がページを開いたときと同じく最初のギフトを選び直す。
  const clearPickedGift = () => { setPickedGiftId(undefined); setPickedGiftName(undefined); setPickedGiftImage(undefined); setPickedGiftDiamonds(undefined); };
  const resetEditor = () => { clearPickedGift(); setEditorRevision(n => n + 1); };

  // config.minecraft.json に保存できた時だけ画面へ反映する。
  // Bridge は fs.watch でホットリロードするため、保存は即反映される。
  const persistMappingsToConfig = useCallback(async (list: GiftMapping[]) => {
    const api = (window as any).mygamepack;
    if (!api?.configRead || !api?.configWrite) throw new Error("設定の保存機能を利用できません。");
      const cfg = await api.configRead();
      const unfinished = list.find(m => !String(m.giftId ?? "").trim() || !String(m.commandFile ?? "").trim());
      if (unfinished) throw new Error(`ギフト「${unfinished.name || unfinished.giftId || "未設定"}」のコマンドが未設定です。その設定を完成させるか、不要なら削除してください。`);
      // 手で書いた enabled: false を落とさない（前は保存のたびに消え、無効にしたギフトが動き出した。処理のコピー PR5）。
      const normalized = toConfigMappings(list);
      // 空か（「@」だけも空）は整えた形で見る（src/lib/tiktokId.ts。処理のコピー PR9）。
      if (!normalizeTikTokId(cfg?.tiktokUsername)) throw new Error("配信ホームでTikTok IDを承認してから保存してください。");
      if (api.configMappingsWrite) await api.configMappingsWrite(normalized);
      else await api.configWrite({ ...cfg, mappings: normalized });
  }, []);

  useEffect(() => {
    const savedTabRaw = localStorage.getItem(LS_ACTIVE_TAB);
    const savedTab = savedTabRaw ? safeParse<AppTab>(savedTabRaw, AppTab.MAPPINGS) : null;
    if (savedTab && isAppTab(savedTab)) setActiveTab(savedTab === AppTab.IMAGE_EDITOR ? AppTab.MAPPINGS : savedTab);
    setCommandSets(safeParse<CommandSet[]>(localStorage.getItem(LS_COMMAND_SETS), []));

    const api = (window as any).mygamepack;
    const savedMappings = safeParse<GiftMapping[]>(localStorage.getItem(LS_MAPPINGS), []);

    (async () => {
      let resolved: GiftMapping[] | null = null;
      try {
        const cfg = await api?.configRead?.();
        const fromConfig = configToGiftMappings(cfg);
        // 選んだゲームの空の割当も確定済み。別ゲームのキャッシュへ戻さない。
        if (Array.isArray(cfg?.mappings)) resolved = fromConfig;
      } catch { /* fall back to localStorage */ }

      if (!resolved) {
        const devSeed = import.meta.env.DEV && (
          savedMappings.length === 0 ||
          savedMappings.every((mapping) => mapping.id.startsWith("dev-"))
        );
        resolved = devSeed ? DEV_SAMPLE_MAPPINGS : savedMappings;
      }
      setMappings(resolved);
      mappingsRef.current = resolved;
      hydratedRef.current = true;
    })();
  }, []);

  useEffect(() => { localStorage.setItem(LS_ACTIVE_TAB, JSON.stringify(activeTab)); }, [activeTab]);
  useEffect(() => {
    if (!hydratedRef.current) return; // 初期ロード前の空配列で上書きしない
    localStorage.setItem(LS_MAPPINGS, JSON.stringify(mappings));
  }, [mappings, persistMappingsToConfig]);
  useEffect(() => {
    setCommandSets(safeParse<CommandSet[]>(localStorage.getItem(LS_COMMAND_SETS), []));
  }, [activeTab]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_COMMAND_SETS) setCommandSets(safeParse<CommandSet[]>(e.newValue, []));
      if (e.key === LS_MAPPINGS) {
        const next = safeParse<GiftMapping[]>(e.newValue, []);
        mappingsRef.current = next;
        setMappings(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commitMappings = useCallback((change: (previous: GiftMapping[]) => GiftMapping[]) => {
    const task = saveQueue.current.catch(() => {}).then(async () => {
      const next = change(mappingsRef.current);
      // 変わらなければ保存しない（順番を待つあいだに前の保存で同じ並びになった並べ替えなど。2026-11-05 レビュー）。
      if (next === mappingsRef.current) return;
      try {
        await persistMappingsToConfig(next);
        mappingsRef.current = next;
        setMappings(next);
        setSaveError("");
      } catch (error: any) {
        setSaveError(`保存できませんでした: ${error?.message || String(error)}`);
        throw error;
      }
    });
    saveQueue.current = task;
    return task;
  }, [persistMappingsToConfig]);
  const addMapping = useCallback((m: Omit<GiftMapping, "id">) => commitMappings(p => [...p, { ...m, id: uuid() }]), [commitMappings]);
  const updateMapping = useCallback((id: string, updated: Partial<GiftMapping>) =>
    commitMappings(p => p.map(x => x.id === id ? { ...x, ...updated } : x)), [commitMappings]);
  const removeMapping = useCallback((id: string) => {
    if (!confirmDiscard()) return;
    const removedGiftId = String(mappingsRef.current.find(x => x.id === id)?.giftId ?? "").trim();
    // 編集中のギフトを消したら選択を外す（src/lib/giftMappingRows.ts の removedPickedGift。2026-11-04 ユーザーの決定）。
    void commitMappings(p => p.filter(x => x.id !== id))
      .then(() => { if (removedPickedGift(pickedGiftIdRef.current, removedGiftId, mappingsRef.current)) clearPickedGift(); })
      .catch(() => {});
  }, [commitMappings, confirmDiscard]);
  // 登録済みギフトの並べ替え（ギフトのあるマスへ落とすと入れ替え、空いたマスへ落とすと最後へ。src/lib/giftBoard.ts）。
  // 並び順は設定の mappings の順として保存する（アプリを閉じても残る。2026-11-05 ユーザーの決定）。
  const moveMapping = useCallback((fromId: string, toId: string | null) => {
    if (dropOnBoard(mappingsRef.current, fromId, toId) === mappingsRef.current) return;
    void commitMappings(p => { const next = dropOnBoard(p, fromId, toId); return next === p ? p : [...next]; }).catch(() => {});
  }, [commitMappings]);

  const handlePickGift = useCallback((gid: string, gname: string, image?: string | null, diamonds?: number) => {
    // 何も選んでいないとき（ページを開いた直後・✖ で編集中のギフトを消した後・テンプレートの前）は、カタログが最初のギフトを選ぶだけなので確かめない。
    // 前は ✖ の確認の直後に「保存されていない変更があります」がもう1回出て、キャンセルすると「ギフト未選択」のまま止まった（2026-11-04 レビュー 重要1）。
    if (gid === pickedGiftId || (pickedGiftId !== undefined && !confirmDiscard())) return;
    setPickedGiftId(gid);
    setPickedGiftName(gname);
    setPickedGiftImage(image);
    setPickedGiftDiamonds(diamonds);
  }, [pickedGiftId, confirmDiscard]);

  const tabContent = useMemo(() => {
    if (activeTab === AppTab.COMMAND_SETS) return <CommandSetManager />;

    if (activeTab === AppTab.MAPPINGS) {
      // 3列：① ギフトを選ぶ → ② 実行内容を設定（「この内容で登録」）→ ③ 登録済みギフト（6 × 9 の一覧・PNG）。2026-11-05 ユーザーの決定。
      return (
        <div className="gift-steps page-surface">
          <GiftsGridSection
            selectedGiftId={pickedGiftId}
            mappings={mappings}
            onPickGift={handlePickGift}
            onGiftsLoaded={setCatalogGifts}
          />
          <MappingEditor key={editorRevision}
            mappings={mappings}
            commandSets={commandSets}
            commandsDirKey="minecraft"
            defaultCommandsDirHint="bridge/commands/minecraft"
            defaultGiftId={pickedGiftId}
            defaultGiftName={pickedGiftName}
            defaultGiftImage={pickedGiftImage}
            defaultGiftDiamonds={pickedGiftDiamonds}
            onAdd={addMapping}
            onUpdate={updateMapping}
            onCommandFilesLoaded={setCommandFiles}
          />
          <RegisteredGiftBoard
            mappings={mappings}
            gifts={catalogGifts}
            commandFiles={commandFiles}
            gameName={gameName}
            selectedGiftId={pickedGiftId}
            onPickGift={handlePickGift}
            onRemove={removeMapping}
            onMove={moveMapping}
          />
        </div>
      );
    }

    if (activeTab === AppTab.IMAGE_EDITOR) {
      return <ImageEditorPage mappings={mappings} />;
    }

    return null;
  }, [
    activeTab,
    editorRevision,
    mappings,
    commandSets,
    pickedGiftId,
    pickedGiftName,
    pickedGiftImage,
    pickedGiftDiamonds,
    handlePickGift,
    catalogGifts, commandFiles, gameName,
    addMapping, updateMapping, removeMapping, moveMapping,
  ]);

  return (
    <div className="gift-settings-shell page-surface flex flex-col min-h-full">
      {saveError && <p role="alert" className="gift-catalog-error">{saveError}</p>}
      <Header activeTab={activeTab} setActiveTab={tab => { if (tab !== activeTab && confirmDiscard()) { if (tab === AppTab.IMAGE_EDITOR && onOpenImageEditor) onOpenImageEditor(); else setActiveTab(tab); } }} />
      {activeTab === AppTab.MAPPINGS && <GiftTemplateToolbar ready={hydratedRef.current} count={mappings.length} onResetEditor={resetEditor} onApplied={rows => {
        const next = configToGiftMappings({ mappings: rows }); mappingsRef.current = next; setMappings(next); setSaveError(''); resetEditor();
      }} />}
      <div className="flex-1 p-6">{tabContent}</div>
    </div>
  );
};

export default GiftSettingsPage;
