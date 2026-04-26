// src/components/GiftSettingsPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppTab, GiftMapping, CommandSet } from "../types";
import Header from "./Header";
import MappingEditor from "./MappingEditor";
import CommandSetManager from "./CommandSetManager";
import GiftsGridSection from "./GiftsGridSection";
import ImageEditorPage from "./ImageEditorPage";

const LS_ACTIVE_TAB   = "mc_bridge_active_tab_v1";
const LS_MAPPINGS     = "mc_tiktok_mappings_unified_v1";
const LS_COMMAND_SETS = "mc_bridge_command_sets_v1";

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

const GiftSettingsPage: React.FC = () => {
  const [activeTab, setActiveTab]       = useState<AppTab>(AppTab.COMMAND_SETS);
  const [mappings, setMappings]         = useState<GiftMapping[]>([]);
  const [commandSets, setCommandSets]   = useState<CommandSet[]>([]);
  const [pickedGiftId, setPickedGiftId]         = useState<string | undefined>(undefined);
  const [pickedGiftName, setPickedGiftName]     = useState<string | undefined>(undefined);
  const [pickedGiftImage, setPickedGiftImage]   = useState<string | null | undefined>(undefined);
  const [pickedGiftDiamonds, setPickedGiftDiamonds] = useState<number | undefined>(undefined);

  useEffect(() => {
    const savedTabRaw = localStorage.getItem(LS_ACTIVE_TAB);
    const savedTab = savedTabRaw ? safeParse<AppTab>(savedTabRaw, AppTab.COMMAND_SETS) : null;
    if (savedTab && isAppTab(savedTab)) setActiveTab(savedTab);

    setMappings(safeParse<GiftMapping[]>(localStorage.getItem(LS_MAPPINGS), []));
    setCommandSets(safeParse<CommandSet[]>(localStorage.getItem(LS_COMMAND_SETS), []));
  }, []);

  useEffect(() => { localStorage.setItem(LS_ACTIVE_TAB, JSON.stringify(activeTab)); }, [activeTab]);
  useEffect(() => { localStorage.setItem(LS_MAPPINGS, JSON.stringify(mappings)); }, [mappings]);
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

  const tabContent = useMemo(() => {
    if (activeTab === AppTab.COMMAND_SETS) return <CommandSetManager />;

    if (activeTab === AppTab.MAPPINGS) {
      return (
        <div className="max-w-5xl mx-auto space-y-5">
          <GiftsGridSection
            selectedGiftId={pickedGiftId}
            mappings={mappings}
            onPickGift={handlePickGift}
          />

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
  ]);

  return (
    <div className="flex flex-col min-h-full">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="flex-1 p-6">{tabContent}</div>
    </div>
  );
};

export default GiftSettingsPage;
