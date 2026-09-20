package jp.douma.doumacmd;

/** Vanilla airborne vertical drag/gravity. Solve for height, never scale raw velocity by gift count. */
final class JumpPhysics {
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
