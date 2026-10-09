package jp.douma.saikutumod;

import java.util.Map;

/**
 * 採掘MODの強さの上限。ゲームMOD経路では count が最大100,000のまま届く（Bridge の「個別最大コマンド数」は
 * count の意味をゲームが決める約束なので掛けない）ので、ここで1回の要求で受け付ける量を抑えてワールドと TPS を守る。
 * 超えた分は実行しない（ログに残す）。Minecraft に依存しない純粋な Java。scripts/test-effect-limits.cjs で単体検証する。
 */
public final class SaikutuLimits {
    private SaikutuLimits() {}

    // 大技（SaikutuEffects）の count は数の倍率。値は実機で確認済みの量（count=1）の2〜3倍を目安にしている。
    private static final Map<String, Integer> MAX_EFFECT_COUNT = Map.of(
        "flood", 3,       // ドラウンド 90体
        "iceage", 3,      // 落ちてくる氷 225個
        "cataclysm", 2);  // TNT 200個・隕石は BridgeMOD 側の上限で抑える

    // スクリプト（commands/*.txt）は count 回くり返す。壊す・閉じ込める・飛ばすものは数回まで。
    private static final Map<String, Integer> MAX_SCRIPT_REPEAT = Map.of(
        "tntdaibakuhatu", 3,  // 1回で TNT 約7,400個を置く。爆発のたびに置き直されるので回数を抑える
        "fissure", 3,         // 足元の大穴と地割れ
        "maguma_jigoku", 3,   // 頭上に溶岩 11×9×11
        "otosiana", 3,        // 落とし穴
        "randomtp", 3,        // 半径300ブロックのどこかへワープ
        "pikkerubossyuu", 1); // 全部没収するので2回目以降は意味がない

    /** 上の表にないスクリプト（アイテムを配るものなど）の上限。アプリの「個別最大コマンド数」の既定値と同じ。 */
    public static final int DEFAULT_SCRIPT_REPEAT = 200;

    /** 大技の count を上限までに抑える。表にない大技（skytrap など count を使わないもの）はそのまま返す。 */
    public static int effectCount(String key, int count) {
        Integer max = MAX_EFFECT_COUNT.get(key);
        return max == null ? count : Math.max(1, Math.min(count, max));
    }

    /** スクリプトのくり返し回数を上限までに抑える。 */
    public static int scriptRepeat(String key, int count) {
        return Math.max(1, Math.min(count, MAX_SCRIPT_REPEAT.getOrDefault(key, DEFAULT_SCRIPT_REPEAT)));
    }
}
