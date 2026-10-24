package jp.streamtorearn.stackinggame.integration;

import jp.douma.bridgemod.api.GameEvents;
import jp.streamtorearn.stackinggame.StackingGameMod;
import jp.streamtorearn.stackinggame.core.StackingRuntime;
import jp.streamtorearn.stackinggame.event.EventManager;
import jp.streamtorearn.stackinggame.event.EventRequest;
import jp.streamtorearn.stackinggame.event.SubmitStatus;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * BridgeMOD 1.4.0 の正式 GameEvents API に直接接続する。
 *
 * <p>BridgeMODが保持する requestId / gameSessionId / args / listenerName / count を
 * 書き換えずにStackingGameのFIFOへ引き渡す。streamtorearn-common-apiは使用しない。</p>
 */
public final class BridgeGameApiIntegration {
    private final TargetPlayerResolver targetResolver = new TargetPlayerResolver();
    private boolean registered;
    private String currentSessionId = "";

    public void start(MinecraftServer server, StackingRuntime runtime) {
        if (!registered) {
            GameEvents.register(
                    StackingBridgeContract.GAME_ID,
                    data -> receive(runtime, data),
                    () -> status(runtime));
            registered = true;
            StackingGameMod.LOGGER.info("StackingGame registered BridgeMOD GameEvents receiver: {}", StackingBridgeContract.GAME_ID);
        }

        // ServerStarted/新ラウンド開始時に新しいsessionを発行する。
        currentSessionId = GameEvents.beginSession(StackingBridgeContract.GAME_ID);
        StackingGameMod.LOGGER.info("StackingGame BridgeMOD session started: {}", currentSessionId);
    }

    /**
     * BridgeMOD 1.4.0にはreceiverのunregister APIがない。
     * サーバー停止時はsessionだけ無効化し、同一JVMで再度ServerStartedした場合は
     * 登録済みreceiverを再利用して新sessionを開始する。
     */
    public void stop() {
        if (!registered) return;
        GameEvents.endSession(StackingBridgeContract.GAME_ID);
        currentSessionId = "";
    }

    public boolean available() { return registered; }
    public boolean registered() { return registered; }
    public String currentSessionId() {
        return currentSessionId == null || currentSessionId.isBlank() ? "-" : currentSessionId;
    }

    /** resetはBridge仕様どおりbeginSessionで新しいゲーム番号へ切り替える。 */
    public void rotateSession() {
        if (!registered) throw new IllegalStateException("BridgeMOD GameEvents receiver is not registered");
        currentSessionId = GameEvents.beginSession(StackingBridgeContract.GAME_ID);
        StackingGameMod.LOGGER.info("StackingGame BridgeMOD session rotated: {}", currentSessionId);
    }

    private int receive(StackingRuntime runtime, Map<String, Object> data) {
        try {
            if (!GameEvents.isCurrentSession(StackingBridgeContract.GAME_ID, data.get("gameSessionId"))) {
                return GameEvents.DISCARDED;
            }

            Object serverObject = data.get("server");
            if (!(serverObject instanceof MinecraftServer server)) {
                StackingGameMod.LOGGER.warn("BridgeMOD request did not include MinecraftServer");
                return GameEvents.WAIT;
            }

            String requestId = requiredString(data, "requestId");
            String eventKey = requiredString(data, "key").trim().toLowerCase(Locale.ROOT);
            int count = requiredCount(data.get("count"));
            String listenerName = optionalString(data.get("listenerName"));
            String type = normalizeType(optionalString(data.get("type")));
            String gameSessionId = requiredString(data, "gameSessionId");
            boolean announce = data.get("announce") instanceof Boolean value && value;
            Map<String, Object> args = args(data.get("args"));
            List<String> eventArgs = BridgeEventArgumentAdapter.toEventArgs(eventKey, args);

            EventRequest duplicateProbe = new EventRequest(
                    UUID.randomUUID(), requestId, eventKey, new UUID(0L, 0L),
                    count, listenerName, type, gameSessionId, args, announce, eventArgs, server.getTickCount());
            EventManager.Result duplicate = runtime.events.checkDuplicateOnly(duplicateProbe);
            if (duplicate != null) return toBridgeResult(duplicate.status());

            TargetPlayerResolver.Result target = targetResolver.resolve(server);
            if (!target.ok()) {
                StackingGameMod.LOGGER.warn("BridgeMOD request waits for exactly one player: {}", target.message());
                return GameEvents.WAIT;
            }

            ServerPlayer player = target.player();
            EventRequest request = new EventRequest(
                    UUID.randomUUID(), requestId, eventKey, player.getUUID(),
                    count, listenerName, type, gameSessionId, args, announce, eventArgs, server.getTickCount());
            return toBridgeResult(runtime.events.submit(server, request).status());
        } catch (IllegalArgumentException exception) {
            StackingGameMod.LOGGER.warn("BridgeMOD request discarded: {}", exception.getMessage());
            return GameEvents.DISCARDED;
        } catch (RuntimeException exception) {
            StackingGameMod.LOGGER.error("BridgeMOD GameEvents request handling failed", exception);
            return GameEvents.WAIT;
        }
    }

    private Map<String, Object> status(StackingRuntime runtime) {
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("api", "BridgeMOD-GameEvents-v1");
        status.put("gameId", StackingBridgeContract.GAME_ID);
        status.put("registered", registered);
        status.put("sessionId", currentSessionId());
        status.put("active", runtime.events.activeKey());
        status.put("activeRequestId", runtime.events.activeExternalRequestId());
        status.put("waiting", runtime.events.waitingCount());
        status.put("queueCapacity", runtime.events.queueCapacity());
        status.put("next", runtime.events.nextKey());
        status.put("ledger", runtime.events.ledgerSize());
        return Map.copyOf(status);
    }

    private static String requiredString(Map<String, Object> data, String key) {
        Object value = data.get(key);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalArgumentException(key + " is required");
        }
        return text;
    }

    private static String optionalString(Object value) {
        return value instanceof String text ? text : "";
    }

    private static int requiredCount(Object value) {
        if (!(value instanceof Number number)) throw new IllegalArgumentException("count must be integer");
        double d = number.doubleValue();
        if (!Double.isFinite(d) || Math.rint(d) != d) throw new IllegalArgumentException("count must be integer");
        long count = number.longValue();
        if (count < 1 || count > 100_000) throw new IllegalArgumentException("count must be 1..100000");
        return (int) count;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> args(Object value) {
        if (value == null) return Map.of();
        if (!(value instanceof Map<?, ?> map)) throw new IllegalArgumentException("args must be object");
        // BridgeMOD GameEvents.offer() has already validated and copied args. Copy once more
        // so EventRequest remains independent from caller-owned maps.
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (!(entry.getKey() instanceof String key)) throw new IllegalArgumentException("args key must be string");
            result.put(key, entry.getValue());
        }
        return Map.copyOf(result);
    }

    private static String normalizeType(String raw) {
        String type = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        return switch (type) {
            case "gift", "like" -> type;
            default -> "other";
        };
    }

    private static int toBridgeResult(SubmitStatus status) {
        return switch (status) {
            case ACCEPTED -> GameEvents.ACCEPTED;
            case WAIT -> GameEvents.WAIT;
            case DISCARDED -> GameEvents.DISCARDED;
        };
    }
}
