// src/components/TTSSettingsPage.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ToggleSlider } from "./ToggleSlider";

type TtsSettings = {
  engine: "voicevox" | "aivis";
  speakerId: number;
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volume: number;
  enabled: boolean;
  commentEnabled: boolean;
  giftEnabled: boolean;
  giftTemplate: string;
};

const DEFAULT: TtsSettings = {
  engine: "voicevox",
  speakerId: 2,
  speedScale: 1.2,
  pitchScale: 0.0,
  intonationScale: 1.0,
  volume: 1.0,
  enabled: true,
  commentEnabled: true,
  giftEnabled: true,
  giftTemplate: "{sender}さんから{gift}が来たよ！",
};

const api = (window as any).mygamepack;

type Speaker = { id: number; label: string };
type EngineStatus = "checking" | "ok" | "ng";

// ── 音声チューニングスライダー ──────────────────────────
function TuningSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-gray-300">{label}</span>
        <span className="text-sm font-mono text-cyan-400 bg-cyan-950/50 px-2.5 py-0.5 rounded-lg border border-cyan-800/40 min-w-[52px] text-center">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan-500 h-1.5 cursor-pointer"
      />
      {hint && <p className="text-[10px] text-gray-600">{hint}</p>}
    </div>
  );
}

// ── メインコンポーネント ───────────────────────────────
const TTSSettingsPage: React.FC = () => {
  const [settings, setSettings]       = useState<TtsSettings>(DEFAULT);
  const [speakers, setSpeakers]       = useState<Speaker[]>([]);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("checking");
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [testing, setTesting]         = useState(false);
  const [launching, setLaunching]     = useState(false);
  const [isDirty, setIsDirty]         = useState(false);
  const [msg, setMsg]                 = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [testText, setTestText]       = useState("こんにちは！読み上げテストです。");

  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const savedRef   = useRef<string>("");
  const loadedRef  = useRef(false);

  // settings 変更で dirty 判定
  useEffect(() => {
    if (!loadedRef.current) return;
    setIsDirty(JSON.stringify(settings) !== savedRef.current);
  }, [settings]);

  // ── エンジン確認 ──
  const checkEngine = useCallback(async (engine: "voicevox" | "aivis") => {
    setEngineStatus("checking");
    setSpeakers([]);
    try {
      const ok = await api.ttsCheckEngine(engine);
      if (!ok) { setEngineStatus("ng"); return; }
      setEngineStatus("ok");
      const list: Speaker[] = await api.ttsGetSpeakers(engine);
      setSpeakers(list);
      if (list.length > 0) {
        setSettings((prev) => {
          const exists = list.some((s) => s.id === prev.speakerId);
          return exists ? prev : { ...prev, speakerId: list[0].id };
        });
      }
    } catch {
      setEngineStatus("ng");
    }
  }, []);

  // ── 読み込み ──
  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    loadedRef.current = false;
    try {
      const s: TtsSettings = await api.ttsSettingsRead();
      setSettings(s);
      savedRef.current = JSON.stringify(s);
      setIsDirty(false);
      await checkEngine(s.engine);
    } catch {
      setSettings(DEFAULT);
      savedRef.current = JSON.stringify(DEFAULT);
      setIsDirty(false);
      await checkEngine(DEFAULT.engine);
    } finally {
      loadedRef.current = true;
      setLoading(false);
    }
  }, [checkEngine]);

  useEffect(() => { load(); }, [load]);

  // ── エンジン切り替え ──
  const handleEngineChange = async (engine: "voicevox" | "aivis") => {
    setSettings((s) => ({ ...s, engine, speakerId: 0 }));
    await checkEngine(engine);
  };

  const patch = (updates: Partial<TtsSettings>) => {
    setSettings((s) => ({ ...s, ...updates }));
  };

  // ── 保存 ──
  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.ttsSettingsWrite(settings);
      savedRef.current = JSON.stringify(settings);
      setIsDirty(false);
      setMsg({ type: "ok", text: "保存しました。次回 BRIDGE 起動から有効になります。" });
      setTimeout(() => setMsg(null), 4000);
    } catch (e: any) {
      setMsg({ type: "error", text: `保存エラー: ${e?.message ?? String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  // ── テスト再生 ──
  const handleTest = async () => {
    if (engineStatus !== "ok") return;
    setTesting(true);
    try {
      const result = await api.ttsTest({
        ...settings,
        testText: testText.trim() || undefined,
      });
      if (!result.ok) {
        setMsg({ type: "error", text: `テスト失敗: ${result.message}` });
        return;
      }
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(`data:audio/wav;base64,${result.base64}`);
      audioRef.current = audio;
      audio.volume = Math.min(1, Math.max(0, settings.volume));
      audio.play().catch(() => {});
    } catch (e: any) {
      setMsg({ type: "error", text: `テスト失敗: ${e?.message ?? String(e)}` });
    } finally {
      setTesting(false);
    }
  };

  // ── エンジン起動 ──
  const handleLaunch = async () => {
    setLaunching(true);
    try {
      const result = await api.ttsLaunchEngine(settings.engine);
      if (!result.ok) {
        setMsg({ type: "error", text: result.message });
        return;
      }
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const ok = await api.ttsCheckEngine(settings.engine);
        if (ok) { await checkEngine(settings.engine); break; }
      }
    } catch (e: any) {
      setMsg({ type: "error", text: `起動エラー: ${e?.message ?? String(e)}` });
    } finally {
      setLaunching(false);
    }
  };

  const currentSpeakerLabel = speakers.find((s) => s.id === settings.speakerId)?.label ?? "—";
  const engineLabel = settings.engine === "voicevox" ? "VOICEVOX" : "AivisSpeech";

  // ── ローディング ──
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

      {/* ══ ヘッダー ══ */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">🔊 音声コントロール</h1>
          <p className="text-gray-400 text-sm mt-1">
            コメント・ギフトを VOICEVOX / AivisSpeech で読み上げます
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-500 transition shrink-0"
        >
          🔄 再読込
        </button>
      </div>

      {/* ══ ステータスサマリー ══ */}
      <div className="grid grid-cols-3 gap-3">
        {/* 読み上げ状態 */}
        <div className={`rounded-2xl p-4 border transition-all ${
          settings.enabled
            ? "bg-emerald-950/40 border-emerald-700/40"
            : "bg-gray-800/60 border-gray-700"
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full shrink-0 ${settings.enabled ? "bg-emerald-400" : "bg-gray-600"}`} />
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">読み上げ</span>
          </div>
          <div className={`text-sm font-bold ${settings.enabled ? "text-emerald-300" : "text-gray-500"}`}>
            {settings.enabled ? "有効" : "無効"}
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5">
            {settings.commentEnabled && settings.enabled && "コメント "}
            {settings.giftEnabled && settings.enabled && "ギフト"}
          </div>
        </div>

        {/* エンジン */}
        <div className={`rounded-2xl p-4 border transition-all ${
          engineStatus === "ok"
            ? "bg-cyan-950/40 border-cyan-700/40"
            : "bg-gray-800/60 border-gray-700"
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full shrink-0 ${
              engineStatus === "ok" ? "bg-cyan-400" : engineStatus === "checking" ? "bg-amber-400 animate-pulse" : "bg-red-400"
            }`} />
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">エンジン</span>
          </div>
          <div className={`text-sm font-bold truncate ${engineStatus === "ok" ? "text-cyan-300" : "text-gray-400"}`}>
            {engineLabel}
          </div>
          <div className={`text-[10px] mt-0.5 ${
            engineStatus === "ok" ? "text-emerald-400" : engineStatus === "checking" ? "text-amber-400" : "text-red-400"
          }`}>
            {engineStatus === "ok" ? "起動中" : engineStatus === "checking" ? "確認中…" : "停止中"}
          </div>
        </div>

        {/* 使用ボイス */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">ボイス</span>
          </div>
          <div className="text-sm font-bold text-gray-200 truncate">{currentSpeakerLabel}</div>
          <div className="text-[10px] text-gray-600 mt-0.5">使用中</div>
        </div>
      </div>

      {/* メッセージ（toast） */}
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ${
          msg.type === "ok"
            ? "bg-emerald-900/50 border border-emerald-500/30 text-emerald-300"
            : "bg-red-900/50 border border-red-500/30 text-red-300"
        }`}>
          {msg.type === "ok" ? "✅" : "❌"} {msg.text}
        </div>
      )}

      {/* ══ 読み上げ ON/OFF（主役） ══ */}
      <section className={`border rounded-2xl p-5 transition-all ${
        settings.enabled
          ? "bg-emerald-950/25 border-emerald-600/40"
          : "bg-gray-800 border-gray-700"
      }`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-white">読み上げ機能</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {settings.enabled
                ? "BRIDGE 起動中にコメント・ギフトを読み上げます"
                : "オフ：すべての読み上げを停止します"}
            </p>
          </div>
          <div className="flex flex-col items-center gap-1 shrink-0">
            <ToggleSlider
              checked={settings.enabled}
              onChange={() => patch({ enabled: !settings.enabled })}
            />
          </div>
        </div>
      </section>

      {/* ══ エンジン選択カード ══ */}
      <section className="bg-gray-800 border border-gray-700 rounded-2xl p-5 space-y-4">
        <h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">エンジン選択</h2>

        <div className="grid grid-cols-2 gap-3">
          {(["voicevox", "aivis"] as const).map((eng) => {
            const isSelected = settings.engine === eng;
            const label = eng === "voicevox" ? "VOICEVOX" : "AivisSpeech";
            const isActive  = isSelected && engineStatus === "ok";
            const isStopped = isSelected && engineStatus === "ng";
            const isChecking = isSelected && engineStatus === "checking";

            return (
              <button
                key={eng}
                type="button"
                onClick={() => handleEngineChange(eng)}
                className={`relative text-left p-4 rounded-xl border transition-all ${
                  isSelected
                    ? "bg-cyan-900/30 border-cyan-500/50 ring-1 ring-cyan-500/20"
                    : "bg-gray-900/40 border-gray-700 hover:border-gray-500"
                }`}
              >
                {isSelected && (
                  <div className="absolute top-2.5 right-2.5 text-[9px] font-black text-cyan-400 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-700/50">
                    使用中
                  </div>
                )}
                <div className="flex items-center gap-2 mb-2 pr-10">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    isActive ? "bg-emerald-400" : isStopped ? "bg-red-400" : isChecking ? "bg-amber-400 animate-pulse" : "bg-gray-600"
                  }`} />
                  <span className={`font-black text-base ${isSelected ? "text-white" : "text-gray-500"}`}>
                    {label}
                  </span>
                </div>
                <div className={`text-[11px] ${
                  isActive ? "text-emerald-400" : isStopped ? "text-red-400" : isChecking ? "text-amber-400" : "text-gray-500"
                }`}>
                  {isSelected
                    ? (isActive ? "✓ 起動中" : isChecking ? "確認中…" : "✕ 停止中")
                    : "クリックで切り替え"}
                </div>
              </button>
            );
          })}
        </div>

        {/* 停止中バナー + 起動ボタン */}
        {engineStatus === "ng" && (
          <div className="flex items-center gap-3 bg-red-950/30 border border-red-700/30 rounded-xl px-4 py-3">
            <span className="text-sm text-red-300 flex-1">
              {engineLabel} が起動していません
            </span>
            <button
              type="button"
              onClick={handleLaunch}
              disabled={launching}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-cyan-700 hover:bg-cyan-600 text-white transition disabled:opacity-50 shrink-0"
            >
              {launching ? "起動中…" : "▶ 起動する"}
            </button>
          </div>
        )}

        {/* 声（スピーカー）選択 */}
        <div>
          <label className="text-xs font-bold text-gray-400 mb-2 block">使用する声</label>
          <select
            value={settings.speakerId}
            onChange={(e) => patch({ speakerId: Number(e.target.value) })}
            disabled={engineStatus !== "ok"}
            className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-50"
          >
            {speakers.length === 0 && (
              <option value={0}>
                {engineStatus === "ok" ? "（スピーカーなし）" : "エンジンを起動してください"}
              </option>
            )}
            {speakers.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </section>

      {/* ══ 音声チューニング ══ */}
      <section className="bg-gray-800 border border-gray-700 rounded-2xl p-5 space-y-5">
        <h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">音声チューニング</h2>

        <TuningSlider
          label="速さ"
          value={settings.speedScale}
          min={0.5} max={2.0} step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => patch({ speedScale: v })}
          hint="0.5（遅い）〜 2.0（速い）"
        />
        <TuningSlider
          label="音量"
          value={settings.volume}
          min={0} max={1} step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => patch({ volume: v })}
        />
        <TuningSlider
          label="声の高さ"
          value={settings.pitchScale}
          min={-0.15} max={0.15} step={0.01}
          format={(v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2))}
          onChange={(v) => patch({ pitchScale: v })}
          hint="-0.15（低い）〜 +0.15（高い）"
        />
        <TuningSlider
          label="抑揚"
          value={settings.intonationScale}
          min={0} max={2} step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => patch({ intonationScale: v })}
        />
      </section>

      {/* ══ テスト再生（主役） ══ */}
      <section className="bg-gray-800 border border-gray-700 rounded-2xl p-5 space-y-4">
        <h2 className="text-xs font-black text-gray-400 uppercase tracking-wider">テスト再生</h2>

        <div>
          <label className="text-xs font-bold text-gray-400 mb-2 block">読み上げるテキスト</label>
          <input
            type="text"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="こんにちは！読み上げテストです。"
            className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
        </div>

        <button
          type="button"
          onClick={handleTest}
          disabled={engineStatus !== "ok" || testing}
          className={`w-full py-4 rounded-xl font-black text-base transition-all active:scale-[0.98] ${
            engineStatus === "ok" && !testing
              ? "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-900/30"
              : "bg-gray-700 text-gray-500 cursor-not-allowed"
          }`}
        >
          {testing ? (
            <span className="flex items-center justify-center gap-3">
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" />
              再生中…
            </span>
          ) : (
            "🔊 テスト再生"
          )}
        </button>

        {engineStatus === "ng" && (
          <p className="text-xs text-red-400 text-center">エンジンを起動してからテストできます</p>
        )}
      </section>

      {/* ══ コメント / ギフト読み上げ ══ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* コメント */}
        <section className={`border rounded-2xl p-5 space-y-3 transition-all ${
          settings.commentEnabled ? "bg-gray-800 border-gray-700" : "bg-gray-900/40 border-gray-800"
        }`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl shrink-0">💬</span>
              <div className="min-w-0">
                <h2 className="text-sm font-black text-white leading-tight">コメント読み上げ</h2>
                {settings.commentEnabled && (
                  <span className="text-[9px] font-bold text-emerald-400">有効</span>
                )}
              </div>
            </div>
            <ToggleSlider
              checked={settings.commentEnabled}
              onChange={() => patch({ commentEnabled: !settings.commentEnabled })}
            />
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            TikTokコメントを自動で読み上げます。NGワード設定は BRIDGE 側の設定に従います。
          </p>
        </section>

        {/* ギフト */}
        <section className={`border rounded-2xl p-5 space-y-3 transition-all ${
          settings.giftEnabled ? "bg-gray-800 border-gray-700" : "bg-gray-900/40 border-gray-800"
        }`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl shrink-0">🎁</span>
              <div className="min-w-0">
                <h2 className="text-sm font-black text-white leading-tight">ギフト読み上げ</h2>
                {settings.giftEnabled && (
                  <span className="text-[9px] font-bold text-emerald-400">有効</span>
                )}
              </div>
            </div>
            <ToggleSlider
              checked={settings.giftEnabled}
              onChange={() => patch({ giftEnabled: !settings.giftEnabled })}
            />
          </div>
          <p className="text-xs text-gray-400">ギフト受け取り時にコマンド発火と同時に読み上げます。</p>
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">
              読み上げテキスト
              <span className="ml-2">
                <code className="text-cyan-400">{"{sender}"}</code>
                <span className="text-gray-600"> 投げた人・</span>
                <code className="text-cyan-400">{"{gift}"}</code>
                <span className="text-gray-600"> ギフト名</span>
              </span>
            </label>
            <input
              type="text"
              value={settings.giftTemplate}
              onChange={(e) => patch({ giftTemplate: e.target.value })}
              className="w-full bg-gray-900 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            />
          </div>
        </section>
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

export default TTSSettingsPage;
