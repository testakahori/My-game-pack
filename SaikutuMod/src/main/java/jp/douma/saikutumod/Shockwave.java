package jp.douma.saikutumod;

/**
 * TNT大爆発の衝撃波の形と進み方。Minecraft に依存しない（scripts/test-bridge-contracts.cjs の契約テストで確かめる）。
 * 爆心を中心にした楕円体：横の半径 R = 48×N、上下の半径 D = 11×N。今の穴（2026-10-11、count=1 の実測）を N 倍にした形。
 * 横に毎秒40ブロック（1 tick 2ブロック）で広がる。
 */
final class Shockwave {
    static final int BASE_RADIUS = 48;
    static final int BASE_DEPTH = 11;
    static final double BLOCKS_PER_TICK = 2.0;

    final int radius, depth, limit;
    // 調べる範囲（横 limit・上 up・下 down）の一番遠い角までの距離。ここまでえぐったら、もうえぐる所も先端が通る所もない。
    private final double end;
    private double reached;

    /**
     * count は送られた TNT大爆発の数（1 未満は 1）。limit は横に調べる最大の距離（読み込まれている範囲）。
     * up・down は爆心から建築できる高さの上端・下端までのブロック数。大きな N で、えぐる所がないのに端（R/2 tick）まで続けない。
     */
    Shockwave(int count, int limit, int up, int down) {
        int n = Math.max(1, count);
        radius = Math.multiplyExact(BASE_RADIUS, n);
        depth = Math.multiplyExact(BASE_DEPTH, n);
        this.limit = Math.max(0, limit);
        end = Math.min(1, distance(this.limit, Math.max(0, Math.max(up, down)), this.limit));
    }

    /** 爆心からの正規化した距離。1 以下が楕円体の内側。 */
    double distance(int dx, int dy, int dz) {
        double h = ((double) dx * dx + (double) dz * dz) / ((double) radius * radius);
        return Math.sqrt(h + (double) dy * dy / ((double) depth * depth));
    }

    /**
     * 距離 s の生き物を、殻 (from, to] の先端で爆発させるか。最初の殻（from が 0）は爆心も入る。
     * 殻の内側は前の殻で済んでいるので、あとから来た生き物は爆発させない。ただし衝撃波が始まったときにいた生き物（present）は、
     * 足場が先にえぐられて先端の内側へ落ちることがあるので、先端が来たら爆発させる（PR #75 再レビュー）。
     */
    static boolean hits(double s, double from, double to, boolean present) { return s <= to && (from <= 0 || s > from || present); }

    boolean finished() { return reached >= end; }
    double reached() { return reached; }

    /** 次の殻の外側。1 tick に 2/R ずつ進み、1 で止まる。足し算を積み重ねると端の手前に誤差が残るので、何殻目かから計算する。 */
    double nextReach() {
        long shell = Math.round(reached * radius / BLOCKS_PER_TICK);
        return Math.min(1, (shell + 1) * BLOCKS_PER_TICK / radius);
    }

    /** 殻をえぐり終えたら呼ぶ。 */
    void advanceTo(double to) { reached = Math.max(reached, Math.min(1, to)); }

    /** 殻の外側が to のときに調べる列の、横の最大距離（ブロック）。読み込まれている範囲を超えない。 */
    int columnReach(double to) { return (int) Math.min(limit, Math.ceil(to * radius)); }

    /**
     * 列 (dx, dz) で、正規化した距離が (from, to] に入る |dy| の範囲 {min, max}。入らなければ null。
     * 上（+dy）と下（-dy）の両方に同じ範囲がある。from が 0 の最初の殻は dy=0 も含む。
     * 前の殻の to と次の殻の from は同じ値で計算するので、殻と殻の間に抜けも重なりもない。
     */
    int[] verticalBand(int dx, int dz, double from, double to) {
        double h = ((double) dx * dx + (double) dz * dz) / ((double) radius * radius);
        double d2 = (double) depth * depth;
        double hi = d2 * (to * to - h);
        if (hi < 0) return null;
        int max = (int) Math.floor(Math.sqrt(hi) + 1e-9);
        double lo = d2 * (from * from - h);
        int min = (from <= 0 || lo < 0) ? 0 : (int) Math.floor(Math.sqrt(lo) + 1e-9) + 1;
        return min > max ? null : new int[] { min, max };
    }

    /** 横の距離 r（ブロック）での、爆心から下へのえぐる深さ。 */
    double depthAt(double r) {
        double q = 1 - (r * r) / ((double) radius * radius);
        return q <= 0 ? 0 : depth * Math.sqrt(q);
    }
}
