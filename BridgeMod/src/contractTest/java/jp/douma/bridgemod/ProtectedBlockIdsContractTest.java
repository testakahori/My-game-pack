package jp.douma.bridgemod;

import jp.douma.bridgemod.api.ProtectedBlockIds;

// 保護するブロックが、コマンドブロック3種だけであることを Minecraft なしで確かめる。
public final class ProtectedBlockIdsContractTest {
    private static int checks;

    public static void main(String[] args) {
        same(true, ProtectedBlockIds.isProtectedId("minecraft:command_block"), "impulse");
        same(true, ProtectedBlockIds.isProtectedId("minecraft:chain_command_block"), "chain");
        same(true, ProtectedBlockIds.isProtectedId("minecraft:repeating_command_block"), "repeating");
        same(3, ProtectedBlockIds.IDS.size(), "exactly three ids");
        // 似たブロック・名前空間なし・大文字・空・null は守らない。
        same(false, ProtectedBlockIds.isProtectedId("minecraft:structure_block"), "structure block");
        same(false, ProtectedBlockIds.isProtectedId("minecraft:stone"), "stone");
        same(false, ProtectedBlockIds.isProtectedId("command_block"), "no namespace");
        same(false, ProtectedBlockIds.isProtectedId("minecraft:Command_Block"), "case sensitive");
        same(false, ProtectedBlockIds.isProtectedId(""), "empty");
        same(false, ProtectedBlockIds.isProtectedId(null), "null");
        // 一覧は書き換えられない。
        boolean immutable;
        try { ProtectedBlockIds.IDS.add("minecraft:stone"); immutable = false; } catch (UnsupportedOperationException e) { immutable = true; }
        same(true, immutable, "ids are immutable");
        System.out.println("ProtectedBlockIds contract: " + checks + " checks passed");
    }

    private static void same(Object expected, Object actual, String name) {
        checks++;
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError(name + ": expected " + expected + " but was " + actual);
    }
}
