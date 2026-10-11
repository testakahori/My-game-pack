package jp.douma.saikutumod;

import java.util.HashSet;
import java.util.Set;

// TNT大爆発の衝撃波の形（今の穴を横も深さも N 倍）と進み方（1 tick 2ブロック）を Minecraft なしで確かめる。
public final class ShockwaveContractTest {
    private static int checks;

    public static void main(String[] args) {
        Shockwave one = new Shockwave(1, 1000), two = new Shockwave(2, 1000), four = new Shockwave(4, 1000);
        same(48, one.radius, "N=1 radius"); same(11, one.depth, "N=1 depth");
        same(96, two.radius, "N=2 radius"); same(22, two.depth, "N=2 depth");
        same(192, four.radius, "N=4 radius"); same(44, four.depth, "N=4 depth");
        same(48, new Shockwave(0, 1000).radius, "count below one is one");
        // 楕円体の端と中心。
        near(0, one.distance(0, 0, 0), "centre"); near(1, one.distance(48, 0, 0), "edge x"); near(1, one.distance(0, 0, -48), "edge z");
        near(1, one.distance(0, 11, 0), "edge up"); near(1, one.distance(0, -11, 0), "edge down");
        // N=1 の深さは、2026-10-11 の実測（半径25で9〜11、36で7〜8、44で4）と合う。
        between(9, 10, one.depthAt(25), "depth at 25"); between(7, 8, one.depthAt(36), "depth at 36"); between(4, 5, one.depthAt(44), "depth at 44");
        near(0, one.depthAt(48), "depth at the rim");
        // 1 tick 2ブロックで広がり、R/2 tick で端に届く。
        same(24, ticksToFinish(new Shockwave(1, 1000)), "N=1 finishes in 24 ticks");
        same(48, ticksToFinish(new Shockwave(2, 1000)), "N=2 finishes in 48 ticks");
        // 横に調べる範囲は、読み込まれている範囲（limit）で止まる。とても大きな N でも桁あふれしない。
        same(128, new Shockwave(4, 128).columnReach(1), "reach is capped by the loaded area");
        same(24, new Shockwave(1, 128).columnReach(0.5), "reach follows the front");
        same(128, new Shockwave(100000, 128).columnReach(1), "huge N stays within the loaded area");
        // すべての殻を合わせると、楕円体の内側とちょうど一致する（抜けも重なりもない。爆心の列の dy=0 も入る）。
        for (int[] c : new int[][] { {0, 0}, {10, 5}, {30, 20}, {47, 0}, {48, 0}, {0, 48}, {34, 34} }) coverage(new Shockwave(1, 1000), c[0], c[1]);
        for (int[] c : new int[][] { {0, 0}, {60, 30}, {95, 0} }) coverage(new Shockwave(2, 1000), c[0], c[1]);
        System.out.println("Shockwave contract: " + checks + " checks passed");
    }

    private static int ticksToFinish(Shockwave w) {
        int ticks = 0;
        while (!w.finished()) { w.advanceTo(w.nextReach()); ticks++; if (ticks > 100000) throw new AssertionError("never finishes"); }
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
