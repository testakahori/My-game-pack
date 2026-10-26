package jp.streamtorearn.stackinggame.lab;

/** 完成ワールドの座標。階の間隔には床下の石と岩盤も含む。 */
public final class LabLayout {
    public static final int MIN = -32, MAX = 32, WIDTH = 65;
    public static final int HEIGHT = 42, TOP_BASE = 42, TOP_FLOOR = 48, HELL_FLOOR = -36;
    public static final int VOLUME = WIDTH * WIDTH * HEIGHT;
    public static final long VISIT_MILLIS = 300_000L;
    public static final int QUAKE_TICKS = 100, FLASH_TICKS = 40;
    // 3階の中央の枠の内側（埋め立て PR1。2026-10-26 ユーザーの決定「16段」）。勝ちの判定と、研究室マップのアリーナの範囲に使う。
    public static final int FRAME_MIN_X = -6, FRAME_MAX_X = 6, FRAME_MIN_Z = -6, FRAME_MAX_Z = 6, FRAME_MIN_Y = 49, FRAME_MAX_Y = 64;
    public static final int FRAME_VOLUME = (FRAME_MAX_X - FRAME_MIN_X + 1) * (FRAME_MAX_Y - FRAME_MIN_Y + 1) * (FRAME_MAX_Z - FRAME_MIN_Z + 1);
    private LabLayout() {}
    public static boolean inFrame(int x, int y, int z) {
        return x >= FRAME_MIN_X && x <= FRAME_MAX_X && y >= FRAME_MIN_Y && y <= FRAME_MAX_Y && z >= FRAME_MIN_Z && z <= FRAME_MAX_Z;
    }
    public static int x(int index) { return MIN + index % WIDTH; }
    public static int z(int index) { return MIN + (index / WIDTH) % WIDTH; }
    public static int y(int index) { return index / (WIDTH * WIDTH); }
    public static boolean onTop(double x, double y, double z) {
        return x >= MIN && x < MAX + 1 && z >= MIN && z < MAX + 1 && y >= TOP_BASE && y < 96;
    }
    public static int remainingSeconds(long deadline, long now) {
        return (int) Math.max(0, Math.min(300, (deadline - now + 999) / 1000));
    }
    public static String countdown(long deadline, long now) {
        int seconds = remainingSeconds(deadline, now);
        return String.format(java.util.Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60);
    }
}
