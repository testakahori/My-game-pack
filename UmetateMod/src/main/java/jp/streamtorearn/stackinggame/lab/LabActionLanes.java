package jp.streamtorearn.stackinggame.lab;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 研究室の5つ（otasuke・mofumofu・stamp・atamahuttou・zigoku）の順番待ち（埋め立て PR1 の最後のレビュー 重要4。2026-10-26 ユーザーの決定）。
 * <ul>
 *   <li>名前ごとに1列。同じ名前のギフトは届いた順。回数の分だけ 1秒（20 tick）おきに起こす
 *       （黒曜石スタンプ・頭沸騰は、毎回その時のプレイヤーの位置をねらうので、追いかけるように落ちる）。</li>
 *   <li>列が空のときに届いたギフトの1回目は、すぐ起こす（今までどおり）。</li>
 *   <li>復元・地震・光のあいだ（blocked）は、どの列も待つ。地獄の列は、研究室が落ち着く（labIdle）まで待つ（何回でも地獄に落ちる）。</li>
 * </ul>
 * Forge の型を使わない（scripts/test-soutenmon-contracts.cjs の javac の確かめで使う）。
 */
public final class LabActionLanes {
    public static final int SPACING_TICKS = 20;
    public static final String ZIGOKU = "zigoku";

    /** いま起こす1回。 */
    public static final class Run {
        private final Gift gift;
        private Run(Gift gift) { this.gift = gift; }
        public String key() { return gift.key; }
        public String listener() { return gift.listener; }
        /** そのギフトで送られた回数（表示に使う）。 */
        public int count() { return gift.count; }
        /** offer が返した受付票のギフトの1回か。 */
        public boolean isFor(Object ticket) { return gift == ticket; }
        /** ギフトの表示を出してよいか。そのギフトで初めて呼んだときだけ true。 */
        public boolean claimDisplay() {
            if (gift.shown) return false;
            gift.shown = true;
            return true;
        }
    }

    private static final class Gift {
        final String key, listener;
        final int count;
        final boolean immediate;
        int left;
        boolean started, shown;
        Gift(String key, int count, String listener, boolean immediate) {
            this.key = key; this.count = count; this.listener = listener; this.immediate = immediate; this.left = count;
        }
    }

    private final Map<String, ArrayDeque<Gift>> lanes = new LinkedHashMap<>();
    private final Map<String, Long> lastRun = new HashMap<>();

    /** ギフトを列に並べる。返す受付票で、due が返した1回がこのギフトのものかを見分けられる（Run.isFor）。 */
    public synchronized Object offer(String key, int count, String listener) {
        if (count < 1) throw new IllegalArgumentException("count must be 1 or more: " + count);
        String k = key.toLowerCase(Locale.ROOT);
        ArrayDeque<Gift> lane = lanes.computeIfAbsent(k, ignored -> new ArrayDeque<>());
        Gift gift = new Gift(k, count, listener == null ? "" : listener, lane.isEmpty());
        lane.addLast(gift);
        return gift;
    }

    /** tick のいま起こす分。名前ごとに多くて1つ。 */
    public synchronized List<Run> due(long tick, boolean blocked, boolean labIdle) {
        List<Run> runs = new ArrayList<>();
        if (blocked) return runs;
        for (Map.Entry<String, ArrayDeque<Gift>> entry : lanes.entrySet()) {
            Gift head = entry.getValue().peekFirst();
            if (head == null) continue;
            if (head.key.equals(ZIGOKU) && !labIdle) continue;
            Long last = lastRun.get(head.key);
            boolean spaced = last == null || tick - last >= SPACING_TICKS;
            if (!spaced && !(head.immediate && !head.started)) continue;
            head.started = true;
            if (--head.left == 0) entry.getValue().pollFirst();
            lastRun.put(head.key, tick);
            runs.add(new Run(head));
        }
        return runs;
    }

    public synchronized int pending(String key) {
        ArrayDeque<Gift> lane = lanes.get(key.toLowerCase(Locale.ROOT));
        int total = 0;
        if (lane != null) for (Gift gift : lane) total += gift.left;
        return total;
    }

    public synchronized int pending() {
        int total = 0;
        for (ArrayDeque<Gift> lane : lanes.values()) for (Gift gift : lane) total += gift.left;
        return total;
    }

    /** /umetate reset とサーバーの停止のとき、待っている分を全部捨てる。 */
    public synchronized void clear() {
        lanes.clear();
        lastRun.clear();
    }
}
