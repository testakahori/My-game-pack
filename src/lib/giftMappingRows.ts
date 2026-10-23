// ギフト設定の画面が、設定（config.minecraft.json）の割り当てを読み書きする形。
// 手で書いた enabled: false は、読み込みと保存のたびに落とさない（2026-10-18 設計書の 10。処理のコピー PR5）。
// BRIDGE が使う形（giftId・名前・コマンドの整え方）は bridge/gift_mappings.cjs が決める。ここは画面の行との出し入れだけ。
import type { GiftMapping } from "../types";
import { toRepeat } from "./integerInput";

// 設定の mappings（id を持たない）を画面の行へ。giftId の無い行は出さない。
// giftId は前後の空白を除く（一覧・カタログ・MappingEditor はこの値で同じギフトかを決める。BRIDGE の使う形と同じ。PR5 の最終レビュー）。
export function fromConfigMappings(cfg: any, makeId: () => string): GiftMapping[] {
  const arr = Array.isArray(cfg?.mappings) ? cfg.mappings : [];
  return arr
    .filter((m: any) => String(m?.giftId ?? "").trim())
    .map((m: any) => {
      const commandFile = String(m.commandFile ?? "").trim();
      const giftId = String(m.giftId).trim();
      return {
        id: makeId(),
        giftId,
        name: String(m.name ?? "") || giftId,
        commandFile,
        repeat: toRepeat(m.repeat ?? 1),
        commandSetLabel: commandFile,
        ...(m.enabled === false ? { enabled: false } : {}),
      } as GiftMapping;
    });
}

// 無効の割り当て（設定ファイルで enabled: false）の印（2026-10-23 ユーザーの決定。処理のコピー PR8）。
// BRIDGE はギフトを数えるが、コマンドは動かさない（PR5）。画面での切り替えは作らない（設定ファイルを手で書き換えた人は、戻すのも設定ファイルでできるため）。
export const DISABLED_MAPPING_MARK = "無効（動きません）";
export const DISABLED_MAPPING_HINT = "設定ファイル（config.minecraft.json）でこの割り当てが enabled: false になっています。ギフトは数えますが、コマンドは動きません。動かすには設定ファイルの enabled: false を消してください。";

export function isDisabledMapping(mapping?: { enabled?: boolean } | null): boolean {
  return mapping?.enabled === false;
}

// 無効の割り当てのギフト ID（前後の空白を除いた文字列）。
export function disabledGiftIds(mappings: ReadonlyArray<{ giftId?: unknown; enabled?: boolean }>): Set<string> {
  return new Set(mappings.filter(isDisabledMapping).map((m) => String(m.giftId ?? "").trim()).filter(Boolean));
}

// 画面の行を設定の mappings へ（保存する4項目と、無効のときだけ enabled: false）。
export function toConfigMappings(list: GiftMapping[]): object[] {
  return list.map((m) => ({
    giftId: String(m.giftId).trim(),
    name: m.name || String(m.giftId).trim(),
    commandFile: (m.commandFile || "").trim(),
    repeat: toRepeat(m.repeat ?? 1),
    ...(m.enabled === false ? { enabled: false } : {}),
  }));
}
