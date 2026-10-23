"use strict";

// 読み上げ（VOICEVOX・AivisSpeech）の設定の決まり（処理のコピー PR9）。既定値・範囲・エンジンのポートは tts_settings.json の1か所で、
// BRIDGE（bridge/index.js）・アプリ（electron/tts_ipc.cjs・tts.cjs）が使い、画面（TTSSettingsPage.tsx）と開発用（vite.config.ts・devApiMock.ts）は JSON を読む。
const TTS_SETTINGS = deepFreeze(require("./tts_settings.json"));

function deepFreeze(value) {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clamp(value, [min, max], fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

// 保存する・使う前に整える。範囲の外は端に寄せ、数でなければ既定。
function normalizeTtsSettings(settings) {
  const defaults = TTS_SETTINGS.defaults, ranges = TTS_SETTINGS.ranges;
  const value = { ...defaults, ...(settings && typeof settings === "object" ? settings : {}) };
  return {
    engine: value.engine === "aivis" ? "aivis" : "voicevox",
    speakerId: Math.trunc(clamp(value.speakerId, [0, Number.MAX_SAFE_INTEGER], defaults.speakerId)),
    speedScale: clamp(value.speedScale, ranges.speedScale, defaults.speedScale),
    pitchScale: clamp(value.pitchScale, ranges.pitchScale, defaults.pitchScale),
    intonationScale: clamp(value.intonationScale, ranges.intonationScale, defaults.intonationScale),
    volume: clamp(value.volume, ranges.volume, defaults.volume),
    enabled: value.enabled !== false,
    commentEnabled: value.commentEnabled !== false,
    giftEnabled: value.giftEnabled !== false,
    giftTemplate: String(value.giftTemplate || defaults.giftTemplate).slice(0, TTS_SETTINGS.giftTemplateMax),
  };
}

// エンジンの audio_query の結果に声の設定を入れる。本番（BRIDGE）と読み上げのテスト（アプリ）が同じ入れ方をする
// （前のテストは音量を入れず、100〜200% が同じ大きさで鳴った）。settings は normalizeTtsSettings を通したもの。
function applyVoiceSettings(query, settings) {
  return Object.assign(query, {
    speedScale: settings.speedScale,
    pitchScale: settings.pitchScale,
    intonationScale: settings.intonationScale,
    volumeScale: settings.volume,
  });
}

module.exports = { TTS_SETTINGS, TTS_PORTS: TTS_SETTINGS.ports, normalizeTtsSettings, applyVoiceSettings };
