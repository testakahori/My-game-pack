// src/components/ExportView.tsx
import React, { useEffect, useMemo, useState } from "react";
import type { GiftMapping } from "../types";

type BridgeConfig = {
  tiktokUsername: string;
  rcon: { host: string; port: number; password: string };
  options: {
    giftCooldownMs: number;
    maxCommandsPerGift: number;
    logUnknownGifts: boolean;
    commandsDir: string; // ✅ bridge側と合わせて入れておく（既存互換）
  };
  // ✅ 今のBridge(index.js)が読む形式：commandFile + repeat
  mappings: { giftId: string; name: string; commandFile: string; repeat: number }[];
};

const NEXT_MODAL_SUPPRESS_KEY = "mc_bridge_suppress_next_modal_v1";
const LS_EXPORT_SETTINGS = "mc_bridge_export_settings_v2";

function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getSuppressFlag(): boolean {
  try {
    return localStorage.getItem(NEXT_MODAL_SUPPRESS_KEY) === "1";
  } catch {
    return false;
  }
}

function setSuppressFlag(v: boolean) {
  try {
    localStorage.setItem(NEXT_MODAL_SUPPRESS_KEY, v ? "1" : "0");
  } catch {
    // ignore
  }
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as T;
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

type NextModalProps = {
  open: boolean;
  onClose: () => void;
  suppress: boolean;
  onChangeSuppress: (v: boolean) => void;
  onRedownload: () => void;
};

function NextStepsModal({
  open,
  onClose,
  suppress,
  onChangeSuppress,
  onRedownload,
}: NextModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-xl rounded-3xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-gray-800 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="bg-cyan-500/15 text-cyan-300 w-10 h-10 rounded-2xl flex items-center justify-center border border-cyan-500/25">
              <i className="fas fa-check" />
            </div>
            <div>
              <div className="text-lg font-black">config.json をダウンロードしました</div>
              <div className="text-sm text-gray-400 mt-1">次にやること（これだけ）</div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors p-2 -m-2"
            aria-label="close"
            type="button"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-gray-800/40 border border-gray-700 rounded-2xl p-4">
            <ol className="list-decimal list-inside text-sm text-gray-200 space-y-2">
              <li>
                DLした <b className="text-cyan-300">config.json</b> を
                <br />
                <code className="text-cyan-300">bridge\config.json</code> に{" "}
                <b className="text-cyan-300">上書き</b>
              </li>
              <li>
                <code className="text-cyan-300">bridge\bridge起動.bat</code>{" "}
                （または start_bridge.bat）をダブルクリック
              </li>
              <li>ギフトが飛ぶ → ゲームに反映 🎁</li>
            </ol>
          </div>

          <label className="flex items-center gap-3 select-none">
            <input
              type="checkbox"
              checked={suppress}
              onChange={(e) => onChangeSuppress(e.target.checked)}
              className="accent-cyan-500"
            />
            <span className="text-sm text-gray-300">もう表示しない（このPCでは次回から出さない）</span>
          </label>

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              onClick={onClose}
              type="button"
              className="flex-1 px-5 py-3 rounded-xl font-bold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 transition-all active:scale-95"
            >
              OK（閉じる）
            </button>

            <button
              onClick={onRedownload}
              type="button"
              className="flex-1 px-5 py-3 rounded-xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg transition-all active:scale-95"
            >
              もう一度DLする
            </button>
          </div>

          <div className="text-[11px] text-gray-500 leading-relaxed">
            ※「もう表示しない」を解除したい場合：チェックを外すか、ブラウザの保存データを消すと戻ります。
          </div>
        </div>
      </div>
    </div>
  );
}

interface Props {
  mappings: GiftMapping[];
  tiktokUser: string;
  onChangeTikTokUser?: (v: string) => void; // ✅ App側に合わせて任意で受ける
}

const ExportView: React.FC<Props> = ({ mappings, tiktokUser, onChangeTikTokUser }) => {
  const saved = safeParse(localStorage.getItem(LS_EXPORT_SETTINGS), {
    username: tiktokUser || "",
    host: "127.0.0.1",
    port: 25575,
    password: "9797",
    giftCooldownMs: 300,
    maxCommandsPerGift: 50,
    logUnknownGifts: true,
    commandsDir: "commands",
  });

  const [username, setUsername] = useState<string>(saved.username);
  const [host, setHost] = useState<string>(saved.host);
  const [port, setPort] = useState<number>(saved.port);
  const [password, setPassword] = useState<string>(saved.password);

  const [giftCooldownMs, setGiftCooldownMs] = useState<number>(saved.giftCooldownMs);
  const [maxCommandsPerGift, setMaxCommandsPerGift] = useState<number>(saved.maxCommandsPerGift);
  const [logUnknownGifts, setLogUnknownGifts] = useState<boolean>(saved.logUnknownGifts);
  const [commandsDir, setCommandsDir] = useState<string>(saved.commandsDir);

  const [showNextModal, setShowNextModal] = useState(false);
  const [suppressNextModal, setSuppressNextModal] = useState<boolean>(() => getSuppressFlag());

  // tiktokUser が渡されてて username が空なら補完
  useEffect(() => {
    if (!username && tiktokUser) setUsername(tiktokUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiktokUser]);

  // 入力を保存
  useEffect(() => {
    const payload = {
      username,
      host,
      port,
      password,
      giftCooldownMs,
      maxCommandsPerGift,
      logUnknownGifts,
      commandsDir,
    };
    try {
      localStorage.setItem(LS_EXPORT_SETTINGS, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [username, host, port, password, giftCooldownMs, maxCommandsPerGift, logUnknownGifts, commandsDir]);

  // App側の表示にも反映したい場合
  useEffect(() => {
    onChangeTikTokUser?.(username);
  }, [username, onChangeTikTokUser]);

  // commandFile 未設定を警告
  const missingFiles = useMemo(() => {
    return (mappings || [])
      .filter((m) => !(m.commandFile || "").trim())
      .map((m) => `${m.name}（ID:${m.giftId}）`);
  }, [mappings]);

  const config: BridgeConfig = useMemo(() => {
    const cleanUser = (username || "").trim().replace(/^@/, "");
    return {
      tiktokUsername: cleanUser,
      rcon: {
        host: (host || "").trim() || "127.0.0.1",
        port: Number(port) || 25575,
        password: password || "",
      },
      options: {
        giftCooldownMs: Number(giftCooldownMs) || 300,
        maxCommandsPerGift: Number(maxCommandsPerGift) || 50,
        logUnknownGifts: !!logUnknownGifts,
        commandsDir: (commandsDir || "commands").trim() || "commands",
      },
      mappings: (mappings || []).map((m) => ({
        giftId: String(m.giftId).trim(),
        name: m.name,
        commandFile: (m.commandFile || "").trim(),
        repeat: Math.min(100, Math.max(1, Number(m.repeat ?? 1))),
      })),
    };
  }, [username, host, port, password, giftCooldownMs, maxCommandsPerGift, logUnknownGifts, commandsDir, mappings]);

  const configJson = useMemo(() => JSON.stringify(config, null, 2), [config]);

  const canDownloadConfig = useMemo(() => {
    const allHaveCommandFile =
      config.mappings.length > 0 &&
      config.mappings.every((m) => (m.commandFile || "").trim().length > 0);

    return config.tiktokUsername.length > 0 && config.rcon.password.length > 0 && allHaveCommandFile;
  }, [config]);

  const doDownload = () => downloadText("config.json", configJson, "application/json;charset=utf-8");

  const handleDownloadConfig = () => {
    doDownload();
    if (!suppressNextModal) setShowNextModal(true);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn">
      <NextStepsModal
        open={showNextModal}
        onClose={() => setShowNextModal(false)}
        suppress={suppressNextModal}
        onChangeSuppress={(v) => {
          setSuppressNextModal(v);
          setSuppressFlag(v);
        }}
        onRedownload={doDownload}
      />

      <div className="bg-gray-800 p-8 rounded-3xl border border-gray-700 shadow-xl">
        <h2 className="text-2xl font-bold mb-2">設定 / config.json 出力</h2>
        <p className="text-gray-400 text-sm leading-relaxed mb-6">
          TikTokユーザー名 と RCON を入れて <b>config.json</b> をDLします。
        </p>

        {missingFiles.length > 0 && (
          <div className="mb-5 bg-yellow-900/20 border border-yellow-700/40 rounded-2xl p-4 text-sm text-yellow-100">
            <div className="font-bold mb-1">⚠ commandFile が未設定のギフトがあります</div>
            <div className="text-xs text-yellow-200/90">「ギフト設定」で txt を選んでからDLしてね：</div>
            <ul className="list-disc list-inside mt-2 text-xs">
              {missingFiles.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="bg-gray-900/30 border border-gray-700 rounded-2xl p-5">
            <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider mb-3">TikTok</h3>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">ユーザー名</label>
            <div className="relative mt-2">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">@</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="例: akahoridouma"
                className="w-full bg-gray-900 border border-gray-700 rounded-xl py-3 pl-8 pr-4 text-sm focus:ring-2 focus:ring-cyan-500 outline-none transition-all"
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-2">※「@」は付いててもOK（自動で外します）</p>
          </div>

          <div className="bg-gray-900/30 border border-gray-700 rounded-2xl p-5">
            <h3 className="text-sm font-bold text-pink-400 uppercase tracking-wider mb-3">Minecraft RCON</h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">host</label>
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">port</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">password</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-pink-500 outline-none transition-all"
              />
              <p className="text-[10px] text-gray-500 mt-2">
                server.properties の <code className="text-pink-300">rcon.password</code>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 bg-gray-900/30 border border-gray-700 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-gray-200 mb-3">Bridge Options</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-400">giftCooldownMs</label>
              <input
                type="number"
                value={giftCooldownMs}
                onChange={(e) => setGiftCooldownMs(Number(e.target.value))}
                className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <p className="text-[11px] text-gray-500 mt-2">同一ギフト連打の抑制（ms）</p>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-400">maxCommandsPerGift</label>
              <input
                type="number"
                value={maxCommandsPerGift}
                onChange={(e) => setMaxCommandsPerGift(Number(e.target.value))}
                className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <p className="text-[11px] text-gray-500 mt-2">ギフト1回で実行するコマンド上限（暴走防止）</p>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-400">commandsDir</label>
              <input
                value={commandsDir}
                onChange={(e) => setCommandsDir(e.target.value)}
                className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <p className="text-[11px] text-gray-500 mt-2">通常は "commands" のままでOK</p>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <input
                type="checkbox"
                checked={logUnknownGifts}
                onChange={(e) => setLogUnknownGifts(e.target.checked)}
                className="accent-cyan-500"
              />
              <div className="text-sm text-gray-300">未設定ギフトをログに出す</div>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="text-[11px] text-gray-500">
            マッピング：
            <span className="text-cyan-400 font-bold"> {mappings.length}</span> 件
            {mappings.length === 0 && <span className="text-red-400 font-bold">（先にギフト設定で追加）</span>}
          </div>

          <button
            disabled={!canDownloadConfig}
            onClick={handleDownloadConfig}
            className={`px-6 py-3 rounded-xl font-bold transition-all active:scale-95 ${
              canDownloadConfig
                ? "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg"
                : "bg-gray-700 text-gray-500 cursor-not-allowed"
            }`}
            title={!canDownloadConfig ? "commandFile未設定があるとDLできません" : "config.json をダウンロード"}
            type="button"
          >
            <i className="fas fa-download mr-2" />
            config.json をDL
          </button>
        </div>

        <div className="mt-8">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">
            生成プレビュー（config.json）
          </h3>
          <pre className="bg-black/40 p-4 rounded-xl text-[11px] font-mono overflow-x-auto text-gray-200 border border-white/5 max-h-[360px]">
            {configJson}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default ExportView;
