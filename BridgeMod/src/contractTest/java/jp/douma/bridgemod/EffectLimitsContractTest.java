package jp.douma.bridgemod;

// 大技の count が上限で抑えられ、count を使わない大技とジャンプの高さが期待どおりかを Minecraft なしで確かめる。
public final class EffectLimitsContractTest {
    private static int checks;

    public static void main(String[] args) {
        // 高額ギフトの連打で count=100 が届いても、鶏は 200×3 = 600 羽まで。
        same(3, EffectLimits.clamp("chickenrain", 100), "chickenrain capped");
        same(2, EffectLimits.clamp("zombiewave", 50), "zombiewave capped");
        same(3, EffectLimits.clamp("anvildrop", 4), "anvildrop capped");
        same(10, EffectLimits.clamp("superjump", 100000), "superjump capped");
        // 上限以下はそのまま。0 以下が来ても 1 回は実行する（呼び出し側は 1 以上を渡す）。
        same(1, EffectLimits.clamp("meteor", 1), "meteor below cap");
        same(2, EffectLimits.clamp("volcano", 2), "volcano below cap");
        same(1, EffectLimits.clamp("bullettime", 0), "minimum one");
        // count を使わない大技・ゲームMODのキーは変えない。
        same(7, EffectLimits.clamp("storm", 7), "storm untouched");
        same(7, EffectLimits.clamp("witherhunt", 7), "witherhunt untouched");
        // ジャンプ：1回 32 ブロック。空中で重ねても今の位置から 320 ブロック上まで。
        same(132.0, EffectLimits.jumpTarget(100, 100, 1), "one jump");
        same(420.0, EffectLimits.jumpTarget(100, 100, 50), "jump capped from current height");
        same(420.0, EffectLimits.jumpTarget(400, 100, 1), "stacked jumps capped");
        // 上限に届いたあと、上昇して位置が上がった分だけは重ねられる。
        same(432.0, EffectLimits.jumpTarget(400, 132, 1), "stacked jump below cap");
        same(452.0, EffectLimits.jumpTarget(420, 132, 5), "rising player continues up to cap");
        System.out.println("EffectLimits contract: " + checks + " checks passed");
    }

    private static void same(Object expected, Object actual, String label) {
        checks++;
        if (!expected.equals(actual)) throw new AssertionError(label + ": expected " + expected + " but was " + actual);
    }
}
