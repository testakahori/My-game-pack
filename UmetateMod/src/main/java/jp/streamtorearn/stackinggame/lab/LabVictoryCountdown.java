package jp.streamtorearn.stackinggame.lab;

/**
 * 勝ちのカウントダウンの決まり（埋め立て PR1。2026-10-26 ユーザーの決定）。
 * 枠の内側が金とダイヤで全部埋まったら 10 から数え、途中で1マスでも欠けたら止まる。0 で勝ち。
 * 勝ったあとは、いったん空く（枠を消す）まで数え直さない。20 tick を1秒とする。Forge の型を使わない。
 */
public final class LabVictoryCountdown {
    public enum Signal { NONE, START, SECOND, STOP, WIN }
    public static final int SECONDS = 10, TICKS_PER_SECOND = 20;

    private boolean counting;
    private boolean armed = true;
    private long startTick;
    private int secondsLeft;

    /** 枠が埋まっているか（filled）を、いまの tick で知らせる。何をすればよいかを返す。毎 tick でなくてよい。 */
    public Signal update(boolean filled, long tick) {
        if (!filled) {
            armed = true;
            if (!counting) return Signal.NONE;
            counting = false;
            return Signal.STOP;
        }
        if (!counting) {
            if (!armed) return Signal.NONE;
            counting = true; startTick = tick; secondsLeft = SECONDS;
            return Signal.START;
        }
        long elapsed = tick - startTick;
        if (elapsed >= (long) SECONDS * TICKS_PER_SECOND) {
            counting = false; armed = false; secondsLeft = 0;
            return Signal.WIN;
        }
        int left = SECONDS - (int) (elapsed / TICKS_PER_SECOND);
        if (left == secondsLeft) return Signal.NONE;
        secondsLeft = left;
        return Signal.SECOND;
    }

    public int secondsLeft() { return secondsLeft; }
    public boolean counting() { return counting; }
}
