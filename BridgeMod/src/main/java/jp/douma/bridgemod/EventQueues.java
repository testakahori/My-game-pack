package jp.douma.bridgemod;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * BridgeMOD の待ち列（ギフト・いいね・そのほか）。Minecraft に頼らない形にして、動きを JUnit（EventQueuesTest）で確かめる（2026-11-07 品質レビュー）。
 * <ul>
 *   <li>種類ごとに上限を分ける。いいねが溜まってもギフトは断らない。いっぱいなら FULL（HTTP 429）で、古い分は捨てない（BRIDGE が先頭を預かって送り直す）。</li>
 *   <li>BRIDGE は応答が 1.5 秒来ないと、同じ要求 ID で送り直す。受け付けた ID を新しい順に REMEMBERED_REQUEST_IDS 件覚え、
 *       同じ ID がまた来たら積まずに DUPLICATE を返す（重い配信 PC で、ギフトが2回動かないように）。</li>
 *   <li>1 tick に動かすコマンドは 60 まで。いいねに 8 を取っておき、ギフト・そのほかが残りを使う。大きな repeat も複数の tick に分ける。</li>
 *   <li>一時停止の間は取り出さない。受付は続ける（2026-10-16 ユーザーの決定）。</li>
 * </ul>
 * 受付は HTTP のスレッド、取り出しはサーバーのスレッドから呼ぶ。待ち列と覚えた ID は、このオブジェクトの鍵で守る。
 */
final class EventQueues<E extends EventQueues.Event> {
    static final int MAX_GIFT_QUEUE = 600;
    static final int MAX_LIKE_QUEUE = 120;
    static final int MAX_OTHER_QUEUE = 280;
    // 1tickあたりの実行コマンド予算：repeat大のギフトも複数tickへ分割してTPS低下を防ぐ
    static final int MAX_COMMANDS_PER_TICK = 60;
    // ギフト連続時でも、いいねが完全に止まらないように予約する予算
    static final int LIKE_RESERVED_COMMANDS_PER_TICK = 8;
    // 覚えておく要求 ID の数。送り直しは数秒のうちに来るので、配信が混んでも十分に足りる。
    static final int REMEMBERED_REQUEST_IDS = 4096;

    enum Offer { ACCEPTED, DUPLICATE, FULL }

    /** 待ちに積むもの。type が gift・like 以外なら、そのほかの待ちに入る。 */
    static class Event {
        final String type;
        // サーバーの tick だけが減らす（/bridge/control で捨てたときは 0 にする）。HTTP の要求が実行中のイベントに混ざることはない。
        volatile int remaining;
        // BRIDGE が付けた要求 ID（送り直しでも同じ）。ゲーム内の /bridge と /bridge/exec は null で、重複を見ない。
        String requestId;

        Event(String type, int remaining) {
            this.type = type;
            this.remaining = remaining;
        }
    }

    /** 1件をこの tick の残りの予算で動かし、使ったコマンドの数を返す。動かした分だけ remaining を減らす。 */
    interface Slice<T> {
        int run(T event, int budget);
    }

    record Sizes(int gift, int like, int other) {}

    private final Deque<E> gift = new ArrayDeque<>();
    private final Deque<E> like = new ArrayDeque<>();
    private final Deque<E> other = new ArrayDeque<>();
    // 受け付けた要求 ID（古い順）。実行が終わったあとも覚えておく（終わってから届いた送り直しも動かさない）。
    private final Set<String> acceptedIds = new LinkedHashSet<>();
    private volatile boolean paused;

    synchronized Offer offer(E event) {
        String id = event.requestId == null || event.requestId.isEmpty() ? null : event.requestId;
        // 受け付け済みの送り直しは、待ちがいっぱいでも DUPLICATE（429 にすると BRIDGE は送り直し続け、そのうち2回目が積まれる）。
        if (id != null && acceptedIds.contains(id)) return Offer.DUPLICATE;
        Deque<E> queue = lane(event.type);
        // Backpressure: the sender retains the head until accepted. Never discard an older event.
        if (queue.size() >= limit(queue)) return Offer.FULL;
        queue.addLast(event);
        if (id != null) {
            acceptedIds.add(id);
            if (acceptedIds.size() > REMEMBERED_REQUEST_IDS) {
                Iterator<String> oldest = acceptedIds.iterator();
                oldest.next();
                oldest.remove();
            }
        }
        return Offer.ACCEPTED;
    }

    /** 止めていなくて、待ちに何かあるとき true。 */
    synchronized boolean hasWork() {
        return !paused && (!gift.isEmpty() || !like.isEmpty() || !other.isEmpty());
    }

    /** サーバーのスレッドから tick ごとに呼ぶ。止めている間は何もしない。 */
    void process(Slice<E> slice) {
        if (paused) return;
        // Gift work is independent. Likes cannot borrow unused gift budget and cause a burst.
        int budget = MAX_COMMANDS_PER_TICK - LIKE_RESERVED_COMMANDS_PER_TICK;
        budget -= drain(gift, budget, slice);
        budget -= drain(other, budget, slice);
        drain(like, LIKE_RESERVED_COMMANDS_PER_TICK, slice);
    }

    /**
     * 待ちの先頭から予算の中で動かし、使ったコマンドの数を返す。
     * イベントの残りが予算を超えたとき（ゲームMODの WAIT を含む）は途中で止め、次の tick で先頭から続きを動かす。
     */
    private int drain(Deque<E> queue, int budget, Slice<E> slice) {
        int used = 0;
        while (used < budget) {
            E event;
            synchronized (this) {
                event = queue.peekFirst();
            }
            if (event == null) break;
            used += slice.run(event, budget - used);
            if (event.remaining > 0) break; // 予算切れ：次tickで続きから
            synchronized (this) {
                // 実行中に待ちを捨てられた（/bridge/control）ときは、あとから入った別のイベントを取り出さない。
                if (queue.peekFirst() == event) queue.pollFirst();
            }
        }
        return used;
    }

    /** いいねの待ちを捨て、捨てた件数を返す。実行中のいいねも残りを0にして止める（実行中の1回分は終わる）。ギフト・そのほかは捨てない。 */
    synchronized int discardLikes() {
        int discarded = like.size();
        for (E event : like) event.remaining = 0;
        like.clear();
        return discarded;
    }

    boolean paused() {
        return paused;
    }

    void setPaused(boolean value) {
        paused = value;
    }

    /** 3つの待ちの件数を同じ時点で数える。どのスレッドから呼んでもよい。 */
    synchronized Sizes sizes() {
        return new Sizes(gift.size(), like.size(), other.size());
    }

    /** サーバーを止めたとき。待ちと覚えた ID を消し、一時停止も解く（次の起動は止めていない状態で始まる）。 */
    synchronized void clear() {
        gift.clear();
        like.clear();
        other.clear();
        acceptedIds.clear();
        paused = false;
    }

    private Deque<E> lane(String type) {
        return "gift".equals(type) ? gift : "like".equals(type) ? like : other;
    }

    private int limit(Deque<E> queue) {
        return queue == gift ? MAX_GIFT_QUEUE : queue == like ? MAX_LIKE_QUEUE : MAX_OTHER_QUEUE;
    }
}
