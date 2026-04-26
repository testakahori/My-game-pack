// src/components/SettingsExportView.tsx
import React, { useEffect, useMemo, useState } from "react";
import type { GiftMapping } from "../types";

type SevenDtdConfig = {
  tiktokUsername: string;
  target: {
    type: "7dtd";
    playerId: number;
    sendPasswordOnConnect: boolean;
  };
  telnet: { host: string; port: number; password: string };
  options: {
    giftCooldownMs: number;
    maxCommandsPerGift: number;
    logUnknownGifts: boolean;
    commandsDir: string;
  };
  mappings: { giftId: string; name: string; commandFile: string; repeat: number }[];
};

const LS_TIKTOK_USER     = "mc_tiktok_username_unified_v1";
const LS_SETTINGS_7DTD   = "mc_bridge_settings_7dtd_v1";

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

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

type Props = {
  mappings: GiftMapping[];
};

const SettingsExportView: React.FC<Props> = ({ mappings }) => {
  const saved = safeParse(localStorage.getItem(LS_SETTINGS_7DTD), {
    tdHost: "127.0.0.1",
    tdPort: 8081,
    tdPassword: "9797",
    tdPlayerId: 0,
    tdSendPasswordOnConnect: false,
    tdCommandsDir: "commands/7dtd",
  });

  const [tdHost, setTdHost]                               = useState<string>(saved.tdHost);
  const [tdPort, setTdPort]                               = useState<number>(saved.tdPort);
  const [tdPassword, setTdPassword]                       = useState<string>(saved.tdPassword);
  const [tdPlayerId, setTdPlayerId]                       = useState<number>(saved.tdPlayerId);
  const [tdSendPasswordOnConnect, setTdSendPasswordOnConnect] = useState<boolean>(saved.tdSendPasswordOnConnect);
  const [tdCommandsDir, setTdCommandsDir]                 = useState<string>(saved.tdCommandsDir || "commands/7dtd");

  // TikTok username は Dashboard が管理する LS から読み取るのみ
  const username = localStorage.getItem(LS_TIKTOK_USER) || "";

  useEffect(() => {
    localStorage.setItem(LS_SETTINGS_7DTD, JSON.stringify({
      tdHost, tdPort, tdPassword, tdPlayerId, tdSendPasswordOnConnect, tdCommandsDir,
    }));
  }, [tdHost, tdPort, tdPassword, tdPlayerId, tdSendPasswordOnConnect, tdCommandsDir]);

  const normalizedMappings = useMemo(() => {
    return (mappings || []).map((m) => ({
      giftId: String(m.giftId),
      name: m.name,
      commandFile: (m.commandFile || "").trim(),
      repeat: Math.min(100, Math.max(1, Number(m.repeat ?? 1))),
    }));
  }, [mappings]);

  const missingFiles = useMemo(() => {
    return (mappings || [])
      .filter((m) => !(m.commandFile || "").trim())
      .map((m) => `${m.name}（ID:${m.giftId}）`);
  }, [mappings]);

  const tdConfig: SevenDtdConfig = useMemo(() => ({
    tiktokUsername: username.trim().replace(/^@/, ""),
    target: {
      type: "7dtd",
      playerId: clampInt(tdPlayerId, 0, 999999, 0),
      sendPasswordOnConnect: !!tdSendPasswordOnConnect,
    },
    telnet: {
      host: (tdHost || "").trim() || "127.0.0.1",
      port: clampInt(tdPort, 1, 65535, 8081),
      password: tdPassword || "",
    },
    options: {
      giftCooldownMs: 300,
      maxCommandsPerGift: 200,
      logUnknownGifts: true,
      commandsDir: (tdCommandsDir || "commands/7dtd").trim() || "commands/7dtd",
    },
    mappings: normalizedMappings,
  }), [username, tdHost, tdPort, tdPassword, tdPlayerId, tdSendPasswordOnConnect, tdCommandsDir, normalizedMappings]);

  const configJson = useMemo(() => JSON.stringify(tdConfig, null, 2), [tdConfig]);

  const canDownload = useMemo(() => {
    return (
      username.trim().length > 0 &&
      normalizedMappings.length > 0 &&
      normalizedMappings.every((m) => m.commandFile.length > 0)
    );
  }, [username, normalizedMappings]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fadeIn">
      <div className="bg-gray-800 p-8 rounded-3xl border border-gray-700 shadow-xl">
        <div>
          <h2 className="text-2xl font-bold mb-2">設定 / config 出力（7DTD Telnet）</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            7 Days to Die（Telnet）向けの設定を書き出します。
          </p>
        </div>

        {missingFiles.length > 0 && (
          <div className="mt-6 bg-yellow-900/20 border border-yellow-700/40 rounded-2xl p-4 text-sm text-yellow-100">
            <div className="font-bold mb-1">⚠ commandFile が未設定のギフトがあります</div>
            <ul className="list-disc list-inside mt-2 text-xs">
              {missingFiles.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
        )}

        {/* 7DTD Telnet */}
        <div className="mt-6 bg-gray-900/30 border border-gray-700 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-pink-400 uppercase tracking-wider mb-4">7DTD Telnet</h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">host</label>
              <input
                value={tdHost}
                onChange={(e) => setTdHost(e.target.value)}
                className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-pink-500 outline-none transition-all"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">port</label>
              <input
                type="number"
                value={tdPort}
                onChange={(e) => setTdPort(Number(e.target.value))}
                className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-pink-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">password（任意）</label>
            <input
              value={tdPassword}
              onChange={(e) => setTdPassword(e.target.value)}
              className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-pink-500 outline-none transition-all"
            />
            <p className="text-[10px] text-gray-500 mt-2">
              serverconfig.xml の <code className="text-pink-300">TelnetPassword</code>
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">playerId（spawn先）</label>
              <input
                type="number"
                value={tdPlayerId}
                onChange={(e) => setTdPlayerId(Number(e.target.value))}
                className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-pink-500 outline-none transition-all"
              />
              <p className="text-[10px] text-gray-500 mt-2">例：<code className="text-cyan-300">lpi</code> で自分の id を確認</p>
            </div>
            <div className="flex items-center gap-3 mt-7">
              <input
                type="checkbox"
                checked={tdSendPasswordOnConnect}
                onChange={(e) => setTdSendPasswordOnConnect(e.target.checked)}
                className="accent-cyan-500"
              />
              <div className="text-sm text-gray-300">
                接続直後にパスワードを送る（通常OFF推奨）
                <div className="text-[10px] text-gray-500 mt-1">
                  環境によって <code className="text-red-300">unknown command</code> になりやすい
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">commandsDir</label>
            <input
              value={tdCommandsDir}
              onChange={(e) => setTdCommandsDir(e.target.value)}
              className="w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-pink-500 outline-none transition-all"
            />
            <p className="text-[11px] text-gray-500 mt-2">通常は "commands/7dtd" のままでOK</p>
          </div>
        </div>

        {/* Download */}
        <div className="mt-6 flex flex-col gap-3">
          <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <div className="text-[11px] text-gray-500">
              マッピング：<span className="text-cyan-400 font-bold"> {mappings.length}</span> 件
              {mappings.length === 0 && <span className="text-red-400 font-bold ml-1">（先にギフト設定で追加）</span>}
            </div>
            <button
              disabled={!canDownload}
              onClick={() => downloadText("config.7dtd.json", configJson, "application/json;charset=utf-8")}
              className={`px-6 py-3 rounded-xl font-bold transition-all active:scale-95 ${
                canDownload
                  ? "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg"
                  : "bg-gray-700 text-gray-500 cursor-not-allowed"
              }`}
              title={!canDownload ? "commandFile未設定がある / TikTokユーザー名が空" : "config をダウンロード"}
            >
              config.7dtd.json をDL
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsExportView;
