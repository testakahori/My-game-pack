package jp.douma.saikutumod;

import java.util.HashSet;
import java.util.Set;

// TNT大爆発の衝撃波の形（今の穴を横も深さも N 倍）と進み方（1 tick 2ブロック）を Minecraft なしで確かめる。
public final class ShockwaveContractTest {
    private static int checks;
    // 上下の調べる範囲を気にしないときの値（楕円体の端まで進む）。
    private static final int TALL = 1_000_000_000;

    public static void main(String[] args) {
        Shockwave one = wave(1, 1000), two = wave(2, 1000), four = wave(4, 1000);
        same(48, one.radius, "N=1 radius"); same(11, one.depth, "N=1 depth");
        same(96, two.radius, "N=2 radius"); same(22, two.depth, "N=2 depth");
        same(192, four.radius, "N=4 radius"); same(44, four.depth, "N=4 depth");
        same(48, wave(0, 1000).radius, "count below one is one");
        // 楕円体の端と中心。
        near(0, one.distance(0, 0, 0), "centre"); near(1, one.distance(48, 0, 0), "edge x"); near(1, one.distance(0, 0, -48), "edge z");
        near(1, one.distance(0, 11, 0), "edge up"); near(1, one.distance(0, -11, 0), "edge down");
        // N=1 の深さは、2026-10-11 の実測（半径25で9〜11、36で7〜8、44で4）と合う。
        between(9, 10, one.depthAt(25), "depth at 25"); between(7, 8, one.depthAt(36), "depth at 36"); between(4, 5, one.depthAt(44), "depth at 44");
        near(0, one.depthAt(48), "depth at the rim");
        // 1 tick 2ブロックで広がり、R/2 tick で端に届く。
        same(24, ticksToFinish(wave(1, 1000)), "N=1 finishes in 24 ticks");
        same(48, ticksToFinish(wave(2, 1000)), "N=2 finishes in 48 ticks");
        // 横に調べる範囲は、読み込まれている範囲（limit）で止まる。とても大きな N でも桁あふれしない。
        same(128, wave(4, 128).columnReach(1), "reach is capped by the loaded area");
        same(24, wave(1, 128).columnReach(0.5), "reach follows the front");
        same(128, wave(100000, 128).columnReach(1), "huge N stays within the loaded area");
        // すべての殻を合わせると、楕円体の内側とちょうど一致する（抜けも重なりもない。爆心の列の dy=0 も入る）。
        for (int[] c : new int[][] { {0, 0}, {10, 5}, {30, 20}, {47, 0}, {48, 0}, {0, 48}, {34, 34} }) coverage(wave(1, 1000), c[0], c[1]);
        for (int[] c : new int[][] { {0, 0}, {60, 30}, {95, 0} }) coverage(wave(2, 1000), c[0], c[1]);
        reachEnd();
        hits();
        loadedArea();
        System.out.println("Shockwave contract: " + checks + " checks passed");
    }

    private static Shockwave wave(int count, int limit) { return new Shockwave(count, limit, TALL, TALL); }

    // 調べる範囲（横は limit、上は up・下は down ブロック）をえぐり終えたら終わる。大きな N で、えぐる所がないのに何十分も続かない（PR #75 レビュー）。
    private static void reachEnd() {
        Shockwave big = new Shockwave(1000, 192, 379, 4);
        double end = big.distance(192, 379, 192);
        int ticks = ticksToFinish(big);
        check(ticks < 1000, "N=1000 within 192 blocks and 379 up ends early: " + ticks + " ticks (R/2 = 24000)");
        check(big.reached() >= end, "it ends only after the farthest corner of the scan box");
        check(big.reached() - Shockwave.BLOCKS_PER_TICK / big.radius < end, "and not a shell later");
        // 上下が楕円体より高い（小さな N）なら、今までどおり端（R/2 tick）まで進む。
        same(48, ticksToFinish(new Shockwave(2, 192, 379, 128)), "N=2 still reaches the rim");
        // 一番遠い角までの距離が 1 を超えるなら 1 で止まる。とても大きな N でも例外にならない。
        same(24, ticksToFinish(new Shockwave(1, 1000, 1000, 1000)), "N=1 stops at the rim");
        check(ticksToFinish(new Shockwave(100000, 544, 400, 400)) < 100000, "N=100000 ends");
    }

    // 生き物を爆発させるのは、その殻で先端が通った所（from より外・to まで）。最初の殻は爆心（0）も入る。
    // 衝撃波が始まったときにいた生き物は、足場がえぐられて先端の内側へ落ちても、先端が来たら爆発させる（PR #75 再レビュー）。
    private static void hits() {
        check(Shockwave.hits(0, 0, 0.04, false), "the centre is hit by the first shell");
        check(Shockwave.hits(0.5, 0.48, 0.5, false), "on the outer edge of the shell");
        check(!Shockwave.hits(0.48, 0.48, 0.5, false), "the inner edge belongs to the previous shell");
        check(!Shockwave.hits(0.2, 0.48, 0.5, false), "a newcomer behind the front is not hit");
        check(Shockwave.hits(0.2, 0.48, 0.5, true), "a mob that was there at the start and fell behind the front is hit");
        check(!Shockwave.hits(0.51, 0.48, 0.5, false) && !Shockwave.hits(0.51, 0.48, 0.5, true), "ahead of the front is not hit yet");
    }

    // 触ってよいのは、周りのチャンクまで読み込み済みの所だけ。読み込まれていないチャンクに触ると、サーバーがその場で読み込む（PR #75 レビュー）。
    private static void loadedArea() {
        // チャンクの x が 2 以下、z が -6〜5 だけ読み込み済み（ブロックの x は 47 まで、z は -96〜95）。
        int[] calls = {0};
        LoadedArea area = new LoadedArea(0, 0, 100, (cx, cz) -> { calls[0]++; return cx <= 2 && cz >= -6 && cz <= 5; });
        same(14 * 14, calls[0], "each chunk of the square is looked up once (x and z: chunks -7..6 for 0 ± 100)");
        check(area.around(46, 0, 1), "x 45..47 are loaded");
        check(!area.around(47, 0, 1), "x 48 is in an unloaded chunk");
        check(area.around(39, 0, 8), "an explosion at x 39 reaches x 47");
        check(!area.around(40, 0, 8), "an explosion at x 40 reaches x 48");
        check(area.around(0, 95, 0) && !area.around(0, 95, 1), "z edge");
        check(area.around(-1, -96, 0) && !area.around(-1, -96, 1), "negative coordinates use floor chunks");
        check(!area.around(-200, 0, 0), "outside the looked-up square counts as unloaded");
        check(area.around(0, 0, 20), "a margin wider than a chunk checks every chunk it covers");
        // 余白16は「その列のチャンクと周り8チャンク」、32は「周り2チャンクまで」と同じ（チャンクの中のどこでも）。
        check(area.around(16, 0, 16) && area.around(31, 0, 16), "margin 16: a column in chunk 1 needs chunks 0..2, all loaded");
        check(!area.around(32, 0, 16) && !area.around(47, 0, 16), "margin 16: a column in chunk 2 needs chunk 3, not loaded");
        check(area.around(0, 0, 32) && !area.around(0, 80, 32), "margin 32 = two chunks around");
        // x・z とも -30〜10（チャンク -2〜0）。穴のチャンク (-1, -1) は四隅でなく真ん中にある。
        check(!new LoadedArea(0, 0, 100, (cx, cz) -> !(cx == -1 && cz == -1)).around(-10, -10, 20), "a hole in the middle is found");
    }

    private static int ticksToFinish(Shockwave w) {
        int ticks = 0;
        while (!w.finished()) { w.advanceTo(w.nextReach()); ticks++; if (ticks > 3000000) throw new AssertionError("never finishes"); }
        return ticks;
    }

    private static void coverage(Shockwave w, int dx, int dz) {
        Set<Integer> carved = new HashSet<>();
        while (!w.finished()) {
            double from = w.reached(), to = w.nextReach();
            int[] band = w.verticalBand(dx, dz, from, to);
            if (band != null) for (int a = band[0]; a <= band[1]; a++) {
                check(carved.add(a), "no overlap at dy=" + a + " column " + dx + "," + dz);
                if (a != 0) check(carved.add(-a), "no overlap at dy=" + -a + " column " + dx + "," + dz);
            }
            w.advanceTo(to);
        }
        Set<Integer> expected = new HashSet<>();
        for (int dy = -w.depth - 1; dy <= w.depth + 1; dy++) if (w.distance(dx, dy, dz) <= 1 + 1e-9) expected.add(dy);
        same(expected, carved, "column " + dx + "," + dz + " carves exactly the inside");
    }

    private static void check(boolean ok, String name) { checks++; if (!ok) throw new AssertionError(name); }
    private static void near(double expected, double actual, String name) { checks++; if (Math.abs(expected - actual) > 1e-9) throw new AssertionError(name + ": expected " + expected + " but was " + actual); }
    private static void between(double lo, double hi, double actual, String name) { checks++; if (actual < lo || actual > hi) throw new AssertionError(name + ": " + actual + " not in " + lo + ".." + hi); }
    private static void same(Object expected, Object actual, String name) {
        checks++;
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError(name + ": expected " + expected + " but was " + actual);
    }
}
