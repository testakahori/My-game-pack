// src/components/WorldSettingsPage.tsx
import React, { useEffect, useState } from "react";
import { ToggleSlider } from "./ToggleSlider";

type Props = Record<string, string>;

// UIに表示するフィールド定義
const FIELDS: Array<{
  key: string;
  label: string;
  hint?: string;
  type: "text" | "number" | "select" | "boolean" | "world-select";
  options?: { value: string; label: string }[];
}> = [
  {
    key: "level-name",
    label: "配布ワールド / world",
    hint: "haihu_world/ フォルダ内のワールドを選択",
    type: "world-select",
  },
  {
    key: "motd",
    label: "サーバー説明 (MOTD)",
    hint: "サーバーリストに表示される説明文",
    type: "text",
  },
  {
    key: "max-players",
    label: "最大プレイヤー数",
    hint: "同時接続できる最大人数",
    type: "number",
  },
  {
    key: "server-port",
    label: "ポート番号",
    hint: "サーバーのポート (デフォルト: 25565)",
    type: "number",
  },
  {
    key: "gamemode",
    label: "ゲームモード",
    hint: "サーバーのデフォルトゲームモード",
    type: "select",
    options: [
      { value: "survival", label: "サバイバル (survival)" },
      { value: "creative", label: "クリエイティブ (creative)" },
      { value: "adventure", label: "アドベンチャー (adventure)" },
      { value: "spectator", label: "スペクテイター (spectator)" },
    ],
  },
  {
    key: "difficulty",
    label: "難易度",
    hint: "ゲームの難易度",
    type: "select",
    options: [
      { value: "peaceful", label: "ピースフル (peaceful)" },
      { value: "easy", label: "イージー (easy)" },
      { value: "normal", label: "ノーマル (normal)" },
      { value: "hard", label: "ハード (hard)" },
    ],
  },
  {
    key: "pvp",
    label: "PvP",
    hint: "プレイヤー間の戦闘を許可する",
    type: "boolean",
  },
  {
    key: "online-mode",
    label: "オンラインモード",
    hint: "Mojangアカウントで認証する（オフにするとクラック版が接続できる）",
    type: "boolean",
  },
  {
    key: "white-list",
    label: "ホワイトリスト",
    hint: "ホワイトリストに登録したプレイヤーのみ接続できる",
    type: "boolean",
  },
  {
    key: "enable-rcon",
    label: "RCON 有効",
    hint: "リモートコンソール（BRIDGE に必要）",
    type: "boolean",
  },
  {
    key: "rcon.password",
    label: "RCON パスワード",
    hint: "BRIDGE の config.minecraft.json の rcon.password と一致させること",
    type: "text",
  },
  {
    key: "rcon.port",
    label: "RCON ポート",
    hint: "RCON のポート (デフォルト: 25575)",
    type: "number",
  },
  {
    key: "spawn-protection",
    label: "スポーン保護範囲",
    hint: "スポーン地点周辺の保護ブロック数 (0で無効)",
    type: "number",
  },
];

const WORLD_PREFIX = "haihu_world";

const WorldSettingsPage: React.FC = () => {
  const [props, setProps] = useState<Props>({});
  const [draft, setDraft] = useState<Props>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [worldFolders, setWorldFolders] = useState<string[]>([]);
  const [nvMsg, setNvMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const api = (window as any).mygamepack;

  const load = async () => {
    setLoading(true);
    setMsg(null);
    try {
      // server.properties と haihu_world/ サブフォルダを同時に再取得
      const [p, worlds] = await Promise.all([
        api.serverPropsRead() as Promise<Props>,
        api.serverWorldsList().catch(() => [] as string[]),
      ]);
      setWorldFolders(worlds);

      // rcon.password が空なら RCONパスワード.txt から自動入力
      if (!p["rcon.password"]) {
        try {
          const rcon = await api.serverRconPasswordRead();
          if (rcon.found && rcon.password) {
            p["rcon.password"] = rcon.password;
          }
        } catch { /* ignore */ }
      }

      setProps(p);
      setDraft(p);
    } catch (e: any) {
      setMsg({ type: "error", text: `読み込みエラー: ${e?.message ?? String(e)}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setMsg(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      // 変更されたキーだけ書き込む
      const updates: Props = {};
      for (const field of FIELDS) {
        if (draft[field.key] !== undefined && draft[field.key] !== props[field.key]) {
          updates[field.key] = draft[field.key];
        }
      }

      if (Object.keys(updates).length === 0) {
        setMsg({ type: "ok", text: "変更はありませんでした。" });
        return;
      }

      await api.serverPropsWrite(updates);
      setProps({ ...props, ...updates });

      // level-name が変わった場合は暗視データパックを新ワールドに自動展開
      if (updates["level-name"]) {
        try {
          await api.serverDatapackDeployNightVision();
        } catch { /* サーバー未起動などで失敗しても無視 */ }
      }

      setMsg({ type: "ok", text: `${Object.keys(updates).length} 件の設定を保存しました。` });
    } catch (e: any) {
      setMsg({ type: "error", text: `保存エラー: ${e?.message ?? String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft(props);
    setMsg(null);
  };

  const isDirty = FIELDS.some((f) => draft[f.key] !== props[f.key]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400">
        <div className="text-center space-y-2">
          <div className="text-2xl">⏳</div>
          <div>server.properties を読み込み中…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">ワールド設定</h1>
          <p className="text-gray-400 text-sm mt-1">
            <code className="text-cyan-400 text-xs">server/Douma_Craft/server.properties</code> を編集します。
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

      {msg && (
        <div
          className={`px-4 py-3 rounded-xl text-sm font-medium ${
            msg.type === "ok"
              ? "bg-emerald-900/50 border border-emerald-500/30 text-emerald-300"
              : "bg-red-900/50 border border-red-500/30 text-red-300"
          }`}
        >
          {msg.type === "ok" ? "✅ " : "❌ "}{msg.text}
        </div>
      )}

      <div className="space-y-3">
        {FIELDS.map((field) => {
          const value = draft[field.key] ?? "";
          const isChanged = value !== (props[field.key] ?? "");

          return (
            <div
              key={field.key}
              className={`bg-gray-800 border rounded-xl p-4 transition ${
                isChanged ? "border-cyan-500/50" : "border-gray-700"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <label className="text-sm font-bold text-gray-100">{field.label}</label>
                  {isChanged && (
                    <span className="ml-2 text-[10px] bg-cyan-600/20 text-cyan-400 px-1.5 py-0.5 rounded">
                      変更あり
                    </span>
                  )}
                  {field.hint && (
                    <div className="text-[11px] text-gray-500 mt-0.5">{field.hint}</div>
                  )}
                </div>
                <code className="text-[10px] text-gray-600 shrink-0">{field.key}</code>
              </div>

              {field.type === "world-select" ? (
                (() => {
                  // value = "haihu_world/newworld" → subfolder = "newworld"
                  const parts = value.split("/");
                  const subfolder = parts.length >= 2 ? parts.slice(1).join("/") : value;
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400 shrink-0 font-mono">{WORLD_PREFIX}/</span>
                      {worldFolders.length > 0 ? (
                        <select
                          value={subfolder}
                          onChange={(e) => handleChange(field.key, `${WORLD_PREFIX}/${e.target.value}`)}
                          className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                        >
                          {!worldFolders.includes(subfolder) && subfolder && (
                            <option value={subfolder}>{subfolder}（現在の値）</option>
                          )}
                          {worldFolders.map((f) => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={subfolder}
                          onChange={(e) => handleChange(field.key, `${WORLD_PREFIX}/${e.target.value}`)}
                          placeholder="newworld"
                          className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                        />
                      )}
                    </div>
                  );
                })()
              ) : field.type === "boolean" ? (
                <ToggleSlider
                  checked={value === "true"}
                  onChange={() => handleChange(field.key, value === "true" ? "false" : "true")}
                />
              ) : field.type === "select" ? (
                <select
                  value={value}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                >
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === "number" ? "number" : "text"}
                  value={value}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isDirty}
          className={`px-6 py-2.5 rounded-xl font-bold text-sm transition ${
            isDirty && !saving
              ? "bg-cyan-600 hover:bg-cyan-500 text-white"
              : "bg-gray-700 text-gray-500 cursor-not-allowed"
          }`}
        >
          {saving ? "保存中…" : "💾 保存する"}
        </button>

        {isDirty && (
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2.5 rounded-xl text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 transition"
          >
            元に戻す
          </button>
        )}
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex flex-col gap-3">
        <div>
          <div className="text-sm font-bold text-gray-100">暗視データパック</div>
          <div className="text-xs text-gray-500 mt-0.5">現在選択中のワールドに暗視永続データパックを展開します。ワールド切替時は自動で実行されます。</div>
        </div>
        <button
          type="button"
          onClick={async () => {
            setNvMsg(null);
            try {
              const r = await api.serverDatapackDeployNightVision();
              setNvMsg({ type: "ok", text: `展開しました（${r.world}）` });
            } catch (e: any) {
              setNvMsg({ type: "error", text: `エラー: ${e?.message ?? String(e)}` });
            }
          }}
          className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition w-fit"
        >
          暗視データパックを展開
        </button>
        {nvMsg && (
          <div className={`text-xs px-3 py-1.5 rounded-lg ${nvMsg.type === "ok" ? "bg-emerald-900/50 text-emerald-300" : "bg-red-900/50 text-red-300"}`}>
            {nvMsg.type === "ok" ? "✅ " : "❌ "}{nvMsg.text}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-600 border-t border-gray-800 pt-3">
        ※ 変更は次のサーバー起動時に反映されます。
      </div>
    </div>
  );
};

export default WorldSettingsPage;
