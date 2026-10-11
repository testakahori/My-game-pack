package jp.douma.bridgemod;

// スーパージャンプの高さに上限がないこと（2026-10-11 ユーザーの決定）を Minecraft なしで確かめる。
public final class JumpPhysicsContractTest {
    private static int checks;

    public static void main(String[] args) {
        same(32, JumpPhysics.JUMP_HEIGHT, "one jump is 32 blocks");
        same(132.0, JumpPhysics.stackTarget(100, 1), "one jump");
        same(100.0 + 32 * 100, JumpPhysics.stackTarget(100, 100), "100 jumps, no cap");
        same(132.0, JumpPhysics.stackTarget(100, 0), "at least one jump");
        // 空中で何度重ねても上限はない（以前は最初の高さ＋320 で止まった）。
        double target = 100;
        for (int i = 0; i < 20; i++) target = JumpPhysics.stackTarget(target, 10);
        same(100.0 + 32 * 200, target, "stacked jumps keep adding");
        // 上昇の速さの計算は今のまま。
        check(JumpPhysics.heightForVelocity(JumpPhysics.velocityForHeight(32)) >= 32, "velocity reaches the height");
        System.out.println("JumpPhysics contract: " + checks + " checks passed");
    }

    private static void check(boolean ok, String name) { checks++; if (!ok) throw new AssertionError(name); }
    private static void same(Object expected, Object actual, String name) {
        checks++;
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError(name + ": expected " + expected + " but was " + actual);
    }
}
