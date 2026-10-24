package jp.streamtorearn.stackinggame.event;

import jp.streamtorearn.stackinggame.StackingGameMod;
import jp.streamtorearn.stackinggame.core.StackingRuntime;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * StackingGame の妨害イベントを1件ずつ順番に実行する共通管理クラス。
 *
 * <p>13イベントすべてを「実行中1件 + FIFO待機列」で統一する。
 * OBS通知もこのクラスの実開始・終了・中止地点から送る。</p>
 */
public final class EventManager {
    /**
     * 運用上の待機上限。
     *
     * <p>ArrayDeque 自体に500件制限があるわけではない。内部の要素数は int 系のため
     * 理論上は Integer.MAX_VALUE（2,147,483,647）付近まで表現できるが、実際には
     * JVMヒープ容量・GC負荷・1要求が保持する文字列/Map等により、そのはるか手前で
     * メモリ上限へ達する。必要になった場合のみ負荷試験後にこの値を増やすこと。</p>
     */
    public static final int MAX_QUEUE_SIZE = 500;

    private final StackingRuntime runtime;
    private final ArrayDeque<EventRequest> waiting = new ArrayDeque<>();
    private final RequestLedger requestLedger = new RequestLedger();

    private static final long START_RETRY_BASE_TICKS = 20L;
    private static final long START_RETRY_MAX_TICKS = 100L;

    private ActiveEvent activeEvent;
    private EventRequest activeRequest;
    private final EventTimeoutGuard timeoutGuard = new EventTimeoutGuard();
    /**
     * ACCEPTED済み要求のうち、offline/death/dimension待ち等の一時失敗だけを内部再試行する。
     * 引数不正やstart例外などDISCARDED相当の恒久失敗は終端化し、FIFO先頭を塞がない。
     */
    private final Map<String, StartRetryState> startRetry = new HashMap<>();

    public EventManager(StackingRuntime runtime) {
        this.runtime = runtime;
    }

    /**
     * Bridge/手動コマンド共通の受付。
     * Bridge由来の要求は requestId を使って再送判定する。
     */
    public synchronized Result submit(MinecraftServer server, EventRequest request) {
        if (!runtime.registry.contains(request.eventKey())) {
            return new Result(SubmitStatus.DISCARDED, "unknown eventKey: " + request.eventKey());
        }

        // 同じ eventKey ではなく、同じ externalRequestId だけを再送として判定する。
        // 一度ACCEPTED済みなら、その後プレイヤーが不在でも再送にはACCEPTEDを返す。
        RequestLedger.Check check = requestLedger.check(request);
        if (check == RequestLedger.Check.DUPLICATE) {
            return new Result(SubmitStatus.ACCEPTED, "duplicate request already accepted");
        }
        if (check == RequestLedger.Check.CONFLICT) {
            return new Result(SubmitStatus.DISCARDED, "requestId reused with different payload");
        }
        if (check == RequestLedger.Check.FAILED) {
            return new Result(SubmitStatus.DISCARDED,
                    "request previously failed after acceptance: " + requestLedger.failureReason(request.externalRequestId()));
        }

        ServerPlayer player = server.getPlayerList().getPlayer(request.playerId());
        if (player == null) {
            // 一時的にプレイヤーが不在なら、Bridge側に要求を保持してもらう。
            return new Result(SubmitStatus.WAIT, "target player offline");
        }

        if (waiting.size() >= MAX_QUEUE_SIZE) {
            // WAITの場合は ledger に記録しない。Bridgeが同じrequestIdで再試行できるようにする。
            return new Result(SubmitStatus.WAIT, "queue full " + waiting.size() + "/" + MAX_QUEUE_SIZE);
        }

        EventExecutionPolicy executionPolicy = runtime.registry.executionPolicy(request.eventKey());
        if (executionPolicy.duplicateQueuePolicy() == DuplicateQueuePolicy.DENY_PENDING
                && hasSameEventPending(request.eventKey())) {
            return new Result(SubmitStatus.WAIT, "same event already active/queued: " + request.eventKey());
        }

        // コンストラクタ段階で検証できるイベント引数は、受付前に確認しておく。
        // これにより明らかな不正引数をACCEPTEDしてから失敗するケースを減らす。
        try {
            EventArgumentValidator.validate(request.eventKey(), request.eventArgs());
            EventContext validationContext = runtime.context(server, player, request);
            // TargetMode policy is validated for every event before it enters the FIFO.
            validationContext.level();
            runtime.registry.create(validationContext, request.eventArgs());
        } catch (IllegalArgumentException exception) {
            return new Result(SubmitStatus.DISCARDED, exception.getMessage());
        } catch (Exception exception) {
            StackingGameMod.LOGGER.warn("Event validation failed for {}: {}", request.eventKey(), exception.toString());
            return new Result(SubmitStatus.DISCARDED, "validation failed: " + exception.getClass().getSimpleName());
        }

        waiting.addLast(request);
        requestLedger.remember(request);
        return new Result(SubmitStatus.ACCEPTED, "queued position=" + waiting.size());
    }

    /**
     * Bridge受信時、対象プレイヤーを解決する前に再送だけ先に判定したい場合に使用する。
     * NEWの場合はnullを返し、通常のsubmitへ進む。
     */
    public synchronized Result checkDuplicateOnly(EventRequest request) {
        RequestLedger.Check check = requestLedger.check(request);
        if (check == RequestLedger.Check.DUPLICATE) {
            return new Result(SubmitStatus.ACCEPTED, "duplicate request already accepted");
        }
        if (check == RequestLedger.Check.CONFLICT) {
            return new Result(SubmitStatus.DISCARDED, "requestId reused with different payload");
        }
        if (check == RequestLedger.Check.FAILED) {
            return new Result(SubmitStatus.DISCARDED,
                    "request previously failed after acceptance: " + requestLedger.failureReason(request.externalRequestId()));
        }
        return null;
    }

    public synchronized void tick(MinecraftServer server, long tick) {
        // 1. まず現在イベントを進める。
        if (activeEvent != null) {
            try {
                activeEvent.tick(tick);
            } catch (Exception exception) {
                StackingGameMod.LOGGER.error("Active event tick failed: " + activeEvent.eventKey(), exception);
                cancelActive(server, CancelReason.ERROR);
            }

            if (activeEvent != null
                    && !activeEvent.isFinished()
                    && timeoutGuard.isTimedOut(tick)) {
                StackingGameMod.LOGGER.error(
                        "Event timeout: key={} requestId={} elapsed={} max={}",
                        activeEvent.eventKey(),
                        activeRequest == null ? "-" : activeRequest.externalRequestId(),
                        timeoutGuard.elapsed(tick),
                        timeoutGuard.budgetTicks());
                cancelActive(server, CancelReason.TIMEOUT);
            }

            if (activeEvent != null && activeEvent.isFinished()) {
                finishActiveNormally(server);
            }
        }

        // 2. 前イベントの終了・後片付けが完了してから、FIFO先頭の1件だけを開始する。
        //    WAIT相当の一時失敗はFIFO先頭に保持して再試行する。
        //    DISCARDED相当の恒久失敗は終端化し、後続イベントを止めない。
        if (activeEvent == null && !waiting.isEmpty()) {
            EventRequest next = waiting.peekFirst();
            StartRetryState retry = startRetry.get(next.externalRequestId());
            if (retry != null && tick < retry.nextRetryTick()) {
                return;
            }

            Result result = start(server, next, tick);
            if (result.status() == SubmitStatus.ACCEPTED) {
                waiting.pollFirst();
                startRetry.remove(next.externalRequestId());
            } else if (result.status() == SubmitStatus.WAIT) {
                StartRetryState updated = scheduleStartRetry(next, tick, result.message());
                StackingGameMod.LOGGER.warn(
                        "Accepted queued event is temporarily unable to start; keeping FIFO head for retry: "
                                + "key={} requestId={} attempt={} retryInTicks={} reason={}",
                        next.eventKey(), next.externalRequestId(), updated.attempts(),
                        updated.nextRetryTick() - tick, result.message());
            } else {
                // DISCARDED は引数不正やstart内部例外など、同じ要求を待っても改善しない恒久失敗。
                // FIFO先頭を永久に塞がないよう終端化し、同じrequestIdの再送にもDISCARDEDを返す。
                waiting.pollFirst();
                startRetry.remove(next.externalRequestId());
                requestLedger.markFailed(next, result.message());
                StackingGameMod.LOGGER.error(
                        "Accepted queued event failed permanently before start; removed from FIFO: "
                                + "key={} requestId={} reason={}",
                        next.eventKey(), next.externalRequestId(), result.message());
            }
        }
    }

    private Result start(MinecraftServer server, EventRequest request, long tick) {
        ServerPlayer player = server.getPlayerList().getPlayer(request.playerId());
        if (player == null) {
            return new Result(SubmitStatus.WAIT, "target player offline at start");
        }
        if (!player.isAlive() || player.isRemoved()) {
            return new Result(SubmitStatus.WAIT, "target player not alive/ready at start");
        }
        if (runtime.registry.targetMode(request.eventKey()) == EventTargetMode.ARENA
                && !runtime.arena.isArenaLevel(player.serverLevel())) {
            return new Result(SubmitStatus.WAIT,
                    "target player is outside arena dimension: " + player.serverLevel().dimension().location());
        }

        ActiveEvent event = null;
        try {
            EventContext context = runtime.context(server, player, request);
            // Re-check TargetMode at actual start because the player may have changed dimension while queued.
            context.level();

            // countはBridgeから受け取った値を保持するが、現時点ではゲーム効果へ反映しない。
            // 1以外の場合だけ別メソッドを通すことで、将来の強弱/回数変更を追加しやすくする。
            if (request.rawCount() == 1) {
                event = createNormalEvent(context, request);
            } else {
                event = createCountVariantEvent(context, request);
            }

            // start()が成功するまでOBSへSTARTを送らない。
            event.start(tick);
            activeEvent = event;
            activeRequest = request;
            timeoutGuard.start(tick, event.maxRuntimeTicks());

            StackingGameMod.LOGGER.info(
                    "Stacking event started: key={} requestId={} listener={} count={} waiting={}",
                    request.eventKey(), request.externalRequestId(), request.listenerName(),
                    request.rawCount(), waiting.size());

            runtime.integration.notifyObsStart(server, request);
            // DisplayMODは任意連携。ゲーム本体/OBS lifecycleはこの時点で既に開始している。
            return new Result(SubmitStatus.ACCEPTED, "started");
        } catch (IllegalArgumentException exception) {
            safeCleanupStartFailure(server, event);
            StackingGameMod.LOGGER.warn("Rejected {}: {}", request.eventKey(), exception.getMessage());
            return new Result(SubmitStatus.DISCARDED, exception.getMessage());
        } catch (Exception exception) {
            safeCleanupStartFailure(server, event);
            StackingGameMod.LOGGER.error("Failed to start event " + request.eventKey(), exception);
            return new Result(SubmitStatus.DISCARDED, "start failed: " + exception.getClass().getSimpleName());
        }
    }

    private void safeCleanupStartFailure(MinecraftServer server, ActiveEvent event) {
        if (event == null) return;
        try {
            if (!event.isFinished()) event.cancel(CancelReason.ERROR);
        } catch (Exception cleanupError) {
            StackingGameMod.LOGGER.error("Failed to cancel event after start failure", cleanupError);
        } finally {
            logOwnedResources("START_FAILURE", event.executionId());
            runtime.lifecycleCleanup.cleanupExecution(server, event.executionId(), "START_FAILURE", EventLifecycleCleanup.Mode.FORCED_END);
            runtime.blockAudit.clear(event.executionId());
        }
    }

    private StartRetryState scheduleStartRetry(EventRequest request, long tick, String reason) {
        StartRetryState old = startRetry.get(request.externalRequestId());
        int attempts = old == null ? 1 : old.attempts() + 1;
        long delay = Math.min(START_RETRY_MAX_TICKS, START_RETRY_BASE_TICKS * Math.min(attempts, 5));
        StartRetryState next = new StartRetryState(attempts, tick + delay, reason == null ? "" : reason);
        startRetry.put(request.externalRequestId(), next);
        return next;
    }

    private record StartRetryState(int attempts, long nextRetryTick, String lastReason) {}

    private ActiveEvent createNormalEvent(EventContext context, EventRequest request) {
        return runtime.registry.create(context, request.eventArgs());
    }

    private ActiveEvent createCountVariantEvent(EventContext context, EventRequest request) {
        // 将来ここで eventKey / rawCount を見て、強化版・回数変更などへ分岐できる。
        // 現在はcountが1以外でも、通常と同じ1回のイベントとして実行する。
        return runtime.registry.create(context, request.eventArgs());
    }

    /** 通常終了した1件を確定し、OBSへENDを通知する。 */
    private void finishActiveNormally(MinecraftServer server) {
        if (activeEvent == null) return;
        EventRequest finishedRequest = activeRequest;
        String finishedKey = activeEvent.eventKey();
        logOwnedResources("END", activeEvent.executionId());
        runtime.lifecycleCleanup.cleanupExecution(server, activeEvent.executionId(), "END", EventLifecycleCleanup.Mode.NORMAL_END);
        runtime.blockAudit.clear(activeEvent.executionId());
        if (finishedRequest != null) runtime.integration.notifyObsEnd(server, finishedRequest);
        StackingGameMod.LOGGER.info("Stacking event finished: key={} requestId={}", finishedKey,
                finishedRequest == null ? "-" : finishedRequest.externalRequestId());
        clearActive();
    }

    private void cancelActive(MinecraftServer server, CancelReason reason) {
        if (activeEvent == null) return;
        EventRequest cancelledRequest = activeRequest;
        String cancelledKey = activeEvent.eventKey();
        try { activeEvent.cancel(reason); }
        catch (Exception exception) { StackingGameMod.LOGGER.error("Active event cancel failed: " + cancelledKey, exception); }
        logOwnedResources(reason.name(), activeEvent.executionId());
        runtime.lifecycleCleanup.cleanupExecution(server, activeEvent.executionId(), reason.name(), EventLifecycleCleanup.Mode.FORCED_END);
        runtime.blockAudit.clear(activeEvent.executionId());
        if (cancelledRequest != null) runtime.integration.notifyObsCancelled(server, cancelledRequest, reason);
        StackingGameMod.LOGGER.info("Stacking event cancelled: key={} requestId={} reason={}", cancelledKey,
                cancelledRequest == null ? "-" : cancelledRequest.externalRequestId(), reason);
        clearActive();
    }

    private void logOwnedResources(String phase, UUID executionId) {
        EventResourceOwnership.Summary summary = runtime.resources.summary(executionId);
        if (summary.total() == 0) return;
        StackingGameMod.LOGGER.info(
                "Event-owned resources at {}: executionId={} temporaryBlocks={} fallingBlocks={} mobs={}",
                phase, executionId, summary.temporaryBlocks(), summary.fallingBlocks(), summary.mobs());
    }

    private void clearActive() {
        activeEvent = null;
        activeRequest = null;
        timeoutGuard.clear();
    }

    private boolean hasSameEventPending(String eventKey) {
        if (activeRequest != null && activeRequest.eventKey().equals(eventKey)) return true;
        for (EventRequest queued : waiting) {
            if (queued.eventKey().equals(eventKey)) return true;
        }
        return false;
    }

    public synchronized void cancelActiveForPlayer(MinecraftServer server, UUID player, CancelReason reason) {
        if (activeEvent != null && activeEvent.playerId().equals(player)) cancelActive(server, reason);
    }

    public synchronized void cancelPlayer(MinecraftServer server, UUID player, CancelReason reason, boolean clearWaiting) {
        cancelActiveForPlayer(server, player, reason);
        if (clearWaiting) {
            waiting.removeIf(request -> {
                if (!request.playerId().equals(player)) return false;
                startRetry.remove(request.externalRequestId());
                return true;
            });
        }
    }

    public synchronized void cancelAll(MinecraftServer server, CancelReason reason) {
        if (reason == CancelReason.RESET) {
            resetRound(server);
            return;
        }
        cancelActive(server, reason);
        waiting.clear();
        startRetry.clear();
    }

    /**
     * ラウンドRESET専用。
     * 実行中イベントのtickは停止するが、Mob/FallingBlock/地形は削除しない。
     * EventLifecycleCleanup.RESET_FLUID_ONLYでイベント由来の水・溶岩だけ復元する。
     */
    public synchronized void resetRound(MinecraftServer server) {
        if (activeEvent != null) {
            EventRequest resetRequest = activeRequest;
            String resetKey = activeEvent.eventKey();
            logOwnedResources("RESET", activeEvent.executionId());
            runtime.lifecycleCleanup.cleanupExecution(
                    server, activeEvent.executionId(), "RESET", EventLifecycleCleanup.Mode.RESET_FLUID_ONLY);
            runtime.blockAudit.clear(activeEvent.executionId());
            if (resetRequest != null) {
                runtime.integration.notifyObsCancelled(server, resetRequest, CancelReason.RESET);
            }
            StackingGameMod.LOGGER.info(
                    "Stacking event reset: key={} requestId={} resources other than temporary fluids were kept",
                    resetKey, resetRequest == null ? "-" : resetRequest.externalRequestId());
            clearActive();
        }
        waiting.clear();
        startRetry.clear();
    }

    /** サーバー停止時のみ、メモリ内の再送台帳も破棄する。 */
    public synchronized void clearLedger() {
        requestLedger.clear();
        startRetry.clear();
    }

    public synchronized int waitingCount() {
        return waiting.size();
    }

    public int queueCapacity() {
        return MAX_QUEUE_SIZE;
    }

    public synchronized String activeKey() {
        return activeEvent == null ? "-" : activeEvent.eventKey();
    }

    public synchronized String activeExternalRequestId() {
        return activeRequest == null ? "-" : activeRequest.externalRequestId();
    }

    public synchronized String activeDuplicatePolicy() {
        return activeRequest == null ? "-" : runtime.registry.executionPolicy(activeRequest.eventKey()).duplicateQueuePolicy().name();
    }

    public synchronized long activeTimeoutBudgetTicks() {
        return activeEvent == null ? 0L : timeoutGuard.budgetTicks();
    }

    public synchronized String activeTargetMode() {
        return activeRequest == null ? "-" : runtime.registry.targetMode(activeRequest.eventKey()).name();
    }

    public synchronized String nextKey() {
        EventRequest next = waiting.peekFirst();
        return next == null ? "-" : next.eventKey();
    }

    public int ledgerSize() {
        return requestLedger.size();
    }

    public record Result(SubmitStatus status, String message) {
        public boolean accepted() {
            return status == SubmitStatus.ACCEPTED;
        }
    }
}
