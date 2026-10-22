// ギフト設定の画面が、設定（config.minecraft.json）の割り当てを読み書きする形。
// 手で書いた enabled: false は、読み込みと保存のたびに落とさない（2026-10-18 設計書の 10。処理のコピー PR5）。
// BRIDGE が使う形（giftId・名前・コマンドの整え方）は bridge/gift_mappings.cjs が決める。ここは画面の行との出し入れだけ。
import type { GiftMapping } from "../types";
import { toRepeat } from "./integerInput";

// 設定の mappings（id を持たない）を画面の行へ。giftId の無い行は出さない。
export function fromConfigMappings(cfg: any, makeId: () => string): GiftMapping[] {
  const arr = Array.isArray(cfg?.mappings) ? cfg.mappings : [];
  return arr
    .filter((m: any) => String(m?.giftId ?? "").trim())
    .map((m: any) => {
      const commandFile = String(m.commandFile ?? "").trim();
      return {
        id: makeId(),
        giftId: String(m.giftId),
        name: String(m.name ?? "") || String(m.giftId),
        commandFile,
        repeat: toRepeat(m.repeat ?? 1),
        commandSetLabel: commandFile,
        ...(m.enabled === false ? { enabled: false } : {}),
      } as GiftMapping;
    });
}

// 画面の行を設定の mappings へ（保存する4項目と、無効のときだけ enabled: false）。
export function toConfigMappings(list: GiftMapping[]): object[] {
  return list.map((m) => ({
    giftId: String(m.giftId),
    name: m.name || String(m.giftId),
    commandFile: (m.commandFile || "").trim(),
    repeat: toRepeat(m.repeat ?? 1),
    ...(m.enabled === false ? { enabled: false } : {}),
  }));
}
