// src/components/GiftSettingsPage.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppTab, GiftMapping, CommandSet } from "../types";
import Header from "./Header";
import MappingEditor from "./MappingEditor";
import CommandSetManager from "./CommandSetManager";
import GiftsGridSection from "./GiftsGridSection";
import ImageEditorPage from "./ImageEditorPage";
import MinecraftCommandIcon from "./MinecraftCommandIcon";

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

const GiftSettingsPage: React.FC = () => {
  const [activeTab, setActiveTab]       = useState<AppTab>(AppTab.MAPPINGS);
  const [mappings, setMappings]         = useState<GiftMapping[]>([]);
  const [commandSets, setCommandSets]   = useState<CommandSet[]>([]);
  const [pickedGiftId, setPickedGiftId]         = useState<string | undefined>(undefined);
  const [pickedGiftName, setPickedGiftName]     = useState<string | undefined>(undefined);
  const [pickedGiftImage, setPickedGiftImage]   = useState<string | null | undefined>(undefined);
  const [pickedGiftDiamonds, setPickedGiftDiamonds] = useState<number | undefined>(undefined);
  // 初期ロード完了までは保存副作用を止める（空配列で config/localStorage を上書きしないため）
  const hydratedRef = useRef(false);

  // config.minecraft.json を唯一の正として mappings を永続化する（best-effort）。
  // Bridge は fs.watch でホットリロードするため、保存は即反映される。
  const persistMappingsToConfig = useCallback(async (list: GiftMapping[]) => {
    const api = (window as any).mygamepack;
    if (!api?.configRead || !api?.configWrite) return;
    try {
      const cfg = await api.configRead();
      const normalized = list
        .filter((m) => String(m.giftId ?? "").trim() && String(m.commandFile ?? "").trim())
        .map((m) => ({
          giftId: String(m.giftId),
          name: m.name || String(m.giftId),
          commandFile: (m.commandFile || "").trim(),
          repeat: Math.min(100, Math.max(1, Number(m.repeat ?? 1))),
        }));
      // username 未設定の config は validation で弾かれる。その場合は localStorage に留め、
      // ダッシュボードの「BRIDGE に適用」で username と一緒に確定させる。
      if (!String(cfg?.tiktokUsername || "").trim()) return;
      await api.configWrite({ ...cfg, mappings: normalized });
    } catch { /* localStorage がキャッシュとして残るので致命ではない */ }
  }, []);

  useEffect(() => {
    const savedTabRaw = localStorage.getItem(LS_ACTIVE_TAB);
    const savedTab = savedTabRaw ? safeParse<AppTab>(savedTabRaw, AppTab.MAPPINGS) : null;
    if (savedTab && isAppTab(savedTab)) setActiveTab(savedTab);
    setCommandSets(safeParse<CommandSet[]>(localStorage.getItem(LS_COMMAND_SETS), []));

    const api = (window as any).mygamepack;
    const savedMappings = safeParse<GiftMapping[]>(localStorage.getItem(LS_MAPPINGS), []);

    (async () => {
      let resolved: GiftMapping[] | null = null;
      try {
        const cfg = await api?.configRead?.();
        const fromConfig = configToGiftMappings(cfg);
        // config に割当があればそれを最優先（localStorage が空でもギフト設定が消えない）
        if (fromConfig.length > 0) resolved = fromConfig;
      } catch { /* fall back to localStorage */ }

      if (!resolved) {
        const devSeed = import.meta.env.DEV && (
          savedMappings.length === 0 ||
          savedMappings.every((mapping) => mapping.id.startsWith("dev-"))
        );
        resolved = devSeed ? DEV_SAMPLE_MAPPINGS : savedMappings;
      }
      setMappings(resolved);
      hydratedRef.current = true;
    })();
  }, []);

  useEffect(() => { localStorage.setItem(LS_ACTIVE_TAB, JSON.stringify(activeTab)); }, [activeTab]);
  useEffect(() => {
    if (!hydratedRef.current) return; // 初期ロード前の空配列で上書きしない
    localStorage.setItem(LS_MAPPINGS, JSON.stringify(mappings));
    void persistMappingsToConfig(mappings);
  }, [mappings, persistMappingsToConfig]);
  useEffect(() => {
    setCommandSets(safeParse<CommandSet[]>(localStorage.getItem(LS_COMMAND_SETS), []));
  }, [activeTab]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_COMMAND_SETS) setCommandSets(safeParse<CommandSet[]>(e.newValue, []));
      if (e.key === LS_MAPPINGS)     setMappings(safeParse<GiftMapping[]>(e.newValue, []));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const addMapping    = (m: Omit<GiftMapping, "id">) => setMappings((p) => [...p, { ...m, id: uuid() }]);
  const updateMapping = (id: string, updated: Partial<GiftMapping>) =>
    setMappings((p) => p.map((x) => (x.id === id ? { ...x, ...updated } : x)));
  const removeMapping = (id: string) => setMappings((p) => p.filter((x) => x.id !== id));

  const handlePickGift = useCallback((gid: string, gname: string, image?: string | null, diamonds?: number) => {
    setPickedGiftId(gid);
    setPickedGiftName(gname);
    setPickedGiftImage(image);
    setPickedGiftDiamonds(diamonds);
  }, []);

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
                <h2>{pickedGiftName || "ハートミー"}</h2>
                <em>{pickedMapping ? "設定済み" : "未設定"}</em>
              </div>
              <p>コスト: <strong>💎 {pickedGiftDiamonds ?? 1}</strong></p>
              <div className="gift-preview-route">
                <small>ルートプレビュー</small>
                <div>
                  <span><MinecraftCommandIcon command={pickedMapping?.commandFile || "skeleton.txt"} /></span>
                  <b>{pickedMapping?.commandSetLabel || pickedMapping?.commandFile || "スケルトン降下！"}</b>
                  <em>× {pickedMapping?.repeat ?? 1}回</em>
                </div>
              </div>
            </aside>
          </div>

          <MappingEditor
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
    mappings,
    commandSets,
    pickedGiftId,
    pickedGiftName,
    pickedGiftImage,
    pickedGiftDiamonds,
    handlePickGift,
    pickedMapping,
  ]);

  return (
    <div className="gift-settings-shell page-surface flex flex-col min-h-full">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="flex-1 p-6">{tabContent}</div>
    </div>
  );
};

export default GiftSettingsPage;
