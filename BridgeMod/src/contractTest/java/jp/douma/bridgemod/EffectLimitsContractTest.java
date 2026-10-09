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
        // ジャンプ：1回 32 ブロック。空中で重ねても、連続ジャンプを始めた高さから 320 ブロック上まで。
        same(132.0, EffectLimits.jumpTarget(100, 100, 1), "one jump");
        same(420.0, EffectLimits.jumpTarget(100, 100, 50), "jump capped from the base height");
        same(420.0, EffectLimits.jumpTarget(400, 100, 1), "stacked jumps capped");
        same(132.0, EffectLimits.jumpTarget(100, 100, 1), "base is the height of the first jump");
        // 上昇中・頂上で何度重ねても上限は動かない（以前は今の位置が基準で、重ねるたびに上限も上がった）。
        double target = 100;
        for (int i = 0; i < 20; i++) target = EffectLimits.jumpTarget(target, 100, 10);
        same(420.0, target, "repeated max jumps never exceed base + 320");
        same(320, EffectLimits.MAX_JUMP_RISE, "max rise");
        // 連続ジャンプの記録：最初に跳んだ高さが基準。上昇中・頂上のどこで何回重ねても上限は動かない。
        EffectLimits.JumpChain chain = new EffectLimits.JumpChain(100);
        same(132.0, chain.stack(1), "chain first jump");
        for (int i = 0; i < 20; i++) chain.stack(10);
        same(420.0, chain.target(), "chain capped at the first height + 320");
        same(100.0, chain.baseY, "chain keeps the first height");
        // 低速落下は、目標から基準の高さまで落ちきる分（1ブロック10 tick＋400）。今の位置が途中でも基準から数える。
        same(3600, chain.slowFallingTicks(420), "slow falling covers the whole drop from the top");
        same(3600, chain.slowFallingTicks(250), "slow falling measured from the base, not the current height");
        same(800, new EffectLimits.JumpChain(64).slowFallingTicks(64), "minimum slow falling");
        System.out.println("EffectLimits contract: " + checks + " checks passed");
    }

    private static void same(Object expected, Object actual, String label) {
        checks++;
        if (!expected.equals(actual)) throw new AssertionError(label + ": expected " + expected + " but was " + actual);
    }
}
