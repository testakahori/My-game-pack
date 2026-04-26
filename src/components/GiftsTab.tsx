// src/components/GiftsTab.tsx
import React from "react";

type Gift = { id: number; name: string; diamond_count: number; image?: string | null };
type GiftsMeta = { generatedAt: string; username: string; count: number } | null;

type Mapping = { giftId: string | number; commandFile?: string | null };

type Props = {
  onPickGift?: (giftId: string, giftName: string) => void;
};

type Status = "unset" | "set";

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function normId(v: unknown) {
  return String(v ?? "").trim();
}

export default function GiftsTab({ onPickGift }: Props) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [username, setUsername] = React.useState("akahoridouma");

  const [gifts, setGifts] = React.useState<Gift[]>([]);
  const [meta, setMeta] = React.useState<GiftsMeta>(null);
  const [exists, setExists] = React.useState(false);

  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<"costAsc" | "costDesc" | "nameAsc">("costAsc");

  const [statusById, setStatusById] = React.useState<Record<string, Status>>({});

  const reload = React.useCallback(async () => {
    setErr(null);
    try {
      // gifts
      const res = await window.mygamepack.giftsRead();
      setGifts(res.gifts || []);
      setMeta(res.meta ?? null);
      setExists(!!res.exists);

      // マッピング状態は localStorage から取得（MappingEditor の保存先と一致させる）
      try {
        const raw = localStorage.getItem("mc_tiktok_mappings_unified_v1");
        const mappings: Mapping[] = raw ? (JSON.parse(raw) as Mapping[]) : [];

        const map: Record<string, Status> = {};
        for (const m of mappings) {
          const id = normId(m?.giftId);
          if (!id) continue;
          map[id] = normId(m?.commandFile) ? "set" : "unset";
        }
        setStatusById(map);
      } catch {
        setStatusById({});
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const cfg: any = await window.mygamepack.configRead();
        // どっちの形式でも拾えるように（古いconfigにも対応）
        const u =
          cfg?.tiktokUsername ??
          cfg?.tiktok?.username ??
          cfg?.tiktok?.user ??
          "";
        if (typeof u === "string" && u.trim()) setUsername(u.trim().replace(/^@/, ""));
      } catch {
        // ignore
      }
      await reload();
    })();
  }, [reload]);

  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = gifts.filter((g) => (!s ? true : `${g.id} ${g.name}`.toLowerCase().includes(s)));

    if (sort === "nameAsc") {
      arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else {
      arr.sort((a, b) => (a.diamond_count ?? 0) - (b.diamond_count ?? 0));
      if (sort === "costDesc") arr.reverse();
    }
    return arr;
  }, [gifts, q, sort]);

  const onUpdate = async () => {
    setLoading(true);
    setErr(null);
    try {
      const u = username.trim().replace(/^@/, "");
      if (!u) throw new Error("username is empty");
      await window.mygamepack.giftsUpdate(u);
      await reload();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleGiftClick = async (g: Gift) => {
    try {
      await navigator.clipboard.writeText(String(g.id));
    } catch {}
    try {
      onPickGift?.(String(g.id), g.name || "");
    } catch {}
  };

  const totalSet = React.useMemo(() => Object.values(statusById).filter((v) => v === "set").length, [statusById]);
  const totalUnset = React.useMemo(() => Object.values(statusById).filter((v) => v === "unset").length, [statusById]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Gifts</h2>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#8b95a7" }}>TikTok:</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="akahoridouma"
            style={{
              padding: "8px 10px",
              border: "1px solid rgba(255,255,255,0.16)",
              borderRadius: 10,
              minWidth: 220,
              background: "rgba(0,0,0,0.22)",
              color: "#e6eefc",
              outline: "none",
            }}
          />
          <button
            onClick={onUpdate}
            disabled={loading}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.16)",
              cursor: loading ? "not-allowed" : "pointer",
              background: "rgba(0,0,0,0.18)",
              color: "#e6eefc",
            }}
            title="fetch_gifts.js + gifts_to_html.js を実行して data/gifts を更新します"
          >
            {loading ? "Updating..." : "Update"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => window.mygamepack.giftsOpenFolder()}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.16)",
              cursor: "pointer",
              background: "rgba(0,0,0,0.18)",
              color: "#e6eefc",
            }}
          >
            Open Folder
          </button>
          <button
            onClick={() => window.mygamepack.giftsOpenHtml()}
            disabled={!exists}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.16)",
              cursor: exists ? "pointer" : "not-allowed",
              background: "rgba(0,0,0,0.18)",
              color: exists ? "#e6eefc" : "rgba(230,238,252,0.45)",
            }}
          >
            Open HTML
          </button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search id/name"
            style={{
              padding: "8px 10px",
              border: "1px solid rgba(255,255,255,0.16)",
              borderRadius: 10,
              minWidth: 220,
              background: "rgba(0,0,0,0.22)",
              color: "#e6eefc",
              outline: "none",
            }}
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as any)}
            style={{
              padding: "8px 10px",
              border: "1px solid rgba(255,255,255,0.16)",
              borderRadius: 10,
              background: "rgba(0,0,0,0.22)",
              color: "#e6eefc",
              outline: "none",
            }}
          >
            <option value="costAsc">Cost ↑</option>
            <option value="costDesc">Cost ↓</option>
            <option value="nameAsc">Name A→Z</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 8, color: "#8b95a7", fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {meta ? (
          <span>
            Updated: {fmtDate(meta.generatedAt)} / @{meta.username} / {meta.count} gifts
          </span>
        ) : exists ? (
          <span>Loaded gifts.json</span>
        ) : (
          <span>No gifts yet. Click “Update”.</span>
        )}

        <span style={{ opacity: 0.9 }}>
          Status: <b style={{ color: "#22c55e" }}>{totalSet}</b> set /{" "}
          <b style={{ color: "#ff6b6b" }}>{totalUnset}</b> unset
        </span>
      </div>

      {err && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            border: "1px solid rgba(255,107,107,0.45)",
            background: "rgba(255,107,107,0.10)",
            borderRadius: 10,
          }}
        >
          <b style={{ color: "#ff6b6b" }}>Error:</b> <span style={{ color: "#ff6b6b" }}>{err}</span>
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 10,
        }}
      >
        {filtered.map((g) => {
          const id = String(g.id);
          const st = statusById[id];
          const isUnset = st !== "set";

          return (
            <div
              key={g.id}
              style={{
                border: isUnset ? "1px solid rgba(255,107,107,0.55)" : "1px solid rgba(255,255,255,0.12)",
                background: isUnset ? "rgba(255,107,107,0.06)" : "rgba(0,0,0,0.12)",
                borderRadius: 14,
                padding: 12,
                display: "flex",
                gap: 10,
                alignItems: "center",
                cursor: "pointer",
              }}
              title="クリックでIDコピー＋ギフト設定に反映"
              onClick={() => handleGiftClick(g)}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.06)",
                  overflow: "hidden",
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto",
                  border: isUnset ? "1px solid rgba(255,107,107,0.25)" : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {g.image ? (
                  <img src={g.image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  <span style={{ fontSize: 10, color: "#9aa3b2" }}>no img</span>
                )}
              </div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 800,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      color: "#e6eefc",
                    }}
                  >
                    {g.name}
                  </div>

                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: isUnset ? "rgba(255,107,107,0.14)" : "rgba(34,197,94,0.14)",
                      border: isUnset ? "1px solid rgba(255,107,107,0.35)" : "1px solid rgba(34,197,94,0.35)",
                      color: isUnset ? "#ff6b6b" : "#22c55e",
                      flex: "0 0 auto",
                    }}
                  >
                    {isUnset ? "未設定" : "設定済"}
                  </span>
                </div>

                <div style={{ fontSize: 12, color: "rgba(230,238,252,0.75)" }}>
                  ID: <b>{g.id}</b> / Cost: <b>{g.diamond_count}</b>
                </div>
                <div style={{ fontSize: 11, color: "rgba(230,238,252,0.45)" }}>click → copy + apply</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}