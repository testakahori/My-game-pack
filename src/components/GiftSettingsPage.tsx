// src/components/GiftSettingsPage.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppTab, GiftMapping, CommandSet } from "../types";
import Header from "./Header";
import GiftTemplateToolbar from "./GiftTemplateToolbar";
import MappingEditor from "./MappingEditor";
import CommandSetManager from "./CommandSetManager";
import GiftsGridSection from "./GiftsGridSection";
import ImageEditorPage from "./ImageEditorPage";
import MinecraftCommandIcon from "./MinecraftCommandIcon";
import { useUnsavedGuard } from "../UnsavedChanges";

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

// config.minecraft.json の mappings（id を持たない）を UI 用 GiftMapping へ変換
function configToGiftMappings(cfg: any): GiftMapping[] {
  const arr = Array.isArray(cfg?.mappings) ? cfg.mappings : [];
  return arr
    .filter((m: any) => String(m?.giftId ?? "").trim())
    .map((m: any) => {
      const commandFile = String(m.commandFile ?? "").trim();
      return {
        id: uuid(),
        giftId: String(m.giftId),
        name: String(m.name ?? "") || String(m.giftId),
        commandFile,
        repeat: Math.min(100, Math.max(1, Number(m.repeat ?? 1))),
        commandSetLabel: commandFile,
      } as GiftMapping;
    });
}

const GiftSettingsPage: React.FC<{ onOpenImageEditor?: () => void }> = ({ onOpenImageEditor }) => {
  const { confirmDiscard } = useUnsavedGuard();
  const [activeTab, setActiveTab]       = useState<AppTab>(AppTab.MAPPINGS);
  const [mappings, setMappings]         = useState<GiftMapping[]>([]);
  const [commandSets, setCommandSets]   = useState<CommandSet[]>([]);
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
  const resetEditor = () => { setPickedGiftId(undefined); setPickedGiftName(undefined); setPickedGiftImage(undefined); setPickedGiftDiamonds(undefined); setEditorRevision(n => n + 1); };

  // config.minecraft.json に保存できた時だけ画面へ反映する。
  // Bridge は fs.watch でホットリロードするため、保存は即反映される。
  const persistMappingsToConfig = useCallback(async (list: GiftMapping[]) => {
    const api = (window as any).mygamepack;
    if (!api?.configRead || !api?.configWrite) throw new Error("設定の保存機能を利用できません。");
      const cfg = await api.configRead();
      const unfinished = list.find(m => !String(m.giftId ?? "").trim() || !String(m.commandFile ?? "").trim());
      if (unfinished) throw new Error(`ギフト「${unfinished.name || unfinished.giftId || "未設定"}」のコマンドが未設定です。その設定を完成させるか、不要なら削除してください。`);
      const normalized = list.map((m) => ({
          giftId: String(m.giftId),
          name: m.name || String(m.giftId),
          commandFile: (m.commandFile || "").trim(),
          repeat: Math.min(100, Math.max(1, Number(m.repeat ?? 1))),
        }));
      if (!String(cfg?.tiktokUsername || "").trim()) throw new Error("ダッシュボードでTikTok IDを承認してから保存してください。");
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
        // config に割当があればそれを最優先（localStorage が空でもギフト設定が消えない）
        if (Array.isArray(cfg?.mappings) && (fromConfig.length > 0 || cfg?.tiktokUsername)) resolved = fromConfig;
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
    void commitMappings(p => p.filter(x => x.id !== id)).catch(() => {});
  }, [commitMappings, confirmDiscard]);

  const handlePickGift = useCallback((gid: string, gname: string, image?: string | null, diamonds?: number) => {
    if (gid === pickedGiftId || !confirmDiscard()) return;
    setPickedGiftId(gid);
    setPickedGiftName(gname);
    setPickedGiftImage(image);
    setPickedGiftDiamonds(diamonds);
  }, [pickedGiftId, confirmDiscard]);

  const pickedMapping = useMemo(
    () => mappings.find((mapping) => String(mapping.giftId) === String(pickedGiftId)),
    [mappings, pickedGiftId]
  );

  const tabContent = useMemo(() => {
    if (activeTab === AppTab.COMMAND_SETS) return <CommandSetManager />;

    if (activeTab === AppTab.MAPPINGS) {
      return (
        <div className="gift-settings-page gift-design-page page-surface max-w-none mx-auto space-y-4">
          <div className="gift-design-top">
            <div className="gift-design-catalog">
              <GiftsGridSection
                selectedGiftId={pickedGiftId}
                mappings={mappings}
                onPickGift={handlePickGift}
              />
            </div>
            <aside className="gift-design-preview">
              <div className="gift-preview-art">
                {pickedGiftImage ? <img src={pickedGiftImage} alt={pickedGiftName || "選択中ギフト"} /> : null}
                <i>✦</i><b>✦</b>
              </div>
              <div className="gift-preview-heading">
                <h2>{pickedGiftName || "ギフトを選択"}</h2>
                <em>{pickedMapping ? "設定済み" : "未設定"}</em>
              </div>
              <p>コスト: <strong>💎 {pickedGiftDiamonds ?? 1}</strong></p>
              <div className="gift-preview-route">
                <small>ルートプレビュー</small>
                <div>
                  <span><MinecraftCommandIcon command={pickedMapping?.commandFile || "skeleton.txt"} /></span>
                  <b>{pickedMapping?.commandSetLabel || pickedMapping?.commandFile || "コマンド未設定"}</b>
                  <em>× {pickedMapping?.repeat ?? 1}回</em>
                </div>
              </div>
            </aside>
          </div>

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
            onRemove={removeMapping}
            onPickGift={handlePickGift}
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
    pickedMapping,
    addMapping, updateMapping, removeMapping,
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
