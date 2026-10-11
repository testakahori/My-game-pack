package jp.douma.bridgemod.api;

import java.util.List;

/**
 * 妨害の自動処理から守るブロックの ID。保護対象の一覧はここだけに置く。
 * Minecraft に依存しないので、scripts/test-bridge-contracts.cjs の契約テストで直接確かめる。
 */
public final class ProtectedBlockIds {
    public static final List<String> IDS = List.of(
        "minecraft:command_block", "minecraft:chain_command_block", "minecraft:repeating_command_block");

    private ProtectedBlockIds() {}

    /** 完全一致で判定する。名前空間のない ID・null は守らない。 */
    public static boolean isProtectedId(String id) {
        return id != null && IDS.contains(id);
    }
}
