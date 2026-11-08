package jp.douma.bridgemod;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

// 待ち列の動き（2026-11-07 品質レビュー）。前はソースの文字を見るテストだけで、動きは実機の確かめ（BridgeMod/test）にしかなかった。
class EventQueuesTest {
    private static final class Item extends EventQueues.Event {
        final String name;

        Item(String type, String name, int count, String requestId) {
            super(type, count);
            this.name = name;
            this.requestId = requestId;
        }
    }

    /** 1回分を1コマンドとして、予算の分だけ動かす（BridgeMod の executeEventSlice と同じく remaining を減らす）。 */
    private static final class Runner implements EventQueues.Slice<Item> {
        final List<String> ran = new ArrayList<>();

        @Override
        public int run(Item event, int budget) {
            int n = Math.min(event.remaining, budget);
            for (int i = 0; i < n; i++) ran.add(event.name);
            event.remaining -= n;
            return n;
        }

        long count(String name) {
            return ran.stream().filter(name::equals).count();
        }
    }

    private static Item gift(String name, int count) { return new Item("gift", name, count, null); }
    private static Item like(String name, int count) { return new Item("like", name, count, null); }
    private static Item other(String name, int count) { return new Item("other", name, count, null); }

    @Test
    void eachLaneHasItsOwnLimitAndAFullLikeQueueDoesNotRejectGifts() {
        EventQueues<Item> queues = new EventQueues<>();
        for (int i = 0; i < EventQueues.MAX_LIKE_QUEUE; i++) assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(like("like" + i, 1)));
        assertEquals(120, EventQueues.MAX_LIKE_QUEUE);
        assertEquals(EventQueues.Offer.FULL, queues.offer(like("excess", 1)), "121件目のいいねは 429");
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(gift("rose", 1)), "いいねがいっぱいでもギフトは受ける");
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(other("manual", 1)));
        assertEquals(new EventQueues.Sizes(1, 120, 1), queues.sizes());

        for (int i = 1; i < EventQueues.MAX_GIFT_QUEUE; i++) queues.offer(gift("g" + i, 1));
        assertEquals(EventQueues.Offer.FULL, queues.offer(gift("g600", 1)));
        for (int i = 1; i < EventQueues.MAX_OTHER_QUEUE; i++) queues.offer(other("o" + i, 1));
        assertEquals(EventQueues.Offer.FULL, queues.offer(other("o280", 1)));
        // 種類が gift・like 以外なら、そのほかの待ちに入る。
        assertEquals(EventQueues.Offer.FULL, queues.offer(new Item("follow", "f", 1, null)));
        assertEquals(new EventQueues.Sizes(600, 120, 280), queues.sizes());
    }

    @Test
    void aFullQueueKeepsTheOldEventsAndTheirOrder() {
        EventQueues<Item> queues = new EventQueues<>();
        for (int i = 0; i < EventQueues.MAX_LIKE_QUEUE; i++) queues.offer(like("like" + i, 1));
        queues.offer(like("excess", 1));
        Runner runner = new Runner();
        while (queues.hasWork()) queues.process(runner);
        assertEquals(120, runner.ran.size());
        assertEquals("like0", runner.ran.get(0));
        assertEquals("like119", runner.ran.get(119));
        assertFalse(runner.ran.contains("excess"));
    }

    @Test
    void theSameRequestIdIsQueuedOnlyOnceEvenAfterItRan() {
        EventQueues<Item> queues = new EventQueues<>();
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(new Item("gift", "big", 5, "abc:0")));
        // BRIDGE が 1.5 秒で諦めて同じ番号で送り直した分。
        assertEquals(EventQueues.Offer.DUPLICATE, queues.offer(new Item("gift", "big", 5, "abc:0")));
        assertEquals(new EventQueues.Sizes(1, 0, 0), queues.sizes());
        Runner runner = new Runner();
        queues.process(runner);
        assertEquals(5, runner.count("big"));
        // 実行が終わったあとに届いた送り直しも動かさない。
        assertEquals(EventQueues.Offer.DUPLICATE, queues.offer(new Item("gift", "big", 5, "abc:0")));
        assertFalse(queues.hasWork());
        // 分けて送った次の分（番号が違う）は受ける。
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(new Item("gift", "big", 5, "abc:1")));
    }

    @Test
    void aRetryOfAnAcceptedIdIsADuplicateEvenWhenTheLaneIsFull() {
        EventQueues<Item> queues = new EventQueues<>();
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(new Item("like", "first", 1, "like-0")));
        for (int i = 1; i < EventQueues.MAX_LIKE_QUEUE; i++) queues.offer(new Item("like", "l" + i, 1, "like-" + i));
        // 429 にすると BRIDGE は送り直し続け、空いたときに2回目が積まれる。
        assertEquals(EventQueues.Offer.DUPLICATE, queues.offer(new Item("like", "first", 1, "like-0")));
        assertEquals(EventQueues.Offer.FULL, queues.offer(new Item("like", "new", 1, "like-new")));
    }

    @Test
    void aRejectedRequestIsNotRememberedSoItsRetryCanBeAccepted() {
        EventQueues<Item> queues = new EventQueues<>();
        for (int i = 0; i < EventQueues.MAX_GIFT_QUEUE; i++) queues.offer(gift("g" + i, 1));
        assertEquals(EventQueues.Offer.FULL, queues.offer(new Item("gift", "late", 1, "late:0")));
        Runner runner = new Runner();
        queues.process(runner);
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(new Item("gift", "late", 1, "late:0")), "429 のあとの送り直しは受ける");
    }

    @Test
    void eventsWithoutARequestIdAreNeverDuplicates() {
        // ゲーム内の /bridge と /bridge/exec（演出のフレーム）は番号を持たない。同じ中身でも届いた分だけ動かす。
        EventQueues<Item> queues = new EventQueues<>();
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(other("frame", 1)));
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(other("frame", 1)));
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(new Item("other", "frame", 1, "")));
        assertEquals(new EventQueues.Sizes(0, 0, 3), queues.sizes());
    }

    @Test
    void onlyTheNewestRequestIdsAreRemembered() {
        EventQueues<Item> queues = new EventQueues<>();
        Runner runner = new Runner();
        for (int i = 0; i <= EventQueues.REMEMBERED_REQUEST_IDS; i++) {
            assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(new Item("gift", "g", 1, "id-" + i)));
            queues.process(runner);
        }
        assertEquals(EventQueues.Offer.DUPLICATE, queues.offer(new Item("gift", "g", 1, "id-1")), "新しい 4096 件は覚えている");
        assertEquals(EventQueues.Offer.DUPLICATE, queues.offer(new Item("gift", "g", 1, "id-" + EventQueues.REMEMBERED_REQUEST_IDS)));
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(new Item("gift", "g", 1, "id-0")), "いちばん古い番号は忘れる（覚える数に上限がある）");
    }

    @Test
    void oneTickRunsAtMost60CommandsAndKeeps8ForLikes() {
        EventQueues<Item> queues = new EventQueues<>();
        queues.offer(gift("bigGift", 100));
        queues.offer(other("manual", 10));
        queues.offer(like("cod", 100));
        Runner runner = new Runner();

        queues.process(runner);
        assertEquals(52, runner.count("bigGift"), "ギフトとそのほかで 52");
        assertEquals(0, runner.count("manual"), "ギフトが予算を使い切ったら、そのほかは次の tick");
        assertEquals(8, runner.count("cod"), "ギフトが続いても、いいねは 8 動く");

        runner.ran.clear();
        queues.process(runner);
        assertEquals(48, runner.count("bigGift"), "大きなギフトは続きから");
        assertEquals(4, runner.count("manual"), "ギフトの残りの予算をそのほかが使う");
        assertEquals(8, runner.count("cod"), "使わなかったギフトの予算をいいねは借りない");
        assertEquals(60, runner.ran.size());
    }

    @Test
    void aSliceLargerThanTheBudgetEndsTheTickForGiftsAndOthers() {
        // 1周分のファイル（たとえば 70 行）は分けずに動かす。予算を超えたら、その tick はそのほかを動かさない。
        EventQueues<Item> queues = new EventQueues<>();
        queues.offer(gift("long", 1));
        queues.offer(other("manual", 1));
        queues.offer(like("cod", 1));
        List<String> ran = new ArrayList<>();
        queues.process((event, budget) -> {
            ran.add(event.name);
            event.remaining = 0;
            return event.name.equals("long") ? 70 : 1;
        });
        assertEquals(List.of("long", "cod"), ran);
        assertEquals(new EventQueues.Sizes(0, 0, 1), queues.sizes());
    }

    @Test
    void anEventThatCannotStartWaitsAtTheHeadWithoutBlockingOtherLanes() {
        // ゲームMODの WAIT・タラの上限など、動かせなかったイベントは先頭に残り、次の tick でやり直す。
        EventQueues<Item> queues = new EventQueues<>();
        queues.offer(gift("waiting", 1));
        queues.offer(gift("behind", 1));
        queues.offer(other("manual", 1));
        List<String> ran = new ArrayList<>();
        queues.process((event, budget) -> {
            ran.add(event.name);
            if (event.name.equals("waiting")) return 0;
            event.remaining = 0;
            return 1;
        });
        assertEquals(List.of("waiting", "manual"), ran, "同じ待ちの後ろは追い越さない。ほかの待ちは動く");
        assertEquals(new EventQueues.Sizes(2, 0, 0), queues.sizes());
    }

    @Test
    void whilePausedNothingRunsButRequestsAreStillAccepted() {
        EventQueues<Item> queues = new EventQueues<>();
        queues.setPaused(true);
        assertTrue(queues.paused());
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(gift("rose", 3)));
        assertFalse(queues.hasWork(), "止めている間は tick で取り出さない");
        Runner runner = new Runner();
        queues.process(runner);
        assertTrue(runner.ran.isEmpty());
        assertEquals(new EventQueues.Sizes(1, 0, 0), queues.sizes(), "届いた分は預かる");

        queues.setPaused(false);
        assertTrue(queues.hasWork());
        queues.process(runner);
        assertEquals(3, runner.count("rose"), "再開したら送られた数どおり動かす");
    }

    @Test
    void discardingLikesStopsTheRunningLikeAndKeepsGifts() {
        EventQueues<Item> queues = new EventQueues<>();
        Item running = like("running", 20);
        queues.offer(running);
        queues.offer(like("waiting", 5));
        queues.offer(gift("rose", 1));
        Runner runner = new Runner();
        queues.process(runner);
        assertEquals(12, running.remaining);

        assertEquals(2, queues.discardLikes());
        assertEquals(0, running.remaining, "実行中のいいねも残りを 0 にする");
        assertEquals(new EventQueues.Sizes(0, 0, 0), queues.sizes());
        assertEquals(0, queues.discardLikes());
    }

    @Test
    void aLikeAddedWhileTheHeadWasDiscardedIsNotDropped() {
        // 動かしている間に /bridge/control で捨てられ、すぐ次のいいねが届いたとき、新しいいいねを取り出しで消さない。
        EventQueues<Item> queues = new EventQueues<>();
        queues.offer(like("old", 3));
        List<String> ran = new ArrayList<>();
        queues.process((event, budget) -> {
            ran.add(event.name);
            if (event.name.equals("old")) {
                queues.discardLikes();
                queues.offer(like("new", 1));
                return 1;
            }
            event.remaining = 0;
            return 1;
        });
        assertEquals(List.of("old", "new"), ran);
        assertEquals(new EventQueues.Sizes(0, 0, 0), queues.sizes());
    }

    @Test
    void clearingOnServerStopEmptiesQueuesForgetsIdsAndResumes() {
        EventQueues<Item> queues = new EventQueues<>();
        queues.offer(new Item("gift", "rose", 1, "rose:0"));
        queues.setPaused(true);
        queues.clear();
        assertFalse(queues.paused(), "サーバーを止めたら一時停止を解く");
        assertEquals(new EventQueues.Sizes(0, 0, 0), queues.sizes());
        // 待ちを消したので、次の起動で届いた同じ番号は受ける（消した分が動かないままにならない）。
        assertEquals(EventQueues.Offer.ACCEPTED, queues.offer(new Item("gift", "rose", 1, "rose:0")));
    }
}
