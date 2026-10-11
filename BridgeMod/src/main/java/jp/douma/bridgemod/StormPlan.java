package jp.douma.bridgemod;

/**
 * 嵐の大きさ。送られた数 N だけ、雷も雨も N 倍にする（2026-10-11 ユーザーの決定）。
 * Minecraft に依存しない（scripts/test-bridge-contracts.cjs の契約テストで確かめる）。
 */
final class StormPlan {
    /** 嵐1個の雷の数。 */
    static final int BOLTS = 20;
    /** 嵐1個の雨の長さ（ミリ秒、3分）。 */
    static final long RAIN_MILLIS = 180_000L;

    /** 落とす雷の数。1 未満は 1 個とみなす。 */
    static int bolts(int count) { return Math.multiplyExact(BOLTS, Math.max(1, count)); }

    /** 雨が止む時刻。嵐の雨が残っていれば、その残りに足す（次の嵐で上書きして短くしない）。 */
    static long rainEnd(long now, Long currentEnd, int count) {
        long from = currentEnd == null ? now : Math.max(now, currentEnd);
        return from + RAIN_MILLIS * Math.max(1, count);
    }

    /** Minecraft に渡す雨の長さ（tick）。int に収める（約3.4年で頭打ち。強さの上限ではなく型の範囲）。 */
    static int rainTicks(long now, long end) {
        long ticks = Math.max(0, end - now) / 50;
        return (int) Math.min(Integer.MAX_VALUE, ticks);
    }
}
