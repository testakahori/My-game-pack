import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

// hint：未保存の帯に出す、保存のしかた（例：ギフト設定の「この内容で登録」）。無ければページごとの文を出す（2026-11-07 品質レビュー）。
type Guard = { set: (id: string, dirty: boolean, busy: boolean, hint?: string) => void; confirmDiscard: (ignoreId?: string) => boolean; hasChanges: boolean; hint: string };
const Context = createContext<Guard | null>(null);

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const entries = useRef(new Map<string, { dirty: boolean; busy: boolean; hint: string }>());
  const [hasChanges, setHasChanges] = useState(false);
  const [hint, setHint] = useState("");
  const set = useCallback((id: string, dirty: boolean, busy: boolean, hint = "") => {
    if (dirty || busy) entries.current.set(id, { dirty, busy, hint }); else entries.current.delete(id);
    setHasChanges(entries.current.size > 0);
    setHint([...entries.current.values()].find(row => row.dirty && row.hint)?.hint ?? "");
  }, []);
  const confirmDiscard = useCallback((ignoreId?: string) => {
    const pending = [...entries.current.entries()].filter(([id]) => id !== ignoreId).map(([, row]) => row);
    if (pending.some(row => row.busy)) {
      window.alert("保存処理が完了するまでお待ちください。");
      return false;
    }
    return pending.length === 0 || window.confirm("保存されていない変更があります。\n変更を破棄して進みますか？\n\n残す場合は「キャンセル」で戻り、保存してください。");
  }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (entries.current.size) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const value = useMemo(() => ({ set, confirmDiscard, hasChanges, hint }), [set, confirmDiscard, hasChanges, hint]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useUnsavedGuard() {
  const value = useContext(Context);
  if (!value) throw new Error("UnsavedChangesProvider is missing");
  return value;
}

export function useUnsavedChanges(dirty: boolean, busy = false, hint = "") {
  const id = useId();
  const { set } = useUnsavedGuard();
  useLayoutEffect(() => { set(id, dirty, busy, hint); return () => set(id, false, false); }, [id, set, dirty, busy, hint]);
  return id;
}
