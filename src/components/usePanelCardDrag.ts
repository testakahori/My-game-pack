import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { slotAtPoint } from '../lib/panelSlots';

// プレビューのカードを押したまま別の枠へ動かして離すと、入れ替え・移動する（2026-11-05 ユーザーの決定）。
// 少し動かすまではクリック（カードの選択）として扱う。Esc でやめられる。
type Grid = Parameters<typeof slotAtPoint>[0];
/** target は指している枠（画像の外なら null）。x・y はプレビューの左上からの位置（画面の px）。 */
export type CardDrag = { id: string; from: number; target: number | null; x: number; y: number };
const START_DISTANCE = 6;

export function usePanelCardDrag(wrap: RefObject<HTMLDivElement | null>, grid: Grid, columns: number, rows: number, onDrop: (id: string, slot: number) => void) {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const press = useRef<{ pointer: number; x: number; y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const locate = (clientX: number, clientY: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    const x = clientX - rect.left, y = clientY - rect.top;
    return { x, y, target: slotAtPoint(grid, columns, rows, x / rect.width * grid.width, y / rect.height * grid.height) };
  };
  const cancel = () => { if (press.current?.moved) dragged.current = true; press.current = null; setDrag(null); };
  const bind = (id: string, from: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      dragged.current = false;
      if (e.button !== 0) return;
      press.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.pointer !== e.pointerId || (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < START_DISTANCE)) return;
      p.moved = true;
      const at = locate(e.clientX, e.clientY);
      if (at) setDrag({ id, from, ...at });
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.pointer !== e.pointerId) return;
      press.current = null;
      if (!p.moved) return;
      dragged.current = true; setDrag(null);
      const at = locate(e.clientX, e.clientY);
      if (at && at.target !== null && at.target !== from) onDrop(id, at.target);
    },
    onPointerCancel: () => cancel(),
    onLostPointerCapture: () => { if (press.current) cancel(); },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => { if (e.key === 'Escape' && press.current) { e.preventDefault(); cancel(); } },
  });
  /** ドラッグのあとに来るクリックでは、カードを選び直さない。 */
  const consumeClick = () => { const was = dragged.current; dragged.current = false; return was; };
  return { drag, bind, consumeClick };
}
