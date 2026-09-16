import React, { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

type Guard = { set: (id: string, dirty: boolean, busy: boolean) => void; confirmDiscard: () => boolean; hasChanges: boolean };
const Context = createContext<Guard | null>(null);

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const entries = useRef(new Map<string, { dirty: boolean; busy: boolean }>());
  const [hasChanges, setHasChanges] = useState(false);
  const set = useCallback((id: string, dirty: boolean, busy: boolean) => {
    if (dirty || busy) entries.current.set(id, { dirty, busy }); else entries.current.delete(id);
    setHasChanges(entries.current.size > 0);
  }, []);
  const confirmDiscard = useCallback(() => {
    if ([...entries.current.values()].some(row => row.busy)) {
      window.alert("保存処理が完了するまでお待ちください。");
      return false;
    }
    return entries.current.size === 0 || window.confirm("保存されていない変更があります。\n変更を破棄して進みますか？\n\n残す場合は「キャンセル」で戻り、保存してください。");
  }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (entries.current.size) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const value = useMemo(() => ({ set, confirmDiscard, hasChanges }), [set, confirmDiscard, hasChanges]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useUnsavedGuard() {
  const value = useContext(Context);
  if (!value) throw new Error("UnsavedChangesProvider is missing");
  return value;
}

export function useUnsavedChanges(dirty: boolean, busy = false) {
  const id = useId();
  const { set } = useUnsavedGuard();
  useLayoutEffect(() => { set(id, dirty, busy); return () => set(id, false, false); }, [id, set, dirty, busy]);
}
