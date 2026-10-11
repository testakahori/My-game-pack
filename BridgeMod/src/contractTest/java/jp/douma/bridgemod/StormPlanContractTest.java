package jp.douma.bridgemod;

// 嵐を送られた数だけ起こすこと（雷も雨も N 倍、2026-10-11 ユーザーの決定）を Minecraft なしで確かめる。
public final class StormPlanContractTest {
    private static int checks;

    public static void main(String[] args) {
        same(20, StormPlan.bolts(1), "one storm is 20 bolts");
        same(200, StormPlan.bolts(10), "10 storms are 200 bolts");
        same(2_000_000, StormPlan.bolts(100_000), "no cap");
        same(20, StormPlan.bolts(0), "at least one storm");
        long now = 1_000_000L;
        // 雨は1個で3分。N 個なら 3分×N。
        same(now + 180_000L, StormPlan.rainEnd(now, null, 1), "one storm rains 3 minutes");
        same(now + 1_800_000L, StormPlan.rainEnd(now, null, 10), "10 storms rain 30 minutes");
        // 嵐の雨が残っているうちに次の嵐が来たら、残りに足す（上書きして短くしない）。
        same(now + 1_800_000L + 180_000L, StormPlan.rainEnd(now, now + 1_800_000L, 1), "a storm during a storm adds to what is left");
        // 終わった雨（過去の時刻）は今から数える。
        same(now + 180_000L, StormPlan.rainEnd(now, now - 5_000L, 1), "an expired storm counts from now");
        same(now + 180_000L * 100_000, StormPlan.rainEnd(now, null, 100_000), "huge counts do not overflow");
        // Minecraft に渡す雨の長さ（tick）は int に収める（約3.4年で頭打ち。強さの上限ではなく、型の範囲）。
        same(3600, StormPlan.rainTicks(now, now + 180_000L), "3 minutes is 3600 ticks");
        same(Integer.MAX_VALUE, StormPlan.rainTicks(now, now + 180_000L * 100_000 * 100), "ticks stay within int");
        same(0, StormPlan.rainTicks(now, now - 1), "never negative");
        System.out.println("StormPlan contract: " + checks + " checks passed");
    }

    private static void same(Object expected, Object actual, String name) {
        checks++;
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError(name + ": expected " + expected + " but was " + actual);
    }
}
