// src/components/CommandsListPage.tsx
// 現在使用できる /douma コマンドのチートシート。
// bridge/commands/minecraft/*.txt のメタ情報（TITLE/CATEGORY/説明）を一覧表示し、
// カードクリックでチャット欄に貼り付けられる「/douma <コマンド名> 1」をコピーする。
import React from "react";

type CommandMeta = { name: string; title: string; category: string; description?: string };

function getApi() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).mygamepack ?? null;
}

// txt側の表記ゆれ（"お助け" / "妨害" / "妨害系|敵対MOB" 等）を代表カテゴリへ寄せる
function normalizeCategory(raw: string): string {
  const c = (raw || "").split("|")[0].trim();
  if (!c) return "その他";
  if (c === "お助け") return "お助け系";
  if (c === "妨害") return "妨害系";
  return c;
}

const CATEGORY_ORDER: { key: string; icon: string; note: string }[] = [
  { key: "お助け系", icon: "💊", note: "プレイヤーを助けるご褒美" },
  { key: "変身ステータス", icon: "🦸", note: "プレイヤーの能力が変化" },
  { key: "友好MOB", icon: "🐶", note: "かわいい仲間を召喚" },
  { key: "敵対MOB", icon: "👹", note: "敵モブを召喚" },
  { key: "襲撃モブ", icon: "🌊", note: "モブの大群イベント" },
  { key: "妨害系", icon: "💣", note: "プレイヤーへの悪戯・妨害" },
  { key: "トラップ悪戯", icon: "🕳️", note: "引っかけトラップ" },
  { key: "天変地異", icon: "🌋", note: "ワールド規模の大災害" },
  { key: "その他", icon: "📦", note: "" },
];

function chatCommandOf(meta: CommandMeta): string {
  return `/douma ${meta.name.replace(/\.txt$/i, "")} 1`;
}

const CommandsListPage: React.FC = () => {
  const [commands, setCommands] = React.useState<CommandMeta[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [activeCategory, setActiveCategory] = React.useState<string>("すべて");
  const [toast, setToast] = React.useState<{ id: number; msg: string } | null>(null);

  const showToast = (msg: string) => {
    setToast({ id: Date.now(), msg });
    setTimeout(() => setToast(null), 2500);
  };

  const reload = React.useCallback(async () => {
    setErr(null);
    const api = getApi();
    if (!api?.bridgeCommandsReadMeta) {
      setErr("Electron API (bridgeCommandsReadMeta) が見つかりません。");
      return;
    }
    try {
      const list: CommandMeta[] = await api.bridgeCommandsReadMeta();
      // roulette.txt はギフト用の演出プレースホルダなのでチートシートには出さない
      setCommands((list || []).filter((c) => c.name !== "roulette.txt"));
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const onCopy = async (meta: CommandMeta) => {
    const cmd = chatCommandOf(meta);
    try {
      await navigator.clipboard.writeText(cmd);
      showToast(`コピーしました: ${cmd}`);
    } catch {
      showToast("コピーに失敗しました");
    }
  };

  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    return commands.filter((c) => {
      if (activeCategory !== "すべて" && normalizeCategory(c.category) !== activeCategory) return false;
      if (!s) return true;
      return `${c.name} ${c.title} ${c.description || ""}`.toLowerCase().includes(s);
    });
  }, [commands, q, activeCategory]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, CommandMeta[]>();
    for (const c of filtered) {
      const cat = normalizeCategory(c.category);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(c);
    }
    const known = CATEGORY_ORDER.filter((o) => map.has(o.key)).map((o) => ({ ...o, items: map.get(o.key)! }));
    // CATEGORY_ORDER に無い未知カテゴリも末尾に表示する（txt側で新カテゴリが増えても欠落しない）
    const unknown = [...map.keys()]
      .filter((k) => !CATEGORY_ORDER.some((o) => o.key === k))
      .map((k) => ({ key: k, icon: "📦", note: "", items: map.get(k)! }));
    return [...known, ...unknown];
  }, [filtered]);

  const categoryChips = React.useMemo(() => {
    const present = new Set(commands.map((c) => normalizeCategory(c.category)));
    return ["すべて", ...CATEGORY_ORDER.filter((o) => present.has(o.key)).map((o) => o.key)];
  }, [commands]);

  return (
    <div className="commands-page gift-catalog-v2 page-surface">
      <header className="gift-catalog-v2__header">
        <div>
          <h1>コマンド一覧</h1>
          <p>Minecraft チャットで使える /douma コマンドのチートシート</p>
        </div>
        <span>MyGamePack Manager</span>
      </header>

      {/* 使い方バナー */}
      <section className="cmd-usage-banner">
        <div className="cmd-usage-banner__icon">💬</div>
        <div>
          <b>チャット欄に「/douma zombie 1」のように入力してください</b>
          <p>
            形式は <code>/douma コマンド名 回数</code> です（例: <code>/douma zombie 1</code> でゾンビ1回召喚、
            <code>/douma tnt 3</code> でTNTを3回）。
            下のコマンドをクリックすると出現コマンドがコピーされるので、Minecraftのチャット欄（Tキー → Ctrl+V）にそのまま貼り付けできます。
          </p>
        </div>
      </section>

      {err && <div className="gift-catalog-error">❌ {err}</div>}

      {/* 検索・カテゴリフィルタ */}
      <section className="cmd-toolbar">
        <div className="gift-catalog-search">
          <span>⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="コマンド名・説明を検索..." />
        </div>
        <div className="cmd-category-chips">
          {categoryChips.map((cat) => (
            <button
              key={cat}
              type="button"
              className={activeCategory === cat ? "is-active" : ""}
              onClick={() => setActiveCategory(cat)}
            >
              {cat === "すべて" ? "✦ すべて" : `${CATEGORY_ORDER.find((o) => o.key === cat)?.icon ?? ""} ${cat}`}
            </button>
          ))}
        </div>
        <div className="cmd-toolbar-count">
          全 <b>{filtered.length}</b> コマンド
        </div>
      </section>

      {grouped.length === 0 ? (
        <div className="gift-catalog-empty">
          {commands.length === 0 ? "コマンドが見つかりません" : "検索結果が0件です"}
        </div>
      ) : (
        grouped.map((group) => (
          <section key={group.key} className="cmd-category-section">
            <header className="cmd-category-header">
              <span className="cmd-category-header__icon">{group.icon}</span>
              <h2>{group.key}</h2>
              {group.note && <small>{group.note}</small>}
              <em>{group.items.length}件</em>
            </header>
            <div className="cmd-grid">
              {group.items.map((meta) => (
                <button
                  key={meta.name}
                  type="button"
                  className="cmd-card"
                  onClick={() => onCopy(meta)}
                  title="クリックで出現コマンドをコピー"
                >
                  <div className="cmd-card__head">
                    <b>{meta.title}</b>
                    <span className="cmd-card__copy">▣ コピー</span>
                  </div>
                  <p className="cmd-card__desc">{meta.description || "説明なし"}</p>
                  <code className="cmd-card__code">{chatCommandOf(meta)}</code>
                </button>
              ))}
            </div>
          </section>
        ))
      )}

      {toast && (
        <div key={toast.id} className="gift-catalog-toast">
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default CommandsListPage;
