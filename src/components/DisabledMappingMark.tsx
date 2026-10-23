// 無効のギフト割り当て（設定ファイルで enabled: false）の印。マウスを載せると、設定ファイルで直す方法が出る（処理のコピー PR8）。
// カタログのタイルは小さいので compact で「無効」とだけ出す。
import React from "react";
import { DISABLED_MAPPING_HINT, DISABLED_MAPPING_MARK } from "../lib/giftMappingRows";

export default function DisabledMappingMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`gift-disabled-mark${compact ? " is-compact" : ""}`} title={DISABLED_MAPPING_HINT}>
      {compact ? "無効" : DISABLED_MAPPING_MARK}
    </span>
  );
}
