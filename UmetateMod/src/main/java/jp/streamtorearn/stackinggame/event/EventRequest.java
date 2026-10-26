package jp.streamtorearn.stackinggame.event;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * StackingGame が1件の妨害要求として保持する値。
 *
 * <p>BridgeMOD の requestId と、Minecraft 内部の一時ブロック管理に使う UUID は
 * 用途が違うため分けて保持する。Bridge から受け取った値は書き換えない。</p>
 */
public record EventRequest(
        UUID executionId,
        String externalRequestId,
        String eventKey,
        UUID playerId,
        int rawCount,
        String listenerName,
        String type,
        String gameSessionId,
        Map<String, Object> args,
        boolean announce,
        List<String> eventArgs,
        long receivedAtTick) {

    public EventRequest {
        externalRequestId = externalRequestId == null ? "" : externalRequestId;
        eventKey = eventKey == null ? "" : eventKey;
        listenerName = listenerName == null ? "" : listenerName;
        type = type == null ? "other" : type;
        gameSessionId = gameSessionId == null ? "" : gameSessionId;
        args = args == null ? Map.of() : Map.copyOf(args);
        eventArgs = eventArgs == null ? List.of() : List.copyOf(eventArgs);
    }

    /**
     * Bridge を使わない手動テスト用要求を作成する。
     * count は現時点ではゲーム効果へ反映しないため 1 固定。
     */
    public static EventRequest local(
            String eventKey,
            UUID playerId,
            String listenerName,
            List<String> eventArgs,
            long receivedAtTick) {
        return local(eventKey, playerId, listenerName, eventArgs, receivedAtTick, false);
    }

    /** announce が true なら、始まったときにギフトを表示する（umetate で送った人の名前があるとき。埋め立て PR1）。 */
    public static EventRequest local(
            String eventKey,
            UUID playerId,
            String listenerName,
            List<String> eventArgs,
            long receivedAtTick,
            boolean announce) {
        UUID executionId = UUID.randomUUID();
        return new EventRequest(
                executionId,
                "local:" + executionId,
                eventKey,
                playerId,
                1,
                listenerName,
                "other",
                "local",
                Map.of(),
                announce,
                eventArgs,
                receivedAtTick);
    }
}
