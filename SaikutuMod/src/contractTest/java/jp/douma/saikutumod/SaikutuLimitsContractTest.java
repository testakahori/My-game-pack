package jp.douma.saikutumod;

// 採掘MODの大技の倍率と、スクリプトのくり返し回数が上限で抑えられることを Minecraft なしで確かめる。
public final class SaikutuLimitsContractTest {
    private static int checks;

    public static void main(String[] args) {
        same(3, SaikutuLimits.effectCount("flood", 100000), "flood capped");
        same(3, SaikutuLimits.effectCount("iceage", 4), "iceage capped");
        same(2, SaikutuLimits.effectCount("cataclysm", 50), "cataclysm capped");
        same(7, SaikutuLimits.effectCount("skytrap", 7), "skytrap untouched");
        // ゲームMOD経路では count=100,000 も届く。TNT大爆発を何万回もくり返さない。
        same(3, SaikutuLimits.scriptRepeat("tntdaibakuhatu", 100000), "tnt capped");
        same(3, SaikutuLimits.scriptRepeat("fissure", 5), "fissure capped");
        same(3, SaikutuLimits.scriptRepeat("maguma_jigoku", 100), "lava capped");
        same(1, SaikutuLimits.scriptRepeat("pikkerubossyuu", 30), "confiscation once");
        same(2, SaikutuLimits.scriptRepeat("otosiana", 2), "below cap unchanged");
        // アイテムを配るものは、アプリの「個別最大コマンド数」の既定値まで。
        same(200, SaikutuLimits.scriptRepeat("get_ender_pearl", 100000), "items capped at default");
        same(150, SaikutuLimits.scriptRepeat("get_tree", 150), "items below default unchanged");
        same(1, SaikutuLimits.scriptRepeat("get_tree", 0), "minimum one");
        System.out.println("SaikutuLimits contract: " + checks + " checks passed");
    }

    private static void same(Object expected, Object actual, String label) {
        checks++;
        if (!expected.equals(actual)) throw new AssertionError(label + ": expected " + expected + " but was " + actual);
    }
}
