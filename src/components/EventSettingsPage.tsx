// src/components/EventSettingsPage.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ToggleSlider } from "./ToggleSlider";
import EventTypeIcon, { type EventIconKind } from "./EventTypeIcon";

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
    <div className="event-command-select flex items-center gap-2">
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
  tone,
  title,
  description,
  event,
  onToggle,
  onCommandChange,
  onRepeatChange,
  commandFiles,
  children,
}: {
  icon: React.ReactNode;
  tone: "amber" | "purple" | "blue" | "green";
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
    <div className={`event-simple-card event-simple-card--${tone} border rounded-2xl p-5 space-y-4 transition-all ${
      event.enabled
        ? "bg-gray-800 border-gray-700"
        : "bg-gray-900/40 border-gray-800"
    }`}>
      {/* ヘッダー */}
      <div className="event-simple-card__head flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="event-simple-card__icon text-2xl shrink-0 mt-0.5">{icon}</span>
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
      <div className="event-simple-card__controls">
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
  const [unmappedGiftEvent, setUnmappedGiftEvent] = useState<SimpleEvent>({ commandFile: "", repeat: 1, enabled: false });
  const [shareEvent, setShareEvent]               = useState<SimpleEvent>({ commandFile: "", repeat: 1, enabled: false });
  const [followEvent, setFollowEvent]             = useState<SimpleEvent>({ commandFile: "", repeat: 1, enabled: false });
  const [memberEvent, setMemberEvent]             = useState<SimpleEvent>({ commandFile: "", repeat: 1, enabled: false });
  const [commandFiles, setCommandFiles]           = useState<CommandFile[]>([]);
  const [loading, setLoading]                     = useState(true);
  const [saving, setSaving]                       = useState(false);
  const [msg, setMsg]                             = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [isDirty, setIsDirty]                     = useState(false);

  const snapshot = useRef<string>("");

  // 親（App.tsx）が onDirtyChange を安定した参照で渡すとは限らない（実際、ヘッダーのポーリングで
  // 数秒おきに新しい関数が渡された結果、load()が再実行されて未保存の編集がディスクの内容で
  // 上書きされる事故があった）。親の実装に依存せず安全に動くよう、常に最新の関数をrefで呼び出す。
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => { onDirtyChangeRef.current = onDirtyChange; }, [onDirtyChange]);

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
      onDirtyChangeRef.current?.(dirty);
    },
    []
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
      onDirtyChangeRef.current?.(false);
    } catch (e: any) {
      setMsg({ type: "error", text: `読み込みエラー: ${e?.message ?? String(e)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  // マウント時に一度だけ読み込む（load自体は安定した参照なので依存配列は空でよい）
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
    <div className="events-page page-surface max-w-none space-y-5">

      {/* ══ ヘッダー + アクション ══ */}
      <div className="events-header flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-white">イベント設定</h1>
          <p className="text-gray-400 text-sm mt-1">
            いいね・シェア・訪問 でコマンドを発火します。
            <code className="text-cyan-400 text-xs ml-1">config.minecraft.json</code> に保存されます。
          </p>
        </div>
        <div className="events-header__actions flex items-center gap-2 shrink-0">
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
      <div className="events-summary bg-gray-800 border border-gray-700 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">イベント設定サマリー</h2>
          <span className="text-xs text-gray-500">
            <span className="text-cyan-300 font-bold">{enabledCount}</span> / 5 有効
          </span>
        </div>
        <div className="events-summary-grid flex flex-wrap gap-2">
          {[
            { kind: "like", label: "いいね", enabled: likeEvents.some((e) => e.enabled), value: likeEvents.length, unit: "ルール", tone: "pink" },
            { kind: "gift", label: "未設定ギフト", enabled: unmappedGiftEvent.enabled, value: unmappedGiftEvent.enabled ? 1 : 0, unit: "イベント", tone: "amber" },
            { kind: "follow", label: "フォロー", enabled: followEvent.enabled, value: followEvent.enabled ? 1 : 0, unit: "イベント", tone: "purple" },
            { kind: "share", label: "シェア", enabled: shareEvent.enabled, value: shareEvent.enabled ? 1 : 0, unit: "イベント", tone: "blue" },
            { kind: "visit", label: "訪問", enabled: memberEvent.enabled, value: memberEvent.enabled ? 1 : 0, unit: "イベント", tone: "green" },
          ].map((item) => (
            <div
              key={item.label}
              className={`events-summary-card events-summary-card--${item.tone} ${item.enabled ? "is-enabled" : "is-disabled"}`}
            >
              <span><EventTypeIcon kind={item.kind as EventIconKind} /></span>
              <div><b>{item.label}</b><strong>{item.value} <small>{item.unit}</small></strong><em>{item.enabled ? "有効" : "無効"}</em></div>
            </div>
          ))}
        </div>
      </div>

      {/* ══ いいね設定（特別扱い） ══ */}
      <section className="events-like-panel bg-gray-800 border border-gray-700 rounded-2xl p-5 space-y-4">
        <div className="events-like-heading flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="events-like-icon">♥</span>
              <h2 className="text-base font-black text-white">いいね設定 <small>（しきい値ラダー）</small></h2>
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
          <div className="events-like-table">
            <div className="events-like-columns" aria-hidden="true">
              <span>しきい値（累計いいね数）</span>
              <span>実行コマンド（Minecraft）</span>
              <span>繰り返し（回数）</span>
              <span>ステータス</span>
              <span>操作</span>
            </div>
            {likeEvents.map((ev, idx) => (
              <div
                key={ev.id}
                className={`events-like-row ${ev.enabled ? "is-enabled" : "is-disabled"}`}
              >
                <div className="events-like-threshold">
                  <i>{idx + 1}</i>
                  <input
                    type="number"
                    min={1}
                    value={ev.threshold}
                    aria-label={`ルール${idx + 1}のしきい値`}
                    onChange={(e) => updateLike(ev.id, { threshold: Number(e.target.value) || 1 })}
                  />
                  <span>いいね</span>
                </div>

                <span className="events-like-arrow" aria-hidden="true">→</span>

                <CmdFileSelect
                  value={ev.commandFile}
                  onChange={(v) => updateLike(ev.id, { commandFile: v })}
                  commandFiles={commandFiles}
                />

                <div className="events-like-repeat">
                  <button type="button" onClick={() => updateLike(ev.id, { repeat: Math.max(1, (ev.repeat ?? 1) - 1) })}>−</button>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={ev.repeat ?? 1}
                    aria-label={`ルール${idx + 1}の繰り返し回数`}
                    onChange={(e) => updateLike(ev.id, { repeat: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })}
                  />
                  <button type="button" onClick={() => updateLike(ev.id, { repeat: Math.min(100, (ev.repeat ?? 1) + 1) })}>＋</button>
                </div>

                <div className="events-like-status">
                  <ToggleSlider checked={ev.enabled} onChange={() => updateLike(ev.id, { enabled: !ev.enabled })} />
                  <span>{ev.enabled ? "有効" : "無効"}</span>
                </div>

                <div className="events-like-actions">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => setLikeEventsD((prev) => {
                      const next = [...prev];
                      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                      return next;
                    })}
                    aria-label={`ルール${idx + 1}を上へ`}
                  >↑</button>
                  <button
                    type="button"
                    disabled={idx === likeEvents.length - 1}
                    onClick={() => setLikeEventsD((prev) => {
                      const next = [...prev];
                      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                      return next;
                    })}
                    aria-label={`ルール${idx + 1}を下へ`}
                  >↓</button>
                  <button
                    type="button"
                    onClick={() => setLikeEventsD((prev) => prev.filter((e) => e.id !== ev.id))}
                    aria-label={`ルール${idx + 1}を削除`}
                  >⌫</button>
                </div>

                <input
                  type="text"
                  value={ev.label}
                  onChange={(e) => updateLike(ev.id, { label: e.target.value })}
                  className="events-like-label"
                  aria-label={`ルール${idx + 1}の表示ラベル`}
                  placeholder={`${ev.threshold}いいね`}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ══ 標準イベント設定（2カラム） ══ */}
      <div className="events-standard">
        <h2 className="text-xs font-black text-gray-400 uppercase tracking-wider mb-3">標準イベント</h2>
        <div className="events-standard-grid grid grid-cols-1 md:grid-cols-2 gap-4">
          <SimpleEventCard
            icon={<EventTypeIcon kind="gift" />}
            tone="amber"
            title="未設定ギフト"
            description="ギフト設定でマッピングされていないギフトが投げられたときに発火します。"
            event={unmappedGiftEvent}
            onToggle={() => setUnmappedD({ ...unmappedGiftEvent, enabled: !unmappedGiftEvent.enabled })}
            onCommandChange={(v) => setUnmappedD({ ...unmappedGiftEvent, commandFile: v })}
            onRepeatChange={(v) => setUnmappedD({ ...unmappedGiftEvent, repeat: v })}
            commandFiles={commandFiles}
          />

          <SimpleEventCard
            icon={<EventTypeIcon kind="follow" />}
            tone="purple"
            title="フォロー"
            description="フォローされたときにコマンドを発火します。"
            event={followEvent}
            onToggle={() => setFollowD({ ...followEvent, enabled: !followEvent.enabled })}
            onCommandChange={(v) => setFollowD({ ...followEvent, commandFile: v })}
            onRepeatChange={(v) => setFollowD({ ...followEvent, repeat: v })}
            commandFiles={commandFiles}
          />

          <SimpleEventCard
            icon={<EventTypeIcon kind="share" />}
            tone="blue"
            title="シェア"
            description="シェアされたときにコマンドを発火します。"
            event={shareEvent}
            onToggle={() => setShareD({ ...shareEvent, enabled: !shareEvent.enabled })}
            onCommandChange={(v) => setShareD({ ...shareEvent, commandFile: v })}
            onRepeatChange={(v) => setShareD({ ...shareEvent, repeat: v })}
            commandFiles={commandFiles}
          />

          <SimpleEventCard
            icon={<EventTypeIcon kind="visit" />}
            tone="green"
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
      <div className={`events-footer flex items-center justify-between gap-4 rounded-2xl p-5 border transition-all ${
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
