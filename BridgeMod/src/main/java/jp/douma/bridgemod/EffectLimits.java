package jp.douma.bridgemod;

import java.util.Map;

/**
 * 大技（bridgeeffect）の count の上限。count は数の倍率（鶏なら 200×count 羽）なので、
 * 高額ギフトの連打や大きな count でワールドと TPS が崩れないよう、1回の呼び出しで受け付ける倍率を抑える。
 * 超えた分は実行しない（ログに残す）。値は実機で確認済みの量（count=1）の2〜3倍を目安にしている。
 * Minecraft に依存しない純粋な Java。scripts/test-effect-limits.cjs で単体検証する。
 */
public final class EffectLimits {
    private EffectLimits() {}

    /** ジャンプ1回あたりの高さ（ブロック）。 */
    public static final int JUMP_HEIGHT = 32;

    private static final Map<String, Integer> MAX_COUNT = Map.of(
        "superjump", 10,    // 32ブロック×10 = 320ブロック（検証済みの最大）
        "bullettime", 3,    // 矢 720本
        "anvildrop", 3,     // 金床 300個
        "chickenrain", 3,   // 鶏 600羽
        "meteor", 3,        // 火の玉 300発
        "meteorshower", 3,  // 隕石 150個
        "volcano", 3,       // 噴石 150発（溶岩の床は count によらず 21×21）
        "zombiewave", 2);   // ゾンビ4種 各100体 = 400体

    /** count を上限までに抑える。上限のない大技（storm など count を使わないもの）はそのまま返す。 */
    public static int clamp(String key, int count) {
        Integer max = MAX_COUNT.get(key);
        return max == null ? count : Math.max(1, Math.min(count, max));
    }

    /** 連続ジャンプで上がれる高さ（ブロック）。最初に跳んだ高さからここまで。 */
    public static final int MAX_JUMP_RISE = JUMP_HEIGHT * 10;

    /**
     * 空中で重ねたジャンプの目標の高さを、連続ジャンプを始めた高さ（baseY）から 320 ブロック上までに抑える。
     * 今の位置を基準にすると、空中で重ねるたびに上限も上がって際限なく高くなり、効果が切れた時点で落下死する。
     */
    public static double jumpTarget(double currentTarget, double baseY, int count) {
        return Math.min(currentTarget + JUMP_HEIGHT * (double) count, baseY + MAX_JUMP_RISE);
    }
}
