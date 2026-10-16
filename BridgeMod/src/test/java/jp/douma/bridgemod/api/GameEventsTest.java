package jp.douma.bridgemod.api;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

// アプリレビュー（2026-10-08）P5：外部ゲームMODの状態取得の例外でサーバーを落とさない。登録が同時でも消えない。
// GameEvents は static なので、テストごとに別の ID を使う。
class GameEventsTest {
    @Test
    void oneFailingGameStatusDoesNotBreakTheOthers() {
        GameEvents.register("qa_status_ok", event -> GameEvents.ACCEPTED, () -> Map.of("round", 1));
        GameEvents.register("qa_status_bad", event -> GameEvents.ACCEPTED, () -> { throw new IllegalStateException("broken"); });
        Map<String, Object> status = assertDoesNotThrow(GameEvents::status);
        assertEquals(Map.of("round", 1), status.get("qa_status_ok"));
        assertEquals(Map.of("ok", false, "error", "IllegalStateException: broken"), status.get("qa_status_bad"));
    }

    // 状態の Supplier が無限に再帰しても、その MOD の分だけエラーにする（PR #98 再レビュー m4）。
    @Test
    void aGameStatusThatRecursesForeverOnlyBreaksThatGame() {
        GameEvents.register("qa_status_deep", event -> GameEvents.ACCEPTED, GameEventsTest::recurse);
        Map<String, Object> status = assertDoesNotThrow(GameEvents::status);
        assertEquals(Map.of("ok", false, "error", "StackOverflowError: null"), status.get("qa_status_deep"));
    }

    private static Map<String, Object> recurse() {
        return recurse();
    }

    // Forge は MOD のコンストラクターを並列に呼ぶ。同時に登録しても、どれも消えない。
    @Test
    void concurrentRegistrationsAreAllKept() throws Exception {
        int threads = 16, perThread = 200;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<?>> done = new ArrayList<>();
            for (int t = 0; t < threads; t++) {
                int thread = t;
                done.add(pool.submit(() -> {
                    start.await();
                    for (int i = 0; i < perThread; i++) GameEvents.register("qa_many_" + thread + "_" + i, event -> GameEvents.ACCEPTED, Map::of);
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> future : done) future.get(10, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        int registered = 0;
        for (int t = 0; t < threads; t++) for (int i = 0; i < perThread; i++) {
            try { if (GameEvents.offer("qa_many_" + t + "_" + i, Map.of("requestId", "r1")) == GameEvents.ACCEPTED) registered++; }
            catch (IllegalStateException missing) { /* 登録が消えた */ }
        }
        assertEquals(threads * perThread, registered);
    }

    // 同じ ID の登録が同時に来ても、受け付けるのは1つだけ（もう1つは二重登録として断る）。
    @Test
    void theSameGameCannotBeRegisteredTwiceEvenAtTheSameTime() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 300; round++) {
                String id = "qa_dup_" + round;
                CyclicBarrier barrier = new CyclicBarrier(2);
                AtomicInteger refused = new AtomicInteger();
                List<Future<?>> done = new ArrayList<>();
                for (int t = 0; t < 2; t++) done.add(pool.submit(() -> {
                    barrier.await();
                    try { GameEvents.register(id, event -> GameEvents.ACCEPTED, Map::of); }
                    catch (IllegalArgumentException duplicate) { refused.incrementAndGet(); }
                    return null;
                }));
                for (Future<?> future : done) future.get(10, TimeUnit.SECONDS);
                assertEquals(1, refused.get(), "round " + round);
            }
        } finally {
            pool.shutdownNow();
        }
    }
}
