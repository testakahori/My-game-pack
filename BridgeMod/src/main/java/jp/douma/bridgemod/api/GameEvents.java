package jp.douma.bridgemod.api;

import java.util.*;
import java.util.function.Function;
import java.util.function.Supplier;

/** Server-thread handoff. ACCEPTED transfers ownership; WAIT leaves the event in Bridge's queue. */
public final class GameEvents {
    public static final int WAIT = 0, ACCEPTED = 1, DISCARDED = 2;
    // Forge は MOD のコンストラクターを並列に呼ぶので、同時に登録しても消えない Map にする（アプリレビュー 2026-10-08 P5）。
    private static final Map<String, Function<Map<String, Object>, Integer>> RECEIVERS = new java.util.concurrent.ConcurrentHashMap<>();
    private static final Map<String, Supplier<Map<String, Object>>> STATUS = new java.util.concurrent.ConcurrentHashMap<>();
    private static Function<Map<String, Object>, Integer> commonEffects;
    private record Session(String id, boolean active) {}
    private static final Map<String, Session> SESSIONS = new java.util.concurrent.ConcurrentHashMap<>();
    /** Call in the game MOD's start/reset handler, before accepting requests for the new round. */
    public static String beginSession(String gameId) { return changeSession(gameId, true); }
    /** Invalidate old requests on game end/reset; pause and player death must not call this. */
    public static void endSession(String gameId) { changeSession(gameId, false); }
    private static String changeSession(String gameId, boolean active) {
        if (!RECEIVERS.containsKey(gameId)) throw new IllegalArgumentException("Game MOD is not registered: " + gameId);
        String id = UUID.randomUUID().toString();
        SESSIONS.put(gameId, new Session(id, active)); return id;
    }
    public static String sessionId(String gameId) {
        Session session = SESSIONS.get(gameId); return session == null ? "" : session.id;
    }
    /** Game-owned opt-in check. Return DISCARDED for stale/missing IDs, never WAIT. */
    public static boolean isCurrentSession(String gameId, Object sessionId) {
        Session session = SESSIONS.get(gameId);
        return session != null && session.active && session.id.equals(sessionId);
    }
    public static Map<String, Object> sessions() {
        Map<String, Object> snapshot = new TreeMap<>();
        SESSIONS.forEach((id, session) -> snapshot.put(id, Map.of("sessionId", session.id, "active", session.active)));
        return Collections.unmodifiableMap(snapshot);
    }
    /** Server shutdown invalidates every previous round, including delayed external retries. */
    public static void clearSessions() { SESSIONS.clear(); }
    public static Map<String, Object> arguments(Object value) {
        if (value == null) return Map.of();
        if (!(value instanceof Map<?, ?> input) || input.size() > 32) throw new IllegalArgumentException("args must be an object with at most 32 fields");
        Map<String, Object> copy = new LinkedHashMap<>(); int textLength = 0;
        for (var entry : input.entrySet()) {
            if (!(entry.getKey() instanceof String key) || !key.matches("[A-Za-z][A-Za-z0-9_]{0,63}") || Set.of("constructor", "prototype").contains(key))
                throw new IllegalArgumentException("Invalid args key");
            Object item = entry.getValue();
            if (item instanceof String text) {
                textLength += text.length();
                if (text.length() > 1024 || textLength > 8192) throw new IllegalArgumentException("args text is too long");
            } else if (!(item instanceof Boolean) && !(item instanceof Number number && Double.isFinite(number.doubleValue())))
                throw new IllegalArgumentException("args values must be strings, finite numbers or booleans");
            copy.put(key, item);
        }
        return Collections.unmodifiableMap(copy);
    }
    private GameEvents() {}
    /** ゲーム MOD の ID に使えない名前（アプリの MOD と、前の名前）。 */
    public static final Set<String> RESERVED_MOD_IDS = Set.of("bridgemod", "displaymod", "doumacmd", "minecraft_obs_bridge");
    /**
     * ゲーム MOD の ID の決まり（アプリ・BRIDGE の bridge/game_commands.cjs の isGameModId と同じ。scripts/test-bridge-contracts.cjs で比べる）。
     * 前は予約名を断らず、null を渡すと NullPointerException になっていた（処理のコピー PR6）。
     */
    public static boolean isGameModId(String id) {
        return id != null && id.matches("[a-z][a-z0-9_]{1,63}") && !RESERVED_MOD_IDS.contains(id);
    }
    public static void register(String id, Function<Map<String, Object>, Integer> receiver,
                                Supplier<Map<String, Object>> status) {
        Objects.requireNonNull(receiver);
        Objects.requireNonNull(status);
        if (!isGameModId(id) || RECEIVERS.putIfAbsent(id, receiver) != null)
            throw new IllegalArgumentException("Duplicate or invalid game MOD: " + id);
        STATUS.put(id, status);
    }
    public static int offer(String id, Map<String, Object> event) {
        Object requestId = event.get("requestId");
        if (!(requestId instanceof String text) || !text.matches("[A-Za-z0-9_.:-]{1,128}"))
            throw new IllegalArgumentException("A stable requestId is required for each game request");
        var receiver = RECEIVERS.get(id);
        if (receiver == null) throw new IllegalStateException("Game MOD is not loaded: " + id);
        Map<String, Object> copy = new HashMap<>(event);
        copy.put("args", arguments(event.get("args")));
        int result = receiver.apply(Collections.unmodifiableMap(copy));
        if (result != WAIT && result != ACCEPTED && result != DISCARDED) throw new IllegalStateException("Invalid game handoff result");
        return result;
    }
    /** 外部ゲームMODの状態取得が例外を出しても（無限の再帰も含む）、その MOD の分だけ {"ok":false,"error":…} にして、ほかの MOD とサーバーは止めない。 */
    public static Map<String, Object> status() {
        Map<String, Object> result = new TreeMap<>();
        STATUS.forEach((id, supplier) -> {
            Object value;
            try { value = supplier.get(); }
            catch (Exception | StackOverflowError | LinkageError error) { value = Map.of("ok", false, "error", error.getClass().getSimpleName() + ": " + error.getMessage()); }
            result.put(id, value);
        });
        return result;
    }
    /** Common meteor / wither behaviour remains owned by BridgeMOD. No notification is emitted here. */
    public static void registerCommonEffects(Function<Map<String, Object>, Integer> receiver) {
        commonEffects = Objects.requireNonNull(receiver);
    }
    public static int commonEffect(Object source, String key, int count, Map<String, Object> protection) {
        if (commonEffects == null) throw new IllegalStateException("Bridge common effects are not ready");
        Map<String, Object> request = new HashMap<>(protection);
        request.put("source", source); request.put("key", key); request.put("count", count);
        return commonEffects.apply(request);
    }
}
