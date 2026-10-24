package jp.streamtorearn.stackinggame.event;

import java.util.UUID;

public abstract class AbstractActiveEvent implements ActiveEvent {
    protected final EventContext ctx;
    protected boolean finished;
    protected boolean cancelled;
    protected long startedTick;

    protected AbstractActiveEvent(EventContext ctx) {
        this.ctx = ctx;
    }

    @Override
    public void start(long serverTick) {
        this.startedTick = serverTick;
        onStart(serverTick);
    }

    protected abstract void onStart(long tick);

    @Override
    public void cancel(CancelReason reason) {
        if (finished) return;
        cancelled = true;
        onCancel(reason);
        finished = true;
    }

    /**
     * イベント固有の中止処理用フック。
     * 共通リソースの後片付けは EventManager -> EventLifecycleCleanup が一元管理する。
     */
    protected void onCancel(CancelReason reason) {
        // default no-op
    }

    protected void finish() {
        finished = true;
    }

    @Override
    public boolean isFinished() {
        return finished;
    }

    @Override
    public String eventKey() {
        return ctx.request().eventKey();
    }

    @Override
    public UUID executionId() {
        return ctx.request().executionId();
    }

    @Override
    public UUID playerId() {
        return ctx.request().playerId();
    }
}
