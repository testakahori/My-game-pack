// src/components/EventSettingsPage.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ToggleSlider } from "./ToggleSlider";

type LikeEvent = {
  id: string;
  threshold: number;
  commandFile: string;
  repeat: number;
  label: string;
  enabled: boolean;
};

type SimpleEvent = {
  commandFile: string;
  repeat: number;
  enabled: boolean;
};

type Config = {
  likeEvents?: LikeEvent[];
  unmappedGiftEvent?: SimpleEvent;
  shareEvent?: SimpleEvent;
  followEvent?: SimpleEvent;
  memberEvent?: SimpleEvent;
};

type CommandFile = { name: string; title: string };

type Props = {
  onDirtyChange?: (dirty: boolean) => void;
};

const api = (window as any).mygamepack;

function newLikeEvent(): LikeEvent {
  return { id: crypto.randomUUID(), threshold: 10, commandFile: "", repeat: 1, label: "", enabled: true };
}

// ── コマンドファイル選択 ─────────────────────────────────
function CmdFileSelect({
  value,
  onChange,
  commandFiles,
}: {
  value: string;
  onChange: (v: string) => void;
  commandFiles: CommandFile[];
}) {
  const selected = commandFiles.find((f) => f.name === value);
  return (
    <div className="flex items-center gap-2">
      {commandFiles.length > 0 ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-gray-900 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
        >
          <option value="">（未設定）</option>
          {value && !selected && <option value={value}>{value}</option>}
          {commandFiles.map((f) => (
            <option key={f.name} value={f.name}>{f.title}</option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="例: cod.txt"
          className="flex-1 bg-gray-900 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
        />
      )}
      {selected && selected.title !== selected.name && (
        <span className="text-[10px] text-gray-500 shrink-0">({selected.name})</span>
      )}
    </div>
  );
}

// ── 標準イベントカード ────────────────────────────────────
function SimpleEventCard({
  icon,
  title,
  description,
  event,
  onToggle,
  onCommandChange,
  onRepeatChange,
  commandFiles,
  children,
}: {
  icon: string;
  title: string;
  description: React.ReactNode;
  event: SimpleEvent;
  onToggle: () => void;
  onCommandChange: (v: string) => void;
  onRepeatChange?: (v: number) => void;
  commandFiles: CommandFile[];
  children?: React.ReactNode;
}) {
  return (
    <div className={`border rounded-2xl p-5 space-y-4 transition-all ${
      event.enabled
        ? "bg-gray-800 border-gray-700"
        : "bg-gray-900/40 border-gray-800"
    }`}>
      {/* ヘッダー */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-2xl shrink-0 mt-0.5">{icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-black text-white">{title}</h3>
              {event.enabled ? (
                <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">有効</span>
              ) : (
                <span className="text-[9px] font-bold text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">無効</span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{description}</p>
          </div>
        </div>
        <ToggleSlider checked={event.enabled} onChange={onToggle} />
      </div>

      {/* 実行イベント + 回数 */}
      <div>
        <label className="text-xs font-bold text-gray-400 mb-1.5 block">実行イベント</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <CmdFileSelect
              value={event.commandFile}
              onChange={onCommandChange}
              commandFiles={commandFiles}
            />
          </div>
          {onRepeatChange && (
            <>
              <input
                type="number"
                min={1}
                max={100}
                value={event.repeat ?? 1}
                onChange={(e) => onRepeatChange(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                className="w-16 shrink-0 bg-gray-900 border border-gray-600 rounded-xl px-2 py-2.5 text-sm text-center text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              />
              <span className="text-xs text-gray-500 shrink-0">回</span>
            </>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}

// ── メインコンポーネント ──────────────────────────────────
const EventSettingsPage: React.FC<Props> = ({ onDirtyChange }) => {
  const [likeEvents, setLikeEvents]               = useState<LikeEvent[]>([]);
  const [unmappedGiftEvent, setUnmappedGiftEvent] = useState<SimpleEvent>({ commandFile: "", enabled: false });
  const [shareEvent, setShareEvent]               = useState<SimpleEvent>({ commandFile: "", enabled: false });
  const [followEvent, setFollowEvent]             = useState<SimpleEvent>({ commandFile: "", enabled: false });
  const [memberEvent, setMemberEvent]             = useState<SimpleEvent>({ commandFile: "", enabled: false });
  const [commandFiles, setCommandFiles]           = useState<CommandFile[]>([]);
  const [loading, setLoading]                     = useState(true);
  const [saving, setSaving]                       = useState(false);
  const [msg, setMsg]                             = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [isDirty, setIsDirty]                     = useState(false);

  const snapshot = useRef<string>("");

  const makeSnapshot = (
    likes: LikeEvent[],
    unmapped: SimpleEvent,
    share: SimpleEvent,
    follow: SimpleEvent,
    member: SimpleEvent
  ) =>
    JSON.stringify({
      likeEvents: likes.map(({ id: _id, ...r }) => r),
      unmappedGiftEvent: unmapped,
      shareEvent: share,
      followEvent: follow,
      memberEvent: member,
    });

  const checkDirty = useCallback(
    (likes: LikeEvent[], unmapped: SimpleEvent, share: SimpleEvent, follow: SimpleEvent, member: SimpleEvent) => {
      const dirty = makeSnapshot(likes, unmapped, share, follow, member) !== snapshot.current;
      setIsDirty(dirty);
      onDirtyChange?.(dirty);
    },
    [onDirtyChange]
  );

  // ── 読み込み ──
  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [cfg, files]: [Config, CommandFile[]] = await Promise.all([
        api.configRead(),
        api.bridgeCommandsList().catch(() => [] as CommandFile[]),
      ]);
      setCommandFiles(files);

      const likes   = (cfg.likeEvents ?? []).map((e: any) => ({ repeat: 1, ...e, id: e.id ?? crypto.randomUUID() }));
      const unmapped = { commandFile: "", repeat: 1, enabled: false, ...cfg.unmappedGiftEvent };
      const share   = { commandFile: "", repeat: 1, enabled: false, ...cfg.shareEvent };
      const follow  = { commandFile: "", repeat: 1, enabled: false, ...cfg.followEvent };
      const member  = { commandFile: "", repeat: 1, enabled: false, ...cfg.memberEvent };

      setLikeEvents(likes);
      setUnmappedGiftEvent(unmapped);
      setShareEvent(share);
      setFollowEvent(follow);
      setMemberEvent(member);

      snapshot.current = makeSnapshot(likes, unmapped, share, follow, member);
      setIsDirty(false);
      onDirtyChange?.(false);
    } catch (e: any) {
      setMsg({ type: "error", text: `読み込みエラー: ${e?.message ?? String(e)}` });
    } finally {
      setLoading(false);
    }
  }, [onDirtyChange]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (isDirty) e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── 保存 ──
  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const cfg: any = await api.configRead();
      const next = {
        ...cfg,
        likeEvents: likeEvents.map(({ id: _id, ...rest }) => rest),
        unmappedGiftEvent,
        shareEvent,
        followEvent,
        memberEvent,
      };
      await api.configWrite(next);
      snapshot.current = makeSnapshot(likeEvents, unmappedGiftEvent, shareEvent, followEvent, memberEvent);
      setIsDirty(false);
      onDirtyChange?.(false);
      setMsg({ type: "ok", text: "保存しました。次回 BRIDGE 起動から有効になります。" });
      setTimeout(() => setMsg(null), 4000);
    } catch (e: any) {
      setMsg({ type: "error", text: `保存エラー: ${e?.message ?? String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  // ── いいね更新 ──
  const updateLike = (id: string, patch: Partial<LikeEvent>) => {
    const next = likeEvents.map((e) => (e.id === id ? { ...e, ...patch } : e));
    setLikeEvents(next);
    checkDirty(next, unmappedGiftEvent, shareEvent, followEvent, memberEvent);
  };

  const setLikeEventsD = (updater: (p: LikeEvent[]) => LikeEvent[]) => {
    setLikeEvents((p) => {
      const n = updater(p);
      checkDirty(n, unmappedGiftEvent, shareEvent, followEvent, memberEvent);
      return n;
    });
  };

  const setUnmappedD = (v: SimpleEvent) => { setUnmappedGiftEvent(v); checkDirty(likeEvents, v, shareEvent, followEvent, memberEvent); };
  const setShareD    = (v: SimpleEvent) => { setShareEvent(v);    checkDirty(likeEvents, unmappedGiftEvent, v, followEvent, memberEvent); };
  const setFollowD   = (v: SimpleEvent) => { setFollowEvent(v);   checkDirty(likeEvents, unmappedGiftEvent, shareEvent, v, memberEvent); };
  const setMemberD   = (v: SimpleEvent) => { setMemberEvent(v);   checkDirty(likeEvents, unmappedGiftEvent, shareEvent, followEvent, v); };

  // ── サマリー情報 ──
  const enabledCount = [
    likeEvents.some((e) => e.enabled),
    unmappedGiftEvent.enabled,
    followEvent.enabled,
    shareEvent.enabled,
    memberEvent.enabled,
  ].filter(Boolean).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400">
        <div className="text-center space-y-2">
          <div className="text-2xl">⏳</div>
          <div>設定を読み込み中…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">

      {/* ══ ヘッダー + アクション ══ */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-white">イベント設定</h1>
          <p className="text-gray-400 text-sm mt-1">
            いいね・シェア・訪問 でコマンドを発火します。
            <code className="text-cyan-400 text-xs ml-1">config.minecraft.json</code> に保存されます。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={load}
            className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-500 transition"
          >
            🔄 再読込
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`px-5 py-2 rounded-lg text-sm font-bold transition active:scale-95 ${
              isDirty && !saving
                ? "bg-cyan-600 hover:bg-cyan-500 text-white shadow-md"
                : !saving
                ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                : "bg-gray-700 text-gray-500 cursor-not-allowed"
            }`}
          >
            {saving ? "保存中…" : "💾 保存する"}
          </button>
        </div>
      </div>

      {/* 未保存 / メッセージ */}
      {isDirty && !msg && (
        <div className="px-4 py-3 rounded-xl text-sm font-medium bg-amber-950/40 border border-amber-600/40 text-amber-300 flex items-center gap-2">
          ⚠ 未保存の変更があります。保存ボタンを押してください。
        </div>
      )}
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          msg.type === "ok"
            ? "bg-emerald-900/50 border border-emerald-500/30 text-emerald-300"
            : "bg-red-900/50 border border-red-500/30 text-red-300"
        }`}>
          {msg.type === "ok" ? "✅ " : "❌ "}{msg.text}
        </div>
      )}

      {/* ══ サマリー ══ */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">イベント設定サマリー</h2>
          <span className="text-xs text-gray-500">
            <span className="text-cyan-300 font-bold">{enabledCount}</span> / 5 有効
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "👍 いいね", enabled: likeEvents.some((e) => e.enabled), count: likeEvents.length },
            { label: "🎁 未設定ギフト", enabled: unmappedGiftEvent.enabled },
            { label: "➕ フォロー", enabled: followEvent.enabled },
            { label: "🔗 シェア", enabled: shareEvent.enabled },
            { label: "🚶 訪問", enabled: memberEvent.enabled },
          ].map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold ${
                item.enabled
                  ? "bg-emerald-950/50 border-emerald-700/50 text-emerald-300"
                  : "bg-gray-900/60 border-gray-700 text-gray-500"
              }`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${item.enabled ? "bg-emerald-400" : "bg-gray-600"}`} />
              {item.label}
              {"count" in item && item.count > 0 && (
                <span className={`ml-0.5 px-1 rounded text-[9px] ${item.enabled ? "bg-emerald-800/60" : "bg-gray-700"}`}>
                  {item.count}件
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ══ いいね設定（特別扱い） ══ */}
      <section className="bg-gray-800 border border-gray-700 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-white">👍 いいね設定</h2>
              <span className="text-[10px] font-bold text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-700/40">
                複数設定可
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">X いいねごとにコマンドを発火します。しきい値ごとに設定できます。</p>
          </div>
          <button
            type="button"
            onClick={() => setLikeEventsD((prev) => [...prev, newLikeEvent()])}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-700 hover:bg-cyan-600 text-white transition shrink-0"
          >
            ＋ ルール追加
          </button>
        </div>

        {likeEvents.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-gray-700 rounded-xl text-gray-500 text-sm">
            「＋ ルール追加」でいいね設定を追加できます
          </div>
        ) : (
          <div className="space-y-3">
            {likeEvents.map((ev, idx) => (
              <div
                key={ev.id}
                className={`border rounded-xl p-4 space-y-4 transition-all ${
                  ev.enabled
                    ? "bg-gray-900/60 border-gray-600"
                    : "bg-gray-900/30 border-gray-700 opacity-70"
                }`}
              >
                {/* ルールヘッダー */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
                      ルール {idx + 1}
                    </span>
                    {ev.label && (
                      <span className="text-xs text-gray-300 font-bold">{ev.label}</span>
                    )}
                    {ev.enabled ? (
                      <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">有効</span>
                    ) : (
                      <span className="text-[9px] font-bold text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">無効</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ToggleSlider
                      checked={ev.enabled}
                      onChange={() => updateLike(ev.id, { enabled: !ev.enabled })}
                    />
                    <button
                      type="button"
                      onClick={() => setLikeEventsD((prev) => prev.filter((e) => e.id !== ev.id))}
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-red-900/20 transition"
                    >
                      削除
                    </button>
                  </div>
                </div>

                {/* フィールド */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-gray-400 mb-1.5 block">発火するいいね数</label>
                    <input
                      type="number"
                      min={1}
                      value={ev.threshold}
                      onChange={(e) => updateLike(ev.id, { threshold: Number(e.target.value) || 1 })}
                      className="w-full bg-gray-900 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                    <div className="text-[10px] text-gray-500 mt-1">
                      {ev.threshold} いいねごとに発火
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 mb-1.5 block">表示ラベル（任意）</label>
                    <input
                      type="text"
                      value={ev.label}
                      onChange={(e) => updateLike(ev.id, { label: e.target.value })}
                      placeholder={`${ev.threshold}いいね`}
                      className="w-full bg-gray-900 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-400 mb-1.5 block">実行イベント</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <CmdFileSelect
                        value={ev.commandFile}
                        onChange={(v) => updateLike(ev.id, { commandFile: v })}
                        commandFiles={commandFiles}
                      />
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={ev.repeat ?? 1}
                      onChange={(e) => updateLike(ev.id, { repeat: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })}
                      className="w-16 shrink-0 bg-gray-900 border border-gray-600 rounded-xl px-2 py-2.5 text-sm text-center text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                    <span className="text-xs text-gray-500 shrink-0">回</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ══ 標準イベント設定（2カラム） ══ */}
      <div>
        <h2 className="text-xs font-black text-gray-400 uppercase tracking-wider mb-3">標準イベント</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SimpleEventCard
            icon="🎁"
            title="未設定ギフト"
            description="ギフト設定でマッピングされていないギフトが投げられたときに発火します。"
            event={unmappedGiftEvent}
            onToggle={() => setUnmappedD({ ...unmappedGiftEvent, enabled: !unmappedGiftEvent.enabled })}
            onCommandChange={(v) => setUnmappedD({ ...unmappedGiftEvent, commandFile: v })}
            onRepeatChange={(v) => setUnmappedD({ ...unmappedGiftEvent, repeat: v })}
            commandFiles={commandFiles}
          />

          <SimpleEventCard
            icon="➕"
            title="フォロー"
            description="フォローされたときにコマンドを発火します。"
            event={followEvent}
            onToggle={() => setFollowD({ ...followEvent, enabled: !followEvent.enabled })}
            onCommandChange={(v) => setFollowD({ ...followEvent, commandFile: v })}
            onRepeatChange={(v) => setFollowD({ ...followEvent, repeat: v })}
            commandFiles={commandFiles}
          />

          <SimpleEventCard
            icon="🔗"
            title="シェア"
            description="シェアされたときにコマンドを発火します。"
            event={shareEvent}
            onToggle={() => setShareD({ ...shareEvent, enabled: !shareEvent.enabled })}
            onCommandChange={(v) => setShareD({ ...shareEvent, commandFile: v })}
            onRepeatChange={(v) => setShareD({ ...shareEvent, repeat: v })}
            commandFiles={commandFiles}
          />

          <SimpleEventCard
            icon="🚶"
            title="訪問"
            description={
              <>
                リスナーが配信に訪問したときに発火します。
                <code className="text-cyan-400 ml-1">{"{ListenerName}"}</code> で訪問者名に置換されます。
              </>
            }
            event={memberEvent}
            onToggle={() => setMemberD({ ...memberEvent, enabled: !memberEvent.enabled })}
            onCommandChange={(v) => setMemberD({ ...memberEvent, commandFile: v })}
            onRepeatChange={(v) => setMemberD({ ...memberEvent, repeat: v })}
            commandFiles={commandFiles}
          />
        </div>
      </div>

      {/* ══ 保存フッター ══ */}
      <div className={`flex items-center justify-between gap-4 rounded-2xl p-5 border transition-all ${
        isDirty
          ? "bg-amber-950/25 border-amber-600/40"
          : "bg-gray-800/40 border-gray-700"
      }`}>
        <div>
          {isDirty ? (
            <p className="text-sm font-bold text-amber-300">⚠ 未保存の変更があります</p>
          ) : (
            <p className="text-sm text-gray-500">保存後は BRIDGE を再起動してください</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`px-8 py-3 rounded-xl font-black text-sm transition-all active:scale-95 shrink-0 ${
            isDirty && !saving
              ? "bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-900/30"
              : !saving
              ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
              : "bg-gray-700 text-gray-500 cursor-not-allowed"
          }`}
        >
          {saving ? "保存中…" : "💾 保存する"}
        </button>
      </div>

    </div>
  );
};

export default EventSettingsPage;
