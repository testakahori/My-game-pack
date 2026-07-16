// src/components/EventSettings2Page.tsx
// イベント設定②：ルーレット / デスルーレット / コメントギフト
// デザインはイベント設定①（EventSettingsPage）を踏襲。
import React, { useCallback, useEffect, useState } from "react";
import { ToggleSlider } from "./ToggleSlider";

type RouletteItem = {
  id: string;
  commandFile: string;
  label: string;
  weight: number;
  repeat: number;
};

type RouletteConfig = {
  enabled: boolean;
  items: RouletteItem[];
  stopSound: string;
  particle: string;
};

type DeathRouletteConfig = RouletteConfig & { everyDeaths: number };

type CommentGiftRule = {
  id: string;
  match: string;
  commandFile: string;
  repeat: number;
  sound: string;
  particle: string;
  enabled: boolean;
};

type CommandFile = { name: string; title: string };

const api = (window as any).mygamepack;

const SOUND_PRESETS = [
  { value: "entity.player.levelup", label: "🔔 レベルアップ" },
  { value: "entity.ender_dragon.growl", label: "🐉 ドラゴンの咆哮" },
  { value: "entity.lightning_bolt.thunder", label: "⚡ 雷鳴" },
  { value: "block.bell.use", label: "🛎 鐘" },
  { value: "block.note_block.pling", label: "🎵 ノートブロック" },
  { value: "entity.firework_rocket.large_blast", label: "🎆 花火" },
  { value: "entity.wither.spawn", label: "💀 ウィザー出現" },
];

const PARTICLE_PRESETS = [
  { value: "minecraft:totem_of_undying", label: "✨ トーテム" },
  { value: "minecraft:end_rod", label: "🌟 エンドロッド" },
  { value: "minecraft:heart", label: "❤ ハート" },
  { value: "minecraft:flame", label: "🔥 炎" },
  { value: "minecraft:explosion_emitter", label: "💥 大爆発" },
  { value: "minecraft:cherry_leaves", label: "🌸 桜の花びら" },
  { value: "minecraft:soul_fire_flame", label: "👻 青い炎" },
];

const newId = () => crypto.randomUUID();

function normItems(raw: any): RouletteItem[] {
  return (Array.isArray(raw) ? raw : []).map((item: any) => ({
    id: item?.id ?? newId(),
    commandFile: String(item?.commandFile ?? ""),
    label: String(item?.label ?? ""),
    weight: Math.max(1, Number(item?.weight ?? 1)),
    repeat: Math.max(1, Math.min(100, Number(item?.repeat ?? 1) || 1)),
  }));
}

function stripIds<T extends { id: string }>(rows: T[]): Omit<T, "id">[] {
  return rows.map(({ id: _id, ...rest }) => rest);
}

// ── 効果音／パーティクル選択（プリセット＋カスタム入力） ───────
function IdPicker({
  label,
  value,
  onChange,
  presets,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  presets: Array<{ value: string; label: string }>;
  placeholder: string;
}) {
  const isPreset = presets.some((p) => p.value === value);
  const [custom, setCustom] = useState(!isPreset && value !== "");
  return (
    <div className="min-w-0">
      <label className="text-xs font-bold text-gray-400 mb-1.5 block">{label}</label>
      <div className="flex items-center gap-2">
        <select
          value={custom ? "__custom__" : value}
          onChange={(e) => {
            if (e.target.value === "__custom__") { setCustom(true); return; }
            setCustom(false);
            onChange(e.target.value);
          }}
          className="flex-1 min-w-0 bg-gray-900 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
        >
          {presets.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          <option value="__custom__">⚙ カスタム（自由入力）…</option>
        </select>
        {custom && (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 min-w-0 bg-gray-900 border border-cyan-700/60 rounded-xl px-3 py-2.5 text-sm text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
        )}
      </div>
    </div>
  );
}

// ── コマンドファイル選択 ─────────────────────────────────
function CmdSelect({
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
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-gray-900 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
    >
      <option value="">（未設定）</option>
      {value && !selected && <option value={value}>{value}</option>}
      {commandFiles.map((f) => <option key={f.name} value={f.name}>{f.title}</option>)}
    </select>
  );
}

// ── ルーレット項目テーブル（ルーレット／デスルーレット共通） ──────
function RouletteItemsEditor({
  items,
  onChange,
  commandFiles,
}: {
  items: RouletteItem[];
  onChange: (items: RouletteItem[]) => void;
  commandFiles: CommandFile[];
}) {
  const totalWeight = items.reduce((a, i) => a + Math.max(1, i.weight), 0) || 1;
  const update = (id: string, patch: Partial<RouletteItem>) =>
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  return (
    <div className="space-y-2">
      <div className="hidden md:grid grid-cols-[1fr_180px_70px_90px_70px_40px] gap-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider px-1">
        <span>実行コマンド</span><span>表示ラベル（回転中の文字）</span><span>回数</span><span>重み</span><span>確率</span><span></span>
      </div>
      {items.length === 0 && (
        <div className="text-center py-6 border border-dashed border-gray-700 rounded-xl text-gray-500 text-sm">
          「＋ 項目を追加」でルーレットの中身を追加できます
        </div>
      )}
      {items.map((item) => (
        <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_180px_70px_90px_70px_40px] gap-2 items-center bg-gray-900/50 border border-gray-700/60 rounded-xl p-2">
          <CmdSelect value={item.commandFile} onChange={(v) => update(item.id, { commandFile: v, label: item.label || v.replace(/\.txt$/i, "") })} commandFiles={commandFiles} />
          <input
            type="text"
            value={item.label}
            onChange={(e) => update(item.id, { label: e.target.value })}
            placeholder="例: クリーパー地獄"
            className="bg-gray-900 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
          <input
            type="number"
            min={1}
            max={100}
            value={item.repeat}
            onChange={(e) => update(item.id, { repeat: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
            title="当選時にこのコマンドを実行する回数"
            className="bg-gray-900 border border-gray-600 rounded-xl px-2 py-2.5 text-sm text-center text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
          <input
            type="number"
            min={1}
            max={100}
            value={item.weight}
            onChange={(e) => update(item.id, { weight: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
            className="bg-gray-900 border border-gray-600 rounded-xl px-2 py-2.5 text-sm text-center text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
          <span className="text-xs font-bold text-cyan-300 text-center">{Math.round((Math.max(1, item.weight) / totalWeight) * 100)}%</span>
          <button
            type="button"
            onClick={() => onChange(items.filter((i) => i.id !== item.id))}
            className="text-gray-500 hover:text-red-400 text-lg"
            aria-label="項目を削除"
          >⌫</button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { id: newId(), commandFile: "", label: "", weight: 1, repeat: 1 }])}
        className="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-700 hover:bg-cyan-600 text-white transition"
      >
        ＋ 項目を追加
      </button>
    </div>
  );
}

// ── セクション枠 ─────────────────────────────────────────
function Section({
  icon,
  title,
  badge,
  description,
  enabled,
  onToggle,
  onSave,
  saving,
  children,
}: {
  icon: string;
  title: string;
  badge: string;
  description: React.ReactNode;
  enabled: boolean;
  onToggle: () => void;
  onSave: () => void;
  saving: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`border rounded-2xl p-5 space-y-4 transition-all ${enabled ? "bg-gray-800 border-gray-700" : "bg-gray-900/40 border-gray-800"}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-2xl shrink-0 mt-0.5">{icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-black text-white">{title}</h2>
              <span className="text-[10px] font-bold text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-700/40">{badge}</span>
              {enabled ? (
                <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">有効</span>
              ) : (
                <span className="text-[9px] font-bold text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded border border-gray-700">無効</span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ToggleSlider checked={enabled} onChange={onToggle} />
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-bold transition active:scale-95 bg-cyan-600 hover:bg-cyan-500 text-white shadow-md disabled:bg-gray-700 disabled:text-gray-500"
          >
            {saving ? "保存中…" : "💾 保存する"}
          </button>
        </div>
      </div>
      {children}
    </section>
  );
}

// ── メイン ───────────────────────────────────────────────
const EventSettings2Page: React.FC = () => {
  const [commandFiles, setCommandFiles] = useState<CommandFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [roulette, setRoulette] = useState<RouletteConfig>({
    enabled: false, items: [], stopSound: "entity.player.levelup", particle: "minecraft:totem_of_undying",
  });
  const [deathRoulette, setDeathRoulette] = useState<DeathRouletteConfig>({
    enabled: false, everyDeaths: 3, items: [], stopSound: "entity.wither.spawn", particle: "minecraft:soul_fire_flame",
  });
  const [commentRules, setCommentRules] = useState<CommentGiftRule[]>([]);
  const [commentEnabled, setCommentEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [cfg, files] = await Promise.all([
        api.configRead(),
        api.bridgeCommandsList().catch(() => [] as CommandFile[]),
      ]);
      setCommandFiles((files as CommandFile[]).filter((f) => f.name !== "roulette.txt"));
      const r = cfg?.roulette || {};
      setRoulette({
        enabled: r.enabled === true,
        items: normItems(r.items),
        stopSound: String(r.stopSound || "entity.player.levelup"),
        particle: String(r.particle || "minecraft:totem_of_undying"),
      });
      const d = cfg?.deathRoulette || {};
      setDeathRoulette({
        enabled: d.enabled === true,
        everyDeaths: Math.max(1, Math.min(1000, Number(d.everyDeaths ?? 3))),
        items: normItems(d.items),
        stopSound: String(d.stopSound || "entity.wither.spawn"),
        particle: String(d.particle || "minecraft:soul_fire_flame"),
      });
      const c = cfg?.commentGifts || {};
      setCommentEnabled(c.enabled === true);
      setCommentRules((Array.isArray(c.rules) ? c.rules : []).map((rule: any) => ({
        id: rule?.id ?? newId(),
        match: String(rule?.match ?? ""),
        commandFile: String(rule?.commandFile ?? ""),
        repeat: Math.max(1, Math.min(100, Number(rule?.repeat ?? 1))),
        sound: String(rule?.sound ?? ""),
        particle: String(rule?.particle ?? ""),
        enabled: rule?.enabled !== false,
      })));
    } catch (e: any) {
      setMsg({ type: "error", text: `読み込みエラー: ${e?.message ?? String(e)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // どの保存ボタンでも3セクションまとめて保存する（1つの config ファイルのため）
  const save = async (label: string) => {
    setSaving(true);
    setMsg(null);
    try {
      const cfg: any = await api.configRead();
      const next = {
        ...cfg,
        roulette: {
          enabled: roulette.enabled,
          items: stripIds(roulette.items.filter((i) => i.commandFile)),
          stopSound: roulette.stopSound,
          particle: roulette.particle,
        },
        deathRoulette: {
          enabled: deathRoulette.enabled,
          everyDeaths: deathRoulette.everyDeaths,
          items: stripIds(deathRoulette.items.filter((i) => i.commandFile)),
          stopSound: deathRoulette.stopSound,
          particle: deathRoulette.particle,
        },
        commentGifts: {
          enabled: commentEnabled,
          rules: stripIds(commentRules.filter((r) => r.match.trim() && r.commandFile)),
        },
      };
      await api.configWrite(next);
      // ギフト設定・イベント設定から割り当てられる「ルーレット」仮想コマンドを配置
      try {
        await api.bridgeCommandsWrite({
          filename: "roulette.txt",
          content: [
            "# TITLE: ルーレット",
            "# CATEGORY: 演出",
            "// このファイルはイベント設定②のルーレットが使う仮想コマンドです。",
            "// ギフトやイベントにこの「ルーレット」を割り当てると、設定した項目から抽選して発動します。",
            "// 実行内容は config.minecraft.json の roulette セクションで管理されます。",
            "// 以下はルーレットが無効のまま割り当てられたときの案内表示（有効時はBridgeが横取りするため実行されません）",
            'execute if entity @a run title @a actionbar {"text":"ルーレットが無効です。イベント設定②で有効化してください","color":"red"}',
            "",
          ].join("\n"),
        });
      } catch { /* コマンドフォルダ未作成でも保存自体は成功扱い */ }
      setMsg({ type: "ok", text: `${label}を保存しました。次回 BRIDGE 起動（または数秒後の自動再読込）から有効になります。` });
      setTimeout(() => setMsg(null), 5000);
    } catch (e: any) {
      setMsg({ type: "error", text: `保存エラー: ${e?.message ?? String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  const updateCommentRule = (id: string, patch: Partial<CommentGiftRule>) =>
    setCommentRules((rules) => rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400">
        <div className="text-center space-y-2"><div className="text-2xl">⏳</div><div>設定を読み込み中…</div></div>
      </div>
    );
  }

  return (
    <div className="events-page events2-page page-surface max-w-none space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-white">イベント設定②</h1>
          <p className="text-gray-400 text-sm mt-1">
            ルーレット・デスルーレット・コメントギフト。
            <code className="text-cyan-400 text-xs ml-1">config.minecraft.json</code> に保存されます。
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="text-xs text-gray-400 hover:text-gray-200 px-3 py-2 rounded-lg border border-gray-700 hover:border-gray-500 transition"
        >
          🔄 再読込
        </button>
      </div>

      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          msg.type === "ok"
            ? "bg-emerald-900/50 border border-emerald-500/30 text-emerald-300"
            : "bg-red-900/50 border border-red-500/30 text-red-300"
        }`}>
          {msg.type === "ok" ? "✅ " : "❌ "}{msg.text}
        </div>
      )}

      {/* ══ ルーレット ══ */}
      <Section
        icon="🎡"
        title="ルーレット"
        badge="ギフト割当で発動"
        description={
          <>
            発動するとマイクラ画面で文字がくるくる回り、止まったところのコマンドを実行します。
            ギフト設定やイベント設定で「<b className="text-cyan-300">ルーレット</b>」をコマンドに割り当てると発動します。
            確率は「重み」の比率で決まります。
          </>
        }
        enabled={roulette.enabled}
        onToggle={() => setRoulette({ ...roulette, enabled: !roulette.enabled })}
        onSave={() => save("ルーレット設定")}
        saving={saving}
      >
        <RouletteItemsEditor
          items={roulette.items}
          onChange={(items) => setRoulette({ ...roulette, items })}
          commandFiles={commandFiles}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <IdPicker
            label="停止時の効果音"
            value={roulette.stopSound}
            onChange={(v) => setRoulette({ ...roulette, stopSound: v })}
            presets={SOUND_PRESETS}
            placeholder="例: entity.player.levelup"
          />
          <IdPicker
            label="停止時のパーティクル"
            value={roulette.particle}
            onChange={(v) => setRoulette({ ...roulette, particle: v })}
            presets={PARTICLE_PRESETS}
            placeholder="例: minecraft:totem_of_undying"
          />
        </div>
      </Section>

      {/* ══ デスルーレット ══ */}
      <Section
        icon="💀"
        title="デスルーレット"
        badge="死亡回数で発動"
        description={
          <>
            プレイヤーが死んだ回数が設定値の倍数になるたびにルーレットが回ります
            （Mod v1.2.0 以降が必要）。
          </>
        }
        enabled={deathRoulette.enabled}
        onToggle={() => setDeathRoulette({ ...deathRoulette, enabled: !deathRoulette.enabled })}
        onSave={() => save("デスルーレット設定")}
        saving={saving}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs font-bold text-gray-400">発動する死亡回数:</label>
          <input
            type="number"
            min={1}
            max={1000}
            value={deathRoulette.everyDeaths}
            onChange={(e) => setDeathRoulette({ ...deathRoulette, everyDeaths: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })}
            className="w-20 bg-gray-900 border border-gray-600 rounded-xl px-2 py-2 text-sm text-center text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
          <span className="text-xs text-gray-400">回ごと（例: 3 → 3回・6回・9回…死ぬたびに回る）</span>
        </div>
        <RouletteItemsEditor
          items={deathRoulette.items}
          onChange={(items) => setDeathRoulette({ ...deathRoulette, items })}
          commandFiles={commandFiles}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <IdPicker
            label="停止時の効果音"
            value={deathRoulette.stopSound}
            onChange={(v) => setDeathRoulette({ ...deathRoulette, stopSound: v })}
            presets={SOUND_PRESETS}
            placeholder="例: entity.wither.spawn"
          />
          <IdPicker
            label="停止時のパーティクル"
            value={deathRoulette.particle}
            onChange={(v) => setDeathRoulette({ ...deathRoulette, particle: v })}
            presets={PARTICLE_PRESETS}
            placeholder="例: minecraft:soul_fire_flame"
          />
        </div>
      </Section>

      {/* ══ コメントギフト ══ */}
      <Section
        icon="💬"
        title="コメントギフト"
        badge="コメントで発動"
        description={
          <>
            設定した文字列を含むコメントが来るとコマンドが発動します（同じルールは3秒に1回まで）。
          </>
        }
        enabled={commentEnabled}
        onToggle={() => setCommentEnabled(!commentEnabled)}
        onSave={() => save("コメントギフト設定")}
        saving={saving}
      >
        <div className="space-y-3">
          {commentRules.length === 0 && (
            <div className="text-center py-6 border border-dashed border-gray-700 rounded-xl text-gray-500 text-sm">
              「＋ ルールを追加」でコメントとコマンドの組み合わせを追加できます
            </div>
          )}
          {commentRules.map((rule) => (
            <div key={rule.id} className={`border rounded-xl p-3 space-y-3 ${rule.enabled ? "bg-gray-900/50 border-gray-700/60" : "bg-gray-900/20 border-gray-800 opacity-70"}`}>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_80px_auto_40px] gap-2 items-center">
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">コメント（含む文字列）</label>
                  <input
                    type="text"
                    value={rule.match}
                    onChange={(e) => updateCommentRule(rule.id, { match: e.target.value })}
                    placeholder="例: クリーパー"
                    className="w-full bg-gray-900 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">実行コマンド</label>
                  <CmdSelect value={rule.commandFile} onChange={(v) => updateCommentRule(rule.id, { commandFile: v })} commandFiles={commandFiles} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">回数</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={rule.repeat}
                    onChange={(e) => updateCommentRule(rule.id, { repeat: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
                    className="w-full bg-gray-900 border border-gray-600 rounded-xl px-2 py-2.5 text-sm text-center text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>
                <div className="flex items-center gap-2 pt-4">
                  <ToggleSlider checked={rule.enabled} onChange={() => updateCommentRule(rule.id, { enabled: !rule.enabled })} />
                  <span className="text-xs text-gray-400">{rule.enabled ? "有効" : "無効"}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCommentRules((rules) => rules.filter((r) => r.id !== rule.id))}
                  className="text-gray-500 hover:text-red-400 text-lg pt-4"
                  aria-label="ルールを削除"
                >⌫</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <IdPicker
                  label="効果音（任意）"
                  value={rule.sound || SOUND_PRESETS[0].value}
                  onChange={(v) => updateCommentRule(rule.id, { sound: v })}
                  presets={SOUND_PRESETS}
                  placeholder="例: block.bell.use"
                />
                <IdPicker
                  label="パーティクル（任意）"
                  value={rule.particle || PARTICLE_PRESETS[0].value}
                  onChange={(v) => updateCommentRule(rule.id, { particle: v })}
                  presets={PARTICLE_PRESETS}
                  placeholder="例: minecraft:heart"
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setCommentRules((rules) => [
              ...rules,
              { id: newId(), match: "", commandFile: "", repeat: 1, sound: SOUND_PRESETS[0].value, particle: PARTICLE_PRESETS[0].value, enabled: true },
            ])}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-cyan-700 hover:bg-cyan-600 text-white transition"
          >
            ＋ ルールを追加
          </button>
        </div>
      </Section>

      <div className="bg-gray-800/40 border border-gray-700 rounded-2xl p-5 text-sm text-gray-500">
        保存後は BRIDGE が数秒で設定を自動再読込します（再起動でも可）。
        デスルーレットは Mod v1.2.0 以降のサーバーで動作します。
      </div>
    </div>
  );
};

export default EventSettings2Page;
