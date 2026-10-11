package jp.douma.bridgemod;

/** Vanilla airborne vertical drag/gravity. Solve for height, never scale raw velocity by gift count. */
final class JumpPhysics {
    /** ジャンプ1回あたりの高さ（ブロック）。 */
    static final int JUMP_HEIGHT = 32;

    /** 連続ジャンプの目標の高さ。今の目標に 32×count を足すだけで、上限はない（2026-10-11 ユーザーの決定）。 */
    static double stackTarget(double currentTarget, int count) {
        return currentTarget + JUMP_HEIGHT * (double) Math.max(1, count);
    }

    static double heightForVelocity(double velocity) {
        double height = 0;
        for (int i = 0; i < 1000 && velocity > 0; i++) { height += velocity; velocity = (velocity - 0.08) * 0.98; }
        return height;
    }
    static double velocityForHeight(double height) {
        double low = 0, high = 3.8;
        for (int i = 0; i < 48; i++) {
            double mid = (low + high) / 2;
            if (heightForVelocity(mid) < height) low = mid; else high = mid;
        }
        return high;
    }
}
