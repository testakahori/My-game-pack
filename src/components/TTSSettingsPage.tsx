import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TtsEngine = "voicevox" | "aivis";

type TtsSettings = {
  engine: TtsEngine;
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

type Speaker = { id: number; label: string };
type EngineStatus = "checking" | "ok" | "ng";
type VoiceTone = "mint" | "violet" | "rose" | "amber" | "sky";

const DEFAULT: TtsSettings = {
  engine: "voicevox",
  speakerId: 2,
  speedScale: 1.2,
  pitchScale: 0,
  intonationScale: 1,
  volume: 1,
  enabled: true,
  commentEnabled: true,
  giftEnabled: true,
  giftTemplate: "{sender}さんから{gift}が来たよ！",
};

const WAVEFORM = [18, 30, 42, 22, 54, 34, 64, 28, 46, 74, 38, 58, 30, 66, 44, 24, 50, 70, 34, 56, 26, 48, 62, 32, 44, 20, 36, 28, 42, 18, 30, 22, 34, 16];
const EQUALIZER = [10, 18, 28, 16, 38, 52, 28, 62, 44, 72, 36, 56, 76, 48, 64, 34, 54, 70, 42, 58, 30, 48, 28, 40, 22, 32, 18, 26];
const api = (window as any).mygamepack;

function SpeakerWaveIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path className="speaker-wave-icon__speaker" d="M7 20h7l9-8v24l-9-8H7z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path className="speaker-wave-icon__waves" d="M30 17c3.6 4.2 3.6 9.8 0 14M36 11c7 7.4 7 18.6 0 26" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function StatusGlyph({ type }: { type: "voice" | "engine" | "person" | "pulse" }) {
  if (type === "engine") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 9V5M16 27v-4M9 16H5M27 16h-4M11 11 8 8M24 24l-3-3M21 11l3-3M8 24l3-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="16" cy="16" r="6" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="16" cy="16" r="2" fill="currentColor" />
      </svg>
    );
  }
  if (type === "person") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="10" r="4" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <path d="M8 26c.7-6.1 3.2-9.2 8-9.2s7.3 3.1 8 9.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M22.5 9.5h5M25 7v5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "pulse") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M3 17h6l3-8 5 15 4-11 3 4h5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 14h5l6-5v14l-6-5H5zM21 12c2.2 2.4 2.2 5.6 0 8M25 8c4.4 4.5 4.4 11.5 0 16" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AnonymousVoiceIcon({ tone, size = "normal" }: { tone: VoiceTone; size?: "normal" | "small" }) {
  return (
    <span className={`tts-anon-avatar tts-anon-avatar--${tone} ${size === "small" ? "tts-anon-avatar--small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <circle cx="24" cy="15" r="7" fill="currentColor" />
        <path d="M10 40c1.3-10.4 6-15.6 14-15.6S36.7 29.6 38 40" fill="currentColor" />
        <path d="M14 38c2.2-6.8 5.6-10.2 10-10.2S31.8 31.2 34 38" fill="none" stroke="rgba(255,255,255,.72)" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function EngineMark({ engine }: { engine: TtsEngine }) {
  return (
    <span className={`tts-engine-mark tts-engine-mark--${engine}`} aria-hidden="true">
      {engine === "voicevox" ? (
        <svg viewBox="0 0 48 48">
          <path d="M8 27c3-9 7-13 12-13 4 0 5 5 8 5 3 0 4-4 6-4 3 0 5 5 6 12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path d="M10 33h28M14 38h20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="18" cy="25" r="2.5" fill="currentColor" />
          <circle cx="30" cy="25" r="2.5" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 48 48">
          <path d="M8 26h4l2-9 4 18 4-25 4 30 4-22 4 14 3-8h3" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function StatusCard({
  icon,
  label,
  value,
  note,
  tone,
  onClick,
}: {
  icon: "voice" | "engine" | "person" | "pulse";
  label: string;
  value: string;
  note: string;
  tone: "cyan" | "violet" | "green" | "blue";
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={`tts-status-card__icon tts-status-card__icon--${tone}`}><StatusGlyph type={icon} /></span>
      <span className="tts-status-card__copy">
        <small>{label}</small>
        <strong className={`tts-status-card__value tts-status-card__value--${tone}`}>{value}</strong>
        <span>{note}</span>
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className="tts-status-card" onClick={onClick} aria-pressed={value === "有効"}>{content}</button>
  ) : (
    <div className="tts-status-card">{content}</div>
  );
}

function TuningControl({
  kind,
  label,
  value,
  inputValue,
  min,
  max,
  step,
  minLabel,
  midLabel,
  maxLabel,
  onChange,
}: {
  kind: "speed" | "volume" | "pitch" | "intonation";
  label: string;
  value: string;
  inputValue: number;
  min: number;
  max: number;
  step: number;
  minLabel: string;
  midLabel: string;
  maxLabel: string;
  onChange: (value: number) => void;
}) {
  const icons = { speed: "◷", volume: "◖", pitch: "♫", intonation: "〰" };
  const progress = ((inputValue - min) / (max - min)) * 100;
  return (
    <div className="tts-tuning-control">
      <div className="tts-tuning-control__head">
        <span className={`tts-tuning-control__glyph tts-tuning-control__glyph--${kind}`}>{icons[kind]}</span>
        <b>{label}</b>
        <output>{value}</output>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={inputValue}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        style={{ background: `linear-gradient(90deg, #17bfe9 0 ${progress}%, #536072 ${progress}% 100%)` }}
      />
      <div className="tts-tuning-control__scale"><span>{minLabel}</span><span>{midLabel}</span><span>{maxLabel}</span></div>
    </div>
  );
}

function getEngineLabel(engine: TtsEngine) {
  return engine === "voicevox" ? "VOICEVOX" : "AivisSpeech";
}

function pickSpeakerId(engine: TtsEngine, currentId: number, speakers: Speaker[]) {
  if (speakers.some((speaker) => speaker.id === currentId)) return currentId;
  return speakers[0]?.id ?? (engine === "voicevox" ? 3 : currentId);
}

function fmtSec(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getVoiceTone(index: number): VoiceTone {
  const tones: VoiceTone[] = ["mint", "violet", "rose", "amber", "sky"];
  return tones[index % tones.length];
}

const TTSSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<TtsSettings>(DEFAULT);
  const [speakersByEngine, setSpeakersByEngine] = useState<Record<TtsEngine, Speaker[]>>({ voicevox: [], aivis: [] });
  const [engineStatus, setEngineStatus] = useState<EngineStatus>("checking");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [testText, setTestText] = useState("こんにちは！今日は素敵な配信をありがとう！");
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false);
  const [testStats, setTestStats] = useState({ success: 0, total: 0 });
  const [playback, setPlayback] = useState({ current: 0, duration: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceDropdownRef = useRef<HTMLDivElement | null>(null);
  const savedRef = useRef("");
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) setIsDirty(JSON.stringify(settings) !== savedRef.current);
  }, [settings]);

  useEffect(() => {
    if (!voiceDropdownOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!voiceDropdownRef.current?.contains(event.target as Node)) setVoiceDropdownOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVoiceDropdownOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [voiceDropdownOpen]);

  const checkEngine = useCallback(async (engine: TtsEngine) => {
    setEngineStatus("checking");
    try {
      const ok = await api.ttsCheckEngine(engine);
      if (!ok) {
        setSpeakersByEngine((previous) => ({ ...previous, [engine]: [] }));
        setVoiceDropdownOpen(false);
        setEngineStatus("ng");
        return;
      }
      setEngineStatus("ok");
      const list: Speaker[] = await api.ttsGetSpeakers(engine);
      setSpeakersByEngine((previous) => ({ ...previous, [engine]: list }));
      if (list.length > 0) {
        setSettings((previous) => previous.engine !== engine
          ? previous
          : list.some((speaker) => speaker.id === previous.speakerId)
          ? previous
          : { ...previous, speakerId: list[0].id });
      }
    } catch {
      setSpeakersByEngine((previous) => ({ ...previous, [engine]: [] }));
      setEngineStatus("ng");
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    loadedRef.current = false;
    try {
      const nextSettings: TtsSettings = await api.ttsSettingsRead();
      setSettings(nextSettings);
      savedRef.current = JSON.stringify(nextSettings);
      setIsDirty(false);
      await checkEngine(nextSettings.engine);
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

  useEffect(() => {
    load();
  }, [load]);

  const patch = (updates: Partial<TtsSettings>) => {
    setSettings((previous) => ({ ...previous, ...updates }));
  };

  const handleEngineChange = async (engine: TtsEngine) => {
    setSettings((previous) => ({
      ...previous,
      engine,
      speakerId: pickSpeakerId(engine, previous.speakerId, speakersByEngine[engine]),
    }));
    await checkEngine(engine);
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.ttsSettingsWrite(settings);
      savedRef.current = JSON.stringify(settings);
      setIsDirty(false);
      setMsg({ type: "ok", text: "音声設定を保存しました。" });
    } catch (error: any) {
      setMsg({ type: "error", text: `保存エラー: ${error?.message ?? String(error)}` });
    } finally {
      setSaving(false);
    }
  };

  const handleLaunch = async () => {
    const targetEngine = settings.engine;
    setLaunching(true);
    setMsg(null);
    try {
      const result = await api.ttsLaunchEngine(targetEngine);
      if (!result.ok) {
        setMsg({ type: "error", text: result.message });
        return;
      }
      let ready = false;
      for (let index = 0; index < 12; index += 1) {
        if (await api.ttsCheckEngine(targetEngine)) {
          await checkEngine(targetEngine);
          setMsg({ type: "ok", text: result.message ?? `${getEngineLabel(targetEngine)} を起動しました。` });
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!ready) {
        setMsg({ type: "error", text: `${getEngineLabel(targetEngine)} を起動しましたが、まだAPIが応答していません。少し待ってから再読み込みしてください。` });
      }
    } catch (error: any) {
      setMsg({ type: "error", text: `起動エラー: ${error?.message ?? String(error)}` });
    } finally {
      setLaunching(false);
    }
  };

  const handleSyncVoices = async () => {
    setMsg(null);
    await checkEngine(settings.engine);
  };

  const handlePickVoice = (speakerId: number) => {
    patch({ speakerId });
    setVoiceDropdownOpen(false);
  };

  const handleTest = async () => {
    if (engineStatus !== "ok") return;
    const available = speakersByEngine[settings.engine];
    if (available.length > 0 && !available.some((speaker) => speaker.id === settings.speakerId)) {
      setMsg({ type: "error", text: "選択中のボイスが現在のエンジン一覧にありません。ボイスを選び直してください。" });
      return;
    }
    setTesting(true);
    setMsg(null);
    try {
      const result = await api.ttsTest({ ...settings, testText: testText.trim() || undefined });
      if (!result.ok) {
        setTestStats((previous) => ({ success: previous.success, total: previous.total + 1 }));
        setMsg({ type: "error", text: `テスト失敗: ${result.message}` });
        return;
      }
      audioRef.current?.pause();
      const audio = new Audio(`data:audio/wav;base64,${result.base64}`);
      audioRef.current = audio;
      audio.volume = Math.min(1, Math.max(0, settings.volume));
      setPlayback({ current: 0, duration: 0 });
      audio.addEventListener("loadedmetadata", () => setPlayback((p) => ({ ...p, duration: audio.duration || 0 })));
      audio.addEventListener("timeupdate", () => setPlayback((p) => ({ ...p, current: audio.currentTime })));
      audio.addEventListener("ended", () => setPlayback({ current: 0, duration: 0 }));
      await audio.play().catch(() => undefined);
      setTestStats((previous) => ({ success: previous.success + 1, total: previous.total + 1 }));
      setMsg({ type: "ok", text: "テスト音声を再生しました。" });
    } catch (error: any) {
      setTestStats((previous) => ({ success: previous.success, total: previous.total + 1 }));
      setMsg({ type: "error", text: `テスト失敗: ${error?.message ?? String(error)}` });
    } finally {
      setTesting(false);
    }
  };

  const voiceChoices = useMemo(() => {
    const source = speakersByEngine[settings.engine];
    if (source.length === 0) return [];
    return source.some((speaker) => speaker.id === settings.speakerId) ? source : source;
  }, [settings.engine, settings.speakerId, speakersByEngine]);
  const selectedVoice = voiceChoices.find((speaker) => speaker.id === settings.speakerId) ?? voiceChoices[0];
  const engineLabel = getEngineLabel(settings.engine);
  const voicesSynced = voiceChoices.length > 0;

  if (loading) {
    return (
      <div className="tts-loading">
        <span />
        <p>音声設定を読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="tts-page tts-control-page">
      <header className="tts-control-header">
        <div className="tts-control-header__title">
          <SpeakerWaveIcon />
          <div>
            <h1>音声コントロール</h1>
            <p>コメント・ギフトを VOICEVOX / AivisSpeech で読み上げます</p>
          </div>
        </div>
        <div className="tts-control-header__actions">
          {isDirty ? (
            <button type="button" className="tts-save-button" onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : "▣ 保存する"}
            </button>
          ) : null}
          <button type="button" className="tts-reload-button" onClick={load}>↻ 再読み込み</button>
        </div>
      </header>

      <section className="tts-status-grid" aria-label="読み上げ状態">
        <StatusCard
          icon="voice"
          label="読み上げ機能"
          value={settings.enabled ? "有効" : "無効"}
          note={settings.enabled ? "すべての読み上げを行います" : "クリックして有効にします"}
          tone="cyan"
          onClick={() => patch({ enabled: !settings.enabled })}
        />
        <StatusCard
          icon="engine"
          label="エンジン状態"
          value={engineLabel}
          note={engineStatus === "ok" ? "● エンジンは起動中です" : engineStatus === "checking" ? "● 状態を確認しています" : "● エンジンが停止中です"}
          tone="violet"
        />
        <StatusCard
          icon="person"
          label="選択中のボイス"
          value={selectedVoice?.label ?? "未同期"}
          note={voicesSynced ? engineLabel : `${engineLabel} / ボイス一覧を同期してください`}
          tone="green"
        />
        <StatusCard
          icon="pulse"
          label="テスト成功率（このセッション）"
          value={testStats.total === 0 ? "—" : `${Math.round((testStats.success / testStats.total) * 100)}%`}
          note={testStats.total === 0 ? "まだテスト再生していません" : `直近: ${testStats.total}回中${testStats.success}回成功`}
          tone="blue"
        />
      </section>

      {msg ? <div className={`tts-message tts-message--${msg.type}`}>{msg.type === "ok" ? "✓" : "!"} {msg.text}</div> : null}

      <section className="tts-read-target-section">
        <div className="tts-section-heading tts-section-heading--compact">
          <div>
            <h2>読み上げ対象</h2>
            <p>リスナーのコメントとギフト読み上げを個別にオン/オフできます</p>
          </div>
        </div>
        <div className="tts-read-target-grid">
          <button
            type="button"
            className={settings.commentEnabled ? "is-enabled" : ""}
            onClick={() => patch({ commentEnabled: !settings.commentEnabled })}
            aria-pressed={settings.commentEnabled}
          >
            <span>💬</span>
            <b>コメント読み上げ</b>
            <small>{settings.commentEnabled ? "有効：リスナーコメントを読みます" : "無効：コメントは読みません"}</small>
          </button>
          <button
            type="button"
            className={settings.giftEnabled ? "is-enabled" : ""}
            onClick={() => patch({ giftEnabled: !settings.giftEnabled })}
            aria-pressed={settings.giftEnabled}
          >
            <span>🎁</span>
            <b>ギフト読み上げ</b>
            <small>{settings.giftEnabled ? "有効：ギフト通知を読みます" : "無効：ギフト通知は読みません"}</small>
          </button>
        </div>
        <p className="tts-stream-audio-note">
          配信視聴者に聞こえない場合は、TikTok LIVE Studio 側でこのPCのデスクトップ音声/アプリ音声を取り込んでいるか確認してください。
        </p>
      </section>

      <section className="tts-engine-section">
        <div className="tts-section-heading">
          <div><h2>エンジン選択</h2><p>使用する読み上げエンジンを選択してください</p></div>
          <div className="tts-equalizer" aria-hidden="true">
            {EQUALIZER.map((height, index) => <i key={index} style={{ height }} />)}
          </div>
        </div>

        <div className="tts-engine-grid">
          {(["voicevox", "aivis"] as const).map((engine) => {
            const selected = settings.engine === engine;
            return (
              <button
                key={engine}
                type="button"
                className={`tts-engine-card ${selected ? "tts-engine-card--selected" : ""}`}
                onClick={() => handleEngineChange(engine)}
                aria-pressed={selected}
              >
                <EngineMark engine={engine} />
                <span className="tts-engine-card__copy">
                  <strong>{engine === "voicevox" ? "VOICEVOX" : "AivisSpeech"}</strong>
                  <small>{engine === "voicevox" ? "オープンソース高品質読み上げエンジン" : "高品質・自然なAI音声合成エンジン"}</small>
                </span>
                <span className="tts-engine-card__state">{selected ? "選択中" : "未選択"}</span>
                {selected ? <span className="tts-engine-card__check">✓</span> : null}
              </button>
            );
          })}
        </div>

        {engineStatus === "ng" ? (
          <div className="tts-engine-alert">
            <span><b>▲ {engineLabel} が停止しています</b><small>エンジンを起動して読み上げを有効にしてください。</small></span>
            <button type="button" onClick={handleLaunch} disabled={launching}>{launching ? "起動中…" : `▶ ${engineLabel}を起動する`}</button>
          </div>
        ) : null}
      </section>

      <section className="tts-voice-section">
        <div className="tts-section-heading tts-section-heading--compact">
          <div><h2>ボイス選択</h2><p>{voicesSynced ? `${engineLabel}で実際に使えるボイス一覧です` : `${engineLabel}を起動して、ボイス一覧を同期してください`}</p></div>
        </div>
        <div className="tts-voice-picker tts-voice-picker--select-only">
          <div
            className={`tts-voice-select tts-voice-combobox ${voiceDropdownOpen ? "tts-voice-combobox--open" : ""}`}
            ref={voiceDropdownRef}
          >
            <button
              type="button"
              className="tts-voice-trigger"
              onClick={() => voicesSynced && setVoiceDropdownOpen((open) => !open)}
              disabled={!voicesSynced}
              aria-haspopup="listbox"
              aria-expanded={voiceDropdownOpen}
            >
              <AnonymousVoiceIcon tone="mint" size="small" />
              <span className="tts-voice-trigger__label">
                {selectedVoice?.label ?? "エンジンを起動して同期してください"}
              </span>
              <span className="tts-voice-trigger__arrow" aria-hidden="true">⌄</span>
            </button>
            {voiceDropdownOpen ? (
              <div className="tts-voice-menu" role="listbox" aria-label={`${engineLabel}で使用可能なモデル一覧`}>
                {voiceChoices.map((speaker, index) => {
                  const selected = speaker.id === settings.speakerId;
                  return (
                    <button
                      type="button"
                      key={speaker.id}
                      className={`tts-voice-menu__item ${selected ? "tts-voice-menu__item--selected" : ""}`}
                      onClick={() => handlePickVoice(speaker.id)}
                      role="option"
                      aria-selected={selected}
                    >
                      <AnonymousVoiceIcon tone={getVoiceTone(index)} size="small" />
                      <span>
                        <b>{speaker.label}</b>
                        <small>style ID: {speaker.id}</small>
                      </span>
                      {selected ? <i aria-hidden="true">✓</i> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button type="button" className="tts-voice-sync" onClick={handleSyncVoices} disabled={engineStatus === "checking" || launching}>
            ↻ ボイス一覧を同期
          </button>
        </div>
      </section>

      <section className="tts-tuning-section">
        <div className="tts-section-heading tts-section-heading--compact">
          <div><h2>音声チューニング</h2><p>読み上げの音声を細かく調整できます</p></div>
        </div>
        <div className="tts-tuning-grid">
          <TuningControl kind="speed" label="速度" value={settings.speedScale.toFixed(2)} inputValue={settings.speedScale} min={0.5} max={2} step={0.05} minLabel="0.5" midLabel="1.0" maxLabel="2.0" onChange={(speedScale) => patch({ speedScale })} />
          <TuningControl kind="volume" label="音量" value={`${Math.round(settings.volume * 100)}%`} inputValue={settings.volume} min={0} max={2} step={0.05} minLabel="0%" midLabel="100%" maxLabel="200%" onChange={(volume) => patch({ volume })} />
          <TuningControl kind="pitch" label="ピッチ（高低）" value={`${settings.pitchScale >= 0 ? "+" : ""}${settings.pitchScale.toFixed(2)}`} inputValue={settings.pitchScale} min={-0.15} max={0.15} step={0.01} minLabel="-0.15" midLabel="0" maxLabel="+0.15" onChange={(pitchScale) => patch({ pitchScale })} />
          <TuningControl kind="intonation" label="抑揚（イントネーション）" value={settings.intonationScale.toFixed(2)} inputValue={settings.intonationScale} min={0} max={2} step={0.1} minLabel="0.5" midLabel="1.0" maxLabel="2.0" onChange={(intonationScale) => patch({ intonationScale })} />
        </div>
      </section>

      <section className="tts-test-section">
        <div className="tts-section-heading tts-section-heading--compact">
          <div><h2>テスト再生</h2><p>テキストを入力して読み上げをテストします</p></div>
        </div>
        <div className="tts-test-layout">
          <div className="tts-test-copy">
            <input value={testText} onChange={(event) => setTestText(event.target.value)} aria-label="読み上げるテキスト" />
            <div className="tts-test-presets">
              {["こんにちは！", "ありがとう！", "ナイスギフト！", "初見です！", "がんばって！"].map((text) => (
                <button type="button" key={text} onClick={() => setTestText(text)}>{text}</button>
              ))}
            </div>
          </div>
          <div className={`tts-waveform${testing || playback.duration > 0 ? " tts-waveform--active" : ""}`} aria-hidden="true">
            {WAVEFORM.map((height, index) => <i key={index} style={{ height }} />)}
            <small>{fmtSec(playback.current)} / {fmtSec(playback.duration)}</small>
          </div>
          <button type="button" className="tts-play-button" onClick={handleTest} disabled={engineStatus !== "ok" || !voicesSynced || testing}>
            <SpeakerWaveIcon />
            <span>{testing ? "再生中…" : "テスト再生"}</span>
          </button>
        </div>
      </section>
    </div>
  );
};

export default TTSSettingsPage;
