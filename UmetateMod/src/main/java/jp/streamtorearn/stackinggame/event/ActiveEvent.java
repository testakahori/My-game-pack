package jp.streamtorearn.stackinggame.event;

import java.util.UUID;

public interface ActiveEvent {
    void start(long serverTick);
    void tick(long serverTick);
    void cancel(CancelReason reason);
    boolean isFinished();
    String eventKey();
    UUID executionId();
    UUID playerId();

    /**
     * イベントが何らかの不具合で finish() へ到達しなかった場合の安全弁。
     * 各イベントは通常動作時間より十分長い値を返す。
     */
    default long maxRuntimeTicks() {
        return 20L * 660L;
    }
}
